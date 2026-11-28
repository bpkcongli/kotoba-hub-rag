import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  admit,
  config,
  providerResponse,
  requestFor,
  setup,
  signal,
} from '@tests/__fixtures__/generation-fixture';
import { context, dense } from '@tests/__fixtures__/retrieval-fixture';
import { gradedAssessment, rubricFixture } from '@tests/__fixtures__/rubric-fixture';
import { createIngestionPlan } from '@/modules/knowledge/application/index-plan';
import { parseRubricBundle } from '@/modules/knowledge/application/rubric';
import { projectRubricCorpus } from '@/modules/knowledge/application/rubric-projection';
import { chunkLessons } from '@/modules/knowledge/application/services/chunker';
import { canonical, hash } from '@/modules/knowledge/application/validation';
import type {
  ApprovedCorpus,
  ChunkConfig,
  TokenCounter,
} from '@/modules/knowledge/domain/models/ingestion';
import { normalizeCorpus } from '@/modules/knowledge/interface/secondary/corpus/normalize';
import { QdrantIndexStore } from '@/modules/knowledge/interface/secondary/qdrant/qdrant-index';
import { buildContext } from '@/modules/rag/application/context/builder';
import { createOperationGenerator } from '@/modules/rag/application/generation/generator';
import { gradingBinding } from '@/modules/rag/application/generation/grading';
import { readContextConfig } from '@/modules/rag/infrastructure/config/context';
import { retrievalConfig } from '@/modules/rag/infrastructure/config/retrieval';
import { createQdrantRetriever } from '@/modules/rag/interface/secondary/qdrant/retriever';

const url = process.env.RAG01_QDRANT_URL;

assert.ok(url, 'Gunakan runner --rubric untuk Qdrant sementara');
assert.equal(new URL(url).hostname, '127.0.0.1');

const chunkConfig: ChunkConfig = {
  version: 'pedagogical-v1',
  unicode: 'NFC',
  maxTokens: 4096,
  overlapTokens: 96,
  overlapUnits: 2,
};
const counter: TokenCounter = {
  identity: { id: 'synthetic-counter', model: 'fixture', revision: '1', engine: 'fixture' },
  count: (text) =>
    Promise.resolve({
      content: Array.from(text).length,
      special: 2,
      total: Array.from(text).length + 2,
    }),
};

