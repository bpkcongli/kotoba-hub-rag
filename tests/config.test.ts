import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ConfigError, readConfig } from '@/shared/config';

await test('default bootstrap lokal dan override valid diparse tanpa coercion longgar', () => {
  assert.deepEqual(readConfig({}), {
    environment: 'development',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'info',
    shutdownTimeoutMs: 10000,
  });

  const config = readConfig({
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '8080',
    LOG_LEVEL: 'warn',
    SHUTDOWN_TIMEOUT_MS: '500',
  });

  assert.equal(config.port, 8080);
  assert.equal(config.environment, 'production');
  assert.ok(Object.isFrozen(config));
});

await test('config invalid ditolak, termasuk kosong, non-string, rentang dan enum', () => {
  const invalid: Record<string, unknown>[] = [
    { PORT: '' },
    { PORT: '0' },
    { PORT: '65536' },
    { PORT: '1.2' },
    { PORT: '3e3' },
    { PORT: 3000 },
    { HOST: '' },
    { HOST: 'https://localhost' },
    { HOST: 'local host' },
    { HOST: {} },
    { NODE_ENV: 'staging' },
    { LOG_LEVEL: 'verbose' },
    { SHUTDOWN_TIMEOUT_MS: '99' },
    { SHUTDOWN_TIMEOUT_MS: '30001' },
  ];

  for (const env of invalid) {
    assert.throws(() => readConfig(env), ConfigError);
  }
});

await test('startup sungguhan gagal sebelum listen dengan pesan tersanitasi', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: new URL('../', import.meta.url),
    env: {
      NODE_ENV: 'test',
      PORT: 'secret-value-must-not-leak',
      LOG_LEVEL: 'silent',
    },
    encoding: 'utf8',
    timeout: 10000,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);

  assert.match(result.stderr, /Konfigurasi tidak valid: PORT/);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /secret-value-must-not-leak/);
});
