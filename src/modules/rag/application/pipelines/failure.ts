import { ContextError } from '@/modules/rag/domain/models/context';
import { RetrievalError } from '@/modules/rag/domain/models/retrieval';
import { GenerationError } from '@/shared/errors/generation-error';
import { InferenceError } from '@/shared/errors/inference-error';
import { ObservationError } from '@/shared/errors/observation-error';

export function pipelineFailure(error: unknown, timedOut: boolean): GenerationError {
  if (
    (error instanceof ObservationError && error.code === 'TRACE_WRITE_FAILED') ||
    (error instanceof GenerationError && error.code === 'TRACE_WRITE_FAILED') ||
    (error instanceof InferenceError && error.code === 'ATTEMPT_OBSERVER_FAILED')
  ) {
    return new GenerationError('TRACE_WRITE_FAILED');
  }

  if (timedOut) {
    return new GenerationError('TIMEOUT');
  }

  if (error instanceof GenerationError) {
    return error;
  }

  if (error instanceof ContextError) {
    return new GenerationError(error.code);
  }

  if (error instanceof InferenceError) {
    const code = ['CANCELLED', 'DEADLINE_EXCEEDED'].includes(error.code)
      ? 'TIMEOUT'
      : error.code === 'CAPACITY_LIMIT'
        ? 'CAPACITY_LIMIT'
        : 'INFERENCE_FAILED';

    return new GenerationError(code, error.retryAfterMs);
  }

  if (error instanceof RetrievalError) {
    const code =
      error.code === 'TIMEOUT'
        ? 'TIMEOUT'
        : error.code === 'CAPACITY_LIMIT'
          ? 'CAPACITY_LIMIT'
          : 'RETRIEVAL_FAILED';

    return new GenerationError(code);
  }

  return new GenerationError('INTERNAL_ERROR');
}
