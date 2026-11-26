import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { createApplication } from '@/app';
import { ConfigError, readConfig } from '@/shared/config';
import {
  contentDigest,
  INDEX_SCHEMA_VERSION,
  manifestFingerprint,
  parseIndexManifest,
} from '@/storage/index-manifest';
import { knowledgeFilter } from '@/storage/knowledge-filter';
import { parseKnowledgePayload } from '@/storage/knowledge-payload';
import { readQdrantConfig } from '@/storage/qdrant-config';
import { QdrantIndexStore } from '@/storage/qdrant-index';

function fixture() {
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    indexRevision: 'unit_v1',
    physicalCollection: 'kotoba_unit_v1',
    corpusVersion: 'unit-corpus-v1',
    retrievalProfile: 'DENSE',
    embeddingConfigId: 'hf-bge-v1',
    embeddingModelRevision: null,
    tokenizerRevision: null,
    processingRevision: null,
    sparseCapabilityVerified: false,
    sparseTokenMappingId: null,
    expectedPointCount: 0,
    contentDigest: contentDigest([]),
  };
}

await test('manifest strict menolak profil/revision/field tambahan tanpa coercion atau mutasi', () => {
  const raw = fixture();
  const parsed = parseIndexManifest(raw);

  assert.ok(Object.isFrozen(parsed));
  assert.equal(parsed.embeddingModelRevision, null);
  assert.deepEqual(raw, fixture());

  for (const override of [
    { retrievalProfile: 'AUTO' },
    { retrievalProfile: 'HYBRID' },
    { retrievalProfile: 'HYBRID', sparseCapabilityVerified: true },
    { sparseCapabilityVerified: true },
    { sparseTokenMappingId: 'undeclared' },
    { indexRevision: 'other' },
    { physicalCollection: 'alias_name' },
    { corpusVersion: '' },
    { expectedPointCount: '0' },
    { expectedPointCount: -1 },
    { expectedPointCount: 100001 },
    { embeddingConfigId: '' },
    { contentDigest: 'bad' },
    { learner_id: 'private' },
    { expected_route: 'FAST' },
    { HF_TOKEN: 'private' },
  ]) {
    assert.throws(() => parseIndexManifest({ ...raw, ...override }), { code: 'INVALID_MANIFEST' });
  }

  assert.equal(
    parseIndexManifest({
      ...raw,
      retrievalProfile: 'HYBRID',
      sparseCapabilityVerified: true,
      sparseTokenMappingId: 'verified-fixture',
    }).retrievalProfile,
    'HYBRID',
  );
});

await test('payload mensyaratkan seluruh metadata minimum, tipe strict dan provenance tanpa field evaluator/learner', () => {
  const payload = {
    chunk_id: 'chunk-a',
    parent_id: 'source-a',
    corpus_version: 'v1',
    source_id: 'source-a',
    source_url: 'https://example.invalid/source',
    license: 'synthetic-only',
    content_checksum: 'a'.repeat(64),
    track_slug: null,
    unit_slug: null,
    lesson_slug: null,
    skill_codes: ['grammar-ni'],
    jlpt_level: 'JLPT_N5',
    locale: 'ID',
    content_type: 'example',
    published: true,
    chunk_index: 0,
    token_count: 8,
    embedding_revision: null,
    embedding_config_id: 'v1',
    chunking_version: 'synthetic-v1',
    text: '七時に起きます。',
  };

  assert.deepEqual(parseKnowledgePayload(payload), payload);

  for (const field of Object.keys(payload)) {
    const missing: Record<string, unknown> = { ...payload };
    delete missing[field];

    assert.throws(() => parseKnowledgePayload(missing), { code: 'INVALID_CONTENT' });
    assert.throws(() => parseKnowledgePayload({ ...payload, [field]: {} }), {
      code: 'INVALID_CONTENT',
    });
  }

  for (const override of [
    { jlpt_level: ['JLPT_N5'] },
    { published: 'true' },
    { token_count: '8' },
    { chunk_index: -1 },
    { token_count: 0 },
    { source_url: 'not-a-uri' },
    { license: '   ' },
    { locale: 'FR' },
    { expected_route: 'FAST' },
    { learner_profile: {} },
  ]) {
    assert.throws(() => parseKnowledgePayload({ ...payload, ...override }), {
      code: 'INVALID_CONTENT',
    });
  }
});

await test('fingerprint canonical mengikat profile, physical revision, embedding dan inventory', () => {
  const value = parseIndexManifest(fixture());
  const reordered = Object.fromEntries(Object.entries(fixture()).reverse());

  assert.equal(manifestFingerprint(value), manifestFingerprint(parseIndexManifest(reordered)));

  for (const override of [
    { embeddingConfigId: 'changed' },
    { corpusVersion: 'changed' },
    { embeddingModelRevision: 'known-revision' },
    { tokenizerRevision: 'known-tokenizer' },
    { processingRevision: 'known-processing' },
    { expectedPointCount: 1 },
    {
      retrievalProfile: 'HYBRID',
      sparseCapabilityVerified: true,
      sparseTokenMappingId: 'verified-fixture',
    },
    { indexRevision: 'new', physicalCollection: 'kotoba_new' },
  ]) {
    assert.notEqual(
      manifestFingerprint(value),
      manifestFingerprint(parseIndexManifest({ ...value, ...override })),
    );
  }

  const chunks = [
    { chunkId: 'b', checksum: 'bb' },
    { chunkId: 'a', checksum: 'aa' },
  ];

  assert.equal(contentDigest(chunks), contentDigest([...chunks].reverse()));
  assert.notEqual(contentDigest(chunks), contentDigest([{ chunkId: 'a', checksum: 'changed' }]));
});

