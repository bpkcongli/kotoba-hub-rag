import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  assertRubricBundle,
  canonicalRubricContent,
  parseRubricBundle,
  parseRubricManifest,
  RubricError,
} from '@/modules/knowledge/application/rubric';
import { hash } from '@/modules/knowledge/application/validation';
import type { GradingPolicy, RubricGuidance } from '@/modules/knowledge/domain/models/rubric';
import { loadApprovedCorpus } from '@/modules/knowledge/interface/secondary/corpus/corpus-loader';
import { loadRubricBundle } from '@/modules/knowledge/interface/secondary/corpus/rubric-loader';

const sourceCorpus = await loadApprovedCorpus(process.cwd());

async function fixture() {
  // Synthetic approval is confined to tests; approved source files remain unchanged.
  const policy = JSON.parse(
    await readFile('research/rubrics/uc-02-v1/policy.json', 'utf8'),
  ) as GradingPolicy;
  const guidance = JSON.parse(
    await readFile('research/rubrics/uc-02-v1/guidance-id-n5.json', 'utf8'),
  ) as RubricGuidance;
  const approve = <T extends GradingPolicy | RubricGuidance>(document: T) => ({
    ...document,
    status: 'APPROVED' as const,
    approval: {
      approvedBy: 'synthetic-test-reviewer',
      role: 'TEST_ONLY',
      approvedAt: '2026-11-28T00:00:00Z',
      reviewedContentSha256: document.contentSha256,
    },
    provenance: {
      ...document.provenance,
      license: 'Synthetic fixture only',
      usageScope: 'INTERNAL_RUNTIME' as const,
    },
  });
  const approvedPolicy = approve(policy);
  const approvedGuidance = approve(guidance);
  const documents = new Map([
    ['policy.json', JSON.stringify(approvedPolicy)],
    ['guidance.json', JSON.stringify(approvedGuidance)],
  ]);
  const manifest = {
    schemaVersion: 'uc-02-rubric-bundle-v1',
    corpusVersion: 'synthetic-rubric-fixture-v1',
    sourceCorpus: {
      corpusVersion: sourceCorpus.corpusVersion,
      manifestSha256: sourceCorpus.manifestSha256,
    },
    trustedReviewers: [{ id: 'synthetic-test-reviewer', role: 'TEST_ONLY' }],
    policy: { path: 'policy.json', sha256: hash(documents.get('policy.json') ?? '') },
    guidances: [{ path: 'guidance.json', sha256: hash(documents.get('guidance.json') ?? '') }],
  };

  return { policy: approvedPolicy, guidance: approvedGuidance, documents, manifest };
}

function rejects(action: () => unknown, code: RubricError['code']) {
  assert.throws(action, (error: unknown) => error instanceof RubricError && error.code === code);
}

void test('approved rubric binds canonical actual lesson scope and immutable policy without invented attribution', async () => {
  const { policy, documents, manifest } = await fixture();

  const bundle = parseRubricBundle(manifest, documents, sourceCorpus);

  assertRubricBundle(bundle);
  assert.equal(bundle.policyRef.contentSha256, hash(canonicalRubricContent(policy.content)));
  assert.equal(
    bundle.policyRef.contentSha256,
    '110e52d1c27dcda70ef7cc388864b9db956602195091c174d8a43bcc25fba08a',
  );
  assert.equal(canonicalRubricContent({ '5': 'five', '10': 'ten' }), '{"10":"ten","5":"five"}');
  assert.equal(bundle.guidances[0]?.content.scope.skillCode, 'n5_copula_affirmative');
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.policy.content.criteria.meaning.anchors), true);
  assert.equal(Object.isFrozen(bundle.sourceCorpus.sources), true);
  rejects(() => assertRubricBundle({ ...bundle }), 'UNTRUSTED_RUBRIC');
});

for (const status of ['DRAFT', 'RETIRED'] as const) {
  void test(`${status} document cannot activate for a new execution`, async () => {
    const { policy, documents, manifest } = await fixture();
    const body = JSON.stringify({
      ...policy,
      status,
      approval: status === 'DRAFT' ? null : policy.approval,
    });
    documents.set('policy.json', body);
    manifest.policy.sha256 = hash(body);

    rejects(() => parseRubricBundle(manifest, documents, sourceCorpus), 'UNTRUSTED_RUBRIC');
  });
}

