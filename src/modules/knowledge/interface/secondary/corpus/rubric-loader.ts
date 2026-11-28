import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  parseRubricBundle,
  parseRubricManifest,
  RubricError,
} from '@/modules/knowledge/application/rubric';
import { hash } from '@/modules/knowledge/application/validation';
import type { ApprovedCorpus } from '@/modules/knowledge/domain/models/ingestion';
import type { RubricBundle } from '@/modules/knowledge/domain/models/rubric';
import { loadApprovedCorpus } from '@/modules/knowledge/interface/secondary/corpus/corpus-loader';

async function boundedRead(path: string): Promise<Buffer> {
  if ((await stat(path)).size > 2 * 1024 * 1024) {
    throw new RubricError('INVALID_RUBRIC');
  }

  const body = await readFile(path);

  if (body.byteLength > 2 * 1024 * 1024) {
    throw new RubricError('INVALID_RUBRIC');
  }

  return body;
}

export async function loadRubricBundle(
  manifestPath: string,
  sourceCorpus?: ApprovedCorpus,
  expectedManifestSha256?: string,
): Promise<RubricBundle> {
  const path = await realpath(manifestPath);
  const root = dirname(path);
  const manifestBody = await boundedRead(path);

  if (expectedManifestSha256 !== undefined && hash(manifestBody) !== expectedManifestSha256) {
    throw new RubricError('RUBRIC_INTEGRITY');
  }

  const manifest = parseRubricManifest(JSON.parse(manifestBody.toString('utf8')) as unknown);
  const documents = new Map<string, string>();

  for (const entry of [manifest.policy, ...manifest.guidances]) {
    const documentPath = await realpath(resolve(root, entry.path));

    if (!documentPath.startsWith(`${root}${sep}`)) {
      throw new RubricError('INVALID_RUBRIC');
    }

    const documentBody = await boundedRead(documentPath);

    if (hash(documentBody) !== entry.sha256) {
      throw new RubricError('RUBRIC_INTEGRITY');
    }

    documents.set(entry.path, documentBody.toString('utf8'));
  }

  return parseRubricBundle(
    manifest,
    documents,
    sourceCorpus ?? (await loadApprovedCorpus(process.cwd())),
  );
}
