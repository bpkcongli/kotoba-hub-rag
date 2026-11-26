import { GenerationError } from '@/adapters/openai-responses';
import { systemClock } from '@/adapters/system-clock';
import type { createContextBuilder } from '@/context/observed-builder';
import { createContractValidators, validateRequest } from '@/contracts/validator';
import type { Operation, Responses } from '@/contracts/validator';
import type { createOperationGenerator } from '@/generation/generator';
import { validPayload, validateOutput } from '@/generation/schema';
import { hashValue } from '@/observability/store';
import type { ObservationStore } from '@/observability/store';
import { createAdaptiveInitialStage } from '@/pipelines/adaptive-initial';
import { mergeDeepCandidates, mapRerankedCandidates } from '@/pipelines/deep-candidates';
import type { DeepPolicy } from '@/pipelines/deep-config';
import { parseDeepPolicy, readDeepPolicy } from '@/pipelines/deep-config';
import { assessEvidence, readEvidencePolicy } from '@/pipelines/evidence';
import type { EvidencePolicy } from '@/pipelines/evidence';
import { pipelineFailure } from '@/pipelines/failure';
import { adaptiveMetadata } from '@/pipelines/metadata';
import type { createQueryRewriter } from '@/pipelines/rewrite';
import type { RouterPolicy } from '@/pipelines/router';
import { readRouterPolicy } from '@/pipelines/router';
import type { createRetrievalStage } from '@/retrieval/stage';
import type { RerankerPort } from '@/shared/ports';
import type { CallContext, Clock } from '@/shared/ports';
import type { IndexManifest } from '@/storage/index-manifest';

