import { createHash } from 'node:crypto';
import { HF_IDENTITY } from '@/modules/knowledge/application/inference-identity';

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown): unknown =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export const EMBEDDING_CONFIGURATION = Object.freeze({
  identity: HF_IDENTITY,
  profile: 'DENSE',
  sparseEnabled: false,
  normalize: true,
  truncate: false,
  documentPurpose: 'document',
  queryPurpose: 'query',
  instructionPrefix: null,
  dimensions: 1024,
  inferencePrecision: null,
  usageScope: 'document_indexing_separate_from_online_requests',
} as const);

export const EMBEDDING_CONFIG_ID = `bge-m3-${hash(canonical(EMBEDDING_CONFIGURATION)).slice(0, 32)}`;
