import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { HF_IDENTITY, readHfConfig } from '@/adapters/hf-config';
import type { HfConfig } from '@/adapters/hf-config';
import { createHfInference, InferenceError } from '@/adapters/hf-inference';
import type { HfDependencies, InferenceAttempt, InferenceErrorCode } from '@/adapters/hf-inference';
import { parseHfEmbeddings, parseHfScores, validateEmbeddingBatch } from '@/adapters/hf-validation';
import type { CallContext, Evidence } from '@/shared/ports';

function config(override: Partial<HfConfig> = {}): HfConfig {
  const value = readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-token' });

  assert.ok(value);

  return { ...value, ...override };
}

function context(signal = new AbortController().signal): CallContext {
  return {
    executionId: 'fixture-execution',
    deadlineAt: new Date(Date.now() + 10000).toISOString(),
    signal,
  };
}

function dense(number = 1): number[] {
  return Array.from({ length: 1024 }, () => number);
}

function evidence(chunkId: string): Evidence {
  return { chunkId, sourceId: 'source', text: `例文 ${chunkId}`, score: 0.4, scoreType: 'dense' };
}

function errorCode(code: InferenceErrorCode): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof InferenceError);
    assert.equal(error.code, code);

    return true;
  };
}

function harness(fetch: typeof globalThis.fetch, override: Partial<HfConfig> = {}) {
  const attempts: InferenceAttempt[] = [];
  const adapter = createHfInference(config(override), {
    fetch,
    onAttempt: (attempt) => {
      attempts.push(attempt);

      return Promise.resolve();
    },
  });

  return { adapter, attempts };
}

async function capture(file: string): Promise<unknown> {
  const raw: unknown = JSON.parse(
    await readFile(
      new URL(`../docs/inference/runs/2026-11-23-hf-smoke-01/${file}`, import.meta.url),
      'utf8',
    ),
  );

  assert.ok(raw !== null && typeof raw === 'object' && 'responseText' in raw);
  assert.equal(typeof raw.responseText, 'string');
  assert.ok(typeof raw.responseText === 'string');

  return JSON.parse(raw.responseText) as unknown;
}

await test('parser memutar ulang capture dense JA/EN/ID dan kedua layout pair INF-01', async () => {
  for (const language of ['ja', 'en', 'id']) {
    const vectors = parseHfEmbeddings(await capture(`${language}-query.json`), 1);

    assert.equal(vectors.length, 1);
    assert.equal(vectors[0]?.dense.length, 1024);
    assert.equal(Object.hasOwn(vectors[0] ?? {}, 'sparse'), false);
  }

  const ja = parseHfScores(await capture('pair-probe/pair-ja-0.json'), 2);
  const en = parseHfScores(await capture('pair-probe/continuation/pair-en-0.json'), 1);

  assert.equal(ja.length, 2);
  assert.ok((ja[0] ?? 0) > (ja[1] ?? 0));
  assert.ok((en[0] ?? 0) < 0);
});

await test('DENSE/HYBRID dan malformed sparse dibedakan tanpa sparse kosong palsu', () => {
  const value = { dense: dense() };

  assert.deepEqual(validateEmbeddingBatch([value], 1, 'DENSE'), [value]);
  assert.throws(() => validateEmbeddingBatch([value], 1, 'HYBRID'));
  assert.equal(
    validateEmbeddingBatch([{ ...value, sparse: { indices: [42], values: [0.5] } }], 1, 'HYBRID')
      .length,
    1,
  );

  for (const sparse of [
    null,
    undefined,
    {},
    { indices: [], values: [] },
    { indices: [1, 1], values: [1, 1] },
    { indices: [250002], values: [1] },
    { indices: [1], values: [-1] },
    { indices: [1], values: [NaN] },
  ]) {
    assert.throws(() => validateEmbeddingBatch([{ ...value, sparse }], 1, 'DENSE'));
  }

  for (const invalid of [
    [],
    [[1]],
    [dense(0)],
    [dense(NaN)],
    [dense(Infinity)],
    [{ dense: dense() }],
    [new Array<unknown>(1024)],
  ]) {
    assert.throws(() => parseHfEmbeddings(invalid, 1));
  }

  for (const invalid of [
    [],
    [[{ label: 'OTHER', score: 1 }]],
    [[{ label: 'LABEL_0', score: NaN }]],
    [
      [
        { label: 'LABEL_0', score: 1 },
        { label: 'LABEL_0', score: 2 },
      ],
    ],
  ]) {
    assert.throws(() => parseHfScores(invalid, 1));
  }
});

