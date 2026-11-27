export class ConfigError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(`Konfigurasi tidak valid: ${fields.join(', ')}`);
    this.name = 'ConfigError';
    this.fields = fields;
  }
}
