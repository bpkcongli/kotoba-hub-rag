import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  admit,
  config,
  outputFor,
  providerResponse,
  requestFor,
  signal,
} from '@tests/generation-fixture';
import { dense, manifest, payload } from '@tests/retrieval-fixture';
import { skill, trace } from '@tests/single-stage-fixture';
import { EMBEDDING_CONFIG_ID } from '@/adapters/bge-configuration';
import { readHfConfig } from '@/adapters/hf-config';
import { createHfInference } from '@/adapters/hf-inference';
import { createOpenAiGenerator } from '@/adapters/openai-responses';
import { readContextConfig } from '@/context/config';
import { createContextBuilder } from '@/context/observed-builder';
import { createContractValidators } from '@/contracts/validator';
import { createOperationGenerator } from '@/generation/generator';
import { ObservationStore } from '@/observability/store';
import { createAdaptiveRunner } from '@/pipelines/adaptive';
import { readDeepPolicy } from '@/pipelines/deep-config';
import { readExecutionPolicy } from '@/pipelines/execution-policy';
import { createQueryRewriter } from '@/pipelines/rewrite';
import { readRouterPolicy } from '@/pipelines/router';
import { retrievalConfig } from '@/retrieval/config';
import { createQdrantRetriever } from '@/retrieval/qdrant-retriever';
import { createRetrievalStage } from '@/retrieval/stage';
import { parseIndexManifest } from '@/storage/index-manifest';
import { QdrantIndexStore } from '@/storage/qdrant-index';

const url = process.env.RAG01_QDRANT_URL;
const retries = process.env.ADP03_RETRY_FIXTURE === 'true';

assert.ok(url, 'Gunakan npm run test:adp02 untuk Qdrant sementara');
assert.equal(new URL(url).hostname, '127.0.0.1');

