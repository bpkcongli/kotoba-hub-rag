import { ConfigError } from '@/shared/config';

export const HF_IDENTITY = Object.freeze({
  provider: 'hf-inference',
  embeddingModel: 'BAAI/bge-m3',
  embeddingEndpoint:
    'https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction',
  rerankerModel: 'BAAI/bge-reranker-v2-m3',
  rerankerEndpoint: 'https://router.huggingface.co/hf-inference/models/BAAI/bge-reranker-v2-m3',
  configVersion: 'hf-inf-02-v1',
  // Hub commits from discovery are not attested served revisions. No revision parameter is sent.
  servedModelRevision: null,
  tokenizerRevision: null,
  processingRevision: null,
  region: null,
});

export interface HfConfig {
  readonly token: string;
  readonly profile: 'DENSE' | 'HYBRID';
  readonly embeddingBatchSize: number;
  readonly rerankerBatchSize: number;
  readonly maxConcurrency: number;
  readonly maxItems: number;
  readonly maxTextChars: number;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

// A separate optional config keeps health-only startup possible without provider credentials.
export function readHfConfig(env: Readonly<Record<string, unknown>>): HfConfig | null {
  if (env.HF_INFERENCE_ENABLED === undefined || env.HF_INFERENCE_ENABLED === 'false') {
    return null;
  }

  const invalid: string[] = [];

  if (env.HF_INFERENCE_ENABLED !== 'true') {
    invalid.push('HF_INFERENCE_ENABLED');
  }

  const token = env.HF_TOKEN;
  const profile = env.RETRIEVAL_PROFILE ?? 'DENSE';

  if (typeof token !== 'string' || token.length === 0 || /\s/.test(token)) {
    invalid.push('HF_TOKEN');
  }

  if (profile !== 'DENSE' && profile !== 'HYBRID') {
    invalid.push('RETRIEVAL_PROFILE');
  }

  // Reject misleading override settings: this adapter has one fixed provider/model/wire contract.
  for (const [key, expected] of Object.entries({
    EMBEDDING_PROVIDER: HF_IDENTITY.provider,
    EMBEDDING_MODEL: HF_IDENTITY.embeddingModel,
    EMBEDDING_ENDPOINT: HF_IDENTITY.embeddingEndpoint,
    RERANKER_PROVIDER: HF_IDENTITY.provider,
    RERANKER_MODEL: HF_IDENTITY.rerankerModel,
    RERANKER_ENDPOINT: HF_IDENTITY.rerankerEndpoint,
  })) {
    if (env[key] !== undefined && env[key] !== expected) {
      invalid.push(key);
    }
  }

  function integer(key: string, fallback: number, max: number): number {
    const value = env[key] ?? String(fallback);

    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      invalid.push(key);
      return fallback;
    }

    const number = Number(value);

    if (!Number.isSafeInteger(number) || number < 1 || number > max) {
      invalid.push(key);
    }

    return number;
  }

  const limits = {
    embeddingBatchSize: integer('HF_EMBEDDING_BATCH_SIZE', 1, 32),
    rerankerBatchSize: integer('HF_RERANKER_BATCH_SIZE', 2, 32),
    maxConcurrency: integer('HF_MAX_CONCURRENCY', 1, 8),
    maxItems: integer('HF_MAX_ITEMS', 128, 1024),
    maxTextChars: integer('HF_MAX_TEXT_CHARS', 8192, 32768),
    timeoutMs: integer('HF_TIMEOUT_MS', 15000, 120000),
    maxResponseBytes: integer('HF_MAX_RESPONSE_BYTES', 2097152, 8388608),
  };

  if (
    invalid.length ||
    typeof token !== 'string' ||
    (profile !== 'DENSE' && profile !== 'HYBRID')
  ) {
    throw new ConfigError(invalid);
  }

  return Object.freeze({ token, profile, ...limits });
}
