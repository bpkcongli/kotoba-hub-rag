import { readFileSync } from 'node:fs';
import type { Requests } from '@/contracts/types';
import { canonicalRubricContent, parseRubricBundle } from '@/modules/knowledge/application/rubric';
import { hash, object } from '@/modules/knowledge/application/validation';
import type { ApprovedCorpus } from '@/modules/knowledge/domain/models/ingestion';
import type { RubricBundle } from '@/modules/knowledge/domain/models/rubric';

export const meaningAnchors = [0, 20, 40, 60] as const;
export const grammarAnchors = [0, 10, 20, 30] as const;
export const naturalnessAnchors = [0, 5, 10] as const;

export function gradedAssessment(
  scores = { meaning: 60, grammar: 30, naturalness: 10 },
  feedbackText = 'Makna sumber terjaga; ungkapan Jepang dapat diterima.',
) {
  return {
    assessment: {
      kind: 'FREE_RESPONSE_ASSESSMENT',
      outcome: 'GRADED',
      scores,
      feedbackText,
    },
  };
}

export function ungradableAssessment(
  reason:
    | 'SOURCE_AMBIGUOUS'
    | 'SOURCE_REFERENCE_CONFLICT'
    | 'NORMALIZATION_CONFLICT' = 'SOURCE_AMBIGUOUS',
) {
  return {
    assessment: {
      kind: 'FREE_RESPONSE_ASSESSMENT',
      outcome: 'UNGRADABLE',
      reason,
    },
  };
}

// Synthetic approval and scope apply only to isolated tests; approved source files are read-only.
export function rubricFixture(request: Requests['evaluate']): RubricBundle {
  const readTemplate = (name: 'policy.json' | 'guidance-id-n5.json'): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(
      readFileSync(new URL(`../../research/rubrics/uc-02-v1/${name}`, import.meta.url), 'utf8'),
    );

    return object(parsed);
  };
  const approve = (template: Record<string, unknown>, content: Record<string, unknown>) => {
    const contentSha256 = hash(canonicalRubricContent(content));

    return {
      ...template,
      id: template.id,
      revision: template.revision,
      status: 'APPROVED',
      content,
      contentSha256,
      approval: {
        approvedBy: 'synthetic-test-reviewer',
        role: 'TEST',
        approvedAt: '2026-11-28T00:00:00Z',
        reviewedContentSha256: contentSha256,
      },
      provenance: {
        ...object(template.provenance),
        usageScope: 'INTERNAL_RUNTIME',
        license: 'Synthetic CI fixture only',
      },
    };
  };
  const policyTemplate = readTemplate('policy.json');
  const policy = approve(policyTemplate, object(policyTemplate.content));
  const guidanceTemplate = readTemplate('guidance-id-n5.json');
  const skill = request.payload.context.catalog.find(
    (row) => row.skillCode === request.payload.question.skillCode,
  );

  if (!skill) {
    throw new Error('Synthetic request requires catalog skill');
  }

  const level = request.payload.context.targetLevel === 'JLPT_N5' ? 'N5' : 'N4';
  const locale = request.payload.language.translationLocale;
  const guidance = approve(guidanceTemplate, {
    ...object(guidanceTemplate.content),
    policyRef: { id: policy.id, revision: policy.revision, contentSha256: policy.contentSha256 },
    locale,
    scope: {
      questionType: 'FREE_RESPONSE',
      jlptLevel: level,
      trackSlug: skill.trackSlug,
      unitSlug: skill.unitSlug,
      lessonSlug: skill.lessonSlug,
      skillCode: skill.skillCode,
    },
  });
  const source: ApprovedCorpus = {
    corpusVersion: 'synthetic-source-v1',
    manifestSha256: hash('synthetic-source-manifest'),
    usagePolicySha256: hash('synthetic-usage'),
    sources: [
      {
        source_id: 'synthetic:skills:copula',
        parent_id: 'synthetic:lessons:copula',
        source_table: 'skills',
        source_row_id: 'copula',
        source_uri: 'urn:synthetic:copula',
        track_id: 'synthetic-track',
        track_slug: skill.trackSlug,
        unit_id: 'synthetic-unit',
        unit_slug: skill.unitSlug,
        lesson_id: 'synthetic-lesson',
        lesson_slug: skill.lessonSlug,
        skill_codes: [skill.skillCode],
        jlpt_level: level,
        locale: locale === 'id' ? 'ID' : 'EN',
        content_type: 'GRAMMAR',
        published: true,
        content_revision: 1,
        source_revision: 1,
        translation_revision: 1,
        source_updated_at: '2026-11-28',
        translation_updated_at: '2026-11-28',
        source_refs: [{ provider: 'synthetic' }],
        content: { text: 'Synthetic grammar only.' },
        content_checksum: hash('Synthetic grammar only.'),
        removed_paths: [],
        license: 'Synthetic CI fixture only',
        researcher_review: 'approved',
        ingestion_eligible: true,
        hold_reasons: [],
      },
    ],
  };
  const policyText = JSON.stringify(policy);
  const guidanceText = JSON.stringify(guidance);

  return parseRubricBundle(
    {
      schemaVersion: 'uc-02-rubric-bundle-v1',
      corpusVersion: request.corpus_version,
      sourceCorpus: { corpusVersion: source.corpusVersion, manifestSha256: source.manifestSha256 },
      trustedReviewers: [{ id: 'synthetic-test-reviewer', role: 'TEST' }],
      policy: { path: 'policy.json', sha256: hash(policyText) },
      guidances: [{ path: 'guidance.json', sha256: hash(guidanceText) }],
    },
    new Map([
      ['policy.json', policyText],
      ['guidance.json', guidanceText],
    ]),
    source,
  );
}

export function rubricEvidence(bundle: RubricBundle) {
  const guidance = bundle.guidances[0];

  if (!guidance) {
    throw new Error('Synthetic bundle requires one guidance');
  }

  return {
    chunkId: 'synthetic-rubric-chunk',
    sourceId: `kotobahub:rubric_guidance:${guidance.id}@${guidance.revision}:${guidance.content.locale}`,
    text: canonicalRubricContent(guidance.content),
    score: 0.8,
    scoreType: 'cosine',
    rubric: {
      guidanceId: guidance.id,
      guidanceRevision: guidance.revision,
      guidanceContentSha256: guidance.contentSha256,
      policyId: bundle.policyRef.id,
      policyRevision: bundle.policyRef.revision,
      policyContentSha256: bundle.policyRef.contentSha256,
    },
  };
}