for (const empty of [false, true]) {
  await test(`${retries ? 'ADP-03 retries' : 'ADP-02'} ADAPTIVE DEEP Qdrant nyata: ${empty ? 'terminal insufficient evidence' : 'rewrite preserves scope, dedup/rerank/context/generation success'}`, async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), retries ? 'adp03-integration-' : 'adp02-integration-'),
    );
    const observations = new ObservationStore(directory);
    const index = parseIndexManifest({
      ...manifest(),
      embeddingConfigId: EMBEDDING_CONFIG_ID,
      embeddingModelRevision: null,
      tokenizerRevision: null,
      processingRevision: null,
    });
    const connection = { url, timeoutMs: 5000 };
    const store = new QdrantIndexStore(connection);
    const client = new QdrantClient({ ...connection, checkCompatibility: false });

    await store.prepare(index);
    t.after(async () => {
      await store.remove(index);
    });
    await client.upsert(index.physicalCollection, {
      wait: true,
      points: [
        { skill_codes: [empty ? 'foreign' : skill] },
        { skill_codes: [skill], published: false },
        { skill_codes: [skill], jlpt_level: 'JLPT_N4' },
        { skill_codes: ['foreign'] },
      ].map((overrides, i) => ({
        id: i + 1,
        vector: { dense: dense() },
        payload: payload(index, i + 1, overrides),
      })),
    });

    let embeddingCalls = 0;
    let generationCalls = 0;
    const hfConfig = readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-token' });

    assert.ok(hfConfig);

    const hf = createHfInference(hfConfig, {
      fetch: (url) => {
        if (typeof url === 'string' && url.includes('bge-reranker')) {
          return Promise.resolve(Response.json([[{ label: 'LABEL_0', score: -2 }]]));
        }

        embeddingCalls++;

        if (retries && embeddingCalls === 1) {
          return Promise.resolve(Response.json({}, { status: 429 }));
        }

        return Promise.resolve(Response.json([dense()]));
      },
      onAttempt: (attempt) => observations.recordHfAttempt(attempt),
    });
    const settings = config();
    const generator = createOpenAiGenerator(settings, {
      fetch: (_url, init) => {
        const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');

        if (
          typeof body === 'object' &&
          body !== null &&
          'text' in body &&
          (body as { text: { format: { name: string } } }).text.format.name ===
            'RefinedRetrievalQuery'
        ) {
          return Promise.resolve(providerResponse({ query: 'N2 foreign syllabus request' }));
        }

        generationCalls++;

        if (retries && generationCalls === 1) {
          return Promise.resolve(Response.json({}, { status: 503 }));
        }

        if (retries && generationCalls === 2) {
          return Promise.resolve(providerResponse({}));
        }

        return Promise.resolve(providerResponse(outputFor('generate')));
      },
      onAttempt: (attempt) => observations.recordGenerationAttempt(attempt),
    });

    const retriever = createQdrantRetriever(retrievalConfig(index), connection);
    const retrieve = createRetrievalStage(
      retrievalConfig(index),
      {
        profile: 'DENSE',
        configId: EMBEDDING_CONFIG_ID,
        modelRevision: null,
        tokenizerRevision: null,
        processingRevision: null,
        sparseCapabilityVerified: false,
        sparseTokenMappingId: null,
      },
      hf.embedding,
      retriever,
      observations,
    );

    const build = createContextBuilder(readContextConfig({}, settings), settings, observations);
    const run = createAdaptiveRunner(
      index,
      retrieve,
      build,
      createOperationGenerator(generator, settings),
      createQueryRewriter(generator),
      hf.reranker,
      observations,
      undefined,
      readRouterPolicy({ ADAPTIVE_MIN_UNIQUE_CANDIDATES: '2' }),
      readDeepPolicy({ ADAPTIVE_REWRITE_ENABLED: 'true' }),
      undefined,
      retries
        ? readExecutionPolicy({
            PIPELINE_MAX_PROVIDER_RETRIES: '2',
            PIPELINE_MAX_SCHEMA_RETRIES: '1',
            PIPELINE_MAX_TOTAL_RETRIES: '3',
            PIPELINE_BACKOFF_BASE_MS: '0',
            PIPELINE_BACKOFF_MAX_MS: '0',
          })
        : readExecutionPolicy(),
    );
    t.after(async () => {
      hf.close();
      generator.close();
      retriever.close();
      await observations.close();
      await rm(directory, { recursive: true, force: true });
    });

    const request = requestFor('generate');
    request.mode = 'ADAPTIVE';
    request.corpus_version = index.corpusVersion;
    request.deadline_at = new Date(Date.now() + 30000).toISOString();
    const id = await admit(observations, 'generate', request);

    if (empty) {
      await assert.rejects(run('generate', request, id, signal), { code: 'INSUFFICIENT_EVIDENCE' });
    } else {
      const response = await run('generate', request, id, signal);
      assert.ok(createContractValidators().responses.generate(response));
      assert.deepEqual(response.meta.sources, [{ source_id: 'source-1', chunk_id: 'chunk-1' }]);
      assert.equal(response.meta.path, 'DEEP');
      assert.equal(response.meta.counters.model_call_count, retries ? 8 : 5);
      assert.equal(response.meta.counters.rewrite_call_count, 1);
      assert.equal(response.meta.counters.rerank_call_count, 1);
      assert.equal(response.meta.counters.provider_retry_count, retries ? 2 : 0);
      assert.equal(response.meta.counters.schema_retry_count, retries ? 1 : 0);
      assert.equal(response.meta.usage.total_tokens, retries ? null : 280);
    }

    assert.equal(embeddingCalls, retries ? 3 : 2);
    assert.equal(generationCalls, empty ? 0 : retries ? 3 : 1);

    const events = await trace(directory, id);
    const retrieval = events.filter((event) => event.data.kind === 'retrieval_completed');

    assert.equal(retrieval.length, 2);
    assert.ok(retrieval[0]?.data.kind === 'retrieval_completed');
    assert.equal(retrieval[0].data.candidates.length, empty ? 0 : 1);
    assert.equal(retrieval[0].data.stage, 1);

    const terminal = events.at(-1);

    assert.ok(terminal?.data.kind === 'terminal');
    assert.equal(terminal.data.outcome, empty ? 'FAILED' : 'SUCCESS');
    assert.equal((await observations.inspect())[0]?.traceIntegrity, 'VALID');

    assert.ok(retrieval[1]?.data.kind === 'retrieval_completed');
    assert.deepEqual(retrieval[0].data.scope, retrieval[1].data.scope);
    assert.equal(retrieval[1].data.stage, 2);
    assert.notEqual(retrieval[0].data.queryHash, retrieval[1].data.queryHash);

    const path = events.find((row) => row.data.kind === 'adaptive_path_completed');

    assert.ok(path?.data.kind === 'adaptive_path_completed');
    assert.equal(path.data.finalPath, 'DEEP');
    assert.equal(path.data.rewriteCallCount, 1);
    assert.equal(path.data.retrievalStageCount, 2);
    assert.equal(path.data.rerankCallCount, empty ? 0 : 1);
    assert.equal(path.data.version, 'adp-03-v1');
    assert.equal(path.data.providerRetryCount, retries ? (empty ? 1 : 2) : 0);
    assert.equal(path.data.schemaRetryCount, retries && !empty ? 1 : 0);
    assert.equal(
      events.filter((event) => event.data.kind === 'retry_scheduled').length,
      retries ? (empty ? 1 : 3) : 0,
    );

    const reranked = events.find((row) => row.data.kind === 'deep_reranked');

    assert.ok(reranked?.data.kind === 'deep_reranked');
    assert.deepEqual(reranked.data.poolIds, empty ? [] : ['chunk-1']);
    assert.equal(JSON.stringify(events).includes('N2 foreign syllabus request'), false);
  });
}
