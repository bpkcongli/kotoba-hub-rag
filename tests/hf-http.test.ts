import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { readHfConfig } from '@/adapters/hf-config';
import { createHfInference } from '@/adapters/hf-inference';
import type { InferenceAttempt } from '@/adapters/hf-inference';

await test('adapter memakai fetch HTTP nyata pada fixture loopback, tanpa endpoint HF', async (t) => {
  const payloads: unknown[] = [];
  const fixture = createServer((request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, 'Bearer fixture-token');

    const chunks: Buffer[] = [];

    request.on('data', (chunk: unknown) => {
      assert.ok(Buffer.isBuffer(chunk));
      chunks.push(chunk);
    });

    request.on('end', () => {
      payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      response.setHeader('content-type', 'application/json');
      response.setHeader('x-request-id', `fixture-${payloads.length}`);

      if (payloads.length === 2) {
        response.statusCode = 429;
        response.setHeader('retry-after', '3');
        response.end('{}');

        return;
      }

      response.end(JSON.stringify([Array<number>(1024).fill(0.25)]));
    });
  });

  t.after(async () => {
    fixture.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      fixture.close((error) => (error ? reject(error) : resolve())),
    );
  });

  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');

  const address = fixture.address() as AddressInfo;
  const config = readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-token' });
  const attempts: InferenceAttempt[] = [];

  assert.ok(config);

  const adapter = createHfInference(config, {
    // The production URL stays fixed; only this injected test transport targets loopback.
    fetch: (_url, init) => globalThis.fetch(`http://127.0.0.1:${address.port}`, init),
    onAttempt: (attempt) => {
      attempts.push(attempt);
      return Promise.resolve();
    },
  });

  t.after(() => {
    adapter.close();
  });

  const vectors = await adapter.embedding.embed(['日本語'], 'query', {
    executionId: 'http-fixture',
    signal: new AbortController().signal,
    deadlineAt: new Date(Date.now() + 10000).toISOString(),
  });

  assert.equal(vectors[0]?.dense.length, 1024);
  assert.deepEqual(payloads[0], { inputs: ['日本語'], normalize: true, truncate: false });
  assert.equal(attempts[0]?.providerRequestId, 'fixture-1');

  await assert.rejects(
    adapter.embedding.embed(['second'], 'query', {
      executionId: 'http-fixture-429',
      signal: new AbortController().signal,
      deadlineAt: new Date(Date.now() + 10000).toISOString(),
    }),
    { code: 'RATE_LIMITED', retryAfterMs: 3000 },
  );

  assert.equal(payloads.length, 2);
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every((attempt) => attempt.costUsd === null && attempt.usage === null));
});
