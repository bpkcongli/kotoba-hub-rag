import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { encode, scrub, sha256 } from './audit.mjs';

const root = resolve(process.argv[2] ?? 'research/corpus/data-01-v2');

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));

const manifest = await json(`${root}/manifest.json`);
const consent = await json(`${root}/researcher-decision.json`);
const provenance = await json(`${root}/provenance.json`);
const audit = await json(`${root}/audit.json`);
const catalog = await json(`${root}/catalog.json`);
const inventory = (await readFile(`${root}/source-inventory.jsonl`, 'utf8'))
  .trim()
  .split('\n')
  .map(JSON.parse);

const snapshot = resolve(manifest.snapshot_directory);
const docs = (await readFile(`${snapshot}/candidates.jsonl`, 'utf8'))
  .trim()
  .split('\n')
  .map(JSON.parse);

const isV2 = manifest.schema_version === 'data-01-manifest-v2';
assert.ok(isV2 || manifest.schema_version === 'data-01-manifest-v1');

const checks = [];
const check = (name, run) => {
  run();
  checks.push(name);
};

let testCount = 0;
for (const path of ['tools/data-01/audit.test.mjs', 'tools/data-01/seed-audit.test.mjs']) {
  const result = execFileSync(process.execPath, [path], { encoding: 'utf8' });

  const count = Number(result.match(/tests (\d+)/)?.[1]);

  check(`unit-tests:${path}`, () => {
    assert.ok(count > 0);
    assert.match(result, new RegExp(`pass ${count}(?:\\s|$)`));
    assert.match(result, /fail 0(?:\s|$)/);
  });

  testCount += count;
}

for (const [name, info] of Object.entries(manifest.artifacts)) {
  const actual = sha256(await readFile(`${root}/${name}`));

  check(`artifact:${name}`, () => assert.equal(actual, info.sha256));
}

for (const [name, info] of Object.entries(manifest.immutable_snapshot_files)) {
  const body = await readFile(`${snapshot}/${name}`);

  check(`snapshot:${name}`, () => {
    assert.equal(sha256(body), info.sha256);
    assert.equal(body.byteLength, info.bytes);
  });
}

check('approval-bound-to-exact-snapshot', () => {
  assert.equal(
    consent.snapshot_audit_sha256,
    sha256(Buffer.from(JSON.stringify(audit, null, 2) + '\n')),
  );
  assert.equal(consent.snapshot_audit_sha256, manifest.snapshot_audit_sha256);
  assert.equal(
    consent.candidate_file_sha256,
    manifest.immutable_snapshot_files['candidates.jsonl'].sha256,
  );
  assert.deepEqual(
    consent.approved_lesson_ids,
    [...new Set(docs.map((doc) => doc.lesson_id))].sort(),
  );
  assert.equal(consent.approved_lesson_ids.length, manifest.coverage.approved_lessons);
});

check('inventory-reconciles-with-snapshot', () => {
  assert.equal(inventory.length, manifest.candidate_document_count);
  assert.equal(docs.length, inventory.length);
  assert.equal(new Set(inventory.map((row) => row.source_id)).size, inventory.length);
  assert.equal(
    sha256(
      encode(
        inventory.map((row) => ({ source_id: row.source_id, checksum: row.content_checksum })),
      ),
    ),
    manifest.source_inventory_digest,
  );

  for (const row of inventory) {
    const doc = docs.find((candidate) => candidate.source_id === row.source_id);
    assert.ok(doc);

    assert.equal(row.content_checksum, sha256(encode(doc.content)));
    for (const key of [
      'parent_id',
      'source_row_id',
      'lesson_id',
      'jlpt_level',
      'locale',
      'content_revision',
      'source_revision',
      'translation_revision',
    ])
      assert.equal(row[key], doc[key]);

    assert.equal(row.researcher_content_review, 'approved');
    assert.equal(row.ingestion_eligible, isV2);

    assert.ok(row.source_license_statuses.length > 0);
    assert.ok(row.source_license_statuses.every((source) => source?.provider));

    if (isV2) {
      assert.equal(typeof row.license, 'string');
      assert.equal(row.public_redistribution_authorized, false);
      assert.deepEqual(row.removed_paths, doc.removed_paths);
    } else assert.equal(row.license, null);
  }
});

check('source-and-translation-counts-distinguished', () => {
  assert.equal(new Set(docs.map((doc) => doc.source_row_id)).size, manifest.unique_source_owners);

  for (const locale of manifest.coverage.locales)
    assert.equal(
      manifest.coverage.by_locale[locale],
      docs.filter((doc) => doc.locale === locale).length,
    );

  for (const level of manifest.coverage.requested_levels)
    assert.equal(
      manifest.coverage.by_level[level],
      docs.filter((doc) => doc.jlpt_level === level).length,
    );

  for (const id of new Set(docs.map((doc) => doc.source_row_id))) {
    const pair = docs.filter((doc) => doc.source_row_id === id);
    assert.deepEqual(pair.map((doc) => doc.locale).sort(), ['EN', 'ID']);
    assert.equal(pair[0].parent_id, pair[1].parent_id);
  }
});

