import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { loadApprovedCorpus } from '@/ingestion/corpus-loader';
import { prepareCorpus } from '@/ingestion/prepare';
import { BGE_TOKENIZER, loadBgeTokenCounter } from '@/ingestion/tokenizer';
import { IngestionError } from '@/ingestion/types';
import { array, hash, object, string } from '@/ingestion/validation';

const tokenizerDirectory = resolve(`artifacts/tokenizers/bge-m3/${BGE_TOKENIZER.revision}`);
const configPath = resolve('research/chunking/data-02-v1/config.json');

await test('pinned Node tokenizer counts match native Hugging Face reference for JA/EN/ID and Unicode variants', async () => {
  const counter = await loadBgeTokenCounter(tokenizerDirectory);
  const reference = object(
    JSON.parse(await readFile('research/chunking/data-02-v1/tokenizer-reference.json', 'utf8')),
  );

  for (const item of array(reference.samples)) {
    const sample = object(item);
    const count = await counter.count(string(sample.text));

    assert.equal(count.content, sample.content_tokens);
    assert.equal(count.total, sample.total_tokens);
    assert.equal(count.special, 2);
  }

  assert.equal(counter.identity.revision, reference.revision);
});

await test('approved corpus preparation is reproducible, complete, budgeted and traceable to original JSON fields', async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), 'kotoba-data02-real-'));
  const options = {
    repoRoot: resolve('.'),
    configPath,
    tokenizerDirectory,
    outputDirectory: resolve(scratch, 'first'),
  };

  try {
    const corpus = await loadApprovedCorpus(options.repoRoot);
    const counter = await loadBgeTokenCounter(tokenizerDirectory);

    const first = await prepareCorpus(options);
    const second = await prepareCorpus({ ...options, outputDirectory: resolve(scratch, 'second') });

    assert.deepEqual(first, second);

    const recorded = JSON.parse(
      await readFile('research/chunking/data-02-v1/preparation-manifest.json', 'utf8'),
    ) as unknown;

    assert.deepEqual(first, recorded);
    assert.equal(first.counts.sourceDocuments, 736);
    assert.equal(first.counts.normalizedLessons, 40);

    const readLines = async (name: string) =>
      (await readFile(resolve(options.outputDirectory, name), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => object(JSON.parse(line)));

    const parents = new Map(
      (await readLines('normalized-lessons.jsonl')).map((row) => [row.id, row]),
    );
    const chunks = await readLines('chunks.jsonl');

    const allUnitIds = new Set<string>();
    const covered = new Set<string>();

    for (const chunk of chunks) {
      const parent = parents.get(chunk.sourceId);
      assert.ok(parent);

      const text = string(chunk.text);
      const parentText = string(parent.text);

      assert.equal(typeof chunk.start, 'number');
      assert.equal(typeof chunk.end, 'number');

      const start = Number(chunk.start);
      const end = Number(chunk.end);

      assert.equal(text, parentText.slice(start, end));
      assert.equal(hash(text), chunk.contentChecksum);
      assert.equal((await counter.count(text)).total, chunk.tokenCount);
      assert.ok(Number(chunk.tokenCount) <= first.config.maxTokens);

      for (const id of array(chunk.unitIds)) {
        allUnitIds.add(string(id));
      }

      for (const id of array(chunk.sourceIds)) {
        covered.add(string(id));
      }

      for (const item of array(chunk.spans)) {
        const span = object(item);
        const doc = corpus.sources.find((source) => source.source_id === span.sourceId);
        assert.ok(doc);

        let raw: unknown = doc;

        for (const part of string(span.jsonPath)
          .replace(/\[(\d+)\]/g, '.$1')
          .slice(2)
          .split('.')) {
          raw = Array.isArray(raw) ? raw[Number(part)] : object(raw)[part];
        }

        assert.equal(typeof raw, 'string');
        assert.equal(hash(string(raw)), span.rawChecksum);
        assert.equal(span.rawStart, 0);
        assert.equal(span.rawEnd, string(raw).length);
        assert.ok(Number(span.start) >= start && Number(span.end) <= end);
      }
    }

    assert.equal(covered.size, corpus.sources.length);
    assert.equal(allUnitIds.size, first.counts.pedagogicalUnits);

    await assert.rejects(
      prepareCorpus(options),
      (error) => error instanceof IngestionError && error.code === 'OUTPUT_EXISTS',
    );

    assert.deepEqual(first.files, second.files);

    const tinyConfig = resolve(scratch, 'tiny-config.json');
    const rejectedOutput = resolve(scratch, 'rejected');
    await writeFile(
      tinyConfig,
      JSON.stringify({ ...first.config, maxTokens: 16, overlapTokens: 0 }),
    );

    await assert.rejects(
      prepareCorpus({ ...options, configPath: tinyConfig, outputDirectory: rejectedOutput }),
      (error) => error instanceof IngestionError && error.code === 'ATOMIC_UNIT_TOO_LARGE',
    );
    await assert.rejects(access(rejectedOutput), { code: 'ENOENT' });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
