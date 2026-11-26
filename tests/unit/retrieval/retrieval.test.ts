import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  dense,
  context,
  hit,
  manifest,
  scope,
  settings,
  transport,
} from '@tests/__fixtures__/retrieval-fixture';
import { EMBEDDING_CONFIG_ID } from '@/adapters/bge-configuration';
import { readHfConfig } from '@/adapters/hf-config';
import { createHfInference } from '@/adapters/hf-inference';
import { parseTraceEvent } from '@/observability/events';
import { ObservationStore } from '@/observability/store';
import { readRetrievalConfig, retrievalConfig } from '@/retrieval/config';
import { createQdrantRetriever } from '@/retrieval/qdrant-retriever';
import { createRetrievalStage } from '@/retrieval/stage';

await test('retrieval config opt-in, pinned manifest, bounds dan embedding ID sama DATA-03', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'rag01-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const index = manifest();
  await writeFile(join(directory, 'index.json'), JSON.stringify(index));

  assert.equal(await readRetrievalConfig({}), null);

  const read = await readRetrievalConfig({
    RETRIEVAL_ENABLED: 'true',
    RETRIEVAL_INDEX_MANIFEST: join(directory, 'index.json'),
  });

  assert.equal(read?.index.physicalCollection, index.physicalCollection);
  for (const values of [
    { RETRIEVAL_LIMIT: '33' },
    { RETRIEVAL_CANDIDATE_LIMIT: '1', RETRIEVAL_LIMIT: '2' },
    { RETRIEVAL_TIMEOUT_MS: '0' },
    { RETRIEVAL_MAX_CONCURRENCY: '0' },
  ]) {
    assert.throws(() => retrievalConfig(index, values));
  }
  await assert.rejects(readRetrievalConfig({ RETRIEVAL_ENABLED: 'yes' }));

  const actual: unknown = JSON.parse(
    await readFile('research/indexing/data-03-v1/index-manifest.json', 'utf8'),
  );

  assert.ok(typeof actual === 'object' && actual !== null && 'embeddingConfigId' in actual);
  assert.equal(EMBEDDING_CONFIG_ID, actual.embeddingConfigId);
});

await test('dense search memakai hard filter, raw rank/score dan tidak mengaktifkan sparse dari output', async (t) => {
  const config = settings();
  const requests: unknown[] = [];
  const retriever = createQdrantRetriever(
    config,
    { url: 'http://127.0.0.1:6333', timeoutMs: 5000 },
    {
      fetch: transport(
        config.index,
        () =>
          Response.json({
            result: { points: [hit(config.index, 1, 0.8), hit(config.index, 2, -0.1)] },
          }),
        requests,
      ),
    },
  );
  t.after(() => retriever.close());

  const result = await retriever.retrieve(
    { dense: dense(), sparse: { indices: [42], values: [1] } },
    scope,
    1,
    context(),
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.score, 0.8);
  assert.equal(result.dense[1]?.score, -0.1);
  assert.equal(result.sparse, null);
  assert.deepEqual(requests, [
    {
      query: dense(),
      using: 'dense',
      filter: {
        must: [
          { key: 'published', match: { value: true } },
          { key: 'corpus_version', match: { value: scope.corpusVersion } },
          { key: 'jlpt_level', match: { value: 'JLPT_N5' } },
          { key: 'skill_codes', match: { any: ['grammar-ni'] } },
          { key: 'embedding_config_id', match: { value: config.index.embeddingConfigId } },
        ],
      },
      limit: 20,
      with_payload: true,
      with_vector: false,
      params: { hnsw_ef: 128, exact: false },
    },
  ]);
});

