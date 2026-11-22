---
name: kotoba-rag-ingestion
description: Build or review KotobaHub N5/N4 corpus snapshots, Japanese chunking, BGE-M3 dense+sparse embeddings, and reproducible Qdrant indexing. Use for ingestion or reindexing work, not runtime routing or learner-state updates.
---

# KotobaHub corpus and indexing

Resolve project paths from the repository root. Read `ARCHITECTURE.md` sections 3 and 6, `PRD.md` scope, and the assigned DATA/INF/STORE task in `TASK_BREAKDOWN.md`.

Start from an approved, versioned export of published KotobaHub material. Preserve skill/lesson/unit/track associations, source URLs, licensing, curation status, locale and checksums. Catalog metadata alone may be insufficient evidence; inspect the actual explanations, examples and rubric. Do not scrape or publish new external content merely because it is referenced in the thesis.

Keep Japanese text and pedagogical units intact. Record Unicode policy, tokenizer/revision, parent IDs and offsets. Select chunk size/overlap using pilot evidence; do not treat characters as tokens or flatten kana/kanji into one irreversible representation. Group grammar patterns with the explanation/examples needed to interpret them.

Generate both dense vectors and BGE-M3 sparse lexical weights with compatible revisions for documents and queries. Validate vector dimension and numeric output; a dense-only convenience API is not the hybrid implementation. Use deterministic chunk/point IDs and retain original content checksums. Test re-ingestion, partial failure, replacement/deletion and duplicate overlap behavior.

Use Qdrant named dense+sparse vectors and indexed payload filters. Validate a new physical collection before promotion and pin its revision in experiment manifests. Never update the corpus/index during a frozen run. Keep learner profiles/progress, evaluation cases, secret answer keys and route labels out of the shared index. Official learning rubric is separate from evaluation-only ground truth.

Return corpus/index manifest changes, eligibility/provenance checks, count/checksum report, Japanese sample inspection and actual retrieval smoke evidence. Record hardware/model precision alongside embedding performance; do not replace the thesis model solely to make setup easier.
