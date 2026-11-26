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
