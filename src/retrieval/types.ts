import type { Evidence, RetrievalFilter } from '@/shared/ports';

export type ScoreType = 'cosine' | 'sparse_dot' | 'rrf_k60_zero_based';
export interface RankedHit {
  readonly pointId: string;
  readonly chunkId: string;
  readonly rank: number;
  readonly score: number;
  readonly scoreType: ScoreType;
}

export interface RetrievedEvidence extends Omit<Evidence, 'scoreType'>, RankedHit {
  readonly parentId: string;
  readonly skillCodes: readonly string[];
  readonly jlptLevel: 'JLPT_N5' | 'JLPT_N4';
  readonly locale: 'JA' | 'EN' | 'ID';
  readonly lessonSlug: string | null;
  readonly unitSlug: string | null;
  readonly trackSlug: string | null;
  readonly contentChecksum: string;
  readonly tokenCount: number;
}

// Context can receive cross-encoder scores while retrieval traces retain their branch score types.
export type ContextCandidate = Omit<RetrievedEvidence, 'scoreType'> & {
  readonly scoreType: string;
};

export interface RetrievalResult {
  readonly candidates: readonly RetrievedEvidence[];
  readonly dense: readonly RankedHit[];
  readonly sparse: readonly RankedHit[] | null;
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

export class RetrievalError extends Error {
  readonly code:
    | 'INVALID_INPUT'
    | 'INCOMPATIBLE_INDEX'
    | 'INVALID_RESPONSE'
    | 'DEPENDENCY_ERROR'
    | 'CAPACITY_LIMIT'
    | 'TIMEOUT';

  constructor(code: RetrievalError['code']) {
    super(`Retrieval failed: ${code}`);
    this.name = 'RetrievalError';
    this.code = code;
  }
}
