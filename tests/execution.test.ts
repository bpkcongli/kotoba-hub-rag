import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { setupAdaptive } from '@tests/adaptive-fixture';
import { admit, clock, outputFor, providerResponse, signal } from '@tests/generation-fixture';
import { dense, hit } from '@tests/retrieval-fixture';
import { skill, trace } from '@tests/single-stage-fixture';
import { createBaselineRunner } from '@/generation/baseline';
import { parseTraceEvent } from '@/observability/events';
import { JsonlTraceSink } from '@/observability/jsonl-sink';
import { readDeepPolicy } from '@/pipelines/deep-config';
import { createExecutionControl } from '@/pipelines/execution-control';
import { parseExecutionPolicy, readExecutionPolicy } from '@/pipelines/execution-policy';
import type { Clock } from '@/shared/ports';

const enabled = (extra: Readonly<Record<string, unknown>> = {}) =>
  readExecutionPolicy({
    PIPELINE_MAX_PROVIDER_RETRIES: '2',
    PIPELINE_MAX_SCHEMA_RETRIES: '1',
    PIPELINE_MAX_TOTAL_RETRIES: '3',
    PIPELINE_BACKOFF_BASE_MS: '0',
    PIPELINE_BACKOFF_MAX_MS: '0',
    ...extra,
  });
const paths = ['LLM_ONLY', 'SINGLE_STAGE', 'FAST', 'DEEP'] as const;

async function setupMode(
  t: TestContext,
  path: (typeof paths)[number],
  options: Parameters<typeof setupAdaptive>[1] = {},
) {
  const state = await setupAdaptive(t, { ...options, fast: path !== 'DEEP' });
  const mode = path === 'FAST' || path === 'DEEP' ? 'ADAPTIVE' : path;
  state.request.mode = mode;
  const run =
    mode === 'LLM_ONLY'
      ? createBaselineRunner(
          state.generate,
          state.observations,
          options.clock ?? clock,
          options.executionPolicy,
          options.scheduling,
        )
      : mode === 'SINGLE_STAGE'
        ? state.run
        : state.adaptive;

  return { ...state, run };
}

await test('execution policy defaults keep retries opt-in and strict config rejects invalid/extra/overbudget values', () => {
  const policy = readExecutionPolicy();

  assert.equal(policy.maxProviderRetries, 0);
  assert.equal(policy.maxSchemaRetries, 0);
  assert.equal(policy.maxTotalRetries, 0);
  assert.ok(Object.isFrozen(policy));
  for (const bad of [
    { ...policy, maxProviderRetries: 4 },
    { ...policy, maxSchemaRetries: 3 },
    { ...policy, maxTotalRetries: 4 },
    { ...policy, maxModelCalls: 0 },
    { ...policy, maxModelCalls: 129 },
    { ...policy, backoffBaseMs: 3000 },
    { ...policy, traceGraceMs: 0 },
    { ...policy, mode: 'ADAPTIVE' },
    { ...policy, maxTotalRetries: NaN },
  ]) {
    assert.throws(() => parseExecutionPolicy(bad));
  }
  for (const bad of ['-1', '1e0', true, '', Infinity]) {
    assert.throws(() => readExecutionPolicy({ PIPELINE_MAX_TOTAL_RETRIES: bad }));
  }
});

await test('schema regeneration is identical across all paths and operations, with unchanged evidence/prompt/model/schema', async (t) => {
  for (const path of paths) {
    for (const operation of ['generate', 'evaluate', 'normalize', 'recommend'] as const) {
      let calls = 0;
      const bodies: unknown[] = [];
      const state = await setupMode(t, path, {
        operation,
        fixtureIndex: 1,
        executionPolicy: enabled(),
        generatorFetch: (_url, init) => {
          bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as unknown);

          return Promise.resolve(
            providerResponse(
              ++calls === 1
                ? operation === 'normalize'
                  ? { suggestedKnownSkillClaims: [{ skillCode: 'foreign', confidence: 1 }] }
                  : {}
                : outputFor(operation, 1),
              { model: operation === 'normalize' ? 'gpt-5.6-luna' : 'gpt-5.6-terra' },
            ),
          );
        },
      });
      const id = await admit(state.observations, operation, state.request);

      const result = await state.run(operation, state.request, id, signal);

      assert.equal(calls, 2);
      assert.deepEqual(bodies[0], bodies[1]);
      assert.deepEqual(result.data, outputFor(operation, 1));
      assert.equal(result.meta.path, path);
      assert.equal(result.meta.counters.schema_retry_count, 1);
      assert.equal(result.meta.counters.provider_retry_count, 0);
      assert.equal(
        result.meta.counters.retrieval_stage_count,
        path === 'LLM_ONLY' ? 0 : path === 'DEEP' ? 2 : 1,
      );
      assert.equal(state.requests.search.length, path === 'LLM_ONLY' ? 0 : path === 'DEEP' ? 2 : 1);
      assert.equal(result.meta.usage.total_tokens, 280);

      const events = await trace(state.directory, id);

      assert.equal(events.filter((event) => event.data.kind === 'retry_scheduled').length, 1);

      const retry = events.find((event) => event.data.kind === 'retry_scheduled');

      assert.ok(retry?.data.kind === 'retry_scheduled');
      assert.equal(
        retry.data.reason,
        operation === 'normalize' ? 'POST_VALIDATION_FAILED' : 'SCHEMA_PARSE_FAILED',
      );

      const policy = events.find((event) => event.data.kind === 'execution_policy');

      assert.ok(policy?.data.kind === 'execution_policy');
      assert.equal(policy.data.policy.maxTotalRetries, 3);
    }
  }
});

