import { createHash } from 'node:crypto';
import { executionPolicySchema, parseExecutionPolicy } from '@/pipelines/execution-policy';
import type { ExecutionPolicy } from '@/pipelines/execution-policy';

export interface ExecutionPolicyTrace {
  readonly kind: 'execution_policy';
  readonly policy: ExecutionPolicy;
  readonly configurationHash: string;
  readonly budgetMs: number;
}

export interface RetryTrace {
  readonly kind: 'retry_scheduled';
  readonly version: 'adp-03-v1';
  readonly retryKind: 'PROVIDER_RETRY' | 'SCHEMA_RETRY';
  readonly purpose: 'query' | 'rerank' | 'generate' | 'evaluate' | 'normalize' | 'recommend';
  readonly ordinal: number;
  readonly delayMs: number;
  readonly reason:
    'HTTP_408' | 'HTTP_429' | 'HTTP_5XX' | 'SCHEMA_PARSE_FAILED' | 'POST_VALIDATION_FAILED';
}

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const executionPolicyEventSchema = object({
  kind: { const: 'execution_policy' },
  policy: executionPolicySchema,
  configurationHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  budgetMs: { type: 'number', exclusiveMinimum: 0, maximum: 120000 },
});
export const retryEventSchema = object({
  kind: { const: 'retry_scheduled' },
  version: { const: 'adp-03-v1' },
  retryKind: { enum: ['PROVIDER_RETRY', 'SCHEMA_RETRY'] },
  purpose: { enum: ['query', 'rerank', 'generate', 'evaluate', 'normalize', 'recommend'] },
  ordinal: { type: 'integer', minimum: 1, maximum: 3 },
  delayMs: { type: 'number', minimum: 0, maximum: 120000 },
  reason: {
    enum: ['HTTP_408', 'HTTP_429', 'HTTP_5XX', 'SCHEMA_PARSE_FAILED', 'POST_VALIDATION_FAILED'],
  },
});

export function executionPolicyHash(policy: ExecutionPolicy): string {
  return createHash('sha256')
    .update(JSON.stringify(parseExecutionPolicy(policy)))
    .digest('hex');
}

export function validExecutionPolicyTrace(data: ExecutionPolicyTrace): boolean {
  try {
    return data.configurationHash === executionPolicyHash(data.policy);
  } catch {
    return false;
  }
}

export function validRetryTrace(data: RetryTrace): boolean {
  const schema = data.reason === 'SCHEMA_PARSE_FAILED' || data.reason === 'POST_VALIDATION_FAILED';

  return (
    (data.retryKind === 'SCHEMA_RETRY') === schema &&
    (!schema || !['query', 'rerank'].includes(data.purpose))
  );
}
