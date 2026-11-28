export interface RetrievalFilter {
  readonly published: true;

  readonly corpusVersion: string;

  readonly targetLevel: 'JLPT_N5' | 'JLPT_N4';

  readonly skillCodes: readonly string[];

  readonly language?: 'EN' | 'ID';

  readonly contentType?: 'RUBRIC';

  readonly policyRef?: {
    readonly id: string;
    readonly revision: number;
    readonly contentSha256: string;
  };
}
