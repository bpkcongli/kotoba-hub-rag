import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  accountingInput,
  callRow,
  execution,
  fixturePrices,
  fixtureUsage,
  measurement,
} from '@tests/__fixtures__/accounting-fixture';
import { ObservationStore } from '@/bootstrap/observation-store';
import {
  parseMeasurement,
  parsePriceSnapshot,
  parseTokenUsage,
} from '@/modules/observability/application/accounting-schema';
import {
  aggregateAccounting,
  allocateResource,
  wireCost,
} from '@/modules/observability/application/aggregation';
import { parseTraceEvent } from '@/modules/observability/application/events';
import {
  accountCall,
  normalizeResponseUsage,
  priceSnapshotHash,
} from '@/modules/observability/application/pricing';
import type { ResourceCharge } from '@/modules/observability/domain/accounting-types';
import { decimalUnits, priceAmount } from '@/modules/observability/domain/money';
import { loadPriceSnapshot } from '@/modules/observability/interface/secondary/files/price-snapshot';
import { readHfConfig } from '@/modules/rag/infrastructure/config/hf-config';
import type { InferenceAttempt } from '@/modules/rag/interface/secondary/inference/hf-inference';
import { createHfInference } from '@/modules/rag/interface/secondary/inference/hf-inference';

await test('token cache read/write tidak dihitung ulang; reasoning sudah termasuk output', () => {
  const call = accountCall(measurement(), fixturePrices);

  assert.ok(call.cost.kind === 'PER_CALL');
  assert.deepEqual(
    call.cost.components.map((row) => row.quantity),
    ['700', '200', '100', '300'],
  );
  assert.equal(call.cost.totalUsd, '0.003');
  assert.equal(call.cost.knownSubtotalUsd, '0.003');
  assert.equal(call.cost.status, 'KNOWN');
  assert.equal(call.cost.origin, 'TARIFF_ESTIMATE');
});

await test('missing cache/usage/rate tetap null dan subtotal bagian yang teramati dipertahankan', () => {
  const call = accountCall(
    measurement({ usage: { ...fixtureUsage, cacheWriteInputTokens: null } }),
    fixturePrices,
  );
  const absent = accountCall(measurement({ usage: null }), fixturePrices);
  const unknownRate = accountCall(measurement({ provider: 'unconfigured' }), fixturePrices);

  assert.ok(
    call.cost.kind === 'PER_CALL' &&
      absent.cost.kind === 'PER_CALL' &&
      unknownRate.cost.kind === 'PER_CALL',
  );
  assert.equal(call.cost.totalUsd, null);
  assert.equal(call.cost.knownSubtotalUsd, '0.0013');
  assert.equal(call.cost.status, 'PARTIAL');
  assert.equal(absent.cost.status, 'UNKNOWN');
  assert.equal(unknownRate.cost.totalUsd, null);
  assert.equal(unknownRate.cost.reason, 'NO_MATCHING_PRICE');
});

await test('normalizer Responses mempertahankan missing; cache/output/total malformed ditolak', () => {
  const usage = normalizeResponseUsage({
    input_tokens: 1000,
    input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
    output_tokens: 300,
    output_tokens_details: { reasoning_tokens: 50 },
    total_tokens: 1300,
    raw_body: 'secret-not-extracted',
  });

  assert.deepEqual(usage, fixtureUsage);
  assert.equal(normalizeResponseUsage(null), null);
  assert.equal(normalizeResponseUsage({ input_tokens: 1000 })?.cachedInputTokens, null);
  assert.equal(normalizeResponseUsage({ input_tokens: 1000 })?.cacheWriteInputTokens, null);
  assert.throws(() => normalizeResponseUsage({ input_tokens: '1000' }));
  assert.throws(() => parseTokenUsage({ ...fixtureUsage, cachedInputTokens: 950 }));
  assert.throws(() => parseTokenUsage({ ...fixtureUsage, reasoningTokens: 301 }));
  assert.throws(() => parseTokenUsage({ ...fixtureUsage, totalTokens: 1350 }));
  assert.throws(() => parseTokenUsage({ ...fixtureUsage, outputTokens: NaN }));
});