await test('HYBRID membutuhkan sparse, menggunakan dua cabang terfilter dan fixed RRF, tanpa downgrade', async (t) => {
  const config = settings('HYBRID', { RETRIEVAL_CANDIDATE_LIMIT: '2', RETRIEVAL_LIMIT: '2' });
  const requests: unknown[] = [];
  const retriever = createQdrantRetriever(
    config,
    { url: 'http://127.0.0.1:6333', timeoutMs: 5000 },
    {
      fetch: transport(
        config.index,
        (_body, path) => {
          assert.ok(path.endsWith('/batch'));
          return Response.json({
            result: [
              { points: [hit(config.index, 1, 0.8), hit(config.index, 2, 0.6)] },
              { points: [hit(config.index, 2, 20), hit(config.index, 3, 10)] },
            ],
          });
        },
        requests,
      ),
    },
  );
  t.after(() => retriever.close());

  await assert.rejects(retriever.retrieve({ dense: dense() }, scope, 2, context()), {
    code: 'INVALID_INPUT',
  });
  assert.equal(requests.length, 0);

  const result = await retriever.retrieve(
    { dense: dense(), sparse: { indices: [42], values: [1] } },
    scope,
    2,
    context(),
  );

  assert.equal(requests.length, 1);
  assert.equal(result.candidates[0]?.pointId, '2');
  assert.equal(result.candidates[0]?.score, 1 / 61 + 1 / 60);
  assert.equal(result.candidates[0]?.scoreType, 'rrf_k60_zero_based');
  assert.equal(result.dense[0]?.score, 0.8);
  assert.equal(result.sparse?.[0]?.score, 20);
});

await test('malformed/mismatched payload, checksum, order, duplicated chunks, nonfinite score ditolak', async (t) => {
  const config = settings();
  const bad = [
    [hit(config.index, 1, 1, { corpus_version: 'foreign' })],
    [hit(config.index, 1, 1, { published: false })],
    [hit(config.index, 1, 1, { jlpt_level: 'JLPT_N4' })],
    [hit(config.index, 1, 1, { skill_codes: ['foreign'] })],
    [hit(config.index, 1, 1, { embedding_config_id: 'foreign' })],
    [hit(config.index, 1, 1, { embedding_revision: 'foreign' })],
    [hit(config.index, 1, 1, { text: 'changed' })],
    [hit(config.index, 1, 1, { ground_truth: 'secret' })],
    [hit(config.index, 1, 1), hit(config.index, 1, 0.5)],
    [hit(config.index, 1, 0.1), hit(config.index, 2, 1)],
    [hit(config.index, 1, NaN)],
  ];
  for (const points of bad) {
    const retriever = createQdrantRetriever(
      config,
      { url: 'http://127.0.0.1:6333', timeoutMs: 5000 },
      { fetch: transport(config.index, () => Response.json({ result: { points } })) },
    );
    t.after(() => retriever.close());

    await assert.rejects(retriever.retrieve({ dense: dense() }, scope, 2, context()), {
      code: 'INVALID_RESPONSE',
    });
  }
});

await test('empty result tetap kosong; invalid filter/vector tidak dikirim ke Qdrant', async (t) => {
  const config = settings();
  let calls = 0;
  const retriever = createQdrantRetriever(
    config,
    { url: 'http://127.0.0.1:6333', timeoutMs: 5000 },
    {
      fetch: transport(config.index, () => {
        calls++;
        return Response.json({ result: { points: [] } });
      }),
    },
  );
  t.after(() => retriever.close());

  assert.deepEqual(
    (await retriever.retrieve({ dense: dense() }, scope, 5, context())).candidates,
    [],
  );
  await assert.rejects(retriever.retrieve({ dense: [] }, scope, 5, context()), {
    code: 'INVALID_INPUT',
  });
  await assert.rejects(
    retriever.retrieve({ dense: dense() }, { ...scope, skillCodes: [] }, 5, context()),
    { code: 'INVALID_INPUT' },
  );

  assert.equal(calls, 1);
});

