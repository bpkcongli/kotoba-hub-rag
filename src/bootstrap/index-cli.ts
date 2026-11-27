import { resolve } from 'node:path';
import { readQdrantConfig } from '@/modules/knowledge/application/connection-settings';
import { parseIndexManifest, StoreError } from '@/modules/knowledge/application/index-manifest';
import { canonical, hash, object, string } from '@/modules/knowledge/application/validation';
import { IndexingError } from '@/modules/knowledge/domain/exceptions/indexing-error';
import { runIndexJob } from '@/modules/knowledge/infrastructure/di/index';
import {
  appendJournal,
  createIndexJob,
} from '@/modules/knowledge/interface/secondary/corpus/index-job';
import {
  currentIngestionPlan,
  readBounded,
} from '@/modules/knowledge/interface/secondary/corpus/index-plan';
import { QdrantIndexStore } from '@/modules/knowledge/interface/secondary/qdrant/qdrant-index';
import { readHfConfig } from '@/modules/rag/infrastructure/config/hf-config';
import { createHfInference } from '@/modules/rag/interface/secondary/inference/hf-inference';
import { ConfigError } from '@/shared/errors/config-error';
import { InferenceError } from '@/shared/errors/inference-error';

async function main(): Promise<void> {
  const [action, ...args] = process.argv.slice(2);
  const allowed: Readonly<Record<string, readonly string[]>> = {
    plan: ['--job', '--revision', '--batch-size', '--sample-size'],
    run: ['--job', '--max-new-calls'],
    validate: ['--job'],
    promote: ['--job', '--alias'],
  };
  const flags = action ? allowed[action] : undefined;
  const options = new Map<string, string>();

  if (!flags || !action) {
    throw new IndexingError('INVALID_PLAN');
  }

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];

    if (!key || !flags.includes(key) || !value || value.startsWith('--') || options.has(key)) {
      throw new IndexingError('INVALID_PLAN');
    }

    options.set(key, value);
  }

  const directory = resolve(string(options.get('--job')));
  const integer = (value: string | undefined, fallback?: number): number => {
    if (value === undefined && fallback !== undefined) {
      return fallback;
    }

    if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new IndexingError('INVALID_PLAN');
    }

    return Number(value);
  };

  if (action === 'plan') {
    const plan = await currentIngestionPlan(
      resolve('.'),
      string(options.get('--revision')),
      integer(options.get('--batch-size'), 1),
      options.has('--sample-size') ? integer(options.get('--sample-size')) : null,
    );

    await createIndexJob(directory, plan);
    process.stdout.write(
      JSON.stringify({ status: 'PLANNED_OFFLINE', index: plan.index, batchSize: plan.batchSize }) +
        '\n',
    );

    return;
  }

  const raw = object(JSON.parse(await readBounded(resolve(directory, 'plan.json'))));
  const index = parseIndexManifest(raw.index);

  if (typeof raw.batchSize !== 'number') {
    throw new IndexingError('INVALID_PLAN');
  }

  const selection = object(raw.selection);

  if (selection.sampleSize !== null && typeof selection.sampleSize !== 'number') {
    throw new IndexingError('INVALID_PLAN');
  }

  const plan = await currentIngestionPlan(
    resolve('.'),
    index.indexRevision,
    raw.batchSize,
    selection.sampleSize,
  );

  if (canonical(raw) !== canonical(plan)) {
    throw new IndexingError('INTEGRITY_ERROR');
  }

  const storage = readQdrantConfig(process.env);

  if (!storage) {
    throw new ConfigError(['QDRANT_ENABLED']);
  }

  const store = new QdrantIndexStore(storage);

  if (action === 'promote' && plan.selection.kind !== 'ALL') {
    throw new StoreError('UNSAFE_LIFECYCLE');
  }

  if (action === 'validate' || action === 'promote') {
    const result =
      action === 'validate'
        ? await store.validate(plan.index)
        : await store.promote(plan.index, string(options.get('--alias')));

    process.stdout.write(JSON.stringify(result) + '\n');

    return;
  }

  const maxNewBatches = integer(options.get('--max-new-calls'));
  const config = readHfConfig(process.env);

  if (!config) {
    throw new ConfigError(['HF_INFERENCE_ENABLED']);
  }

  if (
    config.profile !== 'DENSE' ||
    plan.batchSize > config.embeddingBatchSize ||
    plan.batchSize > config.maxItems ||
    plan.points.some((point) => point.payload.text.length > config.maxTextChars)
  ) {
    throw new IndexingError('INVALID_PLAN');
  }

  const planHash = hash(canonical(plan));
  const hf = createHfInference(config, {
    onAttempt: async (attempt) => {
      await appendJournal(directory, {
        kind: 'provider_attempt',
        planHash,
        executionId: attempt.executionId,
        attempt,
      });
    },
  });
  const controller = new AbortController();
  const cancel = (): void => controller.abort();

  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);

  try {
    const result = await runIndexJob({
      directory,
      plan,
      store,
      embedding: hf.embedding,
      signal: controller.signal,
      timeoutMs: config.timeoutMs,
      maxNewBatches,
    });

    process.stdout.write(
      JSON.stringify({
        status: plan.selection.kind === 'ALL' ? 'VALIDATED_CANDIDATE' : 'VALIDATED_SMOKE_CANDIDATE',
        validation: result,
      }) + '\n',
    );
  } finally {
    hf.close();
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

void main().catch((error: unknown) => {
  const code =
    error instanceof IndexingError || error instanceof StoreError || error instanceof InferenceError
      ? error.code
      : error instanceof ConfigError
        ? 'INVALID_CONFIG'
        : 'INDEXING_FAILED';

  process.stderr.write(JSON.stringify({ error: code }) + '\n');
  process.exitCode = 1;
});
