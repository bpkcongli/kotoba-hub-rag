import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { Schemas } from '@qdrant/js-client-rest';
import { validateEmbeddingBatch } from '@/adapters/hf-validation';
import type { EmbeddingVector } from '@/shared/ports';
import {
  contentDigest,
  INDEX_SCHEMA_VERSION,
  manifestFingerprint,
  parseIndexManifest,
  PAYLOAD_INDEXES,
  QDRANT_VERSION,
  StoreError,
} from '@/storage/index-manifest';
import type { IndexManifest } from '@/storage/index-manifest';
import { knowledgeFilter } from '@/storage/knowledge-filter';
import { parseKnowledgePayload } from '@/storage/knowledge-payload';
import { readQdrantConfig } from '@/storage/qdrant-config';
import type { QdrantConfig } from '@/storage/qdrant-config';

export interface IndexValidation {
  readonly physicalCollection: string;
  readonly indexRevision: string;
  readonly fingerprint: string;
  readonly pointCount: number;
  readonly contentDigest: string;
  readonly retrievalProfile: IndexManifest['retrievalProfile'];
  readonly modelRevisionsRecorded: boolean;
  readonly searchSmokePassed: boolean;
}

export interface IndexPoint {
  readonly id: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly vector: EmbeddingVector;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function metadata(manifest: IndexManifest): Record<string, unknown> {
  return {
    schema_version: INDEX_SCHEMA_VERSION,
    fingerprint: manifestFingerprint(manifest),
    manifest,
  };
}

export function checkCollection(
  info: unknown,
  manifest: IndexManifest,
  requireIndexes: boolean,
): void {
  if (
    !object(info) ||
    !object(info.config) ||
    !object(info.config.params) ||
    !object(info.config.hnsw_config) ||
    !object(info.config.metadata) ||
    !object(info.payload_schema)
  ) {
    throw new StoreError('INCOMPATIBLE_INDEX');
  }

  const config = info.config;
  const params = config.params;
  const hnsw = config.hnsw_config;
  const meta = config.metadata;
  const payloadSchema = info.payload_schema;

  // Recheck nested values locally so this boundary accepts untrusted HTTP JSON.
  if (!object(params) || !object(hnsw) || !object(meta)) {
    throw new StoreError('INCOMPATIBLE_INDEX');
  }

  const vectors = params.vectors;
  const sparse = params.sparse_vectors ?? {};

  if (!object(sparse)) {
    throw new StoreError('INCOMPATIBLE_INDEX');
  }

  if (
    !object(vectors) ||
    Object.keys(vectors).length !== 1 ||
    !object(vectors.dense) ||
    vectors.dense.size !== 1024 ||
    vectors.dense.distance !== 'Cosine' ||
    vectors.dense.datatype !== 'float32' ||
    vectors.dense.multivector_config != null ||
    vectors.dense.hnsw_config != null ||
    vectors.dense.quantization_config != null ||
    config.quantization_config != null ||
    hnsw.m !== 16 ||
    hnsw.ef_construct !== 100 ||
    hnsw.full_scan_threshold !== 10000 ||
    params.shard_number !== 1 ||
    params.replication_factor !== 1 ||
    params.write_consistency_factor !== 1 ||
    (manifest.retrievalProfile === 'DENSE'
      ? Object.keys(sparse).length !== 0
      : Object.keys(sparse).length !== 1 ||
        !object(sparse.sparse) ||
        sparse.sparse.modifier != null ||
        !object(sparse.sparse.index) ||
        sparse.sparse.index.datatype !== 'float32') ||
    meta.schema_version !== INDEX_SCHEMA_VERSION ||
    meta.fingerprint !== manifestFingerprint(manifest) ||
    JSON.stringify(meta.manifest) === undefined
  ) {
    throw new StoreError('INCOMPATIBLE_INDEX');
  }

  // Check metadata contents as well as the recorded hash; neither may drift independently.
  if (manifestFingerprint(parseIndexManifest(meta.manifest)) !== manifestFingerprint(manifest)) {
    throw new StoreError('INCOMPATIBLE_INDEX');
  }

  for (const [field, type] of Object.entries(PAYLOAD_INDEXES)) {
    const actual = payloadSchema[field];

    if (
      (requireIndexes && actual === undefined) ||
      (actual !== undefined && (!object(actual) || actual.data_type !== type))
    ) {
      throw new StoreError('INCOMPATIBLE_INDEX');
    }
  }
}

function checkPoint(
  point: Schemas['Record'],
  manifest: IndexManifest,
): { chunkId: string; checksum: string } {
  const payload = parseKnowledgePayload(point.payload);
  const vector: unknown = point.vector;

  if (
    payload.corpus_version !== manifest.corpusVersion ||
    payload.embedding_config_id !== manifest.embeddingConfigId ||
    payload.embedding_revision !== manifest.embeddingModelRevision ||
    !object(vector) ||
    Object.keys(vector).some((name) => name !== 'dense' && name !== 'sparse') ||
    (manifest.retrievalProfile === 'DENSE' && Object.hasOwn(vector, 'sparse'))
  ) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (createHash('sha256').update(payload.text).digest('hex') !== payload.content_checksum) {
    throw new StoreError('INVALID_CONTENT');
  }

  try {
    validateEmbeddingBatch([vector], 1, manifest.retrievalProfile);
  } catch {
    throw new StoreError('INVALID_CONTENT');
  }

  return { chunkId: payload.chunk_id, checksum: payload.content_checksum };
}

// Admin lifecycle only. Runtime ranking, retries and request-level cancellation belong to RAG/ADP.
export class QdrantIndexStore {
  private readonly client: QdrantClient;

