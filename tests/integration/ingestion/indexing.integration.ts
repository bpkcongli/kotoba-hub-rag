import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { QdrantClient } from '@qdrant/js-client-rest';
import { dense, fixturePlan } from '@tests/__fixtures__/indexing-fixture';
import { StoreError } from '@/modules/knowledge/application/index-manifest';
import { createIngestionPlan } from '@/modules/knowledge/application/index-plan';
import { runIndexJob } from '@/modules/knowledge/infrastructure/di/index';
import { createIndexJob } from '@/modules/knowledge/interface/secondary/corpus/index-job';
import { knowledgeFilter } from '@/modules/knowledge/interface/secondary/qdrant/knowledge-filter';
import { QdrantIndexStore } from '@/modules/knowledge/interface/secondary/qdrant/qdrant-index';

const url = process.env.STORE01_QDRANT_URL;
assert.ok(url, 'Gunakan npm run test:store untuk Qdrant sementara nyata');
assert.equal(new URL(url).hostname, '127.0.0.1');

await test('DATA-03 real Qdrant ingestion, replay, filter, immutable config, promotion guard and candidate removal', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'kotoba-data03-integration-'));
  const directory = resolve(root, 'job');
  const original = fixturePlan();
  const plan = createIngestionPlan(
    {
      manifestSha256: original.preparationManifestSha256,
      chunks: original.provenance.map((row) => row.chunk),
      sources: original.provenance.flatMap((row) => row.sources),
    },
    `data03_${process.pid}`,
  );
  const store = new QdrantIndexStore({ url, timeoutMs: 5000 });
  const client = new QdrantClient({ url, port: null, checkCompatibility: false });
  let calls = 0;
  const options = {
    directory,
    plan,
    store,
    timeoutMs: 5000,
    maxNewBatches: 3,
    signal: new AbortController().signal,
    embedding: {
      embed: async (texts: readonly string[]) => {
        calls++;
        await Promise.resolve();

        return texts.map(() => dense());
      },
    },
  };

  try {
    await createIndexJob(directory, plan);
    const first = await runIndexJob(options);
    const second = await runIndexJob({ ...options, maxNewBatches: 0 });

    assert.equal(first?.pointCount, 3);
    assert.equal(first?.searchSmokePassed, true);
    assert.deepEqual(second, first);
    assert.equal(calls, 3);
    assert.equal((await client.count(plan.index.physicalCollection, { exact: true })).count, 3);

    const filter = knowledgeFilter(
      {
        published: true,
        corpusVersion: plan.index.corpusVersion,
        targetLevel: 'JLPT_N5',
        skillCodes: ['grammar-ni'],
      },
      plan.index,
    );
    const positive = await client.query(plan.index.physicalCollection, {
      query: dense().dense,
      using: 'dense',
      filter,
      limit: 10,
    });
    const negative = await client.query(plan.index.physicalCollection, {
      query: dense().dense,
      using: 'dense',
      filter: { must: [filter, { key: 'jlpt_level', match: { value: 'JLPT_N4' } }] },
      limit: 10,
    });

    assert.equal(positive.points.length, 3);
    assert.equal(negative.points.length, 0);
    assert.deepEqual(
      new Set(positive.points.map((point) => point.id)),
      new Set(plan.points.map((point) => point.id)),
    );
    await assert.rejects(
      store.prepare({ ...plan.index, embeddingConfigId: 'changed' }),
      StoreError,
    );
    await assert.rejects(
      store.promote(plan.index, 'kotoba_active_data03'),
      (error) => error instanceof StoreError && error.code === 'UNSAFE_LIFECYCLE',
    );

    await client.updateCollectionAliases({
      actions: [
        {
          create_alias: {
            alias_name: 'kotoba_active_test_data03',
            collection_name: plan.index.physicalCollection,
          },
        },
      ],
    });

    await assert.rejects(runIndexJob({ ...options, maxNewBatches: 3 }), StoreError);
    await assert.rejects(store.remove(plan.index), StoreError);
    assert.equal(calls, 3);

    await client.updateCollectionAliases({
      actions: [{ delete_alias: { alias_name: 'kotoba_active_test_data03' } }],
    });
    await store.remove(plan.index);

    assert.equal((await client.collectionExists(plan.index.physicalCollection)).exists, false);
  } finally {
    // All server data belongs to the runner's disposable Compose project.
    await rm(root, { recursive: true, force: true });
  }
});
