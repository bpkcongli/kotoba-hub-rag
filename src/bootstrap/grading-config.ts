import { resolve } from 'node:path';
import type { RubricBundle } from '@/modules/knowledge/application/public';
import { loadRubricBundle } from '@/modules/knowledge/interface/secondary/corpus/rubric-loader';
import { ConfigError } from '@/shared/errors/config-error';

export async function readGradingBundle(
  env: Readonly<Record<string, unknown>>,
): Promise<RubricBundle | null> {
  const path = env.UC02_RUBRIC_BUNDLE;
  const digest = env.UC02_RUBRIC_BUNDLE_SHA256;
  if (path === undefined && digest === undefined) {
    return null;
  }

  if (
    typeof path !== 'string' ||
    !path.trim() ||
    typeof digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(digest)
  ) {
    throw new ConfigError(['UC02_RUBRIC_BUNDLE', 'UC02_RUBRIC_BUNDLE_SHA256']);
  }

  try {
    return await loadRubricBundle(resolve(path), undefined, digest);
  } catch {
    throw new ConfigError(['UC02_RUBRIC_BUNDLE']);
  }
}
