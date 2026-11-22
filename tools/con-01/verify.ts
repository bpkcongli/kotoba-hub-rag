import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { AiServiceImpl } from "kotoba-app/src/backend/shared/application/services/impl/ai.service.impl";
import { readAiEnv } from "kotoba-app/src/backend/shared/infrastructure/config/ai-env";
import type { AiProviderPort } from "kotoba-app/src/backend/shared/application/ports/ai-provider.port";
import type {
  AiRequestLogRepository,
  AiLogCompletion,
} from "kotoba-app/src/backend/shared/domain/repositories/ai-request-log.repository";
import type { GeneratePracticeSessionInput } from "kotoba-app/src/backend/shared/application/services/requests/ai-request";
import { artifacts, operations, modes, errorRules } from "./definition";
import { fixtures, type Fixture, type Inputs, type Request } from "./fixtures";

const sourcePaths = [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "src/backend/shared/application/helpers/ai-schemas.ts",
  "src/backend/shared/application/helpers/ai-templates.ts",
  "src/backend/shared/application/services/requests/ai-request.ts",
  "src/backend/shared/application/services/responses/ai-response.ts",
  "src/backend/shared/application/services/ai.service.ts",
  "src/backend/shared/application/services/impl/ai.service.impl.ts",
  "src/backend/shared/application/ports/ai-provider.port.ts",
  "src/backend/shared/domain/exceptions/ai-failure.ts",
  "src/backend/shared/domain/repositories/ai-request-log.repository.ts",
  "src/backend/shared/interface/secondary/ai/openai-provider.ts",
  "src/backend/shared/interface/secondary/persistence/drizzle-ai-request-log.repository.ts",
  "src/backend/shared/infrastructure/config/ai-env.ts",
  "src/backend/shared/infrastructure/di/index.ts",
  "src/backend/shared/infrastructure/database/ai-schema.ts",
  "src/backend/practice/interface/secondary/ai/practice-ai.adapter.ts",
  "src/backend/practice/application/services/impl/practice.service.impl.ts",
  "src/backend/practice/infrastructure/di/index.ts",
  "src/backend/personalization/interface/secondary/ai/placement-normalization.adapter.ts",
  "src/backend/personalization/application/services/impl/assessment.service.impl.ts",
  "src/backend/personalization/application/services/impl/recommendation.service.impl.ts",
  "src/backend/personalization/infrastructure/di/index.ts",
];

const encode = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

async function git(app: string, ...args: string[]) {
  return (
    await promisify(execFile)("git", ["-C", app, ...args], { encoding: "utf8" })
  ).stdout.trim();
}

function probe(output: unknown, maxRetries = 0, unknownUsage = false) {
  const calls: Parameters<AiProviderPort["generate"]>[0][] = [];

  const completions: AiLogCompletion[] = [];

  const provider: AiProviderPort = {
    name: "CONTRACT_MOCK",
    async generate(input) {
      calls.push(input);

      return {
        outputText: JSON.stringify(output),
        providerRequestId: "synthetic-provider-request",
        usage: unknownUsage
          ? null
          : {
              inputTokens: 100,
              cachedInputTokens: 20,
              outputTokens: 50,
              totalTokens: 150,
            },
      };
    },
  };

  const logs: AiRequestLogRepository = {
    async start() {},
    async recordAttempt() {},
    async complete(_id, data) {
      completions.push(data);
    },
  };

  const config = {
    ...readAiEnv({}),
    maxRetries,
    retryDelayMs: 0,
    maxInputChars: 100000,
  };

  return {
    calls,
    completions,
    service: new AiServiceImpl(provider, logs, config, async () => {}),
  };
}

async function invoke(service: AiServiceImpl, fixture: Fixture) {
  switch (fixture.operation) {
    case "generate":
      return service.generatePracticeSession(fixture.request.payload);
    case "evaluate":
      return service.gradePracticeAnswer(fixture.request.payload);
    case "normalize":
      return service.summarizePlacement(fixture.request.payload);
    case "recommend":
      return service.generateStudyRecommendation(fixture.request.payload);
  }
}

