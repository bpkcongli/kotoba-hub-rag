import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import {
  admit,
  clock,
  config,
  outputFor,
  providerResponse,
  requestFor,
  setup,
  signal,
} from '@tests/generation-fixture';
import { createOpenAiGenerator } from '@/adapters/openai-responses';
import type { GenerationAttempt } from '@/adapters/openai-responses';
import { createOperationGenerator } from '@/generation/generator';

await test('429/5xx/auth/rejection/refusal/incomplete/invalid JSON gagal sekali dan biaya tetap tercatat', async (t) => {
  const cases: Array<[() => Response, string, number | null]> = [
    [
      () => new Response('{}', { status: 429, headers: { 'retry-after': '3' } }),
      'PROVIDER_FAILED',
      3000,
    ],
    [() => new Response('{}', { status: 503 }), 'PROVIDER_FAILED', null],
    [() => new Response('secret', { status: 401 }), 'PROVIDER_REJECTED', null],
    [() => new Response('secret', { status: 400 }), 'PROVIDER_REJECTED', null],
    [
      () =>
        providerResponse(
          {},
          { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private' }] }] },
        ),
      'PROVIDER_REFUSED',
      null,
    ],
    [() => providerResponse({}, { status: 'incomplete' }), 'PROVIDER_FAILED', null],
    [() => providerResponse({}, { model: 'different-model' }), 'PROVIDER_REJECTED', null],
    [
      () =>
        providerResponse(
          {},
          { output: [{ type: 'message', content: [{ type: 'output_text', text: '{' }] }] },
        ),
      'SCHEMA_PARSE_FAILED',
      null,
    ],
    [() => new Response('{'), 'PROVIDER_FAILED', null],
  ];

  for (const [response, code, retryAfterMs] of cases) {
    let calls = 0;
    const state = await setup(t, () => {
      calls++;
      return Promise.resolve(response());
    });
    const request = requestFor('evaluate');
    const id = await admit(state.observations, 'evaluate', request);

    await assert.rejects(state.baseline('evaluate', request, id, signal), { code, retryAfterMs });

    assert.equal(calls, 1);
    assert.equal(state.attempts.length, 1);
    assert.equal((await state.observations.exportAccounting()).input.calls.length, 1);

    if (
      ['PROVIDER_REFUSED', 'SCHEMA_PARSE_FAILED'].includes(code) ||
      response().headers.get('content-type')?.includes('application/json')
    ) {
      assert.equal(state.attempts[0]?.usage?.totalTokens, 140);
    }

    assert.equal((await state.observations.inspect())[0]?.state, 'TERMINAL');
  }
});

await test('timeout/cancellation membatasi fetch yang mengabaikan abort dan menahan slot concurrency', async (t) => {
  let resolveTransport: (response: Response) => void = () => undefined;
  let transportSignal: AbortSignal | null = null;
  const state = await setup(
    t,
    (_url, options) => {
      transportSignal = options?.signal ?? null;
      return new Promise<Response>((resolve) => {
        resolveTransport = resolve;
      });
    },
    config({ OPENAI_TIMEOUT_MS: '15' }),
  );
  const request = requestFor('evaluate');
  const firstId = await admit(state.observations, 'evaluate', request);

  await assert.rejects(state.baseline('evaluate', request, firstId, signal), { code: 'TIMEOUT' });

  assert.equal((transportSignal as AbortSignal | null)?.aborted, true);
  assert.equal(state.attempts[0]?.remoteOutcome, 'unknown');
  assert.equal(state.attempts[0]?.usage, null);

  const second = requestFor('evaluate');
  const secondId = await admit(state.observations, 'evaluate', second);

  await assert.rejects(state.baseline('evaluate', second, secondId, signal), {
    code: 'CAPACITY_LIMIT',
  });

  assert.equal(state.attempts.length, 1);

  resolveTransport(providerResponse(outputFor('evaluate')));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(state.attempts[0]?.usage, null);
});

await test('aborted caller tidak mengirim call; stream body dan response oversized dibatasi', async (t) => {
  let calls = 0;
  const state = await setup(t, () => {
    calls++;
    return Promise.resolve(providerResponse(outputFor('evaluate')));
  });
  const request = requestFor('evaluate');
  const id = await admit(state.observations, 'evaluate', request);

  await assert.rejects(state.baseline('evaluate', request, id, AbortSignal.abort()), {
    code: 'TIMEOUT',
  });

  assert.equal(calls, 0);
  assert.equal(state.attempts.length, 0);

  for (const response of [
    new Response('x'.repeat(1000)),
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'));
        },
      }),
    ),
  ]) {
    const limited = await setup(
      t,
      () => Promise.resolve(response),
      config({ OPENAI_TIMEOUT_MS: '20', OPENAI_MAX_RESPONSE_BYTES: '100' }),
    );
    const next = requestFor('evaluate');
    const nextId = await admit(limited.observations, 'evaluate', next);

    await assert.rejects(limited.baseline('evaluate', next, nextId, signal));

    assert.equal(limited.attempts.length, 1);
    assert.equal((await limited.observations.inspect())[0]?.state, 'TERMINAL');
  }
});

