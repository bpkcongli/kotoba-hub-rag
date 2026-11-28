import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { candidate, contextConfig } from '@tests/__fixtures__/context-fixture';
import {
  admit,
  clock,
  config,
  providerResponse,
  requestFor,
  setup,
  signal,
} from '@tests/__fixtures__/generation-fixture';
import {
  gradedAssessment,
  grammarAnchors,
  meaningAnchors,
  naturalnessAnchors,
  rubricEvidence,
  rubricFixture,
  ungradableAssessment,
} from '@tests/__fixtures__/rubric-fixture';
import { trace } from '@tests/__fixtures__/single-stage-fixture';
import Fastify from 'fastify';
import { readConfig } from '@/bootstrap/config';
import { ObservationStore } from '@/bootstrap/observation-store';
import { readExecutionPolicy } from '@/modules/execution/application/public';
import { parseTraceEvent } from '@/modules/observability/application/events';
import { buildContext } from '@/modules/rag/application/context/builder';
import { createBaselineRunner } from '@/modules/rag/application/generation/baseline';
import { createOperationGenerator } from '@/modules/rag/application/generation/generator';
import {
  gradingBinding,
  gradingInstructions,
  assessmentSchema,
  parseAssessment,
  scoreAssessment,
} from '@/modules/rag/application/generation/grading';
import { RagServiceImpl } from '@/modules/rag/application/services/impl/rag.service.impl';
import { createContractValidators } from '@/modules/rag/application/validation';
import {
  createHttpContractValidators,
  toHttpBody,
} from '@/modules/rag/interface/primary/rest/http-contract';
import { registerOperationRoutes } from '@/modules/rag/interface/primary/rest/routes';

const serviceToken = 'synthetic-uc02-runtime-token';

async function runtimeHttp(
  t: TestContext,
  output: unknown,
  fixtureIndex = 0,
  providerExtra: Record<string, unknown> = {},
) {
  const wires: unknown[] = [];
  const state = await setup(t, (_url, init) => {
    wires.push(typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null);

    return Promise.resolve(providerResponse(output, providerExtra));
  });
  const request = requestFor('evaluate', fixtureIndex);
  const bundle = rubricFixture(request);
  const generate = createOperationGenerator(state.provider, config(), bundle, state.observations);
  const policy = readExecutionPolicy({
    PIPELINE_MAX_SCHEMA_RETRIES: '1',
    PIPELINE_MAX_TOTAL_RETRIES: '1',
  });
  const baseline = createBaselineRunner(generate, state.observations, clock, policy);
  const api = readConfig({
    API_SERVICE_TOKEN: serviceToken,
    API_CORPUS_VERSION: request.corpus_version,
  }).api;
  const mount = (observations: ObservationStore) => {
    const server = Fastify({ logger: false });
    registerOperationRoutes(server, {
      config: api,
      clock,
      contracts: createContractValidators(),
      operations: new RagServiceImpl({ LLM_ONLY: baseline, SINGLE_STAGE: null, ADAPTIVE: null }),
      registry: observations,
      availableModes: ['LLM_ONLY'],
    });
    t.after(() => server.close());

    return server;
  };

  const server = mount(state.observations);
  const post = (target = server) =>
    target.inject({
      method: 'POST',
      url: '/v1/practice/evaluate',
      headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify(toHttpBody(request)),
    });

  return { ...state, request, bundle, generate, server, post, mount, wires };
}

await test('UC-02: 48 kombinasi anchor memakai penjumlahan lalu cap dan threshold server', async (t) => {
  // Independent truth table from SUM_THEN_CAP_V1, indexed by grammar then naturalness.
  const expectedByMeaning = {
    0: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    20: [20, 25, 30, 30, 35, 40, 40, 45, 49, 49, 49, 49],
    40: [40, 45, 50, 50, 55, 60, 60, 65, 70, 70, 75, 79],
    60: [60, 65, 70, 70, 75, 79, 79, 85, 90, 79, 95, 100],
  } as const;

  for (const meaning of meaningAnchors) {
    let index = 0;

    for (const grammar of grammarAnchors) {
      for (const naturalness of naturalnessAnchors) {
        const expected = expectedByMeaning[meaning][index++];

        await t.test(`M${meaning}/G${grammar}/N${naturalness}`, () => {
          const result = scoreAssessment({ meaning, grammar, naturalness });

          assert.equal(result.numericScore, expected);
          assert.equal(result.isCorrect, expected !== undefined && expected >= 80);
        });
      }
    }
  }
});

