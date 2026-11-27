import { type CallContext } from '@/modules/execution/application/public';
import { type EmbeddingVector, type RetrievalFilter } from '@/modules/knowledge/application/public';
import { type Evidence } from '@/modules/rag/domain/models/evidence';
import type { RetrievalResult } from '@/modules/rag/domain/models/retrieval';
import type { Operation } from '@/shared/operations';

export interface RetrieverPort {
  retrieve(
    vector: EmbeddingVector,
    filter: RetrievalFilter,
    limit: number,
    context: CallContext,
  ): Promise<RetrievalResult>;
}

export interface RerankerPort {
  rerank(
    query: string,
    candidates: readonly Evidence[],
    context: CallContext,
  ): Promise<
    readonly {
      readonly chunkId: string;
      readonly score: number;
      readonly scoreType: string;
    }[]
  >;
}

export interface GeneratorPort {
  generate(
    input: {
      readonly operation: Operation | 'rewrite';
      readonly model: string;
      readonly instructions: string;
      readonly input: string;
      readonly schemaName: string;
      readonly jsonSchema: Readonly<Record<string, unknown>>;
    },
    context: CallContext,
  ): Promise<{
    readonly outputText: string;
    readonly providerRequestId: string | null;
    readonly usage: {
      readonly inputTokens: number | null;
      readonly cachedInputTokens: number | null;
      readonly outputTokens: number | null;
      readonly totalTokens: number | null;
      readonly reasoningTokens?: number | null;
    } | null;
  }>;
}
