import rules from '@contracts/v1/errors.json' with { type: 'json' };
import type { TraceCode } from '@/shared/errors/failure-code';
import type { Mode } from '@/shared/operations';

export function errorRule(code: TraceCode) {
  return (
    rules.find((rule) => rule.code === code) ?? rules.find((rule) => rule.code === 'INTERNAL_ERROR')
  );
}

export function errorResponse(
  code: TraceCode,
  correlation: {
    requestId: string | null;
    executionId: string | null;
    traceId: string;
    mode: Mode | null;
  },
) {
  return {
    schema_version: '1',
    request_id: correlation.requestId,
    execution_id: correlation.executionId,
    mode: correlation.mode,
    error: {
      code: code === 'CRASH_RECOVERY' ? 'INTERNAL_ERROR' : code,
      message: code,
      retryable: errorRule(code)?.retryable ?? false,
    },
    meta: { trace_id: correlation.traceId },
  };
}