await test('UC-02: HTTP memetakan assessment ke tiga field publik dan replay restart mempertahankan binding', async (t) => {
  for (let fixtureIndex = 0; fixtureIndex < 4; fixtureIndex++) {
    await t.test(`locale-level/${fixtureIndex}`, async (child) => {
      const feedback = fixtureIndex % 2 === 0 ? 'Meaning preserved.' : 'Makna terjaga.';
      const state = await runtimeHttp(
        child,
        gradedAssessment({ meaning: 60, grammar: 30, naturalness: 5 }, feedback),
        fixtureIndex,
      );

      const response = await state.post();
      const body: unknown = response.json();

      assert.equal(response.statusCode, 200, response.body);
      assert.ok(createHttpContractValidators().responses.evaluate(body));
      assert.deepEqual(body.data, { numericScore: 95, isCorrect: true, feedbackText: feedback });
      assert.equal(body.meta.counters.retrievalStageCount, 0);
      assert.equal(body.meta.counters.schemaRetryCount, 0);
      assert.deepEqual(body.meta.sources, []);
      assert.equal(state.wires.length, 1);

      const events = await trace(state.directory, body.executionId);
      const binding = events.find((event) => event.data.kind === 'grading_binding');
      const assessment = events.find((event) => event.data.kind === 'grading_assessed');

      assert.equal(binding?.data.kind, 'grading_binding');
      assert.equal(assessment?.data.kind, 'grading_assessed');
      if (
        binding?.data.kind === 'grading_binding' &&
        assessment?.data.kind === 'grading_assessed'
      ) {
        assert.deepEqual(binding.data.policyRef, state.bundle.policyRef);
        assert.deepEqual(binding.data.guidanceRefs, []);
        assert.equal(binding.data.corpusVersion, state.request.corpus_version);
        assert.equal(binding.data.outcome, 'PENDING');
        assert.equal(assessment.data.outcome, 'GRADED');
        assert.deepEqual(assessment.data.scores, { meaning: 60, grammar: 30, naturalness: 5 });
        assert.equal('feedbackText' in assessment.data, false);
      }

      const replay = await state.post();

      assert.equal(replay.body, response.body);
      assert.equal(state.wires.length, 1);

      await state.observations.close();
      const restarted = new ObservationStore(state.directory, clock);
      const restartedServer = state.mount(restarted);

      try {
        const recovered = await state.post(restartedServer);
        const inspection = (await restarted.inspect()).find(
          (row) => row.correlation.executionId === body.executionId,
        );

        assert.equal(recovered.body, response.body);
        assert.equal(state.wires.length, 1);
        assert.equal(inspection?.traceIntegrity, 'VALID');
        assert.equal(inspection?.responseIntegrity, 'VALID');
      } finally {
        await restarted.close();
      }
    });
  }
});

await test('UC-02: UNGRADABLE menjadi error terminal422 tanpa grade, schema retry, atau inference ulang', async (t) => {
  for (const reason of [
    'SOURCE_AMBIGUOUS',
    'SOURCE_REFERENCE_CONFLICT',
    'NORMALIZATION_CONFLICT',
  ] as const) {
    await t.test(reason, async (child) => {
      const state = await runtimeHttp(child, ungradableAssessment(reason));

      const response = await state.post();
      const body: unknown = response.json();

      assert.equal(response.statusCode, 422, response.body);
      assert.ok(createHttpContractValidators().error(body));
      assert.equal(body.error.code, 'POST_VALIDATION_FAILED');
      assert.equal('data' in body, false);
      assert.equal(state.wires.length, 1);
      assert.ok(body.executionId);

      const events = await trace(state.directory, body.executionId);
      const assessed = events.find((event) => event.data.kind === 'grading_assessed');
      const terminal = events.find((event) => event.data.kind === 'terminal');

      assert.ok(assessed?.data.kind === 'grading_assessed');
      assert.equal(assessed.data.outcome, 'UNGRADABLE');
      assert.equal(assessed.data.reason, reason);
      assert.equal(assessed.data.scores, null);
      assert.ok(terminal?.data.kind === 'terminal');
      assert.equal(terminal.data.outcome, 'FAILED');
      assert.equal(
        events.filter(
          (event) =>
            event.data.kind === 'model_attempt' &&
            'accounting' in event.data &&
            event.data.accounting.retryKind === 'SCHEMA_RETRY',
        ).length,
        0,
      );

      const replay = await state.post();

      assert.equal(replay.body, response.body);
      assert.equal(state.wires.length, 1);
    });
  }
});

