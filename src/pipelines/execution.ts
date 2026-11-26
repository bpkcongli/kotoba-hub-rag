import { GenerationError } from '@/adapters/openai-responses';
import { systemClock } from '@/adapters/system-clock';
import { createContractValidators, validateRequest } from '@/contracts/validator';
import type { Mode, Operation, Requests, Responses } from '@/contracts/validator';
import { validPayload, validateOutput } from '@/generation/schema';
import type { CallAccounting } from '@/observability/accounting-types';
import { executionPolicyHash } from '@/observability/execution-event';
import type { ObservationStore } from '@/observability/store';
import { createExecutionControl } from '@/pipelines/execution-control';
import type { Scheduling } from '@/pipelines/execution-control';
import { parseExecutionPolicy, readExecutionPolicy } from '@/pipelines/execution-policy';
import type { ExecutionPolicy } from '@/pipelines/execution-policy';
import { pipelineFailure } from '@/pipelines/failure';
import { pipelineMetadata } from '@/pipelines/metadata';
import type { CallContext, Clock } from '@/shared/ports';

export interface PipelineState {
  readonly path: 'LLM_ONLY' | 'SINGLE_STAGE' | 'FAST' | 'DEEP' | null;
  readonly stageCount: 0 | 1 | 2;
  stage(stage: 1 | 2): void;
  choose(path: 'LLM_ONLY' | 'SINGLE_STAGE' | 'FAST' | 'DEEP'): void;
}
interface PipelineOutput {
  readonly data: unknown;
  readonly sources: readonly { readonly source_id: string; readonly chunk_id: string }[];
}

function validCalls(
  calls: readonly CallAccounting[],
  mode: Mode,
  operation: Operation,
  state: PipelineState,
  policy: ExecutionPolicy,
): boolean {
  const initial = calls.filter((call) => call.retryKind === 'INITIAL').map((call) => call.purpose);
  const providers = calls.filter((call) => call.retryKind === 'PROVIDER_RETRY').length;
  const schemas = calls.filter((call) => call.retryKind === 'SCHEMA_RETRY').length;
  const rewrites = calls.filter((call) => call.purpose === 'rewrite').length;
  const prefix =
    state.path === 'DEEP'
      ? rewrites > 0
        ? ['query', 'rewrite', 'query']
        : ['query', 'query']
      : mode === 'LLM_ONLY'
        ? []
        : ['query'];
  const middle = initial.slice(prefix.length, -1);

  return (
    calls.length <= policy.maxModelCalls &&
    rewrites <= 1 &&
    providers <= policy.maxProviderRetries &&
    schemas <= policy.maxSchemaRetries &&
    providers + schemas <= policy.maxTotalRetries &&
    calls.every(
      (call) =>
        call.phase === 'ONLINE' &&
        (call.retryKind !== 'SCHEMA_RETRY' || call.purpose === operation) &&
        (call.purpose !== 'rewrite' || call.retryKind === 'INITIAL'),
    ) &&
    JSON.stringify(initial.slice(0, prefix.length)) === JSON.stringify(prefix) &&
    initial.at(-1) === operation &&
    (state.path === 'DEEP'
      ? middle.length > 0 && middle.length <= 64 && middle.every((purpose) => purpose === 'rerank')
      : middle.length === 0) &&
    calls.every(
      (call) =>
        prefix.includes(call.purpose) ||
        call.purpose === operation ||
        (state.path === 'DEEP' && call.purpose === 'rerank'),
    )
  );
}

