import type { ExecutionPolicy, Scheduling } from '@/modules/execution/application/public';
import { readExecutionPolicy } from '@/modules/execution/application/public';
import type { RubricBundle } from '@/modules/knowledge/application/public';
import type { IndexManifest } from '@/modules/knowledge/application/public';
import type { EvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import { readEvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import { createExecutionRunner } from '@/modules/rag/application/pipelines/execution';
import { retrievalPlan } from '@/modules/rag/application/pipelines/retrieval-plan';
import { observedStep, requireEvidence } from '@/modules/rag/application/pipelines/steps';
import type { RagExecutionPort } from '@/modules/rag/application/ports/execution';
import type {
  ContextBuilderService,
  OperationGeneratorService,
  RetrievalStageService,
} from '@/modules/rag/application/services/stages';
import type { Clock } from '@/shared/clock';
import { GenerationError } from '@/shared/errors/generation-error';
import { systemClock } from '@/shared/system-clock';

export function createSingleStageRunner(
  index: IndexManifest,
  retrieve: RetrievalStageService,
  buildContext: ContextBuilderService,
  generate: OperationGeneratorService,
  observations: RagExecutionPort,
  policy: EvidencePolicy = readEvidencePolicy(),
  clock: Clock = systemClock,
  executionPolicy: ExecutionPolicy = readExecutionPolicy(),
  scheduling?: Scheduling,
  rubric?: RubricBundle | null,
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
      const plan = retrievalPlan(operation, request, rubric);
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
    rubric,
  );
}
