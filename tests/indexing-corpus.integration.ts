import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { createIndexJob } from '@/ingestion/index-job';
import { currentIngestionPlan } from '@/ingestion/index-plan';
import { canonical, hash } from '@/ingestion/validation';

await test('DATA-03 full approved corpus maps deterministically to strict payload and source/overlap sidecars without provider calls', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'kotoba-data03-corpus-'));

  try {
    const plan = await currentIngestionPlan(resolve('.'), 'data03_corpus_test');
    const sample = await currentIngestionPlan(resolve('.'), 'data03_smoke_test', 1, 3);
    const second = await currentIngestionPlan(resolve('.'), 'data03_corpus_test');

    assert.deepEqual(plan, second);
    assert.equal(plan.points.length, 98);
    assert.equal(new Set(plan.points.map((point) => point.id)).size, 98);
    assert.equal(
      new Set(plan.provenance.flatMap((row) => row.sources.map((source) => source.source_id))).size,
      736,
    );
    assert.equal(plan.provenance.flatMap((row) => row.chunk.overlapUnitIds).length, 48);
    assert.equal(plan.index.embeddingModelRevision, null);
    assert.equal(plan.index.tokenizerRevision, null);
    assert.equal(plan.index.processingRevision, null);
    assert.equal(sample.points.length, 3);
    assert.deepEqual(
      new Set(sample.points.map((point) => point.payload.jlpt_level)),
      new Set(['JLPT_N5', 'JLPT_N4']),
    );
    assert.deepEqual(
      new Set(sample.points.map((point) => point.payload.locale)),
      new Set(['EN', 'ID']),
    );

    for (const point of plan.points) {
      assert.equal(point.payload.content_checksum, hash(point.payload.text));
      assert.equal(point.payload.embedding_config_id, plan.index.embeddingConfigId);
      assert.ok(!('sourceIds' in point.payload));
      assert.equal(point.payload.published, true);
    }

    const directory = resolve(root, 'job');
    await createIndexJob(directory, plan);

    assert.equal(await readFile(resolve(directory, 'plan.json'), 'utf8'), canonical(plan) + '\n');
    await assert.rejects(createIndexJob(directory, plan));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
