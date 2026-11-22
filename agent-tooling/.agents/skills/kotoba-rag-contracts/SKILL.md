---
name: kotoba-rag-contracts
description: Design, implement, or verify the REST and AI service contracts between KotobaHub and its RAG service, preserving strict schemas, locale behavior, domain ownership, and retry accounting. Use for API integration and operation mapping.
---

# KotobaHub service contracts

Resolve paths from the repository root. Read `ARCHITECTURE.md` sections 3 and 5, the relevant CON/API/UC/INT task, and actual KotobaHub source before changing a contract. The sibling checkout is normally `../kotoba-hub`; verify its location and current schemas instead of assuming a draft interface is installed.

Trace `AiService`, `PracticeAiAdapter`, `AiProviderPort`, `ai-request.ts`, `ai-schemas.ts`, `ai-templates.ts` and `ai-env.ts`. The current provider boundary accepts prompt/model/schema; service-level retrieval needs operation plus structured context. Do not turn a RAG endpoint into an unvalidated generic prompt proxy. Snapshot fixtures and generate compatible wire schemas rather than importing runtime code across repositories.

Map GENERATE_PRACTICE_SESSION, GRADE_PRACTICE_ANSWER, SUMMARIZE_PLACEMENT and GENERATE_STUDY_RECOMMENDATION. These are four operations in three experimental use cases. Keep result metadata outside the strict domain `data` object; retain request/execution/trace correlation, explicit mode, corpus/schema version and structured error semantics.

Preserve question count, catalog IDs and lesson/unit/track relationships, allowed types, difficulty, blank/option/token invariants and EN/ID translation direction. Only FREE_RESPONSE uses AI grading; grading outputs remain isCorrect, numericScore 0–100, feedbackText within the existing schema. Keep normalization claims as suggestions requiring application confirmation. Reject research requests outside N5/N4 even if the app enum contains N3/N2.

KotobaHub retains auth, source-of-truth MySQL, domain validation, mastery/progress and session persistence. No service-side domain writes or browser-exposed provider/service keys. Audit outer client, SDK and service retry/deadline ownership and model differences before treating existing LLM-only logs as comparable baseline data.

Return operation/schema mapping, fixture compatibility evidence, error/locale tests and a list of intentional versioned changes. Do not mutate the sibling repository as part of a read-only contract analysis; implement there only when the assigned integration scope authorizes it.
