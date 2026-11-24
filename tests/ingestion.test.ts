import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkLessons } from '@/ingestion/chunker';
import { normalizeCorpus } from '@/ingestion/normalize';
import { htmlToText } from '@/ingestion/text';
import { loadBgeTokenCounter } from '@/ingestion/tokenizer';
import { IngestionError } from '@/ingestion/types';
import type {
  ApprovedCorpus,
  ApprovedSource,
  ChunkConfig,
  JsonObject,
  NormalizedLesson,
  TokenCounter,
} from '@/ingestion/types';
import { canonical, hash, parseChunkConfig, parseSource } from '@/ingestion/validation';

const config: ChunkConfig = {
  version: 'pedagogical-v1',
  unicode: 'NFC',
  maxTokens: 512,
  overlapTokens: 96,
  overlapUnits: 2,
};

const counter: TokenCounter = {
  identity: { id: 'fixture', model: 'fixture', revision: '1', engine: 'fixture' },
  count: (text) =>
    Promise.resolve({
      content: Array.from(text).length,
      special: 2,
      total: Array.from(text).length + 2,
    }),
};

function source(
  id: string,
  type: ApprovedSource['content_type'],
  content: JsonObject,
  order?: number,
  locale: 'EN' | 'ID' = 'EN',
): ApprovedSource {
  const table = ['GRAMMAR', 'VOCABULARY', 'READING'].includes(type)
    ? 'skills'
    : 'lesson_content_blocks';

  return {
    source_id: `kotobahub:${table}:${id}:${locale.toLowerCase()}`,
    parent_id: 'kotobahub:lessons:l',
    source_table: table,
    source_row_id: id,
    source_uri: `urn:source:${id}`,
    track_id: 't',
    track_slug: 'track',
    unit_id: 'u',
    unit_slug: 'unit',
    lesson_id: 'l',
    lesson_slug: 'lesson',
    skill_codes: ['grammar'],
    jlpt_level: 'N5',
    locale,
    content_type: type,
    published: true,
    ...(order === undefined ? {} : { sort_order: order }),
    content_revision: 1,
    source_revision: 1,
    translation_revision: 1,
    source_updated_at: '2026-11-24',
    translation_updated_at: '2026-11-24',
    source_refs: [{ provider: 'KOTOBAHUB_INTERNAL' }],
    content,
    content_checksum: hash(canonical(content)),
    removed_paths: [],
    license: 'Internal research only',
    researcher_review: 'approved',
    ingestion_eligible: true,
    hold_reasons: [],
  };
}

function corpus(): ApprovedCorpus {
  return {
    corpusVersion: 'fixture',
    manifestSha256: hash('manifest'),
    usagePolicySha256: hash('policy'),
    sources: [
      source('s', 'GRAMMAR', {
        canonical: { grammar: { pattern: 'A は B です', structureLines: ['A は B です'] } },
        localized: {
          title: 'Copula',
          description: 'Polite statement.',
          grammar: { meaning: 'Polite statement.' },
        },
      }),
      source('b', 'GRAMMAR_STRUCTURE', { skillCode: 'grammar', ALL: '<p>A は B です。</p>' }, 1),
      source(
        'e',
        'EXAMPLE_SENTENCE',
        { japaneseSentence: '<p>猫です。</p>', translation: '<p>It is a cat.</p>' },
        2,
      ),
      source('p', 'PARAGRAPH', { title: 'Usage', body: '<p>Use this politely.</p>' }, 3),
    ],
  };
}

function unitLesson(): NormalizedLesson {
  const text = 'aaaaaa\n\nbbbbbb\n\ncccccc\n\ndddddd';

  return {
    id: 'parent:EN',
    parentId: 'lesson',
    corpusVersion: 'fixture',
    locale: 'EN',
    jlptLevel: 'JLPT_N5',
    trackSlug: 'track',
    unitSlug: 'unit',
    lessonSlug: 'lesson',
    normalizationVersion: 'v1',
    text,
    checksum: hash(text),
    units: [0, 8, 16, 24].map((start, i) => ({
      id: `u${i}`,
      kind: 'narrative',
      start,
      end: start + 6,
      sourceIds: [`s${i}`],
      skillCodes: ['skill'],
      spans: [],
    })),
  };
}

