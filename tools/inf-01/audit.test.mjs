import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { discover, sources } from './discover.mjs';
import {
  parseHfDenseResponse,
  validateDenseDecision,
  validateEmbeddingBatch,
  validateAudit,
  validateDiscovery,
  validateHybridBatch,
  validateRerank,
} from './validate.mjs';

const hybrid = () => ({
  dense: Array(1024).fill(0.03125),
  sparse: { indices: [42, 100], values: [0.2, 0.7] },
});

await test('capture hybrid: cardinality, dense-only, finite values dan sparse vocabulary', () => {
  validateHybridBatch([hybrid(), hybrid(), hybrid()], 3);

  const mutations = [
    (v) => delete v.sparse,
    (v) => v.dense.pop(),
    (v) => {
      v.dense[0] = Infinity;
    },
    (v) => v.dense.fill(0),
    (v) => v.sparse.indices.push(42),
    (v) => {
      v.sparse.indices[0] = 250002;
    },
    (v) => {
      v.sparse.indices[0] = -1;
    },
    (v) => {
      v.sparse.indices[0] = 1.5;
    },
    (v) => {
      v.sparse.values[0] = NaN;
    },
    (v) => {
      v.sparse.values[0] = -0.1;
    },
    (v) => {
      v.sparse.indices = [42, 42];
    },
    (v) => {
      v.sparse.indices = [];
      v.sparse.values = [];
    },
  ];

  for (const mutate of mutations) {
    const value = hybrid();

    mutate(value);

    assert.throws(() => validateHybridBatch([value], 1));
  }

  assert.throws(() => validateHybridBatch([hybrid()], 3));
});

await test('rerank memakai ID bijektif, menerima logit negatif dan urutan provider berbeda', () => {
  const ids = ['ja-1', 'en-2', 'id-3'];
  const results = [
    { chunkId: 'id-3', score: 8 },
    { chunkId: 'ja-1', score: -4 },
    { chunkId: 'en-2', score: 0.2 },
  ];

  validateRerank(results, ids);

  for (const invalid of [
    results.slice(1),
    [...results, results[0]],
    [results[0], results[0], results[2]],
    [{ chunkId: 'unknown', score: 1 }, ...results.slice(1)],
    [{ chunkId: 'id-3', score: NaN }, ...results.slice(1)],
  ]) {
    assert.throws(() => validateRerank(invalid, ids));
  }
});

await test('discovery GET allowlist tanpa auth/body/redirect/retry dan tanpa panggilan saat import', async () => {
  const calls = [];

  const fetcher = async (url, options) => {
    calls.push({ url, options });

    const data =
      url === sources[2]
        ? { number: 899, state: 'open', merged: false, updated_at: '2026-11-23T00:00:00Z' }
        : {
            id: url.includes('reranker') ? 'BAAI/bge-reranker-v2-m3' : 'BAAI/bge-m3',
            sha: 'a'.repeat(40),
            inferenceProviderMapping: {},
          };

    return new Response(JSON.stringify(data));
  };

  const result = await discover(fetcher);

  validateDiscovery(result);
  assert.deepEqual(
    calls.map((call) => call.url),
    sources,
  );

  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { accept: 'application/json' });
    assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal);
  }
});

await test('failed metadata tidak hilang atau menyimpan raw error; tidak lolos verifier', async () => {
  for (const fetcher of [
    async () => new Response('secret-error-body', { status: 429 }),
    async () => {
      throw new Error('secret-error-message');
    },
    async () => new Response('not-json'),
    async () => new Response('{}'),
    async () => new Response('[]'),
    async () => new Response('x'.repeat(262145)),
  ]) {
    const result = await discover(fetcher);

    assert.equal(result.records.length, 3);
    assert.ok(
      result.records.every((record) => record.outcome === 'failed' && record.data === null),
    );
    assert.doesNotMatch(JSON.stringify(result), /secret-error/);
    assert.throws(() => validateDiscovery(result));
  }
});

