import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setupAdaptive } from '@tests/__fixtures__/adaptive-fixture';
import {
  clock,
  config,
  outputFor,
  providerResponse,
  requestFor,
} from '@tests/__fixtures__/generation-fixture';
import { hit } from '@tests/__fixtures__/retrieval-fixture';
import Fastify, { type FastifyInstance } from 'fastify';
import { createApplication } from '@/app';
import { readConfig, type ApiConfig } from '@/bootstrap/config';
import { ObservationStore } from '@/bootstrap/observation-store';
import type { Requests } from '@/contracts/types';
import { createBaselineRunner } from '@/modules/rag/application/generation/baseline';
import { RagServiceImpl } from '@/modules/rag/application/services/impl/rag.service.impl';
import type { RagService } from '@/modules/rag/application/services/rag.service';
import { createContractValidators } from '@/modules/rag/application/validation';
import {
  createHttpContractValidators,
  toHttpBody,
} from '@/modules/rag/interface/primary/rest/http-contract';
import { registerOperationRoutes } from '@/modules/rag/interface/primary/rest/routes';
import type { Clock } from '@/shared/clock';
import { GenerationError } from '@/shared/errors/generation-error';
import type { Mode, Operation } from '@/shared/operations';

const headers = { authorization: 'Bearer api-fixture-token-123' };
const paths = {
  generate: '/v1/practice/generate',
  evaluate: '/v1/practice/evaluate',
  normalize: '/v1/onboarding/normalize',
  recommend: '/v1/onboarding/recommend',
};
const modes: readonly Mode[] = ['LLM_ONLY', 'SINGLE_STAGE', 'ADAPTIVE'];
const contracts = createContractValidators();
const httpContracts = createHttpContractValidators();
const apiConfig = readConfig({
  API_SERVICE_TOKEN: 'api-fixture-token-123',
  API_CORPUS_VERSION: 'synthetic-contract-v1',
}).api;

async function httpFixture(
  t: TestContext,
  options: {
    config?: Partial<ApiConfig>;
    operations?: RagService;
    registry?: ObservationStore;
    clock?: Clock;
    directory?: string;
  } = {},
) {
  const directory = options.directory ?? (await mkdtemp(join(tmpdir(), 'api-01-')));
  const timer = options.clock ?? clock;
  const registry = options.registry ?? new ObservationStore(directory, timer);
  let calls = 0;
  const operations: RagService = options.operations ?? {
    execute: () => {
      calls++;

      return Promise.reject(new GenerationError('PROVIDER_FAILED'));
    },
  };

  const server = Fastify({ bodyLimit: 1048576, logger: false });
  registerOperationRoutes(server, {
    config: { ...apiConfig, ...options.config },
    clock: timer,
    contracts,
    operations,
    registry,
    availableModes: modes,
  });
  t.after(async () => {
    await server.close();
    await registry.close();
    if (options.directory === undefined) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  return { server, registry, directory, calls: () => calls };
}

function post(
  server: FastifyInstance,
  input: Requests[Operation],
  operation: Operation = 'generate',
) {
  return server.inject({
    method: 'POST',
    url: paths[operation],
    headers: { ...headers, 'content-type': 'application/json' },
    payload: JSON.stringify(toHttpBody(input)),
  });
}

function assertCamelBody(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertCamelBody);

    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    assert.match(key, /^[a-z][a-zA-Z0-9]*$/, `Non-camelCase field on HTTP body: ${key}`);
    assertCamelBody(child);
  }
}

