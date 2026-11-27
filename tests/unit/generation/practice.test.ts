import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { setupAdaptive } from '@tests/__fixtures__/adaptive-fixture';
import {
  clock,
  outputFor,
  providerResponse,
  requestFor,
} from '@tests/__fixtures__/generation-fixture';
import { practiceScenarios } from '@tests/__fixtures__/practice-fixture';
import { hit } from '@tests/__fixtures__/retrieval-fixture';
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
import type { Mode, Operation } from '@/shared/operations';

const scenarios = practiceScenarios();
const contracts = createContractValidators();
const httpContracts = createHttpContractValidators();
const token = 'uc-01-fixture-service-token';

async function practiceHttp(t: TestContext, fixtureIndex = 0) {
  let output: unknown = outputFor('generate', fixtureIndex);
  let path = 'LLM_ONLY';
  let searchRound = 0;
  const state = await setupAdaptive(t, {
    fixtureIndex,
    points: (index) => {
      if (path === 'DEEP' && searchRound++ === 0) {
        return [];
      }

      return [
        hit(index, 1, 0.8, {
          skill_codes: ['synthetic_copula'],
          jlpt_level: state.request.payload.context.targetLevel,
        }),
      ];
    },
    generatorFetch: () => Promise.resolve(providerResponse(output)),
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

function post(server: FastifyInstance, request: Requests[Operation]) {
  return server.inject({
    method: 'POST',
    url: '/v1/practice/generate',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(toHttpBody(request)),
  });
}

await test('UC-01: matriks schema dan invariant empat tipe, dua locale, N5/N4 serta empat arah terjemahan', async (t) => {
  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      assert.ok(
        contracts.requests.generate(scenario.request),
        JSON.stringify(contracts.requests.generate.errors),
      );

      const result = validateOutput('generate', scenario.request, scenario.output);

      assert.equal(result, scenario.expected);
    });
  }
});

await test('UC-01: hasil campuran valid melalui HTTP pada tiga mode serta FAST/DEEP, replay tidak mengulang inference', async (t) => {
  for (let fixtureIndex = 0; fixtureIndex < 4; fixtureIndex++) {
    await t.test(`locale-level/${fixtureIndex}`, async (child) => {
      const state = await practiceHttp(child, fixtureIndex);
      const output = outputFor('generate', fixtureIndex);

      for (const [mode, path] of [
        ['LLM_ONLY', 'LLM_ONLY'],
        ['SINGLE_STAGE', 'SINGLE_STAGE'],
        ['ADAPTIVE', 'FAST'],
        ['ADAPTIVE', 'DEEP'],
      ] as const) {
        const request = structuredClone(state.request);
        request.mode = mode;
        request.request_id = randomUUID();
        request.payload.metadata.requestId = request.request_id;
        delete request.experiment;
        state.select(output, path);

        const response = await post(state.server, request);
        const body: unknown = response.json();

        assert.equal(response.statusCode, 200, response.body);
        assert.ok(httpContracts.responses.generate(body));
        assert.deepEqual(body.data, output);
        assert.equal(body.mode, mode);
        assert.equal(body.meta.path, path);
        assert.equal(
          body.meta.counters.retrievalStageCount,
          path === 'DEEP' ? 2 : mode === 'LLM_ONLY' ? 0 : 1,
        );
        assert.equal(body.meta.counters.schemaRetryCount, 0);
        assert.equal(body.meta.sources.length, mode === 'LLM_ONLY' ? 0 : 1);

        const attempts = state.requests.generation.length + state.requests.embedding.length;
        const before = await state.observations.inspect();

        const replay = await post(state.server, request);

        assert.equal(replay.body, response.body);
        assert.equal(state.requests.generation.length + state.requests.embedding.length, attempts);
        assert.deepEqual(await state.observations.inspect(), before);

        const persisted: unknown = await state.observations.readResponse(body.executionId);

        assert.ok(contracts.responses.generate(persisted));
        assert.deepEqual(persisted.data, output);
      }
    });
  }
});

