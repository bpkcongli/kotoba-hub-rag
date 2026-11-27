import type { CallMeasurement, CallPurpose } from '@/modules/observability/application/public';

export interface CallContext {
  readonly executionId: string;

  readonly signal: AbortSignal;

  readonly deadlineAt: string;

  readonly control?: ExecutionControl;

  readonly accounting?: Pick<CallMeasurement, 'phase' | 'retryKind'>;
}

export interface ExecutionControl {
  readonly traceGraceMs: number;

  check(): void;
  provider<T>(
    purpose: CallPurpose,
    context: CallContext,
    attempt: (context: CallContext) => Promise<T>,
  ): Promise<T>;
  schema<T>(context: CallContext, attempt: (context: CallContext) => Promise<T>): Promise<T>;
}
