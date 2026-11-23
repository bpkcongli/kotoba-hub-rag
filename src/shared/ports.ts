import type { Mode, Operation } from '@/contracts/validator';

// Initial ports; INF/OBS will define capabilities, billing, and event schemas before real adapters.
export interface CallContext {
  readonly executionId: string;
  readonly signal: AbortSignal;
  readonly deadlineAt: string;
}

// Retrieval profile is pinned per run; optional output never selects the profile.
export interface EmbeddingVector {
  readonly dense: readonly number[];
  readonly sparse?: {
    readonly indices: readonly number[];
    readonly values: readonly number[];
  };
}

export interface HybridVector extends EmbeddingVector {
  readonly sparse: NonNullable<EmbeddingVector['sparse']>;
}

export interface Evidence {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly text: string;
  readonly score: number;
  readonly scoreType: string;
}

export interface RetrievalFilter {
  readonly published: true;
  readonly corpusVersion: string;
  readonly targetLevel: 'JLPT_N5' | 'JLPT_N4';
  readonly skillCodes: readonly string[];
}

export interface EmbeddingPort {
  embed(
    texts: readonly string[],
    purpose: 'document' | 'query',
    context: CallContext,
  ): Promise<readonly EmbeddingVector[]>;
}

export interface RetrieverPort {
  retrieve(
    vector: EmbeddingVector,
    filter: RetrievalFilter,
    limit: number,
    context: CallContext,
  ): Promise<readonly Evidence[]>;
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
      readonly operation: Operation;
      readonly model: string;
      readonly instructions: string;
      readonly input: string;
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
    } | null;
  }>;
}

export interface TraceSink {
  write(event: {
    readonly executionId: string;
    readonly mode: Mode;
    readonly timestamp: string;
    readonly name: string;
    readonly attributes: Readonly<Record<string, unknown>>;
  }): Promise<void>;

  close(): Promise<void>;
}

export interface Clock {
  now(): Date;
  monotonicMs(): number;
}