await test('observer gagal tidak menjalankan retry; admission disimpan UNKNOWN', async (t) => {
  const state = await setup(t, () => Promise.resolve(providerResponse(outputFor('evaluate'))));
  const provider = createOpenAiGenerator(config(), {
    clock,
    fetch: () => Promise.resolve(providerResponse(outputFor('evaluate'))),
    onAttempt: () => Promise.reject(new Error('private-observer-error')),
  });
  t.after(() => provider.close());
  const generate = createOperationGenerator(provider, config());
  const { createBaselineRunner } = await import('@/generation/baseline');
  const runner = createBaselineRunner(generate, state.observations, clock);
  const request = requestFor('evaluate');
  const id = await admit(state.observations, 'evaluate', request);

  await assert.rejects(runner('evaluate', request, id, signal), { code: 'TRACE_WRITE_FAILED' });

  const row = (await state.observations.inspect())[0];

  assert.equal(row?.state, 'UNKNOWN');
  assert.equal(
    row?.terminal?.data.kind === 'terminal' ? row.terminal.data.traceComplete : true,
    false,
  );
});

await test('shared generator memakai prompt/schema/model identik lintas mode dan mengisolasi evidence', async () => {
  const inputs: Array<Parameters<ReturnType<typeof createOpenAiGenerator>['generate']>[0]> = [];
  const attempts: GenerationAttempt[] = [];
  const provider = createOpenAiGenerator(config(), {
    clock,
    fetch: () => Promise.resolve(providerResponse(outputFor('evaluate'))),
    onAttempt: (attempt) => {
      attempts.push(attempt);
      return Promise.resolve();
    },
  });
  const generator = createOperationGenerator(
    {
      generate: (input, context) => {
        inputs.push(input);
        return provider.generate(input, context);
      },
    },
    config(),
  );
  const request = requestFor('evaluate');

  try {
    for (const mode of ['LLM_ONLY', 'SINGLE_STAGE', 'ADAPTIVE'] as const) {
      await generator('evaluate', { ...request, mode }, [], {
        executionId: 'fixture',
        signal,
        deadlineAt: request.deadline_at,
      });
    }

    assert.equal(inputs.length, 3);
    assert.deepEqual(inputs[0], inputs[1]);
    assert.deepEqual(inputs[1], inputs[2]);
    assert.equal(new Set(attempts.map((attempt) => attempt.promptHash)).size, 1);
    assert.equal(new Set(attempts.map((attempt) => attempt.schemaHash)).size, 1);
  } finally {
    provider.close();
  }
});

await test('fetch HTTP loopback nyata mengirim Structured Outputs dan memetakan Retry-After', async (t) => {
  let calls = 0;
  const fixture = createServer((request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, 'Bearer secret-fixture-token');

    const chunks: Buffer[] = [];
    request.on('data', (chunk: unknown) => {
      assert.ok(Buffer.isBuffer(chunk));

      chunks.push(chunk);
    });

    request.on('end', () => {
      calls++;
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));

      assert.ok(typeof body === 'object' && body !== null && 'text' in body && 'store' in body);
      assert.equal(body.store, false);

      response.statusCode = 429;
      response.setHeader('retry-after', '2');
      response.end('{}');
    });
  });

  t.after(async () => {
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const address = fixture.address();

  assert.ok(address && typeof address === 'object');

  const state = await setup(t, (_url, options) =>
    globalThis.fetch(`http://127.0.0.1:${address.port}`, options),
  );
  const request = requestFor('evaluate');
  const id = await admit(state.observations, 'evaluate', request);

  await assert.rejects(state.baseline('evaluate', request, id, signal), {
    code: 'PROVIDER_FAILED',
    retryAfterMs: 2000,
  });

  assert.equal(calls, 1);
  assert.equal(state.attempts[0]?.httpStatus, 429);
  assert.equal(state.attempts[0]?.remoteOutcome, 'response_received');
});

await test('snapshot input/context menjaga identitas dan hash prompt saat caller memutasi setelah dispatch', async () => {
  const { createHash } = await import('node:crypto');
  const attempts: GenerationAttempt[] = [];
  let settle: (response: Response) => void = () => undefined;
  const provider = createOpenAiGenerator(config(), {
    clock,
    fetch: () =>
      new Promise<Response>((resolve) => {
        settle = resolve;
      }),
    onAttempt: (attempt) => {
      attempts.push(attempt);
      return Promise.resolve();
    },
  });
  const input = {
    operation: 'evaluate' as const,
    model: 'gpt-5.6-terra',
    instructions: 'original instructions',
    input: '{}',
    schemaName: 'fixture',
    jsonSchema: { type: 'object' },
  };
  const context = {
    executionId: 'original-execution',
    signal,
    deadlineAt: requestFor('evaluate').deadline_at,
  };

  try {
    const pending = provider.generate(input, context);
    input.instructions = 'changed after dispatch';
    context.executionId = 'other-execution';
    settle(providerResponse(outputFor('evaluate')));

    await pending;

    assert.equal(attempts[0]?.executionId, 'original-execution');
    assert.equal(
      attempts[0]?.promptHash,
      createHash('sha256').update('original instructions').digest('hex'),
    );
  } finally {
    provider.close();
  }
});
