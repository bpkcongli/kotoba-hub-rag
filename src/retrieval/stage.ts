import { randomUUID } from 'node:crypto';
import { InferenceError } from '@/adapters/hf-inference';
import { validateEmbeddingBatch } from '@/adapters/hf-validation';
import { systemClock } from '@/adapters/system-clock';
import { ObservationError, hashValue } from '@/observability/store';
import type { ObservationStore } from '@/observability/store';
import type { RetrievalConfig } from '@/retrieval/config';
import { rankedHit } from '@/retrieval/ranking';
import { RetrievalError } from '@/retrieval/types';
import type { RetrievalResult, RetrievalTrace } from '@/retrieval/types';
import type {
  CallContext,
  Clock,
  EmbeddingPort,
  RetrievalFilter,
  RetrieverPort,
} from '@/shared/ports';
import { manifestFingerprint } from '@/storage/index-manifest';
import { knowledgeFilter } from '@/storage/knowledge-filter';

export interface EmbeddingBinding {
  readonly profile: 'DENSE' | 'HYBRID';
  readonly configId: string;
  readonly modelRevision: string | null;
  readonly tokenizerRevision: string | null;
  readonly processingRevision: string | null;
  readonly sparseCapabilityVerified: boolean;
  readonly sparseTokenMappingId: string | null;
}

export function createRetrievalStage(
  config: RetrievalConfig,
  binding: EmbeddingBinding,
  embedding: EmbeddingPort,
  retriever: RetrieverPort,
  observations: ObservationStore,
  clock: Clock = systemClock,
) {
  config = structuredClone(config);
  const index = config.index;

  if (
    binding.profile !== index.retrievalProfile ||
    binding.configId !== index.embeddingConfigId ||
    binding.modelRevision !== index.embeddingModelRevision ||
    binding.tokenizerRevision !== index.tokenizerRevision ||
    binding.processingRevision !== index.processingRevision ||
    binding.sparseCapabilityVerified !== index.sparseCapabilityVerified ||
    binding.sparseTokenMappingId !== index.sparseTokenMappingId
  ) {
    throw new RetrievalError('INCOMPATIBLE_INDEX');
  }

  const configurationHash = hashValue(
    JSON.stringify({
      version: 'rag-01-v1',
      profile: index.retrievalProfile,
      candidateLimit: config.candidateLimit,
      limit: config.limit,
      fusion: index.retrievalProfile === 'DENSE' ? null : 'rrf_k60_zero_based',
      hnswEf: 128,
      exact: false,
      binding,
      timeoutMs: config.timeoutMs,
      maxConcurrency: config.maxConcurrency,
      maxResponseBytes: config.maxResponseBytes,
    }),
  );

  // A stage is a retrieval round. Pipeline owners enforce stage ordering/caps and evidence gates.
  return async (
    query: string,
    filter: RetrievalFilter,
    stage: 1 | 2,
    context: CallContext,
  ): Promise<RetrievalResult & { readonly trace: RetrievalTrace }> => {
    const correlation = observations.activeCorrelation(context.executionId);

    if (
      correlation.mode === 'LLM_ONLY' ||
      ![1, 2].includes(stage) ||
      typeof query !== 'string' ||
      !query.trim() ||
      query.length > 8192 ||
      context.accounting?.phase === 'DOCUMENT_INDEXING' ||
      context.accounting?.phase === 'JUDGE' ||
      context.accounting?.retryKind === 'SCHEMA_RETRY'
    ) {
      throw new RetrievalError('INVALID_INPUT');
    }

    filter = structuredClone(filter);
    filter = {
      published: filter.published,
      corpusVersion: filter.corpusVersion,
      targetLevel: filter.targetLevel,
      skillCodes: [...new Set(filter.skillCodes)],
    };

    try {
      knowledgeFilter(filter, index);
    } catch {
      throw new RetrievalError('INVALID_INPUT');
    }

    context = {
      executionId: context.executionId,
      deadlineAt: context.deadlineAt,
      signal: context.signal,
      accounting: {
        phase: context.accounting?.phase ?? 'ONLINE',
        retryKind: context.accounting?.retryKind ?? 'INITIAL',
      },
    };

    const started = clock.monotonicMs();
    const timestamp = clock.now().toISOString();
    const remainingMs = Date.parse(context.deadlineAt) - clock.now().getTime();

    if (!Number.isFinite(remainingMs) || remainingMs <= 0 || context.signal.aborted) {
      throw new RetrievalError('TIMEOUT');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    const signal = AbortSignal.any([context.signal, controller.signal]);
    const span = observations.startSpan(context.executionId, 'retrieval');
    let result: RetrievalResult = {
      candidates: [],
      dense: [],
      sparse: index.retrievalProfile === 'DENSE' ? null : [],
    };
    let code: RetrievalTrace['code'] = null;
    let failure: Error | null = null;
    let phase: 'embedding' | 'search' = 'embedding';

    try {
      const vectors = await embedding.embed([query], 'query', { ...context, signal });
      let vector;

      try {
        vector = validateEmbeddingBatch(vectors, 1, index.retrievalProfile)[0];
      } catch {
        throw new InferenceError('INVALID_RESPONSE');
      }

      if (!vector) {
        throw new InferenceError('INVALID_RESPONSE');
      }

      phase = 'search';
      result = await retriever.retrieve(vector, filter, config.limit, { ...context, signal });

      if (signal.aborted || clock.monotonicMs() - started >= remainingMs) {
        throw new RetrievalError('TIMEOUT');
      }
    } catch (error) {
      failure =
        error instanceof InferenceError || error instanceof RetrievalError
          ? error
          : new RetrievalError('DEPENDENCY_ERROR');

      if (
        error instanceof ObservationError ||
        (error instanceof InferenceError && error.code === 'ATTEMPT_OBSERVER_FAILED')
      ) {
        await observations.failExecutionTrace(context.executionId).catch(() => undefined);
        clearTimeout(timer);
        throw new ObservationError('TRACE_WRITE_FAILED');
      }

      code =
        signal.aborted ||
        (error instanceof RetrievalError && error.code === 'TIMEOUT') ||
        (error instanceof InferenceError && ['DEADLINE_EXCEEDED', 'CANCELLED'].includes(error.code))
          ? 'TIMEOUT'
          : phase === 'embedding'
            ? 'INFERENCE_FAILED'
            : 'RETRIEVAL_FAILED';
    } finally {
      clearTimeout(timer);
    }

    const data: RetrievalTrace = {
      kind: 'retrieval_completed',
      retrievalId: randomUUID(),
      stage,
      profile: index.retrievalProfile,
      indexRevision: index.indexRevision,
      physicalCollection: index.physicalCollection,
      indexFingerprint: manifestFingerprint(index),
      configurationHash,
      scope: { ...filter, embeddingConfigId: index.embeddingConfigId },
      queryHash: hashValue(query),
      limit: config.limit,
      candidateLimit: config.candidateLimit,
      fusion: index.retrievalProfile === 'DENSE' ? null : 'rrf_k60_zero_based',
      outcome: code === null ? 'SUCCESS' : code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED',
      code,
      dense: result.dense,
      sparse: result.sparse,
      candidates: result.candidates.map(rankedHit),
    };

    await observations.record(
      context.executionId,
      data,
      Math.max(0, clock.monotonicMs() - started),
      timestamp,
    );
    await span.finish(data.outcome, code);

    if (failure !== null) {
      throw failure;
    }

    return { ...result, trace: data };
  };
}
