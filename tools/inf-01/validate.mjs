import assert from 'node:assert/strict';

function object(value) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));

  return value;
}

// Normalized capture format for offline inspection, not a provider wire adapter.
export function validateHybridBatch(value, count, dimension = 1024, vocabularySize = 250002) {
  validateEmbeddingBatch(value, count, 'HYBRID', dimension, vocabularySize);
}

export function validateEmbeddingBatch(
  value,
  count,
  profile = 'DENSE',
  dimension = 1024,
  vocabularySize = 250002,
) {
  assert.ok(['DENSE', 'HYBRID'].includes(profile));
  assert.ok(Number.isSafeInteger(count) && count > 0);
  assert.ok(Number.isSafeInteger(dimension) && dimension > 0);
  assert.ok(Number.isSafeInteger(vocabularySize) && vocabularySize > 0);
  assert.ok(Array.isArray(value) && value.length === count);

  for (const item of value) {
    const vector = object(item);

    assert.ok(Array.isArray(vector.dense) && vector.dense.length === dimension);
    assert.ok(
      vector.dense.every((number) => typeof number === 'number' && Number.isFinite(number)),
    );
    assert.ok(vector.dense.some((number) => number !== 0));

    if (!Object.hasOwn(vector, 'sparse')) {
      assert.equal(profile, 'DENSE', 'HYBRID requires sparse for every item');

      continue;
    }

    const sparse = object(vector.sparse);

    assert.ok(Array.isArray(sparse.indices) && Array.isArray(sparse.values));
    assert.ok(sparse.indices.length > 0 && sparse.indices.length === sparse.values.length);
    assert.equal(new Set(sparse.indices).size, sparse.indices.length);
    assert.ok(
      sparse.indices.every((id) => Number.isSafeInteger(id) && id >= 0 && id < vocabularySize),
    );
    assert.ok(
      sparse.values.every(
        (weight) => typeof weight === 'number' && Number.isFinite(weight) && weight > 0,
      ),
    );
  }
}

// HF's documented dense feature-extraction response is a batch of float arrays.
export function parseHfDenseResponse(value, count) {
  assert.ok(Array.isArray(value));

  const batch = value.map((dense) => ({ dense }));

  validateEmbeddingBatch(batch, count, 'DENSE');

  return batch;
}

export function validateRerank(value, candidateIds) {
  assert.ok(Array.isArray(candidateIds) && candidateIds.length > 0);
  assert.ok(candidateIds.every((id) => typeof id === 'string' && id.length > 0));
  assert.equal(new Set(candidateIds).size, candidateIds.length);
  assert.ok(Array.isArray(value) && value.length === candidateIds.length);

  const seen = new Set();

  for (const item of value) {
    const result = object(item);

    assert.ok(candidateIds.includes(result.chunkId) && !seen.has(result.chunkId));
    assert.ok(typeof result.score === 'number' && Number.isFinite(result.score));

    seen.add(result.chunkId);
  }
}

export function validateDiscovery(value) {
  const discovery = object(value);

  assert.equal(discovery.kind, 'PUBLIC_DISCOVERY_NOT_INFERENCE');
  assert.equal(discovery.inferenceCalls, 0);
  assert.ok(Array.isArray(discovery.records) && discovery.records.length === 3);

  for (const record of discovery.records) {
    assert.equal(record.outcome, 'success');
    assert.equal(record.httpStatus, 200);
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(record.elapsedMs) && record.elapsedMs >= 0);
    assert.ok(Number.isFinite(Date.parse(record.retrievedAt)));
    object(record.data);
  }

  for (const [index, id] of ['BAAI/bge-m3', 'BAAI/bge-reranker-v2-m3'].entries()) {
    const record = discovery.records[index];

    assert.equal(new URL(record.url).origin, 'https://huggingface.co');
    assert.equal(new URL(record.url).pathname, `/api/models/${id}`);
    assert.equal(record.data.id, id);
    assert.match(record.data.sha, /^[a-f0-9]{40}$/);
    object(record.data.inferenceProviderMapping);
  }

  const pull = discovery.records[2];

  assert.equal(
    pull.url,
    'https://api.github.com/repos/huggingface/text-embeddings-inference/pulls/899',
  );
  assert.equal(pull.data.number, 899);
  assert.ok(['open', 'closed'].includes(pull.data.state));
  assert.equal(typeof pull.data.merged, 'boolean');
}

