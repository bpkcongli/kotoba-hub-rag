import type { Meta } from '@/contracts/v1.generated';
import type { CallAccounting } from '@/observability/accounting-types';
import { sumMoney } from '@/observability/money';

export function pipelineMetadata(
  calls: readonly CallAccounting[],
  stageCount: 0 | 1 | 2,
): Pick<Meta, 'usage' | 'cost' | 'counters'> {
  const llm = calls.filter((row) => !['query', 'rerank'].includes(row.purpose));
  const query = calls.filter((row) => row.purpose === 'query');
  const rerank = calls.filter((row) => row.purpose === 'rerank');
  const sum = (rows: readonly CallAccounting[]): string | null =>
    rows.every((row) => row.cost.kind === 'PER_CALL' && row.cost.totalUsd !== null)
      ? sumMoney(
          rows.flatMap((row) =>
            row.cost.kind === 'PER_CALL' && row.cost.totalUsd !== null ? [row.cost.totalUsd] : [],
          ),
        )
      : null;
  const known = sumMoney(
    calls.flatMap((row) => (row.cost.kind === 'PER_CALL' ? [row.cost.knownSubtotalUsd] : [])),
  );
  const total = sum(calls);
  const tokens = (
    key: 'inputTokens' | 'cachedInputTokens' | 'outputTokens' | 'totalTokens',
  ): number | null =>
    llm.every((row) => row.usage?.[key] !== null && row.usage?.[key] !== undefined)
      ? llm.reduce((acc, row) => acc + (row.usage?.[key] ?? 0), 0)
      : null;
  const amount = (rows: readonly CallAccounting[]): number | null => {
    const value = sum(rows);
    return value === null ? null : Number(value);
  };

  const allKnown = (
    ['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens'] as const
  ).every((key) => llm.every((call) => call.usage !== null && call.usage[key] !== null));

  return {
    usage: {
      input_tokens: allKnown ? tokens('inputTokens') : null,
      cached_input_tokens: allKnown ? tokens('cachedInputTokens') : null,
      output_tokens: allKnown ? tokens('outputTokens') : null,
      total_tokens: allKnown ? tokens('totalTokens') : null,
    },
    cost: {
      currency: 'USD',
      inference_total_usd: amount(llm),
      query_embedding_usd: amount(query),
      rerank_usd: amount(rerank),
      total_online_usd: total === null ? null : Number(total),
      known_subtotal_usd: Number(known),
      status: total !== null ? 'KNOWN' : Number(known) > 0 ? 'PARTIAL' : 'UNKNOWN',
    },
    counters: {
      retrieval_stage_count: stageCount,
      rewrite_call_count: calls.filter((row) => row.purpose === 'rewrite').length,
      rerank_call_count: rerank.length,
      provider_retry_count: calls.filter((row) => row.retryKind === 'PROVIDER_RETRY').length,
      schema_retry_count: calls.filter((row) => row.retryKind === 'SCHEMA_RETRY').length,
      model_call_count: calls.length,
    },
  };
}

export const adaptiveMetadata = pipelineMetadata;
export function singleStageMetadata(calls: readonly CallAccounting[]) {
  return pipelineMetadata(calls, 1);
}
