import { randomUUID } from 'node:crypto';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function ensureDirectory(directory: string): Promise<void> {
  const firstCreated = await mkdir(directory, { recursive: true, mode: 0o700 });
  let current = resolve(directory);
  const stop = firstCreated === undefined ? current : dirname(resolve(firstCreated));

  // Sync every newly created ancestor, including its directory entry in the existing parent.
  while (current !== stop) {
    await syncDirectory(current);
    current = dirname(current);
  }

  await syncDirectory(stop);
}

// Publish a complete immutable file without overwriting an existing admission/result.
export async function publishJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);

  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
    await link(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await handle.close();
    await unlink(temporary);
  }
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
