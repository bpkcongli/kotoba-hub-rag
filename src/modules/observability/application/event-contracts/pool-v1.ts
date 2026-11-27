// Serialized trace contract snapshot; independent of live policy implementations.

export interface PoolDrop {
  readonly chunkId: string;

  readonly stage: 1 | 2;

  readonly reason: 'DUPLICATE_CHUNK' | 'DUPLICATE_CONTENT' | 'POOL_LIMIT';
}
