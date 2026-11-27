import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiConfig } from '@/bootstrap/config';
import type { ContractValidators } from '@/contracts/types';
import type { ExecutionRegistryService } from '@/modules/execution/application/public';
import { validPayload } from '@/modules/rag/application/generation/schema';
import { pipelineFailure } from '@/modules/rag/application/pipelines/failure';
import type { RagService } from '@/modules/rag/application/services/rag.service';
import { validateRequest } from '@/modules/rag/application/validation';
import { errorResponse, errorRule } from '@/modules/rag/interface/primary/rest/errors';
import {
  createHttpContractValidators,
  toHttpBody,
  toInternalRequest,
} from '@/modules/rag/interface/primary/rest/http-contract';
import type { Clock } from '@/shared/clock';
import type { TraceCode } from '@/shared/errors/failure-code';
import { GenerationError } from '@/shared/errors/generation-error';
import { ObservationError } from '@/shared/errors/observation-error';
import type { Mode, Operation } from '@/shared/operations';

export interface OperationRoutesOptions {
  readonly config: ApiConfig;
  readonly clock: Clock;
  readonly contracts: ContractValidators;
  readonly operations: RagService;
  readonly registry: ExecutionRegistryService;
  readonly availableModes: readonly Mode[];
}

export const operationPaths: Readonly<Record<Operation, string>> = {
  generate: '/v1/practice/generate',
  evaluate: '/v1/practice/evaluate',
  normalize: '/v1/onboarding/normalize',
  recommend: '/v1/onboarding/recommend',
};

interface RequestState {
  readonly startedMs: number;
  readonly startedAt: number;
  requestId: string | null;
  executionId: string | null;
  traceId: string;
  mode: Mode | null;
  operation: Operation | null;
}