await test('JA/EN/ID dan dua mode memakai stage/query provider sama, trace skor mentah tanpa raw query', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'rag01-stage-'));
  const observations = new ObservationStore(directory);
  const config = settings();
  const hfConfig = readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'private-hf-key' });

  assert.ok(hfConfig);

  const queries: string[] = [];
  const hf = createHfInference(hfConfig, {
    fetch: (_url, init) => {
      assert.equal(typeof init?.body, 'string');

      const body: unknown = JSON.parse(init?.body as string);

      assert.ok(
        typeof body === 'object' && body !== null && 'inputs' in body && Array.isArray(body.inputs),
      );

      queries.push(...body.inputs.filter((value): value is string => typeof value === 'string'));

      return Promise.resolve(Response.json([dense()]));
    },
    onAttempt: (attempt) => observations.recordHfAttempt(attempt),
  });
  const retriever = createQdrantRetriever(
    config,
    { url: 'http://127.0.0.1:6333', timeoutMs: 5000 },
    {
      fetch: transport(config.index, () =>
        Response.json({ result: { points: [hit(config.index)] } }),
      ),
    },
  );
  const index = config.index;
  const binding = {
    profile: index.retrievalProfile,
    configId: index.embeddingConfigId,
    modelRevision: index.embeddingModelRevision,
    tokenizerRevision: index.tokenizerRevision,
    processingRevision: index.processingRevision,
    sparseCapabilityVerified: false,
    sparseTokenMappingId: null,
  };
  const stage = createRetrievalStage(config, binding, hf.embedding, retriever, observations);
  t.after(async () => {
    hf.close();
    retriever.close();
    await observations.close();
    await rm(directory, { recursive: true, force: true });
  });
  const source = ['七時に起きます。', 'I get up at seven.', 'Saya bangun pukul tujuh.'];
  const outputs: unknown[] = [];

  for (const mode of ['SINGLE_STAGE', 'ADAPTIVE'] as const) {
    for (const query of source) {
      const request = context();
      const admission = await observations.admit({
        serviceId: 'fixture',
        requestId: request.executionId,
        mode,
        operation: 'generate',
        request: {},
      });

      assert.ok(admission.correlation.executionId);

      request.executionId = admission.correlation.executionId;

      const result = await stage(query, scope, 1, request);
      outputs.push({ candidates: result.candidates, dense: result.dense, sparse: result.sparse });
      await observations.finish(request.executionId, 'SUCCESS', null);

      const text = await readFile(
        join(directory, 'events', `${request.executionId}.jsonl`),
        'utf8',
      );
      const events = text
        .trim()
        .split('\n')
        .map((line) => parseTraceEvent(JSON.parse(line)));
      const retrieval = events.find((event) => event.data.kind === 'retrieval_completed');

      assert.ok(retrieval?.data.kind === 'retrieval_completed');
      assert.deepEqual(result.trace, retrieval.data);
      assert.equal(retrieval.data.stage, 1);
      assert.equal(retrieval.data.sparse, null);
      assert.equal(retrieval.data.dense[0]?.scoreType, 'cosine');
      assert.equal(text.includes(query), false);
      assert.equal(text.includes('private-hf-key'), false);
    }
  }

  assert.deepEqual(queries, [...source, ...source]);
  assert.ok(outputs.every((output) => JSON.stringify(output) === JSON.stringify(outputs[0])));

  const accounting = await observations.exportAccounting();

  assert.equal(accounting.input.calls.length, 6);
  assert.ok(
    accounting.input.calls.every(
      (call) =>
        call.accounting.purpose === 'query' &&
        call.accounting.phase === 'ONLINE' &&
        call.accounting.cost.kind === 'PER_CALL' &&
        call.accounting.cost.totalUsd === null,
    ),
  );
  assert.throws(
    () =>
      createRetrievalStage(
        config,
        { ...binding, configId: 'different' },
        hf.embedding,
        retriever,
        observations,
      ),
    { code: 'INCOMPATIBLE_INDEX' },
  );
});

