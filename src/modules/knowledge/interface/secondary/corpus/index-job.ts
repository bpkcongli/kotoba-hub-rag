import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { IngestionPlan } from '@/modules/knowledge/application/index-plan';
import { canonical } from '@/modules/knowledge/application/validation';
import { object } from '@/modules/knowledge/application/validation';
import { IndexingError } from '@/modules/knowledge/domain/exceptions/indexing-error';
import { readBounded } from '@/modules/knowledge/interface/secondary/corpus/index-plan';

export async function syncDirectory(path: string): Promise<void> {
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