await test('UC-02: assessment malformed tetap memakai satu retry schema bounded dan tidak menghasilkan grade palsu', async (t) => {
  const state = await runtimeHttp(t, {
    assessment: { ...gradedAssessment().assessment, numericScore: 100 },
  });

  const response = await state.post();
  const body: unknown = response.json();

  assert.equal(response.statusCode, 502, response.body);
  assert.ok(createHttpContractValidators().error(body));
  assert.equal(body.error.code, 'SCHEMA_PARSE_FAILED');
  assert.equal('data' in body, false);
  assert.equal(state.wires.length, 2);
});

await test('UC-02: jawaban sah M0 memperoleh grade0; usage provider yang hilang tetap unknown', async (t) => {
  const state = await runtimeHttp(
    t,
    gradedAssessment({ meaning: 0, grammar: 30, naturalness: 10 }),
    0,
    { usage: null },
  );

  const response = await state.post();
  const body: unknown = response.json();

  assert.equal(response.statusCode, 200, response.body);
  assert.ok(createHttpContractValidators().responses.evaluate(body));
  assert.equal(body.data.numericScore, 0);
  assert.equal(body.data.isCorrect, false);
  assert.equal(body.meta.usage.totalTokens, null);
  assert.equal(body.meta.usage.inputTokens, null);
  assert.equal(body.meta.cost.totalOnlineUsd, null);
  assert.equal(body.meta.counters.modelCallCount, 1);
});

await test('UC-02: generator memakai prompt/schema/model yang sama di tiga mode dan menjaga input Jepang', async (t) => {
  const wires: unknown[] = [];
  const state = await setup(t, (_url, init) => {
    wires.push(typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null);

    return Promise.resolve(providerResponse(gradedAssessment()));
  });
  const initial = requestFor('evaluate');
  const bundle = rubricFixture(initial);
  const generate = createOperationGenerator(state.provider, config(), bundle, state.observations);

  for (const mode of ['LLM_ONLY', 'SINGLE_STAGE', 'ADAPTIVE'] as const) {
    const request = requestFor('evaluate');
    request.mode = mode;
    const executionId = await admit(state.observations, 'evaluate', request);
    const evidence = mode === 'LLM_ONLY' ? [] : [rubricEvidence(bundle)];

    const result = await generate('evaluate', request, evidence, {
      executionId,
      signal,
      deadlineAt: request.deadline_at,
    });

    assert.deepEqual(result.data, {
      numericScore: 100,
      isCorrect: true,
      feedbackText: gradedAssessment().assessment.feedbackText,
    });

    const wire = wires.at(-1);

    assert.ok(
      typeof wire === 'object' &&
        wire !== null &&
        'input' in wire &&
        typeof wire.input === 'string',
    );

    const prompt: unknown = JSON.parse(wire.input);

    assert.ok(
      typeof prompt === 'object' &&
        prompt !== null &&
        'userAnswer' in prompt &&
        'question' in prompt,
    );
    assert.deepEqual(prompt.userAnswer, request.payload.userAnswer);
    assert.deepEqual(prompt.question, request.payload.question);
  }

  const selected = wires.map((wire) => {
    assert.ok(
      typeof wire === 'object' &&
        wire !== null &&
        'instructions' in wire &&
        'text' in wire &&
        'model' in wire,
    );

    return { instructions: wire.instructions, text: wire.text, model: wire.model };
  });

  assert.deepEqual(selected[0], selected[1]);
  assert.deepEqual(selected[1], selected[2]);
});

