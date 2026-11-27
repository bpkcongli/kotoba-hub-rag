import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHfDenseResponse, validateHybridBatch, validateRerank } from './validate.mjs';

export const denseUrl =
  'https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction';

export const rerankUrl =
  'https://router.huggingface.co/hf-inference/models/BAAI/bge-reranker-v2-m3';

const headerAllowlist = [
  'x-request-id',
  'x-compute-type',
  'x-compute-time',
  'x-compute-characters',
  'x-compute-tokens',
  'x-model-revision',
  'x-model-id',
  'x-inference-cost',
  'retry-after',
  'content-type',
];

export function makePlan(fixtures) {
  const plan = fixtures.embedding.map((item) => ({
    id: item.id,
    operation: 'dense',
    language: item.language,
    url: denseUrl,
    payload: { inputs: [item.text], normalize: true, truncate: false },
    expectedIds: [item.id],
  }));

  for (const item of fixtures.rerank) {
    for (const candidate of item.candidates) {
      plan.push({
        id: `rerank-${candidate.chunkId}`,
        operation: 'rerank',
        language: item.language,
        url: rerankUrl,
        payload: { inputs: { query: item.query, texts: [candidate.text] } },
        expectedIds: [candidate.chunkId],
      });
    }
  }

  // Diagnostic only: these FlagEmbedding switches are NOT a documented HF API contract.
  // Missing sparse proves only that this particular request did not return it.
  plan.push({
    id: 'sparse-capability-probe',
    operation: 'sparse',
    language: 'JA_EN_ID',
    url: denseUrl,
    payload: {
      inputs: fixtures.embedding
        .filter((item) => item.purpose === 'query')
        .map((item) => item.text),
      normalize: true,
      truncate: false,
      return_dense: true,
      return_sparse: true,
    },
    expectedIds: ['ja-query', 'en-query', 'id-query'],
  });

  assert.equal(plan.length, 13);
  assert.ok(plan.every((item) => [denseUrl, rerankUrl].includes(item.url)));

  return plan;
}

export function scrub(value, token) {
  return String(value)
    .split(token)
    .join('[REDACTED]')
    .replace(/hf_[A-Za-z0-9]+/g, '[REDACTED]');
}

export function parsePairResponse(data, ids) {
  assert.ok(Array.isArray(data));

  const batch =
    data.length === 1 &&
    Array.isArray(data[0]) &&
    data[0].length === ids.length &&
    data[0].every((entry) => entry && !Array.isArray(entry) && typeof entry === 'object')
      ? data[0]
      : data;

  assert.equal(batch.length, ids.length);

  const results = batch.map((entry, index) => {
    const score = Array.isArray(entry) ? entry[0] : entry;

    assert.ok(!Array.isArray(entry) || entry.length === 1);
    assert.equal(score?.label, 'LABEL_0');

    return { chunkId: ids[index], score: score.score };
  });

  validateRerank(results, ids);

  return results;
}

