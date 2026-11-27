export class IndexingError extends Error {
  readonly code:
    'INVALID_PLAN' | 'INTEGRITY_ERROR' | 'JOB_LOCKED' | 'INVALID_JOURNAL' | 'CALL_BUDGET_EXHAUSTED';

  constructor(code: IndexingError['code']) {
    super(`Corpus indexing failed: ${code}`);
    this.name = 'IndexingError';
    this.code = code;
  }
}
