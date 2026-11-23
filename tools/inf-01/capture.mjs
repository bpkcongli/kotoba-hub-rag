import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { makePairProbePlan, makePlan, parsePairResponse } from './smoke.mjs';
import { parseHfDenseResponse, validateDiscovery } from './validate.mjs';

const base = new URL('../../docs/inference/runs/2026-11-23-hf-smoke-01/', import.meta.url);
const target = new URL('../../docs/inference/INF-01-manifest-v3.json', import.meta.url);

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// This command only reads local evidence. It never loads .env or calls a provider.
export async function captureManifest() {
  const hashes = {};

  const load = async (name) => {
    const bytes = await readFile(new URL(name, base));

    hashes[name] = hash(bytes);

    assert.doesNotMatch(bytes.toString('utf8'), /hf_[A-Za-z0-9]+/);

    return JSON.parse(bytes);
  };

  const fixtureBytes = await readFile(
    new URL('../../docs/inference/INF-01-fixtures.json', import.meta.url),
  );
  const fixtures = JSON.parse(fixtureBytes);
  const policy = await load('policy.json');
  const original = await load('summary.json');
  const probe = await load('pair-probe/summary.json');
  const continuation = await load('pair-probe/continuation/summary.json');
  const discovery = await load('discovery.json');
  const billing = await load('billing-user-report.json');
  const reanalysis = await load('pair-probe/continuation/ja-reanalysis.json');
  const initialPlan = await load('plan.json');
  const pairPlan = await load('pair-probe/plan.json');

  assert.deepEqual(initialPlan, makePlan(fixtures));
  assert.deepEqual(pairPlan, makePairProbePlan(fixtures));
  assert.equal(policy.fixtureSha256, hash(fixtureBytes));
  assert.equal(policy.requestCeiling, 13);
  assert.equal(policy.automaticRetries, 0);
  assert.equal(original.actualRequests, 8);
  assert.equal(probe.actualRequests, 1);
  assert.equal(continuation.actualRequests, 4);

  validateDiscovery(discovery);

  assert.equal(billing.amountUsd, null);
  assert.equal(billing.displayedUpperBoundExclusiveUsd, 0.01);

  const calls = [];
  const dense = [];
  const scores = [];
  const phases = [
    ['', original, initialPlan],
    ['pair-probe/', probe, pairPlan],
    ['pair-probe/continuation/', continuation, pairPlan.slice(1)],
  ];

  for (const [prefix, summary, plan] of phases) {
    for (const record of summary.records) {
      if (record.outcome === 'NOT_EXECUTED') {
        assert.equal(record.attempt, undefined);

        continue;
      }

      assert.equal(record.attempt, 1);

      const file = `${prefix}${record.id}.json`;

      assert.deepEqual(await load(file), record);

      const pending = await load(`${prefix}${record.id}.pending.json`);
      const expected = plan.find((item) => item.id === record.id);

      assert.ok(expected);
      assert.deepEqual(pending, { ...expected, outcome: 'UNKNOWN' });
      assert.equal(record.url, expected.url);
      assert.deepEqual(record.payload, expected.payload);
      assert.deepEqual(record.expectedIds, expected.expectedIds);
      assert.equal(record.responseSha256, hash(record.responseText));
      assert.ok(record.headers['x-request-id']);

      for (const field of [
        'costUsd',
        'usage',
        'servedRevision',
        'region',
        'hardware',
        'precision',
      ]) {
        assert.equal(record[field], null);
      }

      let finalAssessment = record.outcome;

      if (record.operation === 'dense') {
        const vectors = parseHfDenseResponse(JSON.parse(record.responseText), 1);
        const norm = Math.sqrt(vectors[0].dense.reduce((sum, x) => sum + x * x, 0));

        assert.ok(Math.abs(norm - 1) < 0.000001);

        dense.push({
          id: record.id,
          language: record.language,
          dimension: vectors[0].dense.length,
          l2Norm: norm,
        });
      } else if (record.operation === 'rerank-pair') {
        const parsed = parsePairResponse(JSON.parse(record.responseText), record.expectedIds);
        scores.push(...parsed);

        if (record.id === 'pair-ja-0') {
          assert.equal(record.outcome, 'RESPONSE_INVALID');
          assert.equal(reanalysis.httpCalls, 0);
          assert.equal(reanalysis.originalRecord, '../pair-ja-0.json');
          assert.deepEqual(reanalysis.scores, parsed);

          finalAssessment = 'SHAPE_VALID_AFTER_OFFLINE_REANALYSIS';
        } else {
          assert.deepEqual(record.validation.scores, parsed);
        }
      } else if (record.operation === 'sparse') {
        const denseOnly = parseHfDenseResponse(JSON.parse(record.responseText), 3);

        assert.equal(denseOnly.length, 3);

        finalAssessment = 'DENSE_ONLY_SPARSE_NOT_RETURNED';
      } else {
        assert.equal(record.httpStatus, 400);
        assert.equal(record.outcome, 'HTTP_ERROR');
      }

      calls.push({
        record: file,
        id: record.id,
        operation: record.operation,
        language: record.language,
        url: record.url,
        timestamp: record.timestamp,
        httpStatus: record.httpStatus,
        originalOutcome: record.outcome,
        finalAssessment,
        requestId: record.headers['x-request-id'],
        elapsedMs: record.elapsedMs,
        costUsd: null,
      });
    }
  }

  assert.equal(calls.length, 13);
  assert.equal(new Set(calls.map((item) => item.id)).size, 13);
  assert.equal(new Set(calls.map((item) => item.requestId)).size, 13);
  assert.equal(dense.length, 6);
  assert.equal(scores.length, 6);
  assert.equal(calls.filter((item) => item.httpStatus === 200).length, 12);

  const sanity = fixtures.rerank.map((item) => {
    const pair = item.candidates.map((candidate) =>
      scores.find((score) => score.chunkId === candidate.chunkId),
    );

    assert.ok(pair[0].score > pair[1].score);

    return { language: item.language, candidates: pair, timeAbovePlace: true };
  });

  const observedProvider = (index, url) => ({
    provider: 'hf-inference',
    model: discovery.records[index].data.id,
    endpoint: url,
    hubRevisionCandidate: discovery.records[index].data.sha,
    servedModelRevision: null,
    tokenizerRevision: null,
    processingRevision: null,
    region: null,
    hardware: null,
    precision: null,
  });

  return {
    task: 'INF-01',
    version: 3,
    status: 'SMOKE_OBSERVED_IDENTITY_AND_OPERATIONAL_GATES_OPEN',
    readyForFreeze: false,
    priorDecisionSnapshot: 'INF-01-manifest-v2.json',
    captureDirectory: 'runs/2026-11-23-hf-smoke-01/',
    authorization: policy,
    profile: { active: 'DENSE', sparseEnabled: false, fusion: null, sameForBothRagModes: true },
    actualRequests: 13,
    requestCounts: {
      dense: 6,
      reranker: 6,
      sparseDiagnostic: 1,
      http200: 12,
      http400: 1,
      automaticRetries: 0,
    },
    additionalCallsForJaReanalysis: 0,
    embedding: observedProvider(0, calls[0].url),
    reranker: observedProvider(1, pairPlan[0].url),
    observations: {
      dense,
      rerankSanity: sanity,
      rerankMapping: 'INPUT_ORDER_NOT_PROVIDER_ECHOED_IDS',
      scoreSemantics: 'REQUESTED_NONE_RAW_LOGIT_UNVERIFIED',
      pairContractStatus: 'OBSERVED_NESTED_TRANSFORMERS_SIGNATURE_NOT_PUBLIC_HF_WIRE_GUARANTEE',
      sparse: {
        probeRequests: 1,
        inputs: 3,
        denseDimensions: [1024, 1024, 1024],
        sparseReturned: false,
        capability: 'NOT_ESTABLISHED_NO_GLOBAL_UNSUPPORTED_CLAIM',
      },
      capacity: {
        observedDenseBatch: 1,
        sparseDiagnosticDenseBatch: 3,
        observedPairBatch: 2,
        concurrency: 1,
        providerMaxBatch: null,
        providerMaxInputTokens: null,
        providerRateLimit: null,
        truncationBehavior: 'NOT_BOUNDARY_TESTED',
        normalization: 'NEAR_UNIT_OBSERVED_PARAMETER_EFFECT_NOT_ISOLATED',
      },
    },
    billing: { ...billing, requestCostsUsd: null, aggregateCostUsd: null, tariffSnapshot: null },
    retention: {
      source: 'https://huggingface.co/docs/inference-providers/security',
      statementScope: 'HF_ROUTER_DOCUMENTATION_NOT_DEPLOYMENT_ATTESTATION',
      routerPayloadRetention: 'DOCUMENTATION_SAYS_REQUEST_RESPONSE_NOT_STORED',
      routerDebugLogs: 'DOCUMENTATION_SAYS_UP_TO_30_DAYS_WITHOUT_USER_DATA_OR_TOKENS',
      providerSpecificRetention: null,
    },
    openGates: [
      'SERVED_MODEL_TOKENIZER_PROCESSING_REVISION_ATTESTATION_BOTH_OPERATIONS',
      'ACTUAL_REGION_AND_PROVIDER_RETENTION_TERMS',
      'MAX_LENGTH_TRUNCATION_BATCH_RATE_LIMITS_AND_PAIR_CONTRACT_GUARANTEE',
      'TARIFF_MINIMUM_CREDIT_AND_SETTLED_BILLING_RECONCILIATION',
    ],
    calls,
    artifactSha256: hashes,
    fixtureSha256: hash(fixtureBytes),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(
    process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--write'),
  );

  const result = await captureManifest();

  if (process.argv[2] === '--write') {
    await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });

    console.log('Manifest smoke v3 dibuat offline; tidak ada inference calls.');
  } else {
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), result);

    console.log(
      'Capture INF-01 v3 valid: 13 POST unik, 0 retry; dense/pair rerank valid, sparse belum terbukti; freeze tetap diblokir.',
    );
  }
}
