import type { IndexManifest } from '@/modules/knowledge/application/index-manifest';
import {
  INDEX_SCHEMA_VERSION,
  manifestFingerprint,
  parseIndexManifest,
  PAYLOAD_INDEXES,
} from '@/modules/knowledge/application/index-manifest';
import { StoreError } from '@/modules/knowledge/application/index-manifest';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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
