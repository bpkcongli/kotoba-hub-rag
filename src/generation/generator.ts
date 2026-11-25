import type { OpenAiConfig } from '@/adapters/openai-config';
import { GenerationError } from '@/adapters/openai-responses';
import type { Operation, Requests } from '@/contracts/validator';
import { generationInput } from '@/generation/input';
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
    const serialized = generationInput(request, evidence);
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
