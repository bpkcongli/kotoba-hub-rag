import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { dense, fixturePlan, memoryStore } from '@tests/__fixtures__/indexing-fixture';
import { createIngestionPlan } from '@/modules/knowledge/application/index-plan';
import type { EmbeddingPort } from '@/modules/knowledge/application/ports/embedding';
import { canonical, hash, object } from '@/modules/knowledge/application/validation';
import { IndexingError } from '@/modules/knowledge/domain/exceptions/indexing-error';
import { runIndexJob } from '@/modules/knowledge/infrastructure/di/index';
import {
  appendJournal,
  createIndexJob,
  readJournal,
} from '@/modules/knowledge/interface/secondary/corpus/index-job';
import { readHfConfig } from '@/modules/rag/infrastructure/config/hf-config';
import { createHfInference } from '@/modules/rag/interface/secondary/inference/hf-inference';
import { InferenceError } from '@/shared/errors/inference-error';

async function harness(count = 3) {
  const root = await mkdtemp(resolve(tmpdir(), 'kotoba-data03-'));
  const directory = resolve(root, 'job');
  const plan = fixturePlan(count);
  const memory = memoryStore();
  let calls = 0;
  const embedding: EmbeddingPort = {
    embed: async (texts) => {
      calls++;
      await Promise.resolve();

      return texts.map(() => dense());
    },
  };

  await createIndexJob(directory, plan);

  return {
    root,
    directory,
    plan,
    memory,
    embedding,
    calls: () => calls,
    run: (maxNewBatches = count, adapter = embedding) =>
      runIndexJob({
        directory,
        plan,
        store: memory.store,
        embedding: adapter,
        maxNewBatches,
        timeoutMs: 5000,
        signal: new AbortController().signal,
      }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

await test('plan preserves original provenance/overlap, deterministic UUIDs and explicit dense identity with unknown revisions', () => {
  const plan = fixturePlan();
  const again = fixturePlan();

  assert.deepEqual(plan, again);
  assert.equal(plan.index.embeddingModelRevision, null);
  assert.equal(plan.index.tokenizerRevision, null);
  assert.equal(plan.embeddingConfiguration.truncate, false);
  assert.equal(plan.points[0]?.payload.source_url, plan.provenance[0]?.chunk.sourceId);
  assert.equal(plan.provenance[0]?.sources[0]?.source_uri, 'urn:source:0');
  assert.equal(plan.publicRedistributionAuthorized, false);
  assert.match(plan.points[0]?.id ?? '', /^[a-f0-9-]{36}$/);

  const input = {
    manifestSha256: plan.preparationManifestSha256,
    chunks: plan.provenance.map((row) => row.chunk),
    sources: plan.provenance.flatMap((row) => row.sources),
  };
  const sample = createIngestionPlan(input, 'sample', 1, 1);

  assert.equal(sample.selection.kind, 'SMOKE_SAMPLE');
  assert.equal(sample.selection.sourceChunkCount, 3);
  assert.equal(sample.index.expectedPointCount, 1);
  assert.throws(() => createIngestionPlan({ ...input, sources: [] }, 'bad'), IndexingError);
  assert.throws(
    () =>
      createIngestionPlan(
        { ...input, chunks: [input.chunks[0], input.chunks[0]].filter((x) => x !== undefined) },
        'bad',
      ),
    IndexingError,
  );
});

await test('re-ingestion replays deterministic upserts without new embedding and repairs missing stored points', async () => {
  const h = await harness();

  try {
    await h.run();
    h.memory.rows.clear();
    const result = await h.run(0);
    const report = object(JSON.parse(await readFile(resolve(h.directory, 'report.json'), 'utf8')));

    assert.equal(result?.pointCount, 3);
    assert.equal(h.calls(), 3);
    assert.equal(h.memory.rows.size, 3);
    assert.equal(report.newBatches, 0);
    assert.equal(report.indexingCostUsd, null);
    assert.equal(report.promotionEligible, false);
    assert.equal(report.totalEmbeddingBatchIntents, 3);
  } finally {
    await h.cleanup();
  }
});

await test('HTTP 429 is retained, no hidden retry, resume skips successful vectors and records all provider attempts', async () => {
  const h = await harness(2);
  const config = readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'fixture-secret' });
  assert.ok(config);

  let requests = 0;
  const hf = createHfInference(config, {
    fetch: () => {
      requests++;

      return Promise.resolve(
        requests === 2
          ? new Response('', { status: 429, headers: { 'retry-after': '1' } })
          : Response.json([dense().dense]),
      );
    },
    onAttempt: (attempt) =>
      appendJournal(h.directory, {
        kind: 'provider_attempt',
        planHash: hash(canonical(h.plan)),
        executionId: attempt.executionId,
        attempt,
      }),
  });

  try {
    await assert.rejects(
      h.run(2, hf.embedding),
      (error) => error instanceof InferenceError && error.code === 'RATE_LIMITED',
    );
    assert.equal(requests, 2);
    assert.equal(h.memory.rows.size, 1);

    await h.run(1, hf.embedding);
    const journal = await readJournal(h.directory);
    const report = object(JSON.parse(await readFile(resolve(h.directory, 'report.json'), 'utf8')));

    assert.equal(requests, 3);
    assert.equal(report.providerAttemptCount, 3);
    assert.equal(report.indexingCostUsd, null);
    assert.equal(report.knownCostCoverage, 0);
    assert.equal(
      journal.filter((event) => event.kind === 'run_finished' && event.outcome === 'FAILED').length,
      1,
    );
    assert.ok(!canonical(journal).includes('fixture-secret'));
    assert.ok(
      journal.some(
        (event) =>
          event.kind === 'provider_attempt' && object(event.attempt).errorCode === 'RATE_LIMITED',
      ),
    );
  } finally {
    hf.close();
    await h.cleanup();
  }
});

await test('upsert failure resumes from durable vectors with zero additional provider calls', async () => {
  const h = await harness(1);
  h.memory.setFailUpsert(true);

  try {
    await assert.rejects(h.run(), /LOST_ACKNOWLEDGEMENT/);
    h.memory.setFailUpsert(false);
    await h.run(0);

    assert.equal(h.calls(), 1);
    assert.equal(h.memory.rows.size, 1);
  } finally {
    await h.cleanup();
  }
});

await test('call ceiling and active collection preflight fail before paid embedding', async () => {
  const h = await harness(1);

  try {
    await assert.rejects(
      h.run(0),
      (error) => error instanceof IndexingError && error.code === 'CALL_BUDGET_EXHAUSTED',
    );
    h.memory.setWritable(false);
    await assert.rejects(h.run(), /ACTIVE_COLLECTION/);

    assert.equal(h.calls(), 0);
    assert.equal(h.memory.rows.size, 0);
  } finally {
    await h.cleanup();
  }
});

await test('persisted pre-call intent after a crash remains unknown and is not erased by successful resume', async () => {
  const h = await harness(1);

  try {
    await appendJournal(h.directory, {
      kind: 'embedding_started',
      executionId: 'crashed',
      offset: 0,
      planHash: hash(canonical(h.plan)),
      costUsd: null,
    });
    await h.run();
    const journal = await readJournal(h.directory);
    const report = object(JSON.parse(await readFile(resolve(h.directory, 'report.json'), 'utf8')));

    assert.ok(
      journal.some(
        (event) =>
          event.kind === 'prior_result_unavailable' && event.priorExecutionId === 'crashed',
      ),
    );
    assert.equal(report.unresolvedBatchResults, 1);
    assert.equal(report.totalEmbeddingBatchIntents, 2);
    assert.equal(report.indexingCostUsd, null);
  } finally {
    await h.cleanup();
  }
});

await test('lock, plan mutation and torn journal block network; invalid journal is preserved byte-for-byte', async () => {
  const h = await harness(1);

  try {
    await writeFile(resolve(h.directory, '.lock'), 'other-process');
    await assert.rejects(
      h.run(),
      (error) => error instanceof IndexingError && error.code === 'JOB_LOCKED',
    );
    await rm(resolve(h.directory, '.lock'));
    await writeFile(resolve(h.directory, 'journal.jsonl'), '{"kind":"embedding_started"');
    await assert.rejects(h.run(), IndexingError);

    assert.equal(
      await readFile(resolve(h.directory, 'journal.jsonl'), 'utf8'),
      '{"kind":"embedding_started"',
    );
    assert.equal(h.calls(), 0);
    assert.equal(h.memory.preparations(), 0);

    await writeFile(resolve(h.directory, 'plan.json'), '{}');
    await assert.rejects(h.run(), IndexingError);
    assert.equal(h.calls(), 0);
  } finally {
    await h.cleanup();
  }
});

await test('tampered cache and malformed vectors cannot reach Qdrant or trigger an implicit re-embedding', async () => {
  const h = await harness(1);

  try {
    await assert.rejects(h.run(1, { embed: () => Promise.resolve([{ dense: [1] }]) }));
    assert.equal(h.memory.rows.size, 0);

    await h.run();
    const path = resolve(h.directory, 'vectors-0.json');
    const cache = object(JSON.parse(await readFile(path, 'utf8')));
    await writeFile(
      path,
      canonical({ ...cache, vectors: [{ dense: dense().dense.map(() => 0.5) }] }) + '\n',
    );

    await assert.rejects(h.run(0), IndexingError);
    assert.equal(h.calls(), 1);
  } finally {
    await h.cleanup();
  }
});

await test('cache written before a crash is reconciled to its original intent without another provider call', async () => {
  const h = await harness(1);

  try {
    await h.run();
    const journal = await readJournal(h.directory);
    const beforeCrash = journal.filter(
      (event) => event.kind === 'run_started' || event.kind === 'embedding_started',
    );
    await writeFile(
      resolve(h.directory, 'journal.jsonl'),
      beforeCrash.map(canonical).join('\n') + '\n',
    );

    await h.run(0);
    const recovered = await readJournal(h.directory);
    const report = object(JSON.parse(await readFile(resolve(h.directory, 'report.json'), 'utf8')));

    assert.equal(h.calls(), 1);
    assert.equal(report.unresolvedBatchResults, 0);
    assert.equal(report.indexingCostUsd, null);
    assert.ok(
      recovered.some(
        (event) =>
          event.kind === 'vectors_recovered' && typeof event.originExecutionId === 'string',
      ),
    );

    const path = resolve(h.directory, 'vectors-0.json');
    const cache = object(JSON.parse(await readFile(path, 'utf8')));
    await writeFile(
      path,
      canonical({ ...cache, vectors: [{ dense: dense().dense.map(() => 0.5) }] }) + '\n',
    );

    await assert.rejects(h.run(0), IndexingError);
    assert.equal(h.calls(), 1);
  } finally {
    await h.cleanup();
  }
});

await test('DENSE validates optional sparse output without materializing it and rejects malformed sparse', async () => {
  const h = await harness(1);

  try {
    await assert.rejects(
      h.run(1, {
        embed: () => Promise.resolve([{ ...dense(), sparse: { indices: [1], values: [] } }]),
      }),
    );
    assert.equal(h.memory.rows.size, 0);

    await h.run(1, {
      embed: () => Promise.resolve([{ ...dense(), sparse: { indices: [1], values: [0.5] } }]),
    });

    assert.equal(Object.hasOwn([...h.memory.rows.values()][0]?.vector ?? {}, 'sparse'), false);
  } finally {
    await h.cleanup();
  }
});
