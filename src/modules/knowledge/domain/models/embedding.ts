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
