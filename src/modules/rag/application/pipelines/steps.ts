import type { CallContext } from '@/modules/execution/application/public';
import type { EvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import { assessEvidence } from '@/modules/rag/application/pipelines/evidence';
import { pipelineFailure } from '@/modules/rag/application/pipelines/failure';
import type { RagExecutionPort } from '@/modules/rag/application/ports/execution';
import type { BuiltContext } from '@/modules/rag/domain/models/context';
import type { Clock } from '@/shared/clock';
import { GenerationError } from '@/shared/errors/generation-error';
import { ObservationError } from '@/shared/errors/observation-error';
import { systemClock } from '@/shared/system-clock';

export async function observedStep<T>(
  observations: RagExecutionPort,
  context: CallContext,
  stage: Parameters<RagExecutionPort['startSpan']>[1],
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
  observations: RagExecutionPort,
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
