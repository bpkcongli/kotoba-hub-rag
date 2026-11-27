import type { ExecutionPolicy, Scheduling } from '@/modules/execution/application/public';
import { readExecutionPolicy } from '@/modules/execution/application/public';
import type { IndexManifest } from '@/modules/knowledge/application/public';
import { createAdaptiveInitialStage } from '@/modules/rag/application/pipelines/adaptive-initial';
import type { DeepPolicy } from '@/modules/rag/application/pipelines/deep-config';
import { parseDeepPolicy, readDeepPolicy } from '@/modules/rag/application/pipelines/deep-config';
import type { EvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import { readEvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import { createExecutionRunner } from '@/modules/rag/application/pipelines/execution';
import type { RouterPolicy } from '@/modules/rag/application/pipelines/router';
import { readRouterPolicy } from '@/modules/rag/application/pipelines/router';
import { observedStep, requireEvidence } from '@/modules/rag/application/pipelines/steps';
import type { RagExecutionPort } from '@/modules/rag/application/ports/execution';
import type { RerankerPort } from '@/modules/rag/application/ports/inference';
import type {
  ContextBuilderService,
  OperationGeneratorService,
  QueryRewriteService,
  RetrievalStageService,
} from '@/modules/rag/application/services/stages';
import {
  mapRerankedCandidates,
  mergeDeepCandidates,
} from '@/modules/rag/domain/services/deep-candidates';
import type { Clock } from '@/shared/clock';
import { GenerationError } from '@/shared/errors/generation-error';
import { hashValue } from '@/shared/hash';
import { systemClock } from '@/shared/system-clock';

export function createAdaptiveRunner(
  index: IndexManifest,
  retrieve: RetrievalStageService,
  buildContext: ContextBuilderService,
  generate: OperationGeneratorService,
  rewrite: QueryRewriteService,
  reranker: RerankerPort,
  observations: RagExecutionPort,
  policy: EvidencePolicy = readEvidencePolicy(),
  routerPolicy: RouterPolicy = readRouterPolicy(),
  deepPolicy: DeepPolicy = readDeepPolicy(),
  clock: Clock = systemClock,
  executionPolicy: ExecutionPolicy = readExecutionPolicy(),
  scheduling?: Scheduling,
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

  return createExecutionRunner(
    'ADAPTIVE',
    async (operation, request, context, state) => {
      state.stage(1);
      const initial = await initialStage(operation, request, context);
      const initialDecision = initial.decision.initialDecision;
      state.choose(initialDecision);
      context.control?.check();
      let built = initial.built;
      let retrievedCount = initial.retrieved.candidates.length;

      if (initialDecision === 'DEEP') {
        let query = initial.plan.query;

        if (deepPolicy.rewriteEnabled) {
          query = await observedStep(observations, context, 'rewrite', () =>
            rewrite(query, deepPolicy.rewriteModel, context),
          );
        }

        // The same closed-over stage/configuration and original hard filters are mandatory.
        context.control?.check();
        state.stage(2);
        const second = await retrieve(query, initial.plan.filter, 2, context);
        context.control?.check();

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

        const rerankStarted = clock.monotonicMs();
        const ranked = await observedStep(observations, context, 'rerank', async () => {
          const scores = pool.length ? await reranker.rerank(query, pool, context) : [];
          context.control?.check();
          const ranked = mapRerankedCandidates(pool, scores);
          await observations.record(
            context.executionId,
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
            Math.max(0, clock.monotonicMs() - rerankStarted),
          );

          return ranked;
        });
        context.control?.check();

        built = await observedStep(observations, context, 'context', () =>
          buildContext(operation, request, ranked, initial.plan.targetSkillCodes, context),
        );
        retrievedCount = ranked.length;
        context.control?.check();
      }

      await requireEvidence(policy, retrievedCount, built, observations, context, clock);
      const result = await observedStep(observations, context, 'generation', () =>
        generate(operation, request, built.evidence, context),
      );

      return { data: result.data, sources: built.sources };
    },
    observations,
    clock,
    executionPolicy,
    index.corpusVersion,
    scheduling,
  );
}
