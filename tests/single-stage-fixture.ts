import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { config, clock, outputFor, providerResponse, requestFor } from '@tests/generation-fixture';
import { dense, hit, manifest, transport } from '@tests/retrieval-fixture';
import { EMBEDDING_CONFIG_ID } from '@/adapters/bge-configuration';
import { readHfConfig } from '@/adapters/hf-config';
import { createHfInference } from '@/adapters/hf-inference';
import { createOpenAiGenerator } from '@/adapters/openai-responses';
import { readContextConfig } from '@/context/config';
import { createContextBuilder } from '@/context/observed-builder';
import type { ContextConfig } from '@/context/types';
import type { Operation } from '@/contracts/validator';
import { createOperationGenerator } from '@/generation/generator';
import { parseTraceEvent } from '@/observability/events';
import { ObservationStore } from '@/observability/store';
import type { ObservationOptions } from '@/observability/store';
import { readEvidencePolicy } from '@/pipelines/evidence';
import type { EvidencePolicy } from '@/pipelines/evidence';
import { createSingleStageRunner } from '@/pipelines/single-stage';
import { retrievalConfig } from '@/retrieval/config';
import { createQdrantRetriever } from '@/retrieval/qdrant-retriever';
import { createRetrievalStage } from '@/retrieval/stage';
import type { Clock } from '@/shared/ports';
import { parseIndexManifest } from '@/storage/index-manifest';

export const skill = 'synthetic_copula';

export async function setupSingleStage(
  t: TestContext,
  options: {
    operation?: Operation;
    fixtureIndex?: number;
    points?:
      | readonly ReturnType<typeof hit>[]
      | ((index: ReturnType<typeof manifest>, round: number) => readonly ReturnType<typeof hit>[]);
    hfFetch?: typeof fetch;
    qdrantFetch?: typeof fetch;
    generatorFetch?: typeof fetch;
    context?: Partial<ContextConfig>;
    policy?: EvidencePolicy;
    observationOptions?: ObservationOptions;
    clock?: Clock;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'kotoba-rag03-'));
  const timer = options.clock ?? clock;
  const observations = new ObservationStore(directory, timer, options.observationOptions);
  const index = parseIndexManifest({
    ...manifest(),
    embeddingConfigId: EMBEDDING_CONFIG_ID,
    embeddingModelRevision: null,
    tokenizerRevision: null,
    processingRevision: null,
  });
  const retrieval = retrievalConfig(index);
  const operation = options.operation ?? 'generate';
  const request = requestFor(operation, options.fixtureIndex ?? 0);
  request.mode = 'SINGLE_STAGE';
  request.corpus_version = index.corpusVersion;
  const requests = {
    embedding: [] as unknown[],
    search: [] as unknown[],
    generation: [] as unknown[],
  };
  const hfConfig = readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-hf-secret' });

  assert.ok(hfConfig);

  const hf = createHfInference(hfConfig, {
    clock: timer,
    fetch: (url, init) => {
      requests.embedding.push(
        typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      );

      return options.hfFetch
        ? options.hfFetch(url, init)
        : Promise.resolve(Response.json([dense()]));
    },
    onAttempt: (attempt) => observations.recordHfAttempt(attempt),
  });
  const defaultTransport = transport(index, () =>
    Response.json({
      result: {
        points: (typeof options.points === 'function'
          ? options.points(index, requests.search.length)
          : options.points) ?? [
          hit(index, 1, 0.8, {
            skill_codes: [skill],
            jlpt_level: request.payload.context.targetLevel,
          }),
        ],
      },
    }),
  );
  const retriever = createQdrantRetriever(
    retrieval,
    { url: 'http://127.0.0.1:6333', timeoutMs: 5000 },
    {
      clock: timer,
      fetch: (url, init) => {
        if (typeof url === 'string' && url.includes('/points/')) {
          requests.search.push(
            typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
          );
        }

        return options.qdrantFetch ? options.qdrantFetch(url, init) : defaultTransport(url, init);
      },
    },
  );
  const stage = createRetrievalStage(
    retrieval,
    {
      profile: 'DENSE',
      configId: index.embeddingConfigId,
      modelRevision: null,
      tokenizerRevision: null,
      processingRevision: null,
      sparseCapabilityVerified: false,
      sparseTokenMappingId: null,
    },
    hf.embedding,
    retriever,
    observations,
    timer,
  );

  const generatorConfig = config();
  const generator = createOpenAiGenerator(generatorConfig, {
    clock: timer,
    fetch: (url, init) => {
      requests.generation.push(
        typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      );

      return options.generatorFetch
        ? options.generatorFetch(url, init)
        : Promise.resolve(
            providerResponse(outputFor(operation, options.fixtureIndex ?? 0), {
              model: operation === 'normalize' ? 'gpt-5.6-luna' : 'gpt-5.6-terra',
            }),
          );
    },
    onAttempt: (attempt) => observations.recordGenerationAttempt(attempt),
  });

  const build = createContextBuilder(
    { ...readContextConfig({}, generatorConfig), ...options.context },
    generatorConfig,
    observations,
    timer,
  );
  const generate = createOperationGenerator(generator, generatorConfig);
  const run = createSingleStageRunner(
    index,
    stage,
    build,
    generate,
    observations,
    options.policy ?? readEvidencePolicy(),
    timer,
  );
  t.after(async () => {
    hf.close();
    retriever.close();
    generator.close();
    await observations.close();
    await rm(directory, { recursive: true, force: true });
  });

  return {
    directory,
    observations,
    index,
    requests,
    run,
    request,
    build,
    generate,
    stage,
    generator,
    hf,
  };
}

export async function trace(directory: string, executionId: string) {
  const text = await readFile(join(directory, 'events', `${executionId}.jsonl`), 'utf8');

  return text
    .trim()
    .split('\n')
    .map((line) => parseTraceEvent(JSON.parse(line)));
}
