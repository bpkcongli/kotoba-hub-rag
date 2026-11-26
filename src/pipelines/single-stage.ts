import { InferenceError } from '@/adapters/hf-inference';
import { GenerationError } from '@/adapters/openai-responses';
import { systemClock } from '@/adapters/system-clock';
import type { createContextBuilder } from '@/context/observed-builder';
import { ContextError } from '@/context/types';
import { createContractValidators, validateRequest } from '@/contracts/validator';
import type { Operation, Responses } from '@/contracts/validator';
import type { createOperationGenerator } from '@/generation/generator';
import { validPayload, validateOutput } from '@/generation/schema';
import { ObservationError } from '@/observability/store';
import type { ObservationStore } from '@/observability/store';
import { assessEvidence, readEvidencePolicy } from '@/pipelines/evidence';
import type { EvidencePolicy } from '@/pipelines/evidence';
import { singleStageMetadata } from '@/pipelines/metadata';
import { retrievalPlan } from '@/pipelines/retrieval-plan';
import type { createRetrievalStage } from '@/retrieval/stage';
import { RetrievalError } from '@/retrieval/types';
import type { CallContext, Clock } from '@/shared/ports';
import type { IndexManifest } from '@/storage/index-manifest';

function pipelineFailure(error: unknown, timedOut: boolean): GenerationError {
  if (
    (error instanceof ObservationError && error.code === 'TRACE_WRITE_FAILED') ||
    (error instanceof InferenceError && error.code === 'ATTEMPT_OBSERVER_FAILED')
  ) {
    return new GenerationError('TRACE_WRITE_FAILED');
  }

  if (timedOut) {
    return new GenerationError('TIMEOUT');
  }

  if (error instanceof GenerationError) {
    return error;
  }

  if (error instanceof ContextError) {
    return new GenerationError(error.code);
  }

  if (error instanceof InferenceError) {
    const code = ['CANCELLED', 'DEADLINE_EXCEEDED'].includes(error.code)
      ? 'TIMEOUT'
      : error.code === 'CAPACITY_LIMIT'
        ? 'CAPACITY_LIMIT'
        : 'INFERENCE_FAILED';
    return new GenerationError(code, error.retryAfterMs);
  }

  if (error instanceof RetrievalError) {
    const code =
      error.code === 'TIMEOUT'
        ? 'TIMEOUT'
        : error.code === 'CAPACITY_LIMIT'
          ? 'CAPACITY_LIMIT'
          : 'RETRIEVAL_FAILED';
    return new GenerationError(code);
  }

  return new GenerationError('INTERNAL_ERROR');
}