await test('filter menolak scope invalid dan tidak dapat dilemahkan menjadi pencarian tanpa skill', () => {
  const value = parseIndexManifest(fixture());
  const valid = {
    published: true,
    corpusVersion: value.corpusVersion,
    targetLevel: 'JLPT_N5',
    skillCodes: ['a', 'a'],
  } as const;

  assert.deepEqual(knowledgeFilter(valid, value).must, [
    { key: 'published', match: { value: true } },
    { key: 'corpus_version', match: { value: value.corpusVersion } },
    { key: 'jlpt_level', match: { value: 'JLPT_N5' } },
    { key: 'skill_codes', match: { any: ['a'] } },
    { key: 'embedding_config_id', match: { value: value.embeddingConfigId } },
  ]);

  assert.throws(() => knowledgeFilter({ ...valid, corpusVersion: 'other' }, value));
  assert.throws(() => knowledgeFilter({ ...valid, skillCodes: [] }, value));
  assert.throws(() => knowledgeFilter({ ...valid, skillCodes: [''] }, value));
  assert.throws(() =>
    knowledgeFilter({ ...valid, skillCodes: Array<string>(65).fill('a') }, value),
  );
});

await test('config Qdrant opt-in, URL TLS/loopback dan timeout tervalidasi tanpa membocorkan value', () => {
  assert.equal(readQdrantConfig({}), null);

  const config = readQdrantConfig({ QDRANT_ENABLED: 'true' });

  assert.deepEqual(config, { url: 'http://127.0.0.1:6333', timeoutMs: 5000 });
  assert.ok(Object.isFrozen(config));
  assert.equal(
    readQdrantConfig({ QDRANT_ENABLED: 'true', QDRANT_URL: 'https://qdrant.example/' })?.url,
    'https://qdrant.example',
  );

  for (const override of [
    { QDRANT_ENABLED: '' },
    { QDRANT_URL: 123 },
    { QDRANT_URL: 'http://public.example' },
    { QDRANT_URL: 'https://user:private@qdrant.example' },
    { QDRANT_URL: 'https://qdrant.example/?api-key=private' },
    { QDRANT_URL: 'https://qdrant.example/path' },
    { QDRANT_URL: 'https://qdrant.example/#private' },
    { QDRANT_API_KEY: '' },
    { QDRANT_API_KEY: 'private\nvalue' },
    { QDRANT_TIMEOUT_MS: '0' },
    { QDRANT_TIMEOUT_MS: '30001' },
    { QDRANT_TIMEOUT_MS: '1e3' },
  ]) {
    assert.throws(
      () => readQdrantConfig({ QDRANT_ENABLED: 'true', ...override }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.doesNotMatch(error.message, /private|public.example|qdrant.example/);

        return true;
      },
    );
  }
});

await test('startup dan probe Qdrant enabled tidak memanggil jaringan atau membuat collection', async (t) => {
  const original = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = () => {
    calls++;
    return Promise.reject(new Error('network forbidden'));
  };

  t.after(() => {
    globalThis.fetch = original;
  });

  const app = createApplication(
    readConfig({ LOG_LEVEL: 'silent' }),
    undefined,
    null,
    readQdrantConfig({ QDRANT_ENABLED: 'true' }),
  );

  t.after(async () => {
    await app.server.close();
  });

  assert.ok(app.storage);

  for (let i = 0; i < 3; i++) {
    assert.equal((await app.server.inject('/health/live')).statusCode, 200);
    assert.equal((await app.server.inject('/health/ready')).statusCode, 503);
  }

  assert.equal(calls, 0);
});

await test('promosi empty/unknown model revision gagal sebelum jaringan', async () => {
  const store = new QdrantIndexStore({ url: 'http://127.0.0.1:1', timeoutMs: 5 });
  const value = parseIndexManifest(fixture());

  await assert.rejects(store.promote(value, 'kotoba_active_default'), { code: 'UNSAFE_LIFECYCLE' });
  await assert.rejects(
    store.promote({ ...value, expectedPointCount: 1 }, 'kotoba_active_default'),
    { code: 'UNSAFE_LIFECYCLE' },
  );
  await assert.rejects(store.promote(value, 'unowned_alias'), { code: 'UNSAFE_LIFECYCLE' });
});

await test('SDK failure menjadi error tersanitasi tanpa mengekspos URL atau raw error', async () => {
  const store = new QdrantIndexStore({ url: 'http://127.0.0.1:1', timeoutMs: 5 });

  await assert.rejects(store.prepare(parseIndexManifest(fixture())), (error: unknown) => {
    assert.ok(error instanceof Error && 'code' in error);
    assert.equal(error.code, 'DEPENDENCY_ERROR');
    assert.equal(error.message, 'Qdrant storage failed: DEPENDENCY_ERROR');

    return true;
  });
});

await test('config storage invalid menghentikan startup sebelum listen', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      QDRANT_ENABLED: 'true',
      QDRANT_URL: 'https://private:secret@example.test',
    },
    encoding: 'utf8',
    timeout: 10000,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Konfigurasi tidak valid: QDRANT_URL/);
  assert.doesNotMatch(result.stderr, /private|secret|example.test/);
  assert.equal(result.stdout, '');
});
