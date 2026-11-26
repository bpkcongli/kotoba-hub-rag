import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setupAdaptive } from '@tests/adaptive-fixture';
import { candidate, skill, secondSkill } from '@tests/context-fixture';
import { admit, clock, outputFor, providerResponse, signal } from '@tests/generation-fixture';
import { dense, hit, scope } from '@tests/retrieval-fixture';
import { trace } from '@tests/single-stage-fixture';
import { createContractValidators } from '@/contracts/validator';
import { parseTraceEvent } from '@/observability/events';
import { JsonlTraceSink } from '@/observability/jsonl-sink';
import { mapRerankedCandidates, mergeDeepCandidates } from '@/pipelines/deep-candidates';
import { parseDeepPolicy, readDeepPolicy } from '@/pipelines/deep-config';
import { readEvidencePolicy } from '@/pipelines/evidence';
import { createQueryRewriter } from '@/pipelines/rewrite';

await test('ADAPTIVE FAST/DEEP four operations and EN-ID/N5-N4 fixtures use shared generator and terminal schema', async (t) => {
  for (const fast of [true, false]) {
    for (const operation of ['generate', 'evaluate', 'normalize', 'recommend'] as const) {
      for (let fixtureIndex = 0; fixtureIndex < 4; fixtureIndex++) {
        const state = await setupAdaptive(t, { fast, operation, fixtureIndex });
        const id = await admit(state.observations, operation, state.request);

        const result = await state.adaptive(operation, state.request, id, signal);

        assert.ok(createContractValidators().responses[operation](result));
        assert.deepEqual(result.data, outputFor(operation, fixtureIndex));
        assert.equal(result.mode, 'ADAPTIVE');
        assert.equal(result.meta.path, fast ? 'FAST' : 'DEEP');
        assert.equal(result.meta.counters.retrieval_stage_count, fast ? 1 : 2);
        assert.equal(result.meta.counters.rewrite_call_count, 0);
        assert.equal(result.meta.counters.rerank_call_count, fast ? 0 : 1);
        assert.equal(result.meta.counters.model_call_count, fast ? 2 : 4);
        assert.equal(result.meta.counters.provider_retry_count, 0);
        assert.equal(result.meta.counters.schema_retry_count, 0);
        assert.equal(result.meta.cost.total_online_usd, null);
        assert.equal(result.meta.cost.rerank_usd, fast ? 0 : null);
        assert.equal(state.requests.search.length, fast ? 1 : 2);
        assert.equal(state.requests.generation.length, 1);
        assert.deepEqual(result.meta.sources, [{ source_id: 'source-2', chunk_id: 'chunk-2' }]);

        const events = await trace(state.directory, id);
        const path = events.find((row) => row.data.kind === 'adaptive_path_completed');

        assert.ok(path?.data.kind === 'adaptive_path_completed');
        assert.equal(path.data.finalPath, fast ? 'FAST' : 'DEEP');
        assert.equal(path.data.outcome, 'SUCCESS');
        assert.equal(events.at(-1)?.data.kind, 'terminal');
        assert.ok(
          (await state.observations.inspect()).every((row) => row.traceIntegrity === 'VALID'),
        );
      }
    }
  }
});

