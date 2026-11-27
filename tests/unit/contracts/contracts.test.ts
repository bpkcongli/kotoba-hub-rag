import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixtures from '@contracts/v1/fixtures.json' with { type: 'json' };
import { createContractValidators, validateRequest } from '@/modules/rag/application/validation';
import type { Operation } from '@/shared/operations';

const validators = createContractValidators();
const now = Date.parse('2026-11-23T12:00:00Z');
const modes = ['LLM_ONLY', 'SINGLE_STAGE', 'ADAPTIVE'] as const;

function isOperation(value: string): value is Operation {
  return ['generate', 'evaluate', 'normalize', 'recommend'].includes(value);
}

const generate = fixtures.cases.find((fixture) => fixture.operation === 'generate');

assert.ok(generate);

const request = generate.request;

await test('16 pasangan fixture CON-01 valid pada schema request/response ketiga mode', () => {
  assert.equal(fixtures.cases.length, 16);

  for (const fixture of fixtures.cases) {
    assert.ok(isOperation(fixture.operation));

    for (const mode of modes) {
      const input = { ...fixture.request, mode };

      assert.equal(
        validateRequest(validators, fixture.operation, input, now).ok,
        true,
        `${fixture.id}/${mode}`,
      );
      assert.ok(validators.responses[fixture.operation]({ ...fixture.response, mode }));
    }
  }
});

await test('wire validation strict: locale, tipe, extra property, mode, bahasa grading', () => {
  const invalid: unknown[] = [
    { ...request, extra: true },
    { ...request, timeout_ms: '30000' },
    { ...request, mode: 'AUTO' },
    { ...request, payload: { ...request.payload, language: undefined } },
    {
      ...request,
      payload: {
        ...request.payload,
        language: {
          instructionLocale: 'ja',
          feedbackLocale: 'id',
          translationLocale: 'id',
        },
      },
    },
    { ...request, payload: { ...request.payload, expected_route: 'FAST' } },
  ];

  for (const input of invalid) {
    assert.deepEqual(validateRequest(validators, 'generate', input, now), {
      ok: false,
      code: 'INVALID_INPUT',
    });
  }

  const evaluate = fixtures.cases.find((fixture) => fixture.operation === 'evaluate');

  assert.ok(evaluate);

  const input = structuredClone(evaluate.request);

  // JSON fixtures infer a payload union; use Reflect to remove the property.
  assert.ok(Reflect.deleteProperty(input.payload.question ?? {}, 'answerLanguage'));

  assert.equal(validators.requests.evaluate(input), false);
});

await test('validator tidak memutasi input/default/remove dan menjaga teks Jepang', () => {
  for (const fixture of fixtures.cases) {
    assert.ok(isOperation(fixture.operation));

    const before = JSON.stringify(fixture);

    assert.ok(validators.requests[fixture.operation](fixture.request));
    assert.ok(validators.responses[fixture.operation](fixture.response));

    assert.equal(JSON.stringify(fixture), before);
  }

  const input = { ...request, extra: '残してください' };

  assert.equal(validators.requests.generate(input), false);
  assert.equal(input.extra, '残してください');

  const withoutMix = structuredClone(request);

  Reflect.deleteProperty(withoutMix.payload, 'questionMix');

  assert.ok(validators.requests.generate(withoutMix));
  assert.equal(Object.hasOwn(withoutMix.payload, 'questionMix'), false);
});

await test('policy murni memeriksa ID, eligibility target dan deadline dari clock caller', () => {
  assert.deepEqual(
    validateRequest(
      validators,
      'generate',
      { ...request, request_id: '70000000-0000-4000-8000-000000000099' },
      now,
    ),
    { ok: false, code: 'INVALID_INPUT' },
  );
  assert.deepEqual(
    validateRequest(validators, 'generate', request, now, '70000000-0000-4000-8000-000000000099'),
    { ok: false, code: 'INVALID_INPUT' },
  );

  for (const targetLevel of ['JLPT_N3', 'JLPT_N2']) {
    const input = {
      ...request,
      payload: {
        ...request.payload,
        context: { ...request.payload.context, targetLevel },
      },
    };

    assert.deepEqual(validateRequest(validators, 'generate', input, now), {
      ok: false,
      code: 'UNSUPPORTED_LEVEL',
    });
  }

  const currentN2 = {
    ...request,
    payload: {
      ...request.payload,
      context: { ...request.payload.context, currentLevel: 'JLPT_N2' },
    },
  };

  assert.equal(validateRequest(validators, 'generate', currentN2, now).ok, true);

  assert.deepEqual(
    validateRequest(validators, 'generate', request, Date.parse(request.deadline_at)),
    { ok: false, code: 'TIMEOUT' },
  );

  const admitted = validateRequest(validators, 'generate', request, now + 29000);

  assert.ok(admitted.ok);
  assert.equal(admitted.remainingMs, 1000);

  const shorter = validateRequest(validators, 'generate', { ...request, timeout_ms: 100 }, now);

  assert.ok(shorter.ok);
  assert.equal(shorter.remainingMs, 100);
});

await test('metadata harus di luar domain; unknown usage/cost tidak diganti nol', () => {
  const input = structuredClone(generate.response);

  const unknown = {
    ...input,
    meta: {
      ...input.meta,
      usage: {
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        total_tokens: null,
      },
      cost: {
        currency: 'USD',
        inference_total_usd: null,
        query_embedding_usd: null,
        rerank_usd: null,
        total_online_usd: null,
        known_subtotal_usd: 0,
        status: 'UNKNOWN',
      },
    },
  };

  assert.ok(validators.responses.generate(unknown));
  assert.equal(unknown.meta.cost.total_online_usd, null);

  assert.equal(
    validators.responses.generate({
      ...input,
      data: { ...input.data, trace_id: input.meta.trace_id },
    }),
    false,
  );
});
