import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { setupAdaptive } from '@tests/__fixtures__/adaptive-fixture';
import { evaluationScenarios } from '@tests/__fixtures__/evaluation-fixture';
import {
  clock,
  outputFor,
  providerResponse,
  requestFor,
} from '@tests/__fixtures__/generation-fixture';
import { checksum, hit } from '@tests/__fixtures__/retrieval-fixture';
import Fastify, { type FastifyInstance } from 'fastify';
import { readConfig } from '@/bootstrap/config';
import type { Requests } from '@/contracts/types';
import { createBaselineRunner } from '@/modules/rag/application/generation/baseline';
import { validateOutput } from '@/modules/rag/application/generation/schema';
import { RagServiceImpl } from '@/modules/rag/application/services/impl/rag.service.impl';
import { createContractValidators } from '@/modules/rag/application/validation';
import {
  createHttpContractValidators,
  toHttpBody,
} from '@/modules/rag/interface/primary/rest/http-contract';
import { registerOperationRoutes } from '@/modules/rag/interface/primary/rest/routes';

const scenarios = evaluationScenarios();
const contracts = createContractValidators();
const httpContracts = createHttpContractValidators();
const token = 'uc-02-fixture-service-token';
const evidenceText = 'Synthetic reference transport: わたしはがくせいです。';
const paths = [
  ['LLM_ONLY', 'LLM_ONLY'],
  ['SINGLE_STAGE', 'SINGLE_STAGE'],
  ['ADAPTIVE', 'FAST'],
  ['ADAPTIVE', 'DEEP'],
] as const;

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));

  return value as Record<string, unknown>;
}

async function evaluationHttp(t: TestContext, fixtureIndex = 0) {
  let output: unknown = outputFor('evaluate', fixtureIndex);
  let path = 'LLM_ONLY';
  let searchRound = 0;
  const state = await setupAdaptive(t, {
    operation: 'evaluate',
    fixtureIndex,
    points: (index) => {
      if (path === 'DEEP' && searchRound++ === 0) {
        return [];
      }

      return [
        hit(index, 1, 0.8, {
          skill_codes: ['synthetic_copula'],
          jlpt_level: state.request.payload.context.targetLevel,
          text: evidenceText,
          content_checksum: checksum(evidenceText),
        }),
      ];
    },
    generatorFetch: (_url, init) => {
      const body = object(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
      const format = object(object(body.text).format);

      return Promise.resolve(
        providerResponse(
          format.name === 'RefinedRetrievalQuery' ? { query: '学生です。 文法の説明と例' } : output,
        ),
      );
    },
  });
  const baseline = createBaselineRunner(state.generate, state.observations, clock);
  const server = Fastify({ logger: false });
  registerOperationRoutes(server, {
    config: readConfig({ API_SERVICE_TOKEN: token, API_CORPUS_VERSION: state.index.corpusVersion })
      .api,
    clock,
    contracts,
    operations: new RagServiceImpl({
      LLM_ONLY: baseline,
      SINGLE_STAGE: state.run,
      ADAPTIVE: state.adaptive,
    }),
    registry: state.observations,
    availableModes: ['LLM_ONLY', 'SINGLE_STAGE', 'ADAPTIVE'],
  });
  t.after(() => server.close());

  return {
    ...state,
    server,
    select: (value: unknown, selectedPath: string) => {
      output = value;
      path = selectedPath;
      searchRound = 0;
    },
  };
}

function post(server: FastifyInstance, request: unknown) {
  return server.inject({
    method: 'POST',
    url: '/v1/practice/evaluate',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(toHttpBody(request)),
  });
}

function uniqueRequest(request: Requests['evaluate'], corpusVersion: string): Requests['evaluate'] {
  const copy = structuredClone(request);
  copy.request_id = randomUUID();
  copy.payload.metadata.requestId = copy.request_id;
  copy.corpus_version = corpusVersion;

  return copy;
}

function generationBody(request: unknown): Record<string, unknown> {
  const wire = object(request);

  assert.equal(typeof wire.input, 'string');

  return object(JSON.parse(wire.input as string));
}

await test('UC-02: kontrak grading menerima EN/ID dan variasi Jepang; output strict tidak mengubah domain', async (t) => {
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      assert.ok(
        contracts.requests.evaluate(scenario.request),
        JSON.stringify(contracts.requests.evaluate.errors),
      );

      const result = validateOutput('evaluate', scenario.request, scenario.output);

      assert.equal(result, scenario.expected);
    });
  }
});

