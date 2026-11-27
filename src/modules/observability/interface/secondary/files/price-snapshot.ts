import { readFile } from 'node:fs/promises';
import { parsePriceSnapshot } from '@/modules/observability/application/accounting-schema';
import type { PriceSnapshot } from '@/modules/observability/domain/accounting-types';

export async function loadPriceSnapshot(
  path: URL | string = new URL('../../../../../../configs/pricing/obs-02-v1.json', import.meta.url),
): Promise<PriceSnapshot> {
  return parsePriceSnapshot(JSON.parse(await readFile(path, 'utf8')));
}
