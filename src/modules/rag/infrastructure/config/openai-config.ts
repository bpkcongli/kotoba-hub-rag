import { OPENAI_MODELS } from '@/modules/rag/application/models/generation-models';
import { ConfigError } from '@/shared/errors/config-error';

export interface OpenAiConfig {
  readonly apiKey: string;

  readonly generationModel: typeof OPENAI_MODELS.generation;

  readonly normalizationModel: typeof OPENAI_MODELS.normalization;

  readonly timeoutMs: number;

  readonly maxOutputTokens: number;

  readonly maxInputChars: number;

  readonly maxResponseBytes: number;

  readonly maxConcurrency: number;
}

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';

export function readOpenAiConfig(env: Readonly<Record<string, unknown>>): OpenAiConfig | null {
  if (env.OPENAI_ENABLED === undefined || env.OPENAI_ENABLED === 'false') {
    return null;
  }

  const invalid: string[] = [];
  if (env.OPENAI_ENABLED !== 'true') {
    invalid.push('OPENAI_ENABLED');
  }

  const apiKey = env.OPENAI_API_KEY;
  if (typeof apiKey !== 'string' || !apiKey.trim() || /\s/.test(apiKey)) {
    invalid.push('OPENAI_API_KEY');
  }

  for (const [key, expected] of [
    ['OPENAI_GENERATION_MODEL', OPENAI_MODELS.generation],
    ['OPENAI_NORMALIZATION_MODEL', OPENAI_MODELS.normalization],
  ] as const) {
    if (env[key] !== undefined && env[key] !== expected) {
      invalid.push(key);
    }
  }

  const integer = (key: string, fallback: number, max: number): number => {
    const value = env[key] ?? String(fallback);
    const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;

    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
      invalid.push(key);
    }

    return parsed;
  };

  const timeoutMs = integer('OPENAI_TIMEOUT_MS', 30000, 120000);
  const maxOutputTokens = integer('OPENAI_MAX_OUTPUT_TOKENS', 4096, 32768);
  const maxInputChars = integer('OPENAI_MAX_INPUT_CHARS', 100000, 500000);
  const maxResponseBytes = integer('OPENAI_MAX_RESPONSE_BYTES', 2097152, 8388608);
  const maxConcurrency = integer('OPENAI_MAX_CONCURRENCY', 1, 16);

  if (invalid.length || typeof apiKey !== 'string') {
    throw new ConfigError(invalid);
  }

  return Object.freeze({
    apiKey,
    generationModel: OPENAI_MODELS.generation,
    normalizationModel: OPENAI_MODELS.normalization,
    timeoutMs,
    maxOutputTokens,
    maxInputChars,
    maxResponseBytes,
    maxConcurrency,
  });
}
