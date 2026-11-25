import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  admit,
  config,
  outputFor,
  providerResponse,
  requestFor,
  setup,
  signal,
  usage,
} from '@tests/generation-fixture';
import { readOpenAiConfig } from '@/adapters/openai-config';
import { readOpenAiUsage } from '@/adapters/openai-responses';
import { createContractValidators } from '@/contracts/validator';
import type { Operation } from '@/contracts/validator';
import { operationSchema, validateOutput } from '@/generation/schema';

await test('konfigurasi OpenAI opt-in, model tetap dan error tanpa secret', () => {
  assert.equal(readOpenAiConfig({}), null);
  assert.equal(readOpenAiConfig({ OPENAI_ENABLED: 'false' }), null);

  for (const extra of [
    { OPENAI_ENABLED: 'yes' },
    { OPENAI_API_KEY: '' },
    { OPENAI_GENERATION_MODEL: 'other' },
    { OPENAI_NORMALIZATION_MODEL: 'other' },
    { OPENAI_MAX_CONCURRENCY: '0' },
    { OPENAI_MAX_OUTPUT_TOKENS: 'Infinity' },
  ]) {
    assert.throws(
      () => config(extra),
      (error: unknown) => error instanceof Error && !error.message.includes('secret-fixture-token'),
    );
  }
});

await test('usage lengkap/partial/missing/malformed mengikuti OBS-02 tanpa mengisi nol', () => {
  assert.equal(readOpenAiUsage(usage)?.reasoningTokens, 10);
  assert.equal(readOpenAiUsage(undefined), null);
  assert.equal(readOpenAiUsage({ ...usage, total_tokens: 1 }), null);
  assert.equal(readOpenAiUsage({ ...usage, input_tokens_details: { cached_tokens: 101 } }), null);
  assert.equal(
    readOpenAiUsage({ ...usage, output_tokens_details: { reasoning_tokens: 41 } }),
    null,
  );
  assert.equal(
    readOpenAiUsage({ input_tokens: 100, output_tokens: 40, total_tokens: 140 })?.cachedInputTokens,
    null,
  );
});

await test('16 fixture EN/ID N5/N4 melalui baseline/provider/schema/domain/accounting, tanpa retrieval', async (t) => {
  const operations: Operation[] = ['generate', 'evaluate', 'normalize', 'recommend'];

  for (const operation of operations) {
    for (let index = 0; index < 4; index++) {
      const request = requestFor(operation, index);
      const expected = outputFor(operation, index);
      let calls = 0;
      const state = await setup(t, (_url, options) => {
        calls++;

        assert.equal(_url, 'https://api.openai.com/v1/responses');
        assert.equal(typeof options?.body, 'string');

        const body: unknown = JSON.parse(options?.body as string);

        assert.ok(
          typeof body === 'object' &&
            body !== null &&
            'input' in body &&
            'model' in body &&
            'store' in body &&
            'text' in body,
        );
        assert.equal(body.model, operation === 'normalize' ? 'gpt-5.6-luna' : 'gpt-5.6-terra');
        assert.equal(body.store, false);
        assert.equal(
          String(body.input).includes(request.payload.metadata.userId ?? 'unreachable'),
          false,
        );
        assert.equal(String(body.input).includes('contract-only'), false);
        assert.ok(String(body.input).includes('"evidence":[]'));
        assert.deepEqual(body.text, {
          format: {
            type: 'json_schema',
            name: {
              generate: 'GeneratedPracticeSession',
              evaluate: 'GradedPracticeAnswer',
              normalize: 'PlacementSummary',
              recommend: 'StudyRecommendation',
            }[operation],
            strict: true,
            schema: operationSchema(operation),
          },
        });

        return Promise.resolve(providerResponse(expected, { model: body.model }));
      });

      const id = await admit(state.observations, operation, request);
      const response = await state.baseline(operation, request, id, signal);

      assert.deepEqual(response.data, expected);
      assert.ok(createContractValidators().responses[operation](response));
      assert.equal(calls, 1);
      assert.equal(state.attempts.length, 1);
      assert.deepEqual(response.meta.sources, []);
      assert.deepEqual(response.meta.counters, {
        retrieval_stage_count: 0,
        rewrite_call_count: 0,
        rerank_call_count: 0,
        provider_retry_count: 0,
        schema_retry_count: 0,
        model_call_count: 1,
      });
      assert.equal(response.meta.cost.query_embedding_usd, 0);
      assert.equal(response.meta.cost.rerank_usd, 0);
      assert.equal(response.meta.cost.status, 'KNOWN');
      assert.equal(response.meta.usage.total_tokens, 140);

      const trace = await readFile(join(state.directory, 'events', `${id}.jsonl`), 'utf8');

      assert.equal(trace.includes('secret-fixture-token'), false);
      assert.equal(trace.includes('sensitive-provider-id'), false);
      assert.equal(trace.includes('userId'), false);
      assert.equal((await state.observations.inspect())[0]?.traceIntegrity, 'VALID');
    }
  }
});

