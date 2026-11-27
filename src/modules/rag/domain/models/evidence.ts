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
