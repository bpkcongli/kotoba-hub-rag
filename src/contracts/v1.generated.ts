// Generated from contracts/v1; run npm run contracts:generate.

// contracts/v1/domain.schema.json: sha256 dd30836f920f73d62e65621569ec5162acef00a5d5fc03e5494c43b76dc64e6c

export type AiLanguage = {
  instructionLocale: 'en' | 'id';
  feedbackLocale: 'en' | 'id';
  translationLocale: 'en' | 'id';
};

export type AiContextBundle = {
  targetLevel: 'JLPT_N5' | 'JLPT_N4' | 'JLPT_N3' | 'JLPT_N2';
  currentLevel: 'BEGINNER' | 'JLPT_N5' | 'JLPT_N4' | 'JLPT_N3' | 'JLPT_N2' | null;
  currentUnitSlug: string | null;
  catalog: Array<{
    skillCode: string;
    title: string;
    lessonSlug: string;
    unitSlug: string;
    trackSlug: string;
  }>;
  weakSkillCodes: Array<string>;
  masteredSkillCodes: Array<string>;
  recentMistakes: Array<{ skillCode: string; summary: string }>;
  lessonUnderstanding: Array<{ lessonSlug: string; level: number }>;
  allowedQuestionTypes: Array<
    'SHORT_FREE_RESPONSE' | 'SLOT_FILL' | 'ARRANGE_TOKEN' | 'FREE_RESPONSE'
  >;
};

export type GeneratedPracticeSession = {
  questions: Array<
    | {
        skillCode: string;
        difficultyBand: 'REMEDIAL' | 'STANDARD' | 'STRETCH';
        questionType: 'SHORT_FREE_RESPONSE';
        gradingStrategy: 'DETERMINISTIC';
        promptPayload: {
          schemaVersion: 1;
          promptLanguage: 'JA';
          answerLanguage: 'JA';
          slotCount: 1;
          sentenceTemplate: string;
          blankInputMode: 'ROMAJI_TO_KANA';
          inputMethod: { acceptsRomaji: true; transformsTo: 'KANA' };
        };
        expectedAnswer: { acceptedTextAnswers: Array<string> };
      }
    | {
        skillCode: string;
        difficultyBand: 'REMEDIAL' | 'STANDARD' | 'STRETCH';
        questionType: 'SLOT_FILL';
        gradingStrategy: 'DETERMINISTIC';
        promptPayload: {
          schemaVersion: 1;
          promptLanguage: 'JA';
          optionLanguage: 'JA';
          slotCount: 1;
          sentenceTemplate: string;
          options: Array<{ id: string; label: string }>;
        };
        expectedAnswer: { correctOptionId: string };
      }
    | {
        skillCode: string;
        difficultyBand: 'REMEDIAL' | 'STANDARD' | 'STRETCH';
        questionType: 'ARRANGE_TOKEN';
        gradingStrategy: 'DETERMINISTIC';
        promptPayload: {
          schemaVersion: 1;
          promptLanguage: 'EN' | 'ID' | 'JA';
          answerLanguage: 'EN' | 'ID' | 'JA';
          direction: 'EN_TO_JA' | 'JA_TO_EN' | 'ID_TO_JA' | 'JA_TO_ID';
          sourceSentence: string;
          arrangeTokens: Array<{ id: string; label: string }>;
        };
        expectedAnswer: { acceptedTokenOrders: Array<Array<string>> };
      }
    | {
        skillCode: string;
        difficultyBand: 'REMEDIAL' | 'STANDARD' | 'STRETCH';
        questionType: 'FREE_RESPONSE';
        gradingStrategy: 'AI';
        promptPayload: {
          schemaVersion: 1;
          promptLanguage: 'EN' | 'ID';
          answerLanguage: 'JA';
          sourceSentence: string;
          inputMethod: { acceptsRomaji: true; transformsTo: 'KANA' };
        };
        expectedAnswer: { referenceAnswer: string };
      }
  >;
};

export type GradedPracticeAnswer = {
  isCorrect: boolean;
  numericScore: number;
  feedbackText: string;
};

export type PlacementSummary = {
  suggestedKnownSkillClaims: Array<{ skillCode: string; confidence: number }>;
};