export function createAdaptiveRunner(
  index: IndexManifest,
  retrieve: ReturnType<typeof createRetrievalStage>,
  buildContext: ReturnType<typeof createContextBuilder>,
  generate: ReturnType<typeof createOperationGenerator>,
  rewrite: ReturnType<typeof createQueryRewriter>,
  reranker: RerankerPort,
  observations: ObservationStore,
  policy: EvidencePolicy = readEvidencePolicy(),
  routerPolicy: RouterPolicy = readRouterPolicy(),
  deepPolicy: DeepPolicy = readDeepPolicy(),
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

  deepPolicy = parseDeepPolicy(deepPolicy);
  const initialStage = createAdaptiveInitialStage(
    index,
    retrieve,
    buildContext,
    observations,
    routerPolicy,
    clock,
  );
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
      mode: correlation.mode ?? 'ADAPTIVE',
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
    let initialDecision: 'FAST' | 'DEEP' | null = null;
    let stageCount: 0 | 1 | 2 = 0;
    let poolCount = 0;
    const recordPath = async (outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT'): Promise<void> => {
      const calls = await observations
        .executionAccounting(executionId)
        .catch(() => observations.failExecutionTrace(executionId));

      if (outcome === 'SUCCESS') {
        checkDeadline();
      }

      await observations.record(
        executionId,
        {
          kind: 'adaptive_path_completed',
          version: 'adp-02-v1',
          finalPath: initialDecision,
          retrievalStageCount: stageCount,
          rewriteCallCount: calls.filter((row) => row.purpose === 'rewrite').length,
          rerankCallCount: calls.filter((row) => row.purpose === 'rerank').length,
          modelCallCount: calls.length,
          outcome,
        },
        Math.max(0, clock.monotonicMs() - started),
      );
    };

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

      if (request.mode !== 'ADAPTIVE' || !validPayload(operation, request)) {
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
      await finishSpan();
      checkDeadline();

      stageCount = 1;
      const initial = await initialStage(operation, request, context);
      initialDecision = initial.decision.initialDecision;
      checkDeadline();
      let built = initial.built;
      let retrievedCount = initial.retrieved.candidates.length;

      if (initialDecision === 'DEEP') {
        let query = initial.plan.query;

        if (deepPolicy.rewriteEnabled) {
          span = observations.startSpan(executionId, 'rewrite');
          query = await rewrite(query, deepPolicy.rewriteModel, context);
          checkDeadline();
          await finishSpan();
        }

        // The same closed-over stage/configuration and original hard filters are mandatory.
        checkDeadline();
        stageCount = 2;
        const second = await retrieve(query, initial.plan.filter, 2, context);
        checkDeadline();

        if (
          second.trace.configurationHash !== initial.retrieved.trace.configurationHash ||
          second.trace.indexFingerprint !== initial.retrieved.trace.indexFingerprint ||
          second.trace.profile !== initial.retrieved.trace.profile ||
          JSON.stringify(second.trace.scope) !== JSON.stringify(initial.retrieved.trace.scope)
        ) {
          throw new GenerationError('RETRIEVAL_FAILED');
        }

        const { pool, dropped } = mergeDeepCandidates(
          initial.retrieved.candidates,
          second.candidates,
          initial.plan.filter,
          deepPolicy.rerankPoolLimit,
        );
        poolCount = pool.length;
        span = observations.startSpan(executionId, 'rerank');
        const scores = pool.length ? await reranker.rerank(query, pool, context) : [];
        checkDeadline();
        const ranked = mapRerankedCandidates(pool, scores);
        await observations.record(
          executionId,
          {
            kind: 'deep_reranked',
            policy: deepPolicy,
            configurationHash: hashValue(JSON.stringify(deepPolicy)),
            firstRetrievalId: initial.retrieved.trace.retrievalId,
            secondRetrievalId: second.trace.retrievalId,
            scopeHash: hashValue(JSON.stringify(second.trace.scope)),
            queryHash: hashValue(query),
            poolIds: pool.map((row) => row.chunkId),
            dropped,
            scores: ranked.map((row) => ({
              chunkId: row.chunkId,
              rank: row.rank,
              score: row.score,
              scoreType: 'hf_none_raw_logit_unverified',
            })),
          },
          Math.max(0, clock.monotonicMs() - started),
        );
        await finishSpan();
        checkDeadline();

        span = observations.startSpan(executionId, 'context');
        built = await buildContext(
          operation,
          request,
          ranked,
          initial.plan.targetSkillCodes,
          context,
        );
        retrievedCount = ranked.length;
        await finishSpan();
        checkDeadline();
      }

      span = observations.startSpan(executionId, 'context');
      const assessment = assessEvidence(policy, retrievedCount, built);
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

      const purposes = calls.map((row) => row.purpose);
      const rerankCalls = purposes.filter((purpose) => purpose === 'rerank').length;
      const expectedPrefix =
        initialDecision === 'DEEP'
          ? deepPolicy.rewriteEnabled
            ? ['query', 'rewrite', 'query']
            : ['query', 'query']
          : ['query'];
      const middle = purposes.slice(expectedPrefix.length, -1);

      if (
        JSON.stringify(purposes.slice(0, expectedPrefix.length)) !==
          JSON.stringify(expectedPrefix) ||
        purposes.at(-1) !== operation ||
        (initialDecision === 'FAST'
          ? middle.length !== 0
          : middle.some((purpose) => purpose !== 'rerank') ||
            rerankCalls < 1 ||
            rerankCalls > poolCount) ||
        calls.some((call) => call.phase !== 'ONLINE' || call.retryKind !== 'INITIAL')
      ) {
        throw new GenerationError('POST_VALIDATION_FAILED');
      }

      const response: unknown = {
        schema_version: '1',
        request_id: request.request_id,
        execution_id: executionId,
        mode: 'ADAPTIVE',
        data: result.data,
        meta: {
          trace_id: correlation.traceId,
          corpus_version: request.corpus_version,
          path: initialDecision,
          sources: built.sources,
          duration_ms: Math.max(0, clock.monotonicMs() - started),
          ...adaptiveMetadata(calls, stageCount),
        },
      };

      if (!validators.responses[operation](response)) {
        throw new GenerationError('POST_VALIDATION_FAILED');
      }

      await finishSpan();
      checkDeadline();
      await recordPath('SUCCESS');
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
      clearTimeout(timer);
      running.delete(executionId);
    }
  };
}
