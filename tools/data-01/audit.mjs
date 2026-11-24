import { createHash } from 'node:crypto';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }

  return value;
};

export const encode = (value) => JSON.stringify(canonical(value));

export function pedagogicalContent(table, owner, localized, locale) {
  const content = localized.content ?? {};

  if (table === 'skills') {
    return {
      canonical: owner.content,
      canonical_language: 'JA with source EN metadata',
      localized: { title: localized.title, description: localized.description, ...content },
      localized_language: locale.toUpperCase(),
    };
  }

  if (owner.block_type === 'EXAMPLE_SENTENCE') {
    return { japaneseSentence: owner.content.japaneseSentence, ...content };
  }

  if (owner.block_type === 'GRAMMAR_STRUCTURE') {
    return { skillCode: owner.content.skillCode, ...content };
  }

  return content;
}

const forbidden =
  /^(?:expected_?answer.*|accepted_?text_?answers|answer_?key|reference_?answer|comprehension_?checks|expected_?route|complexity|ground_?truth|evaluation_?rubric|user_?id|learner_?id|email|password|database_?url)$/i;

export function scrub(value, removed = [], path = '') {
  if (Array.isArray(value))
    return value.map((item, index) => scrub(item, removed, `${path}[${index}]`));

  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const location = path ? `${path}.${key}` : key;

      if (forbidden.test(key)) {
        removed.push(location);
        return [];
      }

      return [[key, scrub(item, removed, location)]];
    }),
  );
}

export function current(owner, text) {
  return (
    owner?.is_published === 1 &&
    owner.seed_schema_version === '2.0.0' &&
    text?.is_published === 1 &&
    text.source_revision === owner.content_revision &&
    Number.isInteger(text.translation_revision) &&
    text.translation_revision > 0
  );
}

