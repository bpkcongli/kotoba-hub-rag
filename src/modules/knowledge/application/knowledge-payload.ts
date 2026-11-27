import { Ajv } from 'ajv';
import { default as formats } from 'ajv-formats';
import { StoreError } from '@/modules/knowledge/application/index-manifest';

export interface KnowledgePayload {
  readonly chunk_id: string;

  readonly parent_id: string;

  readonly corpus_version: string;

  readonly source_id: string;

  readonly source_url: string;

  readonly license: string;

  readonly content_checksum: string;

  readonly track_slug: string | null;

  readonly unit_slug: string | null;

  readonly lesson_slug: string | null;

  readonly skill_codes: readonly string[];

  readonly jlpt_level: 'JLPT_N5' | 'JLPT_N4';

  readonly locale: 'JA' | 'EN' | 'ID';

  readonly content_type: string;

  readonly published: true;

  readonly chunk_index: number;

  readonly token_count: number;

  readonly embedding_revision: string | null;

  readonly embedding_config_id: string;

  readonly chunking_version: string;

  readonly text: string;
}

const ajv = new Ajv({
  strict: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
formats.default(ajv);

const text = { type: 'string', minLength: 1, maxLength: 2048, pattern: '\\S' };
const nullable = { anyOf: [text, { type: 'null' }] };
const properties = {
  chunk_id: text,
  parent_id: text,
  corpus_version: text,
  source_id: text,
  source_url: { ...text, format: 'uri' },
  license: text,
  content_checksum: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  track_slug: nullable,
  unit_slug: nullable,
  lesson_slug: nullable,
  skill_codes: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: text },
  jlpt_level: { enum: ['JLPT_N5', 'JLPT_N4'] },
  locale: { enum: ['JA', 'EN', 'ID'] },
  content_type: text,
  published: { const: true },
  chunk_index: { type: 'integer', minimum: 0 },
  token_count: { type: 'integer', minimum: 1 },
  embedding_revision: nullable,
  embedding_config_id: text,
  chunking_version: text,
  text: { type: 'string', minLength: 1, maxLength: 1048576, pattern: '\\S' },
};
const validate = ajv.compile<KnowledgePayload>({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

export function parseKnowledgePayload(value: unknown): KnowledgePayload {
  if (!validate(value)) {
    throw new StoreError('INVALID_CONTENT');
  }

  return value;
}
