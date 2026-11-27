import type { Requests } from '@/contracts/types';
import type { CallContext } from '@/modules/execution/application/public';
import { generationInput } from '@/modules/rag/application/generation/input';
import { aiInstructions } from '@/modules/rag/application/generation/prompt';
import {
  operationSchema,
  SCHEMA_NAMES,
  validateOutput,
} from '@/modules/rag/application/generation/schema';
import type { GenerationSettings } from '@/modules/rag/application/models/generator-config';
import type { GeneratorPort } from '@/modules/rag/application/ports/inference';
import type { Evidence } from '@/modules/rag/domain/models/evidence';
import { GenerationError } from '@/shared/errors/generation-error';
import type { Operation } from '@/shared/operations';

// RAG-02 supplies already selected/budgeted evidence. No retrieval dependency belongs here.
export function createOperationGenerator(provider: GeneratorPort, config: GenerationSettings) {
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
    const attempt = async (context: CallContext) => {
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

    return context.control ? context.control.schema(context, attempt) : attempt(context);
  };
}
