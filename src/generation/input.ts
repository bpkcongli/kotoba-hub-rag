import type { Operation, Requests } from '@/contracts/validator';
import type { Evidence } from '@/shared/ports';

// One serializer for budget planning and every generator mode. No envelope/experiment labels.
export function generationInput(
  request: Requests[Operation],
  evidence: readonly Evidence[],
): string {
  const parameters =
    'questionCount' in request.payload
      ? {
          questionCount: request.payload.questionCount,
          difficultyBand: request.payload.difficultyBand,
          questionMix: request.payload.questionMix ?? {
            WEAK: 0.6,
            REINFORCEMENT: 0.3,
            STRETCH: 0.1,
          },
        }
      : 'question' in request.payload
        ? { question: request.payload.question, userAnswer: request.payload.userAnswer }
        : 'note' in request.payload
          ? { note: request.payload.note.trim() }
          : {};

  return JSON.stringify({
    context: request.payload.context,
    language: request.payload.language,
    ...parameters,
    evidence: evidence.map(({ sourceId, chunkId, text }) => ({ sourceId, chunkId, text })),
  });
}