await test('price scope mengikat provider/model/purpose/profile/waktu dan ceiling; overlap snapshot ditolak', () => {
  for (const override of [
    { timestamp: '2026-11-24T23:59:59Z' },
    { billingProfile: 'priority' },
    { model: 'other-model' },
    { usage: { ...fixtureUsage, inputTokens: 272001, totalTokens: 272301 } },
  ]) {
    const call = accountCall(measurement(override), fixturePrices);

    assert.ok(call.cost.kind === 'PER_CALL');
    assert.equal(call.cost.totalUsd, null);
  }

  assert.throws(() =>
    parsePriceSnapshot({
      ...fixturePrices,
      entries: [...fixturePrices.entries, { ...fixturePrices.entries[0], id: 'overlap' }],
    }),
  );
  assert.throws(() => parsePriceSnapshot({ ...fixturePrices, currency: 'IDR' }));
  assert.throws(() =>
    parsePriceSnapshot({
      ...fixturePrices,
      entries: [{ ...fixturePrices.entries[0], sourceUrl: 'https://host/path?token=secret' }],
    }),
  );
  assert.equal(
    priceSnapshotHash(fixturePrices),
    priceSnapshotHash({
      entries: fixturePrices.entries,
      currency: fixturePrices.currency,
      asOf: fixturePrices.asOf,
      id: fixturePrices.id,
      schemaVersion: fixturePrices.schemaVersion,
    }),
  );
});

await test('billable compute aktual dihitung presisi; client duration/itemCount bukan pengganti quantity provider', () => {
  const base = measurement({
    purpose: 'rerank',
    model: 'fixture-bge',
    billingProfile: 'fixture-compute',
    usage: null,
    billableUnits: [{ unit: 'COMPUTE_SECOND', quantity: '0.125', evidenceHash: 'a'.repeat(64) }],
  });
  const known = accountCall(base, fixturePrices);
  const missing = accountCall(
    { ...base, billableUnits: [{ unit: 'COMPUTE_SECOND', quantity: null, evidenceHash: null }] },
    fixturePrices,
  );

  assert.ok(known.cost.kind === 'PER_CALL' && missing.cost.kind === 'PER_CALL');
  assert.equal(known.cost.totalUsd, '0.0005');
  assert.equal(missing.cost.totalUsd, null);
  assert.throws(() =>
    parseMeasurement({
      ...base,
      billableUnits: [{ unit: 'COMPUTE_SECOND', quantity: '0.125', evidenceHash: null }],
    }),
  );
  assert.equal(priceAmount('0.1', '0.2', 1), '0.02');
  assert.equal(priceAmount('1', '0.000000000001', 2), '0.000000000001');
});

await test('provider-reported charge menggantikan estimasi, termasuk billed failure yang usage-nya missing', () => {
  const call = accountCall(
    measurement({
      usage: null,
      reportedCost: { amountUsd: '0.008', evidenceHash: 'b'.repeat(64) },
    }),
    fixturePrices,
  );

  assert.ok(call.cost.kind === 'PER_CALL');
  assert.equal(call.cost.origin, 'PROVIDER_REPORTED');
  assert.equal(call.cost.totalUsd, '0.008');
  assert.equal(call.cost.components.length, 1);
});

await test('seluruh retry dan rewrite masuk online sekali; replay identik diabaikan dan attempt konflik ditolak', () => {
  const spec = execution();
  const first = callRow(spec.executionId);
  const rows = [
    first,
    callRow(spec.executionId, { retryKind: 'PROVIDER_RETRY' }),
    callRow(spec.executionId, { retryKind: 'SCHEMA_RETRY', purpose: 'repair' }),
    callRow(spec.executionId, { purpose: 'rewrite' }),
  ];
  const summary = aggregateAccounting(
    accountingInput({ executions: [spec], calls: [...rows, first] }),
  );
  const online = summary.run.phases.ONLINE;

  assert.equal(online.cost.totalUsd, '0.012');
  assert.equal(online.callCount, 4);
  assert.equal(online.providerRetryCount, 1);
  assert.equal(online.schemaRetryCount, 1);
  assert.equal(online.llmTokens.totalTokens.total, 5200);
  assert.equal(summary.replayRowsIgnored, 1);
  assert.equal(wireCost(summary.run).total_online_usd, 0.012);

  const conflict = callRow(spec.executionId, {
    attemptId: first.accounting.attemptId,
    purpose: 'recommend',
  });

  assert.throws(() =>
    aggregateAccounting(accountingInput({ executions: [spec], calls: [first, conflict] })),
  );
  assert.throws(() =>
    aggregateAccounting({
      ...accountingInput({ executions: [spec] }),
      calls: [{ executionId: spec.executionId, summary: online }],
    }),
  );
});