await test('UC-01: output invalid tersimpan hanya sebagai terminal/envelope gagal dan replay tanpa call baru', async (t) => {
  const state = await practiceHttp(t);

  for (const scenario of scenarios.filter((item) => item.expected !== null)) {
    await t.test(scenario.name, async () => {
      const request = structuredClone(scenario.request);
      request.corpus_version = state.index.corpusVersion;
      request.request_id = randomUUID();
      request.payload.metadata.requestId = request.request_id;
      state.select(scenario.output, 'LLM_ONLY');
      const beforeCalls = state.requests.generation.length;

      const response = await post(state.server, request);
      const body: unknown = response.json();

      assert.equal(
        response.statusCode,
        scenario.expected === 'SCHEMA_PARSE_FAILED' ? 502 : 422,
        response.body,
      );
      assert.ok(httpContracts.error(body));
      assert.equal(body.error.code, scenario.expected);
      assert.equal('data' in body, false);
      assert.equal(state.requests.generation.length, beforeCalls + 1);
      assert.ok(body.executionId);

      const persisted: unknown = await state.observations.readResponse(body.executionId);

      assert.ok(contracts.error(persisted));
      assert.equal('data' in persisted, false);

      const inspection = (await state.observations.inspect()).find(
        (item) => item.correlation.executionId === body.executionId,
      );

      assert.equal(inspection?.traceIntegrity, 'VALID');
      assert.equal(inspection?.responseIntegrity, 'VALID');
      assert.equal(inspection?.terminal?.data.kind, 'terminal');
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

await test('UC-01: post-validation tetap aktif pada SINGLE_STAGE dan kedua jalur ADAPTIVE', async (t) => {
  const state = await practiceHttp(t);
  const invalid = outputFor('generate');
  invalid.questions = invalid.questions.map((question) => ({
    ...question,
    skillCode: 'outside_catalog',
  }));

  for (const [mode, path] of [
    ['SINGLE_STAGE', 'SINGLE_STAGE'],
    ['ADAPTIVE', 'FAST'],
    ['ADAPTIVE', 'DEEP'],
  ] as const satisfies readonly (readonly [Mode, string])[]) {
    const request = structuredClone(state.request);
    request.mode = mode;
    request.request_id = randomUUID();
    request.payload.metadata.requestId = request.request_id;
    state.select(invalid, path);

    const response = await post(state.server, request);
    const body: unknown = response.json();

    assert.equal(response.statusCode, 422, response.body);
    assert.ok(httpContracts.error(body));
    assert.equal(body.error.code, 'POST_VALIDATION_FAILED');
    assert.equal('data' in body, false);
  }
});

await test('UC-01: batas questionCount 1/20 diterima dan 0/21 ditolak sebelum admission/provider', async (t) => {
  const state = await practiceHttp(t);
  const question = outputFor('generate').questions[0];

  assert.ok(question);

  for (const count of [1, 20, 0, 21]) {
    const request = requestFor('generate');
    request.corpus_version = state.index.corpusVersion;
    request.payload.questionCount = count;
    const output = { questions: Array.from({ length: count }, () => question) };
    state.select(output, 'LLM_ONLY');
    const beforeCalls = state.requests.generation.length;
    const before = await state.observations.inspect();

    const response = await post(state.server, request);
    const body: unknown = response.json();

    if (count === 1 || count === 20) {
      assert.equal(response.statusCode, 200, response.body);
      assert.ok(httpContracts.responses.generate(body));
      assert.equal(body.data.questions.length, count);
      assert.equal(state.requests.generation.length, beforeCalls + 1);
    } else {
      assert.equal(response.statusCode, 400, response.body);
      assert.ok(httpContracts.error(body));
      assert.equal(body.error.code, 'INVALID_INPUT');
      assert.equal(body.executionId, null);
      assert.equal(state.requests.generation.length, beforeCalls);
      assert.deepEqual(await state.observations.inspect(), before);
    }
  }
});
