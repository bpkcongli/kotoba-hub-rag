import type { ExecutionPolicy, Scheduling } from '@/modules/execution/application/public';
import { readExecutionPolicy } from '@/modules/execution/application/public';
import type { RubricBundle } from '@/modules/knowledge/application/public';
import { createExecutionRunner } from '@/modules/rag/application/pipelines/execution';
import { observedStep } from '@/modules/rag/application/pipelines/steps';
import type { RagExecutionPort } from '@/modules/rag/application/ports/execution';
import type { OperationGeneratorService } from '@/modules/rag/application/services/stages';
import type { Clock } from '@/shared/clock';
import { systemClock } from '@/shared/system-clock';

export function createBaselineRunner(
  generate: OperationGeneratorService,
  observations: RagExecutionPort,
  clock: Clock = systemClock,
  policy: ExecutionPolicy = readExecutionPolicy(),
  scheduling?: Scheduling,
  rubric?: RubricBundle | null,
) {
  return createExecutionRunner(
    'LLM_ONLY',
    async (operation, request, context, state) => {
      state.choose('LLM_ONLY');
      // Baseline has no embedding/retriever/reranker dependencies.
      const result = await observedStep(observations, context, 'generation', () =>
        generate(operation, request, [], context),
      );

      return { data: result.data, sources: [] };
    },
    observations,
    clock,
    policy,
    undefined,
    scheduling,
    rubric,
  );
}
