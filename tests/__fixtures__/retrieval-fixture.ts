import { createHash, randomUUID } from 'node:crypto';

import { retrievalConfig } from '@/retrieval/config';
import type { RetrievalConfig } from '@/retrieval/config';
import {
  INDEX_SCHEMA_VERSION,
  manifestFingerprint,
  parseIndexManifest,
  PAYLOAD_INDEXES,
  QDRANT_VERSION,
} from '@/storage/index-manifest';
import type { IndexManifest } from '@/storage/index-manifest';

export const checksum = (text: string): string => createHash('sha256').update(text).digest('hex');
export const dense = (index = 0): number[] =>
  Array.from({ length: 1024 }, (_v, i) => (i === index ? 1 : 0));
export const scope = {
  published: true,
  corpusVersion: 'rag01-synthetic-v1',
  targetLevel: 'JLPT_N5',
  skillCodes: ['grammar-ni'],
} as const;
export const context = (): { executionId: string; signal: AbortSignal; deadlineAt: string } => ({
  executionId: randomUUID(),
  signal: new AbortController().signal,
  deadlineAt: new Date(Date.now() + 30000).toISOString(),
});

export function manifest(profile: 'DENSE' | 'HYBRID' = 'DENSE'): IndexManifest {
  const indexRevision = `rag01_${randomUUID().replaceAll('-', '')}`;

  return parseIndexManifest({
    schemaVersion: INDEX_SCHEMA_VERSION,
    indexRevision,
    physicalCollection: `kotoba_${indexRevision}`,
    corpusVersion: scope.corpusVersion,
    retrievalProfile: profile,
    embeddingConfigId: 'synthetic-query-embedding-v1',
    embeddingModelRevision: 'fixture-model',
    tokenizerRevision: 'fixture-tokenizer',
    processingRevision: 'fixture-processing',
    sparseCapabilityVerified: profile === 'HYBRID',
    sparseTokenMappingId: profile === 'HYBRID' ? 'fixture-token-map' : null,
    expectedPointCount: 2,
    contentDigest: 'a'.repeat(64),
  });
}

export function settings(
  profile: 'DENSE' | 'HYBRID' = 'DENSE',
  values: Record<string, string> = {},
): RetrievalConfig {
  return retrievalConfig(manifest(profile), values);
}

export function info(index: IndexManifest) {
  return {
    status: 'green',
    optimizer_status: 'ok',
    payload_schema: Object.fromEntries(
      Object.entries(PAYLOAD_INDEXES).map(([key, data_type]) => [key, { data_type }]),
    ),
    config: {
      params: {
        vectors: { dense: { size: 1024, distance: 'Cosine', datatype: 'float32' } },
        sparse_vectors:
          index.retrievalProfile === 'HYBRID' ? { sparse: { index: { datatype: 'float32' } } } : {},
        shard_number: 1,
        replication_factor: 1,
        write_consistency_factor: 1,
      },
      hnsw_config: { m: 16, ef_construct: 100, full_scan_threshold: 10000 },
      metadata: {
        schema_version: INDEX_SCHEMA_VERSION,
        fingerprint: manifestFingerprint(index),
        manifest: index,
      },
    },
  };
}

export function payload(index: IndexManifest, id = 1, overrides: Record<string, unknown> = {}) {
  const text = `七時に起きます。 ${id}`;

  return {
    chunk_id: `chunk-${id}`,
    parent_id: 'parent',
    source_id: `source-${id}`,
    source_url: 'https://example.invalid/rag01',
    license: 'synthetic-fixture',
    content_checksum: checksum(text),
    track_slug: 'n5',
    unit_slug: 'time',
    lesson_slug: 'ni',
    skill_codes: ['grammar-ni'],
    jlpt_level: 'JLPT_N5',
    locale: 'JA',
    content_type: 'example',
    published: true,
    chunk_index: id,
    token_count: 10,
    embedding_revision: index.embeddingModelRevision,
    embedding_config_id: index.embeddingConfigId,
    corpus_version: index.corpusVersion,
    chunking_version: 'fixture-v1',
    text,
    ...overrides,
  };
}

export function hit(
  index: IndexManifest,
  id = 1,
  score = 1,
  overrides: Record<string, unknown> = {},
) {
  return { id, score, payload: payload(index, id, overrides) };
}

export function transport(
  index: IndexManifest,
  respond: (body: unknown, path: string) => Response,
  requests: unknown[] = [],
): typeof fetch {
  return (url, options) => {
    if (typeof url !== 'string') {
      throw new Error('Fixture expects URL string');
    }

    const path = new URL(url).pathname;

    if (path === '/') {
      return Promise.resolve(Response.json({ version: QDRANT_VERSION }));
    }

    if (path === '/collections') {
      return Promise.resolve(
        Response.json({ result: { collections: [{ name: index.physicalCollection }] } }),
      );
    }

    if (!path.includes('/points/')) {
      return Promise.resolve(Response.json({ result: info(index) }));
    }

    const body: unknown = typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    requests.push(body);

    return Promise.resolve(respond(body, path));
  };
}
