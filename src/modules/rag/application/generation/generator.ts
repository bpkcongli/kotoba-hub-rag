import type { Requests } from '@/contracts/types';
import type { CallContext } from '@/modules/execution/application/public';
import type { RubricBundle } from '@/modules/knowledge/application/public';
import {
  assessmentSchema,
  parseAssessment,
  scoreAssessment,
  gradingBinding,
  gradingInstructions,
  GRADING_PROMPT_VERSION,
} from '@/modules/rag/application/generation/grading';
import { generationInput } from '@/modules/rag/application/generation/input';
import { aiInstructions } from '@/modules/rag/application/generation/prompt';
import {
  operationSchema,
  SCHEMA_NAMES,
  validateOutput,
} from '@/modules/rag/application/generation/schema';
import type { GenerationSettings } from '@/modules/rag/application/models/generator-config';
import type { RagExecutionPort } from '@/modules/rag/application/ports/execution';
import type { GeneratorPort } from '@/modules/rag/application/ports/inference';
import type { Evidence } from '@/modules/rag/domain/models/evidence';
import { GenerationError } from '@/shared/errors/generation-error';
import type { Operation } from '@/shared/operations';

// RAG-02 supplies already selected/budgeted evidence. No retrieval dependency belongs here.
export function createOperationGenerator(
  provider: GeneratorPort,
  config: GenerationSettings,
  bundle?: RubricBundle | null,
  observations?: RagExecutionPort,
) {
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
    if (operation === 'evaluate' && bundle !== undefined) {
      if (!bundle || !observations) {
        throw new GenerationError('DEPENDENCY_NOT_READY');
      }

      const guidanceRefs = gradingBinding(bundle, request, evidence);
      const binding = {
        version: 'uc-02-v1' as const,
        policyRef: bundle.policyRef,
        guidanceRefs,
        corpusVersion: bundle.corpusVersion,
        promptVersion: GRADING_PROMPT_VERSION,
        scoringAlgorithmVersion: 'SUM_THEN_CAP_V1' as const,
      } as const;

      await observations.record(
        context.executionId,
        { ...binding, kind: 'grading_binding', outcome: 'PENDING', scores: null, reason: null },
        0,
      );

      const instructions = gradingInstructions(bundle);
      const input = generationInput(request, evidence);

      const attempt = async (current: CallContext) => {
        const result = await provider.generate(
          {
            operation,
            model: models.generation,
            instructions,
            input,
            schemaName: 'FreeResponseAssessmentV1',
            jsonSchema: assessmentSchema,
          },
          current,
        );
        let value: unknown;

        try {
          value = JSON.parse(result.outputText);
        } catch {
          throw new GenerationError('SCHEMA_PARSE_FAILED');
        }

        return { assessment: parseAssessment(value), usage: result.usage };
      };

      const result = context.control
        ? await context.control.schema(context, attempt)
        : await attempt(context);
      const assessment = result.assessment;

      await observations.record(
        context.executionId,
        {
          ...binding,
          kind: 'grading_assessed',
          outcome: assessment.outcome,
          scores: assessment.outcome === 'GRADED' ? assessment.scores : null,
          reason: assessment.outcome === 'UNGRADABLE' ? assessment.reason : null,
        },
        0,
      );

      if (assessment.outcome === 'UNGRADABLE') {
        throw new GenerationError('POST_VALIDATION_FAILED');
      }

      return {
        data: { ...scoreAssessment(assessment.scores), feedbackText: assessment.feedbackText },
        usage: result.usage,
      };
    }

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