// This verifier covers the audit-only artifact version; it cannot certify a live provider.
export function validateAudit(manifest, discovery, fixtures) {
  validateDiscovery(discovery);

  assert.equal(manifest.task, 'INF-01');
  assert.equal(manifest.status, 'AUDIT_ONLY_NOT_READY');

  assert.deepEqual(manifest.authorization, {
    scope: 'PUBLIC_AUDIT_AND_OFFLINE_TOOLING_ONLY',
    inferenceCallsAllowed: 0,
    paidBudgetUsd: 0,
    provisioningAllowed: false,
  });
  assert.equal(manifest.inferenceCalls, 0);
  assert.equal(manifest.readyForFreeze, false);
  assert.deepEqual(manifest.selected, { embedding: null, reranker: null });
  assert.ok(Array.isArray(manifest.openGates) && manifest.openGates.length > 0);

  for (const record of discovery.records.slice(0, 2)) {
    assert.equal(manifest.hubRevisions[record.data.id], record.data.sha);
  }

  assert.ok(Array.isArray(manifest.candidates) && manifest.candidates.length > 0);
  assert.equal(
    new Set(manifest.candidates.map((candidate) => candidate.id)).size,
    manifest.candidates.length,
  );

  for (const candidate of manifest.candidates) {
    assert.ok(['embedding', 'reranker'].includes(candidate.operation));
    assert.equal(
      candidate.model,
      candidate.operation === 'embedding' ? 'BAAI/bge-m3' : 'BAAI/bge-reranker-v2-m3',
    );
    assert.equal(candidate.selection, 'NOT_SELECTED');
    assert.equal(candidate.inferenceEvidence, null);
    assert.ok(Object.keys(object(candidate.observed)).length > 0);
    assert.ok(Object.values(candidate.observed).every((value) => value === null));
    assert.ok(Array.isArray(candidate.sources) && candidate.sources.length > 0);

    for (const source of candidate.sources) {
      const reference = object(manifest.sources[source]);

      assert.equal(reference.kind, 'PUBLIC_DOCUMENTATION');
      assert.equal(new URL(reference.url).protocol, 'https:');
    }
  }

  assert.equal(fixtures.kind, 'INFRASTRUCTURE_SMOKE_ONLY_NOT_RESEARCH_DATASET');
  assert.deepEqual(fixtures.languages, ['JA', 'EN', 'ID']);
  assert.equal(fixtures.embedding.length, 6);
  assert.equal(fixtures.rerank.length, 3);
  assert.equal(fixtures.expectedShape.denseDimension, 1024);
  assert.equal(fixtures.expectedShape.sparseVocabularyUpperBoundExclusive, 250002);
  assert.equal(fixtures.expectedShape.doesNotProveTokenizerMapping, true);
  assert.equal(fixtures.futureSmokePolicy.currentlyExecutable, false);
  assert.equal(fixtures.futureSmokePolicy.authorizationRequired, true);
  assert.equal(fixtures.futureSmokePolicy.automaticRetries, 0);

  for (const language of fixtures.languages) {
    for (const purpose of ['query', 'document']) {
      const items = fixtures.embedding.filter(
        (item) => item.language === language && item.purpose === purpose,
      );

      assert.equal(items.length, 1);
      assert.ok(typeof items[0].text === 'string' && items[0].text.length > 0);
    }

    const cases = fixtures.rerank.filter((item) => item.language === language);

    assert.equal(cases.length, 1);
    assert.ok(typeof cases[0].query === 'string' && cases[0].query.length > 0);
    assert.equal(cases[0].candidates.length, 2);
    assert.equal(new Set(cases[0].candidates.map((candidate) => candidate.chunkId)).size, 2);
  }
}