await test('parent onboarding menjumlahkan child raw calls sekali dan missing child menjaga total null', () => {
  const one = execution();
  const two = execution();
  const rows = [
    callRow(one.executionId, { purpose: 'normalize' }),
    callRow(two.executionId, { purpose: 'recommend' }),
  ];
  const parent = {
    parentId: 'case-onboarding-1',
    mode: 'ADAPTIVE' as const,
    executionIds: [one.executionId, two.executionId],
    missingOperationCount: 0,
    noCallEvidenceHash: null,
  };
  const summary = aggregateAccounting(
    accountingInput({ executions: [one, two], calls: rows, parents: [parent] }),
  );

  assert.equal(summary.parents[parent.parentId]?.phases.ONLINE.cost.totalUsd, '0.006');
  assert.equal(summary.runTotal.totalUsd, '0.006');

  assert.ok(rows[0]);

  const missing = aggregateAccounting(
    accountingInput({ executions: [one], calls: [rows[0]], parents: [parent] }),
  );

  assert.equal(missing.parents[parent.parentId]?.phases.ONLINE.cost.totalUsd, null);
  assert.equal(missing.parents[parent.parentId]?.phases.ONLINE.cost.knownSubtotalUsd, '0.003');
  assert.throws(() =>
    aggregateAccounting(
      accountingInput({
        executions: [one, two],
        calls: rows,
        parents: [parent, { ...parent, parentId: 'other' }],
      }),
    ),
  );
});

await test('hosting yang mencakup call dihitung sekali; alokasi child/parent/run dan residual utuh', () => {
  const one = execution();
  const two = execution();
  const chargeId = randomUUID();
  const rows = [
    callRow(one.executionId, { hostingChargeId: chargeId }),
    callRow(two.executionId, { hostingChargeId: chargeId }),
  ];
  const hosting: ResourceCharge = {
    chargeId,
    provider: 'fixture-host',
    currency: 'USD',
    source: 'PROVIDER_REPORTED',
    category: 'INFERENCE_HOSTING',
    amountUsd: '10',
    evidenceHash: 'c'.repeat(64),
    coveredAttemptIds: rows.map((row) => row.accounting.attemptId),
    allocationRuleId: 'pilot-weights-v1',
    allocations: [
      { executionId: one.executionId, phase: 'ONLINE', weight: 1 },
      { executionId: two.executionId, phase: 'ONLINE', weight: 3 },
    ],
    unallocatedWeight: 0,
  };
  const idle: ResourceCharge = {
    ...hosting,
    chargeId: randomUUID(),
    category: 'IDLE',
    amountUsd: '1',
    coveredAttemptIds: [],
    allocations: [{ executionId: one.executionId, phase: 'ONLINE', weight: 1 }],
    unallocatedWeight: 1,
  };
  const summary = aggregateAccounting(
    accountingInput({
      executions: [one, two],
      calls: rows,
      resources: [hosting, idle],
      parents: [
        {
          parentId: 'parent',
          mode: 'ADAPTIVE',
          executionIds: [one.executionId, two.executionId],
          missingOperationCount: 0,
          noCallEvidenceHash: null,
        },
      ],
    }),
  );

  assert.equal(summary.executions[one.executionId]?.phases.ONLINE.cost.totalUsd, '3');
  assert.equal(summary.executions[two.executionId]?.phases.ONLINE.cost.totalUsd, '7.5');
  assert.equal(summary.parents.parent?.phases.ONLINE.cost.totalUsd, '10.5');
  assert.equal(summary.runTotal.totalUsd, '11');
  assert.equal(summary.unallocatedResources[0]?.amountUsd, '0.5');
  assert.equal(summary.run.phases.ONLINE.byPurpose.generate.totalUsd, null);
  assert.equal(summary.run.phases.ONLINE.hostedCallCount, 2);
  assert.throws(() =>
    aggregateAccounting(accountingInput({ executions: [one, two], calls: rows, resources: [] })),
  );

  const allocation = allocateResource({
    ...hosting,
    amountUsd: '0.000000000001',
    allocations: hosting.allocations.map((row) => ({ ...row, weight: 1 })),
    unallocatedWeight: 1,
  });

  assert.equal(
    allocation.reduce((sum, row) => sum + decimalUnits(row.amountUsd ?? '0'), 0n),
    1n,
  );
  assert.throws(() =>
    accountCall(
      measurement({
        hostingChargeId: chargeId,
        reportedCost: { amountUsd: '1', evidenceHash: 'c'.repeat(64) },
      }),
      fixturePrices,
    ),
  );
});

