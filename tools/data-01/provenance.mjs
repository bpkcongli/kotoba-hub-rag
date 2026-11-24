import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { canonical, encode, sha256 } from './audit.mjs';
import { compareSeeds, seedOwners } from './seed-audit.mjs';

const app = resolve(process.env.KOTOBA_APP ?? '../kotoba-hub');
const snapshot = resolve(process.argv[2] ?? 'artifacts/data-01/snapshot-v4');
const output = resolve(process.argv[3] ?? 'research/corpus/data-01-v2');

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const audit = await readJson(`${snapshot}/audit.json`);
const consent = await readJson(`${output}/researcher-decision.json`);

if (
  consent.schema_version !== 'data-01-researcher-decision-v2' ||
  consent.snapshot_audit_sha256 !== sha256(await readFile(`${snapshot}/audit.json`)) ||
  consent.candidate_file_sha256 !== sha256(await readFile(`${snapshot}/candidates.jsonl`))
) {
  throw new Error('Snapshot tidak sama dengan scope keputusan peneliti v2.');
}

const documents = (await readFile(`${snapshot}/candidates.jsonl`, 'utf8'))
  .trim()
  .split('\n')
  .map(JSON.parse);

const lessonIds = [...new Set(documents.map((doc) => doc.lesson_id))].sort();
if (encode(lessonIds) !== encode(consent.approved_lesson_ids))
  throw new Error('Scope lesson tidak cocok.');

const seedPaths = [
  'content/syllabus/v2/tracks/jlpt-n5-foundation.json',
  'content/syllabus/v2/tracks/jlpt-n4-expansion.json',
];
const seeds = [];
for (const path of seedPaths) seeds.push({ path, seed: await readJson(resolve(app, path)) });

const owners = seedOwners(seeds);
const mismatches = compareSeeds(documents, owners);
if (mismatches.length > 0) throw new Error(`Seed mismatch: ${mismatches.length} documents.`);

const evidencePaths = [
  ...seedPaths,
  'content/syllabus/v2/manifest.json',
  'content/syllabus/v2/manifest.n4-plain-form-bridge.json',
  'src/backend/syllabus/infrastructure/database/schema.ts',
  'src/backend/syllabus/application/helpers/localize-syllabus.ts',
  'docs/syllabus/bilingual/batch-01/bilingual-batch-01-curation.md',
  'docs/syllabus/bilingual/n4-plain-form-bridge.md',
  'docs/syllabus/bilingual/n4-plain-form-bridge.scope.json',
  'content/syllabus/v2/drafts/jlpt-n4-expansion/n4-plain-form-bridge/review.md',
  'content/syllabus/v2/drafts/jlpt-n4-expansion/n4-plain-form-bridge/provenance.json',
  'content/syllabus/sources/jmdict/raw/2026-05-16/licence.html',
  'content/syllabus/sources/yomitan-jlpt-vocab/raw/2026-05-16/LICENSE.txt',
  'content/syllabus/sources/bunpro/README.md',
  'content/syllabus/sources/tae-kim/README.md',
];
const evidence = [];
for (const path of evidencePaths)
  evidence.push({ app_relative_path: path, sha256: sha256(await readFile(resolve(app, path))) });

const refs = new Map();
for (const doc of documents) {
  for (const ref of doc.source_refs) {
    const key = encode(ref);
    if (!refs.has(key)) refs.set(key, { ref, document_ids: [] });
    refs.get(key).document_ids.push(doc.source_id);
  }
}

