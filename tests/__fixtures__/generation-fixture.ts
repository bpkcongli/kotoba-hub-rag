import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

import fixtures from '@contracts/v1/fixtures.json' with { type: 'json' };
import { readOpenAiConfig } from '@/adapters/openai-config';
import type { OpenAiConfig } from '@/adapters/openai-config';
import { createOpenAiGenerator } from '@/adapters/openai-responses';
import type { GenerationAttempt } from '@/adapters/openai-responses';
import { createContractValidators } from '@/contracts/validator';
import type { Operation, Requests, Responses } from '@/contracts/validator';
import { createBaselineRunner } from '@/generation/baseline';
import { createOperationGenerator } from '@/generation/generator';
import { ObservationStore } from '@/observability/store';
import type { Clock } from '@/shared/ports';

export const clock: Clock = {
  now: () => new Date('2026-11-25T10:00:00Z'),
  monotonicMs: () => performance.now(),
};
export const signal = new AbortController().signal;
export const usage = {
  input_tokens: 100,
  input_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 },
  output_tokens: 40,
  output_tokens_details: { reasoning_tokens: 10 },
  total_tokens: 140,
};

export function config(extra: Record<string, string> = {}): OpenAiConfig {
  const result = readOpenAiConfig({
    OPENAI_ENABLED: 'true',
    OPENAI_API_KEY: 'secret-fixture-token',
    ...extra,
  });

  assert.ok(result);

  return result;
}

export function providerResponse(data: unknown, extra: Record<string, unknown> = {}): Response {
  return Response.json(
    {
      model: 'gpt-5.6-terra',
      service_tier: 'default',
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
      usage,
      ...extra,
    },
    { headers: { 'x-request-id': 'sensitive-provider-id' } },
  );
}

export function requestFor<K extends Operation>(operation: K, index = 0): Requests[K] {
  const fixture = fixtures.cases.filter((row) => row.operation === operation)[index];

  assert.ok(fixture);

  const id = randomUUID();
  const input: unknown = {
    ...structuredClone(fixture.request),
    mode: 'LLM_ONLY',
    request_id: id,
    deadline_at: '2026-11-25T10:00:30Z',
    payload: {
      ...structuredClone(fixture.request.payload),
      metadata: { requestId: id, userId: '70000000-0000-4000-8000-000000000099' },
    },
  };
  const validator = createContractValidators().requests[operation];

  assert.ok(validator(input));

  return input;
}

export function outputFor<K extends Operation>(operation: K, index = 0): Responses[K]['data'] {
  const fixture = fixtures.cases.filter((row) => row.operation === operation)[index];

  assert.ok(fixture);

  const response: unknown = fixture.response;

  assert.ok(createContractValidators().responses[operation](response));

  return structuredClone(response.data);
}

export async function setup(t: TestContext, fetcher: typeof fetch, settings = config()) {
  const directory = await mkdtemp(join(tmpdir(), 'kotoba-base01-'));
  const observations = new ObservationStore(directory, clock);
  const attempts: GenerationAttempt[] = [];
  const provider = createOpenAiGenerator(settings, {
    clock,
    fetch: fetcher,
    onAttempt: async (attempt) => {
      attempts.push(attempt);
      await observations.recordGenerationAttempt(attempt);
    },
  });
  const generate = createOperationGenerator(provider, settings);
  const baseline = createBaselineRunner(generate, observations, clock);
  t.after(async () => {
    provider.close();
    await observations.close();
    await rm(directory, { recursive: true, force: true });
  });

  return { directory, observations, provider, generate, baseline, attempts };
}

export async function admit(
  observations: ObservationStore,
  operation: Operation,
  request: Requests[Operation],
): Promise<string> {
  const result = await observations.admit({
    serviceId: 'fixture-service',
    requestId: request.request_id,
    operation,
    mode: request.mode,
    request,
    ...(request.experiment === undefined
      ? {}
      : {
          experiment: {
            experimentId: request.experiment.experiment_id,
            caseId: request.experiment.case_id,
            repetition: request.experiment.repetition,
          },
        }),
  });

  assert.equal(result.status, 'admitted');
  assert.ok(result.correlation.executionId);

  return result.correlation.executionId;
}