await test('schema dan domain validation memisahkan invalid JSON, count, catalog, locale dan references', async (t) => {
  const invalid: Array<[Operation, unknown, string]> = [];

  for (const operation of ['generate', 'normalize', 'recommend'] as const) {
    const data = outputFor(operation);
    assert.ok(typeof data === 'object' && data !== null);
    invalid.push([operation, { ...data, extra: true }, 'SCHEMA_PARSE_FAILED']);
  }

  invalid.push(['generate', { questions: [] }, 'SCHEMA_PARSE_FAILED']);
  invalid.push([
    'normalize',
    { suggestedKnownSkillClaims: [{ skillCode: 'foreign', confidence: 1 }] },
    'POST_VALIDATION_FAILED',
  ]);
  const recommendation = outputFor('recommend');

  assert.ok(typeof recommendation === 'object' && recommendation !== null);

  invalid.push([
    'recommend',
    { ...recommendation, recommendedUnitSlug: 'foreign' },
    'POST_VALIDATION_FAILED',
  ]);

  for (const [operation, data, code] of invalid) {
    const request = requestFor(operation);

    assert.equal(validateOutput(operation, request, data), code);

    const state = await setup(t, () =>
      Promise.resolve(
        providerResponse(data, {
          model: operation === 'normalize' ? 'gpt-5.6-luna' : 'gpt-5.6-terra',
        }),
      ),
    );
    const id = await admit(state.observations, operation, request);

    await assert.rejects(state.baseline(operation, request, id, signal), { code });

    assert.equal(state.attempts.length, 1);

    const terminal = (await state.observations.inspect())[0]?.terminal;

    assert.equal(terminal?.data.kind === 'terminal' ? terminal.data.code : null, code);
    assert.equal((await state.observations.exportAccounting()).input.calls.length, 1);
  }
});

await test('unknown usage/cost tetap null dan baseline menolak mode lain serta fingerprint berbeda', async (t) => {
  const state = await setup(t, () =>
    Promise.resolve(providerResponse(outputFor('evaluate'), { usage: null })),
  );
  const request = requestFor('evaluate');
  const id = await admit(state.observations, 'evaluate', request);

  await assert.rejects(state.baseline('evaluate', { ...request, mode: 'ADAPTIVE' }, id, signal), {
    code: 'INVALID_INPUT',
  });
  await assert.rejects(
    state.baseline(
      'evaluate',
      {
        ...request,
        payload: {
          ...request.payload,
          userAnswer: { ...request.payload.userAnswer, normalizedKana: 'べつ' },
        },
      },
      id,
      signal,
    ),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );
  assert.equal(state.attempts.length, 0);

  const response = await state.baseline('evaluate', request, id, signal);

  assert.deepEqual(response.meta.usage, {
    input_tokens: null,
    cached_input_tokens: null,
    output_tokens: null,
    total_tokens: null,
  });
  assert.equal(response.meta.cost.total_online_usd, null);
  assert.equal(response.meta.cost.status, 'UNKNOWN');
  await assert.rejects(state.baseline('evaluate', request, id, signal), {
    code: 'EXECUTION_NOT_ACTIVE',
  });
  assert.equal(state.attempts.length, 1);
});

