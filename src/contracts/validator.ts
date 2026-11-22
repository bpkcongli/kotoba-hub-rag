import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';
import { default as formats } from 'ajv-formats';
import type {
  GenerateRequest,
  EvaluateRequest,
  NormalizeRequest,
  RecommendRequest,
  GenerateResponse,
  EvaluateResponse,
  NormalizeResponse,
  RecommendResponse,
  ErrorResponse,
  HealthResponse,
} from '@/contracts/v1.generated';

export interface Requests {
  generate: GenerateRequest;
  evaluate: EvaluateRequest;
  normalize: NormalizeRequest;
  recommend: RecommendRequest;
}

export interface Responses {
  generate: GenerateResponse;
  evaluate: EvaluateResponse;
  normalize: NormalizeResponse;
  recommend: RecommendResponse;
}

export type Operation = keyof Requests;
export type Mode = GenerateRequest['mode'];

export interface ContractValidators {
  readonly requests: { [K in Operation]: ValidateFunction<Requests[K]> };
  readonly responses: { [K in Operation]: ValidateFunction<Responses[K]> };
  readonly error: ValidateFunction<ErrorResponse>;
  readonly health: ValidateFunction<HealthResponse>;
}

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

  for (const file of ['domain', 'contract']) {
    const schema: unknown = JSON.parse(
      readFileSync(new URL(`../../contracts/v1/${file}.schema.json`, import.meta.url), 'utf8'),
    );

    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
      throw new Error('Schema kontrak bukan object');
    }

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
