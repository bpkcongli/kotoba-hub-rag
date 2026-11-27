import type { IndexManifest } from '@/modules/knowledge/application/index-manifest';
import type { EmbeddingVector } from '@/modules/knowledge/domain/models/embedding';

export interface IndexValidation {
  readonly physicalCollection: string;

  readonly indexRevision: string;

  readonly fingerprint: string;

  readonly pointCount: number;

  readonly contentDigest: string;

  readonly retrievalProfile: IndexManifest['retrievalProfile'];

  readonly modelRevisionsRecorded: boolean;

  readonly searchSmokePassed: boolean;
}

export interface IndexPoint {
  readonly id: string;

  readonly payload: Readonly<Record<string, unknown>>;

  readonly vector: EmbeddingVector;
}
