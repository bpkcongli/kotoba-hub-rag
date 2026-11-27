import { createHash, randomUUID } from 'node:crypto';
import type { CallContext } from '@/modules/execution/application/public';
import type { TokenUsage } from '@/modules/observability/application/public';
import { normalizeResponseUsage } from '@/modules/observability/application/public';
import type { GeneratorPort } from '@/modules/rag/application/ports/inference';
import type { OpenAiConfig } from '@/modules/rag/infrastructure/config/openai-config';
import {
  OPENAI_ENDPOINT,
  readOpenAiConfig,
} from '@/modules/rag/infrastructure/config/openai-config';
import { readProviderJson } from '@/modules/rag/interface/secondary/inference/provider-json';
import type { Clock } from '@/shared/clock';
import type { TraceCode } from '@/shared/errors/failure-code';
import { GenerationError } from '@/shared/errors/generation-error';
import { systemClock } from '@/shared/system-clock';

export interface GenerationAttempt {
  readonly attemptId: string;

  readonly executionId: string;

  readonly operation: Parameters<GeneratorPort['generate']>[0]['operation'];

  readonly model: string;

  readonly timestamp: string;

  readonly durationMs: number;

  readonly httpStatus: number | null;

  readonly providerRequestId: string | null;

  readonly servedModel: string | null;

  readonly billingProfile: 'standard-text-default-cache' | 'unverified-openai-text';

  readonly usage: TokenUsage | null;

  readonly errorCode: TraceCode | null;

  readonly retryAfterMs: number | null;

  readonly remoteOutcome: 'response_received' | 'unknown';

  readonly accountingContext: NonNullable<CallContext['accounting']>;

  readonly configuration: Readonly<Omit<OpenAiConfig, 'apiKey'>>;

  readonly promptHash: string;