await test('document indexing, judge, warmup dan startup terpisah dari online call cost', () => {
  const spec = execution();
  const rows = [
    callRow(spec.executionId),
    callRow(spec.executionId, { purpose: 'judge', phase: 'JUDGE' }),
    callRow(spec.executionId, { phase: 'WARMUP' }),
    callRow(spec.executionId, {
      purpose: 'document',
      phase: 'DOCUMENT_INDEXING',
      model: 'fixture-bge',
      billingProfile: 'fixture-compute',
      usage: null,
      billableUnits: [{ unit: 'COMPUTE_SECOND', quantity: '1', evidenceHash: 'a'.repeat(64) }],
    }),
  ];
  const startup: ResourceCharge = {
    chargeId: randomUUID(),
    provider: 'fixture-host',
    currency: 'USD',
    source: 'UNKNOWN',
    category: 'STARTUP',
    amountUsd: null,
    evidenceHash: null,
    coveredAttemptIds: [],
    allocationRuleId: 'startup-v1',
    allocations: [],
    unallocatedWeight: 1,
  };
  const summary = aggregateAccounting(
    accountingInput({ executions: [spec], calls: rows, resources: [startup] }),
  );

  assert.equal(summary.run.phases.ONLINE.cost.totalUsd, '0.003');
  assert.equal(summary.run.phases.JUDGE.cost.totalUsd, '0.003');
  assert.equal(summary.run.phases.WARMUP.cost.totalUsd, '0.003');
  assert.equal(summary.run.phases.DOCUMENT_INDEXING.cost.totalUsd, '0.004');
  assert.equal(summary.runTotal.totalUsd, null);
  assert.equal(summary.runTotal.knownSubtotalUsd, '0.013');
  assert.equal(summary.unallocatedResources[0]?.category, 'STARTUP');
  assert.throws(() => parseMeasurement(measurement({ purpose: 'document' })));
});

await test('nol hanya pada inventory lengkap; unknown execution/resource menjaga null dan known subtotal', () => {
  const spec = execution();
  const complete = aggregateAccounting(accountingInput({ executions: [spec] }));
  const unknown = aggregateAccounting(
    accountingInput({ executions: [{ ...spec, closed: false, traceComplete: false }] }),
  );
  const resourceMissing = aggregateAccounting(
    accountingInput({
      executions: [spec],
      calls: [callRow(spec.executionId)],
      resourceInventoryComplete: false,
    }),
  );

  assert.equal(complete.run.phases.ONLINE.cost.totalUsd, '0');
  assert.equal(complete.run.phases.ONLINE.llmTokens.totalTokens.total, 0);
  assert.equal(unknown.run.phases.ONLINE.cost.totalUsd, null);
  assert.equal(unknown.run.phases.ONLINE.cost.status, 'UNKNOWN');
  assert.equal(unknown.run.phases.ONLINE.llmTokens.totalTokens.total, null);
  assert.equal(resourceMissing.run.phases.ONLINE.cost.totalUsd, null);
  assert.equal(resourceMissing.run.phases.ONLINE.cost.knownSubtotalUsd, '0.003');
  assert.equal(resourceMissing.run.phases.ONLINE.cost.status, 'PARTIAL');
  assert.throws(() =>
    aggregateAccounting(
      accountingInput({
        executions: [{ ...spec, mode: 'LLM_ONLY' }],
        calls: [
          callRow(spec.executionId, {
            purpose: 'query',
            model: 'fixture-bge',
            billingProfile: 'fixture-compute',
            usage: null,
          }),
        ],
      }),
    ),
  );
});

await test('ledger/snapshot yang tidak cocok ditolak; default snapshot mempertahankan HF unknown', async () => {
  const spec = execution();
  const row = callRow(spec.executionId);
  const changed = {
    ...fixturePrices,
    entries: fixturePrices.entries.map((entry) =>
      entry.kind === 'TOKENS' ? { ...entry, inputPerMillionUsd: '4' } : entry,
    ),
  };

  assert.throws(() =>
    aggregateAccounting(
      accountingInput({ executions: [spec], calls: [row], priceSnapshots: [changed] }),
    ),
  );

  const prices = await loadPriceSnapshot();

  assert.equal(prices.entries.length, 4);
  assert.ok(
    prices.entries
      .filter((entry) => entry.provider === 'hf-inference')
      .every((entry) => entry.kind === 'UNIT' && entry.priceUsd === null),
  );
  assert.ok(
    prices.entries.some(
      (entry) =>
        entry.model === 'gpt-5.6-terra' &&
        entry.kind === 'TOKENS' &&
        entry.inputPerMillionUsd === '2',
    ),
  );
});

