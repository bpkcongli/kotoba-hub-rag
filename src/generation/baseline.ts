import { systemClock } from '@/adapters/system-clock';
import type { createOperationGenerator } from '@/generation/generator';
import type { ObservationStore } from '@/observability/store';
import { createExecutionRunner } from '@/pipelines/execution';
import type { Scheduling } from '@/pipelines/execution-control';
import { readExecutionPolicy } from '@/pipelines/execution-policy';
import type { ExecutionPolicy } from '@/pipelines/execution-policy';
import { observedStep } from '@/pipelines/steps';
import type { Clock } from '@/shared/ports';

export function createBaselineRunner(
  generate: ReturnType<typeof createOperationGenerator>,
  observations: ObservationStore,
  clock: Clock = systemClock,
  policy: ExecutionPolicy = readExecutionPolicy(),
  scheduling?: Scheduling,
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
  );
}
