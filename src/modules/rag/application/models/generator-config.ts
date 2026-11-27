import { OPENAI_MODELS } from '@/modules/rag/application/models/generation-models';

export interface GenerationSettings {
  readonly generationModel: typeof OPENAI_MODELS.generation;

  readonly normalizationModel: typeof OPENAI_MODELS.normalization;

  readonly maxOutputTokens: number;

  readonly maxInputChars: number;
}
