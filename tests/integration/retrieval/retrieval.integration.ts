import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { QdrantClient } from '@qdrant/js-client-rest';
import { context, dense, manifest, payload, scope } from '@tests/__fixtures__/retrieval-fixture';
import { retrievalConfig } from '@/retrieval/config';
import { createQdrantRetriever } from '@/retrieval/qdrant-retriever';
import { QdrantIndexStore } from '@/storage/qdrant-index';

const url = process.env.RAG01_QDRANT_URL;

assert.ok(url, 'Gunakan npm run test:rag01 untuk Qdrant sementara');
assert.equal(new URL(url).hostname, '127.0.0.1');

const client = new QdrantClient({ url, timeout: 5000, checkCompatibility: false });
const store = new QdrantIndexStore({ url, timeoutMs: 5000 });
const connection = { url, timeoutMs: 5000 };

await test('runtime DENSE nyata mengisolasi published/corpus/level/skill/config tanpa sparse/fusion', async (t) => {
  const index = manifest();
  await store.prepare(index);
  t.after(async () => {
    await store.remove(index);
  });
  const overrides = [
    {},
    { published: false },
    { corpus_version: 'foreign' },
    { jlpt_level: 'JLPT_N4' },
    { jlpt_level: 'JLPT_N3' },
    { skill_codes: ['other'] },
    { embedding_config_id: 'foreign' },
    { published: 'true' },
    { skill_codes: [] },
    { skill_codes: ['other', 'grammar-ni'] },
  ];
  await client.upsert(index.physicalCollection, {
    wait: true,
    points: overrides.map((override, i) => ({
      id: i + 1,
      vector: { dense: dense() },
      payload: payload(index, i + 1, override),
    })),
  });
  const retriever = createQdrantRetriever(retrievalConfig(index), connection);
  t.after(() => retriever.close());

  const result = await retriever.retrieve({ dense: dense() }, scope, 5, context());

  assert.deepEqual(result.candidates.map((row) => row.pointId).sort(), ['1', '10']);
  assert.equal(result.sparse, null);
  assert.ok(
    result.candidates.every(
      (row) => row.scoreType === 'cosine' && row.text.includes('七時に起きます。'),
    ),
  );

  const empty = await retriever.retrieve(
    { dense: dense() },
    { ...scope, skillCodes: ['no-evidence'] },
    5,
    context(),
  );

  assert.deepEqual(empty.candidates, []);
});

await test('runtime HYBRID nyata memakai raw dense/sparse, fixed RRF dan satu result round', async (t) => {
  const index = manifest('HYBRID');
  await store.prepare(index);
  t.after(async () => {
    await store.remove(index);
  });
  const vectors = [1, 0.8, 0.5];
  await client.upsert(index.physicalCollection, {
    wait: true,
    points: vectors.map((x, i) => ({
      id: i + 1,
      vector: {
        dense: [x, Math.sqrt(1 - x * x), ...Array<number>(1022).fill(0)],
        sparse: { indices: [42], values: [[1, 5, 2][i] ?? 0] },
      },
      payload: payload(index, i + 1),
    })),
  });
  const retriever = createQdrantRetriever(
    retrievalConfig(index, { RETRIEVAL_CANDIDATE_LIMIT: '2', RETRIEVAL_LIMIT: '2' }),
    connection,
  );
  t.after(() => retriever.close());

  const result = await retriever.retrieve(
    { dense: dense(), sparse: { indices: [42], values: [1] } },
    scope,
    2,
    context(),
  );

  assert.deepEqual(
    result.dense.map((row) => row.pointId),
    ['1', '2'],
  );
  assert.deepEqual(
    result.sparse?.map((row) => row.pointId),
    ['2', '3'],
  );
  assert.equal(result.candidates[0]?.pointId, '2');
  assert.equal(result.candidates[0]?.score, 1 / 61 + 1 / 60);
  assert.equal(result.sparse?.[0]?.score, 5);
  assert.equal(result.candidates[0]?.scoreType, 'rrf_k60_zero_based');
  await assert.rejects(retriever.retrieve({ dense: dense() }, scope, 2, context()), {
    code: 'INVALID_INPUT',
  });
});

