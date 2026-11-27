import domain from '@contracts/v1/domain.schema.json' with { type: 'json' };
import { Ajv } from 'ajv';
import type { Requests, Responses } from '@/contracts/types';
import { validQuestion } from '@/modules/rag/application/generation/question';
import type { Operation } from '@/shared/operations';

export const SCHEMA_NAMES = {
  generate: 'GeneratedPracticeSession',
  evaluate: 'GradedPracticeAnswer',
  normalize: 'PlacementSummary',
  recommend: 'StudyRecommendation',
} as const;

const ajv = new Ajv({
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
const schemas = domain.definitions;
const validators = {
  generate: ajv.compile<Responses['generate']['data']>(schemas.GeneratedPracticeSession),
  evaluate: ajv.compile<Responses['evaluate']['data']>(schemas.GradedPracticeAnswer),
  normalize: ajv.compile<Responses['normalize']['data']>(schemas.PlacementSummary),
  recommend: ajv.compile<Responses['recommend']['data']>(schemas.StudyRecommendation),
};

export function operationSchema(operation: Operation): Readonly<Record<string, unknown>> {
  // Independent copy prevents callers from changing the schema used by another mode.
  return structuredClone(schemas[SCHEMA_NAMES[operation]]);
}

export function validPayload(operation: Operation, request: Requests[Operation]): boolean {
  const context = request.payload.context;
  const codes = new Set(context.catalog.map((skill) => skill.skillCode));
  const lessons = new Set(context.catalog.map((skill) => skill.lessonSlug));

  if (
    codes.size !== context.catalog.length ||
    (context.currentUnitSlug !== null &&
      !context.catalog.some((skill) => skill.unitSlug === context.currentUnitSlug)) ||
    [
      ...context.weakSkillCodes,
      ...context.masteredSkillCodes,
      ...context.recentMistakes.map((item) => item.skillCode),
    ].some((code) => !codes.has(code)) ||
    context.lessonUnderstanding.some((lesson) => !lessons.has(lesson.lessonSlug))
  ) {
    return false;
  }

  if (operation === 'generate' && 'questionCount' in request.payload) {
    const mix = request.payload.questionMix;
    return mix === undefined || Math.abs(mix.WEAK + mix.REINFORCEMENT + mix.STRETCH - 1) < 0.000001;
  }

  if (operation === 'evaluate' && 'question' in request.payload) {
    return (
      codes.has(request.payload.question.skillCode) &&
      request.payload.question.promptLanguage ===
        (request.payload.language.translationLocale === 'id' ? 'ID' : 'EN')
    );
  }

  return (
    operation !== 'normalize' ||
    ('note' in request.payload && request.payload.note.trim().length > 0)
  );
}

export function validateOutput(
  operation: Operation,
  request: Requests[Operation],
  value: unknown,
): 'SCHEMA_PARSE_FAILED' | 'POST_VALIDATION_FAILED' | null {
  const context = request.payload.context;
  const allowed = context.allowedQuestionTypes.length
    ? context.allowedQuestionTypes
    : ['SHORT_FREE_RESPONSE'];

  switch (operation) {
    case 'generate': {
      if (!validators.generate(value)) {
        return 'SCHEMA_PARSE_FAILED';
      }

      if (!('questionCount' in request.payload)) {
        return 'POST_VALIDATION_FAILED';
      }

      return value.questions.length === request.payload.questionCount &&
        value.questions.every(
          (question) =>
            context.catalog.some((skill) => skill.skillCode === question.skillCode) &&
            allowed.includes(question.questionType) &&
            'difficultyBand' in request.payload &&
            question.difficultyBand === request.payload.difficultyBand &&
            validQuestion(question, request.payload.language.translationLocale),
        )
        ? null
        : 'POST_VALIDATION_FAILED';
    }
    case 'evaluate':
      return validators.evaluate(value) ? null : 'SCHEMA_PARSE_FAILED';
    case 'normalize': {
      if (!validators.normalize(value)) {
        return 'SCHEMA_PARSE_FAILED';
      }

      const codes = value.suggestedKnownSkillClaims.map((claim) => claim.skillCode);

      return new Set(codes).size === codes.length &&
        codes.every((code) => context.catalog.some((skill) => skill.skillCode === code))
        ? null
        : 'POST_VALIDATION_FAILED';
    }
    case 'recommend': {
      if (!validators.recommend(value)) {
        return 'SCHEMA_PARSE_FAILED';
      }

      const skills = context.catalog.filter(
        (skill) =>
          skill.lessonSlug === value.nextLessonSlug &&
          skill.unitSlug === value.recommendedUnitSlug &&
          skill.trackSlug === value.recommendedTrackSlug,
      );

      return skills.length > 0 &&
        new Set(value.targetSkillCodes).size === value.targetSkillCodes.length &&
        value.targetSkillCodes.every((code) => skills.some((skill) => skill.skillCode === code)) &&
        new Set(value.allowedQuestionTypes).size === value.allowedQuestionTypes.length &&
        value.allowedQuestionTypes.every((type) => allowed.includes(type))
        ? null
        : 'POST_VALIDATION_FAILED';
    }
  }
}
