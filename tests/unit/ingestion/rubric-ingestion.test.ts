import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fixturePlan } from '@tests/__fixtures__/indexing-fixture';
import { StoreError } from '@/modules/knowledge/application/index-manifest';
import { createIngestionPlan } from '@/modules/knowledge/application/index-plan';
import { parseKnowledgePayload } from '@/modules/knowledge/application/knowledge-payload';
import {
  parseRubricBundle,
  RubricError,
  canonicalRubricContent,
} from '@/modules/knowledge/application/rubric';
import {
  projectRubricCorpus,
  projectRubricGuidance,
} from '@/modules/knowledge/application/rubric-projection';
import { chunkLessons } from '@/modules/knowledge/application/services/chunker';
import { prepareFromInputs } from '@/modules/knowledge/application/services/preparation';
import { canonical, hash, parseSource } from '@/modules/knowledge/application/validation';
import type {
  ApprovedCorpus,
  ApprovedSource,
  ChunkConfig,
  TokenCounter,
} from '@/modules/knowledge/domain/models/ingestion';
import { IngestionError } from '@/modules/knowledge/domain/models/ingestion';
import type {
  GradingPolicy,
  RubricGuidance,
  RubricBundleManifest,
} from '@/modules/knowledge/domain/models/rubric';
import { loadPreparedCorpus } from '@/modules/knowledge/interface/secondary/corpus/index-plan';
import { normalizeCorpus } from '@/modules/knowledge/interface/secondary/corpus/normalize';
import { knowledgeFilter } from '@/modules/knowledge/interface/secondary/qdrant/knowledge-filter';

const config: ChunkConfig = {
  version: 'pedagogical-v1',
  unicode: 'NFC',
  maxTokens: 4096,
  overlapTokens: 96,
  overlapUnits: 2,
};
const counter: TokenCounter = {
  identity: { id: 'rubric-test', model: 'fixture', revision: '1', engine: 'fixture' },
  count: (text) =>
    Promise.resolve({
      content: Array.from(text).length,
      special: 2,
      total: Array.from(text).length + 2,
    }),
};

function fixture() {
  // These are test-only approval records; approved source files remain unchanged.
  const policyTemplate = JSON.parse(
    readFileSync('research/rubrics/uc-02-v1/policy.json', 'utf8'),
  ) as GradingPolicy;
  const guidanceTemplate = JSON.parse(
    readFileSync('research/rubrics/uc-02-v1/guidance-id-n5.json', 'utf8'),
  ) as RubricGuidance;
  const approval = (content: unknown) => ({
    approvedBy: 'test-reviewer',
    role: 'RESEARCHER',
    approvedAt: '2026-11-28T00:00:00Z',
    reviewedContentSha256: hash(canonicalRubricContent(content)),
  });
  const policy: GradingPolicy = {
    ...policyTemplate,
    status: 'APPROVED',
    approval: approval(policyTemplate.content),
    provenance: {
      ...policyTemplate.provenance,
      license: 'Test fixture internal use',
      usageScope: 'INTERNAL_RUNTIME',
    },
  };
  const guidance: RubricGuidance = {
    ...guidanceTemplate,
    status: 'APPROVED',
    approval: approval(guidanceTemplate.content),
    provenance: {
      ...guidanceTemplate.provenance,
      license: 'Test fixture internal use',
      usageScope: 'INTERNAL_RUNTIME',
    },
  };
  const base = fixturePlan(1).provenance[0]?.sources[0];

  assert.ok(base);

  const content = {
    canonical: { grammar: { pattern: 'A は B です。', structureLines: ['A は B です。'] } },
    localized: { title: 'Kopula', grammar: { meaning: 'Identitas afirmatif.' } },
  };
  const scope = guidance.content.scope;
  const owner: ApprovedSource = {
    ...base,
    source_id: 'kotobahub:skills:s0:id',
    track_slug: scope.trackSlug,
    unit_slug: scope.unitSlug,
    lesson_slug: scope.lessonSlug,
    skill_codes: [scope.skillCode],
    locale: 'ID',
    content,
    content_checksum: hash(canonical(content)),
  };
  const corpus: ApprovedCorpus = {
    corpusVersion: 'base-fixture-v1',
    manifestSha256: hash('base-manifest'),
    usagePolicySha256: hash('base-usage'),
    sources: [owner],
  };
  const documents = new Map([
    ['policy.json', canonical(policy)],
    ['guidance.json', canonical(guidance)],
  ]);
  const manifest: RubricBundleManifest = {
    schemaVersion: 'uc-02-rubric-bundle-v1',
    corpusVersion: 'rubric-fixture-v1',
    sourceCorpus: { corpusVersion: corpus.corpusVersion, manifestSha256: corpus.manifestSha256 },
    trustedReviewers: [{ id: 'test-reviewer', role: 'RESEARCHER' }],
    policy: { path: 'policy.json', sha256: hash(canonical(policy)) },
    guidances: [{ path: 'guidance.json', sha256: hash(canonical(guidance)) }],
  };

  return {
    owner,
    corpus,
    policy,
    guidance,
    manifest,
    documents,
    bundle: parseRubricBundle(manifest, documents, corpus),
  };
}

