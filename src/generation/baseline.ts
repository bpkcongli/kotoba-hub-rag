import { GenerationError } from '@/adapters/openai-responses';
import { systemClock } from '@/adapters/system-clock';
import { createContractValidators, validateRequest } from '@/contracts/validator';
import type { Operation, Responses } from '@/contracts/validator';
import type { createOperationGenerator } from '@/generation/generator';
import { validPayload } from '@/generation/schema';
import { ObservationError } from '@/observability/store';
import type { ObservationStore } from '@/observability/store';
import type { Clock } from '@/shared/ports';

export function createBaselineRunner(
  generate: ReturnType<typeof createOperationGenerator>,
  observations: ObservationStore,
  clock: Clock = systemClock,
) {
  const validators = createContractValidators();
  const running = new Set<string>();

  // Admission/auth/corpus eligibility belong to caller (API-01); registry identity is enforced here.
  return async <K extends Operation>(
    operation: K,
    input: unknown,
    executionId: string,
    signal: AbortSignal,
  ): Promise<Responses[K]> => {
    const started = clock.monotonicMs();
    const admitted = validateRequest(validators, operation, input, clock.now().getTime());

    if (!admitted.ok) {
      throw new GenerationError(admitted.code);
    }

    const request = structuredClone(admitted.request);

    if (request.mode !== 'LLM_ONLY' || !validPayload(operation, request)) {
      throw new GenerationError('INVALID_INPUT');
    }

    const experiment =
      request.experiment === undefined
        ? undefined
        : {
            experimentId: request.experiment.experiment_id,
            caseId: request.experiment.case_id,
            repetition: request.experiment.repetition,
          };
    const correlation = observations.assertAdmittedRequest(executionId, {
      requestId: request.request_id,
      operation,
      mode: request.mode,
      request,
      ...(experiment === undefined ? {} : { experiment }),
    });

    if (running.has(executionId)) {
      throw new GenerationError('IDEMPOTENCY_CONFLICT');
    }

    running.add(executionId);

    const remainingMs = Math.max(1, admitted.remainingMs - (clock.monotonicMs() - started));
    const deadlineAt = new Date(
      Math.min(Date.parse(request.deadline_at), clock.now().getTime() + remainingMs),
    ).toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    const totalSignal = AbortSignal.any([signal, controller.signal]);
    let span = observations.startSpan(executionId, 'generation');
    let spanOpen = true;

    try {
      // No embedding/retriever/reranker port: baseline cannot invoke semantic search.
      const result = await generate(operation, request, [], {
        executionId,
        signal: totalSignal,
        deadlineAt,
      });
      spanOpen = false;
      await span.finish('SUCCESS', null);
      span = observations.startSpan(executionId, 'validation');
      spanOpen = true;
      const calls = await observations.executionAccounting(executionId);

      if (
        calls.length !== 1 ||
        calls[0]?.purpose !== operation ||
        calls[0].phase !== 'ONLINE' ||
        calls[0].retryKind !== 'INITIAL'
      ) {
        throw new GenerationError('POST_VALIDATION_FAILED');
      }

      const costs = calls.map((call) => call.cost);
      const knownSubtotal = costs.reduce(
        (sum, cost) => sum + (cost.kind === 'PER_CALL' ? Number(cost.knownSubtotalUsd) : 0),
        0,
      );
      const known =
        costs.length === 1 &&
        costs.every((cost) => cost.kind === 'PER_CALL' && cost.totalUsd !== null);
      const total = known ? knownSubtotal : null;
      const usage = result.usage;
      const usageKnown =
        usage !== null &&
        [usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, usage.totalTokens].every(
          (value) => value !== null,
        );
      const response: unknown = {
        schema_version: '1',
        request_id: request.request_id,
        execution_id: executionId,
        mode: 'LLM_ONLY',
        data: result.data,
        meta: {
          trace_id: correlation.traceId,
          corpus_version: request.corpus_version,
          path: 'LLM_ONLY',
          sources: [],
          duration_ms: Math.max(0, clock.monotonicMs() - started),
          usage: {
            input_tokens: usageKnown ? usage?.inputTokens : null,
            cached_input_tokens: usageKnown ? usage?.cachedInputTokens : null,
            output_tokens: usageKnown ? usage?.outputTokens : null,
            total_tokens: usageKnown ? usage?.totalTokens : null,
          },
          cost: {
            currency: 'USD',
            inference_total_usd: total,
            query_embedding_usd: 0,
            rerank_usd: 0,
            total_online_usd: total,
            known_subtotal_usd: knownSubtotal,
            status: known ? 'KNOWN' : knownSubtotal > 0 ? 'PARTIAL' : 'UNKNOWN',
          },
          counters: {
            retrieval_stage_count: 0,
            rewrite_call_count: 0,
            rerank_call_count: 0,
            provider_retry_count: 0,
            schema_retry_count: 0,
            model_call_count: calls.length,
          },
        },
      };

      if (!validators.responses[operation](response)) {
        throw new GenerationError('POST_VALIDATION_FAILED');
      }

      if (totalSignal.aborted || clock.monotonicMs() - started >= admitted.remainingMs) {
        throw new GenerationError('TIMEOUT');
      }

      spanOpen = false;
      await span.finish('SUCCESS', null);
      await observations.finish(executionId, 'SUCCESS', null);
      return response;
    } catch (error) {
      const failure =
        error instanceof GenerationError
          ? error
          : new GenerationError(
              error instanceof ObservationError && error.code === 'TRACE_WRITE_FAILED'
                ? 'TRACE_WRITE_FAILED'
                : 'INTERNAL_ERROR',
            );

      if (failure.code === 'TRACE_WRITE_FAILED') {
        await observations.failExecutionTrace(executionId).catch(() => undefined);
        throw failure;
      }

      observations.assertActive(executionId);

      if (spanOpen) {
        await span.finish(failure.code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED', failure.code);
      }

      await observations.finish(
        executionId,
        failure.code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED',
        failure.code,
      );

      throw failure;
    } finally {
      clearTimeout(timer);
      running.delete(executionId);
    }
  };
}
