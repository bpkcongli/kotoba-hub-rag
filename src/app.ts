import Fastify, { LogController } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { EMBEDDING_CONFIG_ID } from '@/adapters/bge-configuration';
import type { HfConfig } from '@/adapters/hf-config';
import { HF_IDENTITY } from '@/adapters/hf-config';
import { createHfInference, InferenceError } from '@/adapters/hf-inference';
import type { HfInference } from '@/adapters/hf-inference';
import type { OpenAiConfig } from '@/adapters/openai-config';
import { createOpenAiGenerator, GenerationError } from '@/adapters/openai-responses';
import type { OpenAiGenerator } from '@/adapters/openai-responses';
import { systemClock } from '@/adapters/system-clock';
import { readContextConfig } from '@/context/config';
import { createContextBuilder } from '@/context/observed-builder';
import type { ContextConfig } from '@/context/types';
import { createContractValidators } from '@/contracts/validator';
import type { ContractValidators } from '@/contracts/validator';
import { createBaselineRunner } from '@/generation/baseline';
import { createOperationGenerator } from '@/generation/generator';
import { ObservationStore } from '@/observability/store';
import { createAdaptiveRunner } from '@/pipelines/adaptive';
import { createAdaptiveInitialStage } from '@/pipelines/adaptive-initial';
import { readDeepPolicy } from '@/pipelines/deep-config';
import type { DeepPolicy } from '@/pipelines/deep-config';
import { readEvidencePolicy } from '@/pipelines/evidence';
import type { EvidencePolicy } from '@/pipelines/evidence';
import { readExecutionPolicy } from '@/pipelines/execution-policy';
import type { ExecutionPolicy } from '@/pipelines/execution-policy';
import { createQueryRewriter } from '@/pipelines/rewrite';
import { readRouterPolicy } from '@/pipelines/router';
import type { RouterPolicy } from '@/pipelines/router';
import { createSingleStageRunner } from '@/pipelines/single-stage';
import type { RetrievalConfig } from '@/retrieval/config';
import { createQdrantRetriever } from '@/retrieval/qdrant-retriever';
import type { QdrantRetriever } from '@/retrieval/qdrant-retriever';
import { createRetrievalStage } from '@/retrieval/stage';
import { RetrievalError } from '@/retrieval/types';
import type { AppConfig } from '@/shared/config';
import type { CallContext, Clock } from '@/shared/ports';
import type { QdrantConfig } from '@/storage/qdrant-config';
import { QdrantIndexStore } from '@/storage/qdrant-index';

export interface Application {
  readonly server: FastifyInstance;
  readonly clock: Clock;
  readonly contracts: ContractValidators;
  readonly inference: HfInference | null;
  readonly storage: QdrantIndexStore | null;
  readonly observations: ObservationStore;
  readonly generator: OpenAiGenerator | null;
  readonly baseline: ReturnType<typeof createBaselineRunner> | null;
  readonly retriever: QdrantRetriever | null;
  readonly retrievalStage: ReturnType<typeof createRetrievalStage> | null;
  readonly contextBuilder: ReturnType<typeof createContextBuilder> | null;
  readonly singleStage: ReturnType<typeof createSingleStageRunner> | null;
  readonly adaptiveInitialStage: ReturnType<typeof createAdaptiveInitialStage> | null;
  readonly adaptive: ReturnType<typeof createAdaptiveRunner> | null;
}

