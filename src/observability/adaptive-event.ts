import { createHash } from 'node:crypto';
import type { PoolDrop } from '@/pipelines/deep-candidates';
import { deepPolicySchema } from '@/pipelines/deep-config';
import type { DeepPolicy } from '@/pipelines/deep-config';

export interface DeepRerankTrace {
  readonly kind: 'deep_reranked';
  readonly policy: DeepPolicy;
  readonly configurationHash: string;
  readonly firstRetrievalId: string;
  readonly secondRetrievalId: string;
  readonly scopeHash: string;
  readonly queryHash: string;
  readonly poolIds: readonly string[];
  readonly dropped: readonly PoolDrop[];
  readonly scores: readonly {
    readonly chunkId: string;
    readonly rank: number;
    readonly score: number;
    readonly scoreType: 'hf_none_raw_logit_unverified';
  }[];
}

export interface AdaptivePathTrace {
  readonly kind: 'adaptive_path_completed';
  readonly version: 'adp-02-v1';
  readonly finalPath: 'FAST' | 'DEEP' | null;
  readonly retrievalStageCount: number;
  readonly rewriteCallCount: number;
  readonly rerankCallCount: number;
  readonly modelCallCount: number;
  readonly outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
}

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const id = { type: 'string', minLength: 1, maxLength: 200 };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const count = { type: 'integer', minimum: 0, maximum: 128 };
export const deepRerankSchema = object({
  kind: { const: 'deep_reranked' },
  policy: deepPolicySchema,
  configurationHash: hash,
  firstRetrievalId: { type: 'string', format: 'uuid' },
  secondRetrievalId: { type: 'string', format: 'uuid' },
  scopeHash: hash,
  queryHash: hash,
  poolIds: { type: 'array', maxItems: 64, uniqueItems: true, items: id },
  dropped: {
    type: 'array',
    maxItems: 64,
    items: object({
      chunkId: id,
      stage: { enum: [1, 2] },
      reason: { enum: ['DUPLICATE_CHUNK', 'DUPLICATE_CONTENT', 'POOL_LIMIT'] },
    }),
  },
  scores: {
    type: 'array',
    maxItems: 64,
    items: object({
      chunkId: id,
      rank: { type: 'integer', minimum: 1, maximum: 64 },
      score: { type: 'number' },
      scoreType: { const: 'hf_none_raw_logit_unverified' },
    }),
  },
});
export const adaptivePathSchema = object({
  kind: { const: 'adaptive_path_completed' },
  version: { const: 'adp-02-v1' },
  finalPath: { enum: ['FAST', 'DEEP', null] },
  retrievalStageCount: { ...count, maximum: 2 },
  rewriteCallCount: { ...count, maximum: 1 },
  rerankCallCount: { ...count, maximum: 64 },
  modelCallCount: count,
  outcome: { enum: ['SUCCESS', 'FAILED', 'TIMEOUT'] },
});

export function validDeepRerank(data: DeepRerankTrace): boolean {
  const expectedHash = createHash('sha256').update(JSON.stringify(data.policy)).digest('hex');
  const ids = new Set(data.scores.map((row) => row.chunkId));

  return (
    data.configurationHash === expectedHash &&
    data.firstRetrievalId !== data.secondRetrievalId &&
    data.poolIds.length <= data.policy.rerankPoolLimit &&
    data.poolIds.length === data.scores.length &&
    ids.size === data.scores.length &&
    data.poolIds.every((id) => ids.has(id)) &&
    data.scores.every(
      (row, index) =>
        row.rank === index + 1 &&
        Number.isFinite(row.score) &&
        (index === 0 || row.score <= (data.scores[index - 1]?.score ?? -Infinity)),
    )
  );
}

export function validAdaptivePath(data: AdaptivePathTrace): boolean {
  return (
    data.rewriteCallCount + data.rerankCallCount <= data.modelCallCount &&
    (data.finalPath === 'DEEP' || (data.rewriteCallCount === 0 && data.rerankCallCount === 0)) &&
    (data.finalPath === 'DEEP' || data.retrievalStageCount <= 1) &&
    (data.outcome !== 'SUCCESS' ||
      (data.finalPath !== null &&
        data.modelCallCount ===
          data.retrievalStageCount + data.rewriteCallCount + data.rerankCallCount + 1 &&
        data.retrievalStageCount === (data.finalPath === 'DEEP' ? 2 : 1) &&
        (data.finalPath !== 'DEEP' || data.rerankCallCount > 0)))
  );
}
