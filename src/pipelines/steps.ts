import { GenerationError } from '@/adapters/openai-responses';
import { systemClock } from '@/adapters/system-clock';
import type { BuiltContext } from '@/context/types';
import { ObservationError } from '@/observability/store';
import type { ObservationStore } from '@/observability/store';
import { assessEvidence } from '@/pipelines/evidence';
import type { EvidencePolicy } from '@/pipelines/evidence';
import { pipelineFailure } from '@/pipelines/failure';
import type { CallContext, Clock } from '@/shared/ports';

export async function observedStep<T>(
  observations: ObservationStore,
  context: CallContext,
  stage: Parameters<ObservationStore['startSpan']>[1],
  work: () => Promise<T>,
): Promise<T> {
  context.control?.check();
  const span = observations.startSpan(context.executionId, stage);
  let closed = false;

  try {
    const result = await work();
    context.control?.check();
    closed = true;
    await span.finish('SUCCESS', null);
    context.control?.check();
    return result;
  } catch (error) {
    if (
      (error instanceof ObservationError || error instanceof GenerationError) &&
      error.code === 'TRACE_WRITE_FAILED'
    ) {
      throw error;
    }

    const failure = pipelineFailure(error, context.signal.aborted);
    if (!closed) {
      await span.finish(failure.code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED', failure.code);
    }

    throw error;
  }
}

export async function requireEvidence(
  policy: EvidencePolicy,
  retrievedCount: number,
  built: BuiltContext,
  observations: ObservationStore,
  context: CallContext,
  clock: Clock = systemClock,
): Promise<void> {
  const started = clock.monotonicMs();
  const assessment = assessEvidence(policy, retrievedCount, built);
  await observations.record(
    context.executionId,
    assessment,
    Math.max(0, clock.monotonicMs() - started),
  );
  context.control?.check();

  if (assessment.decision === 'REJECT') {
    throw new GenerationError(
      built.status === 'INPUT_BUDGET_EXCEEDED' ? 'INVALID_INPUT' : 'INSUFFICIENT_EVIDENCE',
    );
  }
}
