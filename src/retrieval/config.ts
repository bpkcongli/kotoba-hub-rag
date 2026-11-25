import { readFile, stat } from 'node:fs/promises';
import { ConfigError } from '@/shared/config';
import { parseIndexManifest } from '@/storage/index-manifest';
import type { IndexManifest } from '@/storage/index-manifest';

export interface RetrievalConfig {
  readonly index: IndexManifest;
  readonly candidateLimit: number;
  readonly limit: number;
  readonly maxConcurrency: number;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export function retrievalConfig(
  index: unknown,
  values: Readonly<Record<string, unknown>> = {},
): RetrievalConfig {
  const invalid: string[] = [];
  const integer = (key: string, fallback: number, max: number): number => {
    const raw = values[key] ?? String(fallback);
    const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      invalid.push(key);
    }
    return value;
  };
  const candidateLimit = integer('RETRIEVAL_CANDIDATE_LIMIT', 20, 32);
  const limit = integer('RETRIEVAL_LIMIT', 5, 32);
  const maxConcurrency = integer('RETRIEVAL_MAX_CONCURRENCY', 1, 8);
  const timeoutMs = integer('RETRIEVAL_TIMEOUT_MS', 5000, 30000);
  const maxResponseBytes = integer('RETRIEVAL_MAX_RESPONSE_BYTES', 8388608, 33554432);

  if (limit > candidateLimit) {
    invalid.push('RETRIEVAL_LIMIT');
  }

  if (invalid.length) {
    throw new ConfigError(invalid);
  }

  return Object.freeze({
    index: parseIndexManifest(index),
    candidateLimit,
    limit,
    maxConcurrency,
    timeoutMs,
    maxResponseBytes,
  });
}

export async function readRetrievalConfig(
  env: Readonly<Record<string, unknown>>,
): Promise<RetrievalConfig | null> {
  if (env.RETRIEVAL_ENABLED === undefined || env.RETRIEVAL_ENABLED === 'false') {
    return null;
  }

  if (
    env.RETRIEVAL_ENABLED !== 'true' ||
    typeof env.RETRIEVAL_INDEX_MANIFEST !== 'string' ||
    !env.RETRIEVAL_INDEX_MANIFEST.trim()
  ) {
    throw new ConfigError(['RETRIEVAL_ENABLED', 'RETRIEVAL_INDEX_MANIFEST']);
  }

  try {
    if ((await stat(env.RETRIEVAL_INDEX_MANIFEST)).size > 16384) {
      throw new Error();
    }

    const body = await readFile(env.RETRIEVAL_INDEX_MANIFEST, 'utf8');
    if (Buffer.byteLength(body) > 16384) {
      throw new Error();
    }

    return retrievalConfig(JSON.parse(body), env);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }

    throw new ConfigError(['RETRIEVAL_INDEX_MANIFEST']);
  }
}
