import type { RankedHit, RetrievedEvidence } from '@/retrieval/types';
import { RetrievalError } from '@/retrieval/types';

export const RRF_K = 60;

// Rank in traces is one-based; the fixed RRF formula uses zero-based positions.
export function fuseRanks(
  dense: readonly RetrievedEvidence[],
  sparse: readonly RetrievedEvidence[],
  limit: number,
): readonly RetrievedEvidence[] {
  const pool = new Map<string, { candidate: RetrievedEvidence; score: number }>();
  const chunks = new Map<string, string>();

  for (const branch of [dense, sparse]) {
    for (const [position, candidate] of branch.entries()) {
      const previous = pool.get(candidate.pointId);

      if (
        (chunks.has(candidate.chunkId) && chunks.get(candidate.chunkId) !== candidate.pointId) ||
        (previous &&
          JSON.stringify({ ...previous.candidate, rank: 0, score: 0, scoreType: 'cosine' }) !==
            JSON.stringify({ ...candidate, rank: 0, score: 0, scoreType: 'cosine' }))
      ) {
        throw new RetrievalError('INVALID_RESPONSE');
      }

      chunks.set(candidate.chunkId, candidate.pointId);

      pool.set(candidate.pointId, {
        candidate,
        score: (previous?.score ?? 0) + 1 / (RRF_K + position),
      });
    }
  }

  return [...pool.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.candidate.pointId < b.candidate.pointId
          ? -1
          : a.candidate.pointId > b.candidate.pointId
            ? 1
            : 0),
    )
    .slice(0, limit)
    .map(({ candidate, score }, index) => ({
      ...candidate,
      rank: index + 1,
      score,
      scoreType: 'rrf_k60_zero_based',
    }));
}

export function rankedHit(candidate: RankedHit): RankedHit {
  return {
    pointId: candidate.pointId,
    chunkId: candidate.chunkId,
    rank: candidate.rank,
    score: candidate.score,
    scoreType: candidate.scoreType,
  };
}