await test('embedding batch menjaga urutan, purpose dan wire config sama untuk dokumen/query', async () => {
  const payloads: unknown[] = [];
  const urls: string[] = [];
  let call = 0;
  const { adapter, attempts } = harness((url, init) => {
    assert.equal(typeof url, 'string');
    assert.ok(typeof url === 'string');
    urls.push(url);
    assert.equal(init?.redirect, 'error');
    assert.ok(typeof init?.body === 'string');
    payloads.push(JSON.parse(init.body) as unknown);
    call++;

    return Promise.resolve(
      Response.json([dense(call)], { headers: { 'x-request-id': `request-${call}` } }),
    );
  });

  const vectors = await adapter.embedding.embed(
    ['日本語', 'English', 'Indonesia'],
    'document',
    context(),
  );
  await adapter.embedding.embed(['query'], 'query', context());

  assert.deepEqual(
    vectors.map((vector) => vector.dense[0]),
    [1, 2, 3],
  );
  assert.deepEqual(payloads[0], { inputs: ['日本語'], normalize: true, truncate: false });
  assert.deepEqual(urls, Array<string>(4).fill(HF_IDENTITY.embeddingEndpoint));
  assert.deepEqual(
    attempts.map((attempt) => attempt.purpose),
    ['document', 'document', 'document', 'query'],
  );
  assert.equal(new Set(attempts.map((attempt) => attempt.attemptId)).size, 4);

  for (const attempt of attempts) {
    assert.equal(attempt.identity, HF_IDENTITY);
    assert.equal(attempt.costUsd, null);
    assert.equal(attempt.usage, null);
    assert.equal(attempt.errorCode, null);
    assert.equal(attempt.remoteOutcome, 'response_received');
    assert.equal(attempt.executionId, 'fixture-execution');
  }
});

await test('reranker batch memetakan input IDs sebelum sort dan mempertahankan stable tie', async () => {
  let calls = 0;
  const { adapter, attempts } = harness((url, init) => {
    assert.equal(url, HF_IDENTITY.rerankerEndpoint);
    assert.ok(typeof init?.body === 'string');
    const raw: unknown = JSON.parse(init.body);

    assert.deepEqual(raw, {
      inputs: {
        inputs: (calls === 0 ? ['a', 'b'] : ['c']).map((id) => ({
          text: 'query',
          text_pair: `例文 ${id}`,
        })),
      },
      parameters: { function_to_apply: 'none' },
    });

    calls++;

    return Promise.resolve(
      Response.json(
        calls === 1
          ? [
              [
                { label: 'LABEL_0', score: -4 },
                { label: 'LABEL_0', score: 3 },
              ],
            ]
          : [[{ label: 'LABEL_0', score: 3 }]],
      ),
    );
  });

  const result = await adapter.reranker.rerank('query', ['a', 'b', 'c'].map(evidence), context());

  assert.deepEqual(
    result.map(({ chunkId, score }) => [chunkId, score]),
    [
      ['b', 3],
      ['c', 3],
      ['a', -4],
    ],
  );
  assert.ok(result.every((item) => item.scoreType === 'hf_none_raw_logit_unverified'));
  assert.deepEqual(
    attempts.map((attempt) => attempt.itemCount),
    [2, 1],
  );
});

