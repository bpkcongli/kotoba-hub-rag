import { GenerationError } from '@/adapters/openai-responses';
import { systemClock } from '@/adapters/system-clock';
import type { createContextBuilder } from '@/context/observed-builder';
import { createContractValidators, validateRequest } from '@/contracts/validator';
import type { Operation } from '@/contracts/validator';
import { validPayload } from '@/generation/schema';
import { ObservationError } from '@/observability/store';
import type { ObservationStore } from '@/observability/store';
import { retrievalPlan, QUERY_POLICY_VERSION } from '@/pipelines/retrieval-plan';
import {
  extractRouterFeatures,
  parseRouterPolicy,
  readRouterPolicy,
  routeInitialEvidence,
  routerConfigurationHash,
} from '@/pipelines/router';
import type { RouterPolicy, RoutingDecision } from '@/pipelines/router';
import type { createRetrievalStage } from '@/retrieval/stage';
import type { CallContext, Clock } from '@/shared/ports';
import type { IndexManifest } from '@/storage/index-manifest';

// Internal stage building block, not an operation runner. Caller owns sequence caps and terminal closure.
export function createAdaptiveInitialStage(
  index: IndexManifest,
  retrieve: ReturnType<typeof createRetrievalStage>,
  buildContext: ReturnType<typeof createContextBuilder>,
  observations: ObservationStore,
  policy: RouterPolicy = readRouterPolicy(),
  clock: Clock = systemClock,
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
    const timer = setTimeout(
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
      accounting: { phase: 'ONLINE', retryKind: 'INITIAL' },
    };

    try {
      const plan = retrievalPlan(operation, request);
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
