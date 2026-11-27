import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  candidate,
  contextConfig,
  ragRequest,
  secondSkill,
  skill,
} from '@tests/__fixtures__/context-fixture';
import { admit, clock, signal } from '@tests/__fixtures__/generation-fixture';
import { hit } from '@tests/__fixtures__/retrieval-fixture';
import { setupSingleStage, trace } from '@tests/__fixtures__/single-stage-fixture';
import { parseTraceEvent } from '@/modules/observability/application/events';
import { JsonlTraceSink } from '@/modules/observability/interface/secondary/files/jsonl-sink';
import { buildContext } from '@/modules/rag/application/context/builder';
import { createAdaptiveInitialStage } from '@/modules/rag/application/pipelines/adaptive-initial';
import { retrievalPlan } from '@/modules/rag/application/pipelines/retrieval-plan';
import {
  extractRouterFeatures,
  parseRouterFeatures,
  parseRouterPolicy,
  readRouterPolicy,
  routeInitialEvidence,
  routerConfigurationHash,
} from '@/modules/rag/application/pipelines/router';

function features(rows = [candidate(1, [skill, secondSkill])]) {
  const request = ragRequest('generate');
  const targets = retrievalPlan('generate', request).targetSkillCodes;
  const built = buildContext(contextConfig(), 'generate', request, rows, targets);

  return { features: extractRouterFeatures(targets, rows, built), built, targets, rows };
}

await test('router inclusive threshold boundaries and stricter provisional configurations', () => {
  const input = features().features;
  const policy = readRouterPolicy();

  assert.equal(routeInitialEvidence(policy, input).initialDecision, 'FAST');
  assert.equal(
    routeInitialEvidence({ ...policy, minUniqueCandidates: 2 }, input).initialDecision,
    'DEEP',
  );
  assert.equal(
    routeInitialEvidence({ ...policy, minSelectedChunks: 2 }, input).initialDecision,
    'DEEP',
  );

  const partial = features([candidate(1)]).features;

  assert.equal(partial.skillCoverage, 0.5);
  assert.equal(
    routeInitialEvidence({ ...policy, minSkillCoverage: 0.5 }, partial).initialDecision,
    'FAST',
  );
  assert.deepEqual(
    routeInitialEvidence({ ...policy, minSkillCoverage: 0.500001 }, partial).reasons,
    ['LOW_SKILL_COVERAGE'],
  );
});

await test('empty retrieval, empty selected budget, partial coverage choose DEEP without invented scores', () => {
  const input = features([]).features;
  const result = routeInitialEvidence(readRouterPolicy(), input);

  assert.equal(result.initialDecision, 'DEEP');
  assert.deepEqual(result.reasons, [
    'EMPTY_RETRIEVAL',
    'EMPTY_CONTEXT',
    'TOO_FEW_UNIQUE_CANDIDATES',
    'TOO_FEW_SELECTED_CHUNKS',
    'LOW_SKILL_COVERAGE',
  ]);
  assert.equal(input.topScore, null);
  assert.equal(input.topGap, null);

  const { rows, targets } = features();
  const request = ragRequest('generate');
  const built = buildContext(
    contextConfig({ evidenceCapTokens: 1 }),
    'generate',
    request,
    rows,
    targets,
  );
  const dropped = extractRouterFeatures(targets, rows, built);

  assert.equal(dropped.uniqueCandidateCount, 1);
  assert.equal(dropped.selectedChunkCount, 0);
  assert.ok(routeInitialEvidence(readRouterPolicy(), dropped).reasons.includes('EMPTY_CONTEXT'));
});

await test('dedup and selected coverage, rather than repeated chunks or raw candidate metadata, drive route', () => {
  const row = candidate(1);
  const { features: input } = features([row, row, candidate(2, [secondSkill], row.text)]);

  assert.equal(input.uniqueCandidateCount, 2);
  assert.equal(input.selectedChunkCount, 1);
  assert.equal(input.coveredSkillCount, 1);
  assert.equal(input.skillCoverage, 0.5);
  assert.equal(routeInitialEvidence(readRouterPolicy(), input).initialDecision, 'DEEP');
});

