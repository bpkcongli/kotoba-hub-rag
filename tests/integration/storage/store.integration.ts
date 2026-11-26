import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { Schemas } from '@qdrant/js-client-rest';
import {
  contentDigest,
  INDEX_SCHEMA_VERSION,
  parseIndexManifest,
  PAYLOAD_INDEXES,
  QDRANT_VERSION,
} from '@/storage/index-manifest';
import type { IndexManifest } from '@/storage/index-manifest';
import { knowledgeFilter } from '@/storage/knowledge-filter';
import { QdrantIndexStore } from '@/storage/qdrant-index';

const url = process.env.STORE01_QDRANT_URL;
assert.ok(url, 'Gunakan npm run test:store untuk Qdrant sementara nyata');
assert.equal(new URL(url).hostname, '127.0.0.1');

const client = new QdrantClient({ url, timeout: 5000, checkCompatibility: false });
const store = new QdrantIndexStore({ url, timeoutMs: 5000 });

function checksum(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function dense(): number[] {
  const vector = Array<number>(1024).fill(0);
  vector[0] = 1;

  return vector;
}

function manifest(
  profile: 'DENSE' | 'HYBRID' = 'DENSE',
  chunks = [{ chunkId: 'a', text: '七時に起きます。' }],
): IndexManifest {
  const indexRevision = `store01_${randomUUID().replaceAll('-', '')}`;

  return parseIndexManifest({
    schemaVersion: INDEX_SCHEMA_VERSION,
    indexRevision,
    physicalCollection: `kotoba_${indexRevision}`,
    corpusVersion: 'synthetic-v1',
    retrievalProfile: profile,
    embeddingConfigId: 'synthetic-bge-fixture-v1',
    embeddingModelRevision: 'fixture-model-revision',
    tokenizerRevision: 'fixture-tokenizer-revision',
    processingRevision: 'fixture-processing-revision',
    sparseCapabilityVerified: profile === 'HYBRID',
    sparseTokenMappingId: profile === 'HYBRID' ? 'fixture-token-map-v1' : null,
    expectedPointCount: chunks.length,
    contentDigest: contentDigest(
      chunks.map((chunk) => ({ chunkId: chunk.chunkId, checksum: checksum(chunk.text) })),
    ),
  });
}

function point(
  value: IndexManifest,
  id = 1,
  overrides: Record<string, unknown> = {},
): Schemas['PointStruct'] {
  return {
    id,
    vector: {
      dense: dense(),
      ...(value.retrievalProfile === 'HYBRID' ? { sparse: { indices: [42], values: [1] } } : {}),
    },
    payload: {
      chunk_id: 'a',
      parent_id: 'parent',
      source_id: 'source',
      source_url: 'https://example.invalid/store01-synthetic',
      license: 'synthetic-fixture-only',
      text: '七時に起きます。',
      content_checksum: checksum('七時に起きます。'),
      corpus_version: value.corpusVersion,
      embedding_config_id: value.embeddingConfigId,
      embedding_revision: value.embeddingModelRevision,
      published: true,
      jlpt_level: 'JLPT_N5',
      skill_codes: ['grammar-ni'],
      locale: 'ID',
      content_type: 'example',
      track_slug: 'n5',
      unit_slug: 'time',
      lesson_slug: 'ni',
      chunk_index: 0,
      token_count: 8,
      chunking_version: 'synthetic-v1',
      ...overrides,
    },
  };
}

const filterInput = {
  published: true,
  corpusVersion: 'synthetic-v1',
  targetLevel: 'JLPT_N5',
  skillCodes: ['grammar-ni'],
} as const;

await test('server/client, collection DENSE dan payload indexes nyata; prepare idempotent tanpa menghapus point', async () => {
  const value = manifest();

  assert.equal((await client.api().root({})).data.version, QDRANT_VERSION);
  assert.equal((await store.prepare(value)).created, true);

  await client.upsert(value.physicalCollection, { wait: true, points: [point(value)] });

  assert.equal((await store.prepare(value)).created, false);

  const info = await client.getCollection(value.physicalCollection);
  const record = await client.retrieve(value.physicalCollection, { ids: [1], with_vector: true });
  const validation = await store.validate(value);

  for (const [field, type] of Object.entries(PAYLOAD_INDEXES)) {
    assert.equal(info.payload_schema[field]?.data_type, type);
  }

  assert.equal(Object.keys(info.config.params.sparse_vectors ?? {}).length, 0);
  assert.ok(record[0]?.vector && typeof record[0].vector === 'object');
  assert.equal('sparse' in record[0].vector, false);
  assert.equal(validation.pointCount, 1);
  assert.equal(validation.contentDigest, value.contentDigest);
  assert.equal(validation.searchSmokePassed, true);

  await store.remove(value);

  assert.equal((await client.collectionExists(value.physicalCollection)).exists, false);
});

await test('hard filters mengisolasi unpublished, corpus, level, skill, dan embedding config pada dense search', async () => {
  const value = manifest();
  await store.prepare(value);
  await client.upsert(value.physicalCollection, {
    wait: true,
    points: [
      point(value, 1),
      point(value, 2, { published: false }),
      point(value, 3, { corpus_version: 'other' }),
      point(value, 4, { jlpt_level: 'JLPT_N4' }),
      point(value, 5, { jlpt_level: 'JLPT_N3' }),
      point(value, 6, { skill_codes: ['other'] }),
      point(value, 7, { embedding_config_id: 'other' }),
      point(value, 8, { published: 'true' }),
      point(value, 9, { skill_codes: [] }),
      point(value, 10, { chunk_id: 'b', skill_codes: ['other', 'grammar-ni'] }),
    ],
  });

  const result = await client.query(value.physicalCollection, {
    query: dense(),
    using: 'dense',
    filter: knowledgeFilter(filterInput, value),
    limit: 20,
  });

  assert.deepEqual(
    result.points.map((item) => item.id).sort((a, b) => Number(a) - Number(b)),
    [1, 10],
  );
  await assert.rejects(store.validate(value), { code: 'INVALID_CONTENT' });

  await store.remove(value);
});

await test('index incompatible ditolak tanpa recreate; dimensi, profil, manifest dan index type diperiksa', async () => {
  const value = manifest();
  await store.prepare(value);
  await client.upsert(value.physicalCollection, { wait: true, points: [point(value)] });

  await assert.rejects(store.prepare({ ...value, embeddingConfigId: 'changed' }), {
    code: 'INCOMPATIBLE_INDEX',
  });
  await assert.rejects(
    store.prepare({
      ...value,
      retrievalProfile: 'HYBRID',
      sparseCapabilityVerified: true,
      sparseTokenMappingId: 'verified-fixture',
    }),
    { code: 'INCOMPATIBLE_INDEX' },
  );

  await client.deletePayloadIndex(value.physicalCollection, 'published', { wait: true });
  await client.createPayloadIndex(value.physicalCollection, {
    field_name: 'published',
    field_schema: 'keyword',
    wait: true,
  });

  await assert.rejects(store.prepare(value), { code: 'INCOMPATIBLE_INDEX' });
  assert.equal((await client.count(value.physicalCollection, { exact: true })).count, 1);

  await client.deleteCollection(value.physicalCollection);
  await client.createCollection(value.physicalCollection, {
    vectors: { dense: { size: 3, distance: 'Cosine' } },
  });

  await assert.rejects(store.prepare(value), { code: 'INCOMPATIBLE_INDEX' });

  await client.deleteCollection(value.physicalCollection);
});

await test('HYBRID membutuhkan materialisasi sparse setiap point dan hard filter pada kedua cabang RRF', async () => {
  const value = manifest('HYBRID');
  await store.prepare(value);
  const missing = point(value);
  missing.vector = { dense: dense() };
  await client.upsert(value.physicalCollection, { wait: true, points: [missing] });

  await assert.rejects(store.validate(value), { code: 'INVALID_CONTENT' });

  await client.upsert(value.physicalCollection, { wait: true, points: [point(value)] });

  assert.equal((await store.validate(value)).retrievalProfile, 'HYBRID');

  await client.upsert(value.physicalCollection, {
    wait: true,
    points: [
      point(value, 2, { published: false }),
      point(value, 3, { corpus_version: 'other' }),
      point(value, 4, { jlpt_level: 'JLPT_N4' }),
      point(value, 5, { skill_codes: ['other'] }),
      point(value, 6, { embedding_config_id: 'other' }),
    ],
  });

  const filter = knowledgeFilter(filterInput, value);
  const result = await client.query(value.physicalCollection, {
    prefetch: [
      { query: dense(), using: 'dense', filter, limit: 20 },
      { query: { indices: [42], values: [1] }, using: 'sparse', filter, limit: 20 },
    ],
    query: { fusion: 'rrf' },
    filter,
    limit: 20,
  });

  assert.deepEqual(
    result.points.map((item) => item.id),
    [1],
  );

  await store.remove(value);
});

await test('HYBRID menolak sparse index precision yang berubah meski fingerprint metadata dipertahankan', async () => {
  const value = manifest('HYBRID');
  await store.prepare(value);
  const info = await client.getCollection(value.physicalCollection);
  await client.deleteCollection(value.physicalCollection);
  await client.createCollection(value.physicalCollection, {
    vectors: { dense: { size: 1024, distance: 'Cosine', datatype: 'float32' } },
    sparse_vectors: { sparse: { index: { datatype: 'float16' } } },
    shard_number: 1,
    replication_factor: 1,
    write_consistency_factor: 1,
    hnsw_config: { m: 16, ef_construct: 100, full_scan_threshold: 10000 },
    metadata: info.config.metadata ?? {},
  });

  await assert.rejects(store.prepare(value), { code: 'INCOMPATIBLE_INDEX' });

  await client.deleteCollection(value.physicalCollection);
});

await test('audit menolak checksum drift, label evaluasi/profil learner dan chunk ID duplikat', async () => {
  const value = manifest();
  await store.prepare(value);

  for (const overrides of [
    { text: '改ざんされた文。' },
    { expected_route: 'FAST' },
    { learner_id: 'private' },
    { published: false },
    { embedding_config_id: 'other' },
    { jlpt_level: 'JLPT_N3' },
    { jlpt_level: ['JLPT_N5'] },
    { license: undefined },
    { source_url: {} },
  ]) {
    await client.upsert(value.physicalCollection, {
      wait: true,
      points: [point(value, 1, overrides)],
    });

    await assert.rejects(store.validate(value), { code: 'INVALID_CONTENT' });
  }

  await store.remove(value);

  const duplicate = manifest('DENSE', [
    { chunkId: 'a', text: '七時に起きます。' },
    { chunkId: 'b', text: '七時に起きます。' },
  ]);
  await store.prepare(duplicate);
  await client.upsert(duplicate.physicalCollection, {
    wait: true,
    points: [point(duplicate, 1), point(duplicate, 2)],
  });

  await assert.rejects(store.validate(duplicate), { code: 'INVALID_CONTENT' });

  await store.remove(duplicate);
});

await test('promosi atomik alias menjaga physical pin; delete collection beralias ditolak', async () => {
  const old = manifest();
  const next = manifest();
  const alias = `kotoba_active_${randomUUID().replaceAll('-', '')}`;
  await store.prepare(old);
  await store.prepare(next);
  await client.upsert(old.physicalCollection, { wait: true, points: [point(old)] });
  await client.upsert(next.physicalCollection, { wait: true, points: [point(next)] });

  const oldPin = await store.promote(old, alias);

  await assert.rejects(store.remove(old), { code: 'UNSAFE_LIFECYCLE' });

  await store.promote(next, alias);

  assert.equal(
    (await client.getAliases()).aliases.find((item) => item.alias_name === alias)?.collection_name,
    next.physicalCollection,
  );
  assert.equal(oldPin.physicalCollection, old.physicalCollection);
  assert.equal((await store.validate(old)).physicalCollection, oldPin.physicalCollection);

  await client.updateCollectionAliases({ actions: [{ delete_alias: { alias_name: alias } }] });
  await store.remove(old);
  await store.remove(next);
});

await test('CLI prepare/validate berfungsi pada manifest file dan Qdrant nyata tanpa inference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'store01-cli-'));
  const value = manifest();
  const file = join(directory, 'manifest.json');
  await writeFile(file, JSON.stringify(value));

  function cli(action: string): unknown {
    return JSON.parse(
      execFileSync(process.execPath, ['--import', 'tsx', 'src/storage/cli.ts', action, file], {
        cwd: new URL('../../../', import.meta.url),
        env: {
          NODE_ENV: 'test',
          QDRANT_ENABLED: 'true',
          QDRANT_URL: url,
          QDRANT_TIMEOUT_MS: '5000',
        },
        encoding: 'utf8',
        timeout: 10000,
      }),
    ) as unknown;
  }

  try {
    const prepared = cli('prepare');

    assert.ok(prepared && typeof prepared === 'object' && 'created' in prepared);
    assert.equal(prepared.created, true);

    await client.upsert(value.physicalCollection, { wait: true, points: [point(value)] });
    const validated = cli('validate');

    assert.ok(validated && typeof validated === 'object' && 'pointCount' in validated);
    assert.equal(validated.pointCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await client.deleteCollection(value.physicalCollection);
  }
});

await test('named volumes mempertahankan schema, point dan query setelah restart container nyata', async () => {
  const container = process.env.STORE01_CONTAINER_ID;

  assert.ok(container && /^[a-f0-9]{12,64}$/.test(container));

  const value = manifest();
  await store.prepare(value);
  await client.upsert(value.physicalCollection, { wait: true, points: [point(value)] });

  execFileSync('docker', ['restart', container], { timeout: 30000, stdio: 'pipe' });

  // Docker may allocate a new host port when restarting a binding originally requested as :0.
  const address = execFileSync('docker', ['port', container, '6333/tcp'], {
    encoding: 'utf8',
  }).trim();

  assert.match(address, /^127\.0\.0\.1:\d+$/);

  const restartedUrl = `http://${address}`;
  const restartedStore = new QdrantIndexStore({ url: restartedUrl, timeoutMs: 5000 });
  const restartedClient = new QdrantClient({
    url: restartedUrl,
    timeout: 5000,
    checkCompatibility: false,
  });
  let ready = false;

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(`${restartedUrl}/readyz`, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      ready = false;
    }

    if (ready) {
      break;
    }

    await delay(100);
  }

  assert.equal(ready, true);
  assert.equal((await restartedStore.validate(value)).pointCount, 1);

  const result = await restartedClient.query(value.physicalCollection, {
    query: dense(),
    using: 'dense',
    filter: knowledgeFilter(filterInput, value),
    limit: 1,
  });

  assert.equal(result.points[0]?.id, 1);

  await restartedStore.remove(value);
});