for (const scenario of [
  'unknown reviewer',
  'unknown license',
  'review-only permission',
  'reviewed hash mismatch',
  'content mismatch',
  'full file mutation',
  'policy reference mismatch',
  'fake lesson owner',
  'source corpus mismatch',
  'source manifest mismatch',
] as const) {
  void test(`rubric activation rejects ${scenario}`, async () => {
    const { policy, guidance, documents, manifest } = await fixture();
    let changedPolicy: unknown = policy;
    let changedGuidance: unknown = guidance;
    let expected: RubricError['code'] = 'RUBRIC_INTEGRITY';

    switch (scenario) {
      case 'unknown reviewer':
        changedPolicy = {
          ...policy,
          approval: { ...policy.approval, approvedBy: 'self-asserted-reviewer' },
        };
        expected = 'UNTRUSTED_RUBRIC';
        break;
      case 'unknown license':
        changedPolicy = { ...policy, provenance: { ...policy.provenance, license: null } };
        expected = 'UNTRUSTED_RUBRIC';
        break;
      case 'review-only permission':
        changedPolicy = {
          ...policy,
          provenance: { ...policy.provenance, usageScope: 'DESIGN_REVIEW_ONLY' },
        };
        expected = 'UNTRUSTED_RUBRIC';
        break;
      case 'reviewed hash mismatch':
        changedPolicy = {
          ...policy,
          approval: { ...policy.approval, reviewedContentSha256: '0'.repeat(64) },
        };
        break;
      case 'content mismatch':
        changedPolicy = { ...policy, contentSha256: '0'.repeat(64) };
        break;
      case 'policy reference mismatch': {
        const content = {
          ...guidance.content,
          policyRef: { ...guidance.content.policyRef, revision: 9 },
        };
        changedGuidance = {
          ...guidance,
          content,
          contentSha256: hash(canonicalRubricContent(content)),
          approval: {
            ...guidance.approval,
            reviewedContentSha256: hash(canonicalRubricContent(content)),
          },
        };
        break;
      }
      case 'fake lesson owner': {
        const content = {
          ...guidance.content,
          scope: { ...guidance.content.scope, lessonSlug: 'fabricated-lesson' },
        };
        changedGuidance = {
          ...guidance,
          content,
          contentSha256: hash(canonicalRubricContent(content)),
          approval: {
            ...guidance.approval,
            reviewedContentSha256: hash(canonicalRubricContent(content)),
          },
        };
        expected = 'RUBRIC_SCOPE';
        break;
      }
      case 'source corpus mismatch':
        manifest.sourceCorpus.corpusVersion = 'wrong-version';
        break;
      case 'source manifest mismatch':
        manifest.sourceCorpus.manifestSha256 = '0'.repeat(64);
        break;
      case 'full file mutation':
        break;
    }

    documents.set('policy.json', JSON.stringify(changedPolicy));
    documents.set('guidance.json', JSON.stringify(changedGuidance));
    manifest.policy.sha256 = hash(documents.get('policy.json') ?? '');
    const guidanceRef = manifest.guidances[0];

    assert.ok(guidanceRef);

    guidanceRef.sha256 = hash(documents.get('guidance.json') ?? '');

    if (scenario === 'full file mutation') {
      documents.set('policy.json', `${documents.get('policy.json') ?? ''}\n`);
    }

    rejects(() => parseRubricBundle(manifest, documents, sourceCorpus), expected);
  });
}

for (const path of [
  '/outside.json',
  '../outside.json',
  'nested/../../outside.json',
  'nested\\outside.json',
  './policy.json',
  'a//b.json',
]) {
  void test(`manifest rejects unsafe path ${path}`, async () => {
    const { manifest } = await fixture();
    manifest.policy.path = path;

    rejects(() => parseRubricManifest(manifest), 'INVALID_RUBRIC');
  });
}

void test('loader rejects symlink escape and loads bounded contained approved documents', async () => {
  const { documents, manifest } = await fixture();
  const root = await mkdtemp(join(tmpdir(), 'uc02-rubric-loader-'));
  const outside = await mkdtemp(join(tmpdir(), 'uc02-rubric-outside-'));

  try {
    for (const [name, body] of documents) {
      await writeFile(join(root, name), body);
    }

    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));

    const bundle = await loadRubricBundle(
      join(root, 'manifest.json'),
      sourceCorpus,
      hash(JSON.stringify(manifest)),
    );

    await assert.rejects(
      loadRubricBundle(join(root, 'manifest.json'), sourceCorpus, '0'.repeat(64)),
      (error: unknown) => error instanceof RubricError && error.code === 'RUBRIC_INTEGRITY',
    );

    assert.equal(bundle.policy.id, 'kotobahub-free-response-translation');

    await writeFile(join(outside, 'outside.json'), documents.get('policy.json') ?? '');
    await symlink(resolve(outside, 'outside.json'), join(root, 'escape.json'));
    manifest.policy.path = 'escape.json';
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));

    await assert.rejects(
      loadRubricBundle(join(root, 'manifest.json'), sourceCorpus),
      (error: unknown) => error instanceof RubricError && error.code === 'INVALID_RUBRIC',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