export async function invoke(item, token, fetcher = fetch) {
  assert.ok([denseUrl, rerankUrl].includes(item.url));

  const started = performance.now();
  const record = {
    ...item,
    timestamp: new Date().toISOString(),
    provider: 'hf-inference',
    attempt: 1,
    httpStatus: null,
    outcome: 'UNKNOWN',
    usage: null,
    costUsd: null,
    servedRevision: null,
    region: null,
    hardware: null,
    precision: null,
  };

  try {
    const response = await fetcher(item.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(item.payload),
    });

    record.httpStatus = response.status;
    record.headers = Object.fromEntries(
      headerAllowlist
        .filter((name) => response.headers.has(name))
        .map((name) => [name, scrub(response.headers.get(name), token)]),
    );

    const chunks = [];
    let size = 0;

    for await (const chunk of response.body ?? []) {
      size += chunk.length;

      assert.ok(size <= 524288, 'RESPONSE_TOO_LARGE');

      chunks.push(chunk);
    }

    const bytes = Buffer.concat(chunks);

    record.responseSha256 = createHash('sha256').update(bytes).digest('hex');

    const body = scrub(bytes.toString('utf8'), token);

    record.responseText = body;
    record.outcome = response.ok ? 'RESPONSE_INVALID' : 'HTTP_ERROR';

    if (response.ok) {
      const data = JSON.parse(body);

      if (item.operation === 'dense') {
        const vectors = parseHfDenseResponse(data, item.expectedIds.length);

        record.validation = {
          dimensions: vectors.map((v) => v.dense.length),
          l2Norms: vectors.map((v) => Math.sqrt(v.dense.reduce((sum, x) => sum + x * x, 0))),
          sparseReturned: false,
        };
      } else if (item.operation === 'rerank') {
        assert.ok(Array.isArray(data) && data.length === item.expectedIds.length);

        const results = data.map((entry) => {
          assert.ok(
            entry &&
              Number.isInteger(entry.index) &&
              entry.index >= 0 &&
              entry.index < item.expectedIds.length,
          );

          return { chunkId: item.expectedIds[entry.index], score: entry.score };
        });

        validateRerank(results, item.expectedIds);

        record.validation = { scores: results, scoreSemantics: 'unknown' };
      } else if (item.operation === 'rerank-pair') {
        const results = parsePairResponse(data, item.expectedIds);

        record.validation = {
          scores: results,
          scoreSemantics: 'requested_none_raw_logit_unverified',
          mapping: 'input_order',
        };
      } else {
        validateHybridBatch(data, item.expectedIds.length);

        record.validation = { sparseReturned: true, tokenMappingVerified: false };
      }

      record.outcome = 'SHAPE_VALID';
    }
  } catch (error) {
    record.errorCode =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'TIMEOUT'
        : 'TRANSPORT_OR_VALIDATION_ERROR';
    // Raw exceptions can contain credentials; only a fixed code is retained.
  }

  record.elapsedMs = performance.now() - started;

  return record;
}

export function makePairProbePlan(fixtures) {
  return fixtures.rerank.flatMap((item, index) => {
    // Use one JA batch to recover both candidates within the remaining five requests.
    const groups =
      index === 0 ? [item.candidates] : item.candidates.map((candidate) => [candidate]);

    return groups.map((candidates, group) => ({
      id: `pair-${item.language.toLowerCase()}-${group}`,
      operation: 'rerank-pair',
      language: item.language,
      url: rerankUrl,
      payload: {
        inputs: {
          inputs: candidates.map((candidate) => ({ text: item.query, text_pair: candidate.text })),
        },
        parameters: { function_to_apply: 'none' },
      },
      expectedIds: candidates.map((candidate) => candidate.chunkId),
      contractStatus: 'DIAGNOSTIC_TRANSFORMERS_SIGNATURE_NOT_PUBLIC_HF_WIRE_GUARANTEE',
    }));
  });
}

export async function runPairProbe(originalDirectory, token, fetcher = fetch) {
  assert.ok(typeof token === 'string' && token.startsWith('hf_'));

  const original = JSON.parse(await readFile(join(originalDirectory, 'summary.json'), 'utf8'));

  assert.equal(original.actualRequests, 8);
  assert.equal(original.requestCeiling, 13);

  const fixtureBytes = await readFile(
    new URL('../../docs/inference/INF-01-fixtures.json', import.meta.url),
  );
  const plan = makePairProbePlan(JSON.parse(fixtureBytes.toString('utf8')));

  assert.equal(plan.length + original.actualRequests, 13);

  const directory = join(originalDirectory, 'pair-probe');

  await mkdir(directory);
  await writeFile(join(directory, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, {
    flag: 'wx',
  });

  const records = [];
  let blocked = false;

  for (const item of plan) {
    if (blocked) {
      records.push({
        id: item.id,
        operation: item.operation,
        outcome: 'NOT_EXECUTED',
        reason: 'PAIR_CONTRACT_PROBE_FAILED',
        costUsd: 0,
      });

      continue;
    }

    await writeFile(
      join(directory, `${item.id}.pending.json`),
      `${JSON.stringify({ ...item, outcome: 'UNKNOWN' }, null, 2)}\n`,
      { flag: 'wx' },
    );

    const record = await invoke(item, token, fetcher);

    await writeFile(join(directory, `${item.id}.json`), `${JSON.stringify(record, null, 2)}\n`, {
      flag: 'wx',
    });

    records.push(record);
    blocked = record.outcome !== 'SHAPE_VALID';

    console.log(`${item.id}: HTTP ${record.httpStatus ?? 'unknown'}, ${record.outcome}`);
  }

  const summary = {
    previousSummary: '../summary.json',
    records,
    actualRequests: records.filter((record) => record.attempt === 1).length,
    costUsd: null,
    readyForFreeze: false,
  };

  await writeFile(join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
    flag: 'wx',
  });

  return summary;
}

