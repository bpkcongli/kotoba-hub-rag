import type { Meta } from '@/contracts/v1.generated';
import type { CallAccounting } from '@/observability/accounting-types';
import { sumMoney } from '@/observability/money';

// Only online direct attempts. Hosting/indexing/judge allocation remains the OBS-02 offline ledger.
export function singleStageMetadata(
  calls: readonly CallAccounting[],
): Pick<Meta, 'usage' | 'cost' | 'counters'> {
  const generation = calls[1];
  const sum = (selected: readonly CallAccounting[]): string | null =>
    selected.every((call) => call.cost.kind === 'PER_CALL' && call.cost.totalUsd !== null)
      ? sumMoney(
          selected.flatMap((call) =>
            call.cost.kind === 'PER_CALL' && call.cost.totalUsd !== null
              ? [call.cost.totalUsd]
              : [],
          ),
        )
      : null;
  const llm = sum(calls.slice(1));
  const embedding = sum(calls.slice(0, 1));
  const knownSubtotal = sumMoney(
    calls.flatMap((call) => (call.cost.kind === 'PER_CALL' ? [call.cost.knownSubtotalUsd] : [])),
  );
  const total = llm !== null && embedding !== null ? sumMoney([llm, embedding]) : null;
  const usage = generation?.usage;
  const knownUsage =
    usage !== null &&
    usage !== undefined &&
    [usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, usage.totalTokens].every(
      (value) => value !== null,
    );

  return {
    usage: {
      input_tokens: knownUsage ? usage.inputTokens : null,
      cached_input_tokens: knownUsage ? usage.cachedInputTokens : null,
      output_tokens: knownUsage ? usage.outputTokens : null,
      total_tokens: knownUsage ? usage.totalTokens : null,
    },
    cost: {
      currency: 'USD',
      inference_total_usd: llm === null ? null : Number(llm),
      query_embedding_usd: embedding === null ? null : Number(embedding),
      rerank_usd: 0,
      total_online_usd: total === null ? null : Number(total),
      known_subtotal_usd: Number(knownSubtotal),
      status: total !== null ? 'KNOWN' : Number(knownSubtotal) > 0 ? 'PARTIAL' : 'UNKNOWN',
    },
    counters: {
      retrieval_stage_count: 1,
      rewrite_call_count: 0,
      rerank_call_count: 0,
      provider_retry_count: 0,
      schema_retry_count: 0,
      model_call_count: calls.length,
    },
  };
}

export function adaptiveMetadata(
  calls: readonly CallAccounting[],
  stageCount: 1 | 2,
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

  return {
    usage: {
      input_tokens: tokens('inputTokens'),
      cached_input_tokens: tokens('cachedInputTokens'),
      output_tokens: tokens('outputTokens'),
      total_tokens: tokens('totalTokens'),
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
