import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { IngestionError } from '@/ingestion/types';
import type { ChunkConfig, Json, JsonObject, SourceDocument } from '@/ingestion/types';

export const hash = (text: string | Uint8Array): string =>
  createHash('sha256').update(text).digest('hex');

export function canonical(value: unknown): string {
  return JSON.stringify(value, function (this: unknown, key: string, item: unknown): unknown {
    void key;

    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }

    return item;
  });
}

export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new IngestionError('INVALID_SOURCE');
  }

  return value as Record<string, unknown>;
}

export function string(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IngestionError('INVALID_SOURCE');
  }

  return value;
}

export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new IngestionError('INVALID_SOURCE');
  }

  return value;
}

export function rejectPrivateKeys(value: unknown): void {
  const forbidden =
    /^(expected_?answer.*|accepted_?text_?answers|answer_?key|reference_?answer|comprehension_?checks|expected_?route|complexity|ground_?truth|evaluation_?rubric|user_?id|learner_?id|email|password|database_?url)$/i;

  const visit = (item: unknown, depth: number): void => {
    if (depth > 32) {
      throw new IngestionError('INVALID_SOURCE');
    }

    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child, depth + 1);
      }
    } else if (item !== null && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (forbidden.test(key)) {
          throw new IngestionError('INVALID_SOURCE');
        }

        visit(child, depth + 1);
      }
    }
  };

  visit(value, 0);
}

const text = { type: 'string', minLength: 1, maxLength: 4096 };
const revision = { type: 'integer', minimum: 1 };
const properties = {
  source_id: text,
  parent_id: text,
  source_table: { enum: ['skills', 'lesson_content_blocks'] },
  source_row_id: text,
  source_uri: text,
  track_id: text,
  track_slug: text,
  unit_id: text,
  unit_slug: text,
  lesson_id: text,
  lesson_slug: text,
  skill_codes: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: text },
  jlpt_level: { enum: ['N5', 'N4'] },
  locale: { enum: ['EN', 'ID'] },
  content_type: {
    enum: [
      'GRAMMAR',
      'VOCABULARY',
      'READING',
      'PARAGRAPH',
      'EXAMPLE_SENTENCE',
      'GRAMMAR_STRUCTURE',
    ],
  },
  published: { const: true },
  sort_order: { type: 'integer', minimum: 1 },
  content_revision: revision,
  source_revision: revision,
  translation_revision: revision,
  source_updated_at: text,
  translation_updated_at: text,
  source_refs: { type: 'array', minItems: 1, items: { type: 'object' } },
  content: { type: 'object', minProperties: 1 },
  content_checksum: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  removed_paths: { type: 'array', items: text },
  license: { anyOf: [text, { type: 'null' }] },
  researcher_review: text,
  ingestion_eligible: { type: 'boolean' },
  hold_reasons: { type: 'array', items: text },
};

const ajv = new Ajv({
  strict: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
const validateSource = ajv.compile<SourceDocument>({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties).filter((key) => key !== 'sort_order'),
});

const validateConfig = ajv.compile<ChunkConfig>({
  type: 'object',
  additionalProperties: false,
  required: ['version', 'unicode', 'maxTokens', 'overlapTokens', 'overlapUnits'],
  properties: {
    version: { const: 'pedagogical-v1' },
    unicode: { enum: ['NONE', 'NFC'] },
    maxTokens: { type: 'integer', minimum: 16, maximum: 8192 },
    overlapTokens: { type: 'integer', minimum: 0, maximum: 8191 },
    overlapUnits: { type: 'integer', minimum: 0, maximum: 32 },
  },
});

export function parseSource(value: unknown): SourceDocument {
  if (!validateSource(value)) {
    throw new IngestionError('INVALID_SOURCE');
  }

  rejectPrivateKeys(value.content);
  rejectPrivateKeys(value.source_refs);

  const isSkillType = ['GRAMMAR', 'VOCABULARY', 'READING'].includes(value.content_type);

  if (
    (value.source_table === 'skills') !== isSkillType ||
    value.source_revision !== value.content_revision ||
    hash(canonical(value.content)) !== value.content_checksum ||
    value.source_id !==
      `kotobahub:${value.source_table}:${value.source_row_id}:${value.locale.toLowerCase()}` ||
    value.parent_id !== `kotobahub:lessons:${value.lesson_id}` ||
    (value.source_table === 'lesson_content_blocks' && value.sort_order === undefined)
  ) {
    throw new IngestionError('INTEGRITY_ERROR');
  }

  return value;
}

export function parseChunkConfig(value: unknown): ChunkConfig {
  if (!validateConfig(value) || value.overlapTokens >= value.maxTokens) {
    throw new IngestionError('INVALID_CONFIG');
  }

  return Object.freeze({ ...value });
}

export function jsonObject(value: Json | undefined): JsonObject {
  return object(value) as JsonObject;
}