await test('HTML conversion preserves entities, ruby, line structure and Japanese while excluding executable content', () => {
  const raw =
    '<p>猫 &amp; 犬<br>か\u3099 ｶﾞ</p><ruby>漢字<rt>かんじ</rt></ruby><script>secret()</script><img src=x onerror=secret()><style>bad</style>';

  const nfc = htmlToText(raw, 'NFC');
  const original = htmlToText(raw, 'NONE');

  assert.equal(nfc, '猫 & 犬\nが ｶﾞ\n漢字(かんじ)');
  assert.ok(original.includes('か\u3099'));
  assert.ok(!nfc.includes('secret') && !nfc.includes('bad'));
  assert.equal(raw.includes('か\u3099'), true);
});

await test('grammar meaning, structure and adjacent Japanese/translation remain one pedagogical unit', () => {
  const input = corpus();

  const lessons = normalizeCorpus(input, config);
  const lesson = lessons[0];

  assert.ok(lesson);

  const grammar = lesson.units[0];

  assert.ok(grammar);

  assert.equal(grammar.kind, 'grammar');
  assert.equal(grammar.sourceIds.length, 3);

  const text = lesson.text.slice(grammar.start, grammar.end);

  assert.ok(
    text.includes('A は B です') &&
      text.includes('Polite statement.') &&
      text.includes('猫です。') &&
      text.includes('It is a cat.'),
  );

  assert.equal(lesson.units.length, 2);
  assert.equal(lesson.checksum, hash(lesson.text));
  assert.equal(grammar.spans[0]?.rawStart, 0);
});

await test('normalization and chunks are deterministic across source order and preserve full source coverage', async () => {
  const input = corpus();

  const first = normalizeCorpus(input, config);
  const reversed = normalizeCorpus({ ...input, sources: [...input.sources].reverse() }, config);

  const chunks = await chunkLessons(first, config, counter);

  assert.deepEqual(first, reversed);
  assert.deepEqual(chunks, await chunkLessons(reversed, config, counter));

  assert.equal(new Set(chunks.flatMap((chunk) => chunk.sourceIds)).size, input.sources.length);

  for (const chunk of chunks) {
    assert.equal(chunk.text, first[0]?.text.slice(chunk.start, chunk.end));
    assert.equal(chunk.contentChecksum, hash(chunk.text));
    assert.equal(chunk.tokenCount, (await counter.count(chunk.text)).total);
  }
});

await test('whole-unit overlap respects token budget and always includes fresh evidence', async () => {
  const lesson = unitLesson();
  const small = { ...config, maxTokens: 16, overlapTokens: 6, overlapUnits: 1 };

  const chunks = await chunkLessons([lesson], small, counter);

  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[1]?.overlapUnitIds, ['u1']);
  assert.deepEqual(chunks[2]?.unitIds, ['u2', 'u3']);
  assert.ok(chunks.every((chunk) => chunk.tokenCount <= 16));

  assert.equal(new Set(chunks.flatMap((chunk) => chunk.unitIds)).size, 4);

  assert.deepEqual(
    (await chunkLessons([lesson], { ...small, overlapTokens: 0 }, counter)).map(
      (chunk) => chunk.overlapUnitIds,
    ),
    [[], []],
  );
});

await test('oversized grammar/example unit fails explicitly without truncation or splitting', async () => {
  const lessons = normalizeCorpus(corpus(), config);

  await assert.rejects(
    chunkLessons(lessons, { ...config, maxTokens: 16, overlapTokens: 0 }, counter),
    (error) => error instanceof IngestionError && error.code === 'ATOMIC_UNIT_TOO_LARGE',
  );

  assert.ok(lessons[0]?.text.includes('猫です。'));
});

