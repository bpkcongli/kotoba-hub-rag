export interface AppConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly shutdownTimeoutMs: number;
  readonly observationDirectory: string;
}

export class ConfigError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(`Konfigurasi tidak valid: ${fields.join(', ')}`);
    this.name = 'ConfigError';
    this.fields = fields;
  }
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

  if (
    typeof observationDirectory !== 'string' ||
    observationDirectory.length === 0 ||
    observationDirectory.length > 4096 ||
    [...observationDirectory].some((character) => character.charCodeAt(0) < 32)
  ) {
    invalid.push('OBSERVATION_DIRECTORY');
  }

  if (invalid.length || typeof host !== 'string' || typeof observationDirectory !== 'string') {
    throw new ConfigError(invalid);
  }

  return Object.freeze({
    environment,
    host,
    port,
    logLevel,
    shutdownTimeoutMs,
    observationDirectory,
  });
}
