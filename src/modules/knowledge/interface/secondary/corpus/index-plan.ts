import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { createIngestionPlan } from '@/modules/knowledge/application/index-plan';
import { canonical, hash, object, string } from '@/modules/knowledge/application/validation';
import { IndexingError } from '@/modules/knowledge/domain/exceptions/indexing-error';
import type { RubricBundle } from '@/modules/knowledge/domain/models/rubric';
import { buildPreparation } from '@/modules/knowledge/interface/secondary/corpus/prepare';
import { BGE_TOKENIZER } from '@/modules/knowledge/interface/secondary/corpus/tokenizer';

export async function readBounded(path: string, maxBytes = 32 * 1024 * 1024): Promise<string> {
  if ((await stat(path)).size > maxBytes) {
    throw new IndexingError('INTEGRITY_ERROR');
  }

  const body = await readFile(path, 'utf8');

  if (Buffer.byteLength(body) > maxBytes) {
    throw new IndexingError('INTEGRITY_ERROR');
  }

  return body;
}

async function contained(root: string, name: string): Promise<string> {
  if (isAbsolute(name) || name.includes('\\') || name.split('/').includes('..')) {
    throw new IndexingError('INTEGRITY_ERROR');
  }

  const path = await realpath(resolve(root, name));

  if (!path.startsWith(`${await realpath(root)}${sep}`)) {
    throw new IndexingError('INTEGRITY_ERROR');
  }

  return path;
}

export async function loadPreparedCorpus(
  repoRoot: string,
  rubricBundle?: RubricBundle,
  rubricBundleManifestSha256?: string,
) {
  const root = await contained(repoRoot, 'research/chunking');
  const pointer = object(JSON.parse(await readBounded(resolve(root, 'current.json'), 16384)));
  const manifestPath = await contained(root, string(pointer.preparationManifest));
  const body = await readBounded(manifestPath);

  if (
    hash(body) !== pointer.manifestSha256 ||
    pointer.usageScope !== 'internal_research' ||
    pointer.publicRedistributionAuthorized !== false ||
    pointer.experimentFrozen !== false ||
    (rubricBundle !== undefined) !== (pointer.rubricBundleSha256 !== undefined) ||
    (rubricBundle !== undefined &&
      (rubricBundleManifestSha256 === undefined ||
        !/^[a-f0-9]{64}$/.test(rubricBundleManifestSha256) ||
        rubricBundleManifestSha256 !== pointer.rubricBundleSha256)) ||
    (rubricBundle === undefined && rubricBundleManifestSha256 !== undefined)
  ) {
    throw new IndexingError('INTEGRITY_ERROR');
  }

  const output = await contained(repoRoot, string(pointer.localOutputDirectory));

  if ((await readBounded(await contained(output, 'manifest.json'))) !== body) {
    throw new IndexingError('INTEGRITY_ERROR');
  }

  // Rebuild from the approved snapshot, pinned tokenizer and config. This verifies typed
  // chunks, provenance and token/offset accounting without trusting JSON type assertions.
  const preparation = await buildPreparation({
    ...(rubricBundle === undefined ? {} : { rubricBundle }),
    repoRoot,
    configPath: await contained(dirname(manifestPath), 'config.json'),
    tokenizerDirectory: resolve(repoRoot, `artifacts/tokenizers/bge-m3/${BGE_TOKENIZER.revision}`),
  });

  if (canonical(preparation.manifest) !== canonical(JSON.parse(body))) {
    throw new IndexingError('INTEGRITY_ERROR');
  }

  for (const [name, expected] of Object.entries(preparation.files)) {
    if ((await readBounded(await contained(output, name))) !== expected) {
      throw new IndexingError('INTEGRITY_ERROR');
    }
  }

  return { ...preparation, manifestSha256: hash(body) };
}

export async function currentIngestionPlan(
  repoRoot: string,
  indexRevision: string,
  batchSize = 1,
  sampleSize: number | null = null,
  rubricBundle?: RubricBundle,
  rubricBundleManifestSha256?: string,
) {
  const prepared = await loadPreparedCorpus(repoRoot, rubricBundle, rubricBundleManifestSha256);

  return createIngestionPlan(
    {
      manifestSha256: prepared.manifestSha256,
      chunks: prepared.chunks,
      sources: prepared.corpus.sources,
    },
    indexRevision,
    batchSize,
    sampleSize,
  );
}
