export interface GradingTrace {
  readonly kind: 'grading_binding' | 'grading_assessed';
  readonly version: 'uc-02-v1';
  readonly policyRef: {
    readonly id: string;
    readonly revision: number;
    readonly contentSha256: string;
  };
  readonly guidanceRefs: readonly {
    readonly id: string;
    readonly revision: number;
    readonly contentSha256: string;
  }[];
  readonly corpusVersion: string;
  readonly promptVersion: 'uc-02-assessment-v1';
  readonly scoringAlgorithmVersion: 'SUM_THEN_CAP_V1';
  readonly outcome: 'PENDING' | 'GRADED' | 'UNGRADABLE';
  readonly scores: {
    readonly meaning: 0 | 20 | 40 | 60;
    readonly grammar: 0 | 10 | 20 | 30;
    readonly naturalness: 0 | 5 | 10;
  } | null;
  readonly reason:
    'SOURCE_AMBIGUOUS' | 'SOURCE_REFERENCE_CONFLICT' | 'NORMALIZATION_CONFLICT' | null;
}

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const ref = object({
  id: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_.:-]+$' },
  revision: { type: 'integer', minimum: 1 },
  contentSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
});

export const gradingEventSchema = object({
  kind: { enum: ['grading_binding', 'grading_assessed'] },
  version: { const: 'uc-02-v1' },
  policyRef: ref,
  guidanceRefs: { type: 'array', maxItems: 64, uniqueItems: true, items: ref },
  corpusVersion: { type: 'string', minLength: 1, maxLength: 128 },
  promptVersion: { const: 'uc-02-assessment-v1' },
  scoringAlgorithmVersion: { const: 'SUM_THEN_CAP_V1' },
  outcome: { enum: ['PENDING', 'GRADED', 'UNGRADABLE'] },
  scores: {
    anyOf: [
      object({
        meaning: { enum: [0, 20, 40, 60] },
        grammar: { enum: [0, 10, 20, 30] },
        naturalness: { enum: [0, 5, 10] },
      }),
      { type: 'null' },
    ],
  },
  reason: {
    enum: [null, 'SOURCE_AMBIGUOUS', 'SOURCE_REFERENCE_CONFLICT', 'NORMALIZATION_CONFLICT'],
  },
});

export function validGradingTrace(data: GradingTrace): boolean {
  return data.kind === 'grading_binding'
    ? data.outcome === 'PENDING' && data.scores === null && data.reason === null
    : data.outcome === 'GRADED'
      ? data.scores !== null && data.reason === null
      : data.outcome === 'UNGRADABLE' && data.scores === null && data.reason !== null;
}
