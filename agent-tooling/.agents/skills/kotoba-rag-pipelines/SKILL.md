---
name: kotoba-rag-pipelines
description: Implement or review KotobaHub single-stage and adaptive RAG pipelines, routing, evidence gates, context budgets, and bounded deep-path execution. Use for retrieval orchestration rather than dataset scoring or corpus authoring.
---

# KotobaHub comparison pipelines

Resolve project paths from the repository root. Read `ARCHITECTURE.md` sections 7–10, the experiment controls in `PRD.md`, and the assigned RAG/ADP task.

Define a retrieval stage as one filtered dense+sparse search round plus fixed fusion. Dense and sparse branches are not two stages. Keep the stage-1 implementation, main generator/prompt/schema, context cap and validator shared across SINGLE_STAGE and ADAPTIVE. SINGLE_STAGE stops after stage 1 without rewrite, router or cross-encoder. LLM_ONLY has no semantic retrieval.

Route ADAPTIVE using observable input and stage-1 evidence. Never use dataset expected_route, complexity labels, hidden reference answers or judge scores as routing features. Calibrate thresholds only with the separate pilot. Raw dense, sparse, fusion and reranker scores have different meanings and are not confidence probabilities. Log feature values, thresholds, policy version, reason codes, initial decision and final path.

Fast path uses adequate initial evidence. Deep path can rewrite once, perform a second retrieval round with the same hard scope filters, merge/deduplicate, rerank and check final evidence. Treat these as initial configurable bounds, then freeze the pilot-selected values. Empty or inadequate final evidence yields an explicit outcome; do not silently return LLM-only output. Rewrite may change the search query, never the learner's allowed skill/level/difficulty constraints.

Budget prompt/input/profile/evidence/output tokens with a margin and preserve meaningful Japanese units. Record retrieved, selected and dropped IDs with reasons; citations may only refer to selected sources. All modes use equivalent schema/domain validation. Escalation and provider retry have distinct counters. Enforce total deadline, bounded attempts and cancellation across all calls; coordinate SDK/client retries so they do not multiply invisibly.

Use the same pinned remote query-embedding configuration for both RAG modes and a separately pinned reranker endpoint for deep path. Keep dense+sparse capability and document/query compatibility; provider outage, dense-only output or invalid rerank results must be explicit failures. No silent provider auto-routing, local fallback or model substitution. Include remote calls, network time and all attempts in deadlines/traces.

Verify initial-stage parity, route boundary cases, empty/conflicting evidence, unchanged hard filters, dedup/budget behavior, final evidence gate, and terminal outcomes at stage/retry/deadline limits. Return mode-specific traces and accounting for rewrite/rerank/repair/retry costs. Do not run paid comparisons merely to validate control flow.
