import type { Requests } from '@/contracts/types';
import type { CallContext } from '@/modules/execution/application/public';
import type { RubricBundle } from '@/modules/knowledge/application/public';
import { buildContext } from '@/modules/rag/application/context/builder';
import { validPayload } from '@/modules/rag/application/generation/schema';
import type { GenerationSettings } from '@/modules/rag/application/models/generator-config';
import type { RagExecutionPort } from '@/modules/rag/application/ports/execution';
import type { ContextConfig } from '@/modules/rag/domain/models/context';
import { ContextError } from '@/modules/rag/domain/models/context';
import type { ContextCandidate } from '@/modules/rag/domain/models/retrieval';
import type { Clock } from '@/shared/clock';
import type { Operation } from '@/shared/operations';
import { systemClock } from '@/shared/system-clock';

export function createContextBuilder(
  config: ContextConfig,
  generator: GenerationSettings,
  observations: RagExecutionPort,
  clock: Clock = systemClock,
  rubric?: RubricBundle | null,
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

    const result = buildContext(config, operation, request, candidates, targetSkillCodes, rubric);
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