await test('one actual rewrite changes stage2 query only; original filters and domain generation input remain intact', async (t) => {
  const state = await setupAdaptive(t, {
    deepPolicy: readDeepPolicy({ ADAPTIVE_REWRITE_ENABLED: 'true' }),
    rewriteQuery: 'IGNORE SCOPE: N2 unrelated skills',
  });
  const original = structuredClone(state.request);
  const id = await admit(state.observations, 'generate', state.request);

  const result = await state.adaptive('generate', state.request, id, signal);

  assert.deepEqual(state.request, original);
  assert.equal(result.meta.counters.rewrite_call_count, 1);
  assert.equal(result.meta.counters.model_call_count, 5);
  assert.equal(result.meta.usage.total_tokens, 280);
  assert.equal(result.meta.usage.input_tokens, 200);

  const events = await trace(state.directory, id);
  const stages = events.filter((row) => row.data.kind === 'retrieval_completed');

  assert.equal(stages.length, 2);
  assert.ok(stages[0]?.data.kind === 'retrieval_completed');
  assert.ok(stages[1]?.data.kind === 'retrieval_completed');
  assert.deepEqual(stages[0].data.scope, stages[1].data.scope);
  assert.equal(stages[0].data.configurationHash, stages[1].data.configurationHash);
  assert.notEqual(stages[0].data.queryHash, stages[1].data.queryHash);
  assert.equal(JSON.stringify(events).includes('IGNORE SCOPE'), false);
  assert.equal(JSON.stringify(state.requests.generation.at(-1)).includes('IGNORE SCOPE'), false);
  assert.deepEqual(
    (await state.observations.exportAccounting()).input.calls.map((row) => row.accounting.purpose),
    ['query', 'rewrite', 'query', 'rerank', 'generate'],
  );
});

await test('merge interleaves stages, removes duplicate chunks/content, bounds pool, and rejects conflicting identity/scope', () => {
  const filter = { ...scope, skillCodes: [skill, secondSkill] };
  const first = candidate(1);
  const overlap = { ...first, rank: 2, score: 0.01 };
  const sameText = candidate(3, [skill], first.text);

  const result = mergeDeepCandidates(
    [first, candidate(2)],
    [overlap, sameText, candidate(4)],
    filter,
    2,
  );

  assert.deepEqual(
    result.pool.map((row) => row.chunkId),
    ['chunk-1', 'chunk-2'],
  );
  assert.deepEqual(
    result.dropped.map((row) => row.reason),
    ['DUPLICATE_CHUNK', 'DUPLICATE_CONTENT', 'POOL_LIMIT'],
  );
  assert.throws(
    () => mergeDeepCandidates([first], [{ ...first, sourceId: 'conflict' }], filter, 10),
    { code: 'RETRIEVAL_FAILED' },
  );
  assert.throws(() => mergeDeepCandidates([first], [candidate(2, ['foreign'])], filter, 10), {
    code: 'RETRIEVAL_FAILED',
  });
  assert.throws(
    () => mergeDeepCandidates([first], [{ ...first, jlptLevel: 'JLPT_N4' }], filter, 10),
    { code: 'RETRIEVAL_FAILED' },
  );
});

await test('cross-encoder mapping is bijective, handles unordered IDs/negative logits and stable ties', () => {
  const pool = [candidate(1), candidate(2), candidate(3)];
  const scores = [
    { chunkId: 'chunk-3', score: -5, scoreType: 'hf_none_raw_logit_unverified' },
    { chunkId: 'chunk-2', score: -1, scoreType: 'hf_none_raw_logit_unverified' },
    { chunkId: 'chunk-1', score: -1, scoreType: 'hf_none_raw_logit_unverified' },
  ];

  const result = mapRerankedCandidates(pool, scores);

  assert.deepEqual(
    result.map((row) => row.chunkId),
    ['chunk-1', 'chunk-2', 'chunk-3'],
  );
  assert.deepEqual(
    result.map((row) => row.rank),
    [1, 2, 3],
  );

  for (const invalid of [
    scores.slice(1),
    [...scores, scores[0]],
    [scores[0], scores[0], scores[1]],
    scores.map((row) => ({ ...row, score: NaN })),
    scores.map((row) => ({ ...row, scoreType: 'probability' })),
  ]) {
    assert.throws(
      () =>
        mapRerankedCandidates(
          pool,
          invalid.filter((row) => row !== undefined),
        ),
      { code: 'INFERENCE_FAILED' },
    );
  }
});

