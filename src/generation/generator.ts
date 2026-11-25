import type { OpenAiConfig } from '@/adapters/openai-config';
import { GenerationError } from '@/adapters/openai-responses';
import type { Operation, Requests } from '@/contracts/validator';
import { aiInstructions } from '@/generation/prompt';
import { operationSchema, SCHEMA_NAMES, validateOutput } from '@/generation/schema';
import type { CallContext, Evidence, GeneratorPort } from '@/shared/ports';

// RAG-02 supplies already selected/budgeted evidence. No retrieval dependency belongs here.
export function createOperationGenerator(provider: GeneratorPort, config: OpenAiConfig) {
  const models = Object.freeze({
    generation: config.generationModel,
    normalization: config.normalizationModel,
  });

  return async (
    operation: Operation,
    request: Requests[Operation],
    evidence: readonly Evidence[],
    context: CallContext,
  ) => {
    // Project domain fields only; metadata and experiment/evaluator labels never enter the prompt.
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
    const serialized = JSON.stringify({
      context: request.payload.context,
      language: request.payload.language,
      ...parameters,
      evidence: evidence.map(({ sourceId, chunkId, text }) => ({ sourceId, chunkId, text })),
    });
    const result = await provider.generate(
      {
        operation,
        model: operation === 'normalize' ? models.normalization : models.generation,
        instructions: aiInstructions(operation),
        input: serialized,
        schemaName: SCHEMA_NAMES[operation],
        jsonSchema: operationSchema(operation),
      },
      context,
    );

    let data: unknown;
    try {
      data = JSON.parse(result.outputText);
    } catch {
      throw new GenerationError('SCHEMA_PARSE_FAILED');
    }

    const failure = validateOutput(operation, request, data);

    if (failure !== null) {
      throw new GenerationError(failure);
    }

    return { data, usage: result.usage };
  };
}
