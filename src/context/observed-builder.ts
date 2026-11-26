import type { OpenAiConfig } from '@/adapters/openai-config';
import { systemClock } from '@/adapters/system-clock';
import { buildContext } from '@/context/builder';
import { ContextError } from '@/context/types';
import type { ContextConfig } from '@/context/types';
import type { Operation, Requests } from '@/contracts/validator';
import { validPayload } from '@/generation/schema';
import type { ObservationStore } from '@/observability/store';
import type { ContextCandidate } from '@/retrieval/types';
import type { CallContext, Clock } from '@/shared/ports';

export function createContextBuilder(
  config: ContextConfig,
  generator: OpenAiConfig,
  observations: ObservationStore,
  clock: Clock = systemClock,
) {
  config = structuredClone(config);

  if (
    config.outputReserveTokens !== generator.maxOutputTokens ||
    config.maxInputChars !== generator.maxInputChars
  ) {
    throw new ContextError('INVALID_INPUT');
  }

  // Both RAG modes use the same instance/configuration. No provider or retrieval call here.
  return async (
    operation: Operation,
    request: Requests[Operation],
    candidates: readonly ContextCandidate[],
    targetSkillCodes: readonly string[],
    context: CallContext,
  ) => {
    observations.assertAdmittedRequest(context.executionId, {
      requestId: request.request_id,
      mode: request.mode,
      operation,
      request,
      ...(request.experiment === undefined
        ? {}
        : {
            experiment: {
              experimentId: request.experiment.experiment_id,
              caseId: request.experiment.case_id,
              repetition: request.experiment.repetition,
            },
          }),
    });

    if (!validPayload(operation, request)) {
      throw new ContextError('INVALID_INPUT');
    }

    const started = clock.monotonicMs();
    const timestamp = clock.now().toISOString();
    const remainingMs =
      Math.min(Date.parse(context.deadlineAt), Date.parse(request.deadline_at)) -
      clock.now().getTime();
    const checkDeadline = (): void => {
      if (
        !Number.isFinite(remainingMs) ||
        clock.monotonicMs() - started >= remainingMs ||
        context.signal.aborted
      ) {
        throw new ContextError('TIMEOUT');
      }
    };

    checkDeadline();

    const result = buildContext(config, operation, request, candidates, targetSkillCodes);
    checkDeadline();

    await observations.record(
      context.executionId,
      result.trace,
      Math.max(0, clock.monotonicMs() - started),
      timestamp,
    );
    checkDeadline();

    return result;
  };
}
