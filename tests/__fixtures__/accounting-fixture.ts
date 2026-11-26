import { randomUUID } from 'node:crypto';

import type { CallMeasurement, PriceSnapshot, TokenUsage } from '@/observability/accounting-types';
import type { AccountingInput, CallRow, ExecutionSpec } from '@/observability/aggregation';
import { accountCall } from '@/observability/pricing';

// Synthetic tariffs for hand calculations; never selected as runtime provider configuration.
export const fixturePrices: PriceSnapshot = {
  schemaVersion: 'obs-02-prices-v1',
  id: 'synthetic-obs02-v1',
  asOf: '2026-11-25',
  currency: 'USD',
  entries: [
    {
      id: 'fixture-tokens',
      provider: 'fixture',
      model: 'fixture-llm',
      purposes: ['generate', 'evaluate', 'normalize', 'recommend', 'rewrite', 'repair', 'judge'],
      billingProfile: 'fixture-tokens',
      sourceUrl: 'https://example.org/synthetic-prices',
      effectiveFrom: '2026-11-25T00:00:00Z',
      effectiveUntil: null,
      kind: 'TOKENS',
      maxInputTokens: 272000,
      inputPerMillionUsd: '2',
      cachedInputPerMillionUsd: '0.5',
      cacheWriteInputPerMillionUsd: '3',
      outputPerMillionUsd: '4',
    },
    {
      id: 'fixture-compute',
      provider: 'fixture',
      model: 'fixture-bge',
      purposes: ['query', 'document', 'rerank'],
      billingProfile: 'fixture-compute',
      sourceUrl: 'https://example.org/synthetic-prices',
      effectiveFrom: '2026-11-25T00:00:00Z',
      effectiveUntil: null,
      kind: 'UNIT',
      unit: 'COMPUTE_SECOND',
      perUnits: 1,
      priceUsd: '0.004',
    },
  ],
};

export const fixtureUsage: TokenUsage = {
  inputTokens: 1000,
  cachedInputTokens: 200,
  cacheWriteInputTokens: 100,
  outputTokens: 300,
  reasoningTokens: 50,
  totalTokens: 1300,
};

export function measurement(overrides: Partial<CallMeasurement> = {}): CallMeasurement {
  return {
    attemptId: randomUUID(),
    purpose: 'generate',
    phase: 'ONLINE',
    retryKind: 'INITIAL',
    provider: 'fixture',
    model: 'fixture-llm',
    billingProfile: 'fixture-tokens',
    timestamp: '2026-11-25T01:00:00Z',
    usage: fixtureUsage,
    billableUnits: [],
    reportedCost: null,
    hostingChargeId: null,
    ...overrides,
  };
}

export function callRow(executionId: string, overrides: Partial<CallMeasurement> = {}): CallRow {
  return { executionId, accounting: accountCall(measurement(overrides), fixturePrices) };
}

export function execution(
  executionId = randomUUID(),
  overrides: Partial<ExecutionSpec> = {},
): ExecutionSpec {
  return { executionId, mode: 'ADAPTIVE', closed: true, traceComplete: true, ...overrides };
}

export function accountingInput(overrides: Partial<AccountingInput> = {}): AccountingInput {
  return {
    executions: [],
    calls: [],
    resources: [],
    resourceInventoryComplete: true,
    parents: [],
    priceSnapshots: [fixturePrices],
    ...overrides,
  };
}