await test('UC-02: dependency dan guidance invalid ditolak sebelum model dipanggil', async (t) => {
  let calls = 0;
  const state = await setup(t, () => {
    calls++;

    return Promise.resolve(providerResponse(gradedAssessment()));
  });

  const request = requestFor('evaluate');
  request.mode = 'SINGLE_STAGE';
  const bundle = rubricFixture(request);
  const executionId = await admit(state.observations, 'evaluate', request);
  const context = { executionId, signal, deadlineAt: request.deadline_at };
  const absent = createOperationGenerator(state.provider, config(), null, state.observations);
  const noTrace = createOperationGenerator(state.provider, config(), bundle);
  const generate = createOperationGenerator(state.provider, config(), bundle, state.observations);

  await assert.rejects(absent('evaluate', request, [], context), { code: 'DEPENDENCY_NOT_READY' });
  await assert.rejects(noTrace('evaluate', request, [], context), { code: 'DEPENDENCY_NOT_READY' });
  await assert.rejects(generate('evaluate', request, [], context), {
    code: 'INSUFFICIENT_EVIDENCE',
  });

  const evidence = rubricEvidence(bundle);

  await assert.rejects(
    generate('evaluate', request, [{ ...evidence, text: `${evidence.text} tamper` }], context),
    { code: 'INSUFFICIENT_EVIDENCE' },
  );
  assert.equal(calls, 0);
});

await test('UC-02: context budget menghitung policy dan assessment schema; guidance utuh masuk selected evidence', () => {
  const request = requestFor('evaluate');
  request.mode = 'SINGLE_STAGE';
  const bundle = rubricFixture(request);
  const evidence = rubricEvidence(bundle);
  const skill = request.payload.question.skillCode;
  const row = candidate(1, [skill], evidence.text, {
    sourceId: evidence.sourceId,
    chunkId: evidence.chunkId,
    score: evidence.score,
    rubric: evidence.rubric,
    locale: request.payload.language.translationLocale === 'id' ? 'ID' : 'EN',
  });

  const result = buildContext(contextConfig(), 'evaluate', request, [row], [skill], bundle);

  assert.equal(result.status, 'READY');
  assert.deepEqual(result.evidence, [evidence]);
  assert.equal(
    result.trace.budget.systemTokens,
    Buffer.byteLength(gradingInstructions(bundle), 'utf8'),
  );
  assert.equal(
    result.trace.budget.schemaTokens,
    Buffer.byteLength(JSON.stringify(assessmentSchema), 'utf8'),
  );
  assert.equal(result.trace.selected.length, 1);
  assert.deepEqual(
    gradingBinding(bundle, request, result.evidence),
    bundle.guidances.map(({ id, revision, contentSha256 }) => ({ id, revision, contentSha256 })),
  );

  const emptyLegacy = buildContext(contextConfig(), 'evaluate', request, [], [skill]);
  const limited = contextConfig({
    contextWindowTokens: emptyLegacy.trace.budget.totalReservedTokens + 1024,
    evidenceCapTokens: 1024,
  });
  const grammar = candidate(2, [skill], '私は学生です。');

  const withoutPolicy = buildContext(limited, 'evaluate', request, [grammar], [skill]);
  const withPolicy = buildContext(limited, 'evaluate', request, [grammar], [skill], bundle);

  assert.equal(withoutPolicy.status, 'READY');
  assert.equal(withPolicy.status, 'INPUT_BUDGET_EXCEEDED');
  assert.deepEqual(withPolicy.evidence, []);
  assert.deepEqual(withPolicy.sources, []);
  assert.equal(withPolicy.trace.dropped[0]?.reason, 'FIXED_INPUT_BUDGET');
});