await test('embedding multi-item batch, snapshot input dan config tidak berubah saat await', async () => {
  const inputs = ['日本語', 'English', 'Indonesia'];
  const settings = config({ embeddingBatchSize: 2 });
  const attempts: InferenceAttempt[] = [];
  let calls = 0;
  const adapter = createHfInference(settings, {
    fetch: (_url, init) => {
      assert.ok(typeof init?.body === 'string');
      const raw: unknown = JSON.parse(init.body);

      assert.deepEqual(raw, {
        inputs: calls === 0 ? ['日本語', 'English'] : ['Indonesia'],
        normalize: true,
        truncate: false,
      });
      inputs[2] = 'mutated';
      calls++;

      return Promise.resolve(Response.json(calls === 1 ? [dense(1), dense(2)] : [dense(3)]));
    },
    onAttempt: (attempt) => {
      attempts.push(attempt);
      return Promise.resolve();
    },
  });

  const pending = adapter.embedding.embed(inputs, 'document', context());
  Object.assign(settings, { profile: 'HYBRID', embeddingBatchSize: 0 });
  const results = await pending;

  assert.deepEqual(
    results.map((item) => item.dense[0]),
    [1, 2, 3],
  );
  assert.equal(calls, 2);
  assert.equal(adapter.capabilities().profile, 'DENSE');
  assert.equal(attempts[0]?.configuration.embeddingBatchSize, 2);
  assert.equal('token' in (attempts[0]?.configuration ?? {}), false);
});

await test('concurrency bersama membatasi embedding dan rerank tanpa antrean atau retry', async () => {
  const resolvers: ((response: Response) => void)[] = [];
  const { adapter, attempts } = harness(
    () =>
      new Promise<Response>((resolve) => {
        resolvers.push(resolve);
      }),
    { maxConcurrency: 2 },
  );
  const embedding = adapter.embedding.embed(['q'], 'query', context());
  const rerank = adapter.reranker.rerank('q', [evidence('a')], context());

  await assert.rejects(
    adapter.embedding.embed(['q'], 'query', context()),
    errorCode('CAPACITY_LIMIT'),
  );

  assert.equal(resolvers.length, 2);
  resolvers[0]?.(Response.json([dense()]));
  resolvers[1]?.(Response.json([[{ label: 'LABEL_0', score: 0.5 }]]));
  await Promise.all([embedding, rerank]);

  assert.equal(attempts.length, 2);
});

await test('total deadline memakai budget monotonic lintas batch, termasuk observer', async () => {
  let monotonic = 0;
  let calls = 0;
  const now = new Date();
  const attempts: InferenceAttempt[] = [];
  const adapter = createHfInference(config(), {
    clock: { now: () => now, monotonicMs: () => monotonic },
    fetch: () => {
      calls++;
      return Promise.resolve(Response.json([dense()]));
    },
    onAttempt: (attempt) => {
      attempts.push(attempt);
      monotonic += 100;

      return Promise.resolve();
    },
  });

  await assert.rejects(
    adapter.embedding.embed(['a', 'b'], 'query', {
      ...context(),
      deadlineAt: new Date(now.getTime() + 50).toISOString(),
    }),
    errorCode('DEADLINE_EXCEEDED'),
  );

  assert.equal(calls, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.errorCode, null);
});

await test('HYBRID capability belum terbukti: fail tanpa network atau fallback', async () => {
  let calls = 0;
  const { adapter, attempts } = harness(
    () => {
      calls++;

      return Promise.reject(new Error('unexpected'));
    },
    { profile: 'HYBRID' },
  );

  for (let probe = 0; probe < 3; probe++) {
    assert.equal(adapter.capabilities().capable, false);
    assert.equal(adapter.capabilities().sparse, 'unverified');
  }

  await assert.rejects(
    adapter.embedding.embed(['query'], 'query', context()),
    errorCode('CAPABILITY_UNAVAILABLE'),
  );

  assert.equal(calls, 0);
  assert.equal(attempts.length, 0);
});