await test('timeout dan close membatalkan transport; slot tetap ditahan bila fetch mengabaikan abort', async (t) => {
  const config = settings('DENSE', { RETRIEVAL_TIMEOUT_MS: '15' });
  let settle: (response: Response) => void = () => undefined;
  let fetchSignal: AbortSignal | null = null;
  const retriever = createQdrantRetriever(
    config,
    { url: 'http://127.0.0.1:6333', timeoutMs: 5000 },
    {
      fetch: (_url, init) => {
        fetchSignal = init?.signal ?? null;
        return new Promise<Response>((resolve) => {
          settle = resolve;
        });
      },
    },
  );
  t.after(() => retriever.close());

  await assert.rejects(retriever.retrieve({ dense: dense() }, scope, 5, context()), {
    code: 'TIMEOUT',
  });
  assert.equal((fetchSignal as AbortSignal | null)?.aborted, true);
  await assert.rejects(retriever.retrieve({ dense: dense() }, scope, 5, context()), {
    code: 'CAPACITY_LIMIT',
  });

  settle(Response.json({ version: '1.20.2' }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  retriever.close();

  await assert.rejects(retriever.retrieve({ dense: dense() }, scope, 5, context()), {
    code: 'TIMEOUT',
  });
});

await test('Qdrant 429/5xx, JSON rusak, body timeout dan oversized gagal eksplisit tanpa retry', async (t) => {
  for (const response of [
    () => new Response('{}', { status: 429 }),
    () => new Response('{}', { status: 503 }),
    () => new Response('{'),
    () => new Response('x'.repeat(10000)),
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'));
          },
        }),
      ),
  ]) {
    let calls = 0;
    const retriever = createQdrantRetriever(
      settings('DENSE', { RETRIEVAL_TIMEOUT_MS: '20', RETRIEVAL_MAX_RESPONSE_BYTES: '1000' }),
      { url: 'http://127.0.0.1:6333', timeoutMs: 5000 },
      {
        fetch: () => {
          calls++;
          return Promise.resolve(response());
        },
      },
    );
    t.after(() => retriever.close());

    await assert.rejects(retriever.retrieve({ dense: dense() }, scope, 5, context()));
    assert.equal(calls, 1);
  }
});

await test('query tidak dikirim saat mode LLM_ONLY; embedding/search failure tetap direkam tanpa fallback', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'rag01-failure-'));
  const observations = new ObservationStore(directory);
  t.after(async () => {
    await observations.close();
    await rm(directory, { recursive: true, force: true });
  });
  const config = settings();
  const index = config.index;
  const binding = {
    profile: index.retrievalProfile,
    configId: index.embeddingConfigId,
    modelRevision: index.embeddingModelRevision,
    tokenizerRevision: index.tokenizerRevision,
    processingRevision: index.processingRevision,
    sparseCapabilityVerified: false,
    sparseTokenMappingId: null,
  };
  let embeds = 0;
  let searches = 0;
  const embedding = {
    embed: () => {
      embeds++;
      return Promise.reject(new Error('private-provider-detail'));
    },
  };
  const retriever = {
    retrieve: () => {
      searches++;
      return Promise.reject(new Error('private-query-detail'));
    },
  };
  const run = createRetrievalStage(config, binding, embedding, retriever, observations);
  const llm = await observations.admit({
    serviceId: 'fixture',
    requestId: context().executionId,
    operation: 'generate',
    mode: 'LLM_ONLY',
    request: {},
  });

  assert.ok(llm.correlation.executionId);

  await assert.rejects(
    run('secret query', scope, 1, { ...context(), executionId: llm.correlation.executionId }),
    { code: 'INVALID_INPUT' },
  );

  assert.equal(embeds, 0);
  assert.equal(searches, 0);

  await observations.finish(llm.correlation.executionId, 'FAILED', 'INVALID_INPUT');
  const next = await observations.admit({
    serviceId: 'fixture',
    requestId: context().executionId,
    operation: 'generate',
    mode: 'ADAPTIVE',
    request: {},
  });

  assert.ok(next.correlation.executionId);

  await assert.rejects(
    run('secret query', scope, 1, { ...context(), executionId: next.correlation.executionId }),
    { code: 'DEPENDENCY_ERROR' },
  );

  await observations.finish(next.correlation.executionId, 'FAILED', 'INFERENCE_FAILED');

  const text = await readFile(
    join(directory, 'events', `${next.correlation.executionId}.jsonl`),
    'utf8',
  );
  const events = text
    .trim()
    .split('\n')
    .map((line) => parseTraceEvent(JSON.parse(line)));
  const retrieval = events.find((event) => event.data.kind === 'retrieval_completed');

  assert.ok(retrieval?.data.kind === 'retrieval_completed');
  assert.equal(retrieval.data.outcome, 'FAILED');
  assert.equal(retrieval.data.code, 'INFERENCE_FAILED');
  assert.equal(text.includes('secret query'), false);
  assert.equal(text.includes('private-provider-detail'), false);
  assert.equal(searches, 0);
});

