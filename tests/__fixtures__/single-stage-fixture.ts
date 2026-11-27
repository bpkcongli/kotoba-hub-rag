import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import {
  clock,
  config,
  outputFor,
  providerResponse,
  requestFor,
} from '@tests/__fixtures__/generation-fixture';
import { dense, hit, manifest, transport } from '@tests/__fixtures__/retrieval-fixture';
import { ObservationStore } from '@/bootstrap/observation-store';
import type { Scheduling } from '@/modules/execution/application/execution-control';
import type { ExecutionPolicy } from '@/modules/execution/application/execution-policy';
import type { ObservationOptions } from '@/modules/execution/application/services/execution-registry.service';
import { EMBEDDING_CONFIG_ID } from '@/modules/knowledge/application/embedding-configuration';
import { parseIndexManifest } from '@/modules/knowledge/application/index-manifest';
import { parseTraceEvent } from '@/modules/observability/application/events';
import { createContextBuilder } from '@/modules/rag/application/context/observed-builder';
import { createOperationGenerator } from '@/modules/rag/application/generation/generator';
import type { EvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import { readEvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import { createSingleStageRunner } from '@/modules/rag/application/pipelines/single-stage';
import { createRetrievalStage } from '@/modules/rag/application/retrieval/stage';
import type { ContextConfig } from '@/modules/rag/domain/models/context';
import { readContextConfig } from '@/modules/rag/infrastructure/config/context';
import { readHfConfig } from '@/modules/rag/infrastructure/config/hf-config';
import { retrievalConfig } from '@/modules/rag/infrastructure/config/retrieval';
import { createHfInference } from '@/modules/rag/interface/secondary/inference/hf-inference';
import { createOpenAiGenerator } from '@/modules/rag/interface/secondary/inference/openai-responses';
import { createQdrantRetriever } from '@/modules/rag/interface/secondary/qdrant/retriever';
import type { Clock } from '@/shared/clock';
import type { Operation } from '@/shared/operations';

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
    executionPolicy?: ExecutionPolicy;
    scheduling?: Scheduling;
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
    options.executionPolicy,
    options.scheduling,
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