await test('API-01: empat operasi × tiga mode × EN/ID × N5/N4 memakai runner nyata dan replay tanpa attempt tambahan', async (t) => {
  for (const operation of Object.keys(paths) as Operation[]) {
    for (let fixtureIndex = 0; fixtureIndex < 4; fixtureIndex++) {
      await t.test(`${operation}/${fixtureIndex}`, async (child) => {
        let selectedMode: Mode = 'LLM_ONLY';
        const state = await setupAdaptive(child, {
          operation,
          fixtureIndex,
          points: (index, round) =>
            selectedMode === 'ADAPTIVE' && round === 2
              ? []
              : [
                  hit(index, 2, 0.8, {
                    skill_codes: ['synthetic_copula'],
                    jlpt_level: requestFor(operation, fixtureIndex).payload.context.targetLevel,
                  }),
                ],
        });
        const baseline = createBaselineRunner(state.generate, state.observations, clock);
        const service = new RagServiceImpl({
          LLM_ONLY: baseline,
          SINGLE_STAGE: state.run,
          ADAPTIVE: state.adaptive,
        });
        const { server } = await httpFixture(child, {
          operations: service,
          registry: state.observations,
          config: { corpusVersion: state.index.corpusVersion },
        });

        for (const mode of modes) {
          selectedMode = mode;
          const input = structuredClone(state.request);
          input.mode = mode;
          input.request_id = randomUUID();
          input.payload.metadata.requestId = input.request_id;

          const response = await post(server, input, operation);
          const body: unknown = response.json();

          assert.equal(response.statusCode, 200, response.body);
          assert.ok(httpContracts.responses[operation](body));
          assertCamelBody(body);
          assert.equal(body.mode, mode);
          assert.equal(body.requestId, input.request_id);
          assert.equal(body.meta.path, mode === 'ADAPTIVE' ? 'DEEP' : mode);
          assert.equal(
            body.meta.counters.retrievalStageCount,
            mode === 'LLM_ONLY' ? 0 : mode === 'ADAPTIVE' ? 2 : 1,
          );
          assert.equal(body.meta.cost.queryEmbeddingUsd, mode === 'LLM_ONLY' ? 0 : null);

          const before = await state.observations.inspect();
          const attempts = state.requests.generation.length + state.requests.embedding.length;

          const replay = await post(server, input, operation);

          assert.equal(replay.body, response.body);
          assert.equal(
            state.requests.generation.length + state.requests.embedding.length,
            attempts,
          );
          assert.deepEqual(await state.observations.inspect(), before);
        }

        assert.equal((await server.inject({ url: '/health/ready', headers })).statusCode, 200);
      });
    }
  }
});