export function createExecutionRunner(
  mode: Mode,
  work: (
    operation: Operation,
    request: Requests[Operation],
    context: CallContext,
    state: PipelineState,
  ) => Promise<PipelineOutput>,
  observations: ObservationStore,
  clock: Clock = systemClock,
  policy: ExecutionPolicy = readExecutionPolicy(),
  corpusVersion?: string,
  scheduling?: Scheduling,
) {
  policy = parseExecutionPolicy(policy);
  const validators = createContractValidators();
  const running = new Set<string>();

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
      mode: correlation.mode ?? mode,
      request: input,
      experiment: correlation.experiment,
    });

    if (running.has(executionId)) {
      throw new GenerationError('IDEMPOTENCY_CONFLICT');
    }

    running.add(executionId);
    const execution = createExecutionControl(
      policy,
      mode,
      operation,
      executionId,
      clock,
      observations,
      started,
      startedAt,
      signal,
      scheduling,
    );
    let span: ReturnType<ObservationStore['startSpan']> | null = null;
    const state: PipelineState = {
      path: null,
      stageCount: 0,
      stage(stage) {
        execution.check();
        if (
          mode === 'LLM_ONLY' ||
          stage !== state.stageCount + 1 ||
          (stage === 2 && (mode !== 'ADAPTIVE' || state.path !== 'DEEP'))
        ) {
          throw new GenerationError('INVALID_INPUT');
        }

        Object.assign(state, { stageCount: stage });
      },
      choose(path) {
        if (
          state.path !== null ||
          (mode === 'ADAPTIVE' ? !['FAST', 'DEEP'].includes(path) : path !== mode)
        ) {
          throw new GenerationError('INVALID_INPUT');
        }

        Object.assign(state, { path });
      },
    };
    const finishSpan = async (): Promise<void> => {
      const current = span;
      span = null;
      await current?.finish('SUCCESS', null);
    };
    const calls = () =>
      observations
        .executionAccounting(executionId)
        .catch(() => observations.failExecutionTrace(executionId));
    const recordPath = async (outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT'): Promise<void> => {
      if (mode !== 'ADAPTIVE') {
        return;
      }

      const attempts = await calls();
      if (outcome === 'SUCCESS') {
        execution.check();
      }

      await observations.record(
        executionId,
        {
          kind: 'adaptive_path_completed',
          version: 'adp-03-v1',
          finalPath: state.path === 'FAST' || state.path === 'DEEP' ? state.path : null,
          retrievalStageCount: state.stageCount,
          queryCallCount: attempts.filter((call) => call.purpose === 'query').length,
          llmCallCount: attempts.filter((call) => !['query', 'rerank'].includes(call.purpose))
            .length,
          rewriteCallCount: attempts.filter((call) => call.purpose === 'rewrite').length,
          rerankCallCount: attempts.filter((call) => call.purpose === 'rerank').length,
          providerRetryCount: attempts.filter((call) => call.retryKind === 'PROVIDER_RETRY').length,
          schemaRetryCount: attempts.filter((call) => call.retryKind === 'SCHEMA_RETRY').length,
          modelCallCount: attempts.length,
          outcome,
        },
        Math.max(0, clock.monotonicMs() - started),
      );
    };

    try {
      span = observations.startSpan(executionId, 'validation');
      const admitted = validateRequest(validators, operation, input, clock.now().getTime());

      if (!admitted.ok) {
        throw new GenerationError(admitted.code);
      }

      const request = structuredClone(admitted.request);

      if (request.mode !== mode || !validPayload(operation, request)) {
        throw new GenerationError('INVALID_INPUT');
      }

      if (corpusVersion !== undefined && request.corpus_version !== corpusVersion) {
        throw new GenerationError('SNAPSHOT_MISMATCH');
      }

      const context = execution.start(request.timeout_ms, request.deadline_at);
      await observations.record(
        executionId,
        {
          kind: 'execution_policy',
          policy,
          configurationHash: executionPolicyHash(policy),
          budgetMs: execution.budgetMs,
        },
        Math.max(0, clock.monotonicMs() - started),
      );
      await finishSpan();
      execution.check();
      const result = await work(operation, request, context, state);
      execution.check();

      span = observations.startSpan(executionId, 'validation');
      const failure = validateOutput(operation, request, result.data);

      if (failure !== null) {
        throw new GenerationError(failure);
      }

      const attempts = await calls();

      if (!validCalls(attempts, mode, operation, state, policy)) {
        throw new GenerationError('POST_VALIDATION_FAILED');
      }

      const response: unknown = {
        schema_version: '1',
        request_id: request.request_id,
        execution_id: executionId,
        mode,
        data: result.data,
        meta: {
          trace_id: correlation.traceId,
          corpus_version: request.corpus_version,
          path: state.path,
          sources: result.sources,
          duration_ms: Math.max(0, clock.monotonicMs() - started),
          ...pipelineMetadata(attempts, state.stageCount),
        },
      };

      if (!validators.responses[operation](response)) {
        throw new GenerationError('POST_VALIDATION_FAILED');
      }

      await finishSpan();
      execution.check();
      await recordPath('SUCCESS');
      execution.check();
      await observations.finish(executionId, 'SUCCESS', null);
      return response;
    } catch (error) {
      const failure = pipelineFailure(error, execution.expired());
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
        await recordPath(failure.code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED');
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
      execution.close();
      running.delete(executionId);
    }
  };
}
