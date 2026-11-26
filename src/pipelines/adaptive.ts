import { GenerationError } from '@/adapters/openai-responses';
import { systemClock } from '@/adapters/system-clock';
import type { createContextBuilder } from '@/context/observed-builder';
import type { createOperationGenerator } from '@/generation/generator';
import { hashValue } from '@/observability/store';
import type { ObservationStore } from '@/observability/store';
import { createAdaptiveInitialStage } from '@/pipelines/adaptive-initial';
import { mergeDeepCandidates, mapRerankedCandidates } from '@/pipelines/deep-candidates';
import { parseDeepPolicy, readDeepPolicy } from '@/pipelines/deep-config';
import type { DeepPolicy } from '@/pipelines/deep-config';
import { readEvidencePolicy } from '@/pipelines/evidence';
import type { EvidencePolicy } from '@/pipelines/evidence';
import { createExecutionRunner } from '@/pipelines/execution';
import type { Scheduling } from '@/pipelines/execution-control';
import { readExecutionPolicy } from '@/pipelines/execution-policy';
import type { ExecutionPolicy } from '@/pipelines/execution-policy';
import type { createQueryRewriter } from '@/pipelines/rewrite';
import { readRouterPolicy } from '@/pipelines/router';
import type { RouterPolicy } from '@/pipelines/router';
import { observedStep, requireEvidence } from '@/pipelines/steps';
import type { createRetrievalStage } from '@/retrieval/stage';
import type { Clock, RerankerPort } from '@/shared/ports';
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