  constructor(config: QdrantConfig) {
    const settings = readQdrantConfig({
      QDRANT_ENABLED: 'true',
      QDRANT_URL: config.url,
      QDRANT_API_KEY: config.apiKey,
      QDRANT_TIMEOUT_MS: String(config.timeoutMs),
    });

    if (!settings) {
      throw new StoreError('DEPENDENCY_ERROR');
    }

    this.client = new QdrantClient({
      url: settings.url,
      // Honor URL scheme defaults (443/80) instead of the SDK's implicit :6333 override.
      port: null,
      ...(settings.apiKey === undefined ? {} : { apiKey: settings.apiKey }),
      timeout: settings.timeoutMs,
      maxConnections: 1,
      // Explicit version check in each admin operation; constructor/startup performs no network.
      checkCompatibility: false,
    });
  }

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof StoreError) {
        throw error;
      }

      // SDK errors may contain request URLs, headers or payloads. Never expose raw causes.
      throw new StoreError('DEPENDENCY_ERROR');
    }
  }

  private async assertVersion(): Promise<void> {
    const { data } = await this.client.api().root({});

    if (data.version !== QDRANT_VERSION) {
      throw new StoreError('INCOMPATIBLE_INDEX');
    }
  }

  private async inspect(
    manifest: IndexManifest,
    requireIndexes = true,
  ): Promise<Schemas['CollectionInfo']> {
    const collections = await this.client.getCollections();

    // Do not resolve aliases: a run must keep referring to its physical collection.
    if (!collections.collections.some((item) => item.name === manifest.physicalCollection)) {
      throw new StoreError('INCOMPATIBLE_INDEX');
    }

    const info = await this.client.getCollection(manifest.physicalCollection);

    checkCollection(info, manifest, requireIndexes);

    return info;
  }

  async prepare(value: IndexManifest): Promise<{ created: boolean; fingerprint: string }> {
    const manifest = parseIndexManifest(value);

    return this.guarded(async () => {
      await this.assertVersion();

      const exists = await this.client.collectionExists(manifest.physicalCollection);

      if (!exists.exists) {
        await this.client.createCollection(manifest.physicalCollection, {
          vectors: { dense: { size: 1024, distance: 'Cosine', datatype: 'float32' } },
          ...(manifest.retrievalProfile === 'HYBRID'
            ? { sparse_vectors: { sparse: { index: { datatype: 'float32' as const } } } }
            : {}),
          shard_number: 1,
          replication_factor: 1,
          write_consistency_factor: 1,
          hnsw_config: { m: 16, ef_construct: 100, full_scan_threshold: 10000 },
          metadata: metadata(manifest),
        });
      }

      const info = await this.inspect(manifest, false);

      for (const [field, type] of Object.entries(PAYLOAD_INDEXES)) {
        if (info.payload_schema[field] === undefined) {
          await this.client.createPayloadIndex(manifest.physicalCollection, {
            field_name: field,
            field_schema: type,
            wait: true,
          });
        }
      }

      await this.inspect(manifest);

      return { created: !exists.exists, fingerprint: manifestFingerprint(manifest) };
    });
  }

  async validate(value: IndexManifest): Promise<IndexValidation> {
    const manifest = parseIndexManifest(value);

    return this.guarded(async () => {
      await this.assertVersion();
      const info = await this.inspect(manifest);

      if (info.status === 'red' || info.optimizer_status !== 'ok') {
        throw new StoreError('INCOMPATIBLE_INDEX');
      }

      const count = await this.client.count(manifest.physicalCollection, { exact: true });

      if (count.count !== manifest.expectedPointCount) {
        throw new StoreError('INVALID_CONTENT');
      }

      const chunks: { chunkId: string; checksum: string }[] = [];
      const ids = new Set<string>();
      const stopAt = performance.now() + 120000;
      let offset: Schemas['ExtendedPointId'] | undefined;
      let sample:
        | { id: Schemas['ExtendedPointId']; vector: EmbeddingVector; filter: Schemas['Filter'] }
        | undefined;

      do {
        if (performance.now() >= stopAt) {
          throw new StoreError('DEPENDENCY_ERROR');
        }

        const page = await this.client.scroll(manifest.physicalCollection, {
          limit: 128,
          with_payload: true,
          with_vector: true,
          ...(offset === undefined ? {} : { offset }),
        });

        for (const point of page.points) {
          const chunk = checkPoint(point, manifest);

          if (ids.has(chunk.chunkId) || chunks.length >= manifest.expectedPointCount) {
            throw new StoreError('INVALID_CONTENT');
          }

          ids.add(chunk.chunkId);
          chunks.push(chunk);

          if (sample === undefined) {
            const payload = parseKnowledgePayload(point.payload);
            const vector = validateEmbeddingBatch([point.vector], 1, manifest.retrievalProfile)[0];

            if (!vector) {
              throw new StoreError('INVALID_CONTENT');
            }

            sample = {
              id: point.id,
              vector,
              filter: knowledgeFilter(
                {
                  published: true,
                  corpusVersion: manifest.corpusVersion,
                  targetLevel: payload.jlpt_level,
                  skillCodes: payload.skill_codes,
                },
                manifest,
              ),
            };
          }
        }

        const next: unknown = page.next_page_offset;

        if (next != null && typeof next !== 'string' && typeof next !== 'number') {
          throw new StoreError('INVALID_CONTENT');
        }

        offset = next ?? undefined;
      } while (offset !== undefined);

      const digest = contentDigest(chunks);

      if (chunks.length !== manifest.expectedPointCount || digest !== manifest.contentDigest) {
        throw new StoreError('INVALID_CONTENT');
      }

      // Offline candidate smoke only; this does not implement runtime retrieval/routing policy.
      if (sample) {
        const sparse = sample.vector.sparse;
        const baseFilter: Schemas['Filter'] = { must: [sample.filter, { has_id: [sample.id] }] };

        for (const shouldMatch of [true, false]) {
          if (performance.now() >= stopAt) {
            throw new StoreError('DEPENDENCY_ERROR');
          }

          const filter: Schemas['Filter'] = shouldMatch
            ? baseFilter
            : {
                must: [
                  baseFilter,
                  { key: 'corpus_version', match: { value: `${manifest.corpusVersion}_excluded` } },
                ],
              };
          let query: Schemas['QueryRequest'];

          if (manifest.retrievalProfile === 'HYBRID') {
            if (sparse === undefined) {
              throw new StoreError('INVALID_CONTENT');
            }

            query = {
              prefetch: [
                { query: [...sample.vector.dense], using: 'dense', filter, limit: 1 },
                {
                  query: { indices: [...sparse.indices], values: [...sparse.values] },
                  using: 'sparse',
                  filter,
                  limit: 1,
                },
              ],
              query: { fusion: 'rrf' },
              filter,
              limit: 1,
            };
          } else {
            query = { query: [...sample.vector.dense], using: 'dense', filter, limit: 1 };
          }

          const result = await this.client.query(manifest.physicalCollection, query);

          if (
            shouldMatch
              ? result.points.length !== 1 || result.points[0]?.id !== sample.id
              : result.points.length !== 0
          ) {
            throw new StoreError('INVALID_CONTENT');
          }
        }
      }

      return Object.freeze({
        physicalCollection: manifest.physicalCollection,
        indexRevision: manifest.indexRevision,
        fingerprint: manifestFingerprint(manifest),
        pointCount: chunks.length,
        contentDigest: digest,
        retrievalProfile: manifest.retrievalProfile,
        modelRevisionsRecorded:
          manifest.embeddingModelRevision !== null &&
          manifest.tokenizerRevision !== null &&
          manifest.processingRevision !== null,
        searchSmokePassed: sample !== undefined,
      });
    });
  }

  async assertWritable(value: IndexManifest): Promise<void> {
    const manifest = parseIndexManifest(value);

    return this.guarded(async () => {
      await this.assertVersion();
      await this.inspect(manifest);

      if (
        (await this.client.getCollectionAliases(manifest.physicalCollection)).aliases.length !== 0
      ) {
        throw new StoreError('UNSAFE_LIFECYCLE');
      }
    });
  }

  async upsert(value: IndexManifest, points: readonly IndexPoint[]): Promise<void> {
    const manifest = parseIndexManifest(value);

    if (
      !points.length ||
      points.length > 32 ||
      new Set(points.map((point) => point.id)).size !== points.length
    ) {
      throw new StoreError('INVALID_CONTENT');
    }

    const rows = points.map((point) => {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(point.id)) {
        throw new StoreError('INVALID_CONTENT');
      }

      const row = {
        id: point.id,
        payload: { ...point.payload },
        vector: {
          dense: [...point.vector.dense],
          ...(point.vector.sparse === undefined
            ? {}
            : {
                sparse: {
                  indices: [...point.vector.sparse.indices],
                  values: [...point.vector.sparse.values],
                },
              }),
        },
      };

      checkPoint(row, manifest);

      return row;
    });

    return this.guarded(async () => {
      await this.assertVersion();
      await this.inspect(manifest);

      if (
        (await this.client.getCollectionAliases(manifest.physicalCollection)).aliases.length !== 0
      ) {
        throw new StoreError('UNSAFE_LIFECYCLE');
      }

      const result = await this.client.upsert(manifest.physicalCollection, {
        points: rows,
        wait: true,
      });

      if (result.status !== 'completed') {
        throw new StoreError('DEPENDENCY_ERROR');
      }
    });
  }

  async promote(value: IndexManifest, alias: string): Promise<IndexValidation> {
    const manifest = parseIndexManifest(value);

    if (
      !/^kotoba_active_[a-z0-9_]{1,50}$/.test(alias) ||
      manifest.expectedPointCount === 0 ||
      manifest.embeddingModelRevision === null ||
      manifest.tokenizerRevision === null ||
      manifest.processingRevision === null
    ) {
      throw new StoreError('UNSAFE_LIFECYCLE');
    }

    const validation = await this.validate(manifest);

    return this.guarded(async () => {
      const aliases = await this.client.getAliases();
      const previous = aliases.aliases.find((item) => item.alias_name === alias);

      if (previous) {
        const info = await this.client.getCollection(previous.collection_name);

        if (info.config.metadata?.schema_version !== INDEX_SCHEMA_VERSION) {
          throw new StoreError('UNSAFE_LIFECYCLE');
        }
      }

      await this.client.updateCollectionAliases({
        actions: [
          ...(previous ? [{ delete_alias: { alias_name: alias } }] : []),
          { create_alias: { alias_name: alias, collection_name: manifest.physicalCollection } },
        ],
      });

      return validation;
    });
  }

  async remove(value: IndexManifest): Promise<void> {
    const manifest = parseIndexManifest(value);

    return this.guarded(async () => {
      await this.assertVersion();
      await this.inspect(manifest);

      if (
        (await this.client.getCollectionAliases(manifest.physicalCollection)).aliases.length !== 0
      ) {
        throw new StoreError('UNSAFE_LIFECYCLE');
      }

      await this.client.deleteCollection(manifest.physicalCollection);
    });
  }
}