export function createSingleStageRunner(
  index: IndexManifest,
  retrieve: ReturnType<typeof createRetrievalStage>,
  buildContext: ReturnType<typeof createContextBuilder>,
  generate: ReturnType<typeof createOperationGenerator>,
  observations: ObservationStore,
  policy: EvidencePolicy = readEvidencePolicy(),
  clock: Clock = systemClock,
) {
  index = structuredClone(index);
  policy = structuredClone(policy);

  if (policy.version !== 'rag-03-evidence-v1') {
    throw new GenerationError('INVALID_INPUT');
  }

  readEvidencePolicy({
    RAG_MIN_UNIQUE_CHUNKS: String(policy.minUniqueChunks),
    RAG_MIN_COVERED_SKILLS: String(policy.minCoveredSkills),
  });

  const validators = createContractValidators();
  const running = new Set<string>();

  // API-01 owns auth/admission/replay. Once fingerprint-bound, this runner owns terminal closure.
  return async <K extends Operation>(
    operation: K,
    input: unknown,
    executionId: string,
    signal: AbortSignal,
  ): Promise<Responses[K]> => {
    const started = clock.monotonicMs();
    const startedAt = clock.now().getTime();
    const correlation = observations.activeCorrelation(executionId);

    if (correlation.requestId === null) {
      throw new GenerationError('INVALID_INPUT');
    }

    observations.assertAdmittedRequest(executionId, {
      requestId: correlation.requestId,
      operation,
      mode: correlation.mode ?? 'SINGLE_STAGE',
      request: input,
      experiment: correlation.experiment,
    });

    if (running.has(executionId)) {
      throw new GenerationError('IDEMPOTENCY_CONFLICT');
    }

    running.add(executionId);
    const controller = new AbortController();
    const totalSignal = AbortSignal.any([signal, controller.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remainingMs = Infinity;
    let span: ReturnType<ObservationStore['startSpan']> | null = null;
    const expired = (): boolean =>
      totalSignal.aborted || clock.monotonicMs() - started >= remainingMs;
    const checkDeadline = (): void => {
      if (expired()) {
        throw new GenerationError('TIMEOUT');
      }
    };
    const finishSpan = async (): Promise<void> => {
      const current = span;
      span = null;
      await current?.finish('SUCCESS', null);
    };

    try {
      span = observations.startSpan(executionId, 'validation');
      const admitted = validateRequest(validators, operation, input, clock.now().getTime());

      if (!admitted.ok) {
        throw new GenerationError(admitted.code);
      }

      const request = structuredClone(admitted.request);

      if (request.mode !== 'SINGLE_STAGE' || !validPayload(operation, request)) {
        throw new GenerationError('INVALID_INPUT');
      }

      if (request.corpus_version !== index.corpusVersion) {
        throw new GenerationError('SNAPSHOT_MISMATCH');
      }

      remainingMs = Math.min(request.timeout_ms, Date.parse(request.deadline_at) - startedAt);
      checkDeadline();
      timer = setTimeout(
        () => controller.abort(),
        Math.max(1, remainingMs - (clock.monotonicMs() - started)),
      );
      const deadlineAt = new Date(
        Math.min(
          Date.parse(request.deadline_at),
          clock.now().getTime() + Math.max(0, remainingMs - (clock.monotonicMs() - started)),
        ),
      ).toISOString();
      const context: CallContext = {
        executionId,
        signal: totalSignal,
        deadlineAt,
        accounting: { phase: 'ONLINE', retryKind: 'INITIAL' },
      };
      const plan = retrievalPlan(operation, request);
      await finishSpan();
      checkDeadline();

      // Exactly one round; no router, rewrite or reranker dependency is available to this runner.
      const retrieved = await retrieve(plan.query, plan.filter, 1, context);
      checkDeadline();

      span = observations.startSpan(executionId, 'context');
      const built = await buildContext(
        operation,
        request,
        retrieved.candidates,
        plan.targetSkillCodes,
        context,
      );
      checkDeadline();
      const assessment = assessEvidence(policy, retrieved.candidates.length, built);
      await observations.record(
        executionId,
        assessment,
        Math.max(0, clock.monotonicMs() - started),
      );
      checkDeadline();

      if (assessment.decision === 'REJECT') {
        throw new GenerationError(
          built.status === 'INPUT_BUDGET_EXCEEDED' ? 'INVALID_INPUT' : 'INSUFFICIENT_EVIDENCE',
        );
      }

      await finishSpan();
      checkDeadline();

      span = observations.startSpan(executionId, 'generation');
      const result = await generate(operation, request, built.evidence, context);
      checkDeadline();
      await finishSpan();

      span = observations.startSpan(executionId, 'validation');
      const outputFailure = validateOutput(operation, request, result.data);

      if (outputFailure !== null) {
        throw new GenerationError(outputFailure);
      }

      const calls = await observations
        .executionAccounting(executionId)
        .catch(() => observations.failExecutionTrace(executionId));

      if (
        calls.length !== 2 ||
        calls[0]?.purpose !== 'query' ||
        calls[1]?.purpose !== operation ||
        calls.some((call) => call.phase !== 'ONLINE' || call.retryKind !== 'INITIAL')
      ) {
        throw new GenerationError('POST_VALIDATION_FAILED');
      }

      const response: unknown = {
        schema_version: '1',
        request_id: request.request_id,
        execution_id: executionId,
        mode: 'SINGLE_STAGE',
        data: result.data,
        meta: {
          trace_id: correlation.traceId,
          corpus_version: request.corpus_version,
          path: 'SINGLE_STAGE',
          sources: built.sources,
          duration_ms: Math.max(0, clock.monotonicMs() - started),
          ...singleStageMetadata(calls),
        },
      };

      if (!validators.responses[operation](response)) {
        throw new GenerationError('POST_VALIDATION_FAILED');
      }

      await finishSpan();
      checkDeadline();
      await observations.finish(executionId, 'SUCCESS', null);

      return response;
    } catch (error) {
      const failure = pipelineFailure(error, expired());

      if (failure.code === 'TRACE_WRITE_FAILED') {
        await observations.failExecutionTrace(executionId).catch(() => undefined);
        throw failure;
      }

      try {
        if (span !== null) {
          const current = span;
          span = null;
          await current.finish(failure.code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED', failure.code);
        }

        await observations.finish(
          executionId,
          failure.code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED',
          failure.code,
        );
      } catch {
        await observations.failExecutionTrace(executionId).catch(() => undefined);
        throw new GenerationError('TRACE_WRITE_FAILED');
      }

      throw failure;
    } finally {
      clearTimeout(timer);
      running.delete(executionId);
    }
  };
}
