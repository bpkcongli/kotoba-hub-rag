import type { Schemas } from '@qdrant/js-client-rest';
import type { IndexManifest, RetrievalFilter } from '@/modules/knowledge/application/public';
import { validateKnowledgeScope } from '@/modules/knowledge/application/public';

export function knowledgeFilter(input: RetrievalFilter, value: IndexManifest): Schemas['Filter'] {
  const manifest = validateKnowledgeScope(input, value);

  return {
    must: [
      { key: 'published', match: { value: true } },
      { key: 'corpus_version', match: { value: manifest.corpusVersion } },
      { key: 'jlpt_level', match: { value: input.targetLevel } },
      { key: 'skill_codes', match: { any: [...new Set(input.skillCodes)] } },
      { key: 'embedding_config_id', match: { value: manifest.embeddingConfigId } },
      ...(input.language === undefined
        ? []
        : [{ key: 'locale', match: { value: input.language } }]),
      ...(input.contentType === undefined
        ? []
        : [{ key: 'content_type', match: { value: input.contentType } }]),
      ...(input.policyRef === undefined
        ? []
        : [
            { key: 'rubric.policyId', match: { value: input.policyRef.id } },
            { key: 'rubric.policyRevision', match: { value: input.policyRef.revision } },
            { key: 'rubric.policyContentSha256', match: { value: input.policyRef.contentSha256 } },
          ]),
    ],
  };
}
