import domainSchema from '@contracts/v1/domain.schema.json' with { type: 'json' };
import httpSchema from '@contracts/v1/http.schema.json' with { type: 'json' };
import type { ValidateFunction } from 'ajv';
import { Ajv } from 'ajv';
import { default as formats } from 'ajv-formats';
import type { Requests, Responses } from '@/contracts/types';
import type { ErrorResponse, HealthResponse } from '@/contracts/v1.generated';
import type { Operation } from '@/shared/operations';

type WordKey<S extends string> = S extends Uppercase<S> ? Lowercase<S> : S;
type CamelKey<S extends string> =
  WordKey<S> extends `${infer Head}_${infer Tail}`
    ? `${Head}${Capitalize<CamelKey<Tail>>}`
    : WordKey<S>;

export type HttpBody<T> = T extends readonly unknown[]
  ? { [I in keyof T]: HttpBody<T[I]> }
  : T extends object
    ? { [K in keyof T as K extends string ? CamelKey<K> : K]: HttpBody<T[K]> }
    : T;

export interface HttpContractValidators {
  readonly requests: { [K in Operation]: ValidateFunction<HttpBody<Requests[K]>> };
  readonly responses: { [K in Operation]: ValidateFunction<HttpBody<Responses[K]>> };
  readonly error: ValidateFunction<HttpBody<ErrorResponse>>;
  readonly health: ValidateFunction<HealthResponse>;
}

export function createHttpContractValidators(): HttpContractValidators {
  const ajv = new Ajv({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  formats.default(ajv);
  ajv.addSchema(domainSchema);
  ajv.addSchema(httpSchema);

  const compile = <T>(name: string): ValidateFunction<T> =>
    ajv.compile<T>({
      $ref: `${httpSchema.$id}#/definitions/${name}`,
    });

  return {
    requests: {
      generate: compile('GenerateRequest'),
      evaluate: compile('EvaluateRequest'),
      normalize: compile('NormalizeRequest'),
      recommend: compile('RecommendRequest'),
    },
    responses: {
      generate: compile('GenerateResponse'),
      evaluate: compile('EvaluateResponse'),
      normalize: compile('NormalizeResponse'),
      recommend: compile('RecommendResponse'),
    },
    error: compile('ErrorResponse'),
    health: compile('HealthResponse'),
  };
}

export function toHttpBody(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toHttpBody);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      (key === key.toUpperCase() ? key.toLowerCase() : key).replace(
        /_([a-z])/g,
        (_match: string, letter: string) => letter.toUpperCase(),
      ),
      toHttpBody(child),
    ]),
  );
}

// Retain the internal envelope and enum-keyed question mix for runner/ledger compatibility.
export function toInternalRequest(input: HttpBody<Requests[Operation]>): unknown {
  const payload =
    'questionMix' in input.payload && input.payload.questionMix !== undefined
      ? {
          ...input.payload,
          questionMix: {
            WEAK: input.payload.questionMix.weak,
            REINFORCEMENT: input.payload.questionMix.reinforcement,
            STRETCH: input.payload.questionMix.stretch,
          },
        }
      : input.payload;

  return {
    schema_version: input.schemaVersion,
    request_id: input.requestId,
    mode: input.mode,
    corpus_version: input.corpusVersion,
    timeout_ms: input.timeoutMs,
    deadline_at: input.deadlineAt,
    payload,
    ...(input.experiment === undefined
      ? {}
      : {
          experiment: {
            experiment_id: input.experiment.experimentId,
            case_id: input.experiment.caseId,
            repetition: input.experiment.repetition,
          },
        }),
  };
}
