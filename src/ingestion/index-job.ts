import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { EMBEDDING_CONFIG_ID } from '@/adapters/bge-configuration';
import { validateEmbeddingBatch } from '@/adapters/hf-validation';
import type { IngestionPlan } from '@/ingestion/index-plan';
import { IndexingError, readBounded } from '@/ingestion/index-plan';
import { canonical, hash, object } from '@/ingestion/validation';
import type { CallContext, EmbeddingPort, EmbeddingVector } from '@/shared/ports';
import type { IndexManifest } from '@/storage/index-manifest';
import type { IndexPoint, IndexValidation } from '@/storage/qdrant-index';

export interface IndexStorePort {
  prepare(manifest: IndexManifest): Promise<unknown>;
  assertWritable(manifest: IndexManifest): Promise<void>;
  upsert(manifest: IndexManifest, points: readonly IndexPoint[]): Promise<void>;
  validate(manifest: IndexManifest): Promise<IndexValidation>;
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r');

  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function durableWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);

  try {
    await file.writeFile(canonical(value) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }

  await rename(temporary, path);
  await syncDirectory(dirname(path));
}

export async function appendJournal(
  directory: string,
  event: Readonly<Record<string, unknown>>,
): Promise<void> {
  const file = await open(resolve(directory, 'journal.jsonl'), 'a', 0o600);

  try {
    await file.writeFile(canonical({ ...event, timestamp: new Date().toISOString() }) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }

  await syncDirectory(directory);
}

export async function createIndexJob(directory: string, plan: IngestionPlan): Promise<void> {
  await mkdir(resolve(directory, '..'), { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  await durableWrite(resolve(directory, 'plan.json'), plan);
  await syncDirectory(dirname(directory));
}

export async function readJournal(directory: string): Promise<readonly Record<string, unknown>[]> {
  let body: string;

  try {
    body = await readBounded(resolve(directory, 'journal.jsonl'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  if (!body.endsWith('\n')) {
    throw new IndexingError('INVALID_JOURNAL');
  }

  try {
    return body
      .trim()
      .split('\n')
      .map((line) => object(JSON.parse(line)));
  } catch {
    throw new IndexingError('INVALID_JOURNAL');
  }
}

export async function runIndexJob(options: {
  readonly directory: string;
  readonly plan: IngestionPlan;
  readonly store: IndexStorePort;
  readonly embedding: EmbeddingPort;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly maxNewBatches: number;
}) {
  const { directory, plan, store } = options;
  const planHash = hash(canonical(plan));

  if (
    canonical(JSON.parse(await readBounded(resolve(directory, 'plan.json')))) !== canonical(plan) ||
    plan.index.retrievalProfile !== 'DENSE' ||
    plan.index.embeddingConfigId !== EMBEDDING_CONFIG_ID ||
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 120000 ||
    !Number.isInteger(options.maxNewBatches) ||
    options.maxNewBatches < 0 ||
    options.maxNewBatches > 100000
  ) {
    throw new IndexingError('INVALID_PLAN');
  }

  let lock;

  try {
    lock = await open(resolve(directory, '.lock'), 'wx', 0o600);
  } catch {
    throw new IndexingError('JOB_LOCKED');
  }

  const executionId = randomUUID();
  let newBatches = 0;
  let completedPoints = 0;
  let outcome = 'FAILED';
  let validation: IndexValidation | null = null;
  let failure: Error | null = null;
  let journalValid = false;

  try {
    await lock.writeFile(canonical({ executionId, pid: process.pid }));
    await lock.sync();

    const previous = await readJournal(directory);

    if (previous.some((event) => event.planHash !== planHash)) {
      throw new IndexingError('INVALID_JOURNAL');
    }

    journalValid = true;
    await appendJournal(directory, { kind: 'run_started', executionId, planHash });
    await store.prepare(plan.index);
    await store.assertWritable(plan.index);

    for (let offset = 0; offset < plan.points.length; offset += plan.batchSize) {
      if (options.signal.aborted) {
        throw new Error('CANCELLED');
      }

      const batch = plan.points.slice(offset, offset + plan.batchSize);
      const chunkIds = batch.map((point) => point.payload.chunk_id);
      const cachePath = resolve(directory, `vectors-${offset}.json`);
      let vectors: readonly EmbeddingVector[];
      let cached: string | null = null;

      try {
        cached = await readBounded(cachePath, 4 * 1024 * 1024);
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
          throw error;
        }
      }

      if (cached !== null) {
        const record = object(JSON.parse(cached));
        const receipt = [...previous]
          .reverse()
          .find(
            (event) =>
              (event.kind === 'vectors_saved' || event.kind === 'vectors_recovered') &&
              event.offset === offset,
          );

        if (
          record.planHash !== planHash ||
          canonical(record.chunkIds) !== canonical(chunkIds) ||
          (receipt !== undefined && receipt.sha256 !== hash(cached))
        ) {
          throw new IndexingError('INTEGRITY_ERROR');
        }

        vectors = validateEmbeddingBatch(record.vectors, batch.length, 'DENSE').map(
          ({ dense }) => ({ dense }),
        );

        if (receipt === undefined) {
          const origin = [...previous]
            .reverse()
            .find((event) => event.kind === 'embedding_started' && event.offset === offset);

          if (origin === undefined) {
            throw new IndexingError('INTEGRITY_ERROR');
          }

          await appendJournal(directory, {
            kind: 'vectors_recovered',
            executionId,
            planHash,
            offset,
            originExecutionId: origin.executionId,
            sha256: hash(cached),
          });
        }
      } else {
        if (newBatches >= options.maxNewBatches) {
          throw new IndexingError('CALL_BUDGET_EXHAUSTED');
        }

        const pending = [...previous]
          .reverse()
          .find((event) => event.kind === 'embedding_started' && event.offset === offset);

        if (pending) {
          await appendJournal(directory, {
            kind: 'prior_result_unavailable',
            executionId,
            planHash,
            offset,
            priorExecutionId: pending.executionId,
            remoteOutcome: 'unknown',
            costUsd: null,
          });
        }

        const context: CallContext = {
          executionId,
          signal: options.signal,
          deadlineAt: new Date(Date.now() + options.timeoutMs).toISOString(),
        };

        // Write intent before network I/O so a crash cannot erase a potentially billed call.
        await appendJournal(directory, {
          kind: 'embedding_started',
          executionId,
          planHash,
          offset,
          chunkIds,
          purpose: 'document',
          usage: null,
          costUsd: null,
        });
        newBatches++;

        vectors = validateEmbeddingBatch(
          await options.embedding.embed(
            batch.map((point) => point.payload.text),
            'document',
            context,
          ),
          batch.length,
          'DENSE',
        ).map(({ dense }) => ({ dense }));
        await durableWrite(cachePath, { planHash, chunkIds, vectors });
        await appendJournal(directory, {
          kind: 'vectors_saved',
          executionId,
          planHash,
          offset,
          sha256: hash(await readFile(cachePath)),
        });
      }

      const points = batch.map((point, index) => {
        const vector = vectors[index];

        if (!vector) {
          throw new IndexingError('INTEGRITY_ERROR');
        }

        return { id: point.id, payload: { ...point.payload }, vector };
      });

      // Replay cached vectors too: a lost Qdrant acknowledgement or deleted candidate can
      // be repaired without re-embedding. Deterministic IDs make each replay idempotent.
      await appendJournal(directory, {
        kind: 'upsert_started',
        executionId,
        planHash,
        offset,
        chunkIds,
      });
      await store.upsert(plan.index, points);
      completedPoints += batch.length;
      await appendJournal(directory, {
        kind: 'upsert_completed',
        executionId,
        planHash,
        offset,
        chunkIds,
      });
    }

    validation = await store.validate(plan.index);
    outcome = plan.selection.kind === 'ALL' ? 'VALIDATED_CANDIDATE' : 'VALIDATED_SMOKE_CANDIDATE';
  } catch (error) {
    failure = error instanceof Error ? error : new Error('INDEXING_FAILED');
  } finally {
    try {
      if (journalValid) {
        await appendJournal(directory, {
          kind: 'run_finished',
          executionId,
          planHash,
          outcome,
          completedPoints,
          errorCode:
            failure && typeof failure === 'object' && 'code' in failure
              ? failure.code
              : failure
                ? 'INDEXING_FAILED'
                : null,
        });
        const journal = await readJournal(directory);
        const starts = journal.filter((event) => event.kind === 'embedding_started');
        const attempts = journal.filter((event) => event.kind === 'provider_attempt');
        const report = {
          schemaVersion: 'data-03-report-v1',
          executionId,
          planHash,
          outcome,
          physicalCollection: plan.index.physicalCollection,
          index: plan.index,
          preparationManifestSha256: plan.preparationManifestSha256,
          embeddingConfiguration: plan.embeddingConfiguration,
          validation,
          selection: plan.selection,
          completedPoints,
          newBatches,
          totalEmbeddingBatchIntents: starts.length,
          providerAttemptCount: attempts.length,
          unresolvedBatchResults: starts.filter(
            (start) =>
              !journal.some(
                (event) =>
                  event.offset === start.offset &&
                  ((event.kind === 'vectors_saved' && event.executionId === start.executionId) ||
                    (event.kind === 'vectors_recovered' &&
                      event.originExecutionId === start.executionId)),
              ),
          ).length,
          indexingCostUsd: starts.length === 0 ? 0 : null,
          providerUsage: null,
          knownCostCoverage: starts.length === 0 ? null : 0,
          accountingScope: 'document_indexing_only_excludes_query_rerank_judge_hosting',
          experimentFrozen: false,
          promotionEligible:
            plan.selection.kind === 'ALL' && validation?.modelRevisionsRecorded === true,
        };

        await durableWrite(resolve(directory, 'report.json'), report);
        await durableWrite(resolve(directory, `report-${executionId}.json`), report);
      }
    } finally {
      await lock.close();
      await rm(resolve(directory, '.lock'));
      await syncDirectory(directory);
    }
  }

  if (failure) {
    throw failure;
  }

  return validation;
}
