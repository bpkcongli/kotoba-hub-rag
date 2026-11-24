import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAudit, current, encode, scrub, sha256 } from './audit.mjs';

function fixture() {
  const owner = (id, extra = {}) => ({
    id,
    is_published: 1,
    content_revision: 2,
    seed_schema_version: '2.0.0',
    ...extra,
  });

  const text = (field, id, extra = {}) => ({
    [field]: id,
    locale: 'en',
    source_revision: 2,
    translation_revision: 1,
    is_published: 1,
    source_ref_payload: [],
    title: 'test',
    ...extra,
  });

  const bilingual = (field, id, extra = {}) =>
    ['en', 'id'].map((locale) => text(field, id, { ...extra, locale }));

  return {
    tracks: [owner('t', { curriculum_level: 'N5', slug: 'n5' })],
    units: [owner('u', { track_id: 't', slug: 'unit' })],
    lessons: [owner('l', { unit_id: 'u', slug: 'lesson' })],
    skills: [
      owner('s', {
        lesson_id: 'l',
        code: 'skill',
        owner_type: 'LESSON',
        curriculum_level: 'N5',
        skill_type: 'VOCABULARY',
        content: { vocabulary: { readings: ['こんにちは'], primarySpelling: '今日は' } },
      }),
    ],
    lesson_content_blocks: [
      owner('b', {
        lesson_id: 'l',
        block_type: 'EXAMPLE_SENTENCE',
        content: { japaneseSentence: '<p>学校へ行きます。</p>' },
      }),
    ],
    unit_skill_mappings: [{ lesson_id: 'l', unit_id: 'u', skill_id: 's' }],
    track_translations: bilingual('track_id', 't'),
    unit_translations: bilingual('unit_id', 'u'),
    lesson_translations: bilingual('lesson_id', 'l'),
    skill_translations: bilingual('skill_id', 's', {
      content: { vocabulary: { glosses: ['greeting'] } },
    }),
    lesson_content_block_translations: bilingual('content_block_id', 'b', {
      content: { translation: '<p>Pergi ke sekolah.</p>' },
    }),
  };
}

test('published bilingual snapshot retains canonical Japanese and holds unapproved candidates', () => {
  const data = fixture();

  const { documents } = buildAudit(data);
  const skill = documents.find((row) => row.source_table === 'skills' && row.locale === 'ID');
  const example = documents.find(
    (row) => row.content_type === 'EXAMPLE_SENTENCE' && row.locale === 'ID',
  );

  assert.equal(documents.length, 4);

  assert.deepEqual(skill.content.canonical.vocabulary.readings, ['こんにちは']);
  assert.equal(skill.content.localized_language, 'ID');
  assert.equal(example.content.japaneseSentence, '<p>学校へ行きます。</p>');

  assert.ok(documents.every((row) => !row.ingestion_eligible && row.license === null));

  assert.ok(documents.every((row) => row.content_checksum === sha256(encode(row.content))));
});

test('unpublished or unsupported ancestors cannot expose published descendants', () => {
  for (const mutate of [
    (data) => {
      data.tracks[0].is_published = 0;
    },
    (data) => {
      data.units[0].is_published = 0;
    },
    (data) => {
      data.lessons[0].is_published = 0;
    },
    (data) => {
      data.tracks[0].curriculum_level = 'N3';
    },
    (data) => {
      data.units[0].track_id = 'missing';
    },
  ]) {
    const data = fixture();
    mutate(data);

    const audit = buildAudit(data);

    assert.equal(audit.documents.length, 0);
    assert.equal(audit.catalog.length, 0);
  }
});

