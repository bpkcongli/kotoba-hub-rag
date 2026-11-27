import { type CallContext } from '@/modules/execution/application/public';
import { type EmbeddingVector } from '@/modules/knowledge/domain/models/embedding';

export interface EmbeddingPort {
  embed(
    texts: readonly string[],
    purpose: 'document' | 'query',
    context: CallContext,
  ): Promise<readonly EmbeddingVector[]>;
}
