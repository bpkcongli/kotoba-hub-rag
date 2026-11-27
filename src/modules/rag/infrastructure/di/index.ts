import type { ExecutionPolicy } from '@/modules/execution/application/execution-policy';
import type { CallContext } from '@/modules/execution/application/ports/call-context';
import type { ExecutionRegistryService } from '@/modules/execution/application/public';
import type { QdrantConfig } from '@/modules/knowledge/application/connection-settings';
import { EMBEDDING_CONFIG_ID } from '@/modules/knowledge/application/embedding-configuration';
import { HF_IDENTITY } from '@/modules/knowledge/application/inference-identity';
import type { QdrantIndexStore } from '@/modules/knowledge/interface/secondary/qdrant/qdrant-index';
import { createContextBuilder } from '@/modules/rag/application/context/observed-builder';
import { createBaselineRunner } from '@/modules/rag/application/generation/baseline';
import { createOperationGenerator } from '@/modules/rag/application/generation/generator';
import type { RetrievalConfig } from '@/modules/rag/application/models/retrieval-config';
import { createAdaptiveRunner } from '@/modules/rag/application/pipelines/adaptive';
import { createAdaptiveInitialStage } from '@/modules/rag/application/pipelines/adaptive-initial';
import type { DeepPolicy } from '@/modules/rag/application/pipelines/deep-config';
import type { EvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import { createQueryRewriter } from '@/modules/rag/application/pipelines/rewrite';
import type { RouterPolicy } from '@/modules/rag/application/pipelines/router';
import { createSingleStageRunner } from '@/modules/rag/application/pipelines/single-stage';
import { createRetrievalStage } from '@/modules/rag/application/retrieval/stage';
import { RagServiceImpl } from '@/modules/rag/application/services/impl/rag.service.impl';
import type { RagService } from '@/modules/rag/application/services/rag.service';
import type { ContextConfig } from '@/modules/rag/domain/models/context';
import { RetrievalError } from '@/modules/rag/domain/models/retrieval';
import type { HfConfig } from '@/modules/rag/infrastructure/config/hf-config';
import type { OpenAiConfig } from '@/modules/rag/infrastructure/config/openai-config';
import { ExecutionRegistryAdapter } from '@/modules/rag/interface/secondary/execution/registry.adapter';
import {
  recordGenerationAttempt,
  recordHfAttempt,
} from '@/modules/rag/interface/secondary/inference/attempt-recorder';
import { createHfInference } from '@/modules/rag/interface/secondary/inference/hf-inference';
import type { HfInference } from '@/modules/rag/interface/secondary/inference/hf-inference';
import { createOpenAiGenerator } from '@/modules/rag/interface/secondary/inference/openai-responses';
import type { OpenAiGenerator } from '@/modules/rag/interface/secondary/inference/openai-responses';
import { createQdrantRetriever } from '@/modules/rag/interface/secondary/qdrant/retriever';
import type { QdrantRetriever } from '@/modules/rag/interface/secondary/qdrant/retriever';
import type { Clock } from '@/shared/clock';
import { GenerationError } from '@/shared/errors/generation-error';
import { InferenceError } from '@/shared/errors/inference-error';

export function createRagModule(options: {
  clock: Clock;
  hfConfig: HfConfig | null;
  qdrantConfig: QdrantConfig | null;
  openAiConfig: OpenAiConfig | null;
  retrievalConfig: RetrievalConfig | null;
  contextConfig: ContextConfig | null;
  evidencePolicy: EvidencePolicy;
  routerPolicy: RouterPolicy;
  deepPolicy: DeepPolicy;
  executionPolicy: ExecutionPolicy;
  registry: ExecutionRegistryService;
  createStorage: () => QdrantIndexStore | null;
}) {
  const {
    clock,
    hfConfig,
    qdrantConfig,
    openAiConfig,
    retrievalConfig,
    contextConfig,
    evidencePolicy,
    routerPolicy,
    deepPolicy,
    executionPolicy,
    registry,
  } = options;
  const observations = new ExecutionRegistryAdapter(registry);
  const rawInference = hfConfig
    ? createHfInference(hfConfig, {
        clock,
        onAttempt: (attempt) => recordHfAttempt(registry, attempt),
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

  const storage = options.createStorage();

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
        onAttempt: (attempt) => recordGenerationAttempt(registry, attempt),
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

  const operations: RagService = new RagServiceImpl({
    LLM_ONLY: baseline,
    SINGLE_STAGE: singleStage,
    ADAPTIVE: adaptive,
  });
  return {
    storage,
    inference,
    generator,
    retriever,
    retrievalStage,
    contextBuilder,
    singleStage,
    adaptiveInitialStage,
    adaptive,
    baseline,
    operations,
    close: () => {
      inferenceClosed = true;
      inference?.close();
      generator?.close();
      retriever?.close();
    },
  };
}
