import { chunkLessons } from '@/modules/knowledge/application/services/chunker';
import { canonical, hash } from '@/modules/knowledge/application/validation';
import { IngestionError } from '@/modules/knowledge/domain/models/ingestion';
import type {
  ApprovedCorpus,
  ChunkConfig,
  TokenCounter,
  NormalizedLesson,
} from '@/modules/knowledge/domain/models/ingestion';

export interface NormalizationPort {
  (corpus: ApprovedCorpus, config: ChunkConfig): readonly NormalizedLesson[];
}

export async function prepareFromInputs(
  corpus: ApprovedCorpus,
  config: ChunkConfig,
  counter: TokenCounter,
  tokenizerFiles: Readonly<Record<string, string>>,
  normalize: NormalizationPort,
) {
  const lessons = normalize(corpus, config);
  const chunks = await chunkLessons(lessons, config, counter);

  const covered = new Set(chunks.flatMap((chunk) => chunk.sourceIds));

  if (
    chunks.length === 0 ||
    new Set(chunks.map((chunk) => chunk.chunkId)).size !== chunks.length ||
    corpus.sources.some((source) => !covered.has(source.source_id))
  ) {
    throw new IngestionError('INTEGRITY_ERROR');
  }

  const jsonl = (rows: readonly unknown[]): string =>
    rows.map((row) => canonical(row)).join('\n') + '\n';

  const files = {
    'normalized-lessons.jsonl': jsonl(lessons),
    'chunks.jsonl': jsonl(chunks),
    'source-map.jsonl': jsonl(
      [...corpus.sources]
        .sort((a, b) => (a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0))
        .map((source) => ({
          sourceId: source.source_id,
          parentId: source.parent_id,
          sourceUri: source.source_uri,
          originalContentChecksum: source.content_checksum,
          license: source.license,
          sourceRefs: source.source_refs,
          publicRedistributionAuthorized: false,
        })),
    ),
  };

  const tokenCounts = chunks.map((chunk) => chunk.tokenCount);
  const manifest = {
    schemaVersion: 'data-02-preparation-v1',
    status: 'PREPARED_OFFLINE_PILOT_CONFIG',
    corpusVersion: corpus.corpusVersion,
    corpusManifestSha256: corpus.manifestSha256,
    usagePolicySha256: corpus.usagePolicySha256,
    usageScope: 'internal_research',
    publicRedistributionAuthorized: false,
    config,
    configSha256: hash(canonical(config)),
    chunkingVersion: chunks[0]?.chunkingVersion,
    normalizationVersion: lessons[0]?.normalizationVersion,
    tokenizer: {
      ...counter.identity,
      files: tokenizerFiles,
      addSpecialTokens: true,
      truncation: false,
      padding: false,
      providerServedTokenizerRevision: null,
      purpose: 'local_chunk_budget_not_provider_billing',
    },
    counts: {
      sourceDocuments: corpus.sources.length,
      normalizedLessons: lessons.length,
      pedagogicalUnits: lessons.reduce((sum, lesson) => sum + lesson.units.length, 0),
      chunks: chunks.length,
      byLocale: Object.fromEntries(
        ['EN', 'ID'].map((locale) => [
          locale,
          chunks.filter((chunk) => chunk.locale === locale).length,
        ]),
      ),
      byLevel: Object.fromEntries(
        ['JLPT_N5', 'JLPT_N4'].map((level) => [
          level,
          chunks.filter((chunk) => chunk.jlptLevel === level).length,
        ]),
      ),
      minTokens: Math.min(...tokenCounts),
      maxTokens: Math.max(...tokenCounts),
      totalStoredTokensIncludingOverlapAndSpecial: tokenCounts.reduce(
        (sum, count) => sum + count,
        0,
      ),
      overlapUnitOccurrences: chunks.reduce((sum, chunk) => sum + chunk.overlapUnitIds.length, 0),
    },
    offsetUnit: 'UTF16_CODE_UNITS',
    rawSpanPolicy:
      'whole_original_JSON_string_field; normalized start/end refer to parent text, not raw HTML character alignment',
    pilotTuned: false,
    experimentFrozen: false,
    embeddingCalls: 0,
    qdrantWrites: 0,
    billableProviderUsage: null,
    files: Object.fromEntries(
      Object.entries(files).map(([name, body]) => [
        name,
        { sha256: hash(body), bytes: Buffer.byteLength(body) },
      ]),
    ),
  };

  return { manifest, files, chunks, corpus };
}
