export interface RetrievalFilter {
  readonly published: true;

  readonly corpusVersion: string;

  readonly targetLevel: 'JLPT_N5' | 'JLPT_N4';

  readonly skillCodes: readonly string[];
}
