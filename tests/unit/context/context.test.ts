import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { glob, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  candidate,
  contextConfig,
  ragRequest,
  secondSkill,
  skill,
} from '@tests/__fixtures__/context-fixture';
import { admit, clock, config, outputFor, signal } from '@tests/__fixtures__/generation-fixture';
import { buildContext, planningTokens } from '@/context/builder';
import { readContextConfig } from '@/context/config';
import { createContextBuilder } from '@/context/observed-builder';
import { ContextError } from '@/context/types';
import type { ContextTrace } from '@/context/types';
import { createOperationGenerator } from '@/generation/generator';
import { generationInput } from '@/generation/input';
import { aiInstructions } from '@/generation/prompt';
import { operationSchema } from '@/generation/schema';
import { parseTraceEvent } from '@/observability/events';
import { ObservationStore } from '@/observability/store';
import type { GeneratorPort } from '@/shared/ports';

const eventFor = (data: ContextTrace): unknown => ({
  schemaVersion: 'obs-02-v1',
  eventId: randomUUID(),
  correlation: {
    requestId: randomUUID(),
    executionId: randomUUID(),
    traceId: randomUUID(),
    mode: 'SINGLE_STAGE',
    operation: 'generate',
    experiment: null,
  },
  timestamp: '2026-11-26T01:00:00Z',
  durationMs: 1,
  data,
});

await test('RAG modes share deterministic packing, cap and prompt budget across all operations', () => {
  for (const operation of ['generate', 'evaluate', 'normalize', 'recommend'] as const) {
    const request = ragRequest(operation);
    const rows = [candidate(1), candidate(2, [secondSkill])];
    const settings = contextConfig();

    const single = buildContext(settings, operation, request, rows, [skill, secondSkill]);
    request.mode = 'ADAPTIVE';
    const adaptive = buildContext(settings, operation, request, rows, [skill, secondSkill]);

    assert.deepEqual(single, adaptive);
    assert.equal(single.status, 'READY');
    assert.equal(single.trace.budget.systemTokens, planningTokens(aiInstructions(operation)));
    assert.equal(
      single.trace.budget.schemaTokens,
      planningTokens(JSON.stringify(operationSchema(operation))),
    );
    assert.equal(single.trace.budget.inputTokens, planningTokens(generationInput(request, [])));
    assert.equal(
      single.trace.budget.totalReservedTokens,
      single.trace.budget.systemTokens +
        single.trace.budget.schemaTokens +
        planningTokens(generationInput(request, single.evidence)) +
        settings.outputReserveTokens +
        settings.safetyMarginTokens,
    );
    assert.ok(single.trace.budget.totalReservedTokens <= settings.contextWindowTokens);
    assert.doesNotThrow(() => parseTraceEvent(eventFor(single.trace)));
  }
});

await test('dedup keeps one copy of identical chunk/content and accounts every candidate', () => {
  const first = candidate(1);
  const sameText = candidate(2, [skill], first.text);
  const rows = [first, { ...first, rank: 2 }, sameText, candidate(3, [secondSkill])];

  const result = buildContext(contextConfig(), 'generate', ragRequest('generate'), rows, [
    skill,
    secondSkill,
  ]);

  assert.deepEqual(
    result.evidence.map((row) => row.chunkId),
    ['chunk-1', 'chunk-3'],
  );
  assert.deepEqual(
    result.trace.dropped.map((row) => row.reason),
    ['DUPLICATE_CHUNK', 'DUPLICATE_CONTENT'],
  );
  assert.equal(
    result.trace.retrieved.length,
    result.trace.selected.length + result.trace.dropped.length,
  );
  assert.deepEqual(result.sources, [
    { source_id: 'source-1', chunk_id: 'chunk-1' },
    { source_id: 'source-3', chunk_id: 'chunk-3' },
  ]);
  assert.doesNotThrow(() => parseTraceEvent(eventFor(result.trace)));
});

await test('coverage selects a lower-ranked new skill before redundant evidence under a tight cap', () => {
  const request = ragRequest('generate');
  const rows = [candidate(1), candidate(2), candidate(3, [secondSkill])];
  const cap =
    planningTokens(
      generationInput(
        request,
        [rows[0], rows[2]].filter((row) => row !== undefined),
      ),
    ) - planningTokens(generationInput(request, []));

  const result = buildContext(
    contextConfig({ evidenceCapTokens: cap }),
    'generate',
    request,
    rows,
    [skill, secondSkill],
  );

  assert.deepEqual(
    result.trace.selected.map((row) => row.chunkId),
    ['chunk-1', 'chunk-3'],
  );
  assert.deepEqual(result.trace.coverage.uncoveredSkillCodes, []);
  assert.equal(result.trace.dropped[0]?.chunkId, 'chunk-2');
  assert.equal(result.trace.dropped[0]?.reason, 'TOKEN_BUDGET');
});