await test('raw cosine/fusion scores and gap are diagnostics without universal confidence thresholds', () => {
  const policy = readRouterPolicy();
  const original = features([candidate(1, [skill, secondSkill]), candidate(2)]).features;

  for (const scoreType of ['cosine', 'rrf_k60_zero_based'] as const) {
    for (const topScore of [-0.9, 0, 0.01, 0.99]) {
      const input = { ...original, scoreType, topScore, topGap: 0 };

      assert.equal(routeInitialEvidence(policy, input).initialDecision, 'FAST');
    }
  }
});

await test('policy parser rejects invalid, nonfinite, extra and claimed calibrated configurations', () => {
  const policy = readRouterPolicy();

  for (const value of [
    { ...policy, minUniqueCandidates: 0 },
    { ...policy, minSelectedChunks: 1.5 },
    { ...policy, minSkillCoverage: 0 },
    { ...policy, minSkillCoverage: 1.01 },
    { ...policy, minSkillCoverage: NaN },
    { ...policy, expected_route: 'FAST' },
    { ...policy, calibrationStatus: 'CALIBRATED' },
  ]) {
    assert.throws(() => parseRouterPolicy(value));
  }

  for (const value of ['NaN', 'Infinity', '', ' 1', '1e0', '-1', true, 1]) {
    assert.throws(() => readRouterPolicy({ ADAPTIVE_MIN_SKILL_COVERAGE: value }));
  }

  assert.equal(
    routerConfigurationHash(policy),
    routerConfigurationHash({
      minSkillCoverage: 1,
      minSelectedChunks: 1,
      minUniqueCandidates: 1,
      calibrationStatus: 'PROVISIONAL',
      version: 'adp-01-router-v1',
    }),
  );
  assert.notEqual(
    routerConfigurationHash(policy),
    routerConfigurationHash({ ...policy, minSelectedChunks: 2 }),
  );
  assert.ok(Object.isFrozen(policy));
});

await test('feature boundary rejects evaluator labels, missing and inconsistent values rather than coercing zero', () => {
  const input = features().features;

  for (const extra of [
    { expected_route: 'DEEP' },
    { complexity: 'extreme' },
    { answer_key: 'secret' },
    { judge_score: 1 },
    { referenceAnswer: 'secret' },
    { targetSkillCount: 0 },
    { skillCoverage: 0 },
    { coveredSkillCount: 3 },
    { selectedChunkCount: 2 },
    { topScore: NaN },
    { topScore: null },
    { topGap: 0 },
    { selectedChunkCount: 0, coveredSkillCount: 1 },
  ]) {
    assert.throws(() => parseRouterFeatures({ ...input, ...extra }), { code: 'INVALID_INPUT' });
  }

  assert.throws(() => parseRouterFeatures({}), { code: 'INVALID_INPUT' });
});

await test('conflicting target/context and fixed input overflow reject without a routing decision', () => {
  const { rows, targets, built } = features();

  assert.throws(() => extractRouterFeatures([skill], rows, built), { code: 'INVALID_INPUT' });
  assert.throws(() => extractRouterFeatures([...targets, skill], rows, built), {
    code: 'INVALID_INPUT',
  });
  assert.throws(
    () => extractRouterFeatures(targets, rows, { ...built, status: 'INPUT_BUDGET_EXCEEDED' }),
    { code: 'INVALID_INPUT' },
  );
  assert.throws(
    () => extractRouterFeatures(targets, rows, { ...built, evidence: [candidate(99)] }),
    { code: 'INVALID_INPUT' },
  );
});

