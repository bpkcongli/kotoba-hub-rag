import type { TraceCode } from '@/shared/errors/failure-code';

export class GenerationError extends Error {
  readonly code: TraceCode;

  readonly retryAfterMs: number | null;

  readonly httpStatus: number | null;

  constructor(
    code: TraceCode,
    retryAfterMs: number | null = null,
    httpStatus: number | null = null,
  ) {
    super(`Generation failed: ${code}`);
    this.name = 'GenerationError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.httpStatus = httpStatus;
  }
}