await test('UC-02: guidance projection binds actual eligible skill owner and reviewed provenance without policy lesson fiction', () => {
  const { bundle, owner, guidance } = fixture();

  const sources = projectRubricGuidance(bundle);
  const source = sources[0];

  assert.ok(source);

  assert.equal(sources.length, 1);
  assert.equal(source.source_table, 'rubric_guidance');
  assert.equal(source.content_type, 'RUBRIC');
  assert.equal(source.locale, 'ID');
  assert.equal(source.track_id, owner.track_id);
  assert.equal(source.unit_id, owner.unit_id);
  assert.equal(source.lesson_id, owner.lesson_id);
  assert.deepEqual(source.skill_codes, owner.skill_codes);
  assert.equal(source.parent_id, owner.parent_id);
  assert.equal(source.content_checksum, guidance.contentSha256);
  assert.deepEqual(source.content, guidance.content);
  assert.deepEqual(source.source_refs, guidance.provenance.sourceRefs);
  assert.equal(source.source_updated_at, guidance.approval?.approvedAt);
  assert.equal(parseSource(source), source);
  assert.throws(() => projectRubricGuidance(structuredClone(bundle)), RubricError);
});

await test('UC-02: combined rubric corpus is a new version and preserves prior sources without mutating the approved snapshot', () => {
  const { bundle, corpus } = fixture();
  const before = canonical(corpus);

  const combined = projectRubricCorpus(bundle);

  assert.equal(combined.corpusVersion, bundle.corpusVersion);
  assert.notEqual(combined.corpusVersion, corpus.corpusVersion);
  assert.notEqual(combined.manifestSha256, corpus.manifestSha256);
  assert.notEqual(combined.usagePolicySha256, corpus.usagePolicySha256);
  assert.deepEqual(combined.sources.slice(0, 1), corpus.sources);
  assert.equal(canonical(corpus), before);
  assert.deepEqual(combined, projectRubricCorpus(bundle));
});

