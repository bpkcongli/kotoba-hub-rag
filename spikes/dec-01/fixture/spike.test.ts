import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

await test("Fastify preserves Japanese and rejects extra properties/type coercion", async () => {
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  app.post<{ Body: { text: string; language: "EN" | "ID" } }>(
    "/spike",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["text", "language"],
          properties: {
            text: { type: "string", minLength: 1 },
            language: { type: "string", enum: ["EN", "ID"] },
          },
        },
      },
    },
    (request) => request.body,
  );
  try {
    const valid = await app.inject({
      method: "POST",
      url: "/spike",
      payload: { text: "日本語", language: "ID" },
    });
    assert.equal(valid.statusCode, 200);
    assert.equal(
      valid.body,
      JSON.stringify({ text: "日本語", language: "ID" }),
    );
    for (const payload of [
      { text: "日本語", language: "JA" },
      { text: 123, language: "ID" },
      { text: "日本語", language: "ID", extra: true },
    ]) {
      assert.equal(
        (await app.inject({ method: "POST", url: "/spike", payload }))
          .statusCode,
        400,
      );
    }
  } finally {
    await app.close();
  }
});

await test("OpenAI SDK imports and exposes Responses without a provider call", () => {
  const client = new OpenAI({
    apiKey: "offline-spike-placeholder",
    maxRetries: 0,
  });
  assert.equal(typeof client.responses.create, "function");
});

await test("Qdrant client/server supports named dense+sparse query and RRF", async () => {
  const endpoint = process.env["DEC01_QDRANT_URL"];
  assert.ok(endpoint, "Run against the temporary Qdrant server, not a mock");
  const url = new URL(endpoint);
  assert.equal(
    url.hostname,
    "127.0.0.1",
    "The spike only permits a disposable loopback server",
  );
  const client = new QdrantClient({ url: endpoint, timeout: 5000 });
  const collection = `dec01_spike_${process.pid}`;
  try {
    await client.createCollection(collection, {
      vectors: { dense: { size: 1024, distance: "Cosine" } },
      sparse_vectors: { sparse: {} },
    });
    const dense = Array<number>(1024).fill(0);
    dense[0] = 1;
    await client.upsert(collection, {
      wait: true,
      points: [
        { id: 1, vector: { dense, sparse: { indices: [42], values: [1] } } },
      ],
    });
    const result = await client.query(collection, {
      prefetch: [
        { query: dense, using: "dense", limit: 2 },
        { query: { indices: [42], values: [1] }, using: "sparse", limit: 2 },
      ],
      query: { fusion: "rrf" },
      limit: 2,
    });
    assert.equal(result.points[0]?.id, 1);
  } finally {
    await client.deleteCollection(collection);
  }
});
