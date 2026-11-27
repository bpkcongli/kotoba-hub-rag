import contractSchema from '@contracts/v1/contract.schema.json' with { type: 'json' };
import domainSchema from '@contracts/v1/domain.schema.json' with { type: 'json' };
import type { ValidateFunction } from 'ajv';
import { Ajv } from 'ajv';
import { default as formats } from 'ajv-formats';
import { type ContractValidators, type Requests } from '@/contracts/types';
import type {
  ErrorResponse,
  EvaluateRequest,
  EvaluateResponse,
  GenerateRequest,
  GenerateResponse,
  HealthResponse,
  NormalizeRequest,
  NormalizeResponse,
  RecommendRequest,
  RecommendResponse,
} from '@/contracts/v1.generated';
import { type Operation } from '@/shared/operations';

export function createContractValidators(): ContractValidators {
  const ajv = new Ajv({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });

  // Call the ajv-formats CommonJS export through .default under NodeNext.
  formats.default(ajv);

  for (const schema of [domainSchema, contractSchema]) {
    ajv.addSchema(schema);
  }

  const compile = <T>(name: string): ValidateFunction<T> =>
    ajv.compile<T>({
      $ref: `https://kotobahub.invalid/contracts/v1/contract.schema.json#/definitions/${name}`,
    });

  return {
    requests: {
      generate: compile<GenerateRequest>('GenerateRequest'),
      evaluate: compile<EvaluateRequest>('EvaluateRequest'),
      normalize: compile<NormalizeRequest>('NormalizeRequest'),
      recommend: compile<RecommendRequest>('RecommendRequest'),
    },
    responses: {
      generate: compile<GenerateResponse>('GenerateResponse'),
      evaluate: compile<EvaluateResponse>('EvaluateResponse'),
      normalize: compile<NormalizeResponse>('NormalizeResponse'),
      recommend: compile<RecommendResponse>('RecommendResponse'),
    },
    error: compile<ErrorResponse>('ErrorResponse'),
    health: compile<HealthResponse>('HealthResponse'),
  };
}

export type AdmissionResult<T> =
  | { ok: true; request: T; remainingMs: number }
  | { ok: false; code: 'INVALID_INPUT' | 'UNSUPPORTED_LEVEL' | 'TIMEOUT' };

// Pure policy with an explicit clock; API-01 handles registry, authentication, and corpus checks.
export function validateRequest<K extends Operation>(
  validators: ContractValidators,
  operation: K,
  input: unknown,
  nowMs: number,
  headerRequestId?: string,
): AdmissionResult<Requests[K]> {
  const validate = validators.requests[operation];

  if (!validate(input)) {
    return { ok: false, code: 'INVALID_INPUT' };
  }

  if (
    input.request_id !== input.payload.metadata.requestId ||
    (headerRequestId !== undefined && input.request_id !== headerRequestId)
  ) {
    return { ok: false, code: 'INVALID_INPUT' };
  }

  if (!['JLPT_N5', 'JLPT_N4'].includes(input.payload.context.targetLevel)) {
    return { ok: false, code: 'UNSUPPORTED_LEVEL' };
  }

  const remainingMs = Math.min(input.timeout_ms, Date.parse(input.deadline_at) - nowMs);

  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return { ok: false, code: 'TIMEOUT' };
  }

  return { ok: true, request: input, remainingMs };
}