export function buildAudit(data) {
  const byId = (rows) => new Map(rows.map((row) => [row.id, row]));

  const tracks = byId(data.tracks);
  const units = byId(data.units);
  const lessons = byId(data.lessons);
  const skills = byId(data.skills);

  const translations = new Map();
  const ownerColumns = {
    tracks: 'track_id',
    units: 'unit_id',
    lessons: 'lesson_id',
    skills: 'skill_id',
    lesson_content_blocks: 'content_block_id',
  };
  const translationTables = {
    tracks: 'track_translations',
    units: 'unit_translations',
    lessons: 'lesson_translations',
    skills: 'skill_translations',
    lesson_content_blocks: 'lesson_content_block_translations',
  };

  for (const [table, column] of Object.entries(ownerColumns)) {
    for (const row of data[translationTables[table]]) {
      translations.set(`${table}/${row[column]}/${row.locale}`, row);
    }
  }

  const textFor = (table, id, locale) => translations.get(`${table}/${id}/${locale}`);
  const localeReady = (table, row, locale) => current(row, textFor(table, row.id, locale));

  const publishedPath = (lesson) => {
    const unit = units.get(lesson?.unit_id);
    const track = tracks.get(unit?.track_id);

    return lesson?.is_published === 1 &&
      unit?.is_published === 1 &&
      track?.is_published === 1 &&
      ['N5', 'N4'].includes(track.curriculum_level)
      ? { lesson, unit, track }
      : null;
  };

  const englishPath = (path) =>
    path &&
    localeReady('tracks', path.track, 'en') &&
    localeReady('units', path.unit, 'en') &&
    localeReady('lessons', path.lesson, 'en');

  const exclusions = [];
  const documents = [];
  const catalog = [];

  for (const lesson of data.lessons) {
    const path = publishedPath(lesson);

    if (!englishPath(path)) {
      exclusions.push({
        table: 'lessons',
        id: lesson.id,
        reason: path ? 'missing_current_english_ancestor' : 'unpublished_or_out_of_scope_ancestor',
      });
      continue;
    }

    for (const locale of ['en', 'id']) {
      if (
        !['tracks', 'units', 'lessons'].every((table, index) =>
          localeReady(table, [path.track, path.unit, path.lesson][index], locale),
        )
      ) {
        continue;
      }

      const local = textFor('lessons', lesson.id, locale);

      catalog.push({
        lesson_id: lesson.id,
        lesson_slug: lesson.slug,
        unit_id: path.unit.id,
        unit_slug: path.unit.slug,
        track_id: path.track.id,
        track_slug: path.track.slug,
        jlpt_level: path.track.curriculum_level,
        locale: locale.toUpperCase(),
        title: local.title,
        learning_objective: local.learning_objective,
        content_revision: lesson.content_revision,
        translation_revision: local.translation_revision,
      });
    }
  }

  for (const table of ['skills', 'lesson_content_blocks']) {
    for (const row of data[table]) {
      const path = publishedPath(lessons.get(row.lesson_id));

      const reason =
        row.is_published !== 1
          ? 'unpublished'
          : table === 'skills' && row.owner_type !== 'LESSON'
            ? 'standalone_flashcard_group_outside_lesson_catalog'
            : !englishPath(path)
              ? 'unpublished_out_of_scope_or_stale_ancestor'
              : table === 'skills' && row.curriculum_level !== path.track.curriculum_level
                ? 'level_mismatch'
                : !localeReady(table, row, 'en')
                  ? 'missing_current_english'
                  : null;

      if (reason) {
        exclusions.push({ table, id: row.id, reason });
        continue;
      }

      for (const locale of ['en', 'id']) {
        if (
          !localeReady(table, row, locale) ||
          !['tracks', 'units', 'lessons'].every((ancestor, index) =>
            localeReady(ancestor, [path.track, path.unit, path.lesson][index], locale),
          )
        ) {
          exclusions.push({
            table,
            id: row.id,
            locale,
            reason: 'missing_current_locale_no_relabelled_fallback',
          });
          continue;
        }

        const local = textFor(table, row.id, locale);
        const content = pedagogicalContent(table, row, local, locale);

        const removed = [];
        const safeContent = scrub(content, removed);
        const refs = scrub([...(row.source_refs ?? []), ...(local.source_ref_payload ?? [])]);

        const codes =
          table === 'skills'
            ? [row.code]
            : row.block_type === 'GRAMMAR_STRUCTURE'
              ? [row.content.skillCode]
              : data.unit_skill_mappings
                  .filter((mapping) => mapping.lesson_id === row.lesson_id)
                  .map((mapping) => skills.get(mapping.skill_id))
                  .filter((skill) => skill?.is_published === 1)
                  .map((skill) => skill.code)
                  .sort();

        const sourceId = `kotobahub:${table}:${row.id}:${locale}`;

        documents.push({
          source_id: sourceId,
          parent_id: `kotobahub:lessons:${row.lesson_id}`,
          source_table: table,
          source_row_id: row.id,
          source_uri: `urn:kotobahub:${table}:${row.id}`,
          track_id: path.track.id,
          track_slug: path.track.slug,
          unit_id: path.unit.id,
          unit_slug: path.unit.slug,
          lesson_id: path.lesson.id,
          lesson_slug: path.lesson.slug,
          skill_codes: codes,
          jlpt_level: path.track.curriculum_level,
          locale: locale.toUpperCase(),
          content_type: row.skill_type ?? row.block_type,
          published: true,
          sort_order: row.sort_order,
          content_revision: row.content_revision,
          translation_revision: local.translation_revision,
          source_revision: local.source_revision,
          source_updated_at: row.updated_at,
          translation_updated_at: local.updated_at,
          source_refs: refs,
          content: safeContent,
          content_checksum: sha256(encode(safeContent)),
          removed_paths: removed,
          license: null,
          researcher_review: 'unverified',
          ingestion_eligible: false,
          hold_reasons: ['usage_rights_not_approved', 'researcher_content_review_not_recorded'],
        });
      }
    }
  }

  documents.sort((a, b) => a.source_id.localeCompare(b.source_id, 'en'));

  return { documents, catalog, exclusions };
}