for (let fixtureIndex = 0; fixtureIndex < 4; fixtureIndex++) {
  await test(`UC-02 Qdrant nyata: approved guidance locale/level ${fixtureIndex}, filter policy dan grade publik`, async (t) => {
    const request = requestFor('evaluate', fixtureIndex);
    request.mode = 'SINGLE_STAGE';
    const draftBundle = rubricFixture(request);
    const originalOwner = draftBundle.sourceCorpus.sources[0];

    assert.ok(originalOwner);

    const locale = originalOwner.locale.toLowerCase();
    const grammarContent = {
      canonical: { grammar: { pattern: 'A は B です。', structureLines: ['A は B です。'] } },
      localized: {
        title: 'Synthetic copula',
        grammar: { meaning: 'Synthetic identity statement.' },
      },
    };
    const sourceCorpus: ApprovedCorpus = {
      ...draftBundle.sourceCorpus,
      sources: [
        {
          ...originalOwner,
          source_id: `kotobahub:skills:copula:${locale}`,
          parent_id: 'kotobahub:lessons:synthetic-lesson',
          content: grammarContent,
          content_checksum: hash(canonical(grammarContent)),
        },
      ],
    };
    const policyBody = JSON.stringify(draftBundle.policy);
    const guidanceBody = JSON.stringify(draftBundle.guidances[0]);
    const bundle = parseRubricBundle(
      {
        schemaVersion: 'uc-02-rubric-bundle-v1',
        corpusVersion: request.corpus_version,
        sourceCorpus: {
          corpusVersion: sourceCorpus.corpusVersion,
          manifestSha256: sourceCorpus.manifestSha256,
        },
        trustedReviewers: [{ id: 'synthetic-test-reviewer', role: 'TEST' }],
        policy: { path: 'policy.json', sha256: hash(policyBody) },
        guidances: [{ path: 'guidance.json', sha256: hash(guidanceBody) }],
      },
      new Map([
        ['policy.json', policyBody],
        ['guidance.json', guidanceBody],
      ]),
      sourceCorpus,
    );
    const corpus = projectRubricCorpus(bundle);
    const chunks = await chunkLessons(normalizeCorpus(corpus, chunkConfig), chunkConfig, counter);
    const plan = createIngestionPlan(
      { manifestSha256: hash('synthetic-preparation'), sources: corpus.sources, chunks },
      `uc02_${randomUUID().replaceAll('-', '')}`,
    );
    const rubricPoint = plan.points.find((point) => point.payload.content_type === 'RUBRIC');
    const grammarPoint = plan.points.find((point) => point.payload.content_type !== 'RUBRIC');

    assert.ok(rubricPoint?.payload.rubric);
    assert.ok(grammarPoint);

    const payload = rubricPoint.payload;
    const binding = rubricPoint.payload.rubric;
    const connection = { url, timeoutMs: 5000 };
    const store = new QdrantIndexStore(connection);
    const client = new QdrantClient({ ...connection, checkCompatibility: false });

    await store.prepare(plan.index);
    t.after(() => store.remove(plan.index));

    const mutations = [
      { locale: payload.locale === 'EN' ? 'ID' : 'EN' },
      { rubric: { ...binding, policyId: 'foreign-policy' } },
      { rubric: { ...binding, policyRevision: 999 } },
      { rubric: { ...binding, policyContentSha256: '0'.repeat(64) } },
      { corpus_version: 'legacy-corpus' },
      { jlpt_level: payload.jlpt_level === 'JLPT_N5' ? 'JLPT_N4' : 'JLPT_N5' },
      { skill_codes: ['foreign-skill'] },
      { published: false },
      { embedding_config_id: 'legacy-config' },
    ];

    await client.upsert(plan.index.physicalCollection, {
      wait: true,
      points: [
        { id: 1, vector: { dense: dense() }, payload: { ...payload } },
        { id: 2, vector: { dense: dense() }, payload: { ...grammarPoint.payload } },
        ...mutations.map((override, i) => ({
          id: i + 3,
          vector: { dense: dense() },
          payload: { ...payload, ...override },
        })),
      ],
    });

    const retriever = createQdrantRetriever(retrievalConfig(plan.index), connection);
    t.after(() => retriever.close());
    const result = await retriever.retrieve(
      { dense: dense() },
      {
        published: true,
        corpusVersion: request.corpus_version,
        targetLevel: payload.jlpt_level,
        skillCodes: [request.payload.question.skillCode],
        language: payload.locale === 'ID' ? 'ID' : 'EN',
        contentType: 'RUBRIC',
        policyRef: bundle.policyRef,
      },
      5,
      context(),
    );

    assert.deepEqual(
      result.candidates.map((row) => row.pointId),
      ['1'],
    );
    assert.equal(result.sparse, null);
    assert.equal(result.candidates[0]?.scoreType, 'cosine');
    assert.ok((result.candidates[0]?.score ?? 0) > 0.99);
    assert.deepEqual(gradingBinding(bundle, request, result.candidates), [
      { id: bundle.guidances[0]?.id, revision: 1, contentSha256: binding.guidanceContentSha256 },
    ]);

    const built = buildContext(
      readContextConfig({}, config()),
      'evaluate',
      request,
      result.candidates,
      [request.payload.question.skillCode],
      bundle,
    );

    assert.equal(built.status, 'READY');
    assert.deepEqual(built.sources, [{ source_id: payload.source_id, chunk_id: payload.chunk_id }]);
    assert.ok(built.trace.budget.evidenceTokens > 0);
    assert.ok(built.trace.budget.totalReservedTokens <= built.trace.budget.contextWindowTokens);

    let generationCalls = 0;
    const state = await setup(t, () => {
      generationCalls++;
      return Promise.resolve(
        providerResponse(gradedAssessment({ meaning: 60, grammar: 30, naturalness: 10 })),
      );
    });
    const generate = createOperationGenerator(state.provider, config(), bundle, state.observations);
    const executionId = await admit(state.observations, 'evaluate', request);
    const grade = await generate('evaluate', request, built.evidence, {
      executionId,
      signal,
      deadlineAt: request.deadline_at,
    });

    assert.deepEqual(grade.data, {
      numericScore: 100,
      isCorrect: true,
      feedbackText: 'Makna sumber terjaga; ungkapan Jepang dapat diterima.',
    });
    assert.equal(generationCalls, 1);

    const selected = result.candidates[0];
    assert.ok(selected);

    await assert.rejects(
      generate(
        'evaluate',
        request,
        [
          {
            ...selected,
            sourceId: 'forged-source',
          },
        ],
        { executionId, signal, deadlineAt: request.deadline_at },
      ),
      { code: 'INSUFFICIENT_EVIDENCE' },
    );
    assert.equal(generationCalls, 1);

    const empty = await retriever.retrieve(
      { dense: dense() },
      {
        published: true,
        corpusVersion: request.corpus_version,
        targetLevel: payload.jlpt_level,
        skillCodes: [request.payload.question.skillCode],
        language: payload.locale === 'ID' ? 'ID' : 'EN',
        contentType: 'RUBRIC',
        policyRef: { ...bundle.policyRef, revision: 998 },
      },
      5,
      context(),
    );

    assert.deepEqual(empty.candidates, []);
  });
}
