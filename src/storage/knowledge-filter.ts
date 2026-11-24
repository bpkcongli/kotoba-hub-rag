import type { Schemas } from '@qdrant/js-client-rest';
import type { RetrievalFilter } from '@/shared/ports';
import { parseIndexManifest, StoreError } from '@/storage/index-manifest';
import type { IndexManifest } from '@/storage/index-manifest';

export function knowledgeFilter(input: RetrievalFilter, value: IndexManifest): Schemas['Filter'] {
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

  return {
    must: [
      { key: 'published', match: { value: true } },
      { key: 'corpus_version', match: { value: manifest.corpusVersion } },
      { key: 'jlpt_level', match: { value: input.targetLevel } },
      { key: 'skill_codes', match: { any: [...new Set(input.skillCodes)] } },
      { key: 'embedding_config_id', match: { value: manifest.embeddingConfigId } },
    ],
  };
}
