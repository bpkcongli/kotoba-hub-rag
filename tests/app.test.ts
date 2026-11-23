import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readHfConfig } from '@/adapters/hf-config';
import { createApplication } from '@/app';
import { readConfig } from '@/shared/config';
import type { Clock } from '@/shared/ports';

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

  const app = createApplication(readConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }), clock);

  t.after(async () => {
    await app.server.close();
  });

  assert.equal(app.clock.monotonicMs(), 42);

  for (let probe = 0; probe < 3; probe++) {
    const live = await app.server.inject({
      method: 'GET',
      url: '/health/live',
    });
    const ready = await app.server.inject({
      method: 'GET',
      url: '/health/ready',
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
    404,
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
    readConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    undefined,
    readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-token' }),
  );

  t.after(async () => {
    await app.server.close();
  });

  for (let i = 0; i < 3; i++) {
    assert.equal(app.inference?.capabilities().capable, true);
    assert.equal(app.inference?.capabilities().lastAttempt, null);
    assert.equal((await app.server.inject('/health/live')).statusCode, 200);
    assert.equal((await app.server.inject('/health/ready')).statusCode, 503);
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
