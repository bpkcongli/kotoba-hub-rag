import type { ValidateFunction } from 'ajv';
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

export interface ContractValidators {
  readonly requests: { [K in Operation]: ValidateFunction<Requests[K]> };

  readonly responses: { [K in Operation]: ValidateFunction<Responses[K]> };

  readonly error: ValidateFunction<ErrorResponse>;

  readonly health: ValidateFunction<HealthResponse>;
}