await test('deep pool cap and dedup bound actual HF rerank batch attempts', async (t) => {
  const state = await setupAdaptive(t, {
    deepPolicy: readDeepPolicy({ ADAPTIVE_RERANK_POOL_LIMIT: '3' }),
    points: (index, round) =>
      round === 1
        ? []
        : [1, 2, 3, 4, 5].map((id) => hit(index, id, 1 / id, { skill_codes: [skill] })),
  });
  const id = await admit(state.observations, 'generate', state.request);

  const result = await state.adaptive('generate', state.request, id, signal);

  assert.equal(result.meta.counters.rerank_call_count, 2);
  assert.equal(result.meta.counters.model_call_count, 5);
  assert.equal(state.rerankWire.length, 2);

  const events = await trace(state.directory, id);
  const reranked = events.find((row) => row.data.kind === 'deep_reranked');

  assert.ok(reranked?.data.kind === 'deep_reranked');
  assert.equal(reranked.data.poolIds.length, 3);
  assert.equal(reranked.data.dropped.filter((row) => row.reason === 'POOL_LIMIT').length, 2);
});

await test('empty and inadequate final evidence produce terminal failure with bounded stages and no generator', async (t) => {
  for (const options of [
    { points: [] },
    { context: { evidenceCapTokens: 1 } },
    { policy: readEvidencePolicy({ RAG_MIN_UNIQUE_CHUNKS: '2' }) },
  ]) {
    const state = await setupAdaptive(t, options);
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(state.adaptive('generate', state.request, id, signal), {
      code: 'INSUFFICIENT_EVIDENCE',
    });

    assert.equal(state.requests.search.length, 2);
    assert.equal(state.requests.generation.length, 0);

    const events = await trace(state.directory, id);
    const terminal = events.at(-1);

    assert.ok(terminal?.data.kind === 'terminal');
    assert.equal(terminal.data.outcome, 'FAILED');
    assert.equal(terminal.data.code, 'INSUFFICIENT_EVIDENCE');

    const path = events.find((row) => row.data.kind === 'adaptive_path_completed');

    assert.ok(path?.data.kind === 'adaptive_path_completed');
    assert.equal(path.data.finalPath, 'DEEP');
    assert.equal(path.data.retrievalStageCount, 2);
    assert.ok(path.data.rewriteCallCount <= 1);
  }
});

await test('rewrite schema failures and 429 stop after one actual call without stage2, fallback or retry', async (t) => {
  for (const response of [
    () => providerResponse({ query: '' }),
    () => providerResponse({ query: 'new query', skillCodes: ['foreign'] }),
    () => Response.json({ error: 'limited' }, { status: 429 }),
  ]) {
    const state = await setupAdaptive(t, {
      deepPolicy: readDeepPolicy({ ADAPTIVE_REWRITE_ENABLED: 'true' }),
      generatorFetch: () => Promise.resolve(response()),
    });
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(state.adaptive('generate', state.request, id, signal));

    assert.equal(state.requests.search.length, 1);
    assert.equal(state.requests.generation.length, 1);
    assert.equal(
      (await state.observations.exportAccounting()).input.calls.filter(
        (row) => row.accounting.purpose === 'rewrite',
      ).length,
      1,
    );

    const events = await trace(state.directory, id);

    assert.ok(events.at(-1)?.data.kind === 'terminal');
    assert.equal(events.filter((row) => row.data.kind === 'routing_decided').length, 1);
  }
});

await test('invalid rerank ID/score mapping fails without domain generation', async (t) => {
  const state = await setupAdaptive(t, {
    reranker: {
      rerank: () =>
        Promise.resolve([
          { chunkId: 'foreign', score: 1, scoreType: 'hf_none_raw_logit_unverified' },
        ]),
    },
  });
  const id = await admit(state.observations, 'generate', state.request);

  await assert.rejects(state.adaptive('generate', state.request, id, signal), {
    code: 'INFERENCE_FAILED',
  });

  assert.equal(state.requests.generation.length, 0);
});

await test('deep config rejects topology/model drift, malformed thresholds and unvalidated frozen claim', () => {
  for (const env of [
    { ADAPTIVE_REWRITE_ENABLED: true },
    { ADAPTIVE_REWRITE_ENABLED: 'yes' },
    { ADAPTIVE_RERANK_POOL_LIMIT: '0' },
    { ADAPTIVE_RERANK_POOL_LIMIT: '65' },
    { ADAPTIVE_REWRITE_MODEL: 'other-model' },
  ]) {
    assert.throws(() => readDeepPolicy(env));
  }

  assert.throws(() => parseDeepPolicy({ ...readDeepPolicy(), maxStages: 3 }));
  assert.throws(() => parseDeepPolicy({ ...readDeepPolicy(), calibrationStatus: 'FROZEN' }));
});

