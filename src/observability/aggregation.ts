import { Ajv } from 'ajv';
import { default as formats } from 'ajv-formats';
import type { Meta } from '@/contracts/v1.generated';
import type { Mode } from '@/contracts/validator';
import {
  accountingObject,
  callAccountingSchema,
  parseCallAccounting,
  parsePriceSnapshot,
  parseResourceCharge,
  priceSnapshotSchema,
  resourceChargeSchema,
} from '@/observability/accounting-schema';
import type {
  CallAccounting,
  CallPhase,
  CallPurpose,
  MonetarySummary,
  PriceSnapshot,
  ResourceCharge,
  TokenUsage,
} from '@/observability/accounting-types';
import { decimalString, decimalUnits } from '@/observability/money';
import {
  accountCall,
  measurementFromAccounting,
  monetarySummary,
  priceSnapshotHash,
  stableAccountingJson,
} from '@/observability/pricing';

export interface ExecutionSpec {
  readonly executionId: string;
  readonly mode: Mode;
  readonly closed: boolean;
  readonly traceComplete: boolean;
}

export interface CallRow {
  readonly executionId: string;
  readonly accounting: CallAccounting;
}

export interface ParentSpec {
  readonly parentId: string;
  readonly mode: Mode;
  readonly executionIds: readonly string[];
  readonly missingOperationCount: number;
  readonly noCallEvidenceHash: string | null;
}

export interface AccountingInput {
  readonly executions: readonly ExecutionSpec[];
  readonly calls: readonly CallRow[];
  readonly resources: readonly ResourceCharge[];
  readonly resourceInventoryComplete: boolean;
  readonly parents: readonly ParentSpec[];
  readonly priceSnapshots: readonly PriceSnapshot[];
}

export interface ResourceAllocation {
  readonly chargeId: string;
  readonly category: ResourceCharge['category'];
  readonly allocationRuleId: string;
  readonly executionId: string | null;
  readonly phase: CallPhase | null;
  readonly amountUsd: string | null;
}

interface TokenTotal {
  readonly total: number | null;
  readonly knownSubtotal: number;
  readonly missingCalls: number;
}

export interface PhaseSummary {
  readonly cost: MonetarySummary;
  readonly directCost: MonetarySummary;
  readonly byPurpose: Readonly<Record<CallPurpose, MonetarySummary>>;
  readonly resources: Readonly<Record<ResourceCharge['category'], MonetarySummary>>;
  readonly llmTokens: Readonly<Record<keyof TokenUsage, TokenTotal>>;
  readonly callCount: number;
  readonly providerRetryCount: number;
  readonly schemaRetryCount: number;
  readonly hostedCallCount: number;
  readonly tariffEstimatedCallCount: number;
  readonly providerReportedCallCount: number;
  readonly completelyPricedDirectCallCount: number;
}

export interface AccountingSummary {
  readonly complete: boolean;
  readonly phases: Readonly<Record<CallPhase, PhaseSummary>>;
}

const phases: readonly CallPhase[] = ['ONLINE', 'DOCUMENT_INDEXING', 'JUDGE', 'WARMUP'];
const purposes: readonly CallPurpose[] = [
  'document',
  'query',
  'rerank',
  'generate',
  'evaluate',
  'normalize',
  'recommend',
  'rewrite',
  'repair',
  'judge',
];
const resourceCategories: readonly ResourceCharge['category'][] = [
  'INFERENCE_HOSTING',
  'APP_HOSTING',
  'IDLE',
  'STARTUP',
  'WARMUP',
];
const tokenFields: readonly (keyof TokenUsage)[] = [
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'outputTokens',
  'reasoningTokens',
  'totalTokens',
];
const isLlm = (call: CallAccounting): boolean =>
  !['document', 'query', 'rerank'].includes(call.purpose);
const object = accountingObject;
const uuid = { type: 'string', format: 'uuid' };
const mode = { enum: ['LLM_ONLY', 'SINGLE_STAGE', 'ADAPTIVE'] };
const array = (items: object): object => ({ type: 'array', maxItems: 100000, items });

