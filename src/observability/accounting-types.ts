export type CallPurpose =
  | 'document'
  | 'query'
  | 'rerank'
  | 'generate'
  | 'evaluate'
  | 'normalize'
  | 'recommend'
  | 'rewrite'
  | 'repair'
  | 'judge';
export type CallPhase = 'ONLINE' | 'DOCUMENT_INDEXING' | 'JUDGE' | 'WARMUP';
export type BillableUnit = 'REQUEST' | 'DOCUMENT_PAIR' | 'COMPUTE_SECOND';
export type CostStatus = 'KNOWN' | 'PARTIAL' | 'UNKNOWN';

// Decimal strings preserve provider precision; USD is rounded to 12 decimal places per component.
export interface TokenUsage {
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly cacheWriteInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly totalTokens: number | null;
}

export interface CallMeasurement {
  readonly attemptId: string;
  readonly purpose: CallPurpose;
  readonly phase: CallPhase;
  readonly retryKind: 'INITIAL' | 'PROVIDER_RETRY' | 'SCHEMA_RETRY';
  readonly provider: string;
  readonly model: string;
  readonly billingProfile: string;
  readonly timestamp: string;
  readonly usage: TokenUsage | null;
  readonly billableUnits: readonly {
    readonly unit: BillableUnit;
    readonly quantity: string | null;
    readonly evidenceHash: string | null;
  }[];
  readonly reportedCost: { readonly amountUsd: string; readonly evidenceHash: string } | null;
  readonly hostingChargeId: string | null;
}

interface PriceIdentity {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly purposes: readonly CallPurpose[];
  readonly billingProfile: string;
  readonly sourceUrl: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
}

export type PriceEntry = PriceIdentity &
  (
    | {
        readonly kind: 'TOKENS';
        readonly maxInputTokens: number;
        readonly inputPerMillionUsd: string | null;
        readonly cachedInputPerMillionUsd: string | null;
        readonly cacheWriteInputPerMillionUsd: string | null;
        readonly outputPerMillionUsd: string | null;
      }
    | {
        readonly kind: 'UNIT';
        readonly unit: BillableUnit;
        readonly perUnits: number;
        readonly priceUsd: string | null;
      }
  );

export interface PriceSnapshot {
  readonly schemaVersion: 'obs-02-prices-v1';
  readonly id: string;
  readonly asOf: string;
  readonly currency: 'USD';
  readonly entries: readonly PriceEntry[];
}

export interface CostComponent {
  readonly unit: string;
  readonly quantity: string | null;
  readonly rateUsd: string | null;
  readonly perUnits: number;
  readonly amountUsd: string | null;
}

export interface MonetarySummary {
  readonly totalUsd: string | null;
  readonly knownSubtotalUsd: string;
  readonly status: CostStatus;
  readonly knownComponents: number;
  readonly unknownComponents: number;
}

export type CallCost =
  | (MonetarySummary & {
      readonly kind: 'PER_CALL';
      readonly origin: 'TARIFF_ESTIMATE' | 'PROVIDER_REPORTED' | 'UNKNOWN';
      readonly reason:
        'PRICED' | 'NO_MATCHING_PRICE' | 'OUTSIDE_PRICE_SCOPE' | 'MISSING_USAGE_OR_RATE';
      readonly components: readonly CostComponent[];
    })
  | { readonly kind: 'HOSTING_INCLUDED'; readonly chargeId: string };

export interface CallAccounting extends CallMeasurement {
  readonly schemaVersion: 'obs-02-call-v1';
  readonly priceSnapshotId: string;
  readonly priceSnapshotHash: string;
  readonly priceEntryId: string | null;
  readonly cost: CallCost;
}

export interface ResourceCharge {
  readonly chargeId: string;
  readonly provider: string;
  readonly currency: 'USD';
  readonly source: 'PROVIDER_REPORTED' | 'UNKNOWN';
  readonly category: 'INFERENCE_HOSTING' | 'APP_HOSTING' | 'IDLE' | 'STARTUP' | 'WARMUP';
  readonly amountUsd: string | null;
  readonly evidenceHash: string | null;
  readonly coveredAttemptIds: readonly string[];
  readonly allocationRuleId: string;
  readonly allocations: readonly {
    readonly executionId: string;
    readonly phase: CallPhase;
    readonly weight: number;
  }[];
  readonly unallocatedWeight: number;
}
