import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { clock, outputFor, providerResponse } from '@tests/generation-fixture';
import { dense, hit } from '@tests/retrieval-fixture';
import { setupSingleStage, skill } from '@tests/single-stage-fixture';
import { createAdaptiveRunner } from '@/pipelines/adaptive';
import { readDeepPolicy } from '@/pipelines/deep-config';
import type { DeepPolicy } from '@/pipelines/deep-config';
import { createQueryRewriter } from '@/pipelines/rewrite';
import type { RerankerPort } from '@/shared/ports';

export async function setupAdaptive(
  t: TestContext,
  options: Parameters<typeof setupSingleStage>[1] & {
    fast?: boolean;
    deepPolicy?: DeepPolicy;
    reranker?: RerankerPort;
    rewriteQuery?: string;
  } = {},
) {
  const rerankWire: unknown[] = [];
  let targetLevel = 'JLPT_N5';
  const state = await setupSingleStage(t, {
    ...options,
    points:
      options.points ??
      ((index, round) =>
        round === 1 && !options.fast
          ? []
          : [hit(index, 2, 0.2, { skill_codes: [skill], jlpt_level: targetLevel })]),
    hfFetch:
      options.hfFetch ??
      ((_url, init) => {
        const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');

        if (typeof body === 'object' && body !== null && 'parameters' in body) {
          rerankWire.push(body);

          assert.ok(
            'inputs' in body &&
              typeof body.inputs === 'object' &&
              body.inputs !== null &&
              'inputs' in body.inputs &&
              Array.isArray(body.inputs.inputs),
          );

          const pairs = body.inputs.inputs;

          return Promise.resolve(
            Response.json(pairs.map((_row, index) => [{ label: 'LABEL_0', score: -index - 1 }])),
          );
        }

        return Promise.resolve(Response.json([dense()]));
      }),
    generatorFetch:
      options.generatorFetch ??
      ((_url, init) => {
        const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');

        if (
          typeof body === 'object' &&
          body !== null &&
          'text' in body &&
          (body as { text: { format: { name: string } } }).text.format.name ===
            'RefinedRetrievalQuery'
        ) {
          return Promise.resolve(
            providerResponse({ query: options.rewriteQuery ?? '文法の説明と例' }),
          );
        }

        const operation = options.operation ?? 'generate';

        return Promise.resolve(
          providerResponse(outputFor(operation, options.fixtureIndex ?? 0), {
            model: operation === 'normalize' ? 'gpt-5.6-luna' : 'gpt-5.6-terra',
          }),
        );
      }),
  });

  state.request.mode = 'ADAPTIVE';
  targetLevel = state.request.payload.context.targetLevel;
  const adaptive = createAdaptiveRunner(
    state.index,
    state.stage,
    state.build,
    state.generate,
    createQueryRewriter(state.generator),
    options.reranker ?? state.hf.reranker,
    state.observations,
    options.policy,
    undefined,
    options.deepPolicy ?? readDeepPolicy(),
    options.clock ?? clock,
  );

  return { ...state, adaptive, rerankWire };
}
