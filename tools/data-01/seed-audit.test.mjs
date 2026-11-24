import assert from 'node:assert/strict';
import test from 'node:test';
import { encode, scrub, sha256 } from './audit.mjs';
import { compareSeeds, seedOwners } from './seed-audit.mjs';

function fixture() {
  const localized = {
    sourceRevision: 2,
    translationRevision: 1,
    isPublished: true,
    sourceRefs: [],
    title: 'Membaca',
    description: 'Baca paragraf.',
    content: {
      reading: {
        translation: 'Teman datang.',
        comprehensionChecks: [{ expectedAnswer: 'private' }],
      },
    },
  };

  const owner = {
    id: 's',
    isPublished: true,
    contentRevision: 2,
    content: {
      reading: {
        passageText: '友だちが来た。',
        comprehensionChecks: [{ expectedAnswerEn: 'private' }],
      },
    },
    localizations: { id: localized },
  };

  const parent = (id, slug) => ({
    id,
    slug,
    isPublished: true,
    contentRevision: 2,
    localizations: { id: localized },
  });

  const lesson = { ...parent('l', 'lesson'), skills: [owner], contentBlocks: [] };
  const unit = { ...parent('u', 'unit'), lessons: [lesson] };
  const track = { ...parent('t', 'track'), curriculumLevel: 'N4', units: [unit] };

  const removed = [];
  const content = scrub(
    {
      canonical: owner.content,
      canonical_language: 'JA with source EN metadata',
      localized: {
        title: localized.title,
        description: localized.description,
        ...localized.content,
      },
      localized_language: 'ID',
    },
    removed,
  );

  const doc = {
    source_id: 'source',
    source_row_id: 's',
    source_table: 'skills',
    locale: 'ID',
    lesson_id: 'l',
    lesson_slug: 'lesson',
    unit_id: 'u',
    unit_slug: 'unit',
    track_id: 't',
    track_slug: 'track',
    jlpt_level: 'N4',
    content,
    content_checksum: sha256(encode(content)),
    content_revision: 2,
    source_revision: 2,
    translation_revision: 1,
    source_refs: [],
    removed_paths: removed,
  };

  return { seed: { track }, doc };
}

test('seed comparison accepts reading projection without treating removed answer checks as drift', () => {
  const { seed, doc } = fixture();

  const result = compareSeeds([doc], seedOwners([{ path: 'n4.json', seed }]));

  assert.deepEqual(result, []);
  assert.equal(doc.content.canonical.reading.passageText, '友だちが来た。');
});

test('wrong parent, unpublished ancestor, stale translation and content changes cannot pass seed evidence', () => {
  for (const mutate of [
    ({ doc }) => {
      doc.lesson_id = 'different';
    },
    ({ seed }) => {
      seed.track.isPublished = false;
    },
    ({ seed }) => {
      seed.track.units[0].lessons[0].skills[0].localizations.id.sourceRevision = 1;
    },
    ({ doc }) => {
      doc.content.canonical.reading.passageText = 'different';
    },
    ({ doc }) => {
      doc.removed_paths = [];
    },
  ]) {
    const data = fixture();
    mutate(data);

    const result = compareSeeds([data.doc], seedOwners([{ path: 'n4.json', seed: data.seed }]));

    assert.equal(result.length, 1);
  }
});

test('multiple tracks are mapped explicitly and duplicate owner IDs fail', () => {
  const { seed, doc } = fixture();
  const n5 = JSON.parse(JSON.stringify(seed));
  Object.assign(n5.track, { id: 'n5-track', curriculumLevel: 'N5' });
  n5.track.units[0].lessons[0].skills[0].id = 'n5-owner';

  const mapped = seedOwners([
    { path: 'n5.json', seed: n5 },
    { path: 'n4.json', seed },
  ]);

  assert.equal(mapped.size, 2);
  assert.deepEqual(compareSeeds([doc], mapped), []);

  assert.throws(
    () =>
      seedOwners([
        { path: 'a.json', seed },
        { path: 'b.json', seed },
      ]),
    /Duplicate/,
  );
});