await test('UC-02: trace binding strict menolak score pada PENDING dan field model di luar kontrak', async (t) => {
  const state = await runtimeHttp(t, gradedAssessment());
  const response = await state.post();
  const body: unknown = response.json();

  assert.ok(createHttpContractValidators().responses.evaluate(body));
  const events = await trace(state.directory, body.executionId);
  const binding = events.find((event) => event.data.kind === 'grading_binding');
  const assessed = events.find((event) => event.data.kind === 'grading_assessed');

  assert.ok(binding?.data.kind === 'grading_binding');
  assert.ok(assessed?.data.kind === 'grading_assessed');

  const invalid = [
    {
      ...binding,
      data: { ...binding.data, scores: { meaning: 60, grammar: 30, naturalness: 10 } },
    },
    { ...binding, data: { ...binding.data, outcome: 'GRADED' } },
    { ...binding, data: { ...binding.data, feedbackText: 'raw feedback forbidden' } },
    {
      ...binding,
      data: { ...binding.data, policyRef: { ...binding.data.policyRef, contentSha256: 'wrong' } },
    },
    { ...binding, data: { ...binding.data, promptVersion: 'unknown' } },
    { ...assessed, data: { ...assessed.data, scores: null } },
    {
      ...assessed,
      data: { ...assessed.data, scores: { meaning: 59, grammar: 30, naturalness: 10 } },
    },
    { ...assessed, data: { ...assessed.data, reason: 'SOURCE_AMBIGUOUS' } },
    { ...assessed, correlation: { ...assessed.correlation, operation: 'generate' } },
  ];

  for (const event of invalid) {
    assert.throws(() => parseTraceEvent(event));
  }
});

await test('UC-02: policy sama tersedia untuk tiga mode; hanya RAG memerlukan selected guidance', () => {
  const request = requestFor('evaluate');
  const bundle = rubricFixture(request);
  const evidence = rubricEvidence(bundle);
  const expected = bundle.guidances.map(({ id, revision, contentSha256 }) => ({
    id,
    revision,
    contentSha256,
  }));

  assert.deepEqual(gradingBinding(bundle, request, []), []);
  assert.throws(() => gradingBinding(bundle, request, [evidence]), { code: 'INVALID_INPUT' });

  for (const mode of ['SINGLE_STAGE', 'ADAPTIVE'] as const) {
    request.mode = mode;

    assert.deepEqual(gradingBinding(bundle, request, [evidence]), expected);
    assert.throws(() => gradingBinding(bundle, request, []), { code: 'INSUFFICIENT_EVIDENCE' });
  }

  const instructions = gradingInstructions(bundle);

  assert.ok(instructions.includes(JSON.stringify(bundle.policy.content)));
  assert.equal(instructions.includes(request.request_id), false);

  if (request.payload.metadata.userId !== undefined) {
    assert.equal(instructions.includes(request.payload.metadata.userId), false);
  }
});

await test('UC-02: binding menolak grammar biasa, rubric spoof dan guidance salah scope', async (t) => {
  const request = requestFor('evaluate');
  request.mode = 'SINGLE_STAGE';
  const bundle = rubricFixture(request);
  const evidence = rubricEvidence(bundle);
  const invalid = [
    [
      'plain-grammar',
      {
        chunkId: evidence.chunkId,
        sourceId: evidence.sourceId,
        text: evidence.text,
        score: evidence.score,
        scoreType: evidence.scoreType,
      },
    ],
    ['guidance-id', { ...evidence, rubric: { ...evidence.rubric, guidanceId: 'other' } }],
    ['guidance-revision', { ...evidence, rubric: { ...evidence.rubric, guidanceRevision: 2 } }],
    [
      'guidance-hash',
      { ...evidence, rubric: { ...evidence.rubric, guidanceContentSha256: '0'.repeat(64) } },
    ],
    ['policy-id', { ...evidence, rubric: { ...evidence.rubric, policyId: 'other' } }],
    ['policy-revision', { ...evidence, rubric: { ...evidence.rubric, policyRevision: 2 } }],
    [
      'policy-hash',
      { ...evidence, rubric: { ...evidence.rubric, policyContentSha256: '0'.repeat(64) } },
    ],
    ['tampered-text', { ...evidence, text: `${evidence.text} ` }],
  ] as const;

  for (const [name, row] of invalid) {
    await t.test(name, () => {
      assert.throws(() => gradingBinding(bundle, request, [row]), {
        code: 'INSUFFICIENT_EVIDENCE',
      });
    });
  }

  const changedLocale = structuredClone(request);
  changedLocale.payload.language.translationLocale =
    request.payload.language.translationLocale === 'id' ? 'en' : 'id';
  const changedLevel = structuredClone(request);
  changedLevel.payload.context.targetLevel =
    request.payload.context.targetLevel === 'JLPT_N5' ? 'JLPT_N4' : 'JLPT_N5';
  const changedCatalog = structuredClone(request);
  const firstSkill = changedCatalog.payload.context.catalog[0];

  assert.ok(firstSkill);

  firstSkill.lessonSlug = 'unrelated-lesson';

  for (const copy of [changedLocale, changedLevel, changedCatalog]) {
    assert.throws(() => gradingBinding(bundle, copy, [evidence]), {
      code: 'INSUFFICIENT_EVIDENCE',
    });
  }

  const changedCorpus = { ...request, corpus_version: 'other-corpus' };

  assert.throws(() => gradingBinding(bundle, changedCorpus, [evidence]), {
    code: 'SNAPSHOT_MISMATCH',
  });
  assert.throws(() => gradingBinding({ ...bundle }, request, [evidence]), {
    code: 'UNTRUSTED_RUBRIC',
  });
});