await test('provider then schema retry share one global budget; failed usage/cost remain unknown in every path', async (t) => {
  for (const path of paths) {
    let calls = 0;
    const state = await setupMode(t, path, {
      executionPolicy: enabled({ PIPELINE_MAX_TOTAL_RETRIES: '2' }),
      generatorFetch: () =>
        Promise.resolve(
          ++calls === 1
            ? Response.json({}, { status: 503 })
            : providerResponse(calls === 2 ? {} : outputFor('generate')),
        ),
    });
    const id = await admit(state.observations, 'generate', state.request);

    const result = await state.run('generate', state.request, id, signal);

    assert.equal(calls, 3);
    assert.equal(result.meta.path, path);
    assert.equal(result.meta.counters.provider_retry_count, 1);
    assert.equal(result.meta.counters.schema_retry_count, 1);
    assert.deepEqual(result.meta.usage, {
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      total_tokens: null,
    });
    assert.equal(result.meta.cost.total_online_usd, null);
    assert.ok(result.meta.cost.known_subtotal_usd > 0);
  }
});

await test('schema then transient failure does not multiply nested provider/schema budgets', async (t) => {
  for (const path of paths) {
    let calls = 0;
    const state = await setupMode(t, path, {
      executionPolicy: enabled({ PIPELINE_MAX_TOTAL_RETRIES: '2' }),
      generatorFetch: () =>
        Promise.resolve(
          ++calls === 2
            ? Response.json({}, { status: 429 })
            : providerResponse(calls === 1 ? {} : outputFor('generate')),
        ),
    });
    const id = await admit(state.observations, 'generate', state.request);

    const result = await state.run('generate', state.request, id, signal);

    assert.equal(calls, 3);
    assert.equal(result.meta.counters.provider_retry_count, 1);
    assert.equal(result.meta.counters.schema_retry_count, 1);

    const attempts = (await state.observations.exportAccounting()).input.calls.filter(
      (row) => row.accounting.purpose === 'generate',
    );

    assert.deepEqual(
      attempts.map((row) => row.accounting.retryKind),
      ['INITIAL', 'SCHEMA_RETRY', 'PROVIDER_RETRY'],
    );
  }
});

await test('global retry exhaustion preserves final failure and never changes requested mode', async (t) => {
  for (const path of paths) {
    let calls = 0;
    const state = await setupMode(t, path, {
      executionPolicy: enabled({ PIPELINE_MAX_TOTAL_RETRIES: '1' }),
      generatorFetch: () =>
        Promise.resolve(++calls === 1 ? Response.json({}, { status: 503 }) : providerResponse({})),
    });
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(state.run('generate', state.request, id, signal), {
      code: 'SCHEMA_PARSE_FAILED',
    });

    assert.equal(calls, 2);

    const events = await trace(state.directory, id);
    const terminal = events.at(-1);

    assert.ok(terminal?.data.kind === 'terminal');
    assert.equal(terminal.data.outcome, 'FAILED');
    assert.equal(terminal.correlation.mode, state.request.mode);
    assert.equal(events.filter((event) => event.data.kind === 'retry_scheduled').length, 1);
  }
});