await test('rewrite output is parsed strictly, never accepted as arbitrary object or empty query', async () => {
  for (const outputText of [
    'not json',
    '{}',
    '{"query":"   "}',
    '{"query":"x","expected_route":"FAST"}',
  ]) {
    const rewrite = createQueryRewriter({
      generate: () => Promise.resolve({ outputText, providerRequestId: null, usage: null }),
    });

    await assert.rejects(
      rewrite('original', 'gpt-5.6-terra', {
        executionId: 'fixture',
        signal,
        deadlineAt: new Date(Date.now() + 1000).toISOString(),
      }),
    );
  }
});

await test('adaptive trace cannot forge actual path/counters, pool membership or score ranks', async (t) => {
  const state = await setupAdaptive(t);
  const id = await admit(state.observations, 'generate', state.request);
  await state.adaptive('generate', state.request, id, signal);
  const events = await trace(state.directory, id);
  const rerank = events.find((row) => row.data.kind === 'deep_reranked');
  const path = events.find((row) => row.data.kind === 'adaptive_path_completed');

  assert.ok(rerank?.data.kind === 'deep_reranked');
  assert.ok(path?.data.kind === 'adaptive_path_completed');
  assert.throws(() => parseTraceEvent({ ...path, data: { ...path.data, finalPath: 'FAST' } }));
  assert.throws(() => parseTraceEvent({ ...path, data: { ...path.data, retrievalStageCount: 3 } }));
  assert.throws(() => parseTraceEvent({ ...path, data: { ...path.data, rewriteCallCount: 2 } }));
  assert.throws(() =>
    parseTraceEvent({ ...rerank, data: { ...rerank.data, poolIds: ['foreign'] } }),
  );
  assert.throws(() =>
    parseTraceEvent({ ...rerank, data: { ...rerank.data, configurationHash: 'f'.repeat(64) } }),
  );
  assert.throws(() =>
    parseTraceEvent({ ...rerank, correlation: { ...rerank.correlation, mode: 'SINGLE_STAGE' } }),
  );
});

await test('partial rerank batch failure retains both attempts and unknown billing, without generator or retry', async (t) => {
  let batches = 0;
  const state = await setupAdaptive(t, {
    points: (index, round) =>
      round === 1 ? [] : [1, 2, 3].map((id) => hit(index, id, 1 / id, { skill_codes: [skill] })),
    hfFetch: (url) => {
      if (typeof url === 'string' && url.includes('bge-reranker')) {
        batches++;

        return Promise.resolve(
          batches === 1
            ? Response.json([[{ label: 'LABEL_0', score: -1 }], [{ label: 'LABEL_0', score: -2 }]])
            : Response.json({ error: 'limited' }, { status: 429, headers: { 'retry-after': '1' } }),
        );
      }

      return Promise.resolve(Response.json([dense()]));
    },
  });
  const id = await admit(state.observations, 'generate', state.request);

  await assert.rejects(state.adaptive('generate', state.request, id, signal), {
    code: 'INFERENCE_FAILED',
  });

  assert.equal(batches, 2);
  assert.equal(state.requests.generation.length, 0);

  const events = await trace(state.directory, id);
  const attempts = events.filter(
    (row) => row.data.kind === 'model_attempt' && row.data.purpose === 'rerank',
  );

  assert.equal(attempts.length, 2);
  assert.ok(attempts[0]?.data.kind === 'model_attempt');
  assert.ok(attempts[1]?.data.kind === 'model_attempt');
  assert.equal(attempts[0].data.httpStatus, 200);
  assert.equal(attempts[1].data.httpStatus, 429);

  const calls = (await state.observations.exportAccounting()).input.calls.filter(
    (row) => row.accounting.purpose === 'rerank',
  );

  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (row) => row.accounting.cost.kind === 'PER_CALL' && row.accounting.cost.totalUsd === null,
    ),
  );

  const path = events.find((row) => row.data.kind === 'adaptive_path_completed');

  assert.ok(path?.data.kind === 'adaptive_path_completed');
  assert.equal(path.data.rerankCallCount, 2);
  assert.equal(path.data.outcome, 'FAILED');
});