test('stale English ancestor or owner is excluded; stale Indonesian is never relabelled fallback', () => {
  const data = fixture();
  data.skill_translations.find((row) => row.locale === 'id').source_revision = 1;

  const audit = buildAudit(data);

  assert.equal(audit.documents.filter((row) => row.source_table === 'skills').length, 1);
  assert.ok(
    audit.exclusions.some((row) => row.reason === 'missing_current_locale_no_relabelled_fallback'),
  );

  data.track_translations.find((row) => row.locale === 'en').source_revision = 1;

  assert.equal(buildAudit(data).documents.length, 0);
});

test('standalone group, level mismatch and unpublished skills stay outside lesson corpus', () => {
  for (const extra of [
    { owner_type: 'FLASHCARD_VOCABULARY_GROUP', lesson_id: null },
    { curriculum_level: 'N4' },
    { is_published: 0 },
  ]) {
    const data = fixture();
    Object.assign(data.skills[0], extra);

    const audit = buildAudit(data);

    assert.equal(audit.documents.filter((row) => row.source_table === 'skills').length, 0);
  }
});

test('nested evaluator keys, learner fields and comprehension answers are removed', () => {
  const removed = [];
  const payload = {
    grammar: {
      example: '猫です。',
      expectedAnswer: 'key',
      nested: [
        {
          userId: 'private',
          comprehensionChecks: [{ expectedAnswerEn: 'key' }],
          expected_route: 'DEEP',
        },
      ],
    },
    ground_truth: 'key',
  };

  const safe = scrub(payload, removed);

  assert.deepEqual(safe, { grammar: { example: '猫です。', nested: [{}] } });
  assert.equal(removed.length, 5);
  assert.equal(payload.grammar.expectedAnswer, 'key');
});

test('identity and content checksum are stable under source row order and object key order', () => {
  const data = fixture();

  const first = buildAudit(data).documents;

  data.skill_translations.reverse();
  data.lesson_content_block_translations.reverse();

  const second = buildAudit(data).documents;

  assert.equal(encode(first), encode(second));

  assert.equal(sha256(encode({ a: 1, b: 2 })), sha256(encode({ b: 2, a: 1 })));
  assert.notEqual(sha256(encode('が')), sha256(encode('か\u3099')));
});

test('current locale requires published schema v2 and matching positive revisions', () => {
  const owner = fixture().skills[0];
  const text = fixture().skill_translations[0];

  assert.equal(current(owner, text), true);
  assert.equal(current(owner, { ...text, translation_revision: 0 }), false);
  assert.equal(current(owner, { ...text, source_revision: 1 }), false);
  assert.equal(current({ ...owner, seed_schema_version: '1.0.0' }, text), false);
  assert.equal(current(owner, undefined), false);
});

test('N4 reading keeps passage and translations while excluding canonical and localized checks', () => {
  const data = fixture();
  data.tracks[0].curriculum_level = 'N4';
  Object.assign(data.skills[0], {
    curriculum_level: 'N4',
    skill_type: 'READING',
    content: {
      reading: {
        passageText: 'きのう友だちが来た。',
        comprehensionChecks: [{ expectedAnswerEn: 'friend' }],
      },
    },
  });
  for (const row of data.skill_translations)
    row.content = {
      reading: {
        translation: row.locale === 'id' ? 'Kemarin teman datang.' : 'A friend came yesterday.',
        comprehensionChecks: [{ expectedAnswer: 'key', prompt: 'private quiz' }],
      },
    };

  const { documents } = buildAudit(data);
  const reading = documents.find((row) => row.content_type === 'READING' && row.locale === 'ID');

  assert.equal(reading.jlpt_level, 'N4');
  assert.equal(reading.content.canonical.reading.passageText, 'きのう友だちが来た。');
  assert.equal(reading.content.localized.reading.translation, 'Kemarin teman datang.');
  assert.equal(reading.content.canonical.reading.comprehensionChecks, undefined);
  assert.equal(reading.content.localized.reading.comprehensionChecks, undefined);
  assert.deepEqual(reading.removed_paths, [
    'canonical.reading.comprehensionChecks',
    'localized.reading.comprehensionChecks',
  ]);
});