await test('packing includes JSON escapes/IDs/separators and preserves whole Japanese chunks', () => {
  const request = ragRequest('generate');
  const row = candidate(1, [skill], '「名詞＋です。」\n例：「学生です。」\\引用"😀');
  const cost =
    planningTokens(generationInput(request, [row])) - planningTokens(generationInput(request, []));

  const fits = buildContext(
    contextConfig({ evidenceCapTokens: cost }),
    'generate',
    request,
    [row],
    [skill],
  );
  const misses = buildContext(
    contextConfig({ evidenceCapTokens: cost - 1 }),
    'generate',
    request,
    [row],
    [skill],
  );

  assert.equal(fits.evidence[0]?.text, row.text);
  assert.equal(fits.trace.budget.evidenceTokens, cost);
  assert.ok(cost > planningTokens(row.text));
  assert.deepEqual(misses.evidence, []);
  assert.deepEqual(misses.sources, []);
  assert.equal(misses.status, 'EMPTY');
  assert.equal(misses.trace.dropped[0]?.reason, 'TOKEN_BUDGET');
  assert.deepEqual(misses.trace.coverage.uncoveredSkillCodes, [skill]);
});

await test('oversized candidate is skipped so a later complete chunk can still cover the skill', () => {
  const rows = [candidate(1, [skill], '説明。'.repeat(500)), candidate(2)];

  const result = buildContext(
    contextConfig({ evidenceCapTokens: 300 }),
    'generate',
    ragRequest('generate'),
    rows,
    [skill],
  );

  assert.deepEqual(
    result.trace.selected.map((row) => row.chunkId),
    ['chunk-2'],
  );
  assert.equal(result.evidence[0]?.text, rows[1]?.text);
  assert.equal(result.trace.dropped[0]?.reason, 'TOKEN_BUDGET');
});

await test('fixed reserves constrain evidence and overflow remains explicit without changing input', () => {
  const request = ragRequest('generate');
  const original = structuredClone(request);
  const row = candidate(1);
  const baseline = buildContext(contextConfig(), 'generate', request, [], [skill]);
  const fixed = baseline.trace.budget.totalReservedTokens;

  const exact = buildContext(
    contextConfig({ contextWindowTokens: fixed, evidenceCapTokens: 100 }),
    'generate',
    request,
    [row],
    [skill],
  );
  const overflow = buildContext(
    contextConfig({ contextWindowTokens: fixed - 1, evidenceCapTokens: 100 }),
    'generate',
    request,
    [row],
    [skill],
  );

  assert.equal(exact.status, 'EMPTY');
  assert.equal(exact.trace.budget.evidenceAvailableTokens, 0);
  assert.equal(overflow.status, 'INPUT_BUDGET_EXCEEDED');
  assert.deepEqual(overflow.sources, []);
  assert.equal(overflow.trace.dropped[0]?.reason, 'FIXED_INPUT_BUDGET');
  assert.deepEqual(request, original);
  assert.doesNotThrow(() => parseTraceEvent(eventFor(overflow.trace)));
});

await test('char cap includes instructions plus serialized input as required by provider adapter', () => {
  const request = ragRequest('generate');
  const row = candidate(1);
  const fixedChars = aiInstructions('generate').length + generationInput(request, []).length;
  const packedChars = aiInstructions('generate').length + generationInput(request, [row]).length;

  const fits = buildContext(
    contextConfig({ maxInputChars: packedChars }),
    'generate',
    request,
    [row],
    [skill],
  );
  const misses = buildContext(
    contextConfig({ maxInputChars: packedChars - 1 }),
    'generate',
    request,
    [row],
    [skill],
  );
  const overflow = buildContext(
    contextConfig({ maxInputChars: fixedChars - 1 }),
    'generate',
    request,
    [row],
    [skill],
  );

  assert.equal(fits.evidence.length, 1);
  assert.equal(misses.trace.dropped[0]?.reason, 'INPUT_CHAR_LIMIT');
  assert.equal(overflow.status, 'INPUT_BUDGET_EXCEEDED');
  assert.doesNotThrow(() => parseTraceEvent(eventFor(overflow.trace)));
});

