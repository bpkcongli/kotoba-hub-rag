import { Ajv } from 'ajv';
import { default as formats } from 'ajv-formats';

import { StoreError } from '@/modules/knowledge/application/index-manifest';
import { canonicalRubricContent } from '@/modules/knowledge/application/rubric-canonical';
import { hash, object, rubricBindingSchema } from '@/modules/knowledge/application/validation';
import type { RubricBinding } from '@/modules/knowledge/domain/models/ingestion';

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

  readonly rubric?: RubricBinding;

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
  rubric: rubricBindingSchema,
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
  required: Object.keys(properties).filter((key) => key !== 'rubric'),
  properties,
});

function validateRubricPayload(value: KnowledgePayload, binding: RubricBinding): void {
  const content = object(JSON.parse(value.text));
  const scope = object(content.scope);
  const policy = object(content.policyRef);

  if (
    canonicalRubricContent(content) !== value.text ||
    hash(value.text) !== value.content_checksum ||
    value.content_checksum !== binding.guidanceContentSha256
  ) {
    throw new StoreError('INVALID_CONTENT');
  }

  const sourceId = `kotobahub:rubric_guidance:${binding.guidanceId}@${binding.guidanceRevision}:${value.locale.toLowerCase()}`;

  if (value.source_id !== sourceId) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (
    policy.id !== binding.policyId ||
    policy.revision !== binding.policyRevision ||
    policy.contentSha256 !== binding.policyContentSha256
  ) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (
    scope.questionType !== 'FREE_RESPONSE' ||
    `JLPT_${String(scope.jlptLevel)}` !== value.jlpt_level
  ) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (
    scope.trackSlug !== value.track_slug ||
    scope.unitSlug !== value.unit_slug ||
    scope.lessonSlug !== value.lesson_slug
  ) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (value.skill_codes.length !== 1 || scope.skillCode !== value.skill_codes[0]) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (content.locale !== value.locale.toLowerCase()) {
    throw new StoreError('INVALID_CONTENT');
  }
}

export function parseKnowledgePayload(value: unknown): KnowledgePayload {
  if (!validate(value)) {
    throw new StoreError('INVALID_CONTENT');
  }

  if ((value.content_type === 'RUBRIC') !== (value.rubric !== undefined)) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (value.rubric) {
    try {
      validateRubricPayload(value, value.rubric);
    } catch {
      throw new StoreError('INVALID_CONTENT');
    }
  }

  return value;
}
