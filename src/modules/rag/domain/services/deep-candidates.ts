import { createHash } from 'node:crypto';
import type { RetrievalFilter } from '@/modules/rag/domain/models/evidence';
import type { ContextCandidate, RetrievedEvidence } from '@/modules/rag/domain/models/retrieval';
import { GenerationError } from '@/shared/errors/generation-error';

export interface PoolDrop {
  readonly chunkId: string;

  readonly stage: 1 | 2;

  readonly reason: 'DUPLICATE_CHUNK' | 'DUPLICATE_CONTENT' | 'POOL_LIMIT';
}

export function mergeDeepCandidates(
  first: readonly RetrievedEvidence[],
  second: readonly RetrievedEvidence[],
  filter: RetrievalFilter,
  limit: number,
): { pool: readonly RetrievedEvidence[]; dropped: readonly PoolDrop[] } {
  const chunks = new Map<string, string>();
  const contents = new Set<string>();
  const pool: RetrievedEvidence[] = [];
  const dropped: PoolDrop[] = [];

  // Interleave stages, preserving each stage's order, without comparing incompatible raw scores.
  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    for (const [stage, row] of [
      [1, first[index]],
      [2, second[index]],
    ] as const) {
      if (row === undefined) {
        continue;
      }

      if (
        row.jlptLevel !== filter.targetLevel ||
        !row.skillCodes.some((code) => filter.skillCodes.includes(code)) ||
        !row.chunkId.trim() ||
        !row.text.trim() ||
        row.contentChecksum !== createHash('sha256').update(row.text).digest('hex')
      ) {
        throw new GenerationError('RETRIEVAL_FAILED');
      }

      const prior = chunks.get(row.chunkId);
      const fingerprint = JSON.stringify([
        row.pointId,
        row.chunkId,
        row.sourceId,
        row.parentId,
        row.contentChecksum,
        row.skillCodes,
        row.jlptLevel,
        row.locale,
        row.lessonSlug,
        row.unitSlug,
        row.trackSlug,
        row.tokenCount,
      ]);

      if (prior !== undefined && prior !== fingerprint) {
        throw new GenerationError('RETRIEVAL_FAILED');
      }

      chunks.set(row.chunkId, fingerprint);
      const reason =
        prior !== undefined
          ? 'DUPLICATE_CHUNK'
          : contents.has(row.contentChecksum)
            ? 'DUPLICATE_CONTENT'
            : pool.length >= limit
              ? 'POOL_LIMIT'
              : null;

      if (reason !== null) {
        dropped.push({ chunkId: row.chunkId, stage, reason });
        continue;
      }

      contents.add(row.contentChecksum);
      pool.push(row);
    }
  }

  return { pool, dropped };
}

export function mapRerankedCandidates(
  pool: readonly RetrievedEvidence[],
  scores: readonly {
    readonly chunkId: string;
    readonly score: number;
    readonly scoreType: string;
  }[],
): readonly ContextCandidate[] {
  const byId = new Map(scores.map((row) => [row.chunkId, row]));

  if (
    scores.length !== pool.length ||
    byId.size !== pool.length ||
    pool.some((row) => !byId.has(row.chunkId)) ||
    scores.some(
      (row) => !Number.isFinite(row.score) || row.scoreType !== 'hf_none_raw_logit_unverified',
    )
  ) {
    throw new GenerationError('INFERENCE_FAILED');
  }

  return pool
    .map((row, index) => {
      const score = byId.get(row.chunkId);

      if (!score) {
        throw new GenerationError('INFERENCE_FAILED');
      }

      return { ...row, score: score.score, scoreType: score.scoreType, rank: index + 1 };
    })
    .sort((left, right) => right.score - left.score || left.rank - right.rank)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