export async function continuePairs(originalDirectory, token, fetcher = fetch) {
  assert.ok(typeof token === 'string' && token.startsWith('hf_'));

  const first = JSON.parse(await readFile(join(originalDirectory, 'summary.json'), 'utf8'));
  const probeDirectory = join(originalDirectory, 'pair-probe');
  const probe = JSON.parse(await readFile(join(probeDirectory, 'summary.json'), 'utf8'));

  assert.equal(first.actualRequests, 8);
  assert.equal(first.requestCeiling, 13);
  assert.equal(probe.actualRequests, 1);

  const observed = JSON.parse(await readFile(join(probeDirectory, 'pair-ja-0.json'), 'utf8'));

  assert.equal(observed.httpStatus, 200);

  const scores = parsePairResponse(JSON.parse(observed.responseText), observed.expectedIds);
  const plan = JSON.parse(await readFile(join(probeDirectory, 'plan.json'), 'utf8')).slice(1);
  const fixtures = JSON.parse(
    await readFile(new URL('../../docs/inference/INF-01-fixtures.json', import.meta.url), 'utf8'),
  );

  assert.deepEqual(plan, makePairProbePlan(fixtures).slice(1));
  assert.equal(first.actualRequests + probe.actualRequests + plan.length, 13);

  const directory = join(probeDirectory, 'continuation');

  await mkdir(directory);
  await writeFile(
    join(directory, 'ja-reanalysis.json'),
    `${JSON.stringify({ originalRecord: '../pair-ja-0.json', httpCalls: 0, outcome: 'SHAPE_VALID', scores, reason: 'HF response contains an outer batch wrapper; parsed saved response without another model call' }, null, 2)}\n`,
    { flag: 'wx' },
  );

  const records = [];
  let blocked = false;

  for (const item of plan) {
    assert.equal(item.url, rerankUrl);

    if (blocked) {
      records.push({ id: item.id, outcome: 'NOT_EXECUTED', costUsd: 0 });

      continue;
    }

    await writeFile(
      join(directory, `${item.id}.pending.json`),
      `${JSON.stringify({ ...item, outcome: 'UNKNOWN' }, null, 2)}\n`,
      { flag: 'wx' },
    );

    const record = await invoke(item, token, fetcher);

    await writeFile(join(directory, `${item.id}.json`), `${JSON.stringify(record, null, 2)}\n`, {
      flag: 'wx',
    });

    records.push(record);
    blocked = record.outcome !== 'SHAPE_VALID';

    console.log(`${item.id}: HTTP ${record.httpStatus ?? 'unknown'}, ${record.outcome}`);
  }

  const summary = {
    records,
    actualRequests: records.filter((record) => record.attempt === 1).length,
    costUsd: null,
    readyForFreeze: false,
  };

  await writeFile(join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
    flag: 'wx',
  });

  return summary;
}

