import type { Evidence } from '@/modules/rag/domain/models/evidence';

export interface ContextConfig {
  readonly version: 'rag-02-v1';

  readonly counter: 'utf8-bytes-v1';

  readonly contextWindowTokens: number;

  readonly evidenceCapTokens: number;

  readonly safetyMarginTokens: number;

  readonly outputReserveTokens: number;

  readonly maxInputChars: number;
}

export interface ContextSource {
  readonly candidateIndex: number;

  readonly sourceId: string;

  readonly chunkId: string;
}

export type DropReason =
  | 'DUPLICATE_CHUNK'
  | 'DUPLICATE_CONTENT'
  | 'OUT_OF_SCOPE'
  | 'TOKEN_BUDGET'
  | 'INPUT_CHAR_LIMIT'
  | 'FIXED_INPUT_BUDGET';

export interface ContextTrace {
  readonly kind: 'context_built';

  readonly version: 'rag-02-v1';

  readonly configurationHash: string;

  readonly counter: 'utf8-bytes-v1';

  readonly status: 'READY' | 'EMPTY' | 'INPUT_BUDGET_EXCEEDED';

  readonly budget: {
    readonly contextWindowTokens: number;
    readonly evidenceCapTokens: number;
    readonly safetyMarginTokens: number;
    readonly outputReserveTokens: number;
    readonly systemTokens: number;
    readonly systemChars: number;
    readonly schemaTokens: number;
    readonly inputTokens: number;
    readonly evidenceTokens: number;
    readonly evidenceAvailableTokens: number;
    readonly totalReservedTokens: number;
    readonly maxInputChars: number;
    readonly serializedInputChars: number;
  };

  readonly coverage: {
    readonly targetSkillCodes: readonly string[];
    readonly coveredSkillCodes: readonly string[];
    readonly uncoveredSkillCodes: readonly string[];
  };

  readonly retrieved: readonly ContextSource[];

  readonly selected: readonly ContextSource[];

  readonly dropped: readonly (ContextSource & { readonly reason: DropReason })[];
}

export interface BuiltContext {
  readonly status: ContextTrace['status'];

  readonly evidence: readonly Evidence[];

  readonly sources: readonly { readonly source_id: string; readonly chunk_id: string }[];

  readonly trace: ContextTrace;
}

export class ContextError extends Error {
  readonly code: 'INVALID_INPUT' | 'TIMEOUT';

  constructor(code: ContextError['code']) {
    super(`Context assembly failed: ${code}`);
    this.name = 'ContextError';
    this.code = code;
  }
}