await test('API-01: auth health/operasi, transport JSON, body limit dan error redaction', async (t) => {
  const { server, calls } = await httpFixture(t);

  for (const url of ['/health/live', '/health/ready', ...Object.values(paths)]) {
    const response = await server.inject({
      url,
      method: url.startsWith('/health') ? 'GET' : 'POST',
    });

    assert.equal(response.statusCode, 401);
    assert.ok(httpContracts.error(response.json()));
  }

  assert.equal((await server.inject({ url: '/health/live', headers })).statusCode, 200);
  assert.equal((await server.inject({ url: '/health/ready', headers })).statusCode, 503);

  for (const [payload, contentType, status, code] of [
    ['{"secret-note":', 'application/json', 400, 'INVALID_INPUT'],
    ['secret-note', 'text/plain', 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['<secret-note/>', 'application/xml', 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['x'.repeat(1048577), 'application/json', 413, 'PAYLOAD_TOO_LARGE'],
  ] as const) {
    const response = await server.inject({
      method: 'POST',
      url: paths.generate,
      headers: { ...headers, 'content-type': contentType },
      payload,
    });

    assert.equal(response.statusCode, status, response.body);
    assert.ok(httpContracts.error(response.json()));
    assert.equal(response.json<{ error: { code: string } }>().error.code, code);
    assert.doesNotMatch(response.body, /secret-note|api-fixture-token/);
  }

  assert.equal(calls(), 0);

  const disabled = await httpFixture(t, { config: { token: null } });

  assert.equal((await disabled.server.inject({ url: '/health/live', headers })).statusCode, 503);
});

await test('API-01: schema/refinement, korelasi, level, corpus, mode, deadline ditolak sebelum inference', async (t) => {
  const { server, calls, registry } = await httpFixture(t, {
    config: { allowedModes: ['LLM_ONLY'] },
  });
  const scenarios: readonly [string, (input: Requests['generate']) => void, number, string][] = [
    [
      'id mismatch',
      (input) => {
        input.payload.metadata.requestId = randomUUID();
      },
      400,
      'INVALID_INPUT',
    ],
    [
      'level',
      (input) => {
        input.payload.context.targetLevel = 'JLPT_N3';
      },
      422,
      'UNSUPPORTED_LEVEL',
    ],
    [
      'catalog',
      (input) => {
        input.payload.context.weakSkillCodes = ['missing-skill'];
      },
      400,
      'INVALID_INPUT',
    ],
    [
      'snapshot',
      (input) => {
        input.corpus_version = 'other-v1';
      },
      409,
      'SNAPSHOT_MISMATCH',
    ],
    [
      'mode',
      (input) => {
        input.mode = 'ADAPTIVE';
      },
      403,
      'FORBIDDEN',
    ],
    [
      'deadline',
      (input) => {
        input.deadline_at = '2026-11-25T09:00:00Z';
      },
      504,
      'TIMEOUT',
    ],
  ];

  for (const [name, mutate, status, code] of scenarios) {
    const input = requestFor('generate');
    mutate(input);

    const response = await post(server, input);

    assert.equal(response.statusCode, status, name + response.body);
    assert.ok(httpContracts.error(response.json()));
    assert.equal(response.json<{ error: { code: string } }>().error.code, code);
  }

  for (const payload of [
    { ...requestFor('generate'), extra: true },
    { ...requestFor('generate'), timeout_ms: '1000' },
  ]) {
    const response = await server.inject({
      method: 'POST',
      url: paths.generate,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify(toHttpBody(payload)),
    });

    assert.equal(response.statusCode, 400);
  }

  const mismatch = await server.inject({
    method: 'POST',
    url: paths.generate,
    headers: { ...headers, 'x-request-id': randomUUID(), 'content-type': 'application/json' },
    payload: JSON.stringify(toHttpBody(requestFor('generate'))),
  });

  assert.equal(mismatch.statusCode, 400);
  assert.equal(calls(), 0);
  assert.equal((await registry.inspect()).length, 0);
  assert.equal((await registry.rejected()).length, scenarios.length + 3);
});

await test('API-01: terminal failure direplay setelah restart/expiry, fingerprint konflik dan trace rusak tidak dieksekusi ulang', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'api-01-restart-'));
  const first = await httpFixture(t, { directory });
  const input = requestFor('generate');

  const response = await post(first.server, input);

  assert.equal(response.statusCode, 502);
  assert.ok(httpContracts.error(response.json()));

  const body = response.json<{ executionId: string; error: { code: string } }>();

  assert.equal(body.error.code, 'PROVIDER_FAILED');
  assert.equal(first.calls(), 1);

  await first.server.close();
  await first.registry.close();
  const restarted = await httpFixture(t, {
    directory,
    clock: { now: () => new Date('2026-11-26T10:00:00Z'), monotonicMs: () => performance.now() },
    config: { corpusVersion: null },
  });

  const replay = await post(restarted.server, input);

  assert.equal(replay.statusCode, 502);
  assert.equal(replay.body, response.body);
  assert.equal(restarted.calls(), 0);

  const changed = structuredClone(input);
  changed.timeout_ms--;
  const conflict = await post(restarted.server, changed);

  assert.equal(conflict.statusCode, 409);
  assert.equal(restarted.calls(), 0);

  const path = join(directory, 'events', `${body.executionId}.jsonl`);
  await writeFile(path, (await readFile(path, 'utf8')).slice(0, -1));
  const corrupted = await post(restarted.server, input);

  assert.equal(corrupted.statusCode, 409);
  assert.equal(restarted.calls(), 0);

  await restarted.server.close();
  await restarted.registry.close();
  await rm(directory, { recursive: true, force: true });
});

await test('API-01: in-flight duplicate 409, request lain 429, slot dilepas setelah gagal', async (t) => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const service: RagService = {
    execute: async () => {
      calls++;
      entered();
      await gate;

      throw new GenerationError('PROVIDER_FAILED');
    },
  };
  const { server } = await httpFixture(t, { operations: service, config: { maxConcurrent: 1 } });
  const input = requestFor('generate');
  const first = post(server, input);
  void first.then(() => undefined);
  await started;

  const duplicate = await post(server, input);
  const other = await post(server, requestFor('generate'));

  assert.equal(duplicate.statusCode, 409);
  assert.equal(other.statusCode, 429);
  assert.equal(calls, 1);

  release();

  assert.equal((await first).statusCode, 502);
  assert.equal((await post(server, requestFor('generate'))).statusCode, 502);
  assert.equal(calls, 2);
});

await test('API-01: batas deadline server membatalkan runner, terminal timeout direplay', async (t) => {
  let cancelled = false;
  const service: RagService = {
    execute: async (_mode, _operation, _input, _id, signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            cancelled = true;
            resolve();
          },
          { once: true },
        );
      });

      throw new GenerationError('TIMEOUT');
    },
  };
  const { server } = await httpFixture(t, { operations: service, config: { maxDeadlineMs: 100 } });
  const input = requestFor('generate');

  const response = await post(server, input);

  assert.equal(response.statusCode, 504);
  assert.equal(cancelled, true);
  assert.equal((await post(server, input)).body, response.body);
});

