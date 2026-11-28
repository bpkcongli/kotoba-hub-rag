import type { CallContext } from '@/modules/execution/application/public';
import type { RubricBundle } from '@/modules/knowledge/application/public';
import type { IndexManifest } from '@/modules/knowledge/application/public';
import { validPayload } from '@/modules/rag/application/generation/schema';
import {
  QUERY_POLICY_VERSION,
  retrievalPlan,
} from '@/modules/rag/application/pipelines/retrieval-plan';
import type { RouterPolicy, RoutingDecision } from '@/modules/rag/application/pipelines/router';
import {
  extractRouterFeatures,
  parseRouterPolicy,
  readRouterPolicy,
  routeInitialEvidence,
  routerConfigurationHash,
} from '@/modules/rag/application/pipelines/router';
import type { RagExecutionPort } from '@/modules/rag/application/ports/execution';
import type {
  ContextBuilderService,
  RetrievalStageService,
} from '@/modules/rag/application/services/stages';
import { createContractValidators, validateRequest } from '@/modules/rag/application/validation';
import type { Clock } from '@/shared/clock';
import { GenerationError } from '@/shared/errors/generation-error';
import { ObservationError } from '@/shared/errors/observation-error';
import type { Operation } from '@/shared/operations';
import { systemClock } from '@/shared/system-clock';

// Internal stage building block, not an operation runner. Caller owns sequence caps and terminal closure.
export function createAdaptiveInitialStage(
  index: IndexManifest,
  retrieve: RetrievalStageService,
  buildContext: ContextBuilderService,
  observations: RagExecutionPort,
  policy: RouterPolicy = readRouterPolicy(),
  clock: Clock = systemClock,
  rubric?: RubricBundle | null,
) {
  index = structuredClone(index);
  policy = parseRouterPolicy(policy);
  const validators = createContractValidators();

  return async (operation: Operation, input: unknown, context: CallContext) => {
    const started = clock.monotonicMs();
    const startedAt = clock.now().getTime();
    const admitted = validateRequest(validators, operation, input, clock.now().getTime());

    if (!admitted.ok) {
      throw new GenerationError(admitted.code);
    }

    const request = structuredClone(admitted.request);

    if (request.mode !== 'ADAPTIVE' || !validPayload(operation, request)) {
      throw new GenerationError('INVALID_INPUT');
    }

    observations.assertAdmittedRequest(context.executionId, {
      requestId: request.request_id,
      operation,
      mode: request.mode,
      request,
      experiment:
        request.experiment === undefined
          ? null
          : {
              experimentId: request.experiment.experiment_id,
              caseId: request.experiment.case_id,
              repetition: request.experiment.repetition,
            },
    });

    if (request.corpus_version !== index.corpusVersion) {
      throw new GenerationError('SNAPSHOT_MISMATCH');
    }

    const remaining = Math.min(
      request.timeout_ms,
      Date.parse(request.deadline_at) - startedAt,
      Date.parse(context.deadlineAt) - startedAt,
    );
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    const checkDeadline = (): void => {
      context.control?.check();

      if (
        !Number.isFinite(remaining) ||
        remaining <= 0 ||
        signal.aborted ||
        clock.monotonicMs() - started >= remaining
      ) {
        throw new GenerationError('TIMEOUT');
      }
    };

    checkDeadline();
    const timer = context.control
      ? undefined
      : setTimeout(
          () => controller.abort(),
          Math.max(1, remaining - (clock.monotonicMs() - started)),
        );
    const callContext: CallContext = {
      executionId: context.executionId,
      deadlineAt: new Date(
        Math.min(
          startedAt + remaining,
          clock.now().getTime() + remaining - (clock.monotonicMs() - started),
        ),
      ).toISOString(),
      signal,
      ...(context.control === undefined ? {} : { control: context.control }),
      accounting: { phase: 'ONLINE', retryKind: 'INITIAL' },
    };

    try {
      const plan = retrievalPlan(operation, request, rubric);
      checkDeadline();
      const retrieved = await retrieve(plan.query, plan.filter, 1, callContext);
      checkDeadline();
      const built = await buildContext(
        operation,
        request,
        retrieved.candidates,
        plan.targetSkillCodes,
        callContext,
      );
      checkDeadline();

      const span = observations.startSpan(context.executionId, 'routing');
      let spanFinished = false;

      try {
        const features = extractRouterFeatures(plan.targetSkillCodes, retrieved.candidates, built);
        const decision: RoutingDecision = {
          kind: 'routing_decided',
          policy,
          configurationHash: routerConfigurationHash(policy),
          retrievalConfigurationHash: retrieved.trace.configurationHash,
          contextConfigurationHash: built.trace.configurationHash,
          queryPolicyVersion: QUERY_POLICY_VERSION,
          features,
          ...routeInitialEvidence(policy, features),
          finalPath: null,
          stageCount: 1,
        };
        await observations.record(
          context.executionId,
          decision,
          Math.max(0, clock.monotonicMs() - started),
        );
        checkDeadline();
        spanFinished = true;
        await span.finish('SUCCESS', null);
        checkDeadline();

        return { request, plan, retrieved, built, decision };
      } catch (error) {
        if (error instanceof ObservationError && error.code === 'TRACE_WRITE_FAILED') {
          throw error;
        }

        const timeout = error instanceof GenerationError && error.code === 'TIMEOUT';

        if (!spanFinished) {
          await span.finish(timeout ? 'TIMEOUT' : 'FAILED', timeout ? 'TIMEOUT' : 'INVALID_INPUT');
        }

        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
  };
}
