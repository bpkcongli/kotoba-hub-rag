import type { IngestionPlan } from '@/modules/knowledge/application/index-plan';
import type { IndexValidation } from '@/modules/knowledge/application/models/index-store';
import type { EmbeddingPort } from '@/modules/knowledge/application/ports/embedding';
import { type IndexStorePort } from '@/modules/knowledge/application/ports/index-store';

export type IndexingOptions = {
  readonly directory: string;

  readonly plan: IngestionPlan;

  readonly store: IndexStorePort;

  readonly embedding: EmbeddingPort;

  readonly signal: AbortSignal;

  readonly timeoutMs: number;

  readonly maxNewBatches: number;
};

export interface IndexingService {
  run(options: IndexingOptions): Promise<IndexValidation | null>;
}