await test('429 menyimpan Retry-After tanpa retry; batch berikut tidak dikirim', async () => {
  let calls = 0;
  const { adapter, attempts } = harness(() => {
    calls++;

    return Promise.resolve(
      new Response('fixture-token private-response', {
        status: 429,
        headers: { 'retry-after': '2', 'x-request-id': 'rate-limit-id' },
      }),
    );
  });

  await assert.rejects(
    adapter.embedding.embed(['a', 'b'], 'query', context()),
    (error: unknown) => {
      assert.ok(error instanceof InferenceError);
      assert.equal(error.code, 'RATE_LIMITED');
      assert.equal(error.retryable, true);
      assert.equal(error.retryAfterMs, 2000);

      return true;
    },
  );

  assert.equal(calls, 1);
  assert.equal(attempts[0]?.providerRequestId, 'rate-limit-id');
  assert.equal(attempts[0]?.costUsd, null);
  assert.doesNotMatch(JSON.stringify(attempts), /fixture-token|private-response/);
});

await test('HTTP/auth/network dan respons invalid memiliki failure eksplisit tersanitasi', async () => {
  for (const [status, code, retryable] of [
    [401, 'PROVIDER_AUTH', false],
    [403, 'PROVIDER_AUTH', false],
    [400, 'PROVIDER_INPUT', false],
    [503, 'PROVIDER_UNAVAILABLE', true],
  ] as const) {
    const { adapter, attempts } = harness(() =>
      Promise.resolve(new Response('private secret', { status })),
    );

    await assert.rejects(
      adapter.embedding.embed(['query'], 'query', context()),
      (error: unknown) => {
        assert.ok(error instanceof InferenceError);
        assert.equal(error.code, code);
        assert.equal(error.retryable, retryable);
        assert.doesNotMatch(error.message, /private|secret/);

        return true;
      },
    );

    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.httpStatus, status);
  }

  for (const response of [
    new Response('invalid json'),
    Response.json([dense(0)]),
    Response.json([[{ label: 'LABEL_0', score: 1 }]]),
  ]) {
    const { adapter, attempts } = harness(() => Promise.resolve(response));

    await assert.rejects(
      adapter.embedding.embed(['query'], 'query', context()),
      errorCode('INVALID_RESPONSE'),
    );

    assert.equal(attempts[0]?.errorCode, 'INVALID_RESPONSE');
  }

  const { adapter, attempts } = harness(() =>
    Promise.reject(new Error('fixture-token private network error')),
  );

  await assert.rejects(
    adapter.embedding.embed(['query'], 'query', context()),
    errorCode('PROVIDER_UNAVAILABLE'),
  );

  assert.equal(attempts[0]?.remoteOutcome, 'unknown');
  assert.equal(attempts[0]?.costUsd, null);
  assert.doesNotMatch(JSON.stringify(attempts), /fixture-token|private network/);
});

await test('deadline timeout membatalkan transport; ignored abort tetap menahan concurrency slot', async () => {
  let resolveFetch: (response: Response) => void = () => undefined;
  let signal: AbortSignal | undefined;
  let calls = 0;
  const { adapter, attempts } = harness(
    (_url, init) => {
      calls++;
      signal = init?.signal ?? undefined;

      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    },
    { timeoutMs: 10 },
  );

  await assert.rejects(
    adapter.embedding.embed(['query'], 'query', context()),
    errorCode('DEADLINE_EXCEEDED'),
  );
  await assert.rejects(
    adapter.reranker.rerank('query', [evidence('a')], context()),
    errorCode('CAPACITY_LIMIT'),
  );

  assert.ok(signal?.aborted);
  assert.equal(calls, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.remoteOutcome, 'unknown');
  assert.equal(attempts[0]?.costUsd, null);

  resolveFetch(Response.json([dense()]));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(attempts.length, 1);
  adapter.close();
});