await test('query embedding retry stays within one retrieval stage and same hard filters', async (t) => {
  let embeddings = 0;
  const state = await setupMode(t, 'SINGLE_STAGE', {
    executionPolicy: enabled(),
    hfFetch: () =>
      Promise.resolve(
        ++embeddings === 1 ? Response.json({}, { status: 429 }) : Response.json([dense()]),
      ),
  });
  const id = await admit(state.observations, 'generate', state.request);

  const result = await state.run('generate', state.request, id, signal);

  assert.equal(embeddings, 2);
  assert.equal(state.requests.search.length, 1);
  assert.equal(result.meta.counters.retrieval_stage_count, 1);
  assert.equal(result.meta.counters.provider_retry_count, 1);
  assert.equal(result.meta.counters.model_call_count, 3);

  const events = await trace(state.directory, id);

  assert.equal(events.filter((event) => event.data.kind === 'retrieval_completed').length, 1);
});

await test('rerank retries only failed batch; successful batch and stage1 are never repeated', async (t) => {
  const batches: string[] = [];
  const state = await setupMode(t, 'DEEP', {
    executionPolicy: enabled(),
    points: (index, round) =>
      round === 1 ? [] : [1, 2, 3].map((id) => hit(index, id, 1 / id, { skill_codes: [skill] })),
    hfFetch: (url, init) => {
      if (typeof url === 'string' && url.includes('bge-reranker')) {
        batches.push(typeof init?.body === 'string' ? init.body : '');

        return Promise.resolve(
          batches.length === 2
            ? Response.json({}, { status: 503 })
            : Response.json(
                batches.length === 1
                  ? [[{ label: 'LABEL_0', score: 2 }], [{ label: 'LABEL_0', score: 1 }]]
                  : [[{ label: 'LABEL_0', score: -1 }]],
              ),
        );
      }

      return Promise.resolve(Response.json([dense()]));
    },
  });
  const id = await admit(state.observations, 'generate', state.request);

  const result = await state.run('generate', state.request, id, signal);

  assert.equal(batches.length, 3);
  assert.notEqual(batches[0], batches[1]);
  assert.equal(batches[1], batches[2]);
  assert.equal(state.requests.search.length, 2);
  assert.equal(result.meta.counters.rerank_call_count, 3);
  assert.equal(result.meta.counters.model_call_count, 6);
  assert.equal(result.meta.counters.provider_retry_count, 1);
  assert.equal(result.meta.cost.rerank_usd, null);

  const calls = (await state.observations.exportAccounting()).input.calls.filter(
    (row) => row.accounting.purpose === 'rerank',
  );

  assert.deepEqual(
    calls.map((row) => row.accounting.retryKind),
    ['INITIAL', 'INITIAL', 'PROVIDER_RETRY'],
  );
});

await test('rewrite cannot retry even when provider/schema/global budgets remain', async (t) => {
  for (const schema of [false, true]) {
    const state = await setupMode(t, 'DEEP', {
      executionPolicy: enabled(),
      deepPolicy: readDeepPolicy({ ADAPTIVE_REWRITE_ENABLED: 'true' }),
      generatorFetch: () =>
        Promise.resolve(
          schema ? providerResponse({ query: '' }) : Response.json({}, { status: 429 }),
        ),
    });
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(state.run('generate', state.request, id, signal));

    assert.equal(state.requests.generation.length, 1);
    assert.equal(state.requests.search.length, 1);

    const events = await trace(state.directory, id);

    assert.equal(events.filter((event) => event.data.kind === 'retry_scheduled').length, 0);

    const calls = (await state.observations.exportAccounting()).input.calls;

    assert.equal(calls.filter((row) => row.accounting.purpose === 'rewrite').length, 1);
  }
});

