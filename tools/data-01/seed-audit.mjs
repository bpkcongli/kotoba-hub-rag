import { encode, pedagogicalContent, scrub, sha256 } from './audit.mjs';

export function seedOwners(seeds) {
  const owners = new Map();

  for (const { path, seed } of seeds) {
    const track = seed.track;

    for (const unit of track.units) {
      for (const lesson of unit.lessons) {
        for (const owner of [...lesson.skills, ...lesson.contentBlocks]) {
          if (owners.has(owner.id)) throw new Error('Duplicate seed owner ID.');

          owners.set(owner.id, { owner, lesson, unit, track, path });
        }
      }
    }
  }

  return owners;
}

export function compareSeeds(documents, owners) {
  const mismatches = [];

  for (const doc of documents) {
    const entry = owners.get(doc.source_row_id);
    const local = entry?.owner.localizations?.[doc.locale.toLowerCase()];

    if (!entry || !local) {
      mismatches.push({ source_id: doc.source_id, reason: 'missing_seed_owner_or_locale' });
      continue;
    }

    const { owner, lesson, unit, track } = entry;
    const { sourceRevision, translationRevision, isPublished, sourceRefs, ...payload } = local;

    const removed = [];
    const expected = scrub(
      pedagogicalContent(
        doc.source_table,
        {
          ...owner,
          block_type: owner.blockType,
        },
        doc.source_table === 'skills' ? payload : { content: payload },
        doc.locale,
      ),
      removed,
    );

    const sameParents =
      doc.lesson_id === lesson.id &&
      doc.lesson_slug === lesson.slug &&
      doc.unit_id === unit.id &&
      doc.unit_slug === unit.slug &&
      doc.track_id === track.id &&
      doc.track_slug === track.slug &&
      doc.jlpt_level === track.curriculumLevel;
    const ancestorsCurrent = [track, unit, lesson, owner].every(
      (item) =>
        item.isPublished &&
        item.localizations?.[doc.locale.toLowerCase()]?.isPublished &&
        item.localizations[doc.locale.toLowerCase()].sourceRevision === item.contentRevision,
    );

    if (
      !sameParents ||
      !ancestorsCurrent ||
      !isPublished ||
      encode(doc.content) !== encode(expected) ||
      doc.content_checksum !== sha256(encode(expected)) ||
      doc.content_revision !== owner.contentRevision ||
      doc.source_revision !== sourceRevision ||
      doc.translation_revision !== translationRevision ||
      encode(doc.removed_paths) !== encode(removed) ||
      encode(doc.source_refs) !== encode(scrub([...(owner.sourceRefs ?? []), ...sourceRefs]))
    ) {
      mismatches.push({
        source_id: doc.source_id,
        reason: 'content_revision_parent_publication_or_provenance_mismatch',
      });
    }
  }

  return mismatches;
}