await test('request/pair units dan batas waktu tarif eksplisit tanpa asumsi gratis untuk missing', () => {
  const base = fixturePrices.entries.find((entry) => entry.kind === 'UNIT');

  assert.ok(base?.kind === 'UNIT');

  for (const unit of ['REQUEST', 'DOCUMENT_PAIR'] as const) {
    const prices = {
      ...fixturePrices,
      id: `fixture-${unit}`,
      entries: [
        { ...base, unit, perUnits: 2, priceUsd: '0.01', effectiveUntil: '2026-11-25T02:00:00Z' },
      ],
    };
    const input = measurement({
      purpose: 'rerank',
      model: 'fixture-bge',
      billingProfile: 'fixture-compute',
      usage: null,
      billableUnits: [{ unit, quantity: '3', evidenceHash: 'a'.repeat(64) }],
    });
    const priced = accountCall(input, prices);
    const expired = accountCall({ ...input, timestamp: '2026-11-25T02:00:00Z' }, prices);
    const zero = accountCall(
      { ...input, billableUnits: [{ unit, quantity: '0', evidenceHash: 'a'.repeat(64) }] },
      { ...prices, entries: [{ ...prices.entries[0], priceUsd: null }] },
    );

    assert.ok(
      priced.cost.kind === 'PER_CALL' &&
        expired.cost.kind === 'PER_CALL' &&
        zero.cost.kind === 'PER_CALL',
    );
    assert.equal(priced.cost.totalUsd, '0.015');
    assert.equal(expired.cost.totalUsd, null);
    assert.equal(zero.cost.totalUsd, '0');
  }
});

await test('parent tanpa execution memerlukan bukti no-call untuk biaya nol', () => {
  const parent = {
    parentId: 'rejected',
    mode: 'LLM_ONLY' as const,
    executionIds: [],
    missingOperationCount: 0,
    noCallEvidenceHash: 'a'.repeat(64),
  };
  const proven = aggregateAccounting(accountingInput({ parents: [parent] }));
  const missing = aggregateAccounting(
    accountingInput({ parents: [{ ...parent, noCallEvidenceHash: null }] }),
  );

  assert.equal(proven.parents.rejected?.phases.ONLINE.cost.totalUsd, '0');
  assert.equal(missing.parents.rejected?.phases.ONLINE.cost.totalUsd, null);
  assert.equal(missing.runTotal.totalUsd, null);
});

await test('metadata retry/warmup HF disalin sebelum await dan phase invalid tidak mengirim transport', async () => {
  const config = readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-token' });

  assert.ok(config);

  let release: ((response: Response) => void) | undefined;
  let calls = 0;
  const attempts: InferenceAttempt[] = [];
  const adapter = createHfInference(config, {
    fetch: () => {
      calls++;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    },
    onAttempt: (attempt) => {
      attempts.push(attempt);
      return Promise.resolve();
    },
  });

  const metadata = { phase: 'WARMUP' as const, retryKind: 'PROVIDER_RETRY' as const };
  const context = {
    executionId: randomUUID(),
    deadlineAt: new Date(Date.now() + 5000).toISOString(),
    signal: new AbortController().signal,
    accounting: metadata,
  };
  const pending = adapter.embedding.embed(['日本語'], 'query', context);
  Object.assign(metadata, { phase: 'ONLINE', retryKind: 'INITIAL' });
  release?.(
    new Response(JSON.stringify([Array.from({ length: 1024 }, () => 1 / 32)]), { status: 200 }),
  );
  await pending;

  assert.deepEqual(attempts[0]?.accountingContext, {
    phase: 'WARMUP',
    retryKind: 'PROVIDER_RETRY',
  });

  await assert.rejects(
    adapter.embedding.embed(['日本語'], 'query', {
      ...context,
      accounting: { phase: 'JUDGE', retryKind: 'INITIAL' },
    }),
    { code: 'INVALID_INPUT' },
  );

  assert.equal(calls, 1);

  adapter.close();
});

