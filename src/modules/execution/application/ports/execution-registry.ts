import type {
  AccountingInput,
  Correlation,
  EventData,
  Outcome,
  TraceEvent,
} from '@/modules/observability/application/public';
import type {
  CallAccounting,
  CallMeasurement,
  PriceSnapshot,
  TraceSink,
} from '@/modules/observability/application/public';
import type { TraceCode } from '@/shared/errors/failure-code';
import type { Mode, Operation } from '@/shared/operations';

export interface AdmissionInput {
  readonly serviceId: string;

  readonly requestId: string;

  readonly operation: Operation;

  readonly mode: Mode;

  readonly experiment?: Correlation['experiment'];

  readonly request: unknown;
}

export type AdmissionResult = {
  readonly status: 'admitted' | 'IN_FLIGHT' | 'TERMINAL' | 'UNKNOWN';

  readonly correlation: Correlation;

  readonly terminal: TraceEvent | null;
};

export interface ObservationOptions {
  readonly recoverStaleLock?: boolean;

  readonly sinkFactory?: (path: string) => TraceSink;

  readonly priceSnapshot?: PriceSnapshot;
}

export interface ObservationInspection {
  readonly correlation: Correlation;

  readonly state: 'IN_FLIGHT' | 'TERMINAL' | 'UNKNOWN';

  readonly terminal: TraceEvent | null;

  readonly traceIntegrity: 'VALID' | 'INVALID' | 'MISSING';

  readonly responseIntegrity: 'VALID' | 'INVALID' | 'MISSING';

  readonly eventCount: number;
}

export interface ExecutionRegistryPort {
  lookup(input: AdmissionInput): Promise<AdmissionResult | null>;

  storeResponse(executionId: string, response: unknown): Promise<void>;

  readResponse(executionId: string): Promise<unknown>;

  admit(input: AdmissionInput): Promise<AdmissionResult>;

  assertActive(executionId: string): void;

  activeCorrelation(executionId: string): Correlation;

  assertAdmittedRequest(executionId: string, input: Omit<AdmissionInput, 'serviceId'>): Correlation;

  failExecutionTrace(executionId: string): Promise<never>;

  record(
    executionId: string,
    data: Exclude<
      EventData,
      | {
          kind: 'request_started';
        }
      | {
          kind: 'terminal' | 'admission_rejected';
        }
    >,
    durationMs: number,
    timestamp?: string,
  ): Promise<void>;

  priceCall(measurement: CallMeasurement): Promise<CallAccounting>;

  executionAccounting(executionId: string): Promise<readonly CallAccounting[]>;

  recordResource(value: unknown): Promise<void>;

  exportAccounting(resourceInventoryComplete?: boolean): Promise<{
    readonly input: AccountingInput;
    readonly unaccountedAttemptIds: readonly string[];
  }>;

  finish(
    executionId: string,
    outcome: Exclude<Outcome, 'UNKNOWN'>,
    code: TraceCode | null,
  ): Promise<TraceEvent>;

  startSpan(
    executionId: string,
    stage: Extract<
      EventData,
      {
        kind: 'span_completed';
      }
    >['stage'],
    parentSpanId?: string | null,
  ): {
    readonly spanId: string;
    readonly finish: (
      outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT',
      code: TraceCode | null,
    ) => Promise<void>;
  };

  reject(input: {
    readonly requestId?: string | null;
    readonly mode?: Mode | null;
    readonly operation?: Operation | null;
    readonly code: TraceCode;
    readonly startedMs: number;
  }): Promise<TraceEvent>;

  reconcile(): Promise<readonly TraceEvent[]>;

  inspect(): Promise<readonly ObservationInspection[]>;

  rejected(): Promise<readonly TraceEvent[]>;

  close(): Promise<void>;

  currentPriceSnapshot(): PriceSnapshot | null;
}