await test('ADAPTIVE initial retrieval/context matches SINGLE_STAGE across four operations and locale/level fixtures', async (t) => {
  for (const operation of ['generate', 'evaluate', 'normalize', 'recommend'] as const) {
    for (let fixtureIndex = 0; fixtureIndex < 4; fixtureIndex++) {
      const state = await setupSingleStage(t, { operation, fixtureIndex });
      const baselineId = await admit(state.observations, operation, state.request);
      const baseline = await state.run(operation, state.request, baselineId, signal);
      const initial = createAdaptiveInitialStage(
        state.index,
        state.stage,
        state.build,
        state.observations,
        readRouterPolicy(),
        clock,
      );
      const request = structuredClone(state.request);
      request.mode = 'ADAPTIVE';
      request.request_id = randomUUID();
      request.payload.metadata.requestId = request.request_id;
      const id = await admit(state.observations, operation, request);

      const result = await initial(operation, request, {
        executionId: id,
        signal,
        deadlineAt: request.deadline_at,
      });

      assert.equal(result.decision.initialDecision, 'FAST');
      assert.equal(result.decision.finalPath, null);
      assert.equal(result.decision.stageCount, 1);
      assert.deepEqual(result.plan, retrievalPlan(operation, state.request));
      assert.deepEqual(result.built.sources, baseline.meta.sources);
      assert.deepEqual(state.requests.embedding[0], state.requests.embedding[1]);
      assert.deepEqual(state.requests.search[0], state.requests.search[1]);
      assert.equal(state.requests.embedding.length, 2);
      assert.equal(state.requests.generation.length, 1);

      const events = await trace(state.directory, id);
      const route = events.find((event) => event.data.kind === 'routing_decided');
      const baseEvents = await trace(state.directory, baselineId);
      const baseRetrieval = baseEvents.find((event) => event.data.kind === 'retrieval_completed');
      const baseContext = baseEvents.find((event) => event.data.kind === 'context_built');

      assert.ok(route?.data.kind === 'routing_decided');
      assert.ok(baseRetrieval?.data.kind === 'retrieval_completed');
      assert.ok(baseContext?.data.kind === 'context_built');
      assert.equal(route.data.retrievalConfigurationHash, baseRetrieval.data.configurationHash);
      assert.equal(route.data.contextConfigurationHash, baseContext.data.configurationHash);
      assert.ok(events.every((event) => event.data.kind !== 'terminal'));
      assert.equal((await state.observations.executionAccounting(id)).length, 1);

      await state.observations.finish(id, 'FAILED', 'INSUFFICIENT_EVIDENCE');
    }
  }
});

await test('initial helper rejects invalid mode, label leakage and contradictory domain constraints before inference', async (t) => {
  for (const variant of ['mode', 'labels', 'domain', 'corpus', 'level', 'scope'] as const) {
    const state = await setupSingleStage(t);
    const request = structuredClone(state.request);
    request.mode = 'ADAPTIVE';
    let input: unknown = request;

    if (variant === 'mode') {
      request.mode = 'LLM_ONLY';
    }

    if (variant === 'labels') {
      input = { ...request, expected_route: 'FAST', complexity: 'easy' };
    }

    if (variant === 'domain') {
      request.payload.context.weakSkillCodes = ['nonexistent'];
    }

    if (variant === 'corpus') {
      request.corpus_version = 'wrong-snapshot';
    }

    if (variant === 'level') {
      request.payload.context.targetLevel = 'JLPT_N3';
    }

    if (variant === 'scope') {
      request.payload.context.catalog = [];
    }

    const admission = await state.observations.admit({
      serviceId: 'fixture-service',
      requestId: request.request_id,
      operation: 'generate',
      mode: request.mode,
      request: input,
    });

    assert.ok(admission.correlation.executionId);

    const initial = createAdaptiveInitialStage(
      state.index,
      state.stage,
      state.build,
      state.observations,
      readRouterPolicy(),
      clock,
    );

    await assert.rejects(
      initial('generate', input, {
        executionId: admission.correlation.executionId,
        signal,
        deadlineAt: request.deadline_at,
      }),
    );

    assert.equal(state.requests.embedding.length, 0);
    assert.equal(state.requests.search.length, 0);
    assert.equal(state.requests.generation.length, 0);

    const events = await trace(state.directory, admission.correlation.executionId);

    assert.equal(
      events.some((event) => event.data.kind === 'routing_decided'),
      false,
    );
  }
});