export type StudyRecommendation = {
  recommendedTrackSlug: string;
  recommendedUnitSlug: string;
  nextLessonSlug: string;
  targetSkillCodes: Array<string>;
  difficultyBand: 'REMEDIAL' | 'STANDARD' | 'STRETCH';
  allowedQuestionTypes: Array<
    'SHORT_FREE_RESPONSE' | 'SLOT_FILL' | 'ARRANGE_TOKEN' | 'FREE_RESPONSE'
  >;
};

export type QuestionType = 'SHORT_FREE_RESPONSE' | 'SLOT_FILL' | 'ARRANGE_TOKEN' | 'FREE_RESPONSE';

export type DifficultyBand = 'REMEDIAL' | 'STANDARD' | 'STRETCH';

// contracts/v1/contract.schema.json: sha256 2152875519f305a92a60a72f6468e6d20d87a9c77590ba396eba4e34bc4803ee

export type Meta = {
  trace_id: string;
  corpus_version: string;
  path: 'LLM_ONLY' | 'SINGLE_STAGE' | 'FAST' | 'DEEP';
  sources: Array<{ source_id: string; chunk_id: string }>;
  duration_ms: number;
  usage: {
    input_tokens: number | null;
    cached_input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  };
  cost: {
    currency: 'USD';
    inference_total_usd: number | null;
    query_embedding_usd: number | null;
    rerank_usd: number | null;
    total_online_usd: number | null;
    known_subtotal_usd: number;
    status: 'KNOWN' | 'PARTIAL' | 'UNKNOWN';
  };
  counters: {
    retrieval_stage_count: number;
    rewrite_call_count: number;
    rerank_call_count: number;
    provider_retry_count: number;
    schema_retry_count: number;
    model_call_count: number;
  };
};

export type GeneratePayload = {
  context: AiContextBundle;
  language: AiLanguage;
  metadata: {
    requestId: string;
    userId?: string;
    sourceEntityType?: 'PRACTICE_SESSION' | 'PRACTICE_ANSWER' | 'PERSONALIZATION_ASSESSMENT';
    sourceEntityId?: string;
  };
  questionCount: number;
  difficultyBand: DifficultyBand;
  questionMix?: { WEAK: number; REINFORCEMENT: number; STRETCH: number };
};

export type GenerateRequest = {
  schema_version: '1';
  request_id: string;
  mode: 'LLM_ONLY' | 'SINGLE_STAGE' | 'ADAPTIVE';
  corpus_version: string;
  timeout_ms: number;
  deadline_at: string;
  experiment?: { experiment_id: string; case_id: string; repetition: number };
  payload: GeneratePayload;
};

export type GenerateResponse = {
  schema_version: '1';
  request_id: string;
  execution_id: string;
  mode: 'LLM_ONLY' | 'SINGLE_STAGE' | 'ADAPTIVE';
  data: GeneratedPracticeSession;
  meta: Meta;
};

export type EvaluatePayload = {
  context: AiContextBundle;
  language: AiLanguage;
  metadata: {
    requestId: string;
    userId?: string;
    sourceEntityType?: 'PRACTICE_SESSION' | 'PRACTICE_ANSWER' | 'PERSONALIZATION_ASSESSMENT';
    sourceEntityId?: string;
  };
  question: {
    skillCode: string;
    questionType: 'FREE_RESPONSE';
    promptLanguage: 'EN' | 'ID';
    answerLanguage: 'JA';
    sourceSentence: string;
    referenceAnswer: string;
  };
  userAnswer: { rawInputRomaji: string; normalizedKana: string; normalizedKanji: string | null };
};

export type EvaluateRequest = {
  schema_version: '1';
  request_id: string;
  mode: 'LLM_ONLY' | 'SINGLE_STAGE' | 'ADAPTIVE';
  corpus_version: string;
  timeout_ms: number;
  deadline_at: string;
  experiment?: { experiment_id: string; case_id: string; repetition: number };
  payload: EvaluatePayload;
};

export type EvaluateResponse = {
  schema_version: '1';
  request_id: string;
  execution_id: string;
  mode: 'LLM_ONLY' | 'SINGLE_STAGE' | 'ADAPTIVE';
  data: GradedPracticeAnswer;
  meta: Meta;
};