await test('caller abort saat streaming body menutup stream dan mencatat outcome unknown', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(new TextEncoder().encode('['));
    },
    cancel() {
      cancelled = true;
    },
  });
  const { adapter, attempts } = harness(() =>
    Promise.resolve(new Response(stream, { headers: { 'x-request-id': 'stream-id' } })),
  );
  const pending = adapter.embedding.embed(['query'], 'query', context(controller.signal));

  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, errorCode('CANCELLED'));

  assert.equal(cancelled, true);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.providerRequestId, 'stream-id');
  assert.equal(attempts[0]?.remoteOutcome, 'unknown');
});

await test('input, expired deadline dan pre-abort tidak mengirim attempt', async () => {
  let calls = 0;
  const { adapter, attempts } = harness(
    () => {
      calls++;

      return Promise.resolve(Response.json([dense()]));
    },
    { maxItems: 2, maxTextChars: 10 },
  );
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(adapter.embedding.embed([], 'query', context()), errorCode('INVALID_INPUT'));
  await assert.rejects(
    adapter.embedding.embed(['a', 'b', 'c'], 'query', context()),
    errorCode('INVALID_INPUT'),
  );
  await assert.rejects(
    adapter.embedding.embed(['           '], 'query', context()),
    errorCode('INVALID_INPUT'),
  );
  await assert.rejects(
    adapter.embedding.embed(['a'.repeat(11)], 'query', context()),
    errorCode('INVALID_INPUT'),
  );
  await assert.rejects(
    adapter.reranker.rerank('q', [evidence('a'), evidence('a')], context()),
    errorCode('INVALID_INPUT'),
  );
  await assert.rejects(
    adapter.embedding.embed(['a'], 'query', { ...context(), deadlineAt: 'invalid' }),
    errorCode('DEADLINE_EXCEEDED'),
  );
  await assert.rejects(
    adapter.embedding.embed(['a'], 'query', {
      ...context(),
      deadlineAt: new Date(0).toISOString(),
    }),
    errorCode('DEADLINE_EXCEEDED'),
  );
  await assert.rejects(
    adapter.embedding.embed(['a'], 'query', context(controller.signal)),
    errorCode('CANCELLED'),
  );

  assert.equal(calls, 0);
  assert.equal(attempts.length, 0);
});

await test('body limit dan observer failure tidak menjadi sukses atau retry diam-diam', async () => {
  const { adapter, attempts } = harness(() => Promise.resolve(Response.json([dense()])), {
    maxResponseBytes: 4,
  });

  await assert.rejects(
    adapter.embedding.embed(['q'], 'query', context()),
    errorCode('INVALID_RESPONSE'),
  );

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.costUsd, null);

  const dependencies: HfDependencies = {
    fetch: () => Promise.resolve(Response.json([dense()])),
    onAttempt: () => Promise.reject(new Error('private sink error')),
  };
  const failedObserver = createHfInference(config(), dependencies);

  await assert.rejects(
    failedObserver.embedding.embed(['q'], 'query', context()),
    errorCode('ATTEMPT_OBSERVER_FAILED'),
  );

  assert.equal(failedObserver.capabilities().lastAttempt?.errorCode, null);
  assert.equal(failedObserver.capabilities().lastAttempt?.costUsd, null);
});

await test('close membatalkan in-flight dan menolak batch/call selanjutnya', async () => {
  let sent: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    sent = resolve;
  });
  const { adapter, attempts } = harness(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        sent();
      }),
  );
  const pending = adapter.embedding.embed(['a', 'b'], 'query', context());

  await started;
  adapter.close();
  await assert.rejects(pending, errorCode('CANCELLED'));
  await assert.rejects(adapter.embedding.embed(['a'], 'query', context()), errorCode('CANCELLED'));

  assert.equal(attempts.length, 1);
});
