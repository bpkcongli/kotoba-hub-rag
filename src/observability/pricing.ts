import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  parseCallAccounting,
  parseMeasurement,
  parsePriceSnapshot,
  parseTokenUsage,
} from '@/observability/accounting-schema';
import type {
  CallAccounting,
  CallCost,
  CallMeasurement,
  CostComponent,
  MonetarySummary,
  PriceSnapshot,
  TokenUsage,
} from '@/observability/accounting-types';
import { decimalString, decimalUnits, priceAmount } from '@/observability/money';

export function stableAccountingJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry: unknown) => stableAccountingJson(entry)).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableAccountingJson(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function priceSnapshotHash(snapshot: PriceSnapshot): string {
  return createHash('sha256')
    .update(stableAccountingJson(parsePriceSnapshot(snapshot)))
    .digest('hex');
}

export async function loadPriceSnapshot(
  path: URL | string = new URL('../../configs/pricing/obs-02-v1.json', import.meta.url),
): Promise<PriceSnapshot> {
  return parsePriceSnapshot(JSON.parse(await readFile(path, 'utf8')));
}

export function monetarySummary(
  amounts: readonly (string | null)[],
  complete = true,
): MonetarySummary {
  const known = amounts.filter((amount) => amount !== null);
  const unknownComponents = amounts.length - known.length + (complete ? 0 : 1);
  const subtotal = decimalString(known.reduce((sum, amount) => sum + decimalUnits(amount), 0n));

  return {
    totalUsd: unknownComponents === 0 ? subtotal : null,
    knownSubtotalUsd: subtotal,
    status: unknownComponents === 0 ? 'KNOWN' : known.length > 0 ? 'PARTIAL' : 'UNKNOWN',
    knownComponents: known.length,
    unknownComponents,
  };
}

function component(
  unit: string,
  quantity: string | null,
  rateUsd: string | null,
  perUnits: number,
): CostComponent {
  const amountUsd =
    quantity === null
      ? null
      : decimalUnits(quantity) === 0n
        ? '0'
        : rateUsd === null
          ? null
          : priceAmount(quantity, rateUsd, perUnits);

  return { unit, quantity, rateUsd, perUnits, amountUsd };
}

export function accountCall(raw: unknown, rawSnapshot: unknown): CallAccounting {
  const call = parseMeasurement(raw);
  const snapshot = parsePriceSnapshot(rawSnapshot);
  const matching = snapshot.entries.filter(
    (entry) =>
      entry.provider === call.provider &&
      entry.model === call.model &&
      entry.billingProfile === call.billingProfile &&
      entry.purposes.includes(call.purpose) &&
      Date.parse(call.timestamp) >= Date.parse(entry.effectiveFrom) &&
      (entry.effectiveUntil === null ||
        Date.parse(call.timestamp) < Date.parse(entry.effectiveUntil)),
  );

  if (matching.length > 1) {
    throw new Error('Tarif accounting ambigu');
  }

  const price = matching[0];
  let cost: CallCost;

  if (call.hostingChargeId !== null) {
    cost = { kind: 'HOSTING_INCLUDED', chargeId: call.hostingChargeId };
  } else if (call.reportedCost !== null) {
    const components = [component('PROVIDER_REPORTED_USD', '1', call.reportedCost.amountUsd, 1)];
    cost = {
      kind: 'PER_CALL',
      origin: 'PROVIDER_REPORTED',
      reason: 'PRICED',
      components,
      ...monetarySummary(components.map((entry) => entry.amountUsd)),
    };
  } else {
    let components: CostComponent[];
    let reason: Extract<CallCost, { kind: 'PER_CALL' }>['reason'] = 'PRICED';

    if (price === undefined) {
      components = [component('UNKNOWN_CALL', null, null, 1)];
      reason = 'NO_MATCHING_PRICE';
    } else if (price.kind === 'TOKENS') {
      const usage = call.usage;

      if (
        usage?.inputTokens === null ||
        usage?.inputTokens === undefined ||
        usage.inputTokens > price.maxInputTokens ||
        call.billableUnits.length > 0
      ) {
        components = [component('UNKNOWN_CALL', null, null, 1)];
        reason = 'OUTSIDE_PRICE_SCOPE';
      } else {
        const uncached =
          usage.cachedInputTokens === null || usage.cacheWriteInputTokens === null
            ? null
            : String(usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens);

        components = [
          component('UNCACHED_INPUT_TOKEN', uncached, price.inputPerMillionUsd, 1000000),
          component(
            'CACHED_INPUT_TOKEN',
            usage.cachedInputTokens?.toString() ?? null,
            price.cachedInputPerMillionUsd,
            1000000,
          ),
          component(
            'CACHE_WRITE_INPUT_TOKEN',
            usage.cacheWriteInputTokens?.toString() ?? null,
            price.cacheWriteInputPerMillionUsd,
            1000000,
          ),
          component(
            'OUTPUT_TOKEN',
            usage.outputTokens?.toString() ?? null,
            price.outputPerMillionUsd,
            1000000,
          ),
        ];
      }
    } else {
      if (call.billableUnits.some((entry) => entry.unit !== price.unit) || call.usage !== null) {
        components = [component('UNKNOWN_CALL', null, null, 1)];
        reason = 'OUTSIDE_PRICE_SCOPE';
      } else {
        components = [
          component(
            price.unit,
            call.billableUnits.find((entry) => entry.unit === price.unit)?.quantity ?? null,
            price.priceUsd,
            price.perUnits,
          ),
        ];
      }
    }

    const summary = monetarySummary(components.map((entry) => entry.amountUsd));
    cost = {
      kind: 'PER_CALL',
      origin: price === undefined ? 'UNKNOWN' : 'TARIFF_ESTIMATE',
      reason: reason === 'PRICED' && summary.status !== 'KNOWN' ? 'MISSING_USAGE_OR_RATE' : reason,
      components,
      ...summary,
    };
  }

  return parseCallAccounting({
    ...call,
    schemaVersion: 'obs-02-call-v1',
    priceSnapshotId: snapshot.id,
    priceSnapshotHash: priceSnapshotHash(snapshot),
    priceEntryId: price?.id ?? null,
    cost,
  });
}

export function measurementFromAccounting(call: CallAccounting): CallMeasurement {
  return {
    attemptId: call.attemptId,
    purpose: call.purpose,
    phase: call.phase,
    retryKind: call.retryKind,
    provider: call.provider,
    model: call.model,
    billingProfile: call.billingProfile,
    timestamp: call.timestamp,
    usage: call.usage,
    billableUnits: call.billableUnits,
    reportedCost: call.reportedCost,
    hostingChargeId: call.hostingChargeId,
  };
}

// Extract only usage fields from the Responses boundary; missing details never become zero.
export function normalizeResponseUsage(value: unknown): TokenUsage | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Usage provider tidak valid');
  }

  const root = value as Record<string, unknown>;
  const detail = (raw: unknown): Record<string, unknown> => {
    if (raw === undefined || raw === null) {
      return {};
    }

    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Usage provider tidak valid');
    }

    return raw as Record<string, unknown>;
  };
  const input = detail(root.input_tokens_details);
  const output = detail(root.output_tokens_details);

  return parseTokenUsage({
    inputTokens: root.input_tokens ?? null,
    cachedInputTokens: input.cached_tokens ?? null,
    cacheWriteInputTokens: input.cache_write_tokens ?? null,
    outputTokens: root.output_tokens ?? null,
    reasoningTokens: output.reasoning_tokens ?? null,
    totalTokens: root.total_tokens ?? null,
  });
}