await test('scope/empty evidence preserve explicit uncovered skills and never invent sources', () => {
  const request = ragRequest('generate');
  const rows = [
    candidate(1, ['forbidden']),
    candidate(2, [skill], 'N4の文。', { jlptLevel: 'JLPT_N4' }),
  ];

  const result = buildContext(contextConfig(), 'generate', request, rows, [skill]);
  const empty = buildContext(contextConfig(), 'generate', request, [], [skill, secondSkill]);

  assert.equal(result.status, 'EMPTY');
  assert.deepEqual(
    result.trace.dropped.map((row) => row.reason),
    ['OUT_OF_SCOPE', 'OUT_OF_SCOPE'],
  );
  assert.deepEqual(result.sources, []);
  assert.equal(empty.status, 'EMPTY');
  assert.deepEqual(empty.trace.coverage.uncoveredSkillCodes, [skill, secondSkill]);
  assert.doesNotThrow(() => parseTraceEvent(eventFor(empty.trace)));
});

await test('rejects conflicting chunk identity, invalid checksum, hidden target and baseline mode', () => {
  const request = ragRequest('generate');
  const first = candidate(1);
  const invalidRows = [
    [first, { ...candidate(1, [skill], '別の文。') }],
    [first, candidate(2, [skill], first.text), candidate(2, [skill], '別の文。')],
    [candidate(1, ['forbidden']), first],
    [candidate(1, [skill], '文。', { contentChecksum: '0'.repeat(64) })],
    Array.from({ length: 65 }, (_, index) => candidate(index + 1)),
  ];

  for (const rows of invalidRows) {
    assert.throws(
      () => buildContext(contextConfig(), 'generate', request, rows, [skill]),
      ContextError,
    );
  }

  assert.throws(
    () => buildContext(contextConfig(), 'generate', request, [], ['answer_key']),
    ContextError,
  );

  request.mode = 'LLM_ONLY';

  assert.throws(
    () => buildContext(contextConfig(), 'generate', request, [first], [skill]),
    ContextError,
  );
});

await test('context config validates caps and derives output/input limits from generator config', () => {
  const generator = config({ OPENAI_MAX_OUTPUT_TOKENS: '6000', OPENAI_MAX_INPUT_CHARS: '20000' });

  const result = readContextConfig({}, generator);

  assert.equal(result.outputReserveTokens, 6000);
  assert.equal(result.maxInputChars, 20000);
  assert.equal(result.evidenceCapTokens, 8192);
  for (const env of [
    { CONTEXT_WINDOW_TOKENS: '7000' },
    { CONTEXT_EVIDENCE_CAP_TOKENS: '0' },
    { CONTEXT_SAFETY_MARGIN_TOKENS: 'NaN' },
    { CONTEXT_EVIDENCE_CAP_TOKENS: '32769' },
  ]) {
    assert.throws(() => readContextConfig(env, generator));
  }
});

await test('generator uses exactly the budgeted input for four operations and excludes envelope data', async () => {
  for (const operation of ['generate', 'evaluate', 'normalize', 'recommend'] as const) {
    const request = ragRequest(operation);
    const built = buildContext(contextConfig(), operation, request, [candidate(1)], [skill]);
    const inputs: Parameters<GeneratorPort['generate']>[0][] = [];
    const provider: GeneratorPort = {
      generate: (input) => {
        inputs.push(input);
        return Promise.resolve({
          outputText: JSON.stringify(outputFor(operation)),
          providerRequestId: null,
          usage: null,
        });
      },
    };

    await createOperationGenerator(provider, config())(operation, request, built.evidence, {
      executionId: randomUUID(),
      signal,
      deadlineAt: request.deadline_at,
    });

    assert.equal(inputs[0]?.input, generationInput(request, built.evidence));
    assert.equal(
      planningTokens(inputs[0]?.input ?? ''),
      built.trace.budget.inputTokens + built.trace.budget.evidenceTokens,
    );
    assert.ok(!inputs[0]?.input.includes(request.request_id));
    assert.ok(!inputs[0]?.input.includes('70000000-0000-4000-8000-000000000099'));

    const serialized: unknown = JSON.parse(inputs[0]?.input ?? '{}');

    assert.ok(serialized && typeof serialized === 'object' && 'evidence' in serialized);
    assert.deepEqual(
      serialized.evidence,
      built.evidence.map(({ sourceId, chunkId, text }) => ({ sourceId, chunkId, text })),
    );
  }
});