await test('trace sink failures at rerank/path/terminal leave UNKNOWN without inference replay', async (t) => {
  for (const kind of ['deep_reranked', 'adaptive_path_completed', 'terminal']) {
    const state = await setupAdaptive(t, {
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

    await assert.rejects(state.adaptive('generate', state.request, id, signal), {
      code: 'TRACE_WRITE_FAILED',
    });

    assert.equal((await state.observations.inspect())[0]?.state, 'UNKNOWN');
    assert.equal(state.requests.search.length, 2);
    assert.equal(state.requests.generation.length, kind === 'deep_reranked' ? 0 : 1);
  }
});

await test('invalid requests/corpus and pre-cancellation stop before any inference with terminal records', async (t) => {
  for (const variant of ['schema', 'corpus', 'scope', 'cancelled']) {
    const state = await setupAdaptive(t);

    if (variant === 'corpus') {
      state.request.corpus_version = 'wrong';
    }

    if (variant === 'scope') {
      state.request.payload.context.weakSkillCodes = ['foreign'];
    }

    const input =
      variant === 'schema' ? { ...state.request, expected_route: 'DEEP' } : state.request;
    const admission = await state.observations.admit({
      serviceId: 'fixture',
      requestId: state.request.request_id,
      operation: 'generate',
      mode: 'ADAPTIVE',
      request: input,
    });

    assert.ok(admission.correlation.executionId);

    await assert.rejects(
      state.adaptive(
        'generate',
        input,
        admission.correlation.executionId,
        variant === 'cancelled' ? AbortSignal.abort() : signal,
      ),
    );

    assert.equal(state.requests.embedding.length, 0);
    assert.equal(state.requests.generation.length, 0);

    const events = await trace(state.directory, admission.correlation.executionId);

    assert.ok(events.at(-1)?.data.kind === 'terminal');
  }
});

await test('monotonic budget during stage2 embedding prevents rerank/generation and closes TIMEOUT', async (t) => {
  let elapsed = 0;
  let embeddings = 0;
  const state = await setupAdaptive(t, {
    clock: { now: () => clock.now(), monotonicMs: () => elapsed },
    hfFetch: () => {
      embeddings++;
      if (embeddings === 2) {
        elapsed = 31000;
      }

      return Promise.resolve(Response.json([dense()]));
    },
  });
  const id = await admit(state.observations, 'generate', state.request);

  await assert.rejects(state.adaptive('generate', state.request, id, signal), { code: 'TIMEOUT' });

  assert.equal(embeddings, 2);
  assert.equal(state.requests.generation.length, 0);

  const events = await trace(state.directory, id);
  const terminal = events.at(-1);

  assert.ok(terminal?.data.kind === 'terminal');
  assert.equal(terminal.data.outcome, 'TIMEOUT');
});

await test('execution replay and concurrent invocation cannot exceed one deep sequence', async (t) => {
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  let embeddings = 0;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const state = await setupAdaptive(t, {
    hfFetch: async () => {
      if (++embeddings === 1) {
        entered?.();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }

      return Response.json([dense()]);
    },
    points: [],
  });
  const id = await admit(state.observations, 'generate', state.request);
  const running = state.adaptive('generate', state.request, id, signal);
  await waiting;

  await assert.rejects(state.adaptive('generate', state.request, id, signal), {
    code: 'IDEMPOTENCY_CONFLICT',
  });

  const failure = assert.rejects(running);
  release?.();
  await failure;

  const count = state.requests.embedding.length;

  await assert.rejects(state.adaptive('generate', state.request, id, signal));
  assert.equal(state.requests.embedding.length, count);
  assert.equal(count, 2);
});