const ajv = new Ajv({
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
formats.default(ajv);

const validate = ajv.compile<AccountingInput>(
  object({
    executions: array(
      object({
        executionId: uuid,
        mode,
        closed: { type: 'boolean' },
        traceComplete: { type: 'boolean' },
      }),
    ),
    calls: array(object({ executionId: uuid, accounting: callAccountingSchema })),
    resources: array(resourceChargeSchema),
    resourceInventoryComplete: { type: 'boolean' },
    priceSnapshots: { type: 'array', maxItems: 256, items: priceSnapshotSchema },
    parents: array(
      object({
        parentId: { type: 'string', maxLength: 200, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' },
        mode,
        executionIds: { ...array(uuid), uniqueItems: true },
        missingOperationCount: { type: 'integer', minimum: 0, maximum: 100000 },
        noCallEvidenceHash: {
          anyOf: [{ type: 'string', pattern: '^[a-f0-9]{64}$' }, { type: 'null' }],
        },
      }),
    ),
  }),
);

function unique<T>(rows: readonly T[], key: (row: T) => string): void {
  if (new Set(rows.map(key)).size !== rows.length) {
    throw new Error('Identitas accounting duplikat');
  }
}

export function allocateResource(raw: unknown): readonly ResourceAllocation[] {
  const charge = parseResourceCharge(raw);
  const denominator = BigInt(
    charge.allocations.reduce((sum, row) => sum + row.weight, charge.unallocatedWeight),
  );
  const buckets: { key: string; executionId: string; phase: CallPhase | null; weight: number }[] =
    charge.allocations.map((row) => ({
      key: `${row.executionId}:${row.phase}`,
      executionId: row.executionId,
      phase: row.phase,
      weight: row.weight,
    }));

  if (charge.unallocatedWeight > 0) {
    buckets.push({
      key: '~unallocated',
      executionId: '',
      phase: null,
      weight: charge.unallocatedWeight,
    });
  }
  buckets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const amount = charge.amountUsd === null ? null : decimalUnits(charge.amountUsd);
  const amounts = buckets.map((bucket) =>
    amount === null ? null : (amount * BigInt(bucket.weight)) / denominator,
  );

  if (amount !== null) {
    let remainder = amount - amounts.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n);
    const ranked = buckets.map((bucket, index) => ({
      index,
      remainder: (amount * BigInt(bucket.weight)) % denominator,
    }));

    ranked.sort((a, b) =>
      a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.index - b.index,
    );

    for (const row of ranked) {
      if (remainder === 0n) {
        break;
      }

      amounts[row.index] = (amounts[row.index] ?? 0n) + 1n;
      remainder--;
    }
  }

  return buckets.map((bucket, index) => ({
    chargeId: charge.chargeId,
    category: charge.category,
    allocationRuleId: charge.allocationRuleId,
    executionId: bucket.executionId || null,
    phase: bucket.phase,
    amountUsd:
      amounts[index] === null || amounts[index] === undefined
        ? null
        : decimalString(amounts[index]),
  }));
}

function componentAmounts(
  calls: readonly CallAccounting[],
  hostedUnknown: boolean,
): (string | null)[] {
  return calls.flatMap((call) =>
    call.cost.kind === 'PER_CALL'
      ? call.cost.components.map((entry) => entry.amountUsd)
      : hostedUnknown
        ? [null]
        : [],
  );
}

function summarize(
  calls: readonly CallRow[],
  allocations: readonly ResourceAllocation[],
  callInventoryComplete: boolean,
  resourceInventoryComplete: boolean,
): AccountingSummary {
  const entries = phases.map((phase) => {
    const selected = calls
      .filter((row) => row.accounting.phase === phase)
      .map((row) => row.accounting);
    const resources = allocations.filter((row) => row.phase === phase);
    const direct = componentAmounts(selected, false);
    const llm = selected.filter(isLlm);
    const totals = tokenFields.map((field) => {
      const known = llm.flatMap((call) =>
        call.usage?.[field] === null || call.usage?.[field] === undefined
          ? []
          : [call.usage[field]],
      );
      const subtotal = known.reduce((sum, value) => sum + value, 0);

      if (!Number.isSafeInteger(subtotal)) {
        throw new Error('Token accounting overflow');
      }

      const missingCalls = llm.length - known.length + (callInventoryComplete ? 0 : 1);

      return [
        field,
        { total: missingCalls === 0 ? subtotal : null, knownSubtotal: subtotal, missingCalls },
      ] as const;
    });

    const byPurpose = Object.fromEntries(
      purposes.map((purpose) => [
        purpose,
        monetarySummary(
          componentAmounts(
            selected.filter((call) => call.purpose === purpose),
            true,
          ),
          callInventoryComplete,
        ),
      ]),
    ) as Record<CallPurpose, MonetarySummary>;
    const resourceTotals = Object.fromEntries(
      resourceCategories.map((category) => [
        category,
        monetarySummary(
          resources.filter((row) => row.category === category).map((row) => row.amountUsd),
          resourceInventoryComplete,
        ),
      ]),
    ) as Record<ResourceCharge['category'], MonetarySummary>;

    return [
      phase,
      {
        cost: monetarySummary(
          [...direct, ...resources.map((row) => row.amountUsd)],
          callInventoryComplete && resourceInventoryComplete,
        ),
        directCost: monetarySummary(direct, callInventoryComplete),
        byPurpose,
        resources: resourceTotals,
        llmTokens: Object.fromEntries(totals) as Record<keyof TokenUsage, TokenTotal>,
        callCount: selected.length,
        providerRetryCount: selected.filter((call) => call.retryKind === 'PROVIDER_RETRY').length,
        schemaRetryCount: selected.filter((call) => call.retryKind === 'SCHEMA_RETRY').length,
        hostedCallCount: selected.filter((call) => call.cost.kind === 'HOSTING_INCLUDED').length,
        tariffEstimatedCallCount: selected.filter(
          (call) => call.cost.kind === 'PER_CALL' && call.cost.origin === 'TARIFF_ESTIMATE',
        ).length,
        providerReportedCallCount: selected.filter(
          (call) => call.cost.kind === 'PER_CALL' && call.cost.origin === 'PROVIDER_REPORTED',
        ).length,
        completelyPricedDirectCallCount: selected.filter(
          (call) => call.cost.kind === 'PER_CALL' && call.cost.status === 'KNOWN',
        ).length,
      },
    ] as const;
  });

  return {
    complete: callInventoryComplete && resourceInventoryComplete,
    phases: Object.fromEntries(entries) as Record<CallPhase, PhaseSummary>,
  };
}

export function aggregateAccounting(raw: unknown): {
  readonly executions: Readonly<Record<string, AccountingSummary>>;
  readonly parents: Readonly<Record<string, AccountingSummary>>;
  readonly run: AccountingSummary;
  readonly runTotal: MonetarySummary;
  readonly unallocatedResources: readonly ResourceAllocation[];
  readonly replayRowsIgnored: number;
} {
  if (!validate(raw)) {
    throw new Error('Input agregasi accounting tidak valid');
  }

  const input = structuredClone(raw);
  unique(input.executions, (row) => row.executionId);
  unique(input.parents, (row) => row.parentId);
  unique(input.resources, (row) => row.chargeId);
  unique(input.priceSnapshots, (row) => row.id);

  const snapshots = new Map(
    input.priceSnapshots.map((snapshot) => {
      parsePriceSnapshot(snapshot);
      return [priceSnapshotHash(snapshot), snapshot];
    }),
  );

  const executionMap = new Map(input.executions.map((row) => [row.executionId, row]));
  const calls = new Map<string, CallRow>();
  let replayRowsIgnored = 0;

  for (const row of input.calls) {
    parseCallAccounting(row.accounting);
    const snapshot = snapshots.get(row.accounting.priceSnapshotHash);

    if (
      !snapshot ||
      stableAccountingJson(accountCall(measurementFromAccounting(row.accounting), snapshot)) !==
        stableAccountingJson(row.accounting)
    ) {
      throw new Error('Ledger tidak cocok dengan snapshot harga');
    }

    if (!executionMap.has(row.executionId)) {
      throw new Error('Execution call tidak dikenal');
    }

    const previous = calls.get(row.accounting.attemptId);

    if (previous) {
      if (stableAccountingJson(previous) !== stableAccountingJson(row)) {
        throw new Error('Attempt accounting konflik');
      }

      replayRowsIgnored++;
    } else {
      calls.set(row.accounting.attemptId, row);
    }
  }

  const allCalls = [...calls.values()];
  const allocations = input.resources.flatMap((charge) => {
    parseResourceCharge(charge);

    if (charge.allocations.some((row) => !executionMap.has(row.executionId))) {
      throw new Error('Target alokasi tidak dikenal');
    }

    for (const attemptId of charge.coveredAttemptIds) {
      const row = calls.get(attemptId);

      if (
        !row ||
        row.accounting.hostingChargeId !== charge.chargeId ||
        !charge.allocations.some(
          (allocation) =>
            allocation.executionId === row.executionId && allocation.phase === row.accounting.phase,
        )
      ) {
        throw new Error('Cakupan hosting tidak cocok');
      }
    }

    return allocateResource(charge);
  });

  for (const row of allCalls) {
    if (
      row.accounting.cost.kind === 'HOSTING_INCLUDED' &&
      !input.resources.some(
        (charge) =>
          charge.category === 'INFERENCE_HOSTING' &&
          charge.chargeId === row.accounting.hostingChargeId &&
          charge.coveredAttemptIds.includes(row.accounting.attemptId),
      )
    ) {
      throw new Error('Biaya hosting referensi belum direkonsiliasi');
    }

    const execution = executionMap.get(row.executionId);

    if (
      execution?.mode === 'LLM_ONLY' &&
      row.accounting.phase === 'ONLINE' &&
      ['query', 'rerank'].includes(row.accounting.purpose)
    ) {
      throw new Error('Call retrieval pada LLM_ONLY');
    }
  }

  const complete = (row: ExecutionSpec): boolean => row.closed && row.traceComplete;
  const executions = Object.fromEntries(
    input.executions.map((row) => [
      row.executionId,
      summarize(
        allCalls.filter((call) => call.executionId === row.executionId),
        allocations.filter((allocation) => allocation.executionId === row.executionId),
        complete(row),
        input.resourceInventoryComplete,
      ),
    ]),
  );
  const parentChildIds = new Set<string>();
  const parents = Object.fromEntries(
    input.parents.map((parent) => {
      if (parent.executionIds.length > 0 && parent.noCallEvidenceHash !== null) {
        throw new Error('Bukti no-call bertentangan dengan execution');
      }

      for (const executionId of parent.executionIds) {
        if (parentChildIds.has(executionId)) {
          throw new Error('Execution dihitung pada dua parent');
        }

        parentChildIds.add(executionId);
        const child = executionMap.get(executionId);

        if (child && child.mode !== parent.mode) {
          throw new Error('Mode parent dan child berbeda');
        }
      }

      const callComplete =
        parent.missingOperationCount === 0 &&
        (parent.executionIds.length > 0 || parent.noCallEvidenceHash !== null) &&
        parent.executionIds.every((id) => {
          const row = executionMap.get(id);
          return row !== undefined && complete(row);
        });

      return [
        parent.parentId,
        summarize(
          allCalls.filter((row) => parent.executionIds.includes(row.executionId)),
          allocations.filter(
            (row) => row.executionId !== null && parent.executionIds.includes(row.executionId),
          ),
          callComplete,
          input.resourceInventoryComplete,
        ),
      ];
    }),
  );

  const callInventoryComplete =
    input.executions.every(complete) &&
    input.parents.every(
      (parent) =>
        parent.missingOperationCount === 0 &&
        (parent.executionIds.length > 0 || parent.noCallEvidenceHash !== null) &&
        parent.executionIds.every((id) => executionMap.has(id)),
    );
  const run = summarize(
    allCalls,
    allocations,
    callInventoryComplete,
    input.resourceInventoryComplete,
  );
  const runTotal = monetarySummary(
    [
      ...componentAmounts(
        allCalls.map((row) => row.accounting),
        false,
      ),
      ...input.resources.map((charge) => charge.amountUsd),
    ],
    callInventoryComplete && input.resourceInventoryComplete,
  );

  return {
    executions,
    parents,
    run,
    runTotal,
    unallocatedResources: allocations.filter((row) => row.executionId === null),
    replayRowsIgnored,
  };
}

export function wireCost(summary: AccountingSummary): Meta['cost'] {
  const online = summary.phases.ONLINE;
  const llm = monetarySummary(
    purposes
      .filter((purpose) => !['query', 'rerank', 'document', 'judge'].includes(purpose))
      .flatMap((purpose) =>
        online.byPurpose[purpose].totalUsd === null
          ? [null, online.byPurpose[purpose].knownSubtotalUsd]
          : [online.byPurpose[purpose].totalUsd],
      ),
  );
  const number = (value: string | null): number | null => (value === null ? null : Number(value));

  return {
    currency: 'USD',
    inference_total_usd: number(llm.totalUsd),
    query_embedding_usd: number(online.byPurpose.query.totalUsd),
    rerank_usd: number(online.byPurpose.rerank.totalUsd),
    total_online_usd: number(online.cost.totalUsd),
    known_subtotal_usd: Number(online.cost.knownSubtotalUsd),
    status: online.cost.status,
  };
}
