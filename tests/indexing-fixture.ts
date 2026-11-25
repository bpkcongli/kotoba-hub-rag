import { createIngestionPlan } from '@/ingestion/index-plan';
import type { IngestionPlan } from '@/ingestion/index-plan';
import type { ApprovedSource, PreparedChunk } from '@/ingestion/types';
import { hash } from '@/ingestion/validation';
import type { IndexManifest } from '@/storage/index-manifest';
import type { IndexPoint, IndexValidation } from '@/storage/qdrant-index';

export function fixturePlan(count = 3): IngestionPlan {
  const sources: ApprovedSource[] = [];
  const chunks: PreparedChunk[] = [];

  for (let index = 0; index < count; index++) {
    const text = `七時に起きます。 ${index}`;
    const sourceId = `kotobahub:skills:s${index}:en`;
    const parentId = 'kotobahub:lessons:l';

    sources.push({
      source_id: sourceId,
      parent_id: parentId,
      source_table: 'skills',
      source_row_id: `s${index}`,
      source_uri: `urn:source:${index}`,
      track_id: 't',
      track_slug: 'track',
      unit_id: 'u',
      unit_slug: 'unit',
      lesson_id: 'l',
      lesson_slug: 'lesson',
      skill_codes: ['grammar-ni'],
      jlpt_level: 'N5',
      locale: 'EN',
      content_type: 'GRAMMAR',
      published: true,
      content_revision: 1,
      source_revision: 1,
      translation_revision: 1,
      source_updated_at: '2026-11-24',
      translation_updated_at: '2026-11-24',
      source_refs: [{ provider: 'fixture' }],
      content: { text },
      content_checksum: hash(text),
      removed_paths: [],
      license: 'Internal research fixture',
      researcher_review: 'approved',
      ingestion_eligible: true,
      hold_reasons: [],
    });
    chunks.push({
      chunkId: `chunk-${index}`,
      sourceId: 'kotobahub:lesson-text:l:en',
      parentId,
      corpusVersion: 'fixture-v1',
      locale: 'EN',
      jlptLevel: 'JLPT_N5',
      trackSlug: 'track',
      unitSlug: 'unit',
      lessonSlug: 'lesson',
      skillCodes: ['grammar-ni'],
      sourceIds: [sourceId],
      unitIds: [`u${index}`],
      overlapUnitIds: [],
      start: 0,
      end: text.length,
      offsetUnit: 'UTF16_CODE_UNITS',
      chunkIndex: index,
      text,
      contentChecksum: hash(text),
      tokenCount: 12,
      contentTokenCount: 10,
      specialTokenCount: 2,
      tokenizerId: 'fixture-tokenizer',
      chunkingVersion: 'fixture-v1',
      normalizationVersion: 'fixture',
      spans: [],
    });
  }

  return createIngestionPlan(
    { manifestSha256: hash('fixture'), chunks, sources },
    'data03_fixture',
  );
}

export function dense() {
  return { dense: Array.from({ length: 1024 }, (_value, index) => (index === 0 ? 1 : 0)) };
}

export function memoryStore() {
  const rows = new Map<string, IndexPoint>();
  let failUpsert = false;
  let writable = true;
  let preparations = 0;
  const store = {
    prepare: async () => {
      preparations++;
      await Promise.resolve();
    },
    assertWritable: async () => {
      await Promise.resolve();

      if (!writable) {
        throw new Error('ACTIVE_COLLECTION');
      }
    },
    upsert: async (_manifest: IndexManifest, points: readonly IndexPoint[]) => {
      await Promise.resolve();

      if (failUpsert) {
        throw new Error('LOST_ACKNOWLEDGEMENT');
      }

      for (const point of points) {
        rows.set(point.id, point);
      }
    },
    validate: async (manifest: IndexManifest): Promise<IndexValidation> => {
      await Promise.resolve();

      if (rows.size !== manifest.expectedPointCount) {
        throw new Error('COUNT_MISMATCH');
      }

      return {
        physicalCollection: manifest.physicalCollection,
        indexRevision: manifest.indexRevision,
        fingerprint: 'fixture',
        pointCount: rows.size,
        contentDigest: manifest.contentDigest,
        retrievalProfile: 'DENSE',
        modelRevisionsRecorded: false,
        searchSmokePassed: true,
      };
    },
  };

  return {
    store,
    rows,
    setFailUpsert: (value: boolean) => {
      failUpsert = value;
    },
    setWritable: (value: boolean) => {
      writable = value;
    },
    preparations: () => preparations,
  };
}
