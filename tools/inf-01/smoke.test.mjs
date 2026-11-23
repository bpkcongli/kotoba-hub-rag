import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  denseUrl,
  continuePairs,
  invoke,
  makePairProbePlan,
  parsePairResponse,
  makePlan,
  rerankUrl,
  runSmoke,
  scrub,
} from './smoke.mjs';

const fixtures = JSON.parse(
  await readFile(new URL('../../docs/inference/INF-01-fixtures.json', import.meta.url), 'utf8'),
);

const token = 'hf_SYNTHETICTESTSECRET';

await test('plan fixed HF only: six dense, six rerank pairs, one explicit sparse diagnostic', () => {
  const plan = makePlan(fixtures);

  assert.equal(plan.filter((p) => p.operation === 'dense').length, 6);
  assert.equal(plan.filter((p) => p.operation === 'rerank').length, 6);
  assert.equal(plan.filter((p) => p.operation === 'sparse').length, 1);
  assert.equal(plan.at(-1).payload.inputs.length, 3);
  assert.ok(plan.every((p) => [denseUrl, rerankUrl].includes(p.url)));
});

await test('invoke auth/TLS route/no redirects, vectors valid; secrets and unknown cost retained safely', async () => {
  const item = makePlan(fixtures)[0];
  const calls = [];

  const result = await invoke(item, token, async (url, options) => {
    calls.push({ url, options });

    return new Response(JSON.stringify([Array(1024).fill(0.03125)]), {
      headers: { 'x-request-id': 'test-id', 'set-cookie': 'private' },
    });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.authorization, `Bearer ${token}`);

  assert.equal(result.outcome, 'SHAPE_VALID');
  assert.equal(result.costUsd, null);
  assert.equal(result.usage, null);

  assert.equal(result.headers['set-cookie'], undefined);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETICTESTSECRET/);
  assert.equal(scrub(`error ${token}`, token), 'error [REDACTED]');
});

await test('runner stops failed operations, retains 13 slots and rejects replay; no retry or fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inf01-smoke-'));
  const output = join(root, 'run');
  const calls = [];

  try {
    const result = await runSmoke(output, token, async (url) => {
      calls.push(url);

      return new Response(JSON.stringify({ error: `unsupported ${token}` }), { status: 422 });
    });

    assert.deepEqual(calls, [denseUrl, rerankUrl]);
    assert.equal(result.actualRequests, 2);
    assert.equal(result.notExecuted, 11);
    assert.equal(result.records.length, 13);
    assert.equal(result.costUsd, null);

    assert.doesNotMatch(
      await readFile(join(output, 'summary.json'), 'utf8'),
      /SYNTHETICTESTSECRET/,
    );

    await assert.rejects(
      runSmoke(output, token, async () => {
        throw Error('must not run');
      }),
    );

    assert.equal(calls.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('429 and timeout are single attempts; unsupported sparse is not claimed as valid', async () => {
  const item = makePlan(fixtures).at(-1);

  const rateLimit = await invoke(item, token, async () => new Response('limited', { status: 429 }));

  const timeout = await invoke(item, token, async () => {
    throw new DOMException('private', 'TimeoutError');
  });

  const denseOnly = await invoke(
    item,
    token,
    async () =>
      new Response(
        JSON.stringify([Array(1024).fill(0.1), Array(1024).fill(0.1), Array(1024).fill(0.1)]),
      ),
  );

  assert.equal(rateLimit.httpStatus, 429);
  assert.equal(rateLimit.costUsd, null);

  assert.equal(timeout.errorCode, 'TIMEOUT');
  assert.equal(timeout.outcome, 'UNKNOWN');

  assert.equal(denseOnly.outcome, 'RESPONSE_INVALID');
});

await test('pair diagnostic uses Transformers text/text_pair and input-order mapping; no fake ranking IDs', async () => {
  const plan = makePairProbePlan(fixtures);

  assert.equal(plan.length, 5);
  assert.equal(plan[0].expectedIds.length, 2);

  const record = await invoke(plan[0], token, async (_url, options) => {
    const payload = JSON.parse(options.body);

    assert.equal(payload.inputs.inputs.length, 2);
    assert.ok(payload.inputs.inputs.every((pair) => pair.text && pair.text_pair));

    return new Response(
      JSON.stringify([
        { label: 'LABEL_0', score: 3 },
        { label: 'LABEL_0', score: -4 },
      ]),
    );
  });

  assert.equal(record.outcome, 'SHAPE_VALID');
  assert.deepEqual(
    record.validation.scores.map((s) => s.chunkId),
    ['ja-time', 'ja-place'],
  );
});

await test('outer HF classification batch maps to IDs without an extra paid call', () => {
  const data = [
    [
      { label: 'LABEL_0', score: 5.2 },
      { label: 'LABEL_0', score: -4.8 },
    ],
  ];

  const scores = parsePairResponse(data, ['match', 'other']);

  assert.deepEqual(scores, [
    { chunkId: 'match', score: 5.2 },
    { chunkId: 'other', score: -4.8 },
  ]);
  assert.throws(() => parsePairResponse(data, ['one']));
  assert.throws(() => parsePairResponse([[{ label: 'LABEL_0', score: NaN }]], ['one']));
});

await test('continuation reanalyzes saved JA offline, spends only four slots and cannot replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inf01-continue-'));
  const probe = join(root, 'pair-probe');
  const plan = makePairProbePlan(fixtures);
  const calls = [];

  try {
    await mkdir(probe);
    await writeFile(
      join(root, 'summary.json'),
      JSON.stringify({ actualRequests: 8, requestCeiling: 13 }),
    );
    await writeFile(join(probe, 'summary.json'), JSON.stringify({ actualRequests: 1 }));
    await writeFile(join(probe, 'plan.json'), JSON.stringify(plan));
    await writeFile(
      join(probe, 'pair-ja-0.json'),
      JSON.stringify({
        httpStatus: 200,
        expectedIds: plan[0].expectedIds,
        responseText: JSON.stringify([
          [
            { label: 'LABEL_0', score: 3 },
            { label: 'LABEL_0', score: -2 },
          ],
        ]),
      }),
    );

    const fetcher = async (url) => {
      calls.push(url);

      return new Response(JSON.stringify([[{ label: 'LABEL_0', score: 1 }]]));
    };

    const result = await continuePairs(root, token, fetcher);

    const reanalysis = JSON.parse(
      await readFile(join(probe, 'continuation/ja-reanalysis.json'), 'utf8'),
    );

    assert.equal(result.actualRequests, 4);
    assert.equal(calls.length, 4);
    assert.ok(calls.every((url) => url === rerankUrl));
    assert.equal(reanalysis.httpCalls, 0);
    assert.equal(reanalysis.scores.length, 2);

    await assert.rejects(continuePairs(root, token, fetcher));

    assert.equal(calls.length, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