await test('UC-02: guidance is an atomic canonical JSON chunk with exact reviewed hash and no grammar mixing', async () => {
  const { bundle, guidance } = fixture();
  const corpus = projectRubricCorpus(bundle);

  const prepared = await prepareFromInputs(corpus, config, counter, {}, normalizeCorpus);
  const plan = createIngestionPlan(
    {
      manifestSha256: hash(canonical(prepared.manifest)),
      chunks: prepared.chunks,
      sources: corpus.sources,
    },
    'rubric_test',
  );
  const rubric = plan.points.find((point) => point.payload.content_type === 'RUBRIC')?.payload;

  assert.ok(rubric);

  assert.equal(plan.points.length, 2);
  assert.equal(rubric.text, canonical(guidance.content));
  assert.equal(rubric.content_checksum, guidance.contentSha256);
  assert.equal(hash(rubric.text), guidance.contentSha256);
  assert.equal(rubric.rubric?.policyContentSha256, bundle.policyRef.contentSha256);
  assert.equal(rubric.rubric?.guidanceId, guidance.id);
  assert.equal(
    rubric.source_id,
    `kotobahub:rubric_guidance:${guidance.id}@${guidance.revision}:id`,
  );
  assert.equal(rubric.locale, 'ID');
  assert.equal(parseKnowledgePayload(rubric), rubric);

  for (const invalid of [
    { ...rubric, rubric: undefined },
    { ...rubric, content_type: 'PEDAGOGICAL_CHUNK' },
    { ...rubric, locale: 'EN' },
    { ...rubric, skill_codes: ['wrong-skill'] },
    { ...rubric, text: `${rubric.text}\n` },
    { ...rubric, learner_id: 'private' },
    { ...rubric, rubric: { ...rubric.rubric, policyId: 'other-policy' } },
    { ...rubric, rubric: { ...rubric.rubric, expected_route: 'DEEP' } },
  ]) {
    assert.throws(() => parseKnowledgePayload(invalid), StoreError);
  }

  assert.ok(
    plan.points.some(
      (point) =>
        point.payload.content_type === 'PEDAGOGICAL_CHUNK' && point.payload.rubric === undefined,
    ),
  );

  const lessons = normalizeCorpus(corpus, config);
  const rubricLesson = lessons.find((lesson) =>
    lesson.units.some((unit) => unit.kind === 'rubric'),
  );

  assert.ok(rubricLesson);
  assert.equal(rubricLesson.units.length, 1);

  await assert.rejects(
    chunkLessons([rubricLesson], { ...config, maxTokens: 32, overlapTokens: 0 }, counter),
    { code: 'ATOMIC_UNIT_TOO_LARGE' },
  );
});

await test('UC-02: content approval hash survives NFC config without changing decomposed kana', async () => {
  const input = fixture();
  const content = {
    ...input.guidance.content,
    semanticChecks: ['か\u3099 and が remain distinct representations.'],
  };
  const guidance = {
    ...input.guidance,
    content,
    contentSha256: hash(canonical(content)),
    approval: { ...input.guidance.approval, reviewedContentSha256: hash(canonical(content)) },
  };
  input.documents.set('guidance.json', canonical(guidance));
  const manifest = {
    ...input.manifest,
    guidances: [{ path: 'guidance.json', sha256: hash(canonical(guidance)) }],
  };
  const bundle = parseRubricBundle(manifest, input.documents, input.corpus);

  const prepared = await prepareFromInputs(
    projectRubricCorpus(bundle),
    config,
    counter,
    {},
    normalizeCorpus,
  );
  const chunk = prepared.chunks.find((value) =>
    value.sourceIds.some((id) => id.includes(':rubric_guidance:')),
  );

  assert.ok(chunk);

  assert.equal(chunk.text, canonical(content));
  assert.equal(chunk.contentChecksum, guidance.contentSha256);
  assert.ok(chunk.text.includes('か\u3099'));
});

await test('UC-02: strict rubric source guard rejects masquerading, scope/policy/hash drift and private evaluation keys', () => {
  const source = projectRubricGuidance(fixture().bundle)[0];

  assert.ok(source?.rubric);

  for (const invalid of [
    { ...source, source_table: 'lesson_content_blocks', sort_order: 1 },
    { ...source, content_type: 'GRAMMAR' },
    { ...source, rubric: undefined },
    { ...source, track_slug: 'wrong-track' },
    { ...source, locale: 'EN' },
    { ...source, skill_codes: ['wrong-skill'] },
    { ...source, rubric: { ...source.rubric, policyContentSha256: hash('wrong-policy') } },
    { ...source, rubric: { ...source.rubric, guidanceContentSha256: hash('wrong-guidance') } },
    { ...source, content: { ...source.content, evaluation_rubric: { label: 'secret' } } },
  ]) {
    assert.throws(() => parseSource(invalid), IngestionError);
  }
});

