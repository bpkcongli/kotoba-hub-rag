import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { EMBEDDING_CONFIGURATION, EMBEDDING_CONFIG_ID } from '@/adapters/bge-configuration';
import { HF_IDENTITY } from '@/adapters/hf-config';
import { buildPreparation } from '@/ingestion/prepare';
import { BGE_TOKENIZER } from '@/ingestion/tokenizer';
import type { ApprovedSource, PreparedChunk } from '@/ingestion/types';
import { canonical, hash, object, string } from '@/ingestion/validation';
import { contentDigest, INDEX_SCHEMA_VERSION, parseIndexManifest } from '@/storage/index-manifest';
import type { IndexManifest } from '@/storage/index-manifest';
import { parseKnowledgePayload } from '@/storage/knowledge-payload';
import type { KnowledgePayload } from '@/storage/knowledge-payload';

export class IndexingError extends Error {
  readonly code:
    'INVALID_PLAN' | 'INTEGRITY_ERROR' | 'JOB_LOCKED' | 'INVALID_JOURNAL' | 'CALL_BUDGET_EXHAUSTED';

  constructor(code: IndexingError['code']) {
    super(`Corpus indexing failed: ${code}`);
    this.name = 'IndexingError';
    this.code = code;
  }
}

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

export async function loadPreparedCorpus(repoRoot: string) {
  const root = await contained(repoRoot, 'research/chunking');
  const pointer = object(JSON.parse(await readBounded(resolve(root, 'current.json'), 16384)));
  const manifestPath = await contained(root, string(pointer.preparationManifest));
  const body = await readBounded(manifestPath);

  if (
    hash(body) !== pointer.manifestSha256 ||
    pointer.usageScope !== 'internal_research' ||
    pointer.publicRedistributionAuthorized !== false ||
    pointer.experimentFrozen !== false
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

export interface IngestionPlan {
  readonly schemaVersion: 'data-03-plan-v1';
  readonly preparationManifestSha256: string;
  readonly usageScope: 'internal_research';
  readonly publicRedistributionAuthorized: false;
  readonly experimentFrozen: false;
  readonly batchSize: number;
  readonly selection: {
    readonly kind: 'ALL' | 'SMOKE_SAMPLE';
    readonly sourceChunkCount: number;
    readonly sampleSize: number | null;
  };
  readonly embeddingConfiguration: typeof EMBEDDING_CONFIGURATION;
  readonly index: IndexManifest;
  readonly points: readonly { readonly id: string; readonly payload: KnowledgePayload }[];
  readonly provenance: readonly {
    readonly chunk: PreparedChunk;
    readonly sources: readonly ApprovedSource[];
  }[];
}

export function pointId(chunk: PreparedChunk): string {
  const bytes = createHash('sha256')
    .update(
      canonical({
        corpus: chunk.corpusVersion,
        source: chunk.sourceId,
        chunk: chunk.chunkId,
        checksum: chunk.contentChecksum,
      }),
    )
    .digest()
    .subarray(0, 16);

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createIngestionPlan(
  input: {
    readonly manifestSha256: string;
    readonly chunks: readonly PreparedChunk[];
    readonly sources: readonly ApprovedSource[];
  },
  indexRevision: string,
  batchSize = 1,
  sampleSize: number | null = null,
): IngestionPlan {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 32 || !input.chunks.length) {
    throw new IndexingError('INVALID_PLAN');
  }

  if (
    sampleSize !== null &&
    (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > input.chunks.length)
  ) {
    throw new IndexingError('INVALID_PLAN');
  }

  const representatives = ['JLPT_N5', 'JLPT_N4'].flatMap((level) =>
    ['EN', 'ID'].flatMap((locale) => {
      const chunk = input.chunks.find(
        (chunk) => chunk.jlptLevel === level && chunk.locale === locale,
      );

      return chunk ? [chunk] : [];
    }),
  );
  const ordered = [...new Set([...representatives, ...input.chunks])];
  const chunks = sampleSize === null ? input.chunks : ordered.slice(0, sampleSize);
  const sources = new Map(input.sources.map((source) => [source.source_id, source]));
  const provenance = chunks.map((chunk) => ({
    chunk,
    sources: chunk.sourceIds.map((id) => {
      const source = sources.get(id);

      if (
        !source ||
        !source.ingestion_eligible ||
        source.researcher_review !== 'approved' ||
        source.parent_id !== chunk.parentId ||
        source.locale !== chunk.locale
      ) {
        throw new IndexingError('INTEGRITY_ERROR');
      }

      return source;
    }),
  }));
  const points = provenance.map(({ chunk, sources }) => {
    const licenses = [...new Set(sources.map((source) => source.license))];

    if (licenses.length !== 1 || !licenses[0] || hash(chunk.text) !== chunk.contentChecksum) {
      throw new IndexingError('INTEGRITY_ERROR');
    }

    return {
      id: pointId(chunk),
      payload: parseKnowledgePayload({
        chunk_id: chunk.chunkId,
        parent_id: chunk.parentId,
        corpus_version: chunk.corpusVersion,
        source_id: chunk.sourceId,
        source_url: chunk.sourceId,
        license: licenses[0],
        content_checksum: chunk.contentChecksum,
        track_slug: chunk.trackSlug,
        unit_slug: chunk.unitSlug,
        lesson_slug: chunk.lessonSlug,
        skill_codes: chunk.skillCodes,
        jlpt_level: chunk.jlptLevel,
        locale: chunk.locale,
        content_type: 'PEDAGOGICAL_CHUNK',
        published: true,
        chunk_index: chunk.chunkIndex,
        token_count: chunk.tokenCount,
        embedding_revision: HF_IDENTITY.servedModelRevision,
        embedding_config_id: EMBEDDING_CONFIG_ID,
        chunking_version: chunk.chunkingVersion,
        text: chunk.text,
      }),
    };
  });
  const corpusVersion = chunks[0]?.corpusVersion;

  if (
    chunks.some((chunk) => chunk.corpusVersion !== corpusVersion) ||
    new Set(points.map((point) => point.id)).size !== points.length ||
    new Set(chunks.map((chunk) => chunk.chunkId)).size !== points.length
  ) {
    throw new IndexingError('INTEGRITY_ERROR');
  }

  const index = parseIndexManifest({
    schemaVersion: INDEX_SCHEMA_VERSION,
    indexRevision,
    physicalCollection: `kotoba_${indexRevision}`,
    corpusVersion,
    retrievalProfile: 'DENSE',
    embeddingConfigId: EMBEDDING_CONFIG_ID,
    embeddingModelRevision: HF_IDENTITY.servedModelRevision,
    tokenizerRevision: HF_IDENTITY.tokenizerRevision,
    processingRevision: HF_IDENTITY.processingRevision,
    sparseCapabilityVerified: false,
    sparseTokenMappingId: null,
    expectedPointCount: points.length,
    contentDigest: contentDigest(
      chunks.map((chunk) => ({ chunkId: chunk.chunkId, checksum: chunk.contentChecksum })),
    ),
  });

  return {
    schemaVersion: 'data-03-plan-v1',
    preparationManifestSha256: input.manifestSha256,
    usageScope: 'internal_research',
    publicRedistributionAuthorized: false,
    experimentFrozen: false,
    batchSize,
    selection: {
      kind: sampleSize === null ? 'ALL' : 'SMOKE_SAMPLE',
      sourceChunkCount: input.chunks.length,
      sampleSize,
    },
    embeddingConfiguration: EMBEDDING_CONFIGURATION,
    index,
    points,
    provenance,
  };
}

export async function currentIngestionPlan(
  repoRoot: string,
  indexRevision: string,
  batchSize = 1,
  sampleSize: number | null = null,
) {
  const prepared = await loadPreparedCorpus(repoRoot);

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
