import { setTimeout as delay } from 'node:timers/promises';
import type { ExecutionPolicy } from '@/modules/execution/application/execution-policy';
import { parseExecutionPolicy } from '@/modules/execution/application/execution-policy';
import type {
  CallContext,
  ExecutionControl,
} from '@/modules/execution/application/ports/call-context';
import type { RetryAuditPort } from '@/modules/execution/application/ports/retry-audit';
import type { RetryTrace } from '@/modules/observability/application/public';
import type { Clock } from '@/shared/clock';
import { GenerationError } from '@/shared/errors/generation-error';
import { InferenceError } from '@/shared/errors/inference-error';
import type { Mode, Operation } from '@/shared/operations';

export interface Scheduling {
  readonly random: () => number;

  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
}
const scheduling: Scheduling = {
  random: Math.random,
  wait: async (ms, signal) => {
    await delay(ms, undefined, { signal });
  },
};

export function createExecutionControl(
  policy: ExecutionPolicy,
  mode: Mode,
  operation: Operation,
  executionId: string,
  clock: Clock,
  observations: RetryAuditPort,
  started: number,
  startedAt: number,
  callerSignal: AbortSignal,
  scheduler: Scheduling = scheduling,
) {
  policy = parseExecutionPolicy(policy);
  const controller = new AbortController();
  const signal = AbortSignal.any([callerSignal, controller.signal]);
  let budget = Infinity;
  let deadlineAt = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let calls = 0;
  let providerRetries = 0;
  let schemaRetries = 0;
  let rewrites = 0;

  const expired = (): boolean => signal.aborted || clock.monotonicMs() - started >= budget;
  const check = (): void => {
    if (expired()) {
      throw new GenerationError('TIMEOUT');
    }
  };
  const permit = (purpose: string): void => {
    if (
      purpose === operation ||
      (mode !== 'LLM_ONLY' && purpose === 'query') ||
      (mode === 'ADAPTIVE' && ['rewrite', 'rerank'].includes(purpose))
    ) {
      return;
    }

    throw new GenerationError('INVALID_INPUT');
  };
  const schedule = async (
    kind: RetryTrace['retryKind'],
    purpose: RetryTrace['purpose'],
    reason: RetryTrace['reason'],
    retryAfter: number | null,
  ): Promise<boolean> => {
    check();
    const used = providerRetries + schemaRetries;

    if (
      used >= policy.maxTotalRetries ||
      (kind === 'PROVIDER_RETRY'
        ? providerRetries >= policy.maxProviderRetries
        : schemaRetries >= policy.maxSchemaRetries) ||
      calls >= policy.maxModelCalls
    ) {
      return false;
    }

    const jitter = scheduler.random();

    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
      throw new GenerationError('INTERNAL_ERROR');
    }

    const backoff = Math.min(policy.backoffMaxMs, policy.backoffBaseMs * 2 ** used) * jitter;
    const delayMs = Math.max(backoff, retryAfter ?? 0);
    const remaining = budget - (clock.monotonicMs() - started);

    if (delayMs >= remaining) {
      return false;
    }

    if (kind === 'PROVIDER_RETRY') {
      providerRetries++;
    } else {
      schemaRetries++;
    }

    await observations.record(
      executionId,
      {
        kind: 'retry_scheduled',
        version: 'adp-03-v1',
        retryKind: kind,
        purpose,
        ordinal: used + 1,
        delayMs,
        reason,
      },
      Math.max(0, clock.monotonicMs() - started),
    );

    check();

    try {
      if (delayMs > 0) {
        await scheduler.wait(delayMs, signal);
      }
    } catch (error) {
      check();
      throw error;
    }

    check();
    return true;
  };

  const control: ExecutionControl = {
    traceGraceMs: policy.traceGraceMs,
    check,
    async provider(purpose, context, attempt) {
      if (context.executionId !== executionId || !deadlineAt) {
        throw new GenerationError('INVALID_INPUT');
      }

      context = {
        ...context,
        signal: AbortSignal.any([signal, context.signal]),
        deadlineAt: new Date(
          Math.min(Date.parse(deadlineAt), Date.parse(context.deadlineAt)),
        ).toISOString(),
      };
      permit(purpose);
      let current = context;

      for (;;) {
        check();

        if (calls >= policy.maxModelCalls || (purpose === 'rewrite' && rewrites >= 1)) {
          throw new GenerationError('CAPACITY_LIMIT');
        }

        calls++;
        if (purpose === 'rewrite') {
          rewrites++;
        }

        try {
          const value = await attempt(current);
          check();
          return value;
        } catch (error) {
          const status =
            error instanceof InferenceError || error instanceof GenerationError
              ? error.httpStatus
              : null;
          const eligible =
            error instanceof InferenceError
              ? ['RATE_LIMITED', 'PROVIDER_UNAVAILABLE'].includes(error.code)
              : error instanceof GenerationError && error.code === 'PROVIDER_FAILED';
          const reason =
            status === 408
              ? 'HTTP_408'
              : status === 429
                ? 'HTTP_429'
                : status !== null && status >= 500
                  ? 'HTTP_5XX'
                  : null;

          if (
            !eligible ||
            reason === null ||
            purpose === 'rewrite' ||
            purpose === 'document' ||
            purpose === 'repair' ||
            purpose === 'judge' ||
            !(await schedule(
              'PROVIDER_RETRY',
              purpose,
              reason,
              error instanceof InferenceError || error instanceof GenerationError
                ? error.retryAfterMs
                : null,
            ))
          ) {
            throw error;
          }

          current = { ...context, accounting: { phase: 'ONLINE', retryKind: 'PROVIDER_RETRY' } };
        }
      }
    },
    async schema(context, attempt) {
      if (context.executionId !== executionId || !deadlineAt) {
        throw new GenerationError('INVALID_INPUT');
      }

      let current = context;

      for (;;) {
        check();

        try {
          const value = await attempt(current);
          check();
          return value;
        } catch (error) {
          if (
            !(error instanceof GenerationError) ||
            (error.code !== 'SCHEMA_PARSE_FAILED' && error.code !== 'POST_VALIDATION_FAILED') ||
            !(await schedule('SCHEMA_RETRY', operation, error.code, null))
          ) {
            throw error;
          }

          current = { ...context, accounting: { phase: 'ONLINE', retryKind: 'SCHEMA_RETRY' } };
        }
      }
    },
  };

  return {
    control,
    expired,
    check,
    start(timeoutMs: number, absoluteDeadline: string): CallContext {
      if (deadlineAt) {
        throw new GenerationError('INVALID_INPUT');
      }

      budget = Math.min(timeoutMs, Date.parse(absoluteDeadline) - startedAt, 120000);
      check();
      const remaining = budget - (clock.monotonicMs() - started);
      timer = setTimeout(() => controller.abort(), Math.max(1, remaining));
      deadlineAt = new Date(
        Math.min(startedAt + budget, clock.now().getTime() + remaining),
      ).toISOString();

      return {
        executionId,
        signal,
        deadlineAt,
        control,
        accounting: { phase: 'ONLINE', retryKind: 'INITIAL' },
      };
    },
    get budgetMs(): number {
      return budget;
    },
    close(): void {
      clearTimeout(timer);
      controller.abort();
    },
  };
}