await test('UC-02: HTTP tiga mode serta FAST/DEEP mempertahankan input/output fixture dan replay tanpa inference baru', async (t) => {
  for (let fixtureIndex = 0; fixtureIndex < 4; fixtureIndex++) {
    await t.test(`locale-level/${fixtureIndex}`, async (child) => {
      const state = await evaluationHttp(child, fixtureIndex);
      const output = outputFor('evaluate', fixtureIndex);

      for (const [mode, path] of paths) {
        const request = uniqueRequest(
          requestFor('evaluate', fixtureIndex),
          state.index.corpusVersion,
        );
        request.mode = mode;
        state.select(output, path);

        const response = await post(state.server, request);
        const body: unknown = response.json();

        assert.equal(response.statusCode, 200, response.body);
        assert.ok(httpContracts.responses.evaluate(body));
        assert.deepEqual(body.data, output);
        assert.equal(body.mode, mode);
        assert.equal(body.meta.path, path);
        assert.equal(
          body.meta.counters.retrievalStageCount,
          path === 'DEEP' ? 2 : mode === 'LLM_ONLY' ? 0 : 1,
        );
        assert.equal(body.meta.counters.schemaRetryCount, 0);
        assert.equal(body.meta.sources.length, mode === 'LLM_ONLY' ? 0 : 1);

        const prompt = generationBody(state.requests.generation.at(-1));

        assert.deepEqual(prompt.question, request.payload.question);
        assert.deepEqual(prompt.userAnswer, request.payload.userAnswer);
        assert.deepEqual(prompt.language, request.payload.language);
        assert.deepEqual(
          prompt.evidence,
          mode === 'LLM_ONLY'
            ? []
            : [{ sourceId: 'source-1', chunkId: 'chunk-1', text: evidenceText }],
        );

        for (const forbidden of [
          request.request_id,
          request.payload.metadata.userId,
          request.experiment?.experiment_id,
          request.experiment?.case_id,
        ]) {
          if (forbidden !== undefined) {
            assert.equal(JSON.stringify(prompt).includes(forbidden), false);
          }
        }

        assert.deepEqual(Object.keys(prompt).sort(), [
          'context',
          'evidence',
          'language',
          'question',
          'userAnswer',
        ]);

        const calls = state.requests.generation.length + state.requests.embedding.length;
        const before = await state.observations.inspect();

        const replay = await post(state.server, request);

        assert.equal(replay.body, response.body);
        assert.equal(state.requests.generation.length + state.requests.embedding.length, calls);
        assert.deepEqual(await state.observations.inspect(), before);

        const persisted: unknown = await state.observations.readResponse(body.executionId);

        assert.ok(contracts.responses.evaluate(persisted));
        assert.deepEqual(persisted.data, output);
      }
    });
  }
});

await test('UC-02: kana/kanji/mixed/spasi/tanda baca dan feedbackLocale diteruskan utuh, tanpa normalisasi service', async (t) => {
  const state = await evaluationHttp(t);

  for (const scenario of scenarios.filter((item) => item.expected === null)) {
    await t.test(scenario.name, async () => {
      const request = uniqueRequest(scenario.request, state.index.corpusVersion);
      delete request.experiment;
      state.select(scenario.output, 'LLM_ONLY');

      const response = await post(state.server, request);
      const body: unknown = response.json();

      assert.equal(response.statusCode, 200, response.body);
      assert.ok(httpContracts.responses.evaluate(body));
      assert.deepEqual(body.data, scenario.output);

      const prompt = generationBody(state.requests.generation.at(-1));

      assert.deepEqual(prompt.userAnswer, request.payload.userAnswer);
      assert.deepEqual(prompt.language, request.payload.language);
      assert.deepEqual(prompt.question, request.payload.question);
    });
  }
});

await test('UC-02: hasil grading invalid disimpan sebagai kegagalan; replay tidak mengulang call', async (t) => {
  const state = await evaluationHttp(t);

  for (const scenario of scenarios.filter((item) => item.expected !== null)) {
    await t.test(scenario.name, async () => {
      const request = uniqueRequest(scenario.request, state.index.corpusVersion);
      state.select(scenario.output, 'LLM_ONLY');
      const beforeCalls = state.requests.generation.length;

      const response = await post(state.server, request);
      const body: unknown = response.json();

      assert.equal(response.statusCode, 502, response.body);
      assert.ok(httpContracts.error(body));
      assert.equal(body.error.code, scenario.expected);
      assert.equal('data' in body, false);
      assert.equal(state.requests.generation.length, beforeCalls + 1);
      assert.ok(body.executionId);

      const persisted: unknown = await state.observations.readResponse(body.executionId);
      const inspection = (await state.observations.inspect()).find(
        (item) => item.correlation.executionId === body.executionId,
      );

      assert.ok(contracts.error(persisted));
      assert.equal('data' in persisted, false);
      assert.equal(inspection?.traceIntegrity, 'VALID');
      assert.equal(inspection?.responseIntegrity, 'VALID');
      assert.equal(
        inspection?.terminal?.data.kind === 'terminal' ? inspection.terminal.data.outcome : null,
        'FAILED',
      );

      const before = await state.observations.inspect();

      const replay = await post(state.server, request);

      assert.equal(replay.body, response.body);
      assert.equal(state.requests.generation.length, beforeCalls + 1);
      assert.deepEqual(await state.observations.inspect(), before);
    });
  }
});