await test('UC-02: parser internal menerima GRADED dan UNGRADABLE tanpa menyamakan keduanya', () => {
  const graded = gradedAssessment();
  const ungradable = ungradableAssessment();

  assert.deepEqual(parseAssessment(graded), graded.assessment);
  assert.deepEqual(parseAssessment(ungradable), ungradable.assessment);
});

await test('UC-02: parser menolak spoof nilai akhir, anchor ilegal dan field di luar assessment', async (t) => {
  const graded = gradedAssessment();
  const ungradable = ungradableAssessment();
  const invalid: readonly [string, unknown][] = [
    ['public-grade', { isCorrect: true, numericScore: 100, feedbackText: 'Accepted.' }],
    ['unwrapped', graded.assessment],
    ['numericScore', { assessment: { ...graded.assessment, numericScore: 100 } }],
    ['isCorrect', { assessment: { ...graded.assessment, isCorrect: true } }],
    ['policyRef', { assessment: { ...graded.assessment, policyRef: { id: 'spoof' } } }],
    ['outer-field', { ...graded, experimentId: 'spoof' }],
    ['meaning-interpolation', gradedAssessment({ meaning: 59, grammar: 30, naturalness: 10 })],
    ['grammar-interpolation', gradedAssessment({ meaning: 60, grammar: 29, naturalness: 10 })],
    ['naturalness-interpolation', gradedAssessment({ meaning: 60, grammar: 30, naturalness: 9 })],
    ['negative', gradedAssessment({ meaning: -20, grammar: 30, naturalness: 10 })],
    [
      'string-anchor',
      {
        assessment: {
          ...graded.assessment,
          scores: { meaning: '60', grammar: 30, naturalness: 10 },
        },
      },
    ],
    [
      'missing-anchor',
      { assessment: { ...graded.assessment, scores: { meaning: 60, grammar: 30 } } },
    ],
    [
      'extra-anchor',
      {
        assessment: { ...graded.assessment, scores: { ...graded.assessment.scores, spelling: 10 } },
      },
    ],
    ['empty-feedback', gradedAssessment(undefined, '')],
    ['whitespace-feedback', gradedAssessment(undefined, '   ')],
    ['long-feedback', gradedAssessment(undefined, 'あ'.repeat(501))],
    ['unknown-outcome', { assessment: { ...graded.assessment, outcome: 'SUCCESS' } }],
    [
      'ungradable-grade',
      { assessment: { ...ungradable.assessment, scores: graded.assessment.scores } },
    ],
    ['ungradable-feedback', { assessment: { ...ungradable.assessment, feedbackText: 'Bad.' } }],
    ['unknown-reason', { assessment: { ...ungradable.assessment, reason: 'WRONG_ANSWER' } }],
    ['null', null],
  ];

  for (const [name, value] of invalid) {
    await t.test(name, () => {
      assert.throws(() => parseAssessment(value), { code: 'SCHEMA_PARSE_FAILED' });
    });
  }
});