await test('manifest audit tidak dapat mengklaim smoke, served revision, final provider atau freeze', async () => {
  const files = ['INF-01-manifest.json', 'INF-01-discovery.json', 'INF-01-fixtures.json'];
  const values = await Promise.all(
    files.map(async (file) =>
      JSON.parse(await readFile(new URL(`../../docs/inference/${file}`, import.meta.url), 'utf8')),
    ),
  );

  validateAudit(...values);

  const mutations = [
    (m) => {
      m.readyForFreeze = true;
    },
    (m) => {
      m.selected.embedding = 'sie-embedding';
    },
    (m) => {
      m.inferenceCalls = 1;
    },
    (m) => {
      m.candidates[0].observed.modelRevision = m.hubRevisions['BAAI/bge-m3'];
    },
    (m) => {
      m.candidates[0].model = 'dense-only-replacement';
    },
    (m) => {
      m.authorization.inferenceCallsAllowed = 1;
    },
    (m) => {
      m.candidates[0].sources = ['missing'];
    },
  ];

  for (const mutate of mutations) {
    const [manifest, discovery, fixtures] = structuredClone(values);

    mutate(manifest);

    assert.throws(() => validateAudit(manifest, discovery, fixtures));
  }
});

await test('DENSE menerima sparse absen; HYBRID tetap wajib dan sparse malformed selalu gagal', () => {
  const dense = { dense: hybrid().dense };

  validateEmbeddingBatch([dense], 1);
  validateEmbeddingBatch([dense, hybrid()], 2, 'DENSE');

  assert.throws(() => validateEmbeddingBatch([dense], 1, 'HYBRID'));
  assert.throws(() => validateEmbeddingBatch([dense], 1, 'AUTO'));

  for (const sparse of [
    null,
    undefined,
    {},
    { indices: [42], values: [NaN] },
    { indices: [42, 42], values: [1, 1] },
  ]) {
    assert.throws(() => validateEmbeddingBatch([{ ...dense, sparse }], 1, 'DENSE'));
  }

  for (const invalid of [
    [],
    [{ dense: [1] }],
    [{ dense: Array(1024).fill(NaN) }],
    [{ dense: Array(1024).fill(0) }],
  ]) {
    assert.throws(() => validateEmbeddingBatch(invalid, 1));
  }
});

await test('parser HF dense memeriksa batch/dimensi/finite; similarity scores bukan embedding', () => {
  const response = [hybrid().dense, hybrid().dense];

  const result = parseHfDenseResponse(response, 2);

  assert.deepEqual(
    result,
    response.map((dense) => ({ dense })),
  );
  assert.ok(result.every((item) => !Object.hasOwn(item, 'sparse')));

  for (const invalid of [
    [0.8, 0.9],
    [hybrid().dense],
    [[[1, 2]]],
    { error: 'unavailable' },
    [[...hybrid().dense.slice(1), Infinity]],
  ]) {
    assert.throws(() => parseHfDenseResponse(invalid, 2));
  }
});

await test('keputusan HF dense tidak menghapus reranker, parity, revision gates atau metrik penelitian', async () => {
  const values = await readDenseArtifacts();

  validateDenseDecision(...values);

  for (const mutate of [
    ([m]) => {
      m.readyForFreeze = true;
    },
    ([m]) => {
      m.selected.embedding.provider = 'auto';
    },
    ([m]) => {
      m.selected.reranker = null;
    },
    ([m]) => {
      m.selected.embedding.servedRevision = 'a'.repeat(40);
    },
    ([m]) => {
      m.retrieval.sparseEnabled = true;
    },
    ([m]) => {
      m.retrieval.automaticDowngrade = true;
    },
    ([m]) => {
      m.authorization.inferenceCallsAllowed = 1;
    },
    ([, d]) => {
      d.baseArtifacts = {};
    },
    ([, , t]) => {
      t.controls.retrieval_profile_by_mode.ADAPTIVE = 'HYBRID';
    },
    ([, , t]) => {
      t.dataset.main_cases = 121;
    },
    ([, , t]) => {
      t.evaluation.criteria.quality_delta_min = 0;
    },
  ]) {
    const copy = structuredClone(values);

    mutate(copy);

    assert.throws(() => validateDenseDecision(...copy));
  }
});

async function readDenseArtifacts() {
  return Promise.all(
    [
      '../../docs/inference/INF-01-manifest-v2.json',
      '../../research/protocol-v2-dense/decision.json',
      '../../research/protocol-v2-dense/manifest.template.json',
      '../../research/protocol-v1/manifest.template.json',
    ].map(async (file) => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'))),
  );
}