  readonly schemaHash: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readOpenAiUsage(value: unknown): TokenUsage | null {
  try {
    return normalizeResponseUsage(value);
  } catch {
    return null;
  }
}

export interface OpenAiGenerator extends GeneratorPort {
  close(): void;
}

export function createOpenAiGenerator(
  config: OpenAiConfig,
  dependencies: {
    readonly onAttempt: (attempt: GenerationAttempt) => Promise<void>;
    readonly fetch?: typeof globalThis.fetch;
    readonly clock?: Clock;
  },
): OpenAiGenerator {
  const settings = readOpenAiConfig({
    OPENAI_ENABLED: 'true',
    OPENAI_API_KEY: config.apiKey,
    OPENAI_GENERATION_MODEL: config.generationModel,
    OPENAI_NORMALIZATION_MODEL: config.normalizationModel,
    OPENAI_TIMEOUT_MS: String(config.timeoutMs),
    OPENAI_MAX_OUTPUT_TOKENS: String(config.maxOutputTokens),
    OPENAI_MAX_INPUT_CHARS: String(config.maxInputChars),
    OPENAI_MAX_RESPONSE_BYTES: String(config.maxResponseBytes),
    OPENAI_MAX_CONCURRENCY: String(config.maxConcurrency),
  });

  if (settings === null) {
    throw new GenerationError('DEPENDENCY_NOT_READY');
  }

  const { apiKey, ...configuration } = settings;
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const clock = dependencies.clock ?? systemClock;
  const lifetime = new AbortController();
  let active = 0;

  const generateAttempt: GeneratorPort['generate'] = async (input, context) => {
    input = structuredClone(input);
    context = {
      executionId: context.executionId,
      deadlineAt: context.deadlineAt,
      signal: context.signal,
      ...(context.control === undefined ? {} : { control: context.control }),
      ...(context.accounting === undefined ? {} : { accounting: { ...context.accounting } }),
    };
    const expectedModel =
      input.operation === 'normalize' ? settings.normalizationModel : settings.generationModel;
    const phase = context.accounting?.phase ?? 'ONLINE';
    const retryKind = context.accounting?.retryKind ?? 'INITIAL';
    const remainingMs = Date.parse(context.deadlineAt) - clock.now().getTime();
    const budget = Math.min(settings.timeoutMs, remainingMs);

    if (
      context.signal.aborted ||
      lifetime.signal.aborted ||
      !Number.isFinite(budget) ||
      budget <= 0
    ) {
      throw new GenerationError('TIMEOUT');
    }

    if (
      input.model !== expectedModel ||
      input.instructions.length + input.input.length > settings.maxInputChars ||
      !input.input.trim() ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(input.schemaName) ||
      !['ONLINE', 'WARMUP'].includes(phase) ||
      !['INITIAL', 'PROVIDER_RETRY', 'SCHEMA_RETRY'].includes(retryKind)
    ) {
      throw new GenerationError('INVALID_INPUT');
    }

    if (active >= settings.maxConcurrency) {
      throw new GenerationError('CAPACITY_LIMIT');
    }

    // One HTTP call per attempt, no SDK/transport retry, model routing or redirects.
    const body = JSON.stringify({
      model: input.model,
      store: false,
      instructions: input.instructions,
      input: input.input,
      max_output_tokens: settings.maxOutputTokens,
      service_tier: 'default',
      truncation: 'disabled',
      text: {
        format: {
          type: 'json_schema',
          name: input.schemaName,
          strict: true,
          schema: input.jsonSchema,
        },
      },
    });
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, lifetime.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(), budget);
    const started = clock.monotonicMs();
    const timestamp = clock.now().toISOString();
    let httpStatus: number | null = null;
    let providerRequestId: string | null = null;
    let servedModel: string | null = null;
    let billingProfile: GenerationAttempt['billingProfile'] = 'unverified-openai-text';
    let usage: TokenUsage | null = null;
    let received = false;
    let failure: GenerationError | null = null;
    let outputText = '';
    active++;

    const work = (async (): Promise<void> => {
      try {
        const response = await fetcher(OPENAI_ENDPOINT, {
          method: 'POST',
          redirect: 'error',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body,
          signal,
        });
        httpStatus = response.status;
        providerRequestId = response.headers.get('x-request-id')?.slice(0, 200) ?? null;

        if (!response.ok) {
          received = true;
          void response.body?.cancel().catch(() => undefined);
          const after = response.headers.get('retry-after');
          const delay =
            after === null
              ? NaN
              : /^\d+(\.\d+)?$/.test(after)
                ? Number(after) * 1000
                : Date.parse(after) - clock.now().getTime();

          throw new GenerationError(
            response.status === 429 || response.status === 408 || response.status >= 500
              ? 'PROVIDER_FAILED'
              : 'PROVIDER_REJECTED',
            Number.isFinite(delay) ? Math.max(0, delay) : null,
            response.status,
          );
        }

        const result = await readProviderJson(response, settings.maxResponseBytes, signal);
        received = true;

        if (!record(result)) {
          throw new GenerationError('PROVIDER_FAILED');
        }

        usage = readOpenAiUsage(result.usage);
        servedModel =
          typeof result.model === 'string' && /^[A-Za-z0-9_.:/-]{1,200}$/.test(result.model)
            ? result.model
            : null;

        if (
          servedModel !== null &&
          servedModel !== input.model &&
          !servedModel.startsWith(`${input.model}-`)
        ) {
          throw new GenerationError('PROVIDER_REJECTED');
        }

        if (result.service_tier === 'default' && servedModel !== null) {
          billingProfile = 'standard-text-default-cache';
        }

        const parts = Array.isArray(result.output)
          ? result.output.flatMap((item: unknown): unknown[] =>
              record(item) && item.type === 'message' && Array.isArray(item.content)
                ? item.content
                : [],
            )
          : [];

        if (parts.some((part) => record(part) && part.type === 'refusal')) {
          throw new GenerationError('PROVIDER_REFUSED');
        }

        if (result.status !== 'completed') {
          throw new GenerationError('PROVIDER_FAILED');
        }

        const texts = parts.filter(
          (part): part is Record<string, unknown> => record(part) && part.type === 'output_text',
        );

        const text = texts[0]?.text;
        if (texts.length !== 1 || typeof text !== 'string') {
          throw new GenerationError('SCHEMA_PARSE_FAILED');
        }

        outputText = text;
      } finally {
        active--;
      }
    })();

    let onAbort = (): void => undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new GenerationError('TIMEOUT'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
      }
    });

    try {
      await Promise.race([work, aborted]);
    } catch (error) {
      failure = signal.aborted
        ? new GenerationError('TIMEOUT')
        : error instanceof GenerationError
          ? error
          : new GenerationError('PROVIDER_FAILED');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      controller.abort();
    }

    // Copy before notifying: an uncooperative transport may settle after cancellation.
    const attempt: GenerationAttempt = structuredClone({
      attemptId: randomUUID(),
      executionId: context.executionId,
      operation: input.operation,
      model: input.model,
      timestamp,
      durationMs: Math.max(0, clock.monotonicMs() - started),
      httpStatus,
      providerRequestId,
      servedModel,
      billingProfile,
      usage,
      errorCode: failure?.code ?? null,
      retryAfterMs: failure?.retryAfterMs ?? null,
      remoteOutcome: received ? 'response_received' : 'unknown',
      accountingContext: { phase, retryKind },
      configuration,
      promptHash: createHash('sha256').update(input.instructions).digest('hex'),
      schemaHash: createHash('sha256').update(JSON.stringify(input.jsonSchema)).digest('hex'),
    });
    let observerTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        dependencies.onAttempt(attempt),
        new Promise<never>((_resolve, reject) => {
          observerTimer = setTimeout(
            () => reject(new GenerationError('TRACE_WRITE_FAILED')),
            Math.max(
              context.control?.traceGraceMs ?? 1,
              remainingMs - (clock.monotonicMs() - started),
            ),
          );
        }),
      ]);
    } catch {
      throw new GenerationError('TRACE_WRITE_FAILED');
    } finally {
      clearTimeout(observerTimer);
    }

    if (failure !== null) {
      throw failure;
    }

    if (
      (signal.aborted && (context.signal.aborted || lifetime.signal.aborted)) ||
      clock.monotonicMs() - started >= budget
    ) {
      throw new GenerationError('TIMEOUT');
    }

    return { outputText, providerRequestId, usage };
  };

  return {
    close: () => lifetime.abort(),
    generate: (input, context) => {
      input = structuredClone(input);
      context = {
        executionId: context.executionId,
        signal: context.signal,
        deadlineAt: context.deadlineAt,
        ...(context.control === undefined ? {} : { control: context.control }),
        ...(context.accounting === undefined ? {} : { accounting: { ...context.accounting } }),
      };

      return context.control
        ? context.control.provider(input.operation, context, (attemptContext) =>
            generateAttempt(input, attemptContext),
          )
        : generateAttempt(input, context);
    },
  };
}
