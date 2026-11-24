import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { IngestionError } from '@/ingestion/types';
import type { ApprovedCorpus, ApprovedSource } from '@/ingestion/types';
import { array, canonical, hash, object, parseSource, string } from '@/ingestion/validation';

async function boundedFile(path: string, maxBytes = 32 * 1024 * 1024): Promise<Buffer> {
  if ((await stat(path)).size > maxBytes) {
    throw new IngestionError('INVALID_SOURCE');
  }

  const body = await readFile(path);

  if (body.byteLength > maxBytes) {
    throw new IngestionError('INVALID_SOURCE');
  }

  return body;
}

async function contained(root: string, name: string): Promise<string> {
  if (isAbsolute(name) || name.split(/[\\/]/).includes('..') || name.includes('\\')) {
    throw new IngestionError('INVALID_SOURCE');
  }

  const path = await realpath(resolve(root, name));

  if (!path.startsWith(`${await realpath(root)}${sep}`)) {
    throw new IngestionError('INVALID_SOURCE');
  }

  return path;
}

function lines(body: Buffer): unknown[] {
  const values = body.toString('utf8').trim().split('\n');

  if (values.length > 100000 || values.some((line) => Buffer.byteLength(line) > 128 * 1024)) {
    throw new IngestionError('INVALID_SOURCE');
  }

  return values.map((line) => JSON.parse(line) as unknown);
}

export async function loadApprovedCorpus(repoRoot: string): Promise<ApprovedCorpus> {
  const pointerDir = await contained(repoRoot, 'research/corpus');
  const pointer = object(
    JSON.parse((await boundedFile(resolve(pointerDir, 'current.json'), 16384)).toString('utf8')),
  );

  const manifestPath = await contained(pointerDir, string(pointer.manifest));
  const manifestBody = await boundedFile(manifestPath);

  if (
    hash(manifestBody) !== pointer.manifest_sha256 ||
    pointer.usage_scope !== 'internal_research' ||
    pointer.public_redistribution_authorized !== false
  ) {
    throw new IngestionError('INTEGRITY_ERROR');
  }

  const manifest = object(JSON.parse(manifestBody.toString('utf8')));

  if (
    manifest.schema_version !== 'data-01-manifest-v2' ||
    manifest.status !== 'AUDITED_APPROVED_FOR_INTERNAL_RESEARCH' ||
    manifest.ready_for_data02_ingestion !== true ||
    manifest.researcher_content_review !== 'approved' ||
    manifest.public_redistribution_authorized !== false ||
    manifest.source_terms_confirmed !== false
  ) {
    throw new IngestionError('INVALID_SOURCE');
  }

  const base = dirname(manifestPath);
  const artifacts = object(manifest.artifacts);
  const bodies = new Map<string, Buffer>();

  for (const [name, entry] of Object.entries(artifacts)) {
    const body = await boundedFile(await contained(base, name));

    if (hash(body) !== object(entry).sha256) {
      throw new IngestionError('INTEGRITY_ERROR');
    }

    bodies.set(name, body);
  }

  const requiredBody = (name: string): Buffer => {
    const body = bodies.get(name);

    if (!body) {
      throw new IngestionError('INVALID_SOURCE');
    }

    return body;
  };

  const decision = object(JSON.parse(requiredBody('researcher-decision.json').toString('utf8')));
  const usage = object(decision.usage_acceptance);
  const reviews = object(decision.content_review);

  if (
    usage.accepted !== true ||
    usage.scope !== 'internal_research' ||
    usage.public_redistribution_authorized !== false ||
    usage.attribution_required !== true ||
    ['N5', 'N4'].some((level) => object(reviews[level]).status !== 'approved')
  ) {
    throw new IngestionError('INVALID_SOURCE');
  }

  const snapshot = await contained(repoRoot, string(manifest.snapshot_directory));
  const snapshotArtifacts = object(manifest.immutable_snapshot_files);
  let candidateBody: Buffer | undefined;

  for (const [name, entry] of Object.entries(snapshotArtifacts)) {
    const body = await boundedFile(await contained(snapshot, name));
    const expected = object(entry);

    if (hash(body) !== expected.sha256 || body.byteLength !== expected.bytes) {
      throw new IngestionError('INTEGRITY_ERROR');
    }

    if (name === 'candidates.jsonl') {
      candidateBody = body;
    }
  }

  if (
    !candidateBody ||
    hash(candidateBody) !== decision.candidate_file_sha256 ||
    hash(requiredBody('audit.json')) !== decision.snapshot_audit_sha256 ||
    decision.snapshot_audit_sha256 !== manifest.snapshot_audit_sha256
  ) {
    throw new IngestionError('INTEGRITY_ERROR');
  }

  const inventory = lines(requiredBody('source-inventory.jsonl')).map(object);
  const byId = new Map(inventory.map((row) => [string(row.source_id), row]));
  const approvedLessons = new Set(array(decision.approved_lesson_ids).map(string));

  const sources: ApprovedSource[] = [];
  const seen = new Set<string>();

  for (const value of lines(candidateBody)) {
    const doc = parseSource(value);
    const row = byId.get(doc.source_id);

    if (
      !row ||
      seen.has(doc.source_id) ||
      !approvedLessons.has(doc.lesson_id) ||
      row.ingestion_eligible !== true ||
      row.researcher_content_review !== 'approved' ||
      row.public_redistribution_authorized !== false ||
      array(row.hold_reasons).length !== 0
    ) {
      throw new IngestionError('INTEGRITY_ERROR');
    }

    for (const key of [
      'parent_id',
      'source_row_id',
      'source_table',
      'lesson_id',
      'lesson_slug',
      'unit_id',
      'unit_slug',
      'track_id',
      'track_slug',
      'skill_codes',
      'jlpt_level',
      'locale',
      'content_type',
      'content_checksum',
      'content_revision',
      'source_revision',
      'translation_revision',
      'removed_paths',
    ] as const) {
      if (canonical(row[key]) !== canonical(doc[key])) {
        throw new IngestionError('INTEGRITY_ERROR');
      }
    }

    seen.add(doc.source_id);
    sources.push({
      ...doc,
      license: string(row.license),
      researcher_review: 'approved',
      ingestion_eligible: true,
      hold_reasons: [],
    });
  }

  if (
    seen.size !== byId.size ||
    byId.size !== inventory.length ||
    sources.length !== manifest.candidate_document_count ||
    sources.length !== manifest.ingestion_eligible_document_count ||
    new Set(sources.map((doc) => doc.source_row_id)).size !== manifest.unique_source_owners ||
    new Set(sources.map((doc) => doc.lesson_id)).size !== approvedLessons.size
  ) {
    throw new IngestionError('INTEGRITY_ERROR');
  }

  return {
    corpusVersion: string(manifest.corpus_candidate_id),
    manifestSha256: hash(manifestBody),
    usagePolicySha256: hash(requiredBody('USAGE-POLICY.md')),
    sources,
  };
}