await test('HYBRID menolak chunk ganda lintas point serta metadata yang berubah antar cabang', async (t) => {
  const config = settings('HYBRID');
  for (const sparseHit of [
    hit(config.index, 2, 1, { chunk_id: 'chunk-1' }),
    hit(config.index, 1, 1, { source_id: 'other-source' }),
  ]) {
    const retriever = createQdrantRetriever(
      config,
      { url: 'http://127.0.0.1:6333', timeoutMs: 5000 },
      {
        fetch: transport(config.index, () =>
          Response.json({
            result: [{ points: [hit(config.index, 1, 0.8)] }, { points: [sparseHit] }],
          }),
        ),
      },
    );
    t.after(() => retriever.close());

    await assert.rejects(
      retriever.retrieve(
        { dense: dense(), sparse: { indices: [42], values: [1] } },
        scope,
        5,
        context(),
      ),
      { code: 'INVALID_RESPONSE' },
    );
  }
});

await test('HYBRID dua cabang dihitung satu event per round; stage 1/2 mempertahankan profile/configuration', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'rag01-hybrid-stage-'));
  const observations = new ObservationStore(directory);
  const config = settings('HYBRID');
  const index = config.index;
  const binding = {
    profile: index.retrievalProfile,
    configId: index.embeddingConfigId,
    modelRevision: index.embeddingModelRevision,
    tokenizerRevision: index.tokenizerRevision,
    processingRevision: index.processingRevision,
    sparseCapabilityVerified: true,
    sparseTokenMappingId: index.sparseTokenMappingId,
  };
  const retriever = createQdrantRetriever(
    config,
    { url: 'http://127.0.0.1:6333', timeoutMs: 5000 },
    {
      fetch: transport(index, () =>
        Response.json({
          result: [{ points: [hit(index, 1, 0.8)] }, { points: [hit(index, 1, 15)] }],
        }),
      ),
    },
  );
  const run = createRetrievalStage(
    config,
    binding,
    { embed: () => Promise.resolve([{ dense: dense(), sparse: { indices: [42], values: [1] } }]) },
    retriever,
    observations,
  );
  t.after(async () => {
    retriever.close();
    await observations.close();
    await rm(directory, { recursive: true, force: true });
  });
  const admission = await observations.admit({
    serviceId: 'fixture',
    requestId: context().executionId,
    operation: 'generate',
    mode: 'ADAPTIVE',
    request: {},
  });

  assert.ok(admission.correlation.executionId);

  const call = { ...context(), executionId: admission.correlation.executionId };

  await run('query one', scope, 1, call);
  await run('query two', scope, 2, call);
  await observations.finish(call.executionId, 'SUCCESS', null);

  const events = (await readFile(join(directory, 'events', `${call.executionId}.jsonl`), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => parseTraceEvent(JSON.parse(line)));
  const retrievals = events.filter((event) => event.data.kind === 'retrieval_completed');

  assert.equal(retrievals.length, 2);
  assert.ok(retrievals[0]?.data.kind === 'retrieval_completed');
  assert.ok(retrievals[1]?.data.kind === 'retrieval_completed');

  const first = retrievals[0].data;

  assert.equal(first.stage, 1);
  assert.equal(retrievals[1].data.stage, 2);
  assert.equal(first.configurationHash, retrievals[1].data.configurationHash);
  assert.equal(first.profile, 'HYBRID');
  assert.equal(first.dense[0]?.score, 0.8);
  assert.equal(first.sparse?.[0]?.score, 15);
  assert.equal(first.candidates[0]?.score, 2 / 60);
  assert.throws(() => parseTraceEvent({ ...retrievals[0], data: { ...first, confidence: 0.9 } }));
  assert.throws(() => parseTraceEvent({ ...retrievals[0], data: { ...first, sparse: null } }));
});

