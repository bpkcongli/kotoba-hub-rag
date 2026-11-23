import { randomUUID } from 'node:crypto';
import { HF_IDENTITY, readHfConfig } from '@/adapters/hf-config';
import type { HfConfig } from '@/adapters/hf-config';
import { parseHfEmbeddings, parseHfScores } from '@/adapters/hf-validation';
import { systemClock } from '@/adapters/system-clock';
import type { CallContext, Clock, EmbeddingPort, Evidence, RerankerPort } from '@/shared/ports';

export type InferenceErrorCode =
  | 'INVALID_INPUT'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CAPACITY_LIMIT'
  | 'CANCELLED'
  | 'DEADLINE_EXCEEDED'
  | 'RATE_LIMITED'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_INPUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'ATTEMPT_OBSERVER_FAILED';

export class InferenceError extends Error {
  readonly code: InferenceErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number | null;
  readonly retryAfterMs: number | null;

  constructor(
    code: InferenceErrorCode,
    retryable = false,
    httpStatus: number | null = null,
    retryAfterMs: number | null = null,
  ) {
    // Do not retain raw errors, response bodies, input text, or credentials.
    super(`HF inference failed: ${code}`);
    this.name = 'InferenceError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface InferenceAttempt {
  readonly attemptId: string;
  readonly executionId: string;
  readonly operation: 'embedding' | 'rerank';
  readonly purpose: 'document' | 'query' | 'rerank';
  readonly itemCount: number;
  readonly identity: typeof HF_IDENTITY;
  readonly configuration: Omit<HfConfig, 'token'>;
  readonly profile: HfConfig['profile'];
  readonly timestamp: string;
  readonly durationMs: number;
  readonly httpStatus: number | null;
  readonly providerRequestId: string | null;
  readonly errorCode: InferenceErrorCode | null;
  readonly retryAfterMs: number | null;
  readonly remoteOutcome: 'response_received' | 'unknown';
  readonly usage: null;
  readonly costUsd: null;
}

export interface HfDependencies {
  readonly onAttempt: (attempt: InferenceAttempt, signal: AbortSignal) => Promise<void>;
  readonly fetch?: typeof globalThis.fetch;
  readonly clock?: Clock;
}

export interface HfInference {
  readonly embedding: EmbeddingPort;
  readonly reranker: RerankerPort;
  capabilities(): {
    readonly profile: HfConfig['profile'];
    readonly capable: boolean;
    readonly evidence: 'INF-01_SMOKE_NOT_LIVE_HEALTH';
    readonly sparse: 'unverified';
    readonly identity: typeof HF_IDENTITY;
    readonly configuration: Omit<HfConfig, 'token'>;
    readonly lastAttempt: InferenceAttempt | null;
  };
  close(): void;
}

function httpError(status: number, retryAfterMs: number | null): InferenceError {
  if (status === 429) {
    return new InferenceError('RATE_LIMITED', true, status, retryAfterMs);
  }

  if (status === 401 || status === 403) {
    return new InferenceError('PROVIDER_AUTH', false, status);
  }

  if (status === 408 || status >= 500) {
    return new InferenceError('PROVIDER_UNAVAILABLE', true, status, retryAfterMs);
  }

  return new InferenceError('PROVIDER_INPUT', false, status);
}

function retryAfter(value: string | null, now: number): number | null {
  if (value === null) {
    return null;
  }

  const ms = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;

  return Number.isFinite(ms) ? Math.max(0, ms) : null;
}

async function readJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (response.body === null) {
    throw new InferenceError('INVALID_RESPONSE');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined);
  };

  signal.addEventListener('abort', cancel, { once: true });

  if (signal.aborted) {
    cancel();
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      length += value.byteLength;

      if (length > maxBytes) {
        throw new InferenceError('INVALID_RESPONSE');
      }

      chunks.push(value);
    }

    const body = Buffer.concat(chunks).toString('utf8');

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new InferenceError('INVALID_RESPONSE');
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    // Do not let an uncooperative stream hold up cancellation or the caller's deadline.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function createHfInference(config: HfConfig, dependencies: HfDependencies): HfInference {
  // Snapshot caller config so concurrent modes cannot mutate the pinned profile or limits.
  const validated = readHfConfig({
    HF_INFERENCE_ENABLED: 'true',
    HF_TOKEN: config.token,
    RETRIEVAL_PROFILE: config.profile,
    HF_EMBEDDING_BATCH_SIZE: String(config.embeddingBatchSize),
    HF_RERANKER_BATCH_SIZE: String(config.rerankerBatchSize),
    HF_MAX_CONCURRENCY: String(config.maxConcurrency),
    HF_MAX_ITEMS: String(config.maxItems),
    HF_MAX_TEXT_CHARS: String(config.maxTextChars),
    HF_TIMEOUT_MS: String(config.timeoutMs),
    HF_MAX_RESPONSE_BYTES: String(config.maxResponseBytes),
  });

  if (!validated) {
    throw new InferenceError('INVALID_INPUT');
  }

  const settings = validated;
  const configuration = Object.freeze({
    profile: settings.profile,
    embeddingBatchSize: settings.embeddingBatchSize,
    rerankerBatchSize: settings.rerankerBatchSize,
    maxConcurrency: settings.maxConcurrency,
    maxItems: settings.maxItems,
    maxTextChars: settings.maxTextChars,
    timeoutMs: settings.timeoutMs,
    maxResponseBytes: settings.maxResponseBytes,
  });
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const clock = dependencies.clock ?? systemClock;
  const lifetime = new AbortController();
  let active = 0;
  let lastAttempt: InferenceAttempt | null = null;

  function remaining(context: CallContext): number {
    if (context.signal.aborted || lifetime.signal.aborted) {
      throw new InferenceError('CANCELLED');
    }

    const ms = Date.parse(context.deadlineAt) - clock.now().getTime();

    if (!Number.isFinite(ms) || ms <= 0) {
      throw new InferenceError('DEADLINE_EXCEEDED');
    }

    return ms;
  }

  function validateText(text: string): void {
    if (typeof text !== 'string' || !text.trim() || text.length > settings.maxTextChars) {
      throw new InferenceError('INVALID_INPUT');
    }
  }

  function validateCount(count: number): void {
    if (count < 1 || count > settings.maxItems) {
      throw new InferenceError('INVALID_INPUT');
    }
  }

  async function request<T>(
    operation: InferenceAttempt['operation'],
    purpose: InferenceAttempt['purpose'],
    itemCount: number,
    payload: unknown,
    parse: (value: unknown) => T,
    context: CallContext,
    deadline: number,
  ): Promise<T> {
    const budget = Math.min(remaining(context), settings.timeoutMs, deadline - clock.monotonicMs());

    if (budget <= 0) {
      throw new InferenceError('DEADLINE_EXCEEDED');
    }

    // No unbounded queue: the caller owns scheduling and retry after local admission failure.
    if (active >= settings.maxConcurrency) {
      throw new InferenceError('CAPACITY_LIMIT', true);
    }

    active++;

    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, lifetime.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(), budget);
    const started = clock.monotonicMs();
    const timestamp = clock.now().toISOString();
    const attemptId = randomUUID();
    let status: number | null = null;
    let providerRequestId: string | null = null;
    let responseReceived = false;
    let failure: InferenceError | null = null;
    let value: T | undefined;

    const cancelled = (): InferenceError =>
      new InferenceError(
        context.signal.aborted || lifetime.signal.aborted ? 'CANCELLED' : 'DEADLINE_EXCEEDED',
      );

    // Keep the concurrency slot until the actual transport settles, even if it ignores abort.
    const work = (async (): Promise<T> => {
      try {
        const response = await fetch(
          operation === 'embedding' ? HF_IDENTITY.embeddingEndpoint : HF_IDENTITY.rerankerEndpoint,
          {
            method: 'POST',
            redirect: 'error',
            headers: {
              authorization: `Bearer ${settings.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal,
          },
        );

        status = response.status;
        providerRequestId = response.headers.get('x-request-id');

        if (!response.ok) {
          responseReceived = true;
          void response.body?.cancel().catch(() => undefined);

          throw httpError(
            status,
            retryAfter(response.headers.get('retry-after'), clock.now().getTime()),
          );
        }

        const body = await readJson(response, settings.maxResponseBytes, signal);

        responseReceived = true;

        try {
          return parse(body);
        } catch {
          throw new InferenceError('INVALID_RESPONSE');
        }
      } finally {
        active--;
      }
    })();

    let onAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(cancelled());
      signal.addEventListener('abort', onAbort, { once: true });

      if (signal.aborted) {
        onAbort();
      }
    });

    try {
      value = await Promise.race([work, aborted]);
    } catch (error: unknown) {
      failure = signal.aborted
        ? cancelled()
        : error instanceof InferenceError
          ? error
          : new InferenceError('PROVIDER_UNAVAILABLE', true, status);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      controller.abort();
    }

    const attempt: InferenceAttempt = Object.freeze({
      attemptId,
      executionId: context.executionId,
      operation,
      purpose,
      itemCount,
      identity: HF_IDENTITY,
      configuration,
      profile: settings.profile,
      timestamp,
      durationMs: Math.max(0, clock.monotonicMs() - started),
      httpStatus: status,
      providerRequestId,
      errorCode: failure?.code ?? null,
      retryAfterMs: failure?.retryAfterMs ?? null,
      remoteOutcome: responseReceived ? 'response_received' : 'unknown',
      usage: null,
      costUsd: null,
    });

    lastAttempt = attempt;

    const observerController = new AbortController();
    const observerBudget = Math.max(
      1,
      Math.min(settings.timeoutMs, deadline - clock.monotonicMs()),
    );
    let observerTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        dependencies.onAttempt(attempt, observerController.signal),
        new Promise<never>((_resolve, reject) => {
          observerTimer = setTimeout(() => {
            observerController.abort();
            reject(new InferenceError('ATTEMPT_OBSERVER_FAILED'));
          }, observerBudget);
        }),
      ]);
    } catch {
      throw new InferenceError('ATTEMPT_OBSERVER_FAILED');
    } finally {
      clearTimeout(observerTimer);
      observerController.abort();
    }

    if (failure) {
      throw failure;
    }

    remaining(context);

    if (clock.monotonicMs() >= deadline) {
      throw new InferenceError('DEADLINE_EXCEEDED');
    }

    // T may itself include undefined; successful parsing, rather than a truthiness check, owns validity.
    return value as T;
  }

  const embedding: EmbeddingPort = {
    async embed(texts, purpose, context) {
      const deadline = clock.monotonicMs() + remaining(context);
      validateCount(texts.length);

      const inputs = Array.from(texts);

      inputs.forEach(validateText);

      if (settings.profile === 'HYBRID') {
        throw new InferenceError('CAPABILITY_UNAVAILABLE');
      }

      const results = [];

      for (let offset = 0; offset < inputs.length; offset += settings.embeddingBatchSize) {
        const batch = inputs.slice(offset, offset + settings.embeddingBatchSize);
        const vectors = await request(
          'embedding',
          purpose,
          batch.length,
          { inputs: batch, normalize: true, truncate: false },
          (value) => parseHfEmbeddings(value, batch.length),
          context,
          deadline,
        );

        results.push(...vectors);
      }

      return results;
    },
  };

  const reranker: RerankerPort = {
    async rerank(query, candidates, context) {
      const deadline = clock.monotonicMs() + remaining(context);
      validateCount(candidates.length);

      const inputs = Array.from(candidates, (candidate) => ({ ...candidate }));

      validateText(query);
      inputs.forEach((candidate) => validateText(candidate.text));

      const ids = inputs.map((candidate) => candidate.chunkId);

      if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
        throw new InferenceError('INVALID_INPUT');
      }

      const results: { chunkId: string; score: number; scoreType: string }[] = [];

      for (let offset = 0; offset < inputs.length; offset += settings.rerankerBatchSize) {
        const batch: readonly Evidence[] = inputs.slice(
          offset,
          offset + settings.rerankerBatchSize,
        );
        const scores = await request(
          'rerank',
          'rerank',
          batch.length,
          {
            inputs: {
              inputs: batch.map((candidate) => ({ text: query, text_pair: candidate.text })),
            },
            parameters: { function_to_apply: 'none' },
          },
          (value) => parseHfScores(value, batch.length),
          context,
          deadline,
        );

        scores.forEach((score, index) => {
          const candidate = batch[index];

          if (candidate) {
            results.push({
              chunkId: candidate.chunkId,
              score,
              scoreType: 'hf_none_raw_logit_unverified',
            });
          }
        });
      }

      // Stable ties retain the original input order. Scores are not calibrated probabilities.
      return results.sort((a, b) => b.score - a.score);
    },
  };

  return {
    embedding,
    reranker,
    capabilities: () => ({
      profile: settings.profile,
      capable: settings.profile === 'DENSE',
      evidence: 'INF-01_SMOKE_NOT_LIVE_HEALTH',
      sparse: 'unverified',
      identity: HF_IDENTITY,
      configuration,
      lastAttempt,
    }),
    close: () => lifetime.abort(),
  };
}
