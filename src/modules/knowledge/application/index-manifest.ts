import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { HF_IDENTITY } from '@/modules/knowledge/application/inference-identity';

export const QDRANT_VERSION = '1.20.2';

export const INDEX_SCHEMA_VERSION = 'qdrant-store-01-v1';

export const PAYLOAD_INDEXES = Object.freeze({
  published: 'bool',
  corpus_version: 'keyword',
  jlpt_level: 'keyword',
  skill_codes: 'keyword',
  embedding_config_id: 'keyword',
  chunk_id: 'keyword',
  source_id: 'keyword',
  content_checksum: 'keyword',
  track_slug: 'keyword',
  unit_slug: 'keyword',
  lesson_slug: 'keyword',
  locale: 'keyword',
  content_type: 'keyword',
} as const);

export interface IndexManifest {
  readonly schemaVersion: typeof INDEX_SCHEMA_VERSION;

  readonly indexRevision: string;

  readonly physicalCollection: string;

  readonly corpusVersion: string;

  readonly retrievalProfile: 'DENSE' | 'HYBRID';

  readonly embeddingConfigId: string;

  readonly embeddingModelRevision: string | null;

  readonly tokenizerRevision: string | null;

  readonly processingRevision: string | null;

  readonly sparseCapabilityVerified: boolean;

  readonly sparseTokenMappingId: string | null;

  readonly expectedPointCount: number;

  readonly contentDigest: string;
}

export class StoreError extends Error {
  readonly code:
    | 'INVALID_MANIFEST'
    | 'INCOMPATIBLE_INDEX'
    | 'INVALID_CONTENT'
    | 'DEPENDENCY_ERROR'
    | 'UNSAFE_LIFECYCLE';

  constructor(code: StoreError['code']) {
    super(`Qdrant storage failed: ${code}`);
    this.name = 'StoreError';
    this.code = code;
  }
}

const text = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_.:-]+$' };
const revision = { anyOf: [text, { type: 'null' }] };
const validate = new Ajv({
  strict: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
}).compile<IndexManifest>({
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'indexRevision',
    'physicalCollection',
    'corpusVersion',
    'retrievalProfile',
    'embeddingConfigId',
    'embeddingModelRevision',
    'tokenizerRevision',
    'processingRevision',
    'sparseCapabilityVerified',
    'sparseTokenMappingId',
    'expectedPointCount',
    'contentDigest',
  ],
  properties: {
    schemaVersion: { const: INDEX_SCHEMA_VERSION },
    indexRevision: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_]+$' },
    physicalCollection: { type: 'string', pattern: '^kotoba_[a-z0-9_]{1,100}$' },
    corpusVersion: text,
    retrievalProfile: { enum: ['DENSE', 'HYBRID'] },
    embeddingConfigId: text,
    embeddingModelRevision: revision,
    tokenizerRevision: revision,
    processingRevision: revision,
    sparseCapabilityVerified: { type: 'boolean' },
    sparseTokenMappingId: revision,
    expectedPointCount: { type: 'integer', minimum: 0, maximum: 100000 },
    contentDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  },
});

export function parseIndexManifest(value: unknown): IndexManifest {
  if (!validate(value) || value.physicalCollection !== `kotoba_${value.indexRevision}`) {
    throw new StoreError('INVALID_MANIFEST');
  }

  if (
    value.retrievalProfile === 'HYBRID' &&
    (!value.sparseCapabilityVerified || value.sparseTokenMappingId === null)
  ) {
    throw new StoreError('INVALID_MANIFEST');
  }

  if (
    value.retrievalProfile === 'DENSE' &&
    (value.sparseCapabilityVerified || value.sparseTokenMappingId !== null)
  ) {
    throw new StoreError('INVALID_MANIFEST');
  }

  // Canonical property order makes fingerprints independent of JSON key order.
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    indexRevision: value.indexRevision,
    physicalCollection: value.physicalCollection,
    corpusVersion: value.corpusVersion,
    retrievalProfile: value.retrievalProfile,
    embeddingConfigId: value.embeddingConfigId,
    embeddingModelRevision: value.embeddingModelRevision,
    tokenizerRevision: value.tokenizerRevision,
    processingRevision: value.processingRevision,
    sparseCapabilityVerified: value.sparseCapabilityVerified,
    sparseTokenMappingId: value.sparseTokenMappingId,
    expectedPointCount: value.expectedPointCount,
    contentDigest: value.contentDigest,
  });
}

export function manifestFingerprint(manifest: IndexManifest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        manifest: parseIndexManifest(manifest),
        serverVersion: QDRANT_VERSION,
        embeddingProvider: HF_IDENTITY.provider,
        embeddingModel: HF_IDENTITY.embeddingModel,
        embeddingEndpoint: HF_IDENTITY.embeddingEndpoint,
        embeddingConfigVersion: HF_IDENTITY.configVersion,
        normalize: true,
        truncate: false,
        dense: { size: 1024, distance: 'Cosine', datatype: 'float32' },
        sparse:
          manifest.retrievalProfile === 'HYBRID' ? { datatype: 'float32', modifier: null } : null,
        hnsw: { m: 16, ef_construct: 100, full_scan_threshold: 10000 },
        shardNumber: 1,
        replicationFactor: 1,
        payloadIndexes: PAYLOAD_INDEXES,
      }),
    )
    .digest('hex');
}

export function contentDigest(chunks: readonly { chunkId: string; checksum: string }[]): string {
  const sorted = chunks
    .map(({ chunkId, checksum }) => ({ chunkId, checksum }))
    .sort((a, b) => (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0));

  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