await test('embedding 429 dan Qdrant failure mempertahankan satu attempt ONLINE dengan unknown cost', async (t) => {
  for (const failEmbedding of [true, false]) {
    const directory = await mkdtemp(join(tmpdir(), 'rag01-accounting-'));
    const observations = new ObservationStore(directory);
    const config = settings();
    const index = config.index;
    let embeddingCalls = 0;
    let searchCalls = 0;
    const hfConfig = readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-token' });

    assert.ok(hfConfig);

    const hf = createHfInference(hfConfig, {
      fetch: () => {
        embeddingCalls++;
        return Promise.resolve(
          failEmbedding ? new Response('{}', { status: 429 }) : Response.json([dense()]),
        );
      },
      onAttempt: (attempt) => observations.recordHfAttempt(attempt),
    });
    const retriever = createQdrantRetriever(
      config,
      { url: 'http://127.0.0.1:6333', timeoutMs: 5000 },
      {
        fetch: () => {
          searchCalls++;
          return Promise.resolve(new Response('{}', { status: 503 }));
        },
      },
    );
    const run = createRetrievalStage(
      config,
      {
        profile: 'DENSE',
        configId: index.embeddingConfigId,
        modelRevision: index.embeddingModelRevision,
        tokenizerRevision: index.tokenizerRevision,
        processingRevision: index.processingRevision,
        sparseCapabilityVerified: false,
        sparseTokenMappingId: null,
      },
      hf.embedding,
      retriever,
      observations,
    );
    t.after(async () => {
      hf.close();
      retriever.close();
      await observations.close();
      await rm(directory, { recursive: true, force: true });
    });
    const admission = await observations.admit({
      serviceId: 'fixture',
      requestId: context().executionId,
      operation: 'generate',
      mode: 'SINGLE_STAGE',
      request: {},
    });

    assert.ok(admission.correlation.executionId);

    const executionId = admission.correlation.executionId;

    await assert.rejects(run('synthetic query', scope, 1, { ...context(), executionId }), {
      code: failEmbedding ? 'RATE_LIMITED' : 'DEPENDENCY_ERROR',
    });

    await observations.finish(
      executionId,
      'FAILED',
      failEmbedding ? 'INFERENCE_FAILED' : 'RETRIEVAL_FAILED',
    );

    assert.equal(embeddingCalls, 1);
    assert.equal(searchCalls, failEmbedding ? 0 : 1);

    const accounting = await observations.exportAccounting();

    assert.equal(accounting.input.calls.length, 1);

    const call = accounting.input.calls[0]?.accounting;

    assert.equal(call?.purpose, 'query');
    assert.equal(call?.phase, 'ONLINE');
    assert.equal(call?.retryKind, 'INITIAL');
    assert.equal(call?.usage, null);
    assert.equal(call?.cost.kind === 'PER_CALL' ? call.cost.totalUsd : 'not-per-call', null);

    const events = (await readFile(join(directory, 'events', `${executionId}.jsonl`), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => parseTraceEvent(JSON.parse(line)));
    const retrieval = events.find((event) => event.data.kind === 'retrieval_completed');

    assert.ok(retrieval?.data.kind === 'retrieval_completed');
    assert.equal(retrieval.data.code, failEmbedding ? 'INFERENCE_FAILED' : 'RETRIEVAL_FAILED');
  }
});