await test('API-01: admission lama/UNKNOWN dan terminal tanpa envelope tetap konflik setelah restart', async (t) => {
  const first = await httpFixture(t);
  const input = requestFor('generate');
  const admission = {
    serviceId: apiConfig.serviceId,
    requestId: input.request_id,
    mode: input.mode,
    operation: 'generate' as const,
    request: input,
  };
  const admitted = await first.registry.admit(admission);

  assert.ok(admitted.correlation.executionId);

  await first.registry.finish(admitted.correlation.executionId, 'FAILED', 'PROVIDER_FAILED');
  const legacy = await post(first.server, input);

  assert.equal(legacy.statusCode, 409);
  assert.equal(first.calls(), 0);
  assert.equal((await first.registry.inspect())[0]?.responseIntegrity, 'MISSING');

  const unknownInput = requestFor('generate');
  await first.registry.admit({
    ...admission,
    requestId: unknownInput.request_id,
    request: unknownInput,
  });
  await first.server.close();
  await first.registry.close();
  const restarted = await httpFixture(t, { directory: first.directory });

  const unknown = await post(restarted.server, unknownInput);

  assert.equal(unknown.statusCode, 409);
  assert.equal(restarted.calls(), 0);
  assert.equal((await restarted.registry.reconcile()).length, 1);
  assert.equal((await post(restarted.server, unknownInput)).statusCode, 409);

  await restarted.server.close();
  await restarted.registry.close();
});

await test('API-01: kegagalan persist envelope mempertahankan admission/terminal dan tidak mengulang call', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'api-01-response-fail-'));
  let calls = 0;
  const registry = new ObservationStore(directory, clock);
  const service: RagService = {
    execute: async () => {
      calls++;
      await rm(join(directory, 'responses'), { recursive: true });
      await writeFile(join(directory, 'responses'), 'blocked');

      throw new GenerationError('PROVIDER_FAILED');
    },
  };
  const { server } = await httpFixture(t, { registry, operations: service, directory });
  const input = requestFor('generate');

  const response = await post(server, input);
  const duplicate = await post(server, input);

  assert.equal(response.statusCode, 503);
  assert.equal(response.json<{ error: { code: string } }>().error.code, 'TRACE_WRITE_FAILED');
  assert.equal(duplicate.statusCode, 503);
  assert.equal(calls, 1);
  assert.equal((await registry.inspect())[0]?.responseIntegrity, 'INVALID');

  await server.close();
  await registry.close();
  await rm(directory, { recursive: true, force: true });
});

await test('API-01: trace sink gagal sebelum inference; admission UNKNOWN tetap memblokir duplicate', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'api-01-trace-fail-'));
  const registry = new ObservationStore(directory, clock, {
    sinkFactory: () => ({
      write: () => Promise.reject(new Error('secret-trace-error')),
      close: () => Promise.resolve(),
    }),
  });
  const { server, calls } = await httpFixture(t, { directory, registry });
  const input = requestFor('generate');

  const response = await post(server, input);
  const duplicate = await post(server, input);

  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body, /secret-trace-error/);
  assert.equal(duplicate.statusCode, 409);
  assert.equal(calls(), 0);
  assert.equal((await registry.inspect())[0]?.state, 'UNKNOWN');

  await server.close();
  await registry.close();
  await rm(directory, { recursive: true, force: true });
});

await test('API-01: disconnect HTTP nyata membatalkan signal dan hasil terminal tidak dijalankan ulang', async (t) => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let cancelled!: () => void;
  const stopped = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  const service: RagService = {
    execute: async (_mode, _operation, _input, _id, signal) => {
      entered();
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          'abort',
          () => {
            cancelled();
            resolve();
          },
          { once: true },
        ),
      );

      throw new GenerationError('TIMEOUT');
    },
  };
  const { server, registry } = await httpFixture(t, { operations: service });
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  const input = requestFor('generate');
  const request = httpRequest(new URL(paths.generate, origin), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
  });
  request.on('error', () => undefined);
  request.end(JSON.stringify(toHttpBody(input)));
  await started;

  request.destroy();
  await stopped;
  // Shutdown waits for the aborted handler to finish durable terminal/result writes.
  await server.close();

  const rows = await registry.inspect();

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.state, 'TERMINAL');
  assert.equal(rows[0]?.responseIntegrity, 'VALID');
});

