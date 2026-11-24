import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { loadApprovedCorpus } from '@/ingestion/corpus-loader';
import { IngestionError } from '@/ingestion/types';
import { canonical, hash } from '@/ingestion/validation';

async function bundle(root: string, approved = true): Promise<void> {
  const manifestDir = resolve(root, 'research/corpus/fixture');
  const snapshot = resolve(root, 'artifacts/snapshot');

  await mkdir(manifestDir, { recursive: true });
  await mkdir(snapshot, { recursive: true });

  const docs = ['N5', 'N4'].flatMap((level) =>
    ['EN', 'ID'].map((locale) => {
      const content = {
        canonical: { grammar: { pattern: 'です' } },
        localized: { title: 'Copula', grammar: { meaning: 'Polite.' } },
      };

      return {
        source_id: `kotobahub:skills:s${level}:${locale.toLowerCase()}`,
        parent_id: `kotobahub:lessons:l${level}`,
        source_table: 'skills',
        source_row_id: `s${level}`,
        source_uri: `urn:source:s${level}`,
        track_id: `t${level}`,
        track_slug: `track-${level}`,
        unit_id: `u${level}`,
        unit_slug: `unit-${level}`,
        lesson_id: `l${level}`,
        lesson_slug: `lesson-${level}`,
        skill_codes: [`skill-${level}`],
        jlpt_level: level,
        locale,
        content_type: 'GRAMMAR',
        published: true,
        content_revision: 1,
        source_revision: 1,
        translation_revision: 1,
        source_updated_at: '2026-11-24',
        translation_updated_at: '2026-11-24',
        source_refs: [{ provider: 'KOTOBAHUB_INTERNAL' }],
        content,
        content_checksum: hash(canonical(content)),
        removed_paths: [],
        license: null,
        researcher_review: 'unverified',
        ingestion_eligible: false,
        hold_reasons: ['capture_before_approval'],
      };
    }),
  );

  const candidates = docs.map((doc) => JSON.stringify(doc)).join('\n') + '\n';
  const audit = JSON.stringify({ captured: true });

  const decision = {
    candidate_file_sha256: hash(candidates),
    snapshot_audit_sha256: hash(audit),
    approved_lesson_ids: ['lN5', 'lN4'],
    content_review: {
      N5: { status: 'approved' },
      N4: { status: approved ? 'approved' : 'pending' },
    },
    usage_acceptance: {
      accepted: true,
      scope: 'internal_research',
      public_redistribution_authorized: false,
      attribution_required: true,
    },
  };

  const inventory = docs.map((doc) => ({
    ...doc,
    license: 'Internal research only',
    researcher_content_review: 'approved',
    ingestion_eligible: true,
    hold_reasons: [],
    public_redistribution_authorized: false,
  }));

  const files = {
    'researcher-decision.json': JSON.stringify(decision),
    'source-inventory.jsonl': inventory.map((row) => JSON.stringify(row)).join('\n'),
    'audit.json': audit,
    'USAGE-POLICY.md': 'Internal research only.',
  };

  for (const [name, body] of Object.entries(files)) {
    await writeFile(resolve(manifestDir, name), body);
  }
  await writeFile(resolve(snapshot, 'candidates.jsonl'), candidates);

  const manifest = {
    schema_version: 'data-01-manifest-v2',
    status: 'AUDITED_APPROVED_FOR_INTERNAL_RESEARCH',
    ready_for_data02_ingestion: true,
    researcher_content_review: 'approved',
    public_redistribution_authorized: false,
    source_terms_confirmed: false,
    corpus_candidate_id: 'fixture',
    snapshot_directory: 'artifacts/snapshot',
    snapshot_audit_sha256: hash(audit),
    candidate_document_count: 4,
    ingestion_eligible_document_count: 4,
    unique_source_owners: 2,
    artifacts: Object.fromEntries(
      Object.entries(files).map(([name, body]) => [name, { sha256: hash(body) }]),
    ),
    immutable_snapshot_files: {
      'candidates.jsonl': { sha256: hash(candidates), bytes: Buffer.byteLength(candidates) },
    },
  };

  const body = JSON.stringify(manifest);

  await writeFile(resolve(manifestDir, 'manifest.json'), body);
  await writeFile(
    resolve(manifestDir, '../current.json'),
    JSON.stringify({
      manifest: 'fixture/manifest.json',
      manifest_sha256: hash(body),
      usage_scope: 'internal_research',
      public_redistribution_authorized: false,
    }),
  );
}

await test('approved loader overlays capture status only after integrity and scoped researcher approval', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'kotoba-data02-loader-'));

  try {
    await bundle(root);

    const corpus = await loadApprovedCorpus(root);

    assert.equal(corpus.sources.length, 4);
    assert.ok(
      corpus.sources.every(
        (doc) =>
          doc.ingestion_eligible &&
          doc.researcher_review === 'approved' &&
          doc.license === 'Internal research only',
      ),
    );
    assert.equal(corpus.usagePolicySha256, hash('Internal research only.'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('changed snapshot or unresolved content approval fails before normalization', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'kotoba-data02-tamper-'));

  try {
    await bundle(root, false);

    await assert.rejects(loadApprovedCorpus(root), IngestionError);

    await bundle(root);

    const path = resolve(root, 'artifacts/snapshot/candidates.jsonl');
    await writeFile(path, (await readFile(path, 'utf8')) + ' ');

    await assert.rejects(
      loadApprovedCorpus(root),
      (error) => error instanceof IngestionError && error.code === 'INTEGRITY_ERROR',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('manifest pointer cannot traverse outside corpus directory', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'kotoba-data02-path-'));

  try {
    await bundle(root);

    await writeFile(
      resolve(root, 'research/corpus/current.json'),
      JSON.stringify({ manifest: '../outside.json' }),
    );

    await assert.rejects(
      loadApprovedCorpus(root),
      (error) => error instanceof IngestionError && error.code === 'INVALID_SOURCE',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
