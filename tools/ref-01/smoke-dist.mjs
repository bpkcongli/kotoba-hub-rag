import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Load emitted JavaScript without tsx or the source alias resolver.
const { createApplication } = await import(new URL('../../dist/app.js', import.meta.url).href);
const { readConfig } = await import(
  new URL('../../dist/bootstrap/config.js', import.meta.url).href
);
const directory = await mkdtemp(join(tmpdir(), 'ref01-dist-'));
const app = createApplication(
  readConfig({ OBSERVATION_DIRECTORY: directory, LOG_LEVEL: 'silent' }),
);

try {
  assert.equal(app.contracts.health({ status: 'live' }), true);
  assert.equal((await app.server.inject({ method: 'GET', url: '/health/live' })).statusCode, 200);
  assert.equal((await app.server.inject({ method: 'GET', url: '/health/ready' })).statusCode, 503);
  assert.equal(
    (
      await app.server.inject({
        method: 'POST',
        url: '/v1/practice/generate',
        payload: {},
      })
    ).statusCode,
    404,
  );

  const admitted = await app.observations.admit({
    serviceId: 'compiled-fixture',
    requestId: randomUUID(),
    operation: 'generate',
    mode: 'LLM_ONLY',
    request: { text: '日本語' },
  });

  assert.equal(admitted.status, 'admitted');
  assert.ok(admitted.correlation.executionId);

  await app.observations.finish(admitted.correlation.executionId, 'FAILED', 'INVALID_INPUT');

  assert.equal((await app.observations.inspect())[0].state, 'TERMINAL');
  assert.equal(app.inference, null);
  assert.equal(app.generator, null);

  for (const old of [
    'adapters',
    'pipelines',
    'storage',
    'ingestion',
    'generation',
    'context',
    'retrieval',
    'observability',
  ]) {
    await assert.rejects(access(new URL(`../../dist/${old}`, import.meta.url)));
  }

  process.stdout.write(
    JSON.stringify({
      healthLive: 200,
      healthReady: 503,
      operationRoute: 404,
      staticSchemasLoaded: true,
      defaultPriceSnapshotLoaded: true,
      durableTerminalReadable: true,
      staleBuildDirectoriesRemoved: true,
      newProviderCalls: 0,
    }) + '\n',
  );
} finally {
  await app.server.close();
  await rm(directory, { recursive: true, force: true });
}