await test('Retry-After and jitter use remaining deadline, and cancellation during backoff prevents new HTTP', async (t) => {
  let elapsed = 0;
  const delays: number[] = [];
  const timer: Clock = { now: () => clock.now(), monotonicMs: () => elapsed };
  let calls = 0;
  const state = await setupMode(t, 'LLM_ONLY', {
    clock: timer,
    executionPolicy: enabled({ PIPELINE_BACKOFF_BASE_MS: '100', PIPELINE_BACKOFF_MAX_MS: '200' }),
    scheduling: {
      random: () => 0.5,
      wait: (ms) => {
        delays.push(ms);
        elapsed += ms;

        return Promise.resolve();
      },
    },
    generatorFetch: () =>
      Promise.resolve(
        ++calls === 1
          ? Response.json({}, { status: 429, headers: { 'retry-after': '1' } })
          : providerResponse(outputFor('generate')),
      ),
  });
  const id = await admit(state.observations, 'generate', state.request);

  const result = await state.run('generate', state.request, id, signal);

  assert.deepEqual(delays, [1000]);
  assert.equal(result.meta.counters.provider_retry_count, 1);
  assert.equal(calls, 2);

  const aborter = new AbortController();
  let cancelledCalls = 0;
  const cancelled = await setupMode(t, 'FAST', {
    executionPolicy: enabled({ PIPELINE_BACKOFF_BASE_MS: '100', PIPELINE_BACKOFF_MAX_MS: '200' }),
    scheduling: {
      random: () => 1,
      wait: (_ms, waitingSignal) => {
        aborter.abort();
        assert.equal(waitingSignal.aborted, true);
        throw new Error('aborted');
      },
    },
    generatorFetch: () => {
      cancelledCalls++;

      return Promise.resolve(Response.json({}, { status: 503 }));
    },
  });
  const cancelledId = await admit(cancelled.observations, 'generate', cancelled.request);

  await assert.rejects(cancelled.run('generate', cancelled.request, cancelledId, aborter.signal), {
    code: 'TIMEOUT',
  });

  assert.equal(cancelledCalls, 1);

  const events = await trace(cancelled.directory, cancelledId);

  assert.equal(events.filter((event) => event.data.kind === 'retry_scheduled').length, 1);
});

await test('Retry-After exceeding deadline is not truncated into another paid call', async (t) => {
  let calls = 0;
  const state = await setupMode(t, 'LLM_ONLY', {
    executionPolicy: enabled(),
    generatorFetch: () => {
      calls++;

      return Promise.resolve(Response.json({}, { status: 429, headers: { 'retry-after': '120' } }));
    },
  });
  const id = await admit(state.observations, 'generate', state.request);

  await assert.rejects(state.run('generate', state.request, id, signal), {
    code: 'PROVIDER_FAILED',
  });

  assert.equal(calls, 1);
  assert.equal(
    (await trace(state.directory, id)).filter((event) => event.data.kind === 'retry_scheduled')
      .length,
    0,
  );
});

await test('model call cap allows first call and refuses additional work across generation and deep path', async (t) => {
  const baseline = await setupMode(t, 'LLM_ONLY', {
    executionPolicy: enabled({ PIPELINE_MAX_MODEL_CALLS: '1' }),
    generatorFetch: () => Promise.resolve(providerResponse({})),
  });
  const baselineId = await admit(baseline.observations, 'generate', baseline.request);

  await assert.rejects(baseline.run('generate', baseline.request, baselineId, signal), {
    code: 'SCHEMA_PARSE_FAILED',
  });

  assert.equal(baseline.requests.generation.length, 1);

  const deep = await setupMode(t, 'DEEP', {
    executionPolicy: enabled({ PIPELINE_MAX_MODEL_CALLS: '2' }),
  });
  const id = await admit(deep.observations, 'generate', deep.request);

  await assert.rejects(deep.run('generate', deep.request, id, signal), { code: 'CAPACITY_LIMIT' });

  assert.equal(deep.requests.embedding.length, 2);
  assert.equal(deep.requests.generation.length, 0);
  assert.equal((await deep.observations.exportAccounting()).input.calls.length, 2);
});

await test('auth/refusal/unknown network and invalid provider output do not trigger transient retry', async (t) => {
  for (const variant of ['auth', 'refusal', 'network', 'incomplete']) {
    let calls = 0;
    const state = await setupMode(t, 'LLM_ONLY', {
      executionPolicy: enabled(),
      generatorFetch: () => {
        calls++;

        if (variant === 'network') {
          throw new Error('unknown transport outcome');
        }

        if (variant === 'auth') {
          return Promise.resolve(Response.json({}, { status: 401 }));
        }

        if (variant === 'incomplete') {
          return Promise.resolve(providerResponse({}, { status: 'incomplete' }));
        }

        return Promise.resolve(
          providerResponse(
            {},
            { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] },
          ),
        );
      },
    });
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(state.run('generate', state.request, id, signal));

    assert.equal(calls, 1);
    assert.equal(
      (await trace(state.directory, id)).filter((event) => event.data.kind === 'retry_scheduled')
        .length,
      0,
    );
  }
});