await test('UC-02: drafts, wrong canonical scope and unknown policy fail before corpus preparation', () => {
  const input = fixture();
  const draft = { ...input.guidance, status: 'DRAFT', approval: null };
  input.documents.set('guidance.json', canonical(draft));

  assert.throws(
    () =>
      parseRubricBundle(
        {
          ...input.manifest,
          guidances: [{ path: 'guidance.json', sha256: hash(canonical(draft)) }],
        },
        input.documents,
        input.corpus,
      ),
    RubricError,
  );
  assert.throws(
    () =>
      parseRubricBundle(
        input.manifest,
        new Map([
          ['policy.json', canonical(input.policy)],
          ['guidance.json', canonical(input.guidance)],
        ]),
        { ...input.corpus, sources: [{ ...input.owner, skill_codes: ['other'] }] },
      ),
    { code: 'RUBRIC_SCOPE' },
  );

  const changed = {
    ...input.guidance.content,
    policyRef: { ...input.bundle.policyRef, contentSha256: hash('other-policy') },
  };
  const wrong = {
    ...input.guidance,
    content: changed,
    contentSha256: hash(canonical(changed)),
    approval: { ...input.guidance.approval, reviewedContentSha256: hash(canonical(changed)) },
  };
  input.documents.set('guidance.json', canonical(wrong));

  assert.throws(
    () =>
      parseRubricBundle(
        {
          ...input.manifest,
          guidances: [{ path: 'guidance.json', sha256: hash(canonical(wrong)) }],
        },
        input.documents,
        input.corpus,
      ),
    { code: 'RUBRIC_INTEGRITY' },
  );
});

await test('UC-02: rubric retrieval requires exact locale/content type/policy binding while legacy filters remain unchanged', () => {
  const { bundle } = fixture();
  const manifest = fixturePlan(1).index;
  const base = {
    published: true,
    corpusVersion: manifest.corpusVersion,
    targetLevel: 'JLPT_N5',
    skillCodes: ['grammar-ni'],
  } as const;

  const legacy = knowledgeFilter(base, manifest);
  const scoped = knowledgeFilter(
    { ...base, language: 'ID', contentType: 'RUBRIC', policyRef: bundle.policyRef },
    manifest,
  );

  assert.ok(Array.isArray(legacy.must));
  assert.ok(Array.isArray(scoped.must));
  assert.equal(legacy.must.length, 5);
  assert.equal(scoped.must.length, 10);
  assert.ok(
    scoped.must?.some(
      (condition) => canonical(condition) === canonical({ key: 'locale', match: { value: 'ID' } }),
    ),
  );
  assert.ok(
    scoped.must?.some(
      (condition) =>
        canonical(condition) ===
        canonical({
          key: 'rubric.policyContentSha256',
          match: { value: bundle.policyRef.contentSha256 },
        }),
    ),
  );
  assert.throws(() => knowledgeFilter({ ...base, contentType: 'RUBRIC' }, manifest), StoreError);
  assert.throws(
    () => knowledgeFilter({ ...base, policyRef: bundle.policyRef }, manifest),
    StoreError,
  );
  assert.throws(
    () =>
      knowledgeFilter({ ...base, contentType: 'RUBRIC', policyRef: bundle.policyRef }, manifest),
    StoreError,
  );
});

await test('UC-02: prepared corpus pointer must pin the same explicitly supplied rubric bundle for ingestion and resume', async () => {
  const { bundle } = fixture();
  const root = await mkdtemp(resolve(tmpdir(), 'kotoba-rubric-pointer-'));
  const directory = resolve(root, 'research/chunking/revision');
  const manifest = '{}';
  const pinnedHash = hash('approved-bundle-manifest');

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'manifest.json'), manifest);
    await writeFile(
      resolve(directory, '../current.json'),
      JSON.stringify({
        preparationManifest: 'revision/manifest.json',
        manifestSha256: hash(manifest),
        usageScope: 'internal_research',
        publicRedistributionAuthorized: false,
        experimentFrozen: false,
        localOutputDirectory: 'artifacts/preparation',
        rubricBundleSha256: pinnedHash,
      }),
    );

    await assert.rejects(loadPreparedCorpus(root), { code: 'INTEGRITY_ERROR' });
    await assert.rejects(loadPreparedCorpus(root, bundle), { code: 'INTEGRITY_ERROR' });
    await assert.rejects(loadPreparedCorpus(root, bundle, hash('other-bundle')), {
      code: 'INTEGRITY_ERROR',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
