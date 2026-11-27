// Serialized trace contract snapshot; independent of live policy implementations.
import { Ajv } from 'ajv';
import { ConfigError } from '@/shared/errors/config-error';

export interface ExecutionPolicy {
  readonly version: 'adp-03-v1';

  readonly maxProviderRetries: number;

  readonly maxSchemaRetries: number;

  readonly maxTotalRetries: number;

  readonly maxModelCalls: number;

  readonly backoffBaseMs: number;

  readonly backoffMaxMs: number;

  readonly traceGraceMs: number;
}

const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });

const properties = {
  version: { const: 'adp-03-v1' },
  maxProviderRetries: integer(0, 3),
  maxSchemaRetries: integer(0, 2),
  maxTotalRetries: integer(0, 3),
  maxModelCalls: integer(1, 128),
  backoffBaseMs: integer(0, 10000),
  backoffMaxMs: integer(0, 30000),
  traceGraceMs: integer(1, 5000),
};

export const executionPolicySchema = {
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};

const validate = new Ajv({ strict: true }).compile<ExecutionPolicy>(executionPolicySchema);

export function parseExecutionPolicy(value: unknown): ExecutionPolicy {
  if (!validate(value) || value.backoffBaseMs > value.backoffMaxMs) {
    throw new ConfigError(['PIPELINE_EXECUTION_POLICY']);
  }

  return Object.freeze({
    version: value.version,
    maxProviderRetries: value.maxProviderRetries,
    maxSchemaRetries: value.maxSchemaRetries,
    maxTotalRetries: value.maxTotalRetries,
    maxModelCalls: value.maxModelCalls,
    backoffBaseMs: value.backoffBaseMs,
    backoffMaxMs: value.backoffMaxMs,
    traceGraceMs: value.traceGraceMs,
  });
}
