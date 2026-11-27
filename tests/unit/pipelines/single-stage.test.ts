import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  admit,
  clock,
  outputFor,
  providerResponse,
  signal,
} from '@tests/__fixtures__/generation-fixture';
import { checksum, dense, hit } from '@tests/__fixtures__/retrieval-fixture';
import { setupSingleStage, skill, trace } from '@tests/__fixtures__/single-stage-fixture';
import { parseTraceEvent } from '@/modules/observability/application/events';
import { JsonlTraceSink } from '@/modules/observability/interface/secondary/files/jsonl-sink';
import { readEvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import { retrievalPlan } from '@/modules/rag/application/pipelines/retrieval-plan';
import { createSingleStageRunner } from '@/modules/rag/application/pipelines/single-stage';
import { createContractValidators } from '@/modules/rag/application/validation';

await test('SINGLE_STAGE four operations/EN-ID use one round, shared generator and selected sources', async (t) => {
  for (const operation of ['generate', 'evaluate', 'normalize', 'recommend'] as const) {
    for (let fixtureIndex = 0; fixtureIndex < 4; fixtureIndex++) {
      const state = await setupSingleStage(t, { operation, fixtureIndex });
      const request = state.request;
      const id = await admit(state.observations, operation, request);

      const response = await state.run(operation, request, id, signal);

      assert.ok(createContractValidators().responses[operation](response));
      assert.deepEqual(response.data, outputFor(operation, fixtureIndex));
      assert.equal(response.mode, 'SINGLE_STAGE');
      assert.equal(response.meta.path, 'SINGLE_STAGE');
      assert.deepEqual(response.meta.sources, [{ source_id: 'source-1', chunk_id: 'chunk-1' }]);
      assert.deepEqual(response.meta.counters, {
        retrieval_stage_count: 1,
        rewrite_call_count: 0,
        rerank_call_count: 0,
        provider_retry_count: 0,
        schema_retry_count: 0,
        model_call_count: 2,
      });
      assert.equal(state.requests.embedding.length, 1);
      assert.equal(state.requests.search.length, 1);
      assert.equal(state.requests.generation.length, 1);
      assert.equal(response.meta.usage.total_tokens, 140);
      assert.equal(response.meta.cost.query_embedding_usd, null);
      assert.equal(response.meta.cost.rerank_usd, 0);
      assert.equal(response.meta.cost.total_online_usd, null);
      assert.equal(response.meta.cost.known_subtotal_usd, response.meta.cost.inference_total_usd);
      assert.equal(response.meta.cost.status, 'PARTIAL');

      const events = await trace(state.directory, id);
      const retrievals = events.filter((event) => event.data.kind === 'retrieval_completed');
      const gates = events.filter((event) => event.data.kind === 'evidence_assessed');

      assert.equal(retrievals.length, 1);
      assert.ok(retrievals[0]?.data.kind === 'retrieval_completed');
      assert.equal(retrievals[0].data.stage, 1);
      assert.equal(gates.length, 1);
      assert.ok(gates[0]?.data.kind === 'evidence_assessed');
      assert.equal(gates[0].data.decision, 'ACCEPT');
      assert.equal(events.at(-1)?.data.kind, 'terminal');
      assert.equal((await state.observations.inspect())[0]?.traceIntegrity, 'VALID');

      const text = JSON.stringify(events);
      for (const secret of [
        'fixture-hf-secret',
        'secret-fixture-token',
        'Kesalahan sintetis',
        'userId',
      ]) {
        assert.equal(text.includes(secret), false);
      }
    }
  }
});

await test('empty/low evidence closes INSUFFICIENT_EVIDENCE without generator or fallback', async (t) => {
  for (const options of [
    { points: [] },
    { policy: readEvidencePolicy({ RAG_MIN_UNIQUE_CHUNKS: '2' }) },
    { policy: readEvidencePolicy({ RAG_MIN_COVERED_SKILLS: '2' }) },
    { context: { evidenceCapTokens: 1 } },
  ]) {
    const state = await setupSingleStage(t, options);
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(state.run('generate', state.request, id, signal), {
      code: 'INSUFFICIENT_EVIDENCE',
    });

    assert.equal(state.requests.embedding.length, 1);
    assert.equal(state.requests.search.length, 1);
    assert.equal(state.requests.generation.length, 0);

    const events = await trace(state.directory, id);
    const gate = events.find((event) => event.data.kind === 'evidence_assessed');

    assert.ok(gate?.data.kind === 'evidence_assessed');
    assert.equal(gate.data.decision, 'REJECT');
    assert.ok(gate.data.reasons.length);

    const terminal = events.at(-1);

    assert.ok(terminal?.data.kind === 'terminal');
    assert.equal(terminal.data.code, 'INSUFFICIENT_EVIDENCE');
    assert.equal(terminal.data.traceComplete, true);
    assert.equal((await state.observations.exportAccounting()).input.calls.length, 1);
  }
});

await test('fixed input overflow is INVALID_INPUT, not empty success or ungrounded generation', async (t) => {
  const state = await setupSingleStage(t, {
    context: { contextWindowTokens: 6000, evidenceCapTokens: 100 },
  });
  const id = await admit(state.observations, 'generate', state.request);

  await assert.rejects(state.run('generate', state.request, id, signal), { code: 'INVALID_INPUT' });

  assert.equal(state.requests.generation.length, 0);

  const events = await trace(state.directory, id);
  const gate = events.find((event) => event.data.kind === 'evidence_assessed');

  assert.ok(gate?.data.kind === 'evidence_assessed');
  assert.ok(gate.data.reasons.includes('FIXED_INPUT_BUDGET'));
});

await test('evidence gate counts selected unique chunks after dedup and preserves uncovered skills', async (t) => {
  const text = '名詞＋です。学生です。';
  const state = await setupSingleStage(t, {
    points: (index) =>
      [1, 2].map((id) =>
        hit(index, id, 1 / id, {
          skill_codes: [skill],
          text,
          content_checksum: checksum(text),
        }),
      ),
    policy: readEvidencePolicy({ RAG_MIN_UNIQUE_CHUNKS: '2' }),
  });
  state.request.payload.context.catalog.push({
    skillCode: 'uncovered',
    title: 'Missing evidence',
    lessonSlug: 'synthetic-lesson',
    unitSlug: 'synthetic-unit',
    trackSlug: 'synthetic-track',
  });
  const id = await admit(state.observations, 'generate', state.request);

  await assert.rejects(state.run('generate', state.request, id, signal), {
    code: 'INSUFFICIENT_EVIDENCE',
  });

  const events = await trace(state.directory, id);
  const context = events.find((event) => event.data.kind === 'context_built');
  const gate = events.find((event) => event.data.kind === 'evidence_assessed');

  assert.ok(context?.data.kind === 'context_built');
  assert.ok(gate?.data.kind === 'evidence_assessed');
  assert.equal(gate.data.retrievedCount, 2);
  assert.equal(gate.data.selectedCount, 1);
  assert.deepEqual(context.data.coverage.uncoveredSkillCodes, ['uncovered']);
  assert.equal(context.data.dropped[0]?.reason, 'DUPLICATE_CONTENT');
  assert.equal(state.requests.generation.length, 0);
});

await test('unrecorded generator attempts cannot become trace-complete success', async (t) => {
  const state = await setupSingleStage(t);
  const id = await admit(state.observations, 'generate', state.request);
  const run = createSingleStageRunner(
    state.index,
    state.stage,
    state.build,
    () => Promise.resolve({ data: outputFor('generate'), usage: null }),
    state.observations,
    undefined,
    clock,
  );

  await assert.rejects(run('generate', state.request, id, signal), {
    code: 'POST_VALIDATION_FAILED',
  });

  assert.equal(state.requests.generation.length, 0);

  const events = await trace(state.directory, id);
  const terminal = events.at(-1);

  assert.ok(terminal?.data.kind === 'terminal');
  assert.equal(terminal.data.outcome, 'FAILED');
});

await test('request validation, mode, scope size and pinned corpus fail before provider calls', async (t) => {
  for (const mutation of [
    'mode',
    'corpus',
    'level',
    'extra',
    'domain',
    'expired',
    'scope',
    'query',
  ]) {
    const state = await setupSingleStage(t);
    const request = structuredClone(state.request);
    let expected = 'INVALID_INPUT';

    if (mutation === 'mode') {
      request.mode = 'ADAPTIVE';
    }

    if (mutation === 'corpus') {
      request.corpus_version = 'foreign';
      expected = 'SNAPSHOT_MISMATCH';
    }

    if (mutation === 'level') {
      request.payload.context.targetLevel = 'JLPT_N3';
      expected = 'UNSUPPORTED_LEVEL';
    }

    if (mutation === 'domain') {
      request.payload.context.weakSkillCodes = ['foreign'];
    }

    if (mutation === 'expired') {
      request.deadline_at = clock.now().toISOString();
      expected = 'TIMEOUT';
    }

    if (mutation === 'scope') {
      request.payload.context.catalog.push(
        ...Array.from({ length: 64 }, (_, i) => ({
          ...request.payload.context.catalog[0],
          skillCode: `skill-${i}`,
          title: 'Title',
          lessonSlug: 'synthetic-lesson',
          unitSlug: 'synthetic-unit',
          trackSlug: 'synthetic-track',
        })),
      );
    }

    if (mutation === 'query') {
      request.payload.context.catalog.push(
        ...Array.from({ length: 5 }, (_, i) => ({
          skillCode: `skill-${i}`,
          title: 'x'.repeat(2000),
          lessonSlug: 'synthetic-lesson',
          unitSlug: 'synthetic-unit',
          trackSlug: 'synthetic-track',
        })),
      );
    }

    const input = mutation === 'extra' ? { ...request, expected_route: 'FAST' } : request;
    const admission = await state.observations.admit({
      serviceId: 'fixture',
      requestId: request.request_id,
      operation: 'generate',
      mode: request.mode,
      request: input,
    });
    const id = admission.correlation.executionId;

    assert.ok(id);

    await assert.rejects(state.run('generate', input, id, signal), { code: expected });

    assert.deepEqual(state.requests, { embedding: [], search: [], generation: [] });

    const events = await trace(state.directory, id);
    const terminal = events.at(-1);

    assert.ok(terminal?.data.kind === 'terminal');
    assert.equal(terminal.data.code, expected);
  }
});

await test('planner parity uses domain fields only and grade scope stays on question skill', async (t) => {
  const state = await setupSingleStage(t, { operation: 'evaluate' });
  const request = state.request;
  request.payload.context.catalog.push({
    skillCode: 'another',
    title: 'Other',
    lessonSlug: 'synthetic-lesson',
    unitSlug: 'synthetic-unit',
    trackSlug: 'synthetic-track',
  });
  const single = retrievalPlan('evaluate', request);
  request.mode = 'ADAPTIVE';

  const adaptive = retrievalPlan('evaluate', request);

  assert.deepEqual(single, adaptive);
  assert.deepEqual(single.targetSkillCodes, [skill]);
  assert.deepEqual(single.filter, {
    published: true,
    corpusVersion: request.corpus_version,
    targetLevel: 'JLPT_N5',
    skillCodes: [skill],
  });
  assert.equal(single.query.includes('userId'), false);
  assert.equal(single.query.includes('recentMistakes'), false);
  assert.equal(single.query.includes('expected_route'), false);
});

await test('embedding failure and Qdrant outage retain failed attempt costs and never retry', async (t) => {
  for (const failEmbedding of [true, false]) {
    const state = await setupSingleStage(
      t,
      failEmbedding
        ? { hfFetch: () => Promise.resolve(new Response('{}', { status: 429 })) }
        : { qdrantFetch: () => Promise.resolve(new Response('{}', { status: 503 })) },
    );
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(state.run('generate', state.request, id, signal), {
      code: failEmbedding ? 'INFERENCE_FAILED' : 'RETRIEVAL_FAILED',
    });

    assert.equal(state.requests.embedding.length, 1);
    assert.equal(state.requests.generation.length, 0);

    const calls = (await state.observations.exportAccounting()).input.calls;

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.accounting.cost.kind === 'PER_CALL'
        ? calls[0].accounting.cost.totalUsd
        : 'unexpected',
      null,
    );

    const events = await trace(state.directory, id);

    assert.equal(events.filter((event) => event.data.kind === 'retrieval_completed').length, 1);
    assert.equal(events.at(-1)?.data.kind, 'terminal');
  }
});

