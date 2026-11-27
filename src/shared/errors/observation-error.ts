export class ObservationError extends Error {
  readonly code: 'TRACE_WRITE_FAILED' | 'IDEMPOTENCY_CONFLICT' | 'EXECUTION_NOT_ACTIVE';

  constructor(code: ObservationError['code']) {
    super(code);
    this.name = 'ObservationError';
    this.code = code;
  }
}
