---
name: kotoba-rag-verification
description: Test or independently review KotobaHub RAG changes for contract correctness, bounded execution, metadata isolation, trace completeness, and fair experiment accounting. Use for targeted verification and evidence-based read-only code review.
---

# KotobaHub verification

Resolve project paths from the repository root. Read the assigned acceptance criteria in `TASK_BREAKDOWN.md` and the affected PRD/architecture sections. Select a test or review mode matching the assignment; a review-only task never authorizes edits.

For tests, focus on invariants whose failure changes output, cost, isolation or research validity: stage-1 parity, hard metadata filters through deep retrieval, expected route boundaries, context source selection, Japanese/locale constraints, schema vs domain-valid success, stage/retry/deadline termination, unknown usage, failed-execution retention and no double-counting. Avoid exact prompt-text snapshots or nondeterministic latency pass/fail thresholds unless the task specifically needs them.

Use deterministic provider fixtures in CI. Exercise Qdrant search/filter behavior against a temporary real instance for integration work; mocked vector results alone do not prove filter semantics. Real BGE smoke is opt-in with pinned revision and reported hardware. Do not invoke paid APIs or full research runs as a hidden test dependency. Parse shared fixtures using both the service and existing KotobaHub validators for compatibility work.

Review concrete diffs and call paths, not hypothetical future architecture. Identify hidden mode fallbacks, evaluation-label leakage, schema drift, dropped failures, nested retries and omitted/double-counted costs. Check caller timeout and domain validation boundaries as well as the service. For a code-reviewer role, return severity, file/line evidence, impact and reproduction or missing test; send fixes back to the writer.

Distinguish checks actually run from recommended follow-up, syntax from discovery/runtime evidence, and fixture coverage from paid-model behavior. If no defect is found, state scope and limits. Do not demand redundant tests for harmless reversible text changes or add a broad audit unrelated to the assigned task.