export function createOperationController(options: OperationRoutesOptions) {
  const { config, contracts, clock, operations, registry, availableModes } = options;
  const httpContracts = createHttpContractValidators();
  const states = new WeakMap<FastifyRequest, RequestState>();
  const controllers = new Set<AbortController>();
  const running = new Set<Promise<FastifyReply>>();
  const observedReady = new Set<Mode>();
  const tokenHash =
    config.token === null ? null : createHash('sha256').update(config.token).digest();
  let active = 0;
  let closing = false;

  function httpResponse(operation: Operation, response: unknown): unknown {
    const body = toHttpBody(response);

    if (!httpContracts.responses[operation](body)) {
      throw new GenerationError('POST_VALIDATION_FAILED');
    }

    return body;
  }

  function stateFor(request: FastifyRequest): RequestState {
    let state = states.get(request);

    if (!state) {
      state = {
        startedMs: clock.monotonicMs(),
        startedAt: clock.now().getTime(),
        requestId: null,
        executionId: null,
        traceId: randomUUID(),
        mode: null,
        operation:
          (Object.keys(operationPaths) as Operation[]).find(
            (operation) => request.routeOptions.url === operationPaths[operation],
          ) ?? null,
      };
      states.set(request, state);
    }

    return state;
  }

  async function reject(request: FastifyRequest, reply: FastifyReply, code: TraceCode) {
    const state = stateFor(request);

    try {
      const event = await registry.reject({ ...state, code });
      state.traceId = event.correlation.traceId;
    } catch {
      code = 'TRACE_WRITE_FAILED';
    }

    return reply.code(errorRule(code)?.status ?? 500).send(toHttpBody(errorResponse(code, state)));
  }

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    stateFor(request);

    if (tokenHash === null) {
      return reject(request, reply, 'DEPENDENCY_NOT_READY');
    }

    const authorization = request.headers.authorization;
    const supplied =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : '';
    const suppliedHash = createHash('sha256').update(supplied).digest();

    if (!timingSafeEqual(tokenHash, suppliedHash)) {
      reply.header('WWW-Authenticate', 'Bearer');

      return reject(request, reply, 'AUTH_FAILED');
    }
  };

  const handleError = async (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const errorCode = error instanceof Error && 'code' in error ? error.code : null;
    const status = error instanceof Error && 'statusCode' in error ? error.statusCode : null;
    const code =
      errorCode === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? 'PAYLOAD_TOO_LARGE'
        : errorCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
          ? 'UNSUPPORTED_MEDIA_TYPE'
          : status === 400
            ? 'INVALID_INPUT'
            : 'INTERNAL_ERROR';

    return reject(request, reply, code);
  };

  const close = async () => {
    closing = true;

    for (const controller of controllers) {
      controller.abort();
    }

    await Promise.allSettled(running);
  };

  const readiness = (_request: FastifyRequest, reply: FastifyReply) => {
    const ready =
      !closing &&
      config.corpusVersion !== null &&
      config.allowedModes.every((mode) => availableModes.includes(mode) && observedReady.has(mode));

    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready' });
  };

  const perform = async (operation: Operation, request: FastifyRequest, reply: FastifyReply) => {
    const state = stateFor(request);
    const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();

    if (contentType !== 'application/json') {
      return reject(request, reply, 'UNSUPPORTED_MEDIA_TYPE');
    }

    const body: unknown = request.body;

    if (!httpContracts.requests[operation](body)) {
      return reject(request, reply, 'INVALID_INPUT');
    }

    const input = toInternalRequest(body);

    if (!contracts.requests[operation](input)) {
      return reject(request, reply, 'INVALID_INPUT');
    }

    state.requestId = input.request_id;
    state.mode = input.mode;
    const header = request.headers['x-request-id'];

    if (
      input.request_id !== input.payload.metadata.requestId ||
      (header !== undefined && header !== input.request_id)
    ) {
      return reject(request, reply, 'INVALID_INPUT');
    }

    if (!config.allowedModes.includes(input.mode)) {
      return reject(request, reply, 'FORBIDDEN');
    }

    const admissionInput = {
      serviceId: config.serviceId,
      requestId: input.request_id,
      operation,
      mode: input.mode,
      request: input,
      ...(input.experiment === undefined
        ? {}
        : {
            experiment: {
              experimentId: input.experiment.experiment_id,
              caseId: input.experiment.case_id,
              repetition: input.experiment.repetition,
            },
          }),
    };
    const parsed = input;

    async function replay(admitted: Awaited<ReturnType<ExecutionRegistryService['admit']>>) {
      Object.assign(state, admitted.correlation);

      if (admitted.status !== 'TERMINAL' || state.executionId === null) {
        throw new GenerationError('IDEMPOTENCY_CONFLICT');
      }

      const response = await registry.readResponse(state.executionId);

      if (contracts.responses[operation](response)) {
        if (
          response.request_id !== parsed.request_id ||
          response.mode !== parsed.mode ||
          response.execution_id !== state.executionId ||
          response.meta.trace_id !== state.traceId ||
          response.meta.corpus_version !== parsed.corpus_version
        ) {
          throw new GenerationError('TRACE_WRITE_FAILED');
        }

        return reply.send(httpResponse(operation, response));
      }

      if (
        contracts.error(response) &&
        response.request_id === state.requestId &&
        response.execution_id === state.executionId &&
        response.mode === state.mode &&
        response.meta.trace_id === state.traceId
      ) {
        return reply.code(errorRule(response.error.code)?.status ?? 500).send(toHttpBody(response));
      }

      throw new GenerationError('TRACE_WRITE_FAILED');
    }

    try {
      const existing = await registry.lookup(admissionInput);

      if (existing) {
        return await replay(existing);
      }
    } catch (error) {
      const code =
        error instanceof ObservationError
          ? error.code === 'IDEMPOTENCY_CONFLICT'
            ? 'IDEMPOTENCY_CONFLICT'
            : 'TRACE_WRITE_FAILED'
          : pipelineFailure(error, false).code;

      // A duplicate never appends trace events or replaces the original terminal.
      return reply
        .code(errorRule(code)?.status ?? 500)
        .send(toHttpBody(errorResponse(code, state)));
    }

    const validated = validateRequest(contracts, operation, input, clock.now().getTime());

    if (!validated.ok) {
      return reject(request, reply, validated.code);
    }

    if (!validPayload(operation, input)) {
      return reject(request, reply, 'INVALID_INPUT');
    }

    if (config.corpusVersion === null || !availableModes.includes(input.mode)) {
      return reject(request, reply, 'DEPENDENCY_NOT_READY');
    }

    if (input.corpus_version !== config.corpusVersion) {
      return reject(request, reply, 'SNAPSHOT_MISMATCH');
    }

    if (closing || active >= config.maxConcurrent) {
      return reject(request, reply, 'CAPACITY_LIMIT');
    }

    active++;
    const controller = new AbortController();
    controllers.add(controller);
    const budgetMs = Math.min(
      input.timeout_ms,
      config.maxDeadlineMs,
      Date.parse(input.deadline_at) - state.startedAt,
    );
    const remainingMs = budgetMs - Math.max(0, clock.monotonicMs() - state.startedMs);
    const timer = setTimeout(() => controller.abort(), Math.max(0, remainingMs));
    const disconnect = () => {
      if (!reply.raw.writableFinished) {
        controller.abort();
      }
    };
    request.raw.once('aborted', disconnect);
    reply.raw.once('close', disconnect);
    let admittedHere = false;

    try {
      const admitted = await registry.admit(admissionInput);
      Object.assign(state, admitted.correlation);

      if (admitted.status !== 'admitted') {
        return await replay(admitted);
      }

      admittedHere = true;

      if (controller.signal.aborted || clock.monotonicMs() - state.startedMs >= budgetMs) {
        throw new GenerationError('TIMEOUT');
      }

      const response = await operations.execute(
        input.mode,
        operation,
        input,
        state.executionId ?? '',
        controller.signal,
      );

      if (!contracts.responses[operation](response)) {
        throw new GenerationError('POST_VALIDATION_FAILED');
      }

      const body = httpResponse(operation, response);
      await registry.storeResponse(state.executionId ?? '', response);
      observedReady.add(input.mode);

      return reply.send(body);
    } catch (error) {
      let code =
        error instanceof ObservationError
          ? error.code === 'IDEMPOTENCY_CONFLICT'
            ? 'IDEMPOTENCY_CONFLICT'
            : 'TRACE_WRITE_FAILED'
          : pipelineFailure(error, controller.signal.aborted).code;

      if (
        [
          'INFERENCE_FAILED',
          'RETRIEVAL_FAILED',
          'PROVIDER_FAILED',
          'DEPENDENCY_NOT_READY',
          'TRACE_WRITE_FAILED',
        ].includes(code)
      ) {
        observedReady.delete(input.mode);
      }

      if (!admittedHere) {
        if (state.executionId === null && code === 'TRACE_WRITE_FAILED') {
          try {
            const retained = await registry.lookup(admissionInput);

            if (retained) {
              Object.assign(state, retained.correlation);
            }
          } catch {
            // A durable admission may remain unreadable until offline reconciliation.
          }
        }

        if (state.executionId !== null) {
          return reply
            .code(errorRule(code)?.status ?? 500)
            .send(toHttpBody(errorResponse(code, state)));
        }

        return reject(request, reply, code);
      }

      try {
        // Runners own terminal writes. Only failures before runner entry need a terminal here.
        try {
          registry.assertActive(state.executionId ?? '');
          await registry.finish(
            state.executionId ?? '',
            code === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED',
            code,
          );
        } catch (terminalError) {
          if (!(
            terminalError instanceof ObservationError &&
            terminalError.code === 'EXECUTION_NOT_ACTIVE'
          )) {
            throw terminalError;
          }
        }

        if (code !== 'TRACE_WRITE_FAILED') {
          await registry.storeResponse(state.executionId ?? '', errorResponse(code, state));
        }
      } catch {
        code = 'TRACE_WRITE_FAILED';
      }

      return reply
        .code(errorRule(code)?.status ?? 500)
        .send(toHttpBody(errorResponse(code, state)));
    } finally {
      clearTimeout(timer);
      request.raw.removeListener('aborted', disconnect);
      reply.raw.removeListener('close', disconnect);
      controllers.delete(controller);
      active--;
    }
  };

  const execute = async (operation: Operation, request: FastifyRequest, reply: FastifyReply) => {
    const promise = perform(operation, request, reply);
    running.add(promise);

    return promise.finally(() => running.delete(promise));
  };

  return { authenticate, handleError, close, readiness, execute };
}
