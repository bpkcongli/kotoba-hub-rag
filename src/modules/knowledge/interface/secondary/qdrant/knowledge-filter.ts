import type { Schemas } from '@qdrant/js-client-rest';
import type { IndexManifest } from '@/modules/knowledge/application/index-manifest';
import { validateKnowledgeScope } from '@/modules/knowledge/application/index-scope';
import type { RetrievalFilter } from '@/modules/knowledge/domain/models/retrieval-filter';

export function knowledgeFilter(input: RetrievalFilter, value: IndexManifest): Schemas['Filter'] {
  const manifest = validateKnowledgeScope(input, value);

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
