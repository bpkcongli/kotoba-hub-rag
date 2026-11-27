import { Ajv } from 'ajv';
import { default as formats } from 'ajv-formats';
import type {
  CallAccounting,
  CallMeasurement,
  PriceSnapshot,
  ResourceCharge,
  TokenUsage,
} from '@/modules/observability/domain/accounting-types';
import { decimalUnits, priceAmount } from '@/modules/observability/domain/money';

export const accountingObject = (properties: Record<string, unknown>): object => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const object = accountingObject;
const nullable = (schema: object): object => ({ anyOf: [schema, { type: 'null' }] });
const label = { type: 'string', maxLength: 200, pattern: '^[A-Za-z0-9][A-Za-z0-9_./:@-]*$' };
const uuid = { type: 'string', format: 'uuid' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const decimal = { type: 'string', pattern: '^(0|[1-9]\\d{0,11})(\\.\\d{1,12})?$' };
const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const positive = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const timestamp = { type: 'string', format: 'date-time', pattern: 'Z$' };
const purposes = [
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
const units = ['REQUEST', 'DOCUMENT_PAIR', 'COMPUTE_SECOND'];

export const tokenUsageSchema = object({
  inputTokens: nullable(count),
  cachedInputTokens: nullable(count),
  cacheWriteInputTokens: nullable(count),
  outputTokens: nullable(count),
  reasoningTokens: nullable(count),
  totalTokens: nullable(count),
});

const measurementProperties = {
  attemptId: uuid,
  purpose: { enum: purposes },
  phase: { enum: ['ONLINE', 'DOCUMENT_INDEXING', 'JUDGE', 'WARMUP'] },
  retryKind: { enum: ['INITIAL', 'PROVIDER_RETRY', 'SCHEMA_RETRY'] },
  provider: label,
  model: label,
  billingProfile: label,
  timestamp,
  usage: nullable(tokenUsageSchema),
  billableUnits: {
    type: 'array',
    maxItems: 3,
    items: object({
      unit: { enum: units },
      quantity: nullable(decimal),
      evidenceHash: nullable(hash),
    }),
  },
  reportedCost: nullable(object({ amountUsd: decimal, evidenceHash: hash })),
  hostingChargeId: nullable(uuid),
};

const priceIdentity = {
  id: label,
  provider: label,
  model: label,
  purposes: {
    type: 'array',
    minItems: 1,
    maxItems: purposes.length,
    uniqueItems: true,
    items: { enum: purposes },
  },
  billingProfile: label,
  sourceUrl: { type: 'string', format: 'uri', maxLength: 2048 },
  effectiveFrom: timestamp,
  effectiveUntil: nullable(timestamp),
};

export const priceSnapshotSchema = object({
  schemaVersion: { const: 'obs-02-prices-v1' },
  id: label,
  asOf: { type: 'string', format: 'date' },
  currency: { const: 'USD' },
  entries: {
    type: 'array',
    minItems: 1,
    maxItems: 256,
    items: {
      oneOf: [
        object({
          ...priceIdentity,
          kind: { const: 'TOKENS' },
          maxInputTokens: positive,
          inputPerMillionUsd: nullable(decimal),
          cachedInputPerMillionUsd: nullable(decimal),
          cacheWriteInputPerMillionUsd: nullable(decimal),
          outputPerMillionUsd: nullable(decimal),
        }),
        object({
          ...priceIdentity,
          kind: { const: 'UNIT' },
          unit: { enum: units },
          perUnits: positive,
          priceUsd: nullable(decimal),
        }),
      ],
    },
  },
});

const summary = {
  totalUsd: nullable(decimal),
  knownSubtotalUsd: decimal,
  status: { enum: ['KNOWN', 'PARTIAL', 'UNKNOWN'] },
  knownComponents: count,
  unknownComponents: count,
};

export const callAccountingSchema = object({
  ...measurementProperties,
  schemaVersion: { const: 'obs-02-call-v1' },
  priceSnapshotId: label,
  priceSnapshotHash: hash,
  priceEntryId: nullable(label),
  cost: {
    oneOf: [
      object({
        ...summary,
        kind: { const: 'PER_CALL' },
        origin: { enum: ['TARIFF_ESTIMATE', 'PROVIDER_REPORTED', 'UNKNOWN'] },
        reason: {
          enum: ['PRICED', 'NO_MATCHING_PRICE', 'OUTSIDE_PRICE_SCOPE', 'MISSING_USAGE_OR_RATE'],
        },
        components: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: object({
            unit: label,
            quantity: nullable(decimal),
            rateUsd: nullable(decimal),
            perUnits: positive,
            amountUsd: nullable(decimal),
          }),
        },
      }),
      object({ kind: { const: 'HOSTING_INCLUDED' }, chargeId: uuid }),
    ],
  },
});

export const resourceChargeSchema = object({
  chargeId: uuid,
  provider: label,
  currency: { const: 'USD' },
  source: { enum: ['PROVIDER_REPORTED', 'UNKNOWN'] },
  category: { enum: ['INFERENCE_HOSTING', 'APP_HOSTING', 'IDLE', 'STARTUP', 'WARMUP'] },
  amountUsd: nullable(decimal),
  evidenceHash: nullable(hash),
  coveredAttemptIds: { type: 'array', uniqueItems: true, maxItems: 100000, items: uuid },
  allocationRuleId: label,
  allocations: {
    type: 'array',
    maxItems: 100000,
    items: object({
      executionId: uuid,
      phase: { enum: ['ONLINE', 'DOCUMENT_INDEXING', 'JUDGE', 'WARMUP'] },
      weight: positive,
    }),
  },
  unallocatedWeight: count,
});

const ajv = new Ajv({
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
formats.default(ajv);

const usageValidator = ajv.compile<TokenUsage>(tokenUsageSchema);
const measurementValidator = ajv.compile<CallMeasurement>(object(measurementProperties));
const priceValidator = ajv.compile<PriceSnapshot>(priceSnapshotSchema);
const callValidator = ajv.compile<CallAccounting>(callAccountingSchema);
const resourceValidator = ajv.compile<ResourceCharge>(resourceChargeSchema);

function invalid(): never {
  throw new Error('Accounting tidak valid');
}

export function parseTokenUsage(value: unknown): TokenUsage {
  if (!usageValidator(value)) {
    return invalid();
  }

  const {
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteInputTokens: written,
    outputTokens: output,
    reasoningTokens: reasoning,
    totalTokens: total,
  } = value;
  const minimumInput = input ?? (cached ?? 0) + (written ?? 0);
  const minimumOutput = output ?? reasoning ?? 0;

  if (
    (total !== null && minimumInput + minimumOutput > total) ||
    (input !== null && (cached ?? 0) + (written ?? 0) > input) ||
    (output !== null && reasoning !== null && reasoning > output) ||
    (input !== null && output !== null && total !== null && input + output !== total)
  ) {
    return invalid();
  }

  return structuredClone(value);
}

function checkMeasurement(value: CallMeasurement): void {
  if (value.usage !== null) {
    parseTokenUsage(value.usage);
  }

  if (
    (value.phase === 'ONLINE' && ['document', 'judge'].includes(value.purpose)) ||
    (value.phase === 'DOCUMENT_INDEXING' && value.purpose !== 'document') ||
    (value.phase === 'JUDGE' && value.purpose !== 'judge') ||
    (value.hostingChargeId !== null && value.reportedCost !== null) ||
    new Set(value.billableUnits.map((entry) => entry.unit)).size !== value.billableUnits.length ||
    value.billableUnits.some((entry) => entry.quantity !== null && entry.evidenceHash === null)
  ) {
    invalid();
  }
}

export function parseMeasurement(value: unknown): CallMeasurement {
  if (!measurementValidator(value)) {
    return invalid();
  }

  checkMeasurement(value);

  return structuredClone(value);
}

export function parsePriceSnapshot(value: unknown): PriceSnapshot {
  if (!priceValidator(value)) {
    return invalid();
  }

  if (new Set(value.entries.map((entry) => entry.id)).size !== value.entries.length) {
    return invalid();
  }

  for (const entry of value.entries) {
    const url = new URL(entry.sourceUrl);

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      (entry.effectiveUntil !== null &&
        Date.parse(entry.effectiveUntil) <= Date.parse(entry.effectiveFrom))
    ) {
      return invalid();
    }

    for (const other of value.entries) {
      if (
        other.id !== entry.id &&
        other.provider === entry.provider &&
        other.model === entry.model &&
        other.billingProfile === entry.billingProfile &&
        other.purposes.some((purpose) => entry.purposes.includes(purpose)) &&
        Date.parse(other.effectiveFrom) <
          (entry.effectiveUntil === null ? Infinity : Date.parse(entry.effectiveUntil)) &&
        Date.parse(entry.effectiveFrom) <
          (other.effectiveUntil === null ? Infinity : Date.parse(other.effectiveUntil))
      ) {
        return invalid();
      }
    }
  }

  return structuredClone(value);
}

export function parseCallAccounting(value: unknown): CallAccounting {
  if (!callValidator(value)) {
    return invalid();
  }

  checkMeasurement(value);

  if (value.cost.kind === 'HOSTING_INCLUDED') {
    if (value.cost.chargeId !== value.hostingChargeId) {
      return invalid();
    }
  } else {
    if (value.hostingChargeId !== null) {
      return invalid();
    }

    const known = value.cost.components.filter((entry) => entry.amountUsd !== null);
    const sum = known.reduce((total, entry) => total + decimalUnits(entry.amountUsd ?? '0'), 0n);
    const unknown = value.cost.components.length - known.length;

    for (const component of value.cost.components) {
      const expected =
        component.quantity === null
          ? null
          : decimalUnits(component.quantity) === 0n
            ? '0'
            : component.rateUsd === null
              ? null
              : priceAmount(component.quantity, component.rateUsd, component.perUnits);

      if (
        expected === null
          ? component.amountUsd !== null
          : component.amountUsd === null ||
            decimalUnits(expected) !== decimalUnits(component.amountUsd)
      ) {
        return invalid();
      }
    }

    if (
      decimalUnits(value.cost.knownSubtotalUsd) !== sum ||
      value.cost.knownComponents !== known.length ||
      value.cost.unknownComponents !== unknown ||
      value.cost.status !== (unknown === 0 ? 'KNOWN' : known.length > 0 ? 'PARTIAL' : 'UNKNOWN') ||
      (unknown === 0
        ? value.cost.totalUsd === null || decimalUnits(value.cost.totalUsd) !== sum
        : value.cost.totalUsd !== null)
    ) {
      return invalid();
    }
  }

  return structuredClone(value);
}

export function parseResourceCharge(value: unknown): ResourceCharge {
  if (!resourceValidator(value)) {
    return invalid();
  }

  const totalWeight = value.allocations.reduce(
    (sum, row) => sum + row.weight,
    value.unallocatedWeight,
  );

  if (
    !Number.isSafeInteger(totalWeight) ||
    totalWeight <= 0 ||
    new Set(value.allocations.map((row) => `${row.executionId}:${row.phase}`)).size !==
      value.allocations.length ||
    (value.category === 'WARMUP' && value.allocations.some((row) => row.phase !== 'WARMUP')) ||
    (value.category !== 'INFERENCE_HOSTING' && value.coveredAttemptIds.length > 0) ||
    (value.amountUsd !== null &&
      (value.evidenceHash === null || value.source !== 'PROVIDER_REPORTED'))
  ) {
    return invalid();
  }

  return structuredClone(value);
}