await test('locale parents, no cross-lesson skills, publication and grammar ownership are enforced', () => {
  const input = corpus();
  const first = input.sources[0];
  assert.ok(first);

  assert.throws(
    () => normalizeCorpus({ ...input, sources: [...input.sources, first] }, config),
    IngestionError,
  );
  assert.throws(
    () => normalizeCorpus({ ...input, sources: input.sources.slice(1) }, config),
    IngestionError,
  );
  assert.throws(
    () =>
      normalizeCorpus(
        {
          ...input,
          sources: input.sources.map((doc) =>
            doc.source_id === first.source_id ? { ...doc, track_slug: 'other' } : doc,
          ),
        },
        config,
      ),
    IngestionError,
  );

  const idSource = {
    ...first,
    locale: 'ID' as const,
    source_id: first.source_id.replace(':en', ':id'),
  };

  const separated = normalizeCorpus({ ...input, sources: [...input.sources, idSource] }, config);

  assert.equal(separated.length, 2);
  assert.notEqual(separated[0]?.id, separated[1]?.id);
});

await test('strict source parser detects checksum changes, revisions and evaluation-key injection', () => {
  const doc = corpus().sources[0];

  assert.ok(doc);

  assert.equal(parseSource(doc), doc);
  assert.throws(() => parseSource({ ...doc, additional: true }), IngestionError);
  assert.throws(() => parseSource({ ...doc, published: false }), IngestionError);
  assert.throws(() => parseSource({ ...doc, content_type: 'PARAGRAPH' }), IngestionError);
  assert.throws(() => parseSource({ ...doc, source_revision: 2 }), IngestionError);
  assert.throws(() => parseSource({ ...doc, content_checksum: hash('changed') }), IngestionError);

  const content = { ...doc.content, nested: { expected_route: 'DEEP' } };
  assert.throws(
    () => parseSource({ ...doc, content, content_checksum: hash(canonical(content)) }),
    IngestionError,
  );
});

await test('config revisions change chunk identity and invalid limits or malformed token counts fail', async () => {
  const lessons = [unitLesson()];

  assert.notEqual(
    (await chunkLessons(lessons, config, counter))[0]?.chunkId,
    (await chunkLessons(lessons, { ...config, overlapUnits: 1 }, counter))[0]?.chunkId,
  );

  assert.throws(
    () => parseChunkConfig({ ...config, overlapTokens: config.maxTokens }),
    IngestionError,
  );
  assert.throws(() => parseChunkConfig({ ...config, maxTokens: '512' }), IngestionError);
  assert.throws(() => parseChunkConfig({ ...config, extra: true }), IngestionError);

  await assert.rejects(
    chunkLessons(lessons, config, {
      ...counter,
      count: () => Promise.resolve({ content: 1, special: 2, total: 2 }),
    }),
    IngestionError,
  );
});

await test('Indonesian reading and vocabulary preserve Japanese evidence with locale-specific translations', () => {
  const input = corpus();
  const docs = [
    source(
      'r',
      'READING',
      {
        canonical: { reading: { passageText: '昨日、学校へ行きました。' } },
        localized: {
          title: 'Kegiatan kemarin',
          description: 'Bentuk lampau.',
          reading: { translation: 'Kemarin saya pergi ke sekolah.' },
        },
      },
      undefined,
      'ID',
    ),
    source(
      'v',
      'VOCABULARY',
      {
        canonical: {
          vocabulary: {
            primarySpelling: '学校',
            alternateSpellings: ['學校'],
            readings: ['がっこう'],
          },
        },
        localized: { title: 'Sekolah', vocabulary: { glosses: ['sekolah'] } },
      },
      undefined,
      'ID',
    ),
  ];

  const lessons = normalizeCorpus({ ...input, sources: docs }, config);

  assert.equal(lessons.length, 1);
  assert.equal(lessons[0]?.locale, 'ID');

  for (const evidence of [
    '昨日、学校へ行きました。',
    'Kemarin saya pergi ke sekolah.',
    '学校',
    '學校',
    'がっこう',
    'sekolah',
  ]) {
    assert.ok(lessons[0]?.text.includes(evidence));
  }

  assert.deepEqual(
    new Set(lessons[0]?.units.map((unit) => unit.kind)),
    new Set(['reading', 'lexical']),
  );
});

await test('tokenizer assets are required explicitly and never substituted with an estimated count', async () => {
  await assert.rejects(
    loadBgeTokenCounter('/tmp/kotoba-data02-missing-tokenizer-directory'),
    (error) => error instanceof IngestionError && error.code === 'INVALID_TOKENIZER',
  );
});