await test('trace parser rejects forged selection, accounting, coverage and arbitrary text', () => {
  const built = buildContext(
    contextConfig(),
    'generate',
    ragRequest('generate'),
    [candidate(1), candidate(2)],
    [skill],
  );
  const corruptions: ((data: ContextTrace) => unknown)[] = [
    (data) => ({
      ...data,
      selected: [{ candidateIndex: 0, sourceId: 'fake', chunkId: 'unselected' }],
    }),
    (data) => ({
      ...data,
      budget: { ...data.budget, evidenceTokens: data.budget.evidenceTokens + 1 },
    }),
    (data) => ({ ...data, coverage: { ...data.coverage, uncoveredSkillCodes: [skill] } }),
    (data) => ({ ...data, text: 'sensitive note' }),
    (data) => ({ ...data, dropped: [], selected: [] }),
  ];

  for (const corrupt of corruptions) {
    const event = eventFor(built.trace);

    assert.ok(typeof event === 'object' && event !== null);
    assert.throws(() => parseTraceEvent({ ...event, data: corrupt(built.trace) }));
    assert.throws(() => parseTraceEvent({ ...event, schemaVersion: 'obs-01-v1' }));
  }
});

await test('observed context requires admission, retains durable redacted selection and rejects cancellation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'kotoba-rag02-'));
  const observations = new ObservationStore(directory, clock);
  t.after(async () => {
    await observations.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = ragRequest('generate');
  const executionId = await admit(observations, 'generate', request);
  const build = createContextBuilder(contextConfig(), config(), observations, clock);
  const context = { executionId, signal, deadlineAt: request.deadline_at };

  const result = await build('generate', request, [candidate(1)], [skill], context);

  assert.equal(result.status, 'READY');

  await observations.finish(executionId, 'SUCCESS', null);
  const paths: string[] = [];
  for await (const file of glob('**/*.jsonl', { cwd: directory })) {
    paths.push(join(directory, file));
  }
  const log = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n');
  const events = log
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => parseTraceEvent(JSON.parse(line)));

  assert.equal(events.filter((event) => event.data.kind === 'context_built').length, 1);
  assert.ok(!log.includes(candidate(1).text));
  assert.ok(!log.includes('Kesalahan sintetis'));
  await assert.rejects(build('generate', request, [], [skill], context));

  const cancelledRequest = ragRequest('generate');
  const cancelledId = await admit(observations, 'generate', cancelledRequest);
  const cancelled = AbortSignal.abort();

  await assert.rejects(
    build('generate', cancelledRequest, [candidate(1)], [skill], {
      executionId: cancelledId,
      signal: cancelled,
      deadlineAt: cancelledRequest.deadline_at,
    }),
    (error: unknown) => error instanceof ContextError && error.code === 'TIMEOUT',
  );

  await observations.finish(cancelledId, 'TIMEOUT', 'TIMEOUT');

  const timedRequest = ragRequest('generate');
  const timedId = await admit(observations, 'generate', timedRequest);
  let ticks = 0;
  const timedBuild = createContextBuilder(contextConfig(), config(), observations, {
    now: () => clock.now(),
    monotonicMs: () => (++ticks <= 2 ? 0 : 31000),
  });

  await assert.rejects(
    timedBuild('generate', timedRequest, [candidate(1)], [skill], {
      executionId: timedId,
      signal,
      deadlineAt: timedRequest.deadline_at,
    }),
    (error: unknown) => error instanceof ContextError && error.code === 'TIMEOUT',
  );

  await observations.finish(timedId, 'TIMEOUT', 'TIMEOUT');
});

await test('observed builder binds generator reserves and the complete admitted request', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'kotoba-rag02-binding-'));
  const observations = new ObservationStore(directory, clock);
  t.after(async () => {
    await observations.close();
    await rm(directory, { recursive: true, force: true });
  });

  assert.throws(
    () =>
      createContextBuilder(
        contextConfig({ outputReserveTokens: 1 }),
        config(),
        observations,
        clock,
      ),
    ContextError,
  );
  assert.throws(
    () => createContextBuilder(contextConfig({ maxInputChars: 1 }), config(), observations, clock),
    ContextError,
  );

  const request = ragRequest('generate');
  const executionId = await admit(observations, 'generate', request);
  const build = createContextBuilder(contextConfig(), config(), observations, clock);
  request.payload.context.weakSkillCodes = [];

  await assert.rejects(
    build('generate', request, [candidate(1)], [skill], {
      executionId,
      signal,
      deadlineAt: request.deadline_at,
    }),
  );

  await observations.finish(executionId, 'FAILED', 'INVALID_INPUT');
});
