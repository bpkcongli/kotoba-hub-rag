---
name: kotoba-rag-experiments
description: Prepare, evaluate, or analyze KotobaHub RAG offline experiments, including datasets, retrieval and response metrics, judge calibration, run manifests, cost accounting, and paired statistics. Use for research artifacts rather than routine runtime coding.
---

# KotobaHub experimental integrity

Resolve project paths from the repository root. Read `PRD.md` sections 6–9, `ARCHITECTURE.md` telemetry, and the assigned DS/EVAL/EXP/RES task. The thesis draft in `docs/Andrian_41522120004_TA_Draft.docx` is the protocol baseline.

Maintain 24 separate pilot cases and 120 main cases: three use cases × four complexity categories × ten main cases, five repetitions per case across three modes, totaling 1,800 main terminal outcomes. Onboarding has normalize/recommend suboperations but remains one case group; do not inflate sample size. Pedagogical difficulty is distinct from routing complexity. Synthetic learner profiles replace real-user data.

Store input, provenance, allowed scope, expected outcome, relevant evidence/graded relevance, reference answers, rubric and expected routing with stable case IDs. Keep evaluation-only fields out of runtime input and the vector index. Audit semantic overlap between pilot/main splits. Freeze model/prompt/schema/corpus/index/router/retrieval/price/evaluator/environment versions, primary outcomes and failure rules before the main run. Tune only on pilot; after freeze a change requires a new version/run cohort.

Specify formulas and denominators. Distinguish label precision@k from rank-aware Context Precision, raw retrieval from selected context, internal retrieval score from ground-truth quality, and N/A from zero. For LLM_ONLY retrieval metrics are N/A. Preserve failures and unknown outcomes; report how quality metrics exclude or handle unscorable results alongside all-request reliability.

Use a separate fixed judge configuration and structured rubric. The thesis requires stratified human review of 20% of outputs and ICC ≥0.75; preselect the ICC form and rating design. AI assistance is not independent human validation. Calibrate with pilot or use manual scoring if inadequate; do not retune the judge from favorable/unfavorable main scores.

Manifest every actual model call, purpose, retry, usage, cached tokens, latency and price version. Unknown token/cost is null. Track query embedding, online rerank and LLM calls with all retries in online request totals without double-counting subtotal/detail. Keep document indexing and judge costs separate; dedicated endpoint hosting that already includes calls must not be added twice. Freeze rules for idle/startup/warmup allocation and record unknown billing as null. Pin actual provider/endpoint/deployment/model revision and region per operation; disable hidden provider auto-routing/fallback, preserve document/query compatibility, and use new cohorts after frozen provider changes. Include network, queue/cold-start where observable in end-to-end latency; record unavailable remote hardware/precision as unknown and report shared-load limits. Unverified model revision blocks freeze even if hardware is legitimately unobservable. Randomize/balance execution order, equalize warmup/concurrency/cache policy, checkpoint executions and distinguish repeats from idempotent replay. Running a paid experiment needs an authorized scope and configured budget.

Aggregate repetitions within each case for paired comparisons; bootstrap cases rather than treating repetitions as independent. Follow predefined assumptions for paired t/Wilcoxon and repeated-measures/Friedman, α=0.05, Holm for multiple comparisons, suitable effect sizes and confidence intervals. Report trade-offs and limitations even if adaptive is worse. Return manifests, metric definitions, missing/failure counts, actual analysis evidence and protocol deviations.