await test('initial helper emits DEEP for empty or partial evidence without rewrite/rerank/generation', async (t) => {
  for (const partial of [false, true]) {
    const state = await setupSingleStage(t, {
      points: partial ? (index) => [hit(index, 1, 0.2, { skill_codes: [skill] })] : [],
    });
    const request = structuredClone(state.request);
    request.mode = 'ADAPTIVE';
    if (partial) {
      request.payload.context.catalog.push({
        ...request.payload.context.catalog[0],
        skillCode: secondSkill,
        title: 'second',
        lessonSlug: 'synthetic-lesson',
        unitSlug: 'synthetic-unit',
        trackSlug: 'synthetic-track',
      });
    }
    const id = await admit(state.observations, 'generate', request);
    const initial = createAdaptiveInitialStage(
      state.index,
      state.stage,
      state.build,
      state.observations,
      readRouterPolicy(),
      clock,
    );

    const result = await initial('generate', request, {
      executionId: id,
      signal,
      deadlineAt: request.deadline_at,
    });

    assert.equal(result.decision.initialDecision, 'DEEP');
    assert.equal(result.decision.finalPath, null);
    assert.equal(state.requests.embedding.length, 1);
    assert.equal(state.requests.search.length, 1);
    assert.equal(state.requests.generation.length, 0);
    assert.equal((await state.observations.executionAccounting(id)).length, 1);
  }
});

await test('strict route trace rejects forged decisions, thresholds, reason codes, labels and legacy/mode mismatch', async (t) => {
  const state = await setupSingleStage(t);
  const request = structuredClone(state.request);
  request.mode = 'ADAPTIVE';
  const id = await admit(state.observations, 'generate', request);
  const initial = createAdaptiveInitialStage(
    state.index,
    state.stage,
    state.build,
    state.observations,
    readRouterPolicy(),
    clock,
  );
  await initial('generate', request, { executionId: id, signal, deadlineAt: request.deadline_at });
  const events = await trace(state.directory, id);
  const event = events.find((row) => row.data.kind === 'routing_decided');

  assert.ok(event?.data.kind === 'routing_decided');
  assert.deepEqual(parseTraceEvent(event), event);

  for (const extra of [
    { initialDecision: 'DEEP' },
    { reasons: [] },
    { reasons: ['LOW_SKILL_COVERAGE'] },
    { finalPath: 'FAST' },
    { stageCount: 2 },
    { configurationHash: 'f'.repeat(64) },
    { features: { ...event.data.features, expected_route: 'FAST' } },
    { policy: { ...event.data.policy, minSelectedChunks: 2 } },
  ]) {
    assert.throws(() => parseTraceEvent({ ...event, data: { ...event.data, ...extra } }));
  }

  assert.throws(() => parseTraceEvent({ ...event, schemaVersion: 'obs-01-v1' }));
  assert.throws(() =>
    parseTraceEvent({ ...event, correlation: { ...event.correlation, mode: 'SINGLE_STAGE' } }),
  );

  const text = JSON.stringify(event.data);
  for (const sensitive of [
    'userId',
    'referenceAnswer',
    'note',
    'fixture-hf-secret',
    'secret-fixture-token',
    'expected_route',
  ]) {
    assert.equal(text.includes(sensitive), false);
  }
});

await test('policy is validated before calls and snapshotted, cancellation/deadline prevent inference', async (t) => {
  const state = await setupSingleStage(t);
  const request = structuredClone(state.request);
  request.mode = 'ADAPTIVE';
  const id = await admit(state.observations, 'generate', request);
  const policy = { ...readRouterPolicy() };

  assert.throws(() =>
    createAdaptiveInitialStage(
      state.index,
      state.stage,
      state.build,
      state.observations,
      { ...policy, minSkillCoverage: 0 },
      clock,
    ),
  );

  const initial = createAdaptiveInitialStage(
    state.index,
    state.stage,
    state.build,
    state.observations,
    policy,
    clock,
  );
  policy.minSelectedChunks = 64;
  const aborted = AbortSignal.abort();

  await assert.rejects(
    initial('generate', request, {
      executionId: id,
      signal: aborted,
      deadlineAt: request.deadline_at,
    }),
    { code: 'TIMEOUT' },
  );
  await assert.rejects(
    initial('generate', request, { executionId: id, signal, deadlineAt: '2026-11-25T09:59:59Z' }),
    { code: 'TIMEOUT' },
  );

  assert.equal(state.requests.embedding.length, 0);

  const result = await initial('generate', request, {
    executionId: id,
    signal,
    deadlineAt: request.deadline_at,
  });

  assert.equal(result.decision.policy.minSelectedChunks, 1);
  assert.equal(result.decision.initialDecision, 'FAST');
});