export async function runSmoke(outputDirectory, token, fetcher = fetch) {
  assert.ok(typeof token === 'string' && token.startsWith('hf_'), 'HF_TOKEN is missing or invalid');

  const fixtureBytes = await readFile(
    new URL('../../docs/inference/INF-01-fixtures.json', import.meta.url),
  );
  const plan = makePlan(JSON.parse(fixtureBytes.toString('utf8')));

  // Exclusive directory prevents replaying a paid run or overwriting previous evidence.
  await mkdir(outputDirectory);

  const policy = {
    task: 'INF-01',
    kind: 'AUTHORIZED_HF_SMOKE_NOT_EXPERIMENT',
    authorization: 'USER_REQUEST_12_BASE_REQUESTS_PLUS_SPARSE_NECESSARY_ONLY',
    targetBudgetUsd: 1,
    budgetEnforcement: 'REQUEST_CAP_ONLY_PROVIDER_PRICE_AND_FINAL_BILLING_UNKNOWN',
    baseRequestCeiling: 12,
    sparseRequestCeiling: 1,
    requestCeiling: 13,
    automaticRetries: 0,
    concurrency: 1,
    timeoutMs: 15000,
    fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
    secretReference: 'HF_TOKEN',
    readyForFreeze: false,
  };

  await writeFile(join(outputDirectory, 'policy.json'), `${JSON.stringify(policy, null, 2)}\n`, {
    flag: 'wx',
  });
  await writeFile(join(outputDirectory, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, {
    flag: 'wx',
  });

  const blocked = new Set();
  const records = [];
  let authFailed = false;

  for (const item of plan) {
    if (
      authFailed ||
      blocked.has(item.operation) ||
      (item.operation === 'sparse' && blocked.has('dense'))
    ) {
      records.push({
        id: item.id,
        operation: item.operation,
        outcome: 'NOT_EXECUTED',
        reason: authFailed ? 'AUTH_OR_CREDIT_FAILURE' : 'EARLIER_OPERATION_FAILURE',
        costUsd: 0,
      });

      continue;
    }

    assert.ok(records.filter((record) => record.attempt === 1).length < policy.requestCeiling);

    // The pending record survives a crash; never retry an unknown execution automatically.
    await writeFile(
      join(outputDirectory, `${item.id}.pending.json`),
      `${JSON.stringify({ ...item, outcome: 'UNKNOWN' }, null, 2)}\n`,
      { flag: 'wx' },
    );

    const record = await invoke(item, token, fetcher);

    await writeFile(
      join(outputDirectory, `${item.id}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      { flag: 'wx' },
    );

    records.push(record);

    if (record.outcome !== 'SHAPE_VALID') {
      blocked.add(item.operation);
    }

    if ([401, 402, 403].includes(record.httpStatus)) {
      authFailed = true;
    }

    console.log(`${item.id}: HTTP ${record.httpStatus ?? 'unknown'}, ${record.outcome}`);
  }

  const summary = {
    ...policy,
    records,
    actualRequests: records.filter((record) => record.attempt === 1).length,
    notExecuted: records.filter((record) => record.outcome === 'NOT_EXECUTED').length,
    costUsd: null,
    billingStatus: 'PENDING_PROVIDER_BILLING_RECONCILIATION',
    outcome: records.every((record) => record.outcome === 'SHAPE_VALID')
      ? 'SHAPES_VALID_IDENTITY_GATES_OPEN'
      : 'CAPABILITY_GATES_NOT_MET',
  };

  await writeFile(join(outputDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
    flag: 'wx',
  });

  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(
    ['--execute', '--execute-pair-probe', '--continue-pairs'].includes(process.argv[2]),
    'Explicit opt-in required',
  );
  assert.equal(process.argv.length, 4, 'Exactly one new run directory is required');

  if (process.argv[2] === '--continue-pairs') {
    await continuePairs(process.argv[3], process.env.HF_TOKEN);
  } else if (process.argv[2] === '--execute-pair-probe') {
    await runPairProbe(process.argv[3], process.env.HF_TOKEN);
  } else {
    await runSmoke(process.argv[3], process.env.HF_TOKEN);
  }
}
