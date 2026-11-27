import type { IndexManifest } from '@/modules/knowledge/application/public';

export interface RetrievalConfig {
  readonly index: IndexManifest;

  readonly candidateLimit: number;

  readonly limit: number;

  readonly maxConcurrency: number;

  readonly timeoutMs: number;

  readonly maxResponseBytes: number;
}
