import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { HF_IDENTITY, readHfConfig } from '@/adapters/hf-config';
import { createHfInference } from '@/adapters/hf-inference';
import { ConfigError } from '@/shared/config';

await test('HF opt-in, konfigurasi immutable dan identitas served revision tetap unknown', () => {
  assert.equal(readHfConfig({}), null);
  assert.equal(readHfConfig({ HF_INFERENCE_ENABLED: 'false' }), null);

  const config = readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-token' });

  assert.ok(config);
  assert.ok(Object.isFrozen(config));
  assert.equal(config.profile, 'DENSE');
  assert.equal(config.embeddingBatchSize, 1);
  assert.equal(config.rerankerBatchSize, 2);
  assert.equal(config.maxConcurrency, 1);
  assert.equal(HF_IDENTITY.servedModelRevision, null);
  assert.equal(HF_IDENTITY.tokenizerRevision, null);
  assert.equal(HF_IDENTITY.processingRevision, null);
});

await test('config menolak kredensial, override provider/model/endpoint dan limit invalid', () => {
  const base = { HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-token' };
  const invalid = [
    { HF_INFERENCE_ENABLED: '' },
    { HF_INFERENCE_ENABLED: true },
    { HF_TOKEN: '' },
    { HF_TOKEN: 'private\nsecret' },
    { HF_TOKEN: null },
    { RETRIEVAL_PROFILE: 'AUTO' },
    { EMBEDDING_PROVIDER: 'auto' },
    { EMBEDDING_MODEL: 'other/model' },
    { RERANKER_MODEL: 'other/model' },
    { EMBEDDING_ENDPOINT: 'https://untrusted.test/?token=private-secret' },
    { RERANKER_ENDPOINT: `${HF_IDENTITY.rerankerEndpoint}?token=private-secret` },
    { HF_MAX_CONCURRENCY: '0' },
    { HF_MAX_CONCURRENCY: '9' },
    { HF_EMBEDDING_BATCH_SIZE: '0' },
    { HF_RERANKER_BATCH_SIZE: '33' },
    { HF_MAX_ITEMS: '1025' },
    { HF_MAX_TEXT_CHARS: '32769' },
    { HF_MAX_RESPONSE_BYTES: '8388609' },
    { HF_TIMEOUT_MS: '120001' },
    { HF_TIMEOUT_MS: '1e3' },
    { HF_TIMEOUT_MS: 1000 },
  ];

  for (const override of invalid) {
    assert.throws(
      () => readHfConfig({ ...base, ...override }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.doesNotMatch(error.message, /private|fixture-token|untrusted/);

        return true;
      },
    );
  }

  assert.throws(() => readHfConfig({ HF_INFERENCE_ENABLED: 'true' }), ConfigError);
});

await test('factory memvalidasi ulang config langsung sebelum resource/call dibuat', () => {
  const config = readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-token' });

  assert.ok(config);
  assert.throws(
    () =>
      createHfInference(
        { ...config, embeddingBatchSize: 0 },
        { onAttempt: () => Promise.resolve() },
      ),
    ConfigError,
  );
});

await test('startup HF invalid berhenti sebelum listen tanpa mengungkap secret', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: new URL('../../../', import.meta.url),
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      HF_INFERENCE_ENABLED: 'true',
      HF_TOKEN: 'private\nsecret',
    },
    encoding: 'utf8',
    timeout: 10000,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Konfigurasi tidak valid: HF_TOKEN/);
  assert.doesNotMatch(result.stderr, /private|secret/);
  assert.equal(result.stdout, '');
});
