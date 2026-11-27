import type { RetrievalTrace } from '@/modules/observability/application/event-contracts/retrieval-v1';

const object = (properties: Record<string, unknown>): object => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const text = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_.:-]+$' };
const nullable = (schema: object): object => ({ anyOf: [schema, { type: 'null' }] });
const hits = {
  type: 'array',
  maxItems: 32,
  items: object({
    pointId: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-fA-F0-9-]+$' },
    chunkId: { type: 'string', minLength: 1, maxLength: 200 },
    rank: { type: 'integer', minimum: 1, maximum: 32 },
    score: { type: 'number' },
    scoreType: { enum: ['cosine', 'sparse_dot', 'rrf_k60_zero_based'] },
  }),
};

export const retrievalEventSchema = object({
  kind: { const: 'retrieval_completed' },
  retrievalId: { type: 'string', format: 'uuid' },
  stage: { enum: [1, 2] },
  profile: { enum: ['DENSE', 'HYBRID'] },
  indexRevision: text,
  physicalCollection: text,
  indexFingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  configurationHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  scope: object({
    published: { const: true },
    corpusVersion: text,
    targetLevel: { enum: ['JLPT_N5', 'JLPT_N4'] },
    skillCodes: {
      type: 'array',
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 128 },
    },
    embeddingConfigId: text,
  }),
  queryHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  limit: { type: 'integer', minimum: 1, maximum: 32 },
  candidateLimit: { type: 'integer', minimum: 1, maximum: 32 },
  fusion: nullable({ const: 'rrf_k60_zero_based' }),
  outcome: { enum: ['SUCCESS', 'FAILED', 'TIMEOUT'] },
  code: nullable({
    enum: [
      'INVALID_INPUT',
      'INFERENCE_FAILED',
      'RETRIEVAL_FAILED',
      'TIMEOUT',
      'DEPENDENCY_NOT_READY',
    ],
  }),
  dense: hits,
  sparse: nullable(hits),
  candidates: hits,
});

export function validRetrievalTrace(data: RetrievalTrace): boolean {
  if (
    (data.outcome === 'SUCCESS') !== (data.code === null) ||
    (data.outcome === 'TIMEOUT') !== (data.code === 'TIMEOUT') ||
    data.limit > data.candidateLimit ||
    data.candidates.length > data.limit ||
    data.dense.length > data.candidateLimit ||
    (data.sparse?.length ?? 0) > data.candidateLimit ||
    (data.profile === 'DENSE'
      ? data.sparse !== null || data.fusion !== null
      : data.sparse === null || data.fusion !== 'rrf_k60_zero_based')
  ) {
    return false;
  }

  for (const [branch, scoreType] of [
    [data.dense, 'cosine'],
    [data.sparse ?? [], 'sparse_dot'],
    [data.candidates, data.profile === 'DENSE' ? 'cosine' : 'rrf_k60_zero_based'],
  ] as const) {
    if (
      new Set(branch.map((row) => row.pointId)).size !== branch.length ||
      new Set(branch.map((row) => row.chunkId)).size !== branch.length ||
      branch.some(
        (row, index) =>
          row.rank !== index + 1 ||
          row.scoreType !== scoreType ||
          !Number.isFinite(row.score) ||
          (index > 0 && row.score > (branch[index - 1]?.score ?? -Infinity)),
      )
    ) {
      return false;
    }
  }

  const points = new Map(
    [...data.dense, ...(data.sparse ?? [])].map((row) => [row.pointId, row.chunkId]),
  );

  return data.candidates.every((row) => points.get(row.pointId) === row.chunkId);
}