export type NormalizePayload = {
  context: AiContextBundle;
  language: AiLanguage;
  metadata: {
    requestId: string;
    userId?: string;
    sourceEntityType?: 'PRACTICE_SESSION' | 'PRACTICE_ANSWER' | 'PERSONALIZATION_ASSESSMENT';
    sourceEntityId?: string;
  };
  note: string;
};

export type NormalizeRequest = {
  schema_version: '1';
  request_id: string;
  mode: 'LLM_ONLY' | 'SINGLE_STAGE' | 'ADAPTIVE';
  corpus_version: string;
  timeout_ms: number;
  deadline_at: string;
  experiment?: { experiment_id: string; case_id: string; repetition: number };
  payload: NormalizePayload;
};

export type NormalizeResponse = {
  schema_version: '1';
  request_id: string;
  execution_id: string;
  mode: 'LLM_ONLY' | 'SINGLE_STAGE' | 'ADAPTIVE';
  data: PlacementSummary;
  meta: Meta;
};

export type RecommendPayload = {
  context: AiContextBundle;
  language: AiLanguage;
  metadata: {
    requestId: string;
    userId?: string;
    sourceEntityType?: 'PRACTICE_SESSION' | 'PRACTICE_ANSWER' | 'PERSONALIZATION_ASSESSMENT';
    sourceEntityId?: string;
  };
};

export type RecommendRequest = {
  schema_version: '1';
  request_id: string;
  mode: 'LLM_ONLY' | 'SINGLE_STAGE' | 'ADAPTIVE';
  corpus_version: string;
  timeout_ms: number;
  deadline_at: string;
  experiment?: { experiment_id: string; case_id: string; repetition: number };
  payload: RecommendPayload;
};

export type RecommendResponse = {
  schema_version: '1';
  request_id: string;
  execution_id: string;
  mode: 'LLM_ONLY' | 'SINGLE_STAGE' | 'ADAPTIVE';
  data: StudyRecommendation;
  meta: Meta;
};

export type ErrorResponse = {
  schema_version: '1';
  request_id: string | null;
  execution_id: string | null;
  mode: 'LLM_ONLY' | 'SINGLE_STAGE' | 'ADAPTIVE' | null;
  error:
    | { code: 'INVALID_INPUT'; message: string; retryable: false }
    | { code: 'AUTH_FAILED'; message: string; retryable: false }
    | { code: 'FORBIDDEN'; message: string; retryable: false }
    | { code: 'SNAPSHOT_MISMATCH'; message: string; retryable: false }
    | { code: 'IDEMPOTENCY_CONFLICT'; message: string; retryable: false }
    | { code: 'PAYLOAD_TOO_LARGE'; message: string; retryable: false }
    | { code: 'UNSUPPORTED_MEDIA_TYPE'; message: string; retryable: false }
    | { code: 'UNSUPPORTED_LEVEL'; message: string; retryable: false }
    | { code: 'INSUFFICIENT_EVIDENCE'; message: string; retryable: false }
    | { code: 'POST_VALIDATION_FAILED'; message: string; retryable: false }
    | { code: 'CAPACITY_LIMIT'; message: string; retryable: true }
    | { code: 'INTERNAL_ERROR'; message: string; retryable: false }
    | { code: 'RETRIEVAL_FAILED'; message: string; retryable: true }
    | { code: 'INFERENCE_FAILED'; message: string; retryable: true }
    | { code: 'PROVIDER_FAILED'; message: string; retryable: true }
    | { code: 'PROVIDER_REJECTED'; message: string; retryable: false }
    | { code: 'PROVIDER_REFUSED'; message: string; retryable: false }
    | { code: 'SCHEMA_PARSE_FAILED'; message: string; retryable: false }
    | { code: 'DEPENDENCY_NOT_READY'; message: string; retryable: true }
    | { code: 'TRACE_WRITE_FAILED'; message: string; retryable: false }
    | { code: 'TIMEOUT'; message: string; retryable: true };
  meta: { trace_id: string };
};

export type HealthResponse = { status: 'live' | 'ready' | 'not_ready' };