await test('schema/domain invalid generator output terminates without schema retry', async (t) => {
  for (const invalid of [{ extra: true }, { ...outputFor('generate'), questions: [] }]) {
    const state = await setupSingleStage(t, {
      generatorFetch: () => Promise.resolve(providerResponse(invalid)),
    });
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(state.run('generate', state.request, id, signal), {
      code: 'SCHEMA_PARSE_FAILED',
    });

    assert.equal(state.requests.generation.length, 1);
    assert.equal((await state.observations.exportAccounting()).input.calls.length, 2);
  }

  const state = await setupSingleStage(t, {
    operation: 'recommend',
    generatorFetch: () =>
      Promise.resolve(
        providerResponse({
          ...outputFor('recommend'),
          nextLessonSlug: 'foreign',
        }),
      ),
  });
  const id = await admit(state.observations, 'recommend', state.request);

  await assert.rejects(state.run('recommend', state.request, id, signal), {
    code: 'POST_VALIDATION_FAILED',
  });

  assert.equal(state.requests.generation.length, 1);
});

await test('missing LLM usage keeps all aggregate usage and online total unknown', async (t) => {
  const state = await setupSingleStage(t, {
    generatorFetch: () => Promise.resolve(providerResponse(outputFor('generate'), { usage: null })),
  });
  const id = await admit(state.observations, 'generate', state.request);

  const result = await state.run('generate', state.request, id, signal);

  assert.deepEqual(result.meta.usage, {
    input_tokens: null,
    cached_input_tokens: null,
    output_tokens: null,
    total_tokens: null,
  });
  assert.deepEqual(result.meta.cost, {
    currency: 'USD',
    inference_total_usd: null,
    query_embedding_usd: null,
    rerank_usd: 0,
    total_online_usd: null,
    known_subtotal_usd: 0,
    status: 'UNKNOWN',
  });
});

