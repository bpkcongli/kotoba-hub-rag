// Serialized trace contract snapshot; independent of live policy implementations.
import type { RetrievalFilter } from '@/modules/knowledge/application/public';

export type ScoreType = 'cosine' | 'sparse_dot' | 'rrf_k60_zero_based';

export interface RankedHit {
  readonly pointId: string;

  readonly chunkId: string;

  readonly rank: number;

  readonly score: number;

  readonly scoreType: ScoreType;
}

export interface RetrievalTrace {
  readonly kind: 'retrieval_completed';

  readonly retrievalId: string;

  readonly stage: 1 | 2;

  readonly profile: 'DENSE' | 'HYBRID';

  readonly indexRevision: string;

  readonly physicalCollection: string;

  readonly indexFingerprint: string;

  readonly configurationHash: string;

  readonly scope: RetrievalFilter & { readonly embeddingConfigId: string };

  readonly queryHash: string;

  readonly limit: number;

  readonly candidateLimit: number;

  readonly fusion: 'rrf_k60_zero_based' | null;

  readonly outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT';

  readonly code:
    | 'INVALID_INPUT'
    | 'INFERENCE_FAILED'
    | 'RETRIEVAL_FAILED'
    | 'TIMEOUT'
    | 'DEPENDENCY_NOT_READY'
    | null;

  readonly dense: readonly RankedHit[];

  readonly sparse: readonly RankedHit[] | null;

  readonly candidates: readonly RankedHit[];
}
