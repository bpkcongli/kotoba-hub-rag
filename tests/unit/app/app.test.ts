import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApplication } from '@/app';
import { readConfig } from '@/bootstrap/config';
import { readHfConfig } from '@/modules/rag/infrastructure/config/hf-config';
import type { Clock } from '@/shared/clock';

await test('composition root menerima clock; probes tidak memanggil jaringan/provider', async (t) => {
  const clock: Clock = {
    now: () => new Date('2026-11-23T12:00:00Z'),
    monotonicMs: () => 42,
  };

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  globalThis.fetch = () => {
    fetchCalls++;
    throw new Error('Network dilarang pada bootstrap');
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const directory = await mkdtemp(join(tmpdir(), 'api-app-'));

  const app = createApplication(
    readConfig({
      OBSERVATION_DIRECTORY: directory,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      API_SERVICE_TOKEN: 'api-fixture-token-123',
    }),
    clock,
  );

  t.after(async () => {
    await app.server.close();
    await rm(directory, { recursive: true, force: true });
  });

  assert.equal(app.clock.monotonicMs(), 42);

  for (let probe = 0; probe < 3; probe++) {
    const live = await app.server.inject({
      method: 'GET',
      url: '/health/live',
      headers: { authorization: 'Bearer api-fixture-token-123' },
    });
    const ready = await app.server.inject({
      method: 'GET',
      url: '/health/ready',
      headers: { authorization: 'Bearer api-fixture-token-123' },
    });

    assert.equal(live.statusCode, 200);
    assert.deepEqual(live.json<unknown>(), { status: 'live' });
    assert.ok(app.contracts.health(live.json<unknown>()));

    assert.equal(ready.statusCode, 503);
    assert.deepEqual(ready.json<unknown>(), { status: 'not_ready' });
    assert.ok(app.contracts.health(ready.json<unknown>()));
  }

  assert.equal(fetchCalls, 0);

  assert.equal(
    (
      await app.server.inject({
        method: 'POST',
        url: '/v1/practice/generate',
        payload: {},
      })
    ).statusCode,
    401,
  );
});

await test('HF enabled dirangkai tanpa inference pada startup, capability dan probe health', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = () => {
    calls++;

    return Promise.reject(new Error('Network dilarang pada health'));
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const app = createApplication(
    readConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      API_SERVICE_TOKEN: 'api-fixture-token-123',
    }),
    undefined,
    readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-token' }),
  );

  t.after(async () => {
    await app.server.close();
  });

  for (let i = 0; i < 3; i++) {
    assert.equal(app.inference?.capabilities().capable, true);
    assert.equal(app.inference?.capabilities().lastAttempt, null);
    assert.equal(
      (
        await app.server.inject({
          url: '/health/live',
          headers: { authorization: 'Bearer api-fixture-token-123' },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.server.inject({
          url: '/health/ready',
          headers: { authorization: 'Bearer api-fixture-token-123' },
        })
      ).statusCode,
      503,
    );
  }

  assert.equal(calls, 0);

  await app.server.close();

  assert.ok(app.inference);
  await assert.rejects(
    app.inference.embedding.embed(['日本語'], 'query', {
      executionId: 'closed-app',
      signal: new AbortController().signal,
      deadlineAt: new Date(Date.now() + 1000).toISOString(),
    }),
    { code: 'CANCELLED' },
  );

  assert.equal(calls, 0);
});

await test('OpenAI enabled dirangkai tanpa call pada startup/probe dan memerlukan admission aktif', async (t) => {
  const { readOpenAiConfig } = await import('@/modules/rag/infrastructure/config/openai-config');
  const originalFetch = globalThis.fetch;

  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    return Promise.reject(new Error('Network dilarang pada health'));
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const app = createApplication(
    readConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      API_SERVICE_TOKEN: 'api-fixture-token-123',
    }),
    undefined,
    null,
    null,
    undefined,
    readOpenAiConfig({ OPENAI_ENABLED: 'true', OPENAI_API_KEY: 'fixture-token' }),
  );
  t.after(() => app.server.close());

  assert.ok(app.generator);
  assert.ok(app.baseline);
  assert.ok(app.contextBuilder);

  await app.server.inject({
    url: '/health/live',
    headers: { authorization: 'Bearer api-fixture-token-123' },
  });

  assert.equal(
    (
      await app.server.inject({
        url: '/health/ready',
        headers: { authorization: 'Bearer api-fixture-token-123' },
      })
    ).statusCode,
    503,
  );
  await assert.rejects(
    async () =>
      app.generator?.generate(
        {
          operation: 'evaluate',
          model: 'gpt-5.6-terra',
          instructions: 'fixture',
          input: '{}',
          schemaName: 'fixture',
          jsonSchema: {},
        },
        {
          executionId: 'not-admitted',
          signal: new AbortController().signal,
          deadlineAt: new Date(Date.now() + 10000).toISOString(),
        },
      ),
    { code: 'EXECUTION_NOT_ACTIVE' },
  );

  assert.equal(calls, 0);
});

await test('retrieval enabled tetap tanpa I/O jaringan pada startup/health dan menolak non-admitted calls', async (t) => {
  const { readOpenAiConfig } = await import('@/modules/rag/infrastructure/config/openai-config');
  const { readFile } = await import('node:fs/promises');
  const { retrievalConfig } = await import('@/modules/rag/infrastructure/config/retrieval');
  const index: unknown = JSON.parse(
    await readFile('research/indexing/data-03-v1/index-manifest.json', 'utf8'),
  );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    return Promise.reject(new Error('No network'));
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  const { readQdrantConfig } = await import('@/modules/knowledge/application/connection-settings');
  const app = createApplication(
    readConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      API_SERVICE_TOKEN: 'api-fixture-token-123',
    }),
    undefined,
    readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-key' }),
    readQdrantConfig({ QDRANT_ENABLED: 'true' }),
    undefined,
    readOpenAiConfig({ OPENAI_ENABLED: 'true', OPENAI_API_KEY: 'fixture-key' }),
    retrievalConfig(index),
  );
  t.after(() => app.server.close());

  assert.ok(app.retriever);
  assert.ok(app.retrievalStage);
  assert.ok(app.singleStage);

  await app.server.inject({
    url: '/health/live',
    headers: { authorization: 'Bearer api-fixture-token-123' },
  });

  assert.equal(
    (
      await app.server.inject({
        url: '/health/ready',
        headers: { authorization: 'Bearer api-fixture-token-123' },
      })
    ).statusCode,
    503,
  );
  await assert.rejects(
    async () =>
      app.retriever?.retrieve(
        { dense: [] },
        { published: true, corpusVersion: 'x', targetLevel: 'JLPT_N5', skillCodes: ['x'] },
        5,
        {
          executionId: 'unrecorded',
          signal: new AbortController().signal,
          deadlineAt: new Date(Date.now() + 1000).toISOString(),
        },
      ),
    { code: 'EXECUTION_NOT_ACTIVE' },
  );

  assert.equal(calls, 0);
});
