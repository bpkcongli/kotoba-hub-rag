import type {
  AiLanguage,
  GeneratePracticeSessionInput,
  GradePracticeAnswerInput,
  SummarizePlacementInput,
  GenerateStudyRecommendationInput,
} from "kotoba-app/src/backend/shared/application/services/requests/ai-request";
import type {
  GeneratedPracticeSession,
  GradedPracticeAnswer,
  PlacementSummary,
  StudyRecommendation,
} from "kotoba-app/src/backend/shared/application/services/responses/ai-response";
import { operations } from "./definition";

export interface Inputs {
  generate: GeneratePracticeSessionInput;
  evaluate: GradePracticeAnswerInput;
  normalize: SummarizePlacementInput;
  recommend: GenerateStudyRecommendationInput;
}

interface Outputs {
  generate: GeneratedPracticeSession;
  evaluate: GradedPracticeAnswer;
  normalize: PlacementSummary;
  recommend: StudyRecommendation;
}

export interface Request<T> {
  schema_version: "1";
  request_id: string;
  mode: "LLM_ONLY" | "SINGLE_STAGE" | "ADAPTIVE";
  corpus_version: string;
  timeout_ms: number;
  deadline_at: string;
  experiment?: { experiment_id: string; case_id: string; repetition: number };
  payload: T;
}

export type Fixture = {
  [K in keyof Inputs]: {
    id: string;
    operation: K;
    use_case: string;
    request: Request<Inputs[K]>;
    response: {
      schema_version: "1";
      request_id: string;
      execution_id: string;
      mode: "LLM_ONLY" | "SINGLE_STAGE" | "ADAPTIVE";
      data: Outputs[K];
      meta: ReturnType<typeof meta>;
    };
  };
}[keyof Inputs];

function meta(): {
  trace_id: string;
  corpus_version: string;
  path: string;
  sources: { source_id: string; chunk_id: string }[];
  duration_ms: number;
  usage: {
    input_tokens: number | null;
    cached_input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  };
  cost: {
    currency: string;
    inference_total_usd: number | null;
    query_embedding_usd: number | null;
    rerank_usd: number | null;
    total_online_usd: number | null;
    known_subtotal_usd: number;
    status: string;
  };
  counters: {
    retrieval_stage_count: number;
    rewrite_call_count: number;
    rerank_call_count: number;
    provider_retry_count: number;
    schema_retry_count: number;
    model_call_count: number;
  };
} {
  return {
    trace_id: "70000000-0000-4000-8000-000000000003",
    corpus_version: "synthetic-contract-v1",
    path: "SINGLE_STAGE",
    sources: [{ source_id: "synthetic-lesson", chunk_id: "synthetic-chunk" }],
    duration_ms: 12,
    usage: {
      input_tokens: 100,
      cached_input_tokens: 20,
      output_tokens: 50,
      total_tokens: 150,
    },
    cost: {
      currency: "USD",
      inference_total_usd: null,
      query_embedding_usd: null,
      rerank_usd: 0,
      total_online_usd: null,
      known_subtotal_usd: 0,
      status: "UNKNOWN",
    },
    counters: {
      retrieval_stage_count: 1,
      rewrite_call_count: 0,
      rerank_call_count: 0,
      provider_retry_count: 0,
      schema_retry_count: 0,
      model_call_count: 2,
    },
  };
}