export function createApplication(
  config: AppConfig,
  clock: Clock = systemClock,
  hfConfig: HfConfig | null = null,
  qdrantConfig: QdrantConfig | null = null,
  observations: ObservationStore = new ObservationStore(config.observationDirectory, clock),
  openAiConfig: OpenAiConfig | null = null,
  retrievalConfig: RetrievalConfig | null = null,
  contextConfig: ContextConfig | null = openAiConfig ? readContextConfig({}, openAiConfig) : null,
  evidencePolicy: EvidencePolicy = readEvidencePolicy(),
  routerPolicy: RouterPolicy = readRouterPolicy(),
  deepPolicy: DeepPolicy = readDeepPolicy(),
  executionPolicy: ExecutionPolicy = readExecutionPolicy(),
): Application {
  const contracts = createContractValidators();
  const server = Fastify({
    bodyLimit: 1048576,
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    // Request URLs, headers, and bodies may contain learner data; log only explicit sanitized events.
    logController: new LogController({ disableRequestLogging: true }),
    forceCloseConnections: true,
    ajv: {
      customOptions: {
        coerceTypes: false,
        useDefaults: false,
        removeAdditional: false,
      },
    },
  });

  const rawInference = hfConfig
    ? createHfInference(hfConfig, {
        clock,
        onAttempt: (attempt) => observations.recordHfAttempt(attempt),
      })
    : null;

  let inferenceClosed = false;
  const requireAdmission = (context: CallContext): void => {
    if (inferenceClosed) {
      throw new InferenceError('CANCELLED');
    }

    observations.assertActive(context.executionId);
  };

  const inference: HfInference | null =
    rawInference === null
      ? null
      : {
          ...rawInference,
          embedding: {
            embed: async (texts, purpose, context) => {
              requireAdmission(context);
              return rawInference.embedding.embed(texts, purpose, context);
            },
          },
          reranker: {
            rerank: async (query, candidates, context) => {
              requireAdmission(context);
              return rawInference.reranker.rerank(query, candidates, context);
            },
          },
          close: () => {
            inferenceClosed = true;
            rawInference.close();
          },
        };

  const storage = qdrantConfig ? new QdrantIndexStore(qdrantConfig) : null;

  if (retrievalConfig && (!qdrantConfig || !inference || hfConfig?.profile !== 'DENSE')) {
    throw new RetrievalError('INCOMPATIBLE_INDEX');
  }

  const rawRetriever =
    retrievalConfig && qdrantConfig
      ? createQdrantRetriever(retrievalConfig, qdrantConfig, { clock })
      : null;
  const retriever: QdrantRetriever | null =
    rawRetriever === null
      ? null
      : {
          close: () => rawRetriever.close(),
          retrieve: (vector, filter, limit, context) => {
            const correlation = observations.activeCorrelation(context.executionId);
            if (inferenceClosed || correlation.mode === 'LLM_ONLY') {
              throw new RetrievalError('INVALID_INPUT');
            }

            return rawRetriever.retrieve(vector, filter, limit, context);
          },
        };
  const retrievalStage =
    retrievalConfig && retriever && inference
      ? createRetrievalStage(
          retrievalConfig,
          {
            profile: 'DENSE',
            configId: EMBEDDING_CONFIG_ID,
            modelRevision: HF_IDENTITY.servedModelRevision,
            tokenizerRevision: HF_IDENTITY.tokenizerRevision,
            processingRevision: HF_IDENTITY.processingRevision,
            sparseCapabilityVerified: false,
            sparseTokenMappingId: null,
          },
          inference.embedding,
          retriever,
          observations,
          clock,
        )
      : null;

  const rawGenerator = openAiConfig
    ? createOpenAiGenerator(openAiConfig, {
        clock,
        onAttempt: (attempt) => observations.recordGenerationAttempt(attempt),
      })
    : null;
  const generator: OpenAiGenerator | null =
    rawGenerator === null
      ? null
      : {
          close: () => rawGenerator.close(),
          generate: (input, context) => {
            if (inferenceClosed) {
              throw new GenerationError('DEPENDENCY_NOT_READY');
            }
            observations.assertActive(context.executionId);

            return rawGenerator.generate(input, context);
          },
        };
  const baseline =
    generator && openAiConfig
      ? createBaselineRunner(
          createOperationGenerator(generator, openAiConfig),
          observations,
          clock,
          executionPolicy,
        )
      : null;
  const contextBuilder =
    openAiConfig && contextConfig
      ? createContextBuilder(contextConfig, openAiConfig, observations, clock)
      : null;

  const singleStage =
    retrievalConfig && retrievalStage && contextBuilder && generator && openAiConfig
      ? createSingleStageRunner(
          retrievalConfig.index,
          retrievalStage,
          contextBuilder,
          createOperationGenerator(generator, openAiConfig),
          observations,
          evidencePolicy,
          clock,
          executionPolicy,
        )
      : null;
  const adaptiveInitialStage =
    retrievalConfig && retrievalStage && contextBuilder
      ? createAdaptiveInitialStage(
          retrievalConfig.index,
          retrievalStage,
          contextBuilder,
          observations,
          routerPolicy,
          clock,
        )
      : null;

  const adaptive =
    retrievalConfig && retrievalStage && contextBuilder && generator && openAiConfig && inference
      ? createAdaptiveRunner(
          retrievalConfig.index,
          retrievalStage,
          contextBuilder,
          createOperationGenerator(generator, openAiConfig),
          createQueryRewriter(generator),
          inference.reranker,
          observations,
          evidencePolicy,
          routerPolicy,
          deepPolicy,
          clock,
          executionPolicy,
        )
      : null;

  server.addHook('onClose', async () => {
    inferenceClosed = true;
    inference?.close();
    generator?.close();
    retriever?.close();
    await observations.close();
  });

  server.get('/health/live', () => ({ status: 'live' }));

  // Adaptive/auth/HTTP admission and operation endpoints remain API-01; probes never run inference.
  server.get('/health/ready', (_request, reply) => reply.code(503).send({ status: 'not_ready' }));

  return {
    server,
    clock,
    contracts,
    inference,
    storage,
    observations,
    generator,
    baseline,
    retriever,
    retrievalStage,
    contextBuilder,
    singleStage,
    adaptiveInitialStage,
    adaptive,
  };
}
