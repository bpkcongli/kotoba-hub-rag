import type { IndexManifest } from '@/modules/knowledge/application/index-manifest';
import type {
  IndexPoint,
  IndexValidation,
} from '@/modules/knowledge/application/models/index-store';

export interface IndexStorePort {
  prepare(manifest: IndexManifest): Promise<unknown>;

  assertWritable(manifest: IndexManifest): Promise<void>;

  upsert(manifest: IndexManifest, points: readonly IndexPoint[]): Promise<void>;

  validate(manifest: IndexManifest): Promise<IndexValidation>;
}
