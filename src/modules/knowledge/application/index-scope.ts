import type { IndexManifest } from '@/modules/knowledge/application/index-manifest';
import { parseIndexManifest, StoreError } from '@/modules/knowledge/application/index-manifest';
import type { RetrievalFilter } from '@/modules/knowledge/domain/models/retrieval-filter';

export function validateKnowledgeScope(
  input: RetrievalFilter,
  value: IndexManifest,
): IndexManifest {
  const manifest = parseIndexManifest(value);

  if (
    input.published !== true ||
    input.corpusVersion !== manifest.corpusVersion ||
    !['JLPT_N5', 'JLPT_N4'].includes(input.targetLevel) ||
    input.skillCodes.length < 1 ||
    input.skillCodes.length > 64 ||
    input.skillCodes.some((code) => typeof code !== 'string' || !code.trim() || code.length > 128)
  ) {
    throw new StoreError('INVALID_CONTENT');
  }

  return manifest;
}