check('catalog-level-locale-skill-isolation', () => {
  const catalogPairs = new Set(catalog.map((row) => `${row.lesson_id}:${row.locale}`));

  for (const doc of docs) {
    assert.ok(catalogPairs.has(`${doc.lesson_id}:${doc.locale}`));
    assert.ok(manifest.coverage.audited_levels.includes(doc.jlpt_level));
    assert.equal(doc.published, true);
    assert.equal(doc.source_revision, doc.content_revision);
    assert.ok(doc.translation_revision > 0);
    assert.ok(doc.skill_codes.length > 0);

    for (const code of doc.skill_codes)
      assert.ok(
        docs.some(
          (skill) =>
            skill.source_table === 'skills' &&
            skill.lesson_id === doc.lesson_id &&
            skill.locale === doc.locale &&
            skill.skill_codes.includes(code),
        ),
      );
  }
});

check('no-evaluator-keys-or-secret-connection-strings', () => {
  for (const doc of docs) {
    const removed = [];

    scrub(doc, removed);

    assert.deepEqual(removed, []);
    assert.doesNotMatch(
      JSON.stringify(doc),
      /mysql:\/\/|postgres(?:ql)?:\/\/|Bearer [A-Za-z0-9_-]+/i,
    );
  }
});

check('all-candidates-match-versioned-seeds', () => {
  assert.equal(provenance.seed_comparison.exact_match, true);
  assert.equal(provenance.seed_comparison.compared_documents, docs.length);
  assert.deepEqual(provenance.seed_comparison.mismatches, []);
  assert.equal(provenance.app_commit, manifest.app_source.commit);

  for (const doc of docs)
    for (const ref of doc.source_refs)
      assert.ok(
        provenance.references.some(
          (entry) =>
            encode(entry.ref) === encode(ref) && entry.document_ids.includes(doc.source_id),
        ),
      );
});

if (isV2) {
  check('content-approval-and-usage-limitations-are-explicit', () => {
    for (const level of ['N5', 'N4'])
      assert.equal(consent.content_review[level].status, 'approved');

    assert.equal(consent.usage_acceptance.accepted, true);
    assert.equal(consent.usage_acceptance.scope, 'internal_research');
    assert.equal(consent.usage_acceptance.attribution_required, true);
    assert.equal(consent.usage_acceptance.third_party_rights_confirmed, false);
    assert.equal(consent.usage_acceptance.public_redistribution_authorized, false);

    assert.equal(manifest.source_terms_confirmed, false);
    assert.equal(manifest.public_redistribution_authorized, false);

    for (const provider of ['BUNPRO', 'TAE_KIM'])
      assert.equal(
        provenance.license_inventory.find((row) => row.provider === provider).declared_license,
        null,
      );

    assert.ok(
      provenance.references.every(
        (ref) => ref.local_evidence.exists || ref.supplemental_evidence?.owner_and_locale_matched,
      ),
    );
  });

  const priorManifest = await json(resolve(root, manifest.supersedes));
  const priorRoot = resolve(root, '..', 'data-01-v1');
  const priorInventoryBody = await readFile(`${priorRoot}/source-inventory.jsonl`);
  const priorInventory = priorInventoryBody.toString('utf8').trim().split('\n').map(JSON.parse);

  check('prior-n5-approval-cannot-cover-changed-content', () => {
    assert.equal(
      sha256(priorInventoryBody),
      priorManifest.artifacts['source-inventory.jsonl'].sha256,
    );

    const n5 = docs.filter((doc) => doc.jlpt_level === 'N5');

    assert.equal(n5.length, priorInventory.length);

    for (const doc of n5) {
      const old = priorInventory.find((row) => row.source_id === doc.source_id);

      assert.ok(old);
      assert.equal(doc.content_checksum, old.content_checksum);
      assert.equal(doc.lesson_id, old.lesson_id);
      assert.equal(doc.content_revision, old.content_revision);
      assert.equal(doc.translation_revision, old.translation_revision);
    }
  });
} else {
  check('historical-held-corpus-is-still-held', () => {
    assert.equal(manifest.status, 'N5_AUDITED_N4_PENDING');
    assert.deepEqual(manifest.coverage.pending_levels, ['N4']);
    assert.equal(manifest.ready_for_data02_ingestion, false);
    assert.equal(manifest.ingestion_eligible_document_count, 0);
  });
}

check('manifest-reconciles-eligibility-and-does-not-claim-freeze-or-paid-calls', () => {
  assert.equal(
    manifest.ingestion_eligible_document_count,
    inventory.filter((row) => row.ingestion_eligible).length,
  );

  if (isV2) {
    assert.equal(manifest.status, 'AUDITED_APPROVED_FOR_INTERNAL_RESEARCH');
    assert.deepEqual(manifest.coverage.pending_levels, []);
    assert.equal(manifest.ready_for_data02_ingestion, true);
  }

  assert.equal(manifest.experiment_frozen, false);
  assert.equal(manifest.paid_inference_calls, 0);
  assert.equal(manifest.database_writes, 0);
});

const evidence = {
  schema_version: 'data-01-verification-v2',
  node_version: process.version,
  check_count: checks.length,
  checks,
  unit_tests: { command: 'npm run data:test', passed: testCount },
  audited_candidates: docs.length,
  offline_only: true,
  limitation:
    'Hash/relasi/proyeksi dan penerimaan scope penelitian internal; bukan konfirmasi hak pihak ketiga, validasi ahli independen atau pengukuran kualitas retrieval.',
};

if (isV2) await writeFile(`${root}/verification.json`, JSON.stringify(evidence, null, 2) + '\n');

console.log(
  JSON.stringify({
    checks_passed: checks.length,
    unit_tests_passed: testCount,
    candidate_documents: docs.length,
  }),
);
