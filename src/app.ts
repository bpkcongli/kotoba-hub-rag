import type { FastifyInstance } from 'fastify';
import Fastify, { LogController } from 'fastify';
import type { AppConfig } from '@/bootstrap/config';
import { ObservationStore } from '@/bootstrap/observation-store';
import type { ContractValidators } from '@/contracts/types';
import type { ExecutionPolicy } from '@/modules/execution/application/execution-policy';
import { readExecutionPolicy } from '@/modules/execution/application/execution-policy';
import type { QdrantConfig } from '@/modules/knowledge/application/connection-settings';
import type { RubricBundle } from '@/modules/knowledge/application/public';
import { createKnowledgeModule } from '@/modules/knowledge/infrastructure/di/index';
import type { QdrantIndexStore } from '@/modules/knowledge/interface/secondary/qdrant/qdrant-index';
import type { RetrievalConfig } from '@/modules/rag/application/models/retrieval-config';
import type { DeepPolicy } from '@/modules/rag/application/pipelines/deep-config';
import { readDeepPolicy } from '@/modules/rag/application/pipelines/deep-config';
import type { EvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import { readEvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import type { RouterPolicy } from '@/modules/rag/application/pipelines/router';
import { readRouterPolicy } from '@/modules/rag/application/pipelines/router';
import type { RagService } from '@/modules/rag/application/services/rag.service';
import type {
  AdaptiveInitialStageService,
  ContextBuilderService,
  PipelineService,
  RetrievalStageService,
} from '@/modules/rag/application/services/stages';
import { createContractValidators } from '@/modules/rag/application/validation';
import type { ContextConfig } from '@/modules/rag/domain/models/context';
import { readContextConfig } from '@/modules/rag/infrastructure/config/context';
import type { HfConfig } from '@/modules/rag/infrastructure/config/hf-config';
import type { OpenAiConfig } from '@/modules/rag/infrastructure/config/openai-config';
import { createRagModule } from '@/modules/rag/infrastructure/di/index';
import { registerOperationRoutes } from '@/modules/rag/interface/primary/rest/routes';
import type { HfInference } from '@/modules/rag/interface/secondary/inference/hf-inference';
import type { OpenAiGenerator } from '@/modules/rag/interface/secondary/inference/openai-responses';
import type { QdrantRetriever } from '@/modules/rag/interface/secondary/qdrant/retriever';
import type { Clock } from '@/shared/clock';
import type { Mode } from '@/shared/operations';
import { systemClock } from '@/shared/system-clock';

export interface Application {
  readonly operations: RagService;

  readonly server: FastifyInstance;

  readonly clock: Clock;

  readonly contracts: ContractValidators;

  readonly inference: HfInference | null;

  readonly storage: QdrantIndexStore | null;

  readonly observations: ObservationStore;

  readonly generator: OpenAiGenerator | null;

  readonly baseline: PipelineService | null;

  readonly retriever: QdrantRetriever | null;

  readonly retrievalStage: RetrievalStageService | null;

  readonly contextBuilder: ContextBuilderService | null;

  readonly singleStage: PipelineService | null;

  readonly adaptiveInitialStage: AdaptiveInitialStageService | null;

  readonly adaptive: PipelineService | null;
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
  rubric: RubricBundle | null = null,
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

  const rag = createRagModule({
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
    rubric,
    registry: observations,
    createStorage: () => createKnowledgeModule(qdrantConfig).storage,
  });
  const {
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
  } = rag;
  server.addHook('onClose', async () => {
    rag.close();
    await observations.close();
  });

  const availableModes: Mode[] = [];

  if (baseline) {
    availableModes.push('LLM_ONLY');
  }
  if (singleStage) {
    availableModes.push('SINGLE_STAGE');
  }
  if (adaptive) {
    availableModes.push('ADAPTIVE');
  }

  registerOperationRoutes(server, {
    config: config.api,
    clock,
    contracts,
    operations,
    registry: observations,
    availableModes,
  });

  return {
    server,
    operations,
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