const fileDigests = new Map();
for (const item of refs.values()) {
  const path =
    typeof item.ref.retrievedFrom === 'string' ? resolve(app, item.ref.retrievedFrom) : null;
  const inside =
    path &&
    path.startsWith(`${app}${sep}`) &&
    !relative(app, path)
      .split(sep)
      .some((part) => part.startsWith('.'));

  item.local_evidence = { exists: false, sha256: null };
  if (inside && relative(app, path).startsWith(`content${sep}syllabus${sep}`)) {
    try {
      if (!fileDigests.has(path)) fileDigests.set(path, sha256(await readFile(path)));
      item.local_evidence = { exists: true, sha256: fileDigests.get(path) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  item.provenance_status = item.local_evidence.exists
    ? 'local_reference_resolves'
    : 'original_reference_unresolved';

  if (!item.local_evidence.exists && item.ref.provider === 'KOTOBAHUB_INTERNAL') {
    const paths = [
      ...new Set(
        item.document_ids.map(
          (id) => owners.get(documents.find((doc) => doc.source_id === id).source_row_id).path,
        ),
      ),
    ];

    item.supplemental_evidence = {
      paths,
      owner_and_locale_matched: true,
      note: 'Path/URL asli dipertahankan; seed v2 dengan owner/locale yang sama menjadi evidence tambahan.',
    };
  }
}

const unresolved = [...refs.values()].filter(
  (item) => !item.local_evidence.exists && !item.supplemental_evidence,
);
if (unresolved.length > 0)
  throw new Error(`Unresolved external source references: ${unresolved.length}`);

const licenseInventory = [
  {
    provider: 'JMDICT',
    declared_license: 'CC-BY-SA-4.0',
    evidence: evidencePaths[11],
    status: 'local_declaration_found_attribution_retained',
  },
  {
    provider: 'YOMITAN_JLPT_VOCAB',
    declared_license: 'CC-BY-SA-4.0',
    evidence: evidencePaths[12],
    status: 'local_declaration_found_attribution_retained',
  },
  {
    provider: 'BUNPRO',
    declared_license: null,
    evidence: evidencePaths[13],
    status: 'reuse_terms_unverified_accepted_for_internal_research',
  },
  {
    provider: 'TAE_KIM',
    declared_license: null,
    evidence: evidencePaths[14],
    status: 'pdf_license_unverified_accepted_for_internal_research',
  },
  {
    provider: 'KOTOBAHUB_INTERNAL',
    declared_license: null,
    evidence: evidencePaths[6],
    status: 'researcher_approved_internal_research',
  },
];

const contentApproved = ['N5', 'N4'].every(
  (level) => consent.content_review[level]?.status === 'approved',
);
const usageAccepted =
  consent.usage_acceptance.accepted &&
  consent.usage_acceptance.scope === 'internal_research' &&
  consent.usage_acceptance.attribution_required &&
  consent.usage_acceptance.public_redistribution_authorized === false;
if (!contentApproved || !usageAccepted) throw new Error('Keputusan isi/penggunaan belum lengkap.');

const report = {
  schema_version: 'data-01-provenance-v2',
  app_commit: audit.app_source.commit,
  seed_comparison: {
    compared_documents: documents.length,
    mismatches,
    exact_match: true,
    projection:
      'compare pedagogical content after the same comprehension/evaluator-key exclusions; retain removed_paths',
  },
  references: [...refs.values()].sort((a, b) => encode(a.ref).localeCompare(encode(b.ref), 'en')),
  evidence,
  license_inventory: licenseInventory,
  source_terms_confirmed: false,
  public_redistribution_authorized: false,
  limitation:
    'Kecocokan isi/relasi/revisi terhadap seed lokal dan penerimaan batasan penggunaan internal; bukan konfirmasi hak pihak ketiga atau validasi ahli independen.',
};

const inventory = documents.map((doc) => ({
  source_id: doc.source_id,
  parent_id: doc.parent_id,
  source_table: doc.source_table,
  source_row_id: doc.source_row_id,
  source_uri: doc.source_uri,
  lesson_id: doc.lesson_id,
  lesson_slug: doc.lesson_slug,
  unit_id: doc.unit_id,
  unit_slug: doc.unit_slug,
  track_id: doc.track_id,
  track_slug: doc.track_slug,
  skill_codes: doc.skill_codes,
  jlpt_level: doc.jlpt_level,
  locale: doc.locale,
  content_type: doc.content_type,
  content_checksum: doc.content_checksum,
  content_revision: doc.content_revision,
  source_revision: doc.source_revision,
  translation_revision: doc.translation_revision,
  source_updated_at: doc.source_updated_at,
  translation_updated_at: doc.translation_updated_at,
  published: doc.published,
  removed_paths: doc.removed_paths,
  researcher_content_review: 'approved',
  source_license_statuses: [...new Set(doc.source_refs.map((ref) => ref.provider))]
    .sort()
    .map((provider) => licenseInventory.find((entry) => entry.provider === provider)),
  license: 'Internal research use accepted by researcher; third-party terms tracked separately',
  usage_policy_id: 'kotobahub-internal-research-20261124',
  ingestion_eligible: true,
  hold_reasons: [],
  public_redistribution_authorized: false,
}));

await mkdir(output, { recursive: true });
await mkdir(`${output}/licenses`, { recursive: true });

await writeFile(`${output}/provenance.json`, JSON.stringify(canonical(report), null, 2) + '\n');
await writeFile(
  `${output}/source-inventory.jsonl`,
  inventory.map((row) => JSON.stringify(row)).join('\n') + '\n',
);

for (const name of ['audit.json', 'schema.json', 'catalog.json', 'exclusions.json'])
  await writeFile(`${output}/${name}`, await readFile(`${snapshot}/${name}`));

await writeFile(
  `${output}/licenses/JMDICT-licence.html`,
  await readFile(resolve(app, evidencePaths[11])),
);
await writeFile(
  `${output}/licenses/YOMITAN-LICENSE.txt`,
  await readFile(resolve(app, evidencePaths[12])),
);

const trackedFiles = [
  'source-inventory.jsonl',
  'provenance.json',
  'audit.json',
  'schema.json',
  'catalog.json',
  'exclusions.json',
  'researcher-decision.json',
  'USAGE-POLICY.md',
  'ATTRIBUTION.md',
  'licenses/JMDICT-licence.html',
  'licenses/YOMITAN-LICENSE.txt',
];
const artifacts = {};
for (const name of trackedFiles)
  artifacts[name] = { sha256: sha256(await readFile(`${output}/${name}`)) };

const manifest = {
  schema_version: 'data-01-manifest-v2',
  corpus_candidate_id: 'kotobahub-n5n4-data01-20261124-v2',
  task: 'DATA-01',
  status: 'AUDITED_APPROVED_FOR_INTERNAL_RESEARCH',
  captured_at_utc: audit.captured_at_utc,
  supersedes: '../data-01-v1/manifest.json',
  app_source: audit.app_source,
  snapshot_directory: relative(resolve('.'), snapshot),
  snapshot_audit_sha256: consent.snapshot_audit_sha256,
  immutable_snapshot_files: audit.artifacts,
  candidate_document_count: documents.length,
  unique_source_owners: new Set(documents.map((doc) => doc.source_row_id)).size,
  coverage: {
    requested_levels: ['N5', 'N4'],
    audited_levels: ['N5', 'N4'],
    pending_levels: [],
    approved_lessons: lessonIds.length,
    locales: ['EN', 'ID'],
    by_level: audit.by_level,
    by_locale: audit.by_locale,
    full_curriculum_claimed: false,
  },
  researcher_content_review: 'approved',
  approval_evidence: 'researcher-decision.json',
  license_status: 'ACCEPTED_LIMITATIONS_FOR_INTERNAL_RESEARCH',
  source_terms_confirmed: false,
  public_redistribution_authorized: false,
  usage_policy: 'USAGE-POLICY.md',
  attribution: 'ATTRIBUTION.md',
  ingestion_eligible_document_count: inventory.length,
  ready_for_data02_ingestion: true,
  ready_for_data02_offline_development: true,
  source_inventory_digest: sha256(
    encode(inventory.map((row) => ({ source_id: row.source_id, checksum: row.content_checksum }))),
  ),
  normalization: {
    policy: 'none_in_data01',
    html: 'preserved_unsanitized_for_audit_only',
    unicode: 'UTF-8 original strings, no NFC/NFKC',
    content_checksum:
      'SHA-256 canonical JSON of pedagogical content; not DATA-02 chunk text checksum',
  },
  exclusions: {
    unpublished_and_ancestors: true,
    out_of_level: true,
    standalone_flashcard_groups:
      'Outside current lesson catalog scope; not declared intrinsically ineligible.',
    learner_tables: 'not_read',
    post_study_prompts_and_answers: 'not_read',
    comprehension_checks: 'removed_from_reading_projection',
    evaluator_cases_and_keys: 'not_read',
    official_free_response_rubric: 'not_found_in_examined_sources_audit_result_handed_to_uc02_eval',
  },
  experiment_frozen: false,
  paid_inference_calls: 0,
  database_writes: 0,
  artifacts,
};

await writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

console.log(
  JSON.stringify({
    compared: documents.length,
    mismatches: 0,
    unique_refs: refs.size,
    supplemented_internal_refs: report.references.filter((ref) => ref.supplemental_evidence).length,
    ingestion_eligible_documents: inventory.length,
    status: manifest.status,
  }),
);
