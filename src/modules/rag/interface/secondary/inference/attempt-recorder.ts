import type { ExecutionRegistryService } from '@/modules/execution/application/public';
import { accountCall } from '@/modules/observability/application/public';
import { OPENAI_ENDPOINT } from '@/modules/rag/infrastructure/config/openai-config';
import type { InferenceAttempt } from '@/modules/rag/interface/secondary/inference/hf-inference';
import type { GenerationAttempt } from '@/modules/rag/interface/secondary/inference/openai-responses';
import { ObservationError } from '@/shared/errors/observation-error';
import { canonical, hashValue } from '@/shared/hash';

export async function recordGenerationAttempt(
  registry: ExecutionRegistryService,
  attempt: GenerationAttempt,
): Promise<void> {
  const accounting = await registry.priceCall({
    attemptId: attempt.attemptId,
    purpose: attempt.operation,
    phase: attempt.accountingContext.phase,
    retryKind: attempt.accountingContext.retryKind,
    provider: 'openai',
    model: attempt.model,
    billingProfile: attempt.billingProfile,
    timestamp: attempt.timestamp,
    usage: attempt.usage,
    billableUnits: [],
    reportedCost: null,
    hostingChargeId: null,
  });

  await registry.record(
    attempt.executionId,
    {
      kind: 'model_attempt',
      attemptId: attempt.attemptId,
      purpose: attempt.operation,
      provider: 'openai',
      model: attempt.model,
      configVersion: attempt.operation === 'rewrite' ? 'adp-02-rewrite-v1' : 'base-01-v1',
      configurationHash: hashValue(
        canonical({
          ...attempt.configuration,
          promptHash: attempt.promptHash,
          schemaHash: attempt.schemaHash,
          servedModel: attempt.servedModel,
        }),
      ),
      endpointHash: hashValue(OPENAI_ENDPOINT),
      profile: null,
      // A returned model alias does not establish a pinned/verified model revision.
      servedRevision: null,
      itemCount: 1,
      httpStatus: attempt.httpStatus,
      retryAfterMs: attempt.retryAfterMs,
      providerRequestIdHash:
        attempt.providerRequestId === null ? null : hashValue(attempt.providerRequestId),
      errorCode: attempt.errorCode,
      remoteOutcome: attempt.remoteOutcome,
      accounting,
    },
    attempt.durationMs,
    attempt.timestamp,
  );
}

export function recordHfAttempt(
  registry: ExecutionRegistryService,
  attempt: InferenceAttempt,
): Promise<void> {
  const prices = registry.currentPriceSnapshot();
  if (prices === null) {
    return Promise.reject(new ObservationError('EXECUTION_NOT_ACTIVE'));
  }

  const model =
    attempt.operation === 'embedding'
      ? attempt.identity.embeddingModel
      : attempt.identity.rerankerModel;
  const accounting = accountCall(
    {
      attemptId: attempt.attemptId,
      purpose: attempt.purpose,
      phase:
        attempt.accountingContext?.phase ??
        (attempt.purpose === 'document' ? 'DOCUMENT_INDEXING' : 'ONLINE'),
      retryKind: attempt.accountingContext?.retryKind ?? 'INITIAL',
      provider: attempt.identity.provider,
      model,
      billingProfile: 'hf-serverless-compute',
      timestamp: attempt.timestamp,
      usage: null,
      billableUnits: [{ unit: 'COMPUTE_SECOND', quantity: null, evidenceHash: null }],
      reportedCost: null,
      hostingChargeId: null,
    },
    prices,
  );

  // Project only allowlisted fields. Raw provider IDs, config secrets and arbitrary extras are omitted.
  return registry.record(
    attempt.executionId,
    {
      kind: 'model_attempt',
      attemptId: attempt.attemptId,
      purpose: attempt.purpose,
      provider: attempt.identity.provider,
      model:
        attempt.operation === 'embedding'
          ? attempt.identity.embeddingModel
          : attempt.identity.rerankerModel,
      configVersion: attempt.identity.configVersion,
      configurationHash: hashValue(
        canonical({
          profile: attempt.configuration.profile,
          embeddingBatchSize: attempt.configuration.embeddingBatchSize,
          rerankerBatchSize: attempt.configuration.rerankerBatchSize,
          maxConcurrency: attempt.configuration.maxConcurrency,
          maxItems: attempt.configuration.maxItems,
          maxTextChars: attempt.configuration.maxTextChars,
          timeoutMs: attempt.configuration.timeoutMs,
          maxResponseBytes: attempt.configuration.maxResponseBytes,
        }),
      ),
      endpointHash: hashValue(
        attempt.operation === 'embedding'
          ? attempt.identity.embeddingEndpoint
          : attempt.identity.rerankerEndpoint,
      ),
      profile: attempt.profile,
      servedRevision: attempt.identity.servedModelRevision,
      itemCount: attempt.itemCount,
      httpStatus: attempt.httpStatus,
      retryAfterMs: attempt.retryAfterMs,
      providerRequestIdHash:
        attempt.providerRequestId === null ? null : hashValue(attempt.providerRequestId),
      errorCode: attempt.errorCode,
      remoteOutcome: attempt.remoteOutcome,
      accounting,
    },
    attempt.durationMs,
    attempt.timestamp,
  );
}