await test('domain refinements menolak count/skill/difficulty/type, blanks/options/kana/token permutations dan arah locale', () => {
  const request = requestFor('generate');
  const original = outputFor('generate');
  const invalid = [
    { ...original, questions: original.questions.slice(1) },
    {
      ...original,
      questions: original.questions.map((question) => ({ ...question, skillCode: 'foreign' })),
    },
    {
      ...original,
      questions: original.questions.map((question) => ({ ...question, difficultyBand: 'STRETCH' })),
    },
  ];
  for (const question of original.questions) {
    if (question.questionType === 'SHORT_FREE_RESPONSE') {
      invalid.push({
        questions: original.questions.map((row) =>
          row === question
            ? {
                ...question,
                promptPayload: { ...question.promptPayload, sentenceTemplate: '___ と ___ です。' },
              }
            : row,
        ),
      });
      invalid.push({
        questions: original.questions.map((row) =>
          row === question
            ? { ...question, expectedAnswer: { acceptedTextAnswers: ['romaji'] } }
            : row,
        ),
      });
    }
    if (question.questionType === 'SLOT_FILL') {
      invalid.push({
        questions: original.questions.map((row) =>
          row === question
            ? {
                ...question,
                promptPayload: {
                  ...question.promptPayload,
                  options: question.promptPayload.options.map((option) => ({
                    ...option,
                    label: 'は',
                  })),
                },
              }
            : row,
        ),
      });
      invalid.push({
        questions: original.questions.map((row) =>
          row === question ? { ...question, expectedAnswer: { correctOptionId: 'foreign' } } : row,
        ),
      });
    }
    if (question.questionType === 'ARRANGE_TOKEN') {
      invalid.push({
        questions: original.questions.map((row) =>
          row === question
            ? { ...question, expectedAnswer: { acceptedTokenOrders: [['foreign', 'other']] } }
            : row,
        ),
      });
      invalid.push({
        questions: original.questions.map((row) =>
          row === question
            ? { ...question, promptPayload: { ...question.promptPayload, direction: 'ID_TO_JA' } }
            : row,
        ),
      });
    }
    if (question.questionType === 'FREE_RESPONSE') {
      invalid.push({
        questions: original.questions.map((row) =>
          row === question
            ? { ...question, expectedAnswer: { referenceAnswer: 'English only.' } }
            : row,
        ),
      });
    }
  }

  for (const data of invalid) {
    assert.equal(validateOutput('generate', request, data), 'POST_VALIDATION_FAILED');
  }

  assert.equal(
    validateOutput(
      'generate',
      {
        ...request,
        payload: {
          ...request.payload,
          context: { ...request.payload.context, allowedQuestionTypes: ['SHORT_FREE_RESPONSE'] },
        },
      },
      original,
    ),
    'POST_VALIDATION_FAILED',
  );

  const placement = outputFor('normalize').suggestedKnownSkillClaims;

  assert.equal(
    validateOutput('normalize', requestFor('normalize'), {
      suggestedKnownSkillClaims: [...placement, ...placement],
    }),
    'POST_VALIDATION_FAILED',
  );
});

await test('billing profile berbeda/tidak teramati menahan estimasi meski usage terisi', async (t) => {
  for (const service_tier of ['priority', null]) {
    const state = await setup(t, () =>
      Promise.resolve(providerResponse(outputFor('evaluate'), { service_tier })),
    );
    const request = requestFor('evaluate');
    const id = await admit(state.observations, 'evaluate', request);

    const response = await state.baseline('evaluate', request, id, signal);

    assert.equal(response.meta.usage.total_tokens, 140);
    assert.equal(response.meta.cost.total_online_usd, null);
    assert.equal(state.attempts[0]?.billingProfile, 'unverified-openai-text');
  }
});