await test('monotonic deadline stops after embedding or generation even when wall clock is unchanged', async (t) => {
  for (const phase of ['embedding', 'generation']) {
    let elapsed = 0;
    const state = await setupSingleStage(t, {
      clock: { now: () => clock.now(), monotonicMs: () => elapsed },
      ...(phase === 'embedding'
        ? {
            hfFetch: () => {
              elapsed = 31000;
              return Promise.resolve(Response.json([dense()]));
            },
          }
        : {
            generatorFetch: () => {
              elapsed = 31000;
              return Promise.resolve(providerResponse(outputFor('generate')));
            },
          }),
    });
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(state.run('generate', state.request, id, signal), { code: 'TIMEOUT' });

    assert.equal(state.requests.generation.length, phase === 'embedding' ? 0 : 1);

    const events = await trace(state.directory, id);
    const terminal = events.at(-1);

    assert.ok(terminal?.data.kind === 'terminal');
    assert.equal(terminal.data.outcome, 'TIMEOUT');
  }
});

await test('unreadable attempt ledger becomes UNKNOWN instead of trace-complete failure', async (t) => {
  const state = await setupSingleStage(t, {
    observationOptions: {
      sinkFactory: (path) => {
        const sink = new JsonlTraceSink(path);
        return {
          write: async (event) => {
            await sink.write(event);
            if (event.data.kind === 'span_completed' && event.data.stage === 'generation') {
              await appendFile(path, '{corrupt ledger}\n');
            }
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

  const terminal = parseTraceEvent(
    JSON.parse(await readFile(join(state.directory, 'terminals', `${id}.json`), 'utf8')),
  );

  assert.ok(terminal.data.kind === 'terminal');
  assert.equal(terminal.data.outcome, 'UNKNOWN');
  assert.equal(state.requests.generation.length, 1);
});

await test('cancelled input stops before embedding; generation timeout aborts and preserves attempts', async (t) => {
  const cancelled = await setupSingleStage(t);
  const cancelledId = await admit(cancelled.observations, 'generate', cancelled.request);

  await assert.rejects(
    cancelled.run('generate', cancelled.request, cancelledId, AbortSignal.abort()),
    { code: 'TIMEOUT' },
  );

  assert.equal(cancelled.requests.embedding.length, 0);

  let transportSignal: AbortSignal | null = null;
  const state = await setupSingleStage(t, {
    generatorFetch: (_url, init) => {
      transportSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        });
      });
    },
  });
  state.request.timeout_ms = 1000;
  const id = await admit(state.observations, 'generate', state.request);

  await assert.rejects(state.run('generate', state.request, id, signal), { code: 'TIMEOUT' });

  assert.ok((transportSignal as AbortSignal | null)?.aborted);
  assert.equal(state.requests.generation.length, 1);
  assert.equal((await state.observations.exportAccounting()).input.calls.length, 2);

  const events = await trace(state.directory, id);
  const terminal = events.at(-1);

  assert.ok(terminal?.data.kind === 'terminal');
  assert.equal(terminal.data.outcome, 'TIMEOUT');
});

await test(
  'fingerprint mismatch, concurrent execution and terminal replay never cause extra calls',
  { timeout: 10000 },
  async (t) => {
    let release: ((response: Response) => void) | undefined;
    const state = await setupSingleStage(t, {
      generatorFetch: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(
      state.run('generate', { ...state.request, corpus_version: 'changed' }, id, signal),
      { code: 'IDEMPOTENCY_CONFLICT' },
    );

    const pending = state.run('generate', state.request, id, signal);
    const duplicate = state.run('generate', state.request, id, signal);

    await assert.rejects(duplicate, { code: 'IDEMPOTENCY_CONFLICT' });

    while (!release) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    release(providerResponse(outputFor('generate')));

    await pending;
    await assert.rejects(state.run('generate', state.request, id, signal), {
      code: 'EXECUTION_NOT_ACTIVE',
    });

    assert.equal(state.requests.embedding.length, 1);
    assert.equal(state.requests.generation.length, 1);
  },
);

await test('sink failure during context or terminal leaves UNKNOWN without mode fallback', async (t) => {
  for (const kind of ['context_built', 'terminal']) {
    const state = await setupSingleStage(t, {
      observationOptions: {
        sinkFactory: (path) => {
          const sink = new JsonlTraceSink(path);
          return {
            write: (event) =>
              event.data.kind === kind
                ? Promise.reject(new Error('fixture disk failure'))
                : sink.write(event),
            close: () => sink.close(),
          };
        },
      },
    });
    const id = await admit(state.observations, 'generate', state.request);

    await assert.rejects(state.run('generate', state.request, id, signal), {
      code: 'TRACE_WRITE_FAILED',
    });

    const terminal = parseTraceEvent(
      JSON.parse(await readFile(join(state.directory, 'terminals', `${id}.json`), 'utf8')),
    );

    assert.ok(terminal.data.kind === 'terminal');
    assert.equal(terminal.data.outcome, 'UNKNOWN');
    assert.equal(terminal.data.traceComplete, false);
    assert.equal(state.requests.generation.length, kind === 'context_built' ? 0 : 1);
  }
});

await test('evidence policy and trace enforce counts/reasons without pretending score confidence', async (t) => {
  for (const values of [{ RAG_MIN_UNIQUE_CHUNKS: '0' }, { RAG_MIN_COVERED_SKILLS: '65' }]) {
    assert.throws(() => readEvidencePolicy(values));
  }

  const state = await setupSingleStage(t);
  const id = await admit(state.observations, 'generate', state.request);
  await state.run('generate', state.request, id, signal);
  const event = (await trace(state.directory, id)).find(
    (row) => row.data.kind === 'evidence_assessed',
  );

  assert.ok(event?.data.kind === 'evidence_assessed');

  assert.throws(() => parseTraceEvent({ ...event, data: { ...event.data, decision: 'REJECT' } }));
  assert.throws(() => parseTraceEvent({ ...event, data: { ...event.data, selectedCount: 2 } }));
  assert.throws(() => parseTraceEvent({ ...event, data: { ...event.data, confidence: 0.8 } }));
  assert.throws(() => parseTraceEvent({ ...event, schemaVersion: 'obs-01-v1' }));
});