export async function run() {
  globalThis.fetch = async () => {
    throw new Error("Jaringan dinonaktifkan pada audit CON-01.");
  };

  const root = process.env.CON01_ROOT;

  const app = process.env.CON01_APP;

  if (!root || !app) throw new Error("Jalankan melalui tools/con-01/run.mjs.");

  const startStatus = await git(app, "status", "--porcelain=v1");

  const source = {
    audited_on: "2026-11-23",
    repository: "kotoba-hub",
    commit: await git(app, "rev-parse", "HEAD"),
    working_tree_status: startStatus.split("\n").filter(Boolean),
    files: Object.fromEntries(
      await Promise.all(
        sourcePaths.map(async (p) => [
          p,
          sha256(await readFile(resolve(app, p))),
        ]),
      ),
    ),
  };

  const { domain, wire, openapi, sourceSchemas } = artifacts();

  const examples = fixtures();

  const outputs = {
    "domain.schema.json": domain,
    "contract.schema.json": wire,
    "openapi.json": openapi,
    "fixtures.json": {
      description:
        "Fixture sintetis CON-01; bukan hasil runtime atau dataset eksperimen.",
      cases: examples,
    },
    "errors.json": errorRules,
    "source-manifest.json": source,
  };

  if (process.argv[2] === "export") {
    for (const [name, data] of Object.entries(outputs))
      await writeFile(resolve(root, "contracts/v1", name), encode(data));
  }

  for (const [name, data] of Object.entries(outputs)) {
    assert.equal(
      await readFile(resolve(root, "contracts/v1", name), "utf8"),
      encode(data),
      `${name} drift; audit source sebelum export ulang.`,
    );
  }

  const ajv = new Ajv({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  });

  addFormats(ajv);
  ajv.addSchema(domain).addSchema(wire);

  const wireId = wire.$id;

  for (const name of Object.keys(wire.definitions))
    ajv.compile({ $ref: `${wireId}#/definitions/${name}` });

  const records: { name: string; status: "passed" }[] = [];

  async function check(name: string, fn: () => void | Promise<void>) {
    await fn();
    records.push({ name, status: "passed" });
  }

  const validators = Object.fromEntries(
    operations.map((op) => [
      op.key,
      {
        request: ajv.compile<Request<Inputs[keyof Inputs]>>({
          $ref: `${wireId}#/definitions/${op.definition}Request`,
        }),
        response: ajv.compile({
          $ref: `${wireId}#/definitions/${op.definition}Response`,
        }),
      },
    ]),
  );

  function requestError(
    op: Fixture["operation"],
    request: unknown,
    header?: string,
  ): string | null {
    const validator = validators[op];

    assert(validator);

    if (!validator.request(request)) return "INVALID_INPUT";

    const { payload } = request;

    if (
      payload.context.targetLevel === "JLPT_N3" ||
      payload.context.targetLevel === "JLPT_N2"
    )
      return "UNSUPPORTED_LEVEL";

    if (
      request.request_id !== payload.metadata.requestId ||
      (header !== undefined && header !== request.request_id)
    )
      return "INVALID_INPUT";

    if (request.corpus_version !== "synthetic-contract-v1")
      return "SNAPSHOT_MISMATCH";

    // Fixed clock fixture; tidak membaca wall clock untuk membuat acceptance berubah.
    if (Date.parse(request.deadline_at) <= Date.parse("2026-11-23T12:00:00Z"))
      return "TIMEOUT";

    if (op === "normalize" && "note" in payload && !payload.note.trim())
      return "INVALID_INPUT";

    if (op === "generate" && "questionMix" in payload && payload.questionMix) {
      const mix = payload.questionMix;

      if (Math.abs(mix.WEAK + mix.REINFORCEMENT + mix.STRETCH - 1) >= 0.000001)
        return "INVALID_INPUT";
    }

    // Context/domain refinements diperiksa lewat AiServiceImpl aktual di bawah.
    return null;
  }

  // Oracle spesifikasi metadata v1; runtime wajib mengimplementasikan invariant ini.
  function responseError(fixture: Fixture): string | null {
    const { request, response } = fixture;

    const validator = validators[fixture.operation];

    assert(validator);

    if (!validator.response(response)) return "INVALID_ENVELOPE";

    if (
      response.request_id !== request.request_id ||
      response.mode !== request.mode ||
      response.meta.corpus_version !== request.corpus_version
    )
      return "CORRELATION_MISMATCH";

    const { meta } = response;

    const counts = meta.counters;

    if (counts.retrieval_stage_count > 2 || counts.rewrite_call_count > 1)
      return "UNBOUNDED_STAGE";

    if (
      response.mode === "LLM_ONLY" &&
      (meta.path !== "LLM_ONLY" ||
        meta.sources.length ||
        counts.retrieval_stage_count ||
        counts.rewrite_call_count ||
        counts.rerank_call_count)
    )
      return "MODE_MISMATCH";

    if (
      response.mode === "SINGLE_STAGE" &&
      (meta.path !== "SINGLE_STAGE" ||
        counts.retrieval_stage_count !== 1 ||
        counts.rewrite_call_count ||
        counts.rerank_call_count)
    )
      return "MODE_MISMATCH";

    if (response.mode === "ADAPTIVE" && !["FAST", "DEEP"].includes(meta.path))
      return "MODE_MISMATCH";

    if (
      meta.path === "FAST" &&
      (counts.retrieval_stage_count !== 1 ||
        counts.rewrite_call_count ||
        counts.rerank_call_count)
    )
      return "MODE_MISMATCH";

    if (
      meta.path === "DEEP" &&
      (counts.retrieval_stage_count !== 2 || counts.rerank_call_count < 1)
    )
      return "MODE_MISMATCH";

    const usage = meta.usage;

    if (
      [
        usage.input_tokens,
        usage.cached_input_tokens,
        usage.output_tokens,
        usage.total_tokens,
      ].some((v) => v === null)
    ) {
      if (
        [
          usage.input_tokens,
          usage.cached_input_tokens,
          usage.output_tokens,
          usage.total_tokens,
        ].some((v) => v !== null)
      )
        return "PARTIAL_USAGE";
    } else if (
      usage.input_tokens !== null &&
      usage.output_tokens !== null &&
      usage.cached_input_tokens !== null &&
      (usage.cached_input_tokens > usage.input_tokens ||
        usage.total_tokens !== usage.input_tokens + usage.output_tokens)
    )
      return "INVALID_USAGE";

    const cost = meta.cost;

    if (
      response.mode === "LLM_ONLY" &&
      (cost.query_embedding_usd !== 0 || cost.rerank_usd !== 0)
    )
      return "MODE_COST_MISMATCH";

    if (!counts.rerank_call_count && cost.rerank_usd !== 0)
      return "MODE_COST_MISMATCH";

    const components = [
      cost.inference_total_usd,
      cost.query_embedding_usd,
      cost.rerank_usd,
    ];

    const known = components.filter((v): v is number => v !== null);

    const subtotal = known.reduce((a, b) => a + b, 0);

    const same = (a: number, b: number) => Math.abs(a - b) < 1e-12;

    if (!same(cost.known_subtotal_usd, subtotal))
      return "DOUBLE_COUNT_OR_MISSING_COST";

    if (known.length === components.length) {
      if (
        cost.total_online_usd === null ||
        !same(cost.total_online_usd, subtotal) ||
        cost.status !== "KNOWN"
      )
        return "INVALID_TOTAL_COST";
    } else if (
      cost.total_online_usd !== null ||
      cost.status !== (subtotal > 0 ? "PARTIAL" : "UNKNOWN")
    )
      return "UNKNOWN_COST_AS_KNOWN";

    return null;
  }

  // Resolve seluruh $ref OpenAPI, termasuk berkas/dialek schema eksternal, tanpa network.
  await check(
    "OpenAPI: empat operasi, dua health dan seluruh referensi schema",
    () => {
      assert.equal(openapi.openapi, "3.1.0");
      assert.equal(Object.keys(openapi.paths).length, 6);

      const visit = (value: unknown): void => {
        if (!value || typeof value !== "object") return;

        if ("$ref" in value && typeof value.$ref === "string") {
          const [file, fragment] = value.$ref.split("#");

          assert.equal(file, "./contract.schema.json");
          assert(fragment?.startsWith("/definitions/"));
          ajv.compile({ $ref: `${wireId}#${fragment}` });
        }

        for (const child of Object.values(value)) visit(child);
      };

      visit(openapi);
    },
  );

  for (const fixture of examples) {
    const op = operations.find((o) => o.key === fixture.operation);

    assert(op);

    const validator = validators[fixture.operation];

    assert(validator);

    for (const mode of modes) {
      await check(
        `${fixture.id}/${mode}: wire, schema aplikasi, domain aplikasi dan model`,
        async () => {
          const request = { ...structuredClone(fixture.request), mode };

          const response = { ...structuredClone(fixture.response), mode };

          response.meta.path = mode === "ADAPTIVE" ? "FAST" : mode;

          if (mode === "LLM_ONLY") {
            response.meta.sources = [];
            response.meta.counters.retrieval_stage_count = 0;
            response.meta.counters.model_call_count = 1;
            response.meta.cost.query_embedding_usd = 0;
          }

          assert.equal(
            responseError({ ...fixture, request, response } as Fixture),
            null,
          );

          const before = encode(request);

          assert.equal(requestError(fixture.operation, request), null);
          assert(
            validator.response(response),
            encode(validator.response.errors),
          );
          assert.equal(
            encode(request),
            before,
            "Validator tidak boleh mengubah request.",
          );
          sourceSchemas[op.domain].parse(fixture.response.data);

          const p = probe(fixture.response.data);

          assert.deepEqual(
            await invoke(p.service, fixture),
            fixture.response.data,
          );
          assert.equal(p.calls.length, 1);

          const call = p.calls[0];

          assert(call);
          assert.equal(call.model, op.model);

          const modelInput: unknown = JSON.parse(call.input);

          assert(modelInput && typeof modelInput === "object");

          for (const field of ["metadata", "experiment", "mode", "request_id"])
            assert(!(field in modelInput));

          assert(!call.input.includes(fixture.request.request_id));
        },
      );
    }
  }

  const gen = examples.find((f) => f.operation === "generate");

  const grade = examples.find((f) => f.operation === "evaluate");

  const norm = examples.find((f) => f.operation === "normalize");

  const rec = examples.find((f) => f.operation === "recommend");

  assert(
    gen?.operation === "generate" &&
      grade?.operation === "evaluate" &&
      norm?.operation === "normalize" &&
      rec?.operation === "recommend",
  );

  const badMetadata: [string, (candidate: Fixture) => void, string][] = [
    [
      "mode/path konflik",
      (f) => {
        f.response.meta.path = "DEEP";
      },
      "MODE_MISMATCH",
    ],
    [
      "corpus konflik",
      (f) => {
        f.response.meta.corpus_version = "unknown";
      },
      "CORRELATION_MISMATCH",
    ],
    [
      "stage tidak terbatas",
      (f) => {
        f.response.meta.counters.retrieval_stage_count = 3;
      },
      "UNBOUNDED_STAGE",
    ],
    [
      "cached tokens melebihi input",
      (f) => {
        f.response.meta.usage.cached_input_tokens = 101;
      },
      "INVALID_USAGE",
    ],
    [
      "usage unknown sebagian",
      (f) => {
        f.response.meta.usage.input_tokens = null;
      },
      "PARTIAL_USAGE",
    ],
    [
      "unknown cost menjadi nol",
      (f) => {
        f.response.meta.cost.total_online_usd = 0;
      },
      "UNKNOWN_COST_AS_KNOWN",
    ],
    [
      "double count subtotal",
      (f) => {
        f.response.meta.cost.known_subtotal_usd = 1;
      },
      "DOUBLE_COUNT_OR_MISSING_COST",
    ],
  ];

  for (const [name, mutate, error] of badMetadata)
    await check(`Metadata: ${name}`, () => {
      const candidate = structuredClone(gen);

      mutate(candidate);
      assert.equal(responseError(candidate), error);
    });

  await check(
    "Metadata: total online menjumlahkan tiga subtotal sekali",
    () => {
      const candidate = structuredClone(gen);

      candidate.response.meta.cost = {
        currency: "USD",
        inference_total_usd: 0.1,
        query_embedding_usd: 0.02,
        rerank_usd: 0,
        total_online_usd: 0.12,
        known_subtotal_usd: 0.12,
        status: "KNOWN",
      };
      assert.equal(responseError(candidate), null);
    },
  );

  await check("Metadata: usage unknown seluruhnya valid", () => {
    const candidate = structuredClone(gen);

    candidate.response.meta.usage = {
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      total_tokens: null,
    };
    assert.equal(responseError(candidate), null);
  });

  const invalidRequests: [string, unknown, string][] = [
    [
      "UUID version invalid",
      { ...gen.request, request_id: "70000000-0000-9000-8000-000000000001" },
      "INVALID_INPUT",
    ],
    ["mode tidak dikenal", { ...gen.request, mode: "AUTO" }, "INVALID_INPUT"],
    [
      "extra envelope",
      { ...gen.request, expected_route: "deep" },
      "INVALID_INPUT",
    ],
    ["payload kosong", { ...gen.request, payload: {} }, "INVALID_INPUT"],
    [
      "angka berupa string",
      {
        ...gen.request,
        payload: { ...gen.request.payload, questionCount: "5" },
      },
      "INVALID_INPUT",
    ],
    [
      "extra payload",
      {
        ...gen.request,
        payload: { ...gen.request.payload, answer_key: "leaked" },
      },
      "INVALID_INPUT",
    ],
    [
      "extra context",
      {
        ...gen.request,
        payload: {
          ...gen.request.payload,
          context: {
            ...gen.request.payload.context,
            otherLearnerEmail: "synthetic@example.test",
          },
        },
      },
      "INVALID_INPUT",
    ],
    [
      "metadata ID berbeda",
      { ...gen.request, request_id: "70000000-0000-4000-8000-000000000099" },
      "INVALID_INPUT",
    ],
    [
      "snapshot berbeda",
      { ...gen.request, corpus_version: "unknown" },
      "SNAPSHOT_MISMATCH",
    ],
    ["deadline nol", { ...gen.request, timeout_ms: 0 }, "INVALID_INPUT"],
    [
      "deadline melebihi ceiling",
      { ...gen.request, timeout_ms: 120001 },
      "INVALID_INPUT",
    ],
    [
      "deadline expired",
      { ...gen.request, deadline_at: "2026-11-23T11:59:59Z" },
      "TIMEOUT",
    ],
    [
      "locale kosong",
      { ...gen.request, payload: { ...gen.request.payload, language: {} } },
      "INVALID_INPUT",
    ],
    [
      "locale ja",
      {
        ...gen.request,
        payload: {
          ...gen.request.payload,
          language: {
            instructionLocale: "ja",
            feedbackLocale: "en",
            translationLocale: "en",
          },
        },
      },
      "INVALID_INPUT",
    ],
    [
      "locale dihilangkan",
      {
        ...gen.request,
        payload: { ...gen.request.payload, language: undefined },
      },
      "INVALID_INPUT",
    ],
    [
      "questionMix bukan satu",
      {
        ...gen.request,
        payload: {
          ...gen.request.payload,
          questionMix: { WEAK: 1, REINFORCEMENT: 1, STRETCH: 1 },
        },
      },
      "INVALID_INPUT",
    ],
  ];

  for (const level of ["JLPT_N3", "JLPT_N2"])
    invalidRequests.push([
      level,
      {
        ...gen.request,
        payload: {
          ...gen.request.payload,
          context: { ...gen.request.payload.context, targetLevel: level },
        },
      },
      "UNSUPPORTED_LEVEL",
    ]);

  for (const [name, value, expected] of invalidRequests)
    await check(`Request: ${name}`, () =>
      assert.equal(requestError("generate", value), expected),
    );

  await check("Request: X-Request-ID konflik", () =>
    assert.equal(
      requestError(
        "generate",
        gen.request,
        "70000000-0000-4000-8000-000000000099",
      ),
      "INVALID_INPUT",
    ),
  );

  await check("Request: metadata eksperimen opsional", () => {
    const request = structuredClone(gen.request);

    delete request.experiment;
    assert.equal(requestError("generate", request), null);
  });

  await check("Request: note whitespace ditolak", () =>
    assert.equal(
      requestError("normalize", {
        ...norm.request,
        payload: { ...norm.request.payload, note: "   " },
      }),
      "INVALID_INPUT",
    ),
  );

  await check("Request: grading objective ditolak", () => {
    assert.equal(
      requestError("evaluate", {
        ...grade.request,
        payload: {
          ...grade.request.payload,
          question: {
            ...grade.request.payload.question,
            questionType: "SLOT_FILL",
          },
        },
      }),
      "INVALID_INPUT",
    );
  });

  const badOutputs: [
    string,
    (f: Extract<Fixture, { operation: "generate" }>) => void,
  ][] = [
    [
      "jumlah soal",
      (f) => {
        f.response.data.questions.pop();
      },
    ],
    [
      "skill di luar katalog",
      (f) => {
        const q = f.response.data.questions[0];

        assert(q);
        q.skillCode = "unknown";
      },
    ],
    [
      "difficulty",
      (f) => {
        const q = f.response.data.questions[0];

        assert(q);
        q.difficultyBand = "STRETCH";
      },
    ],
    [
      "blank ganda",
      (f) => {
        const q = f.response.data.questions[0];

        assert(q?.questionType === "SHORT_FREE_RESPONSE");
        q.promptPayload.sentenceTemplate = "___は___です。";
      },
    ],
    [
      "jawaban short kanji",
      (f) => {
        const q = f.response.data.questions[0];

        assert(q?.questionType === "SHORT_FREE_RESPONSE");
        q.expectedAnswer.acceptedTextAnswers = ["学生"];
      },
    ],
    [
      "option ID duplikat",
      (f) => {
        const q = f.response.data.questions[1];

        assert(q?.questionType === "SLOT_FILL");

        const a = q.promptPayload.options[0];

        const b = q.promptPayload.options[1];

        assert(a && b);
        b.id = a.id;
      },
    ],
    [
      "option label duplikat",
      (f) => {
        const q = f.response.data.questions[1];

        assert(q?.questionType === "SLOT_FILL");

        const a = q.promptPayload.options[0];

        const b = q.promptPayload.options[1];

        assert(a && b);
        b.label = a.label;
      },
    ],
    [
      "correctOptionId hilang",
      (f) => {
        const q = f.response.data.questions[1];

        assert(q?.questionType === "SLOT_FILL");
        q.expectedAnswer.correctOptionId = "missing";
      },
    ],
    [
      "token order bukan permutasi",
      (f) => {
        const q = f.response.data.questions[2];

        assert(q?.questionType === "ARRANGE_TOKEN");
        q.expectedAnswer.acceptedTokenOrders = [["t1", "t1"]];
      },
    ],
    [
      "arah terjemahan salah",
      (f) => {
        const q = f.response.data.questions[2];

        assert(q?.questionType === "ARRANGE_TOKEN");
        q.promptPayload.direction = "ID_TO_JA";
      },
    ],
    [
      "FREE_RESPONSE locale salah",
      (f) => {
        const q = f.response.data.questions[4];

        assert(q?.questionType === "FREE_RESPONSE");
        q.promptPayload.promptLanguage = "ID";
      },
    ],
    [
      "tipe tidak diizinkan",
      (f) => {
        f.request.payload.context.allowedQuestionTypes = [
          "SHORT_FREE_RESPONSE",
        ];
      },
    ],
  ];

  for (const [name, mutate] of badOutputs)
    await check(`Domain aplikasi: ${name}`, async () => {
      const candidate = structuredClone(gen);

      mutate(candidate);

      const p = probe(candidate.response.data);

      await assert.rejects(invoke(p.service, candidate), {
        code: "INVALID_OUTPUT",
      });
      assert.equal(p.calls.length, 1);
    });

  const badContext: [string, (input: GeneratePracticeSessionInput) => void][] =
    [
      [
        "duplicate skill",
        (p) => {
          const skill = p.context.catalog[0];

          assert(skill);
          p.context.catalog.push(skill);
        },
      ],
      [
        "current unit di luar katalog",
        (p) => {
          p.context.currentUnitSlug = "unknown";
        },
      ],
      [
        "weak skill di luar katalog",
        (p) => {
          p.context.weakSkillCodes = ["unknown"];
        },
      ],
      [
        "lesson understanding di luar katalog",
        (p) => {
          p.context.lessonUnderstanding = [{ lessonSlug: "unknown", level: 1 }];
        },
      ],
    ];

  for (const [name, mutate] of badContext)
    await check(`Input aplikasi: ${name}`, async () => {
      const input = structuredClone(gen.request.payload);

      mutate(input);

      const p = probe(gen.response.data);

      await assert.rejects(p.service.generatePracticeSession(input), {
        code: "INVALID_INPUT",
      });
      assert.equal(p.calls.length, 0);
    });

  await check(
    "Input aplikasi: grading locale konflik sebelum provider",
    async () => {
      const input = structuredClone(grade.request.payload);

      input.question.promptLanguage = "ID";

      const p = probe(grade.response.data);

      await assert.rejects(p.service.gradePracticeAnswer(input), {
        code: "INVALID_INPUT",
      });
      assert.equal(p.calls.length, 0);
    },
  );

  await check("Input aplikasi: tiga locale independen", async () => {
    const input = structuredClone(gen.request.payload);

    input.language = {
      instructionLocale: "id",
      feedbackLocale: "id",
      translationLocale: "en",
    };
    assert.deepEqual(
      await probe(gen.response.data).service.generatePracticeSession(input),
      gen.response.data,
    );
  });

  await check(
    "Domain aplikasi: rekomendasi relasi lesson/unit/track",
    async () => {
      const data = { ...rec.response.data, recommendedUnitSlug: "unknown" };

      await assert.rejects(
        probe(data).service.generateStudyRecommendation(rec.request.payload),
        { code: "INVALID_OUTPUT" },
      );
    },
  );

  await check("Domain aplikasi: placement claims duplikat", async () => {
    const claim = norm.response.data.suggestedKnownSkillClaims[0];

    assert(claim);
    await assert.rejects(
      probe({
        suggestedKnownSkillClaims: [claim, claim],
      }).service.summarizePlacement(norm.request.payload),
      { code: "INVALID_OUTPUT" },
    );
  });

  await check("Domain aplikasi: placement claims di luar katalog", async () => {
    await assert.rejects(
      probe({
        suggestedKnownSkillClaims: [{ skillCode: "unknown", confidence: 0.9 }],
      }).service.summarizePlacement(norm.request.payload),
      { code: "INVALID_OUTPUT" },
    );
  });

  await check("Domain aplikasi: placement claims kosong valid", async () => {
    assert.deepEqual(
      await probe({ suggestedKnownSkillClaims: [] }).service.summarizePlacement(
        norm.request.payload,
      ),
      { suggestedKnownSkillClaims: [] },
    );
  });

  await check("Output strict: metadata ditolak dalam data", async () => {
    const p = probe({ ...grade.response.data, trace_id: "unexpected" });

    await assert.rejects(p.service.gradePracticeAnswer(grade.request.payload), {
      code: "INVALID_OUTPUT",
    });

    const validator = validators.evaluate;

    assert(validator);
    assert.equal(
      validator.response({
        ...grade.response,
        data: { ...grade.response.data, trace_id: "unexpected" },
      }),
      false,
    );
  });

  await check(
    "Output grading: numericScore >100 ditolak kedua validator",
    async () => {
      const data = { ...grade.response.data, numericScore: 101 };

      const validator = validators.evaluate;

      assert(validator);
      assert.equal(validator.response({ ...grade.response, data }), false);
      await assert.rejects(
        probe(data).service.gradePracticeAnswer(grade.request.payload),
        { code: "INVALID_OUTPUT" },
      );
    },
  );

  await check(
    "Retry aplikasi: dua attempt dan usage terakumulasi",
    async () => {
      const p = probe({}, 1);

      await assert.rejects(p.service.summarizePlacement(norm.request.payload), {
        code: "INVALID_OUTPUT",
      });
      assert.equal(p.calls.length, 2);
      assert.equal(p.completions[0]?.usage?.totalTokens, 300);
      assert.equal(p.completions[0]?.retryCount, 1);
    },
  );

  await check("Biaya aplikasi: missing usage tetap null", async () => {
    const p = probe(norm.response.data, 0, true);

    await p.service.summarizePlacement(norm.request.payload);
    assert.equal(p.completions[0]?.estimatedCostUsd, null);
    assert.equal(p.completions[0]?.usage, null);
  });

  const errorValidator = ajv.compile({
    $ref: `${wireId}#/definitions/ErrorResponse`,
  });

  for (const rule of errorRules)
    await check(`Error envelope: ${rule.code}/${rule.status}`, () => {
      const error = {
        schema_version: "1",
        request_id: null,
        execution_id: null,
        mode: null,
        error: {
          code: rule.code,
          message: "Pesan aman sintetis.",
          retryable: rule.retryable,
        },
        meta: { trace_id: "70000000-0000-4000-8000-000000000003" },
      };

      assert(errorValidator(error));
      assert.equal(
        errorValidator({
          ...error,
          error: { ...error.error, retryable: !rule.retryable },
        }),
        false,
      );
    });

  assert.equal(
    await git(app, "status", "--porcelain=v1"),
    startStatus,
    "Working tree aplikasi berubah.",
  );

  for (const [path, hash] of Object.entries(source.files))
    assert.equal(sha256(await readFile(resolve(app, path))), hash);

  const evidence = {
    task: "CON-01",
    audited_on: "2026-11-23",
    verified_at_utc: new Date().toISOString(),
    node: process.version,
    source_commit: source.commit,
    dependencies: {
      zod: "4.6.5",
      ajv: "8.20.0",
      "ajv-formats": "3.0.1",
      typescript: "5.9.3",
      esbuild: "0.25.12",
    },
    command: [process.execPath, "tools/con-01/run.mjs", process.argv[2]],
    typecheck: {
      status: "passed",
      strict: true,
      no_unchecked_indexed_access: true,
      optional_semantics: "existing app tsconfig",
    },
    tooling_sha256: Object.fromEntries(
      await Promise.all(
        ["run.mjs", "definition.ts", "fixtures.ts", "verify.ts"].map(
          async (name) => [
            name,
            sha256(await readFile(resolve(root, "tools/con-01", name))),
          ],
        ),
      ),
    ),
    fixture_pairs: examples.length,
    modes_checked: modes,
    passed: records.length,
    failed: 0,
    app_working_tree_unchanged: true,
    network_calls: 0,
    paid_calls: 0,
    database_writes: 0,
    artifacts_sha256: Object.fromEntries(
      Object.entries(outputs).map(([name, value]) => [
        name,
        sha256(encode(value)),
      ]),
    ),
    checks: records,
    limitations: [
      "Tidak ada HTTP runtime RAG, adapter aplikasi baru, persistence, auth/deadline/retry remote, atau provider nyata yang dijalankan.",
      "Tiga mode menguji bentuk envelope; app validator yang sama dipanggil dengan mock. Ini bukan bukti pipeline tiga mode sudah ada.",
      "Pemeriksaan OpenAPI meliputi struktur operasi dan resolusi semua schema refs; bukan sertifikasi validator OpenAPI eksternal.",
      "Fixture bukan validasi konten Jepang oleh manusia atau hasil eksperimen.",
    ],
  };

  await writeFile(
    resolve(root, "contracts/v1/evidence.json"),
    encode(evidence),
  );
  console.log(
    `${records.length} pemeriksaan lulus; ${examples.length} pasangan fixture × ${modes.length} mode; 0 network/paid calls.`,
  );
}
