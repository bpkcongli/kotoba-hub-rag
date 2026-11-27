import { ConfigError } from '@/shared/errors/config-error';

export interface QdrantConfig {
  readonly url: string;

  readonly apiKey?: string;

  readonly timeoutMs: number;
}

export function readQdrantConfig(env: Readonly<Record<string, unknown>>): QdrantConfig | null {
  if (env.QDRANT_ENABLED === undefined || env.QDRANT_ENABLED === 'false') {
    return null;
  }

  const fields: string[] = [];
  const raw = env.QDRANT_URL ?? 'http://127.0.0.1:6333';
  let url: URL | undefined;

  if (env.QDRANT_ENABLED !== 'true') {
    fields.push('QDRANT_ENABLED');
  }

  try {
    if (typeof raw !== 'string') {
      throw new Error();
    }

    url = new URL(raw);

    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]', 'qdrant'].includes(url.hostname)
        ))
    ) {
      fields.push('QDRANT_URL');
    }
  } catch {
    fields.push('QDRANT_URL');
  }

  const apiKey = env.QDRANT_API_KEY;
  const timeout = env.QDRANT_TIMEOUT_MS ?? '5000';
  const timeoutMs = typeof timeout === 'string' && /^\d+$/.test(timeout) ? Number(timeout) : NaN;

  if (apiKey !== undefined && (typeof apiKey !== 'string' || !apiKey || /\s/.test(apiKey))) {
    fields.push('QDRANT_API_KEY');
  }

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    fields.push('QDRANT_TIMEOUT_MS');
  }

  if (fields.length || !url || (apiKey !== undefined && typeof apiKey !== 'string')) {
    throw new ConfigError(fields);
  }

  return Object.freeze({ url: url.origin, timeoutMs, ...(apiKey === undefined ? {} : { apiKey }) });
}