await test('deadline after domain generation prevents success and preserves paid attempt accounting', async (t) => {
  let elapsed = 0;
  const timer = { now: () => clock.now(), monotonicMs: () => elapsed };
  const state = await setupMode(t, 'LLM_ONLY', { clock: timer, executionPolicy: enabled() });
  const run = createBaselineRunner(
    async (...args) => {
      const result = await state.generate(...args);
      elapsed = 31000;

      return result;
    },
    state.observations,
    timer,
    enabled(),
  );
  const id = await admit(state.observations, 'generate', state.request);

  await assert.rejects(run('generate', state.request, id, signal), { code: 'TIMEOUT' });

  assert.equal((await state.observations.exportAccounting()).input.calls.length, 1);

  const terminal = (await state.observations.inspect())[0]?.terminal;

  assert.ok(terminal?.data.kind === 'terminal');
  assert.equal(terminal.data.outcome, 'TIMEOUT');
});

await test('retry event or terminal sink failure leaves UNKNOWN and does not repeat inference', async (t) => {
  for (const kind of ['retry_scheduled', 'terminal']) {
    let calls = 0;
    const state = await setupMode(t, 'LLM_ONLY', {
      executionPolicy: enabled(),
      generatorFetch: () =>
        Promise.resolve(
          ++calls === 1 ? providerResponse({}) : providerResponse(outputFor('generate')),
        ),
      observationOptions: {
        sinkFactory: (path) => {
          const sink = new JsonlTraceSink(path);

          return {
            write: async (event) => {
              if (event.data.kind === kind) {
                throw new Error('fixture sink failure');
              }
              await sink.write(event);
            },
            close: () => sink.close(),
          };
        },
      },
    });
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(state.run('generate', state.request, id, signal), {
      code: 'TRACE_WRITE_FAILED',
    });

    assert.equal(calls, kind === 'retry_scheduled' ? 1 : 2);
    assert.equal((await state.observations.inspect())[0]?.state, 'UNKNOWN');
    assert.equal((await state.observations.exportAccounting()).input.calls.length, calls);
  }
});

await test('strict execution events reject forged config/hash, retry kind/reason and legacy versions', async (t) => {
  let calls = 0;
  const state = await setupMode(t, 'FAST', {
    executionPolicy: enabled(),
    generatorFetch: () =>
      Promise.resolve(providerResponse(++calls === 1 ? {} : outputFor('generate'))),
  });
  const id = await admit(state.observations, 'generate', state.request);
  await state.run('generate', state.request, id, signal);
  const events = await trace(state.directory, id);
  const policy = events.find((event) => event.data.kind === 'execution_policy');
  const retry = events.find((event) => event.data.kind === 'retry_scheduled');

  assert.ok(policy?.data.kind === 'execution_policy');
  assert.ok(retry?.data.kind === 'retry_scheduled');

  const policyData = policy.data;

  assert.throws(() =>
    parseTraceEvent({ ...policy, data: { ...policyData, configurationHash: 'f'.repeat(64) } }),
  );
  assert.throws(() =>
    parseTraceEvent({
      ...policy,
      data: { ...policyData, policy: { ...policyData.policy, maxTotalRetries: 4 } },
    }),
  );
  assert.throws(() => parseTraceEvent({ ...retry, data: { ...retry.data, purpose: 'rewrite' } }));
  assert.throws(() =>
    parseTraceEvent({ ...retry, data: { ...retry.data, retryKind: 'PROVIDER_RETRY' } }),
  );
  assert.throws(() => parseTraceEvent({ ...retry, schemaVersion: 'obs-01-v1' }));
});

await test('mode integrity control refuses baseline semantic calls and cross-execution context before HTTP', async (t) => {
  const state = await setupMode(t, 'LLM_ONLY');
  const id = await admit(state.observations, 'generate', state.request);
  const start = clock.monotonicMs();
  const control = createExecutionControl(
    enabled(),
    'LLM_ONLY',
    'generate',
    id,
    clock,
    state.observations,
    start,
    clock.now().getTime(),
    signal,
  );
  const context = control.start(30000, state.request.deadline_at);

  await assert.rejects(state.hf.embedding.embed(['query'], 'query', context), {
    code: 'INVALID_INPUT',
  });
  await assert.rejects(
    state.generator.generate(
      {
        operation: 'generate',
        model: 'gpt-5.6-terra',
        instructions: 'x',
        input: 'x',
        schemaName: 'x',
        jsonSchema: {},
      },
      { ...context, executionId: 'foreign' },
    ),
    { code: 'INVALID_INPUT' },
  );

  assert.equal(state.requests.embedding.length, 0);
  assert.equal(state.requests.generation.length, 0);

  control.close();
});
