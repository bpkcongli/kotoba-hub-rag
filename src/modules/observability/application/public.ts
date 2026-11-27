// Public application facade: explicit operations and boundary data only.
export {
  parsePriceSnapshot,
  parseResourceCharge,
} from '@/modules/observability/application/accounting-schema';

export {
  type AccountingInput,
  type CallRow,
  type ExecutionSpec,
} from '@/modules/observability/application/aggregation';

export {
  parseTraceEvent,
  validateCorrelation,
  type Correlation,
  type EventData,
  type Outcome,
  type TraceEvent,
} from '@/modules/observability/application/events';

export {
  executionPolicyHash,
  type RetryTrace,
} from '@/modules/observability/application/execution-event';

export { type TraceSink } from '@/modules/observability/application/ports/trace-sink';

export {
  accountCall,
  normalizeResponseUsage,
  priceSnapshotHash,
} from '@/modules/observability/application/pricing';

export {
  type CallAccounting,
  type CallMeasurement,
  type CallPurpose,
  type PriceSnapshot,
  type ResourceCharge,
  type TokenUsage,
} from '@/modules/observability/domain/accounting-types';

export { sumMoney } from '@/modules/observability/domain/money';
