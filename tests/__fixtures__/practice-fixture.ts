import assert from 'node:assert/strict';
import { outputFor, requestFor } from '@tests/__fixtures__/generation-fixture';
import type { Requests, Responses } from '@/contracts/types';

type Question = Responses['generate']['data']['questions'][number];
type QuestionType = Question['questionType'];

export interface PracticeScenario {
  readonly name: string;
  readonly request: Requests['generate'];
  readonly output: unknown;
  readonly expected: null | 'SCHEMA_PARSE_FAILED' | 'POST_VALIDATION_FAILED';
}

export function practiceScenarios(): PracticeScenario[] {
  const scenarios: PracticeScenario[] = [];

  for (let index = 0; index < 4; index++) {
    const request = requestFor('generate', index);
    const output = outputFor('generate', index);
    const locale = request.payload.language.translationLocale;
    const level = request.payload.context.targetLevel;

    scenarios.push({ name: `mixed/${level}/${locale}`, request, output, expected: null });

    const mixedLanguage = structuredClone(request);
    mixedLanguage.payload.language.instructionLocale = locale === 'en' ? 'id' : 'en';
    mixedLanguage.payload.language.feedbackLocale = locale === 'en' ? 'id' : 'en';
    scenarios.push({
      name: `translation-locale-independent/${level}/${locale}`,
      request: mixedLanguage,
      output,
      expected: null,
    });

    for (const difficultyBand of ['REMEDIAL', 'STRETCH'] as const) {
      const gradedRequest = structuredClone(request);
      gradedRequest.payload.difficultyBand = difficultyBand;
      scenarios.push({
        name: `difficulty/${difficultyBand}/${level}/${locale}`,
        request: gradedRequest,
        output: {
          questions: output.questions.map((question) => ({ ...question, difficultyBand })),
        },
        expected: null,
      });
    }

    const backward = output.questions.find(
      (question) =>
        question.questionType === 'ARRANGE_TOKEN' &&
        question.promptPayload.direction.startsWith('JA_TO_'),
    );

    assert.ok(backward);

    const tokenRequest = structuredClone(request);
    tokenRequest.payload.questionCount = 1;
    tokenRequest.payload.context.allowedQuestionTypes = ['ARRANGE_TOKEN'];
    const labels =
      locale === 'en'
        ? ['Say', 'yes', ',', 'yes', '2', 'times', '.']
        : ['Katakan', 'ya', ',', 'ya', '2', 'kali', '.'];
    const arrangeTokens = labels.map((label, index) => ({ id: `token-${index}`, label }));
    scenarios.push({
      name: `backward-numeric-punctuation-repeated-label/${level}/${locale}`,
      request: tokenRequest,
      output: {
        questions: [
          {
            ...backward,
            promptPayload: {
              ...backward.promptPayload,
              sourceSentence: 'はい、はいと２回言います。',
              arrangeTokens,
            },
            expectedAnswer: { acceptedTokenOrders: [arrangeTokens.map((token) => token.id)] },
          },
        ],
      },
      expected: null,
    });

    for (const question of output.questions) {
      const single = structuredClone(request);
      single.payload.questionCount = 1;
      single.payload.context.allowedQuestionTypes = [question.questionType];
      const direction =
        question.questionType === 'ARRANGE_TOKEN' ? `/${question.promptPayload.direction}` : '';

      scenarios.push({
        name: `${question.questionType}/${level}/${locale}${direction}`,
        request: single,
        output: { questions: [question] },
        expected: null,
      });
    }
  }

  const base = requestFor('generate');
  const questions = outputFor('generate').questions;
  const find = (type: QuestionType) => {
    const question = questions.find((item) => item.questionType === type);

    assert.ok(question);

    return question;
  };
  const add = (
    name: string,
    type: QuestionType,
    patch: Record<string, unknown>,
    expected: PracticeScenario['expected'] = 'POST_VALIDATION_FAILED',
  ) => {
    const request = structuredClone(base);
    request.payload.questionCount = 1;
    request.payload.context.allowedQuestionTypes = [type];

    scenarios.push({
      name,
      request,
      output: { questions: [{ ...find(type), ...patch }] },
      expected,
    });
  };
  const prompt = (type: QuestionType, patch: Record<string, unknown>) => ({
    promptPayload: { ...find(type).promptPayload, ...patch },
  });

  for (const type of [
    'SHORT_FREE_RESPONSE',
    'SLOT_FILL',
    'ARRANGE_TOKEN',
    'FREE_RESPONSE',
  ] as const) {
    add(`${type}/unknown-skill`, type, { skillCode: 'outside_catalog' });
    add(`${type}/wrong-difficulty`, type, { difficultyBand: 'STRETCH' });
    add(`${type}/extra-property`, type, { traceId: 'forbidden' }, 'SCHEMA_PARSE_FAILED');
    add(
      `${type}/wrong-grading-strategy`,
      type,
      { gradingStrategy: type === 'FREE_RESPONSE' ? 'DETERMINISTIC' : 'AI' },
      'SCHEMA_PARSE_FAILED',
    );

    const request = structuredClone(base);
    request.payload.questionCount = 1;
    request.payload.context.allowedQuestionTypes =
      type === 'FREE_RESPONSE' ? ['SHORT_FREE_RESPONSE'] : ['FREE_RESPONSE'];

    scenarios.push({
      name: `${type}/disallowed-type`,
      request,
      output: { questions: [find(type)] },
      expected: 'POST_VALIDATION_FAILED',
    });
    scenarios.push({
      name: `${type}/wrong-count`,
      request: {
        ...request,
        payload: {
          ...request.payload,
          questionCount: 2,
          context: { ...request.payload.context, allowedQuestionTypes: [type] },
        },
      },
      output: { questions: [find(type)] },
      expected: 'POST_VALIDATION_FAILED',
    });
  }

  for (const type of ['SHORT_FREE_RESPONSE', 'SLOT_FILL'] as const) {
    for (const [name, sentenceTemplate] of [
      ['missing-blank', 'わたしはがくせいです。'],
      ['multiple-blanks', 'わたし___がくせい___。'],
      ['non-japanese', 'I ___ a student.'],
      ['markup', '<b>わたし</b>___です。'],
    ]) {
      add(`${type}/${name}`, type, prompt(type, { sentenceTemplate }));
    }

    add(`${type}/slot-count`, type, prompt(type, { slotCount: 2 }), 'SCHEMA_PARSE_FAILED');
  }

  for (const answer of ['ha', '学生', 'ーー', '<は>']) {
    add(`SHORT_FREE_RESPONSE/invalid-kana/${answer}`, 'SHORT_FREE_RESPONSE', {
      expectedAnswer: { acceptedTextAnswers: [answer] },
    });
  }
  add(
    'SHORT_FREE_RESPONSE/empty-answers',
    'SHORT_FREE_RESPONSE',
    { expectedAnswer: { acceptedTextAnswers: [] } },
    'SCHEMA_PARSE_FAILED',
  );

  const slot = find('SLOT_FILL');

  assert.equal(slot.questionType, 'SLOT_FILL');

  if (slot.questionType === 'SLOT_FILL') {
    const options = slot.promptPayload.options;
    const first = options[0];

    assert.ok(first);

    add(
      'SLOT_FILL/three-options',
      'SLOT_FILL',
      prompt('SLOT_FILL', { options: options.slice(1) }),
      'SCHEMA_PARSE_FAILED',
    );
    add(
      'SLOT_FILL/duplicate-option-id',
      'SLOT_FILL',
      prompt('SLOT_FILL', {
        options: options.map((option) => ({ ...option, id: first.id })),
      }),
    );
    add(
      'SLOT_FILL/normalized-duplicate-label',
      'SLOT_FILL',
      prompt('SLOT_FILL', {
        options: options.map((option, index) => ({
          ...option,
          label: index === 0 ? 'ハ' : index === 1 ? 'ﾊ' : option.label,
        })),
      }),
    );
    add(
      'SLOT_FILL/non-japanese-option',
      'SLOT_FILL',
      prompt('SLOT_FILL', {
        options: options.map((option, index) =>
          index === 0 ? { ...option, label: 'ha' } : option,
        ),
      }),
    );
    add('SLOT_FILL/unknown-correct-option', 'SLOT_FILL', {
      expectedAnswer: { correctOptionId: 'missing' },
    });
  }

  const arrange = find('ARRANGE_TOKEN');

  assert.equal(arrange.questionType, 'ARRANGE_TOKEN');

  if (arrange.questionType === 'ARRANGE_TOKEN') {
    const tokens = arrange.promptPayload.arrangeTokens;
    const first = tokens[0];

    assert.ok(first);

    for (const [name, order] of [
      ['duplicate', tokens.map(() => first.id)],
      ['unknown', tokens.map((_token, index) => `foreign-${index}`)],
      ['missing', [...tokens.map((token) => token.id), 'extra-token']],
    ] as const) {
      add(`ARRANGE_TOKEN/${name}-token-order`, 'ARRANGE_TOKEN', {
        expectedAnswer: { acceptedTokenOrders: [order] },
      });
    }
    add(
      'ARRANGE_TOKEN/duplicate-token-id',
      'ARRANGE_TOKEN',
      prompt('ARRANGE_TOKEN', {
        arrangeTokens: tokens.map((token) => ({ ...token, id: first.id })),
      }),
    );
    add(
      'ARRANGE_TOKEN/wrong-token-script',
      'ARRANGE_TOKEN',
      prompt('ARRANGE_TOKEN', {
        arrangeTokens: tokens.map((token) => ({ ...token, label: 'student' })),
      }),
    );
    add(
      'ARRANGE_TOKEN/wrong-locale-direction',
      'ARRANGE_TOKEN',
      prompt('ARRANGE_TOKEN', { direction: 'ID_TO_JA', promptLanguage: 'ID' }),
    );
    add(
      'ARRANGE_TOKEN/wrong-prompt-language',
      'ARRANGE_TOKEN',
      prompt('ARRANGE_TOKEN', { promptLanguage: 'JA' }),
    );
    add(
      'ARRANGE_TOKEN/wrong-answer-language',
      'ARRANGE_TOKEN',
      prompt('ARRANGE_TOKEN', { answerLanguage: 'EN' }),
    );
    add(
      'ARRANGE_TOKEN/wrong-source-script',
      'ARRANGE_TOKEN',
      prompt('ARRANGE_TOKEN', { sourceSentence: 'わたしはがくせいです。' }),
    );
    add(
      'ARRANGE_TOKEN/multiple-source-sentences',
      'ARRANGE_TOKEN',
      prompt('ARRANGE_TOKEN', { sourceSentence: 'I am a student. I study Japanese.' }),
    );
    add(
      'ARRANGE_TOKEN/empty-orders',
      'ARRANGE_TOKEN',
      { expectedAnswer: { acceptedTokenOrders: [] } },
      'SCHEMA_PARSE_FAILED',
    );
  }

  for (const [name, patch] of [
    ['wrong-locale', { promptLanguage: 'ID' }],
    ['japanese-source', { sourceSentence: 'わたしはがくせいです。' }],
    ['multiple-sentences', { sourceSentence: 'I am a student. I study Japanese.' }],
    ['newline', { sourceSentence: 'I am\na student.' }],
    ['markup', { sourceSentence: '<b>I am a student.</b>' }],
  ] as const) {
    add(`FREE_RESPONSE/${name}`, 'FREE_RESPONSE', prompt('FREE_RESPONSE', patch));
  }
  add('FREE_RESPONSE/non-japanese-reference', 'FREE_RESPONSE', {
    expectedAnswer: { referenceAnswer: 'I am a student.' },
  });
  add('FREE_RESPONSE/markup-reference', 'FREE_RESPONSE', {
    expectedAnswer: { referenceAnswer: '<b>学生です。</b>' },
  });

  const defaultRequest = structuredClone(base);
  defaultRequest.payload.questionCount = 1;
  defaultRequest.payload.context.allowedQuestionTypes = [];
  scenarios.push({
    name: 'empty-allowed-types/default-short',
    request: defaultRequest,
    output: { questions: [find('SHORT_FREE_RESPONSE')] },
    expected: null,
  });
  scenarios.push({
    name: 'empty-allowed-types/reject-free',
    request: defaultRequest,
    output: { questions: [find('FREE_RESPONSE')] },
    expected: 'POST_VALIDATION_FAILED',
  });

  for (const [name, output] of [
    ['empty-questions', { questions: [] }],
    [
      'too-many-questions',
      { questions: Array.from({ length: 21 }, () => find('SHORT_FREE_RESPONSE')) },
    ],
    [
      'unknown-question-type',
      { questions: [{ ...find('SHORT_FREE_RESPONSE'), questionType: 'MULTIPLE_CHOICE' }] },
    ],
    ['metadata-in-domain-data', { questions, meta: { traceId: 'forbidden' } }],
  ] as const) {
    scenarios.push({
      name,
      request: structuredClone(base),
      output,
      expected: 'SCHEMA_PARSE_FAILED',
    });
  }

  return scenarios;
}