await test('API-01: composition produksi merangkai baseline HTTP dan replay sukses setelah restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'api-01-composition-'));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;

    return Promise.resolve(providerResponse(outputFor('evaluate')));
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const app = createApplication(
    readConfig({
      LOG_LEVEL: 'silent',
      API_SERVICE_TOKEN: 'api-fixture-token-123',
      API_ALLOWED_MODES: 'LLM_ONLY',
      API_CORPUS_VERSION: 'synthetic-contract-v1',
      OBSERVATION_DIRECTORY: directory,
    }),
    clock,
    null,
    null,
    undefined,
    config(),
  );
  const input = requestFor('evaluate');
  const response = await post(app.server, input, 'evaluate');

  assert.equal(response.statusCode, 200, response.body);
  assert.ok(httpContracts.responses.evaluate(response.json()));
  assert.equal(calls, 1);

  const wire: unknown = response.json();

  assert.ok(httpContracts.responses.evaluate(wire));

  const persisted: unknown = JSON.parse(
    await readFile(join(directory, 'responses', `${wire.executionId}.json`), 'utf8'),
  );

  assert.ok(typeof persisted === 'object' && persisted !== null && 'response' in persisted);
  assert.ok(contracts.responses.evaluate(persisted.response));
  assert.equal(persisted.response.execution_id, wire.executionId);
  assert.deepEqual(toHttpBody(persisted.response), wire);
  assert.equal((await app.server.inject({ url: '/health/ready', headers })).statusCode, 200);

  await app.server.close();
  const restarted = await httpFixture(t, {
    directory,
    clock: { now: () => new Date('2026-11-26T10:00:00Z'), monotonicMs: () => performance.now() },
  });
  const replay = await post(restarted.server, input, 'evaluate');

  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body, response.body);
  assert.equal(restarted.calls(), 0);
  assert.equal(calls, 1);

  await restarted.server.close();
  await restarted.registry.close();
  const restricted = await httpFixture(t, {
    directory,
    config: { allowedModes: ['ADAPTIVE'] },
  });

  assert.equal((await post(restricted.server, input, 'evaluate')).statusCode, 403);
  assert.equal(restricted.calls(), 0);

  await restricted.server.close();
  await restricted.registry.close();
  await rm(directory, { recursive: true, force: true });
});

await test('API-01-CAMEL: semua operasi menolak snake_case dan alias campuran sebelum admission', async (t) => {
  const { server, calls, registry } = await httpFixture(t);

  for (const operation of Object.keys(paths) as Operation[]) {
    const internal = requestFor(operation);
    const camel = toHttpBody(internal);

    assert.ok(httpContracts.requests[operation](camel));

    for (const payload of [
      internal,
      { ...camel, request_id: internal.request_id },
      { ...camel, experiment: { experiment_id: 'research', caseId: 'case', repetition: 1 } },
    ]) {
      const response = await server.inject({
        method: 'POST',
        url: paths[operation],
        headers,
        payload,
      });
      const body: unknown = response.json();

      assert.equal(response.statusCode, 400);
      assert.ok(httpContracts.error(body));
      assert.equal(body.error.code, 'INVALID_INPUT');
      assertCamelBody(body);
    }
  }

  assert.equal(calls(), 0);
  assert.equal((await registry.inspect()).length, 0);
});

await test('API-01-CAMEL: DTO literal camelCase mempertahankan domain payload dan questionMix', async (t) => {
  const { server, calls } = await httpFixture(t);

  for (const operation of Object.keys(paths) as Operation[]) {
    const original = requestFor(operation);
    const request = {
      schemaVersion: '1',
      requestId: original.request_id,
      mode: original.mode,
      corpusVersion: original.corpus_version,
      timeoutMs: original.timeout_ms,
      deadlineAt: original.deadline_at,
      payload: {
        ...original.payload,
        ...(operation === 'generate'
          ? {
              questionMix: { weak: 0.6, reinforcement: 0.3, stretch: 0.1 },
            }
          : {}),
      },
      experiment: { experimentId: 'camel_test', caseId: `case_${operation}`, repetition: 1 },
    };
    const response = await server.inject({
      method: 'POST',
      url: paths[operation],
      headers,
      payload: request,
    });
    const body: unknown = response.json();

    assert.equal(response.statusCode, 502, response.body);
    assert.ok(httpContracts.error(body));
    assert.equal(body.requestId, request.requestId);
    assertCamelBody(body);
  }

  assert.equal(calls(), 4);
});