// Seluruh identifier/konten sintetis; bukan corpus, answer key, atau dataset penelitian.
export function fixtures(): Fixture[] {
  const result: Fixture[] = [];

  for (const level of ["JLPT_N5", "JLPT_N4"] as const) {
    for (const locale of ["en", "id"] as const) {
      const language: AiLanguage = {
        instructionLocale: locale,
        feedbackLocale: locale,
        translationLocale: locale,
      };

      const base = {
        language,
        metadata: { requestId: "70000000-0000-4000-8000-000000000001" },
        context: {
          targetLevel: level,
          currentLevel: "BEGINNER",
          currentUnitSlug: "synthetic-unit",
          catalog: [
            {
              skillCode: "synthetic_copula",
              title: "Synthetic copula",
              lessonSlug: "synthetic-lesson",
              unitSlug: "synthetic-unit",
              trackSlug: "synthetic-track",
            },
          ],
          weakSkillCodes: ["synthetic_copula"],
          masteredSkillCodes: [],
          recentMistakes: [
            { skillCode: "synthetic_copula", summary: "Kesalahan sintetis." },
          ],
          lessonUnderstanding: [{ lessonSlug: "synthetic-lesson", level: 1 }],
          allowedQuestionTypes: [
            "SHORT_FREE_RESPONSE",
            "SLOT_FILL",
            "ARRANGE_TOKEN",
            "FREE_RESPONSE",
          ] as GeneratedPracticeSession["questions"][number]["questionType"][],
        },
      };

      const promptLanguage = locale === "id" ? "ID" : "EN";

      const sourceSentence =
        locale === "id" ? "Saya seorang pelajar." : "I am a student.";

      const qBase = {
        skillCode: "synthetic_copula",
        difficultyBand: "STANDARD" as const,
      };

      const inputMethod = {
        acceptsRomaji: true,
        transformsTo: "KANA",
      } as const;

      const generated: GeneratedPracticeSession = {
        questions: [
          {
            ...qBase,
            questionType: "SHORT_FREE_RESPONSE",
            gradingStrategy: "DETERMINISTIC",
            promptPayload: {
              schemaVersion: 1,
              promptLanguage: "JA",
              answerLanguage: "JA",
              slotCount: 1,
              sentenceTemplate: "わたし___がくせいです。",
              blankInputMode: "ROMAJI_TO_KANA",
              inputMethod,
            },
            expectedAnswer: { acceptedTextAnswers: ["は"] },
          },

          {
            ...qBase,
            questionType: "SLOT_FILL",
            gradingStrategy: "DETERMINISTIC",
            promptPayload: {
              schemaVersion: 1,
              promptLanguage: "JA",
              optionLanguage: "JA",
              slotCount: 1,
              sentenceTemplate: "わたし___がくせいです。",
              options: ["は", "を", "で", "に"].map((label, i) => ({
                id: `o${i}`,
                label,
              })),
            },
            expectedAnswer: { correctOptionId: "o0" },
          },

          {
            ...qBase,
            questionType: "ARRANGE_TOKEN",
            gradingStrategy: "DETERMINISTIC",
            promptPayload: {
              schemaVersion: 1,
              promptLanguage,
              answerLanguage: "JA",
              direction: locale === "id" ? "ID_TO_JA" : "EN_TO_JA",
              sourceSentence,
              arrangeTokens: [
                { id: "t1", label: "わたしは" },
                { id: "t2", label: "がくせいです" },
              ],
            },
            expectedAnswer: { acceptedTokenOrders: [["t1", "t2"]] },
          },

          {
            ...qBase,
            questionType: "ARRANGE_TOKEN",
            gradingStrategy: "DETERMINISTIC",
            promptPayload: {
              schemaVersion: 1,
              promptLanguage: "JA",
              answerLanguage: promptLanguage,
              direction: locale === "id" ? "JA_TO_ID" : "JA_TO_EN",
              sourceSentence: "わたしはがくせいです。",
              arrangeTokens:
                locale === "id"
                  ? [
                      { id: "t1", label: "Saya" },
                      { id: "t2", label: "seorang pelajar." },
                    ]
                  : [
                      { id: "t1", label: "I am" },
                      { id: "t2", label: "a student." },
                    ],
            },
            expectedAnswer: { acceptedTokenOrders: [["t1", "t2"]] },
          },

          {
            ...qBase,
            questionType: "FREE_RESPONSE",
            gradingStrategy: "AI",
            promptPayload: {
              schemaVersion: 1,
              promptLanguage,
              answerLanguage: "JA",
              sourceSentence,
              inputMethod,
            },
            expectedAnswer: { referenceAnswer: "わたしはがくせいです。" },
          },
        ],
      };

      function add<K extends keyof Inputs>(
        operation: K,
        payload: Inputs[K],
        data: Outputs[K],
      ) {
        const op = operations.find((o) => o.key === operation);

        if (!op) throw new Error("Operasi tidak dikenal.");

        const id = `${operation}-${level.toLowerCase()}-${locale}`;

        const suffix = String(result.length + 1).padStart(12, "0");

        const requestId = `70000000-0000-4000-8000-${suffix}`;

        payload = { ...payload, metadata: { ...payload.metadata, requestId } };
        // Assertion hanya menghubungkan K yang sama; input/output sudah bertipe per operasi.
        result.push({
          id,
          operation,
          use_case: op.useCase,
          request: {
            schema_version: "1",
            request_id: requestId,
            mode: "SINGLE_STAGE",
            corpus_version: "synthetic-contract-v1",
            timeout_ms: 30000,
            deadline_at: "2026-11-23T12:00:30Z",
            experiment: {
              experiment_id: "contract-only",
              case_id: id,
              repetition: 1,
            },
            payload,
          },
          response: {
            schema_version: "1",
            request_id: requestId,
            execution_id: `71000000-0000-4000-8000-${suffix}`,
            mode: "SINGLE_STAGE",
            data,
            meta: { ...meta(), trace_id: `72000000-0000-4000-8000-${suffix}` },
          },
        } as Fixture);
      }

      add(
        "generate",
        {
          ...base,
          questionCount: 5,
          difficultyBand: "STANDARD",
          questionMix: { WEAK: 0.6, REINFORCEMENT: 0.3, STRETCH: 0.1 },
        },
        generated,
      );

      add(
        "evaluate",
        {
          ...base,
          question: {
            skillCode: "synthetic_copula",
            questionType: "FREE_RESPONSE",
            promptLanguage,
            answerLanguage: "JA",
            sourceSentence,
            referenceAnswer: "わたしはがくせいです。",
          },
          userAnswer: {
            rawInputRomaji: "watashi wa gakusei desu",
            normalizedKana: "わたしはがくせいです。",
            normalizedKanji: "私は学生です。",
          },
        },
        {
          isCorrect: true,
          numericScore: 100,
          feedbackText:
            locale === "id"
              ? "Kalimatmu menyampaikan makna yang diminta."
              : "Your sentence expresses the requested meaning.",
        },
      );

      add(
        "normalize",
        {
          ...base,
          note:
            locale === "id"
              ? "Saya mengenal pola desu."
              : "I know the desu pattern.",
        },
        {
          suggestedKnownSkillClaims: [
            { skillCode: "synthetic_copula", confidence: 0.8 },
          ],
        },
      );

      add("recommend", base, {
        recommendedTrackSlug: "synthetic-track",
        recommendedUnitSlug: "synthetic-unit",
        nextLessonSlug: "synthetic-lesson",
        targetSkillCodes: ["synthetic_copula"],
        difficultyBand: "STANDARD",
        allowedQuestionTypes: ["FREE_RESPONSE"],
      });
    }
  }

  return result;
}
