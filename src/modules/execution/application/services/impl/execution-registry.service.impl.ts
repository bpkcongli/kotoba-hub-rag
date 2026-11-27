import type { ExecutionRegistryPort } from '@/modules/execution/application/ports/execution-registry';
import type {
  AdmissionInput,
  AdmissionResult,
  ExecutionRegistryService,
  ObservationInspection,
} from '@/modules/execution/application/services/execution-registry.service';
import type {
  AccountingInput,
  CallAccounting,
  CallMeasurement,
  Correlation,
  EventData,
  Outcome,
  PriceSnapshot,
  TraceEvent,
} from '@/modules/observability/application/public';
import type { TraceCode } from '@/shared/errors/failure-code';
import type { Mode, Operation } from '@/shared/operations';

export class ExecutionRegistryServiceImpl implements ExecutionRegistryService {
  private readonly registry: ExecutionRegistryPort;

  constructor(registry: ExecutionRegistryPort) {
    this.registry = registry;
  }

  admit(input: AdmissionInput): Promise<AdmissionResult> {
    return this.registry.admit(input);
  }

  lookup(input: AdmissionInput): Promise<AdmissionResult | null> {
    return this.registry.lookup(input);
  }

  storeResponse(executionId: string, response: unknown): Promise<void> {
    return this.registry.storeResponse(executionId, response);
  }

  readResponse(executionId: string): Promise<unknown> {
    return this.registry.readResponse(executionId);
  }

  assertActive(executionId: string): void {
    return this.registry.assertActive(executionId);
  }

  activeCorrelation(executionId: string): Correlation {
    return this.registry.activeCorrelation(executionId);
  }

  assertAdmittedRequest(
    executionId: string,
    input: Omit<AdmissionInput, 'serviceId'>,
  ): Correlation {
    return this.registry.assertAdmittedRequest(executionId, input);
  }

  failExecutionTrace(executionId: string): Promise<never> {
    return this.registry.failExecutionTrace(executionId);
  }

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
  ): Promise<void> {
    return this.registry.record(executionId, data, durationMs, timestamp);
  }

  priceCall(measurement: CallMeasurement): Promise<CallAccounting> {
    return this.registry.priceCall(measurement);
  }

  executionAccounting(executionId: string): Promise<readonly CallAccounting[]> {
    return this.registry.executionAccounting(executionId);
  }

  recordResource(value: unknown): Promise<void> {
    return this.registry.recordResource(value);
  }

  exportAccounting(resourceInventoryComplete?: boolean): Promise<{
    readonly input: AccountingInput;
    readonly unaccountedAttemptIds: readonly string[];
  }> {
    return this.registry.exportAccounting(resourceInventoryComplete);
  }

  finish(
    executionId: string,
    outcome: Exclude<Outcome, 'UNKNOWN'>,
    code: TraceCode | null,
  ): Promise<TraceEvent> {
    return this.registry.finish(executionId, outcome, code);
  }

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
  } {
    return this.registry.startSpan(executionId, stage, parentSpanId);
  }

  reject(input: {
    readonly requestId?: string | null;
    readonly mode?: Mode | null;
    readonly operation?: Operation | null;
    readonly code: TraceCode;
    readonly startedMs: number;
  }): Promise<TraceEvent> {
    return this.registry.reject(input);
  }

  reconcile(): Promise<readonly TraceEvent[]> {
    return this.registry.reconcile();
  }

  inspect(): Promise<readonly ObservationInspection[]> {
    return this.registry.inspect();
  }

  rejected(): Promise<readonly TraceEvent[]> {
    return this.registry.rejected();
  }

  close(): Promise<void> {
    return this.registry.close();
  }

  currentPriceSnapshot(): PriceSnapshot | null {
    return this.registry.currentPriceSnapshot();
  }
}