await test('store menyalin snapshot, menyimpan ledger baru, membaca legacy tanpa backfill dan ekspor CLI tanpa provider', async (t) => {
  const path = await mkdtemp(join(tmpdir(), 'kotoba-obs02-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const mutablePrices = structuredClone(fixturePrices);
  const store = new ObservationStore(path, undefined, { priceSnapshot: mutablePrices });

  assert.ok(mutablePrices.entries[0]);

  Object.assign(mutablePrices.entries[0], { inputPerMillionUsd: '999' });
  const admitted = await store.admit({
    serviceId: 'fixture',
    requestId: randomUUID(),
    operation: 'generate',
    mode: 'ADAPTIVE',
    request: {},
  });
  const id = admitted.correlation.executionId;

  assert.ok(id);

  const accounting = await store.priceCall(measurement());

  await store.record(
    id,
    {
      kind: 'model_attempt',
      attemptId: accounting.attemptId,
      purpose: accounting.purpose,
      provider: accounting.provider,
      model: accounting.model,
      configVersion: 'fixture',
      configurationHash: 'd'.repeat(64),
      endpointHash: 'e'.repeat(64),
      profile: null,
      servedRevision: null,
      itemCount: 1,
      httpStatus: 503,
      retryAfterMs: null,
      providerRequestIdHash: null,
      errorCode: 'PROVIDER_FAILED',
      remoteOutcome: 'response_received',
      accounting,
    },
    3,
    accounting.timestamp,
  );
  await store.finish(id, 'FAILED', 'PROVIDER_FAILED');
  const resource: ResourceCharge = {
    chargeId: randomUUID(),
    provider: 'fixture-host',
    currency: 'USD',
    source: 'PROVIDER_REPORTED',
    category: 'STARTUP',
    amountUsd: '0',
    evidenceHash: 'a'.repeat(64),
    coveredAttemptIds: [],
    allocationRuleId: 'startup-v1',
    allocations: [],
    unallocatedWeight: 1,
  };
  await store.recordResource(resource);
  await store.recordResource(resource);

  await assert.rejects(store.recordResource({ ...resource, amountUsd: '1' }), {
    code: 'TRACE_WRITE_FAILED',
  });

  const ledger = await store.exportAccounting(true);
  const current = aggregateAccounting(ledger.input);
  await store.close();

  assert.equal(ledger.unaccountedAttemptIds.length, 0);
  assert.equal(current.runTotal.totalUsd, '0.003');
  assert.equal((await readdir(join(path, 'prices'))).length, 1);
  assert.equal((await readdir(join(path, 'resources'))).length, 1);

  const changedIdentity = new ObservationStore(path, undefined, { priceSnapshot: mutablePrices });

  await assert.rejects(changedIdentity.priceCall(measurement()), { code: 'TRACE_WRITE_FAILED' });

  await changedIdentity.close();
  const cli = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/bootstrap/cost-cli.ts',
      '--directory',
      path,
      '--resource-inventory-complete',
    ],
    { encoding: 'utf8', timeout: 15000 },
  );

  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /"totalUsd":"0.003"/);

  // Recreate a historical v1 fixture in this temporary registry only.
  const tracePath = join(path, 'events', `${id}.jsonl`);
  const lines = (await readFile(tracePath, 'utf8'))
    .trimEnd()
    .split('\n')
    .map((line) => {
      const raw: unknown = JSON.parse(line);
      const event = parseTraceEvent(raw);

      if (event.data.kind === 'model_attempt') {
        const { data } = event;

        assert.ok('accounting' in data);

        const { accounting: _accounting, ...legacy } = data;
        void _accounting;

        return {
          ...event,
          schemaVersion: 'obs-01-v1',
          data: { ...legacy, usage: null, costUsd: null },
        };
      }

      return { ...event, schemaVersion: 'obs-01-v1' };
    });

  await writeFile(tracePath, `${lines.map((row) => JSON.stringify(row)).join('\n')}\n`);

  for (const folder of ['admissions', 'terminals']) {
    for (const filename of await readdir(join(path, folder))) {
      const event = parseTraceEvent(
        JSON.parse(await readFile(join(path, folder, filename), 'utf8')),
      );

      await writeFile(
        join(path, folder, filename),
        JSON.stringify({ ...event, schemaVersion: 'obs-01-v1' }),
      );
    }
  }

  const historical = new ObservationStore(path);
  const legacy = await historical.exportAccounting(true);
  const summary = aggregateAccounting(legacy.input);
  await historical.close();

  assert.deepEqual(legacy.unaccountedAttemptIds, [accounting.attemptId]);
  assert.equal(summary.runTotal.totalUsd, null);
  assert.equal(summary.run.complete, false);
});