await test('HYBRID hard filter menolak sparse-only top match di luar scope di kedua cabang', async (t) => {
  const index = manifest('HYBRID');
  await store.prepare(index);
  t.after(async () => {
    await store.remove(index);
  });
  const overrides = [
    {},
    { published: false },
    { corpus_version: 'foreign' },
    { jlpt_level: 'JLPT_N4' },
    { skill_codes: ['other'] },
    { embedding_config_id: 'foreign' },
  ];
  await client.upsert(index.physicalCollection, {
    wait: true,
    points: overrides.map((override, i) => ({
      id: i + 1,
      vector: { dense: dense(), sparse: { indices: [42], values: [i === 0 ? 1 : 100] } },
      payload: payload(index, i + 1, override),
    })),
  });
  const retriever = createQdrantRetriever(retrievalConfig(index), connection);
  t.after(() => retriever.close());

  const result = await retriever.retrieve(
    { dense: dense(), sparse: { indices: [42], values: [1] } },
    scope,
    5,
    context(),
  );

  assert.deepEqual(
    result.dense.map((row) => row.pointId),
    ['1'],
  );
  assert.deepEqual(
    result.sparse?.map((row) => row.pointId),
    ['1'],
  );
  assert.deepEqual(
    result.candidates.map((row) => row.pointId),
    ['1'],
  );
});

await test('manifest/profile/config drift dan alias sebagai pengganti physical pin ditolak pada server nyata', async (t) => {
  const index = manifest();
  await store.prepare(index);
  const alias = `kotoba_alias_${randomUUID().replaceAll('-', '')}`;
  await client.updateCollectionAliases({
    actions: [{ create_alias: { alias_name: alias, collection_name: index.physicalCollection } }],
  });
  t.after(async () => {
    await client.updateCollectionAliases({ actions: [{ delete_alias: { alias_name: alias } }] });
    await store.remove(index);
  });
  const aliasManifest = {
    ...index,
    indexRevision: alias.slice('kotoba_'.length),
    physicalCollection: alias,
  };

  for (const changed of [{ ...index, embeddingConfigId: 'other-config' }, aliasManifest]) {
    const retriever = createQdrantRetriever(retrievalConfig(changed), connection);
    t.after(() => retriever.close());

    await assert.rejects(retriever.retrieve({ dense: dense() }, scope, 5, context()), {
      code: 'INCOMPATIBLE_INDEX',
    });
  }
});

await test('runtime mendeteksi checksum/payload rusak walau record terambil dari Qdrant nyata', async (t) => {
  const index = manifest();
  await store.prepare(index);
  t.after(async () => {
    await store.remove(index);
  });
  await client.upsert(index.physicalCollection, {
    wait: true,
    points: [
      { id: 1, vector: { dense: dense() }, payload: payload(index, 1, { text: 'changed text' }) },
    ],
  });
  const retriever = createQdrantRetriever(retrievalConfig(index), connection);
  t.after(() => retriever.close());

  await assert.rejects(retriever.retrieve({ dense: dense() }, scope, 5, context()), {
    code: 'INVALID_RESPONSE',
  });
});

await test('candidate null revisions dapat dibaca dengan konfigurasi cocok; guard promosi tetap menolak', async (t) => {
  const index = {
    ...manifest(),
    embeddingModelRevision: null,
    tokenizerRevision: null,
    processingRevision: null,
  };
  await store.prepare(index);
  t.after(async () => {
    await store.remove(index);
  });
  await client.upsert(index.physicalCollection, {
    wait: true,
    points: [{ id: 1, vector: { dense: dense() }, payload: payload(index) }],
  });
  const retriever = createQdrantRetriever(retrievalConfig(index), connection);
  t.after(() => retriever.close());

  const result = await retriever.retrieve({ dense: dense() }, scope, 5, context());

  assert.equal(result.candidates.length, 1);
  await assert.rejects(store.promote(index, 'kotoba_active_rag01_fixture'), {
    code: 'UNSAFE_LIFECYCLE',
  });
});
