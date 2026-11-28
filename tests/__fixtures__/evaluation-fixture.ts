import { outputFor, requestFor } from '@tests/__fixtures__/generation-fixture';
import type { Requests } from '@/contracts/types';

export interface EvaluationScenario {
  name: string;
  request: Requests['evaluate'];
  output: unknown;
  expected: null | 'SCHEMA_PARSE_FAILED' | 'POST_VALIDATION_FAILED';
}

// These fixtures exercise transport/schema compatibility, not the semantic quality of a grader.
export function evaluationScenarios(): EvaluationScenario[] {
  const scenarios: EvaluationScenario[] = [];
  const variants = [
    ['kana', 'わたしはがくせいです。', null],
    ['kanji', 'わたしはがくせいです。', '私は学生です。'],
    ['mixed', 'わたしはがくせいです。', 'わたしは学生です。'],
    ['without-full-stop', 'わたしはがくせいです', '私は学生です'],
    ['full-width-space', 'わたしは　がくせいです。', '私は　学生です。'],
  ] as const;

  for (let index = 0; index < 4; index++) {
    const base = requestFor('evaluate', index);
    const level = base.payload.context.targetLevel;
    const locale = base.payload.language.translationLocale;

    for (const [variant, normalizedKana, normalizedKanji] of variants) {
      const request = structuredClone(base);
      request.payload.userAnswer = {
        rawInputRomaji: 'watashi wa gakusei desu',
        normalizedKana,
        normalizedKanji,
      };

      scenarios.push({
        name: `${level}/${locale}/${variant}`,
        request,
        output: outputFor('evaluate', index),
        expected: null,
      });
    }

    const feedbackRequest = structuredClone(base);
    feedbackRequest.payload.language.feedbackLocale = locale === 'en' ? 'id' : 'en';
    const feedbackOutput = outputFor('evaluate', index);
    feedbackOutput.feedbackText =
      locale === 'en'
        ? 'Kalimatmu menyampaikan makna yang diminta.'
        : 'Your sentence expresses the requested meaning.';

    scenarios.push({
      name: `${level}/${locale}/separate-feedback-locale`,
      request: feedbackRequest,
      output: feedbackOutput,
      expected: null,
    });
  }

  const request = requestFor('evaluate');
  const output = outputFor('evaluate');

  for (const numericScore of [0, 49.5, 100]) {
    scenarios.push({
      name: `score-boundary/${numericScore}`,
      request: structuredClone(request),
      output: {
        isCorrect: numericScore === 100,
        numericScore,
        feedbackText: 'Synthetic score fixture; not a model quality assessment.',
      },
      expected: null,
    });
  }

  for (const [name, feedbackText] of [
    ['ascii-500', 'a'.repeat(500)],
    ['unicode-500', '🙂'.repeat(500)],
  ]) {
    scenarios.push({
      name: `feedback-boundary/${name}`,
      request: structuredClone(request),
      output: { ...output, feedbackText },
      expected: null,
    });
  }

  const negatives: readonly (readonly [string, unknown])[] = [
    ['null', null],
    ['array', [output]],
    ['missing-isCorrect', { numericScore: 100, feedbackText: 'Feedback.' }],
    ['missing-numericScore', { isCorrect: true, feedbackText: 'Feedback.' }],
    ['missing-feedbackText', { isCorrect: true, numericScore: 100 }],
    ['wrong-isCorrect-type', { ...output, isCorrect: 'true' }],
    ['wrong-score-type', { ...output, numericScore: '100' }],
    ['negative-score', { ...output, numericScore: -0.01 }],
    ['score-over-100', { ...output, numericScore: 100.01 }],
    ['null-score', { ...output, numericScore: null }],
    ['empty-feedback', { ...output, feedbackText: '' }],
    ['feedback-over-500', { ...output, feedbackText: 'a'.repeat(501) }],
    ['unicode-feedback-over-500', { ...output, feedbackText: '🙂'.repeat(501) }],
    ['wrong-feedback-type', { ...output, feedbackText: ['Feedback.'] }],
    ['extra-progress', { ...output, masteryDelta: 1 }],
    ['extra-metadata', { ...output, traceId: 'forbidden' }],
  ];

  for (const [name, value] of negatives) {
    scenarios.push({
      name: `invalid-output/${name}`,
      request: structuredClone(request),
      output: value,
      expected: 'SCHEMA_PARSE_FAILED',
    });
  }

  return scenarios;
}
