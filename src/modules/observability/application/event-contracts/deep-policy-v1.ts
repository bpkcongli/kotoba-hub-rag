// Serialized trace contract snapshot; independent of live policy implementations.

export interface DeepPolicy {
  readonly version: 'adp-02-deep-v1';

  readonly calibrationStatus: 'PROVISIONAL';

  readonly rewriteEnabled: boolean;

  readonly rewriteModel: 'gpt-5.6-terra';

  readonly rerankPoolLimit: number;
}

const properties = {
  version: { const: 'adp-02-deep-v1' },
  calibrationStatus: { const: 'PROVISIONAL' },
  rewriteEnabled: { type: 'boolean' },
  rewriteModel: { const: 'gpt-5.6-terra' },
  rerankPoolLimit: { type: 'integer', minimum: 1, maximum: 64 },
};

export const deepPolicySchema = {
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};
