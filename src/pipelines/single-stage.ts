import { GenerationError } from '@/adapters/openai-responses';
import { systemClock } from '@/adapters/system-clock';
import type { createContextBuilder } from '@/context/observed-builder';
import type { createOperationGenerator } from '@/generation/generator';
import type { ObservationStore } from '@/observability/store';
import { readEvidencePolicy } from '@/pipelines/evidence';
import type { EvidencePolicy } from '@/pipelines/evidence';
import { createExecutionRunner } from '@/pipelines/execution';
import type { Scheduling } from '@/pipelines/execution-control';
import { readExecutionPolicy } from '@/pipelines/execution-policy';
import type { ExecutionPolicy } from '@/pipelines/execution-policy';
import { retrievalPlan } from '@/pipelines/retrieval-plan';
import { observedStep, requireEvidence } from '@/pipelines/steps';
import type { createRetrievalStage } from '@/retrieval/stage';
import type { Clock } from '@/shared/ports';
import type { IndexManifest } from '@/storage/index-manifest';

export function createSingleStageRunner(
  index: IndexManifest,
  retrieve: ReturnType<typeof createRetrievalStage>,
  buildContext: ReturnType<typeof createContextBuilder>,
  generate: ReturnType<typeof createOperationGenerator>,
  observations: ObservationStore,
  policy: EvidencePolicy = readEvidencePolicy(),
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

  return createExecutionRunner(
    'SINGLE_STAGE',
    async (operation, request, context, state) => {
      const plan = retrievalPlan(operation, request);
      state.choose('SINGLE_STAGE');
      state.stage(1);
      const retrieved = await retrieve(plan.query, plan.filter, 1, context);
      const built = await observedStep(observations, context, 'context', () =>
        buildContext(operation, request, retrieved.candidates, plan.targetSkillCodes, context),
      );
      await requireEvidence(
        policy,
        retrieved.candidates.length,
        built,
        observations,
        context,
        clock,
      );
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
