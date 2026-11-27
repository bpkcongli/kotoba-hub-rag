import { ConfigError } from '@/shared/errors/config-error';
import type { Mode } from '@/shared/operations';

export interface ApiConfig {
  readonly serviceId: string;

  readonly token: string | null;

  readonly corpusVersion: string | null;

  readonly allowedModes: readonly Mode[];

  readonly maxConcurrent: number;

  readonly maxDeadlineMs: number;
}

export interface AppConfig {
  readonly api: ApiConfig;

  readonly environment: 'development' | 'test' | 'production';

  readonly host: string;

  readonly port: number;

  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

  readonly shutdownTimeoutMs: number;

  readonly observationDirectory: string;
}

// Environment values may contain secrets; omit them from errors and logs.
export function readConfig(env: Readonly<Record<string, unknown>>): AppConfig {
  const invalid: string[] = [];

  function choice<T extends string>(key: string, values: readonly T[], fallback: T): T {
    const value = env[key] ?? fallback;
    const match = values.find((candidate) => candidate === value);

    if (match === undefined) {
      invalid.push(key);
    }

    return match ?? fallback;
  }

  function integer(key: string, fallback: number, min: number, max: number): number {
    const value = env[key] ?? String(fallback);

    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      invalid.push(key);
      return fallback;
    }

    const parsed = Number(value);

    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      invalid.push(key);
    }

    return parsed;
  }

  const environment = choice('NODE_ENV', ['development', 'test', 'production'], 'development');
  const logLevel = choice(
    'LOG_LEVEL',
    ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
    'info',
  );

  const host = env.HOST ?? '127.0.0.1';

  // Accept bind addresses only, without URLs, paths, or whitespace.
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.:[\]-]+$/.test(host)) {
    invalid.push('HOST');
  }

  const port = integer('PORT', 3000, 1, 65535);
  const shutdownTimeoutMs = integer('SHUTDOWN_TIMEOUT_MS', 10000, 100, 30000);
  const observationDirectory = env.OBSERVATION_DIRECTORY ?? 'artifacts/observability/service';
  const serviceId = env.API_SERVICE_ID ?? 'kotobahub';
  const token = env.API_SERVICE_TOKEN === '' ? null : (env.API_SERVICE_TOKEN ?? null);
  const corpusVersion = env.API_CORPUS_VERSION === '' ? null : (env.API_CORPUS_VERSION ?? null);
  const rawModes = env.API_ALLOWED_MODES ?? 'LLM_ONLY,SINGLE_STAGE,ADAPTIVE';
  const modes: readonly Mode[] = ['LLM_ONLY', 'SINGLE_STAGE', 'ADAPTIVE'];
  const allowedModes =
    typeof rawModes === 'string' ? modes.filter((mode) => rawModes.split(',').includes(mode)) : [];
  const maxConcurrent = integer('API_MAX_CONCURRENT', 4, 1, 64);
  const maxDeadlineMs = integer('API_MAX_DEADLINE_MS', 120000, 100, 120000);

  if (typeof serviceId !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(serviceId)) {
    invalid.push('API_SERVICE_ID');
  }

  if (token !== null && (typeof token !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(token))) {
    invalid.push('API_SERVICE_TOKEN');
  }

  if (
    corpusVersion !== null &&
    (typeof corpusVersion !== 'string' || !/^[a-zA-Z0-9._-]{1,200}$/.test(corpusVersion))
  ) {
    invalid.push('API_CORPUS_VERSION');
  }

  if (
    typeof rawModes !== 'string' ||
    rawModes.split(',').length !== allowedModes.length ||
    allowedModes.length === 0
  ) {
    invalid.push('API_ALLOWED_MODES');
  }

  if (
    typeof observationDirectory !== 'string' ||
    observationDirectory.length === 0 ||
    observationDirectory.length > 4096 ||
    [...observationDirectory].some((character) => character.charCodeAt(0) < 32)
  ) {
    invalid.push('OBSERVATION_DIRECTORY');
  }

  if (
    invalid.length ||
    typeof host !== 'string' ||
    typeof observationDirectory !== 'string' ||
    typeof serviceId !== 'string' ||
    (token !== null && typeof token !== 'string') ||
    (corpusVersion !== null && typeof corpusVersion !== 'string')
  ) {
    throw new ConfigError(invalid);
  }

  return Object.freeze({
    api: Object.freeze({
      serviceId,
      token,
      corpusVersion,
      allowedModes: Object.freeze(allowedModes),
      maxConcurrent,
      maxDeadlineMs,
    }),
    environment,
    host,
    port,
    logLevel,
    shutdownTimeoutMs,
    observationDirectory,
  });
}