await test('UC-02: output schema tetap aktif untuk SINGLE_STAGE dan kedua jalur ADAPTIVE', async (t) => {
  const state = await evaluationHttp(t);

  for (const [mode, path] of paths.filter(([mode]) => mode !== 'LLM_ONLY')) {
    const request = uniqueRequest(requestFor('evaluate'), state.index.corpusVersion);
    request.mode = mode;
    state.select({ ...outputFor('evaluate'), numericScore: 101 }, path);

    const response = await post(state.server, request);
    const body: unknown = response.json();

    assert.equal(response.statusCode, 502, response.body);
    assert.ok(httpContracts.error(body));
    assert.equal(body.error.code, 'SCHEMA_PARSE_FAILED');
    assert.equal('data' in body, false);
  }
});

await test('UC-02: non-FREE_RESPONSE, locale/skill/range/type/extra field ditolak sebelum admission', async (t) => {
  const state = await evaluationHttp(t);
  const mutations: readonly (readonly [
    string,
    (request: Record<string, unknown>) => void,
    number,
  ])[] = [
    ...(['SHORT_FREE_RESPONSE', 'SLOT_FILL', 'ARRANGE_TOKEN'] as const).map(
      (type) =>
        [
          `objective-type/${type}`,
          (request: Record<string, unknown>) => {
            object(object(request.payload).question).questionType = type;
          },
          400,
        ] as const,
    ),
    [
      'mismatched-source-locale',
      (request) => {
        object(object(request.payload).question).promptLanguage = 'ID';
      },
      400,
    ],
    [
      'foreign-skill',
      (request) => {
        object(object(request.payload).question).skillCode = 'outside_catalog';
      },
      400,
    ],
    [
      'non-Japanese-answer-language',
      (request) => {
        object(object(request.payload).question).answerLanguage = 'EN';
      },
      400,
    ],
    [
      'invalid-translation-locale',
      (request) => {
        object(object(request.payload).language).translationLocale = 'ja';
      },
      400,
    ],
    [
      'invalid-feedback-locale',
      (request) => {
        object(object(request.payload).language).feedbackLocale = 'ja';
      },
      400,
    ],
    [
      'level-N3',
      (request) => {
        object(object(request.payload).context).targetLevel = 'JLPT_N3';
      },
      422,
    ],
    [
      'level-N2',
      (request) => {
        object(object(request.payload).context).targetLevel = 'JLPT_N2';
      },
      422,
    ],
    [
      'empty-answer',
      (request) => {
        object(object(request.payload).userAnswer).normalizedKana = '';
      },
      400,
    ],
    [
      'answer-over-2000',
      (request) => {
        object(object(request.payload).userAnswer).normalizedKana = 'あ'.repeat(2001);
      },
      400,
    ],
    [
      'wrong-answer-type',
      (request) => {
        object(object(request.payload).userAnswer).normalizedKana = ['あ'];
      },
      400,
    ],
    [
      'extra-grading-label',
      (request) => {
        object(request.payload).expectedGrade = 100;
      },
      400,
    ],
    [
      'extra-rubric-label',
      (request) => {
        object(request.payload).evaluationRubric = { gold: 'forbidden' };
      },
      400,
    ],
    [
      'extra-question-property',
      (request) => {
        object(object(request.payload).question).gradingStrategy = 'AI';
      },
      400,
    ],
  ];

  for (const [name, mutate, status] of mutations) {
    await t.test(name, async () => {
      const request = object(uniqueRequest(requestFor('evaluate'), state.index.corpusVersion));
      mutate(request);
      const before = await state.observations.inspect();
      const calls = state.requests.generation.length + state.requests.embedding.length;

      const response = await post(state.server, request);
      const body: unknown = response.json();

      assert.equal(response.statusCode, status, response.body);
      assert.ok(httpContracts.error(body));
      assert.equal(body.error.code, status === 422 ? 'UNSUPPORTED_LEVEL' : 'INVALID_INPUT');
      assert.equal(body.executionId, null);
      assert.equal('data' in body, false);
      assert.equal(state.requests.generation.length + state.requests.embedding.length, calls);
      assert.deepEqual(await state.observations.inspect(), before);
    });
  }
});
