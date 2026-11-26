import { Ajv } from 'ajv';
import { ConfigError } from '@/shared/config';

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
const validate = new Ajv({ strict: true }).compile<DeepPolicy>(deepPolicySchema);

export function parseDeepPolicy(value: unknown): DeepPolicy {
  if (!validate(value)) {
    throw new ConfigError(['ADAPTIVE_DEEP_POLICY']);
  }

  return Object.freeze(structuredClone(value));
}

export function readDeepPolicy(env: Readonly<Record<string, unknown>> = {}): DeepPolicy {
  const rewrite = env.ADAPTIVE_REWRITE_ENABLED ?? 'false';
  const pool = env.ADAPTIVE_RERANK_POOL_LIMIT ?? '10';

  if (
    typeof rewrite !== 'string' ||
    !['true', 'false'].includes(rewrite) ||
    typeof pool !== 'string' ||
    !/^\d+$/.test(pool)
  ) {
    throw new ConfigError(['ADAPTIVE_REWRITE_ENABLED', 'ADAPTIVE_RERANK_POOL_LIMIT']);
  }

  return parseDeepPolicy({
    version: 'adp-02-deep-v1',
    calibrationStatus: 'PROVISIONAL',
    rewriteEnabled: rewrite === 'true',
    rewriteModel: env.ADAPTIVE_REWRITE_MODEL ?? 'gpt-5.6-terra',
    rerankPoolLimit: Number(pool),
  });
}
