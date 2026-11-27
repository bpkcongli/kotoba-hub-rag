import type { GenerationSettings } from '@/modules/rag/application/models/generator-config';
import type { ContextConfig } from '@/modules/rag/domain/models/context';
import { ConfigError } from '@/shared/errors/config-error';

export function readContextConfig(
  env: Readonly<Record<string, unknown>>,
  generator: GenerationSettings,
): ContextConfig {
  const invalid: string[] = [];
  const integer = (key: string, fallback: number, max: number): number => {
    const value = env[key] ?? String(fallback);
    const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;

    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
      invalid.push(key);
    }

    return parsed;
  };

  const contextWindowTokens = integer('CONTEXT_WINDOW_TOKENS', 32768, 1048576);
  const evidenceCapTokens = integer('CONTEXT_EVIDENCE_CAP_TOKENS', 8192, 1048576);
  const safetyMarginTokens = integer('CONTEXT_SAFETY_MARGIN_TOKENS', 1024, 1048576);

  if (
    evidenceCapTokens > contextWindowTokens ||
    generator.maxOutputTokens + safetyMarginTokens >= contextWindowTokens
  ) {
    invalid.push('CONTEXT_WINDOW_TOKENS');
  }

  if (invalid.length) {
    throw new ConfigError(invalid);
  }

  return Object.freeze({
    version: 'rag-02-v1',
    counter: 'utf8-bytes-v1',
    contextWindowTokens,
    evidenceCapTokens,
    safetyMarginTokens,
    outputReserveTokens: generator.maxOutputTokens,
    maxInputChars: generator.maxInputChars,
  });
}
