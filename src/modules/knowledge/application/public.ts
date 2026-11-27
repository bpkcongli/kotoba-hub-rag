// Public application facade: explicit operations and boundary data only.
export {
  readQdrantConfig,
  type QdrantConfig,
} from '@/modules/knowledge/application/connection-settings';

export { checkCollection } from '@/modules/knowledge/application/index-compatibility';

export {
  QDRANT_VERSION,
  StoreError,
  manifestFingerprint,
  type IndexManifest,
} from '@/modules/knowledge/application/index-manifest';

export { validateKnowledgeScope } from '@/modules/knowledge/application/index-scope';

export { HF_IDENTITY } from '@/modules/knowledge/application/inference-identity';

export { parseKnowledgePayload } from '@/modules/knowledge/application/knowledge-payload';

export { type EmbeddingPort } from '@/modules/knowledge/application/ports/embedding';

export {
  parseHfEmbeddings,
  parseHfScores,
  validateEmbeddingBatch,
} from '@/modules/knowledge/application/vector-validation';

export { type EmbeddingVector } from '@/modules/knowledge/domain/models/embedding';

export { type RetrievalFilter } from '@/modules/knowledge/domain/models/retrieval-filter';