export function validateDenseDecision(manifest, decision, template, baseTemplate) {
  assert.equal(manifest.artifactVersion, 2);
  assert.equal(manifest.status, 'DECIDED_NOT_VERIFIED');
  assert.equal(manifest.decisionId, 'DOC-INF-03');
  assert.equal(manifest.protocolId, 'kotobahub-rag-protocol-v2-dense');
  assert.equal(manifest.inferenceCalls, 0);
  assert.equal(manifest.readyForFreeze, false);
  assert.equal(manifest.sparseGateApplicable, false);

  assert.deepEqual(manifest.authorization, {
    scope: 'PUBLIC_AUDIT_AND_OFFLINE_TOOLING_ONLY',
    inferenceCallsAllowed: 0,
    paidBudgetUsd: 0,
    provisioningAllowed: false,
  });

  const policy = {
    profile: 'DENSE',
    sparseEnabled: false,
    sparseCapability: 'OPTIONAL',
    fusion: null,
    sharedAcrossRagModes: true,
    automaticDowngrade: false,
    activationRequiresNewProtocolAndCohort: true,
  };

  assert.deepEqual(manifest.retrieval, policy);
  assert.deepEqual(decision.retrieval, policy);
  assert.deepEqual(template.retrieval, policy);

  assert.equal(decision.decisionId, manifest.decisionId);
  assert.equal(decision.protocolId, manifest.protocolId);
  assert.equal(decision.status, 'PLANNING_NOT_FROZEN');
  assert.equal(decision.readyForFreeze, false);
  assert.equal(decision.provider, 'hf-inference');
  assert.equal(decision.baseProtocolId, 'kotobahub-rag-protocol-v1');
  assert.deepEqual(Object.keys(object(decision.baseArtifacts)).sort(), [
    'research/protocol-v1/manifest.template.json',
    'research/protocol-v1/plan.json',
  ]);

  for (const checksum of Object.values(decision.baseArtifacts)) {
    assert.match(checksum, /^[a-f0-9]{64}$/);
  }

  for (const operation of ['embedding', 'reranker']) {
    const model = operation === 'embedding' ? 'BAAI/bge-m3' : 'BAAI/bge-reranker-v2-m3';

    assert.deepEqual(manifest.selected[operation], {
      provider: 'hf-inference',
      model,
      verification: 'PENDING',
      endpoint: null,
      servedRevision: null,
    });
    assert.equal(decision.models[operation], model);
  }

  assert.equal(template.protocol_id, manifest.protocolId);
  assert.equal(template.kind, 'TEMPLATE_NOT_RUNNABLE');
  assert.equal(template.frozen_at_utc, null);
  assert.equal(template.paid_scope_budget_approval, null);
  assert.deepEqual(template.controls.retrieval_profile_by_mode, {
    SINGLE_STAGE: 'DENSE',
    ADAPTIVE: 'DENSE',
  });
  assert.equal(template.controls.initial_embedding_shared_between_rag_modes, true);
  assert.equal(template.controls.max_retrieval_stages, 2);
  assert.equal(template.controls.max_rewrite_calls, 1);

  for (const operation of ['document_embedding', 'query_embedding', 'rerank']) {
    const provider = template.provider_operations[operation];

    assert.equal(provider.provider, 'hf-inference');
    assert.equal(provider.model_revision, null);
    assert.equal(provider.capability_evidence, null);
  }

  // Preserve research quantities, primary criteria, accounting and existing controls.
  for (const key of ['dataset', 'evaluation', 'cost', 'models_configured']) {
    assert.deepEqual(template[key], baseTemplate[key]);
  }

  const { retrieval_profile_by_mode: profiles, ...controls } = template.controls;

  assert.deepEqual(controls, baseTemplate.controls);
  assert.ok(profiles);
}
