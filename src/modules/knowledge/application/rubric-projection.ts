import { assertRubricBundle } from '@/modules/knowledge/application/rubric';
import { canonicalRubricContent } from '@/modules/knowledge/application/rubric-canonical';
import { canonical, hash, object, parseSource } from '@/modules/knowledge/application/validation';
import type {
  ApprovedCorpus,
  ApprovedSource,
  JsonObject,
} from '@/modules/knowledge/domain/models/ingestion';
import { IngestionError } from '@/modules/knowledge/domain/models/ingestion';
import type { RubricBundle } from '@/modules/knowledge/domain/models/rubric';

export function projectRubricGuidance(bundle: RubricBundle): readonly ApprovedSource[] {
  assertRubricBundle(bundle);

  return bundle.guidances.map((guidance): ApprovedSource => {
    const scope = guidance.content.scope;
    const locale = guidance.content.locale === 'en' ? 'EN' : 'ID';
    const owners = bundle.sourceCorpus.sources.filter(
      (source) =>
        source.source_table === 'skills' &&
        source.published &&
        source.ingestion_eligible &&
        source.researcher_review === 'approved' &&
        source.hold_reasons.length === 0 &&
        source.jlpt_level === scope.jlptLevel &&
        source.track_slug === scope.trackSlug &&
        source.unit_slug === scope.unitSlug &&
        source.lesson_slug === scope.lessonSlug &&
        source.skill_codes.includes(scope.skillCode) &&
        source.locale === locale,
    );
    const owner = owners[0];

    if (owners.length !== 1 || !owner || !guidance.approval || !guidance.provenance.license) {
      throw new IngestionError('INVALID_SOURCE');
    }

    parseSource(owner);

    const rowId = `${guidance.id}@${guidance.revision}`;
    const content = object(JSON.parse(canonicalRubricContent(guidance.content))) as JsonObject;
    const projected: ApprovedSource = {
      source_id: `kotobahub:rubric_guidance:${rowId}:${locale.toLowerCase()}`,
      parent_id: owner.parent_id,
      source_table: 'rubric_guidance',
      source_row_id: rowId,
      source_uri: `urn:kotobahub:rubric-guidance:${encodeURIComponent(guidance.id)}:${guidance.revision}`,
      track_id: owner.track_id,
      track_slug: owner.track_slug,
      unit_id: owner.unit_id,
      unit_slug: owner.unit_slug,
      lesson_id: owner.lesson_id,
      lesson_slug: owner.lesson_slug,
      skill_codes: [scope.skillCode],
      jlpt_level: owner.jlpt_level,
      locale,
      content_type: 'RUBRIC',
      rubric: {
        guidanceId: guidance.id,
        guidanceRevision: guidance.revision,
        guidanceContentSha256: guidance.contentSha256,
        policyId: bundle.policyRef.id,
        policyRevision: bundle.policyRef.revision,
        policyContentSha256: bundle.policyRef.contentSha256,
      },
      published: true,
      content_revision: guidance.revision,
      source_revision: guidance.revision,
      translation_revision: guidance.revision,
      source_updated_at: guidance.approval.approvedAt,
      translation_updated_at: guidance.approval.approvedAt,
      source_refs: guidance.provenance.sourceRefs.map((ref) => ({ ...ref })),
      content,
      content_checksum: guidance.contentSha256,
      removed_paths: [],
      license: guidance.provenance.license,
      researcher_review: 'approved',
      ingestion_eligible: true,
      hold_reasons: [],
    };

    parseSource(projected);

    return projected;
  });
}

export function projectRubricCorpus(bundle: RubricBundle): ApprovedCorpus {
  const sources = projectRubricGuidance(bundle);

  return {
    corpusVersion: bundle.corpusVersion,
    manifestSha256: hash(
      canonical({
        sourceCorpusManifest: bundle.sourceCorpus.manifestSha256,
        corpusVersion: bundle.corpusVersion,
        policy: bundle.policy,
        guidances: bundle.guidances,
      }),
    ),
    usagePolicySha256: hash(
      canonical({
        sourceUsagePolicy: bundle.sourceCorpus.usagePolicySha256,
        policy: bundle.policy.provenance,
        guidances: bundle.guidances.map((guidance) => guidance.provenance),
      }),
    ),
    sources: [...bundle.sourceCorpus.sources, ...sources],
  };
}
