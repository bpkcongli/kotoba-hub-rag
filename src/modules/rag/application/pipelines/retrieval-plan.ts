import type { Requests } from '@/contracts/types';
import { assertRubricBundle, type RubricBundle } from '@/modules/knowledge/application/public';
import type { RetrievalFilter } from '@/modules/knowledge/application/public';
import { GenerationError } from '@/shared/errors/generation-error';
import type { Operation } from '@/shared/operations';

export const QUERY_POLICY_VERSION = 'rag-03-query-v1';

// Shared initial plan for both RAG modes; no model call, learner identifiers or evaluator fields.
export function retrievalPlan(
  operation: Operation,
  request: Requests[Operation],
  rubric?: RubricBundle | null,
): {
  readonly query: string;

  readonly filter: RetrievalFilter;

  readonly targetSkillCodes: readonly string[];
} {
  const payload = request.payload;
  const { context, language } = payload;
  const skills =
    'question' in payload
      ? context.catalog.filter((skill) => skill.skillCode === payload.question.skillCode)
      : context.catalog;
  const targetSkillCodes = skills.map((skill) => skill.skillCode);

  if (
    targetSkillCodes.length < 1 ||
    targetSkillCodes.length > 64 ||
    targetSkillCodes.some((skill) => !skill.trim() || skill.length > 128) ||
    !['JLPT_N5', 'JLPT_N4'].includes(context.targetLevel)
  ) {
    throw new GenerationError('INVALID_INPUT');
  }

  const focus =
    'question' in request.payload
      ? {
          sourceSentence: request.payload.question.sourceSentence,
          referenceAnswer: request.payload.question.referenceAnswer,
          normalizedAnswer:
            request.payload.userAnswer.normalizedKanji ?? request.payload.userAnswer.normalizedKana,
        }
      : 'note' in request.payload
        ? { note: request.payload.note.trim() }
        : 'difficultyBand' in request.payload
          ? {
              difficultyBand: request.payload.difficultyBand,
              allowedQuestionTypes: context.allowedQuestionTypes,
              weakSkillCodes: context.weakSkillCodes,
            }
          : { weakSkillCodes: context.weakSkillCodes, currentUnitSlug: context.currentUnitSlug };
  const query = JSON.stringify({
    version: QUERY_POLICY_VERSION,
    operation,
    targetLevel: context.targetLevel,
    translationLocale: language.translationLocale,
    skills: skills.map(({ skillCode, title }) => ({ skillCode, title })),
    focus,
  });

  if (query.length > 8192) {
    throw new GenerationError('INVALID_INPUT');
  }

  if (operation === 'evaluate' && rubric !== undefined) {
    if (!rubric) {
      throw new GenerationError('DEPENDENCY_NOT_READY');
    }

    assertRubricBundle(rubric);

    if (request.corpus_version !== rubric.corpusVersion) {
      throw new GenerationError('SNAPSHOT_MISMATCH');
    }

    if (
      !('question' in payload) ||
      !rubric.guidances.some(
        (item) =>
          item.content.scope.skillCode === payload.question.skillCode &&
          item.content.locale === language.translationLocale &&
          `JLPT_${item.content.scope.jlptLevel}` === context.targetLevel,
      )
    ) {
      throw new GenerationError('INSUFFICIENT_EVIDENCE');
    }
  }

  return {
    query,
    targetSkillCodes,
    filter: {
      published: true,
      corpusVersion: request.corpus_version,
      targetLevel: context.targetLevel === 'JLPT_N5' ? 'JLPT_N5' : 'JLPT_N4',
      skillCodes: targetSkillCodes,
      ...(operation === 'evaluate' && rubric
        ? {
            language: language.translationLocale === 'id' ? ('ID' as const) : ('EN' as const),
            contentType: 'RUBRIC' as const,
            policyRef: rubric.policyRef,
          }
        : {}),
    },
  };
}
