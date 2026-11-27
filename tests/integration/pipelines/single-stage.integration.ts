import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
} from '@tests/__fixtures__/generation-fixture';
import { dense, manifest, payload } from '@tests/__fixtures__/retrieval-fixture';
import { skill, trace } from '@tests/__fixtures__/single-stage-fixture';
import { ObservationStore } from '@/bootstrap/observation-store';
import { EMBEDDING_CONFIG_ID } from '@/modules/knowledge/application/embedding-configuration';
import { parseIndexManifest } from '@/modules/knowledge/application/index-manifest';
import { QdrantIndexStore } from '@/modules/knowledge/interface/secondary/qdrant/qdrant-index';
import { createContextBuilder } from '@/modules/rag/application/context/observed-builder';
import { createOperationGenerator } from '@/modules/rag/application/generation/generator';
import { createAdaptiveInitialStage } from '@/modules/rag/application/pipelines/adaptive-initial';
import { createSingleStageRunner } from '@/modules/rag/application/pipelines/single-stage';
import { createRetrievalStage } from '@/modules/rag/application/retrieval/stage';
import { createContractValidators } from '@/modules/rag/application/validation';
import { readContextConfig } from '@/modules/rag/infrastructure/config/context';
import { readHfConfig } from '@/modules/rag/infrastructure/config/hf-config';
import { retrievalConfig } from '@/modules/rag/infrastructure/config/retrieval';
import { createHfInference } from '@/modules/rag/interface/secondary/inference/hf-inference';
import { createOpenAiGenerator } from '@/modules/rag/interface/secondary/inference/openai-responses';
import { createQdrantRetriever } from '@/modules/rag/interface/secondary/qdrant/retriever';

const url = process.env.RAG01_QDRANT_URL;

assert.ok(url, 'Gunakan npm run test:rag03 untuk Qdrant sementara');
assert.equal(new URL(url).hostname, '127.0.0.1');

for (const empty of [false, true]) {
  await test(`SINGLE_STAGE/ADAPTIVE initial Qdrant nyata: ${empty ? 'empty evidence gagal baseline, route DEEP adaptive' : 'filtered retrieval/context parity, route FAST adaptive'}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'rag03-integration-'));
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
      fetch: () => {
        embeddingCalls++;

        return Promise.resolve(Response.json([dense()]));
      },
      onAttempt: (attempt) => observations.recordHfAttempt(attempt),
    });
    const settings = config();
    const generator = createOpenAiGenerator(settings, {
      fetch: () => {
        generationCalls++;
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
    const run = createSingleStageRunner(
      index,
      retrieve,
      build,
      createOperationGenerator(generator, settings),
      observations,
    );
    t.after(async () => {
      hf.close();
      generator.close();
      retriever.close();
      await observations.close();
      await rm(directory, { recursive: true, force: true });
    });

    const request = requestFor('generate');
    request.mode = 'SINGLE_STAGE';
    request.corpus_version = index.corpusVersion;
    request.deadline_at = new Date(Date.now() + 30000).toISOString();
    const id = await admit(observations, 'generate', request);

    if (empty) {
      await assert.rejects(run('generate', request, id, signal), { code: 'INSUFFICIENT_EVIDENCE' });
    } else {
      const response = await run('generate', request, id, signal);
      assert.ok(createContractValidators().responses.generate(response));
      assert.deepEqual(response.meta.sources, [{ source_id: 'source-1', chunk_id: 'chunk-1' }]);
      assert.equal(response.meta.counters.model_call_count, 2);
    }

    assert.equal(embeddingCalls, 1);
    assert.equal(generationCalls, empty ? 0 : 1);

    const events = await trace(directory, id);
    const retrieval = events.filter((event) => event.data.kind === 'retrieval_completed');

    assert.equal(retrieval.length, 1);
    assert.ok(retrieval[0]?.data.kind === 'retrieval_completed');
    assert.equal(retrieval[0].data.candidates.length, empty ? 0 : 1);
    assert.equal(retrieval[0].data.stage, 1);

    const terminal = events.at(-1);

    assert.ok(terminal?.data.kind === 'terminal');
    assert.equal(terminal.data.outcome, empty ? 'FAILED' : 'SUCCESS');
    assert.equal((await observations.inspect())[0]?.traceIntegrity, 'VALID');

    const adaptive = structuredClone(request);
    adaptive.mode = 'ADAPTIVE';
    adaptive.request_id = randomUUID();
    adaptive.payload.metadata.requestId = adaptive.request_id;
    const adaptiveId = await admit(observations, 'generate', adaptive);
    const initial = createAdaptiveInitialStage(index, retrieve, build, observations);

    const result = await initial('generate', adaptive, {
      executionId: adaptiveId,
      signal,
      deadlineAt: adaptive.deadline_at,
    });

    assert.equal(result.decision.initialDecision, empty ? 'DEEP' : 'FAST');
    assert.equal(result.decision.finalPath, null);
    assert.equal(result.decision.retrievalConfigurationHash, retrieval[0].data.configurationHash);
    assert.deepEqual(result.retrieved.trace.scope, retrieval[0].data.scope);
    assert.equal(result.retrieved.trace.queryHash, retrieval[0].data.queryHash);
    assert.deepEqual(
      result.built.sources,
      empty ? [] : [{ source_id: 'source-1', chunk_id: 'chunk-1' }],
    );
    assert.equal(embeddingCalls, 2);
    assert.equal(generationCalls, empty ? 0 : 1);
    assert.equal((await observations.executionAccounting(adaptiveId)).length, 1);

    // Test caller closes the partial execution explicitly; this is not an adaptive operation result.
    await observations.finish(adaptiveId, 'FAILED', 'INSUFFICIENT_EVIDENCE');
    assert.ok((await observations.inspect()).every((row) => row.traceIntegrity === 'VALID'));
  });
}
