import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import fixtures from '@contracts/v1/fixtures.json' with { type: 'json' };
import { OPENAI_MODELS, readOpenAiConfig } from '@/adapters/openai-config';
import { createOpenAiGenerator, GenerationError } from '@/adapters/openai-responses';
import { createContractValidators } from '@/contracts/validator';
import type { Operation, Requests, Responses } from '@/contracts/validator';
import { createBaselineRunner } from '@/generation/baseline';
import { createOperationGenerator } from '@/generation/generator';
import { ObservationStore } from '@/observability/store';
import type { GeneratorPort } from '@/shared/ports';

const operations: Operation[] = ['generate', 'evaluate', 'normalize', 'recommend'];
const validators = createContractValidators();

export function syntheticSmokeCase<K extends Operation>(
  operation: K,
): { request: Requests[K]; output: Responses[K]['data'] } {
  const fixture = fixtures.cases.find((row) => row.operation === operation);
  if (!fixture) {
    throw new Error('Fixture tidak tersedia');
  }

  const id = randomUUID();
  const request: unknown = {
    ...structuredClone(fixture.request),
    mode: 'LLM_ONLY',
    request_id: id,
    timeout_ms: 30000,
    deadline_at: new Date(Date.now() + 30000).toISOString(),
    payload: { ...structuredClone(fixture.request.payload), metadata: { requestId: id } },
  };

  if (!validators.requests[operation](request)) {
    throw new Error('Fixture request invalid');
  }

  const response: unknown = structuredClone(fixture.response);

  if (!validators.responses[operation](response)) {
    throw new Error('Fixture response invalid');
  }

  if ('questionCount' in request.payload && 'questions' in response.data) {
    request.payload.questionCount = 1;
    request.payload.context.allowedQuestionTypes = ['SHORT_FREE_RESPONSE'];
    response.data.questions = response.data.questions
      .filter((question) => question.questionType === 'SHORT_FREE_RESPONSE')
      .slice(0, 1);
  }

  return { request, output: structuredClone(response.data) };
}

export async function runSmoke(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  if (
    args.some(
      (arg) =>
        arg !== '--execute' &&
        !arg.startsWith('--max-calls=') &&
        !arg.startsWith('--max-budget-usd='),
    )
  ) {
    throw new Error('Argumen smoke invalid');
  }

  const execute = args.includes('--execute');
  const callsArg = args.find((arg) => arg.startsWith('--max-calls='))?.split('=')[1];
  const budgetArg = args.find((arg) => arg.startsWith('--max-budget-usd='))?.split('=')[1];
  const cap = Number(callsArg ?? 0);
  const budget = Number(budgetArg ?? 0);
  const config = readOpenAiConfig({
    ...env,
    OPENAI_ENABLED: 'true',
    OPENAI_API_KEY: execute ? env.OPENAI_API_KEY : 'offline-plan',
    OPENAI_MAX_OUTPUT_TOKENS: '768',
    OPENAI_MAX_CONCURRENCY: '1',
  });

  if (!config) {
    throw new Error('Konfigurasi smoke invalid');
  }

  const cases = operations.map((operation) => ({ operation, ...syntheticSmokeCase(operation) }));
  const inputs: Array<Parameters<GeneratorPort['generate']>[0]> = [];

  for (const row of cases) {
    await createOperationGenerator(
      {
        generate: (input) => {
          inputs.push(input);
          return Promise.resolve({
            outputText: JSON.stringify(row.output),
            providerRequestId: null,
            usage: null,
          });
        },
      },
      config,
    )(row.operation, row.request, [], {
      executionId: 'offline-plan',
      signal: new AbortController().signal,
      deadlineAt: row.request.deadline_at,
    });
  }

  // Conservative byte-based token reservation plus framing margin, using OBS-02 dated rates.
  // This is a tariff ceiling for standard text calls, not provider settlement evidence.
  const estimatedCeilingUsd = inputs.reduce((sum, input) => {
    const inputTokenBound = Buffer.byteLength(JSON.stringify(input), 'utf8') + 4096;

    if (inputTokenBound > 272000) {
      throw new Error('Smoke di luar profil harga');
    }

    const normalization = input.model === OPENAI_MODELS.normalization;

    return (
      sum +
      // Reserve the larger cache-write input tariff, not just uncached input.
      (inputTokenBound * (normalization ? 0.25 : 2.5) +
        config.maxOutputTokens * (normalization ? 1.2 : 12)) /
        1000000
    );
  }, 0);

  const plan = {
    task: 'BASE-01',
    execute,
    calls: cases.length,
    maxCalls: cap,
    maxBudgetUsd: budget,
    estimatedCeilingUsd,
    maxOutputTokens: config.maxOutputTokens,
    providerRetries: 0,
    schemaRetries: 0,
    modes: ['LLM_ONLY'],
    models: OPENAI_MODELS,
    priceAsOf: '2026-11-25',
  };
  process.stdout.write(`${JSON.stringify(plan)}\n`);

  if (!execute) {
    return;
  }

  if (
    !Number.isSafeInteger(cap) ||
    cap !== 4 ||
    !Number.isFinite(budget) ||
    budget < estimatedCeilingUsd ||
    budget > 1
  ) {
    throw new Error('Budget/call cap smoke belum memenuhi plan (maksimum USD 1 dan tepat 4 calls)');
  }

  const directory = resolve('artifacts/base-01', randomUUID());
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, {
    flag: 'wx',
  });
  const observations = new ObservationStore(resolve(directory, 'observations'));
  const provider = createOpenAiGenerator(config, {
    onAttempt: (attempt) => observations.recordGenerationAttempt(attempt),
  });
  const runner = createBaselineRunner(createOperationGenerator(provider, config), observations);
  const results: unknown[] = [];

  try {
    for (const row of cases) {
      row.request.deadline_at = new Date(Date.now() + row.request.timeout_ms).toISOString();
      const experiment = row.request.experiment;
      const admission = await observations.admit({
        serviceId: 'base-01-synthetic-smoke',
        requestId: row.request.request_id,
        operation: row.operation,
        mode: 'LLM_ONLY',
        request: row.request,
        ...(experiment === undefined
          ? {}
          : {
              experiment: {
                experimentId: experiment.experiment_id,
                caseId: experiment.case_id,
                repetition: experiment.repetition,
              },
            }),
      });
      const id = admission.correlation.executionId;

      if (admission.status !== 'admitted' || id === null) {
        throw new Error('Admission smoke gagal');
      }

      const response = await runner(row.operation, row.request, id, new AbortController().signal);
      results.push({ operation: row.operation, response });
      await writeFile(
        resolve(directory, `${row.operation}.json`),
        `${JSON.stringify(response, null, 2)}\n`,
        { flag: 'wx' },
      );
    }
  } finally {
    provider.close();
    await observations.close();
    await writeFile(
      resolve(directory, 'result.json'),
      `${JSON.stringify({ completed: results.length, planned: cases.length, artifactDirectory: directory }, null, 2)}\n`,
      { flag: 'wx' },
    );
    process.stdout.write(
      `${JSON.stringify({ completed: results.length, artifactDirectory: directory })}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  void runSmoke(process.argv.slice(2), process.env).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof GenerationError ? error.code : 'Smoke gagal; periksa konfigurasi, budget/call cap, dan artefak'}\n`,
    );
    process.exitCode = 1;
  });
}
