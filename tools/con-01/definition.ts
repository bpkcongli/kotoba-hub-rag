import { z } from "zod";
import * as app from "kotoba-app/src/backend/shared/application/helpers/ai-schemas";

type Schema = Record<string, unknown>;

const draft = "http://json-schema.org/draft-07/schema#";

const text = (maxLength = 2000): Schema => ({
  type: "string",
  minLength: 1,
  maxLength,
});

const { $schema: uuidDialect, ...uuid } = z.toJSONSchema(z.string().uuid(), {
  target: "draft-7",
});

void uuidDialect;

const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: "null" }] });

const array = (items: Schema, maxItems: number, minItems = 0): Schema => ({
  type: "array",
  items,
  minItems,
  maxItems,
});

const enumeration = (values: readonly string[]): Schema => ({
  type: "string",
  enum: values,
});

const object = (
  properties: Record<string, Schema>,
  optional: string[] = [],
): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
  additionalProperties: false,
});

const ref = (name: string): Schema => ({ $ref: `#/definitions/${name}` });

const domainRef = (name: string): Schema => ({
  $ref: `domain.schema.json#/definitions/${name}`,
});

const nonnegative: Schema = { type: "number", minimum: 0 };

const counter: Schema = { type: "integer", minimum: 0 };

export const modes = ["LLM_ONLY", "SINGLE_STAGE", "ADAPTIVE"] as const;

export const operations = [
  {
    key: "generate",
    name: "GENERATE_PRACTICE_SESSION",
    method: "generatePracticeSession",
    definition: "Generate",
    domain: "GeneratedPracticeSession",
    path: "/v1/practice/generate",
    useCase: "PRACTICE_GENERATION",
    model: "gpt-5.6-terra",
  },

  {
    key: "evaluate",
    name: "GRADE_PRACTICE_ANSWER",
    method: "gradePracticeAnswer",
    definition: "Evaluate",
    domain: "GradedPracticeAnswer",
    path: "/v1/practice/evaluate",
    useCase: "ANSWER_EVALUATION",
    model: "gpt-5.6-terra",
  },

  {
    key: "normalize",
    name: "SUMMARIZE_PLACEMENT",
    method: "summarizePlacement",
    definition: "Normalize",
    domain: "PlacementSummary",
    path: "/v1/onboarding/normalize",
    useCase: "ONBOARDING",
    model: "gpt-5.6-luna",
  },

  {
    key: "recommend",
    name: "GENERATE_STUDY_RECOMMENDATION",
    method: "generateStudyRecommendation",
    definition: "Recommend",
    domain: "StudyRecommendation",
    path: "/v1/onboarding/recommend",
    useCase: "ONBOARDING",
    model: "gpt-5.6-terra",
  },
] as const;

export type Operation = (typeof operations)[number];

export const errorRules = [
  { code: "INVALID_INPUT", status: 400, retryable: false },
  { code: "AUTH_FAILED", status: 401, retryable: false },
  { code: "FORBIDDEN", status: 403, retryable: false },
  { code: "SNAPSHOT_MISMATCH", status: 409, retryable: false },
  { code: "IDEMPOTENCY_CONFLICT", status: 409, retryable: false },
  { code: "PAYLOAD_TOO_LARGE", status: 413, retryable: false },
  { code: "UNSUPPORTED_MEDIA_TYPE", status: 415, retryable: false },
  { code: "UNSUPPORTED_LEVEL", status: 422, retryable: false },
  { code: "INSUFFICIENT_EVIDENCE", status: 422, retryable: false },
  { code: "POST_VALIDATION_FAILED", status: 422, retryable: false },
  { code: "CAPACITY_LIMIT", status: 429, retryable: true },
  { code: "INTERNAL_ERROR", status: 500, retryable: false },
  { code: "RETRIEVAL_FAILED", status: 502, retryable: true },
  { code: "INFERENCE_FAILED", status: 502, retryable: true },
  { code: "PROVIDER_FAILED", status: 502, retryable: true },
  { code: "PROVIDER_REJECTED", status: 502, retryable: false },
  { code: "PROVIDER_REFUSED", status: 502, retryable: false },
  { code: "SCHEMA_PARSE_FAILED", status: 502, retryable: false },
  { code: "DEPENDENCY_NOT_READY", status: 503, retryable: true },
  { code: "TRACE_WRITE_FAILED", status: 503, retryable: false },
  { code: "TIMEOUT", status: 504, retryable: true },
] as const;

