export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

export type Locale = 'EN' | 'ID';

export class IngestionError extends Error {
  readonly code:
    | 'INVALID_SOURCE'
    | 'INTEGRITY_ERROR'
    | 'INVALID_CONFIG'
    | 'INVALID_TOKENIZER'
    | 'EMPTY_CONTENT'
    | 'ATOMIC_UNIT_TOO_LARGE'
    | 'OUTPUT_EXISTS';

  constructor(code: IngestionError['code']) {
    super(`Corpus preparation failed: ${code}`);
    this.name = 'IngestionError';
    this.code = code;
  }
}

export interface SourceDocument {
  readonly source_id: string;

  readonly parent_id: string;

  readonly source_table: 'skills' | 'lesson_content_blocks';

  readonly source_row_id: string;

  readonly source_uri: string;

  readonly track_id: string;

  readonly track_slug: string;

  readonly unit_id: string;

  readonly unit_slug: string;

  readonly lesson_id: string;

  readonly lesson_slug: string;

  readonly skill_codes: readonly string[];

  readonly jlpt_level: 'N5' | 'N4';

  readonly locale: Locale;

  readonly content_type:
    'GRAMMAR' | 'VOCABULARY' | 'READING' | 'PARAGRAPH' | 'EXAMPLE_SENTENCE' | 'GRAMMAR_STRUCTURE';

  readonly published: true;

  readonly sort_order?: number;

  readonly content_revision: number;

  readonly source_revision: number;

  readonly translation_revision: number;

  readonly source_updated_at: string;

  readonly translation_updated_at: string;

  readonly source_refs: readonly JsonObject[];

  readonly content: JsonObject;

  readonly content_checksum: string;

  readonly removed_paths: readonly string[];

  readonly license: string | null;

  readonly researcher_review: string;

  readonly ingestion_eligible: boolean;

  readonly hold_reasons: readonly string[];
}

export interface ApprovedSource extends SourceDocument {
  readonly license: string;

  readonly researcher_review: 'approved';

  readonly ingestion_eligible: true;
}

export interface ApprovedCorpus {
  readonly corpusVersion: string;

  readonly manifestSha256: string;

  readonly usagePolicySha256: string;

  readonly sources: readonly ApprovedSource[];
}

export interface ChunkConfig {
  readonly version: 'pedagogical-v1';

  readonly unicode: 'NONE' | 'NFC';

  readonly maxTokens: number;

  readonly overlapTokens: number;

  readonly overlapUnits: number;
}

export interface TokenIdentity {
  readonly id: string;

  readonly model: string;

  readonly revision: string;

  readonly engine: string;
}

export interface TokenCounter {
  readonly identity: TokenIdentity;

  count(
    text: string,
  ): Promise<{ readonly content: number; readonly special: number; readonly total: number }>;
}

export interface SourceSpan {
  readonly sourceId: string;

  readonly jsonPath: string;

  readonly rawStart: number;

  readonly rawEnd: number;

  readonly rawChecksum: string;

  readonly start: number;

  readonly end: number;
}

export interface PedagogicalUnit {
  readonly id: string;

  readonly kind: 'narrative' | 'grammar' | 'example' | 'lexical' | 'reading';

  readonly start: number;

  readonly end: number;

  readonly sourceIds: readonly string[];

  readonly skillCodes: readonly string[];

  readonly spans: readonly SourceSpan[];
}

export interface NormalizedLesson {
  readonly id: string;

  readonly parentId: string;

  readonly corpusVersion: string;

  readonly locale: Locale;

  readonly jlptLevel: 'JLPT_N5' | 'JLPT_N4';

  readonly trackSlug: string;

  readonly unitSlug: string;

  readonly lessonSlug: string;

  readonly normalizationVersion: string;

  readonly text: string;

  readonly checksum: string;

  readonly units: readonly PedagogicalUnit[];
}

export interface PreparedChunk {
  readonly chunkId: string;

  readonly sourceId: string;

  readonly parentId: string;

  readonly corpusVersion: string;

  readonly locale: Locale;

  readonly jlptLevel: 'JLPT_N5' | 'JLPT_N4';

  readonly trackSlug: string;

  readonly unitSlug: string;

  readonly lessonSlug: string;

  readonly skillCodes: readonly string[];

  readonly sourceIds: readonly string[];

  readonly unitIds: readonly string[];

  readonly overlapUnitIds: readonly string[];

  readonly start: number;

  readonly end: number;

  readonly offsetUnit: 'UTF16_CODE_UNITS';

  readonly chunkIndex: number;

  readonly text: string;

  readonly contentChecksum: string;

  readonly tokenCount: number;

  readonly contentTokenCount: number;

  readonly specialTokenCount: number;

  readonly tokenizerId: string;

  readonly chunkingVersion: string;

  readonly normalizationVersion: string;

  readonly spans: readonly SourceSpan[];
}
