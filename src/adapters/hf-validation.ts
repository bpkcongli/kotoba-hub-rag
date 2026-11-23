import type { EmbeddingVector } from '@/shared/ports';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateEmbeddingBatch(
  value: unknown,
  count: number,
  profile: 'DENSE' | 'HYBRID',
): readonly EmbeddingVector[] {
  if (!Array.isArray(value) || value.length !== count || count < 1) {
    throw new Error('Invalid embedding cardinality');
  }

  return Array.from(value, (item: unknown) => {
    const dense: unknown[] =
      record(item) && Array.isArray(item.dense) ? Array.from(item.dense) : [];

    if (
      !record(item) ||
      dense.length !== 1024 ||
      !dense.every(finite) ||
      !dense.some((number) => number !== 0)
    ) {
      throw new Error('Invalid dense vector');
    }

    if (!Object.hasOwn(item, 'sparse')) {
      if (profile === 'HYBRID') {
        throw new Error('HYBRID requires sparse');
      }

      return { dense };
    }

    const sparse = item.sparse;
    const indices: unknown[] =
      record(sparse) && Array.isArray(sparse.indices) ? Array.from(sparse.indices) : [];
    const values: unknown[] =
      record(sparse) && Array.isArray(sparse.values) ? Array.from(sparse.values) : [];

    if (
      !record(sparse) ||
      indices.length === 0 ||
      indices.length !== values.length ||
      new Set(indices).size !== indices.length ||
      !indices.every(
        (id): id is number => finite(id) && Number.isSafeInteger(id) && id >= 0 && id < 250002,
      ) ||
      !values.every((weight): weight is number => finite(weight) && weight > 0)
    ) {
      throw new Error('Invalid sparse vector');
    }

    return { dense, sparse: { indices, values } };
  });
}

export function parseHfEmbeddings(value: unknown, count: number): readonly EmbeddingVector[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid HF embedding response');
  }

  // The fixed HF wire returns dense arrays, never a normalized sparse envelope.
  return validateEmbeddingBatch(
    value.map((dense: unknown) => ({ dense })),
    count,
    'DENSE',
  );
}

export function parseHfScores(value: unknown, count: number): readonly number[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid HF reranker response');
  }

  // Both layouts were observed in INF-01: [[label, label]] and [[label], [label]].
  const batch: unknown[] =
    value.length === 1 &&
    Array.isArray(value[0]) &&
    value[0].length === count &&
    value[0].every(record)
      ? value[0]
      : value;

  if (batch.length !== count) {
    throw new Error('Invalid reranker cardinality');
  }

  return batch.map((entry: unknown) => {
    const item: unknown = Array.isArray(entry) && entry.length === 1 ? entry[0] : entry;

    if (!record(item) || item.label !== 'LABEL_0' || !finite(item.score)) {
      throw new Error('Invalid reranker score');
    }

    return item.score;
  });
}
