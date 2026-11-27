export type InferenceErrorCode =
  | 'INVALID_INPUT'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CAPACITY_LIMIT'
  | 'CANCELLED'
  | 'DEADLINE_EXCEEDED'
  | 'RATE_LIMITED'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_INPUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'ATTEMPT_OBSERVER_FAILED';

export class InferenceError extends Error {
  readonly code: InferenceErrorCode;

  readonly retryable: boolean;

  readonly httpStatus: number | null;

  readonly retryAfterMs: number | null;

  constructor(
    code: InferenceErrorCode,
    retryable = false,
    httpStatus: number | null = null,
    retryAfterMs: number | null = null,
  ) {
    // Do not retain raw errors, response bodies, input text, or credentials.
    super(`HF inference failed: ${code}`);
    this.name = 'InferenceError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
  }
}
