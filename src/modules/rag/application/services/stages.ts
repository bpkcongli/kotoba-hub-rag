import type { Requests, Responses } from '@/contracts/types';
import type { CallContext } from '@/modules/execution/application/public';
import type { RetrievalFilter } from '@/modules/knowledge/application/public';
import type { RoutingDecision } from '@/modules/rag/application/pipelines/router';
import type { BuiltContext } from '@/modules/rag/domain/models/context';
import type { Evidence } from '@/modules/rag/domain/models/evidence';
import type {
  ContextCandidate,
  RetrievalResult,
  RetrievalTrace,
} from '@/modules/rag/domain/models/retrieval';
import type { Operation } from '@/shared/operations';

export interface RetrievalStageService {
  (
    query: string,
    filter: RetrievalFilter,
    stage: 1 | 2,
    context: CallContext,
  ): Promise<RetrievalResult & { readonly trace: RetrievalTrace }>;
}

export interface ContextBuilderService {
  (
    operation: Operation,
    request: Requests[Operation],
    candidates: readonly ContextCandidate[],
    targetSkillCodes: readonly string[],
    context: CallContext,
  ): Promise<BuiltContext>;
}

export interface OperationGeneratorService {
  (
    operation: Operation,
    request: Requests[Operation],
    evidence: readonly Evidence[],
    context: CallContext,
  ): Promise<{
    data: unknown;
    usage: {
      readonly inputTokens: number | null;
      readonly cachedInputTokens: number | null;
      readonly outputTokens: number | null;
      readonly totalTokens: number | null;
      readonly reasoningTokens?: number | null;
    } | null;
  }>;
}

export interface QueryRewriteService {
  (query: string, model: 'gpt-5.6-terra', context: CallContext): Promise<string>;
}

export interface PipelineService {
  <K extends Operation>(
    operation: K,
    input: unknown,
    executionId: string,
    signal: AbortSignal,
  ): Promise<Responses[K]>;
}

export interface AdaptiveInitialStageService {
  (
    operation: Operation,
    input: unknown,
    context: CallContext,
  ): Promise<{
    request: Requests[Operation];
    plan: {
      readonly query: string;
      readonly filter: RetrievalFilter;
      readonly targetSkillCodes: readonly string[];
    };
    retrieved: RetrievalResult & { readonly trace: RetrievalTrace };
    built: BuiltContext;
    decision: RoutingDecision;
  }>;
}