export function artifacts() {
  const sourceSchemas = {
    AiLanguage: app.aiLanguageSchema,
    AiContextBundle: app.contextSchema,
    GeneratedPracticeSession: app.generatedPracticeSchema,
    GradedPracticeAnswer: app.gradedAnswerSchema,
    PlacementSummary: app.placementSchema,
    StudyRecommendation: app.recommendationSchema,
    QuestionType: app.questionTypeSchema,
    DifficultyBand: app.difficultySchema,
  };

  const domain = {
    $schema: draft,
    $id: "https://kotobahub.invalid/contracts/v1/domain.schema.json",
    definitions: Object.fromEntries(
      Object.entries(sourceSchemas).map(([name, schema]) => {
        const { $schema: ignored, ...value } = z.toJSONSchema(schema, {
          target: "draft-7",
        });

        void ignored;

        return [name, value];
      }),
    ),
  };

  const metadata = object(
    {
      requestId: uuid,
      userId: uuid,
      sourceEntityType: enumeration([
        "PRACTICE_SESSION",
        "PRACTICE_ANSWER",
        "PERSONALIZATION_ASSESSMENT",
      ]),
      sourceEntityId: uuid,
    },
    ["userId", "sourceEntityType", "sourceEntityId"],
  );

  const base = {
    context: domainRef("AiContextBundle"),
    language: domainRef("AiLanguage"),
    metadata,
  };

  const question = object({
    skillCode: text(),
    questionType: { const: "FREE_RESPONSE" },
    promptLanguage: enumeration(["EN", "ID"]),
    answerLanguage: { const: "JA" },
    sourceSentence: text(),
    referenceAnswer: text(),
  });

  const payloads = {
    Generate: object(
      {
        ...base,
        questionCount: { type: "integer", minimum: 1, maximum: 20 },
        difficultyBand: domainRef("DifficultyBand"),
        questionMix: object(
          Object.fromEntries(
            ["WEAK", "REINFORCEMENT", "STRETCH"].map((k) => [
              k,
              { type: "number", minimum: 0, maximum: 1 },
            ]),
          ),
        ),
      },
      ["questionMix"],
    ),
    Evaluate: object({
      ...base,
      question,
      userAnswer: object({
        rawInputRomaji: { type: "string", maxLength: 2000 },
        normalizedKana: text(),
        normalizedKanji: nullable({ type: "string", maxLength: 2000 }),
      }),
    }),
    Normalize: object({ ...base, note: text(5000) }),
    Recommend: object(base),
  };

  const meta = object({
    trace_id: uuid,
    corpus_version: text(128),
    path: enumeration(["LLM_ONLY", "SINGLE_STAGE", "FAST", "DEEP"]),
    sources: array(object({ source_id: text(256), chunk_id: text(256) }), 100),
    duration_ms: nonnegative,
    usage: object({
      input_tokens: nullable(counter),
      cached_input_tokens: nullable(counter),
      output_tokens: nullable(counter),
      total_tokens: nullable(counter),
    }),
    cost: object({
      currency: { const: "USD" },
      inference_total_usd: nullable(nonnegative),
      query_embedding_usd: nullable(nonnegative),
      rerank_usd: nullable(nonnegative),
      total_online_usd: nullable(nonnegative),
      known_subtotal_usd: nonnegative,
      status: enumeration(["KNOWN", "PARTIAL", "UNKNOWN"]),
    }),
    counters: object(
      Object.fromEntries(
        [
          "retrieval_stage_count",
          "rewrite_call_count",
          "rerank_call_count",
          "provider_retry_count",
          "schema_retry_count",
          "model_call_count",
        ].map((k) => [k, counter]),
      ),
    ),
  });

  const definitions: Record<string, Schema> = { Meta: meta };

  const responseBase = {
    schema_version: { const: "1" },
    request_id: uuid,
    execution_id: uuid,
    mode: enumeration(modes),
  };

  for (const op of operations) {
    definitions[`${op.definition}Payload`] = payloads[op.definition];
    definitions[`${op.definition}Request`] = object(
      {
        schema_version: { const: "1" },
        request_id: uuid,
        mode: enumeration(modes),
        corpus_version: text(128),
        timeout_ms: { type: "integer", minimum: 100, maximum: 120000 },
        deadline_at: { type: "string", format: "date-time", pattern: "Z$" },
        experiment: object({
          experiment_id: text(128),
          case_id: text(128),
          repetition: { type: "integer", minimum: 1 },
        }),
        payload: ref(`${op.definition}Payload`),
      },
      ["experiment"],
    );
    definitions[`${op.definition}Response`] = object({
      ...responseBase,
      data: domainRef(op.domain),
      meta: ref("Meta"),
    });
  }

  definitions.ErrorResponse = object({
    ...responseBase,
    request_id: nullable(uuid),
    execution_id: nullable(uuid),
    mode: nullable(enumeration(modes)),
    error: {
      oneOf: errorRules.map((rule) =>
        object({
          code: { const: rule.code },
          message: text(500),
          retryable: { const: rule.retryable },
        }),
      ),
    },
    meta: object({ trace_id: uuid }),
  });
  definitions.HealthResponse = object({
    status: enumeration(["live", "ready", "not_ready"]),
  });

  const wire = {
    $schema: draft,
    $id: "https://kotobahub.invalid/contracts/v1/contract.schema.json",
    definitions,
  };

  const json = (name: string) => ({
    "application/json": {
      schema: { $ref: `./contract.schema.json#/definitions/${name}` },
    },
  });

  const responses = Object.fromEntries(
    [...new Set(errorRules.map((e) => e.status))].map((status) => [
      status,
      {
        description: errorRules
          .filter((e) => e.status === status)
          .map((e) => e.code)
          .join(", "),
        content: json("ErrorResponse"),
      },
    ]),
  );

  const openapi = {
    openapi: "3.1.0",
    jsonSchemaDialect: draft,
    info: {
      title: "KotobaHub RAG",
      version: "1.0.0",
      description:
        "Kontrak CON-01; endpoint runtime belum diimplementasikan. Aturan semantik: ../../docs/contracts/CON-01.md.",
    },
    security: [{ serviceBearer: [] }],
    paths: Object.fromEntries([
      ...operations.map((op) => [
        op.path,
        {
          post: {
            operationId: op.method,
            summary: op.name,
            parameters: [
              {
                in: "header",
                name: "X-Request-ID",
                required: false,
                schema: uuid,
                description:
                  "Jika dikirim, harus sama dengan request_id dan payload.metadata.requestId.",
              },
            ],
            requestBody: {
              required: true,
              content: json(`${op.definition}Request`),
            },
            responses: {
              "200": {
                description: "Data domain tervalidasi",
                content: json(`${op.definition}Response`),
              },
              ...responses,
            },
            "x-use-case": op.useCase,
            "x-generation-model": op.model,
            "x-body-limit-bytes": 1048576,
          },
        },
      ]),
      ...["live", "ready"].map((name) => [
        `/health/${name}`,
        {
          get: {
            operationId: name === "live" ? "liveness" : "readiness",
            description:
              "Tanpa inferensi berbayar; memakai status dependency terakhir.",
            responses: {
              "200": { description: name, content: json("HealthResponse") },
              ...(name === "ready"
                ? {
                    "503": {
                      description: "not_ready",
                      content: json("HealthResponse"),
                    },
                  }
                : {}),
            },
          },
        },
      ]),
    ]),
    components: {
      securitySchemes: {
        serviceBearer: {
          type: "http",
          scheme: "bearer",
          description:
            "Kredensial service internal melalui TLS; bukan API key provider.",
        },
      },
    },
  };

  return { domain, wire, openapi, sourceSchemas };
}
