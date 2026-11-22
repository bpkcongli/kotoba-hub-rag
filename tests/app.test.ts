import assert from 'node:assert/strict';
import { test } from 'node:test';
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