await test('claimed context coverage must match selected evidence metadata', () => {
  const { rows, targets, built } = features([candidate(1)]);
  const forged = {
    ...built,
    trace: { ...built.trace, coverage: { ...built.trace.coverage, coveredSkillCodes: targets } },
  };

  assert.throws(() => extractRouterFeatures(targets, rows, forged), { code: 'INVALID_INPUT' });
});

await test('failed retrieval preserves attempt accounting and has no fabricated route or generation', async (t) => {
  const state = await setupSingleStage(t, {
    hfFetch: () => Promise.resolve(Response.json({ error: 'unavailable' }, { status: 503 })),
  });
  const request = structuredClone(state.request);
  request.mode = 'ADAPTIVE';
  const id = await admit(state.observations, 'generate', request);
  const initial = createAdaptiveInitialStage(
    state.index,
    state.stage,
    state.build,
    state.observations,
    readRouterPolicy(),
    clock,
  );

  await assert.rejects(
    initial('generate', request, { executionId: id, signal, deadlineAt: request.deadline_at }),
  );

  assert.equal(state.requests.embedding.length, 1);
  assert.equal(state.requests.search.length, 0);
  assert.equal(state.requests.generation.length, 0);

  const events = await trace(state.directory, id);

  assert.equal(
    events.some((event) => event.data.kind === 'routing_decided'),
    false,
  );

  const calls = await state.observations.executionAccounting(id);

  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.cost.kind === 'PER_CALL');
  assert.equal(calls[0].cost.totalUsd, null);
});

await test('routing event/span sink failures preserve TRACE_WRITE_FAILED and UNKNOWN without repeating inference', async (t) => {
  for (const failSpan of [false, true]) {
    const state = await setupSingleStage(t, {
      observationOptions: {
        sinkFactory: (path) => {
          const sink = new JsonlTraceSink(path);

          return {
            write: async (event) => {
              if (
                failSpan
                  ? event.data.kind === 'span_completed' && event.data.stage === 'routing'
                  : event.data.kind === 'routing_decided'
              ) {
                throw new Error('fixture write failure');
              }

              await sink.write(event);
            },
            close: () => sink.close(),
          };
        },
      },
    });
    const request = structuredClone(state.request);
    request.mode = 'ADAPTIVE';
    const id = await admit(state.observations, 'generate', request);
    const initial = createAdaptiveInitialStage(
      state.index,
      state.stage,
      state.build,
      state.observations,
      readRouterPolicy(),
      clock,
    );

    await assert.rejects(
      initial('generate', request, { executionId: id, signal, deadlineAt: request.deadline_at }),
      { code: 'TRACE_WRITE_FAILED' },
    );

    const rows = await state.observations.inspect();

    assert.equal(rows[0]?.state, 'UNKNOWN');
    assert.equal(state.requests.embedding.length, 1);
    assert.equal(state.requests.generation.length, 0);
  }
});

await test('monotonic deadline during embedding stops before routing with unchanged wall clock', async (t) => {
  let elapsed = 0;
  const timer = { now: () => clock.now(), monotonicMs: () => elapsed };
  const state = await setupSingleStage(t, {
    clock: timer,
    hfFetch: () => {
      elapsed = 31000;

      return Promise.resolve(
        Response.json([Array.from({ length: 1024 }, (_v, i) => (i === 0 ? 1 : 0))]),
      );
    },
  });
  const request = structuredClone(state.request);
  request.mode = 'ADAPTIVE';
  const id = await admit(state.observations, 'generate', request);
  const initial = createAdaptiveInitialStage(
    state.index,
    state.stage,
    state.build,
    state.observations,
    readRouterPolicy(),
    timer,
  );

  await assert.rejects(
    initial('generate', request, { executionId: id, signal, deadlineAt: request.deadline_at }),
  );

  assert.equal(state.requests.embedding.length, 1);
  assert.equal(state.requests.search.length, 0);

  const events = await trace(state.directory, id);

  assert.equal(
    events.some((event) => event.data.kind === 'routing_decided'),
    false,
  );
});
