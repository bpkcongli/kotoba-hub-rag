import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { format, resolveConfig } from 'prettier';

const { camelBody } = await import(new URL('http-contract.mjs', import.meta.url).href);

const root = new URL('../../', import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const [spec, domain, wire, fixtures, rules] = await Promise.all([
  read('contracts/v1/openapi.json'),
  read('contracts/v1/domain.schema.json'),
  read('contracts/v1/http.schema.json'),
  read('contracts/v1/fixtures.json'),
  read('contracts/v1/errors.json'),
]);

function bundle(value) {
  if (Array.isArray(value)) {
    return value.map(bundle);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === '$ref') {
        assert.equal(typeof child, 'string');
        const match = child.match(
          /^(?:(?:\.\/)?(?:domain|contract|http)\.schema\.json)?#\/definitions\/([^/]+)$/,
        );
        assert.ok(match, `Referensi snapshot tidak didukung: ${child}`);

        return [key, `#/components/schemas/${match[1]}`];
      }

      return [key, bundle(child)];
    }),
  );
}

const schemaRef = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const errorExamples = (status) =>
  Object.fromEntries(
    rules
      .filter((rule) => rule.status === status)
      .map((rule) => [
        rule.code,
        {
          summary: rule.code,
          value: {
            schemaVersion: '1',
            requestId: null,
            executionId: null,
            mode: null,
            error: { code: rule.code, message: rule.code, retryable: rule.retryable },
            meta: { traceId: '72000000-0000-4000-8000-000000000001' },
          },
        },
      ]),
  );

spec.info.description =
  'API-01 runtime specification. Four server-to-server operations and two health endpoints require a Bearer service token. HTTP v1 uses the camelCase amendment API-01-CAMEL; domain payload schemas follow CON-01. EN/ID language, mode, corpusVersion, and IDs must be explicit; only N5/N4 targets are accepted. JSON bodies are limited to 1 MiB, with no type coercion, default mutation, or generic prompt proxy. Semantics and configuration: [API-01](./API-01-http.md).';
spec.info.version = '1.1.0';
spec['x-contract-revision'] = 'api-01-camel-v1';
spec.servers = [
  {
    url: 'http://127.0.0.1:3000',
    description: 'Local default; configure HOST/PORT as needed. Deployment integrations use TLS.',
  },
];
spec.tags = [
  { name: 'Practice', description: 'Practice generation and FREE_RESPONSE evaluation.' },
  {
    name: 'Onboarding',
    description:
      'Candidate claims and recommendations; confirmation and domain changes remain in KotobaHub.',
  },
  { name: 'Health', description: 'Authenticated probes without inference or Qdrant queries.' },
];
spec.components.schemas = {};

for (const source of [domain, wire]) {
  for (const [name, schema] of Object.entries(source.definitions)) {
    assert.ok(!Object.hasOwn(spec.components.schemas, name), `Nama schema ganda: ${name}`);

    spec.components.schemas[name] = bundle(schema);
  }
}

spec.components.securitySchemes.serviceBearer.description =
  'Authorization: Bearer <API_SERVICE_TOKEN>. One token represents API_SERVICE_ID; it is not a learner token or provider API key. An unconfigured service token returns 503; an incorrect or missing request token returns 401. Also applies to health probes and replay.';
const descriptions = {
  generate:
    'Generates exactly questionCount questions matching the catalog, allowedQuestionTypes, and difficultyBand. Preserves blank, option, token-order, and EN/ID↔JA language-pair invariants.',
  evaluate:
    'Evaluates FREE_RESPONSE only. promptLanguage is EN/ID according to translationLocale, and answerLanguage is JA. Returns isCorrect, numericScore from 0 to 100, and feedbackText; objective grading remains owned by KotobaHub.',
  normalize:
    'Normalizes a nonblank note into candidate skill claims from the catalog. Suggestions require confirmation; the endpoint does not modify the profile or mastery.',
  recommend:
    'Suggests a lesson/unit/track consistent with catalog relationships. Does not replace the recommendation policy or write application progress.',
};
const requestRules =
  'If provided, X-Request-ID must match requestId and payload.metadata.requestId. Locale must be en/id; N3/N2 targets return 422. Context must be consistent with the catalog; schemas alone do not cover all domain refinements.';
const lifecycle =
  'Mode must be permitted by API_ALLOWED_MODES, with no fallback. New requests require corpusVersion to match the configuration/snapshot. The deadline uses the minimum budget from timeoutMs (100–120000 ms), deadlineAt in UTC, and the API_MAX_DEADLINE_MS server ceiling (default 120000 ms), accounting for monotonic elapsed time since onRequest. API_MAX_CONCURRENT defaults to 4, with no HTTP queue; capacity exhaustion returns 429. Disconnect/shutdown aborts the signal; remote inference termination is not guaranteed.';
const replay =
  'requestId is the idempotency key within the API_SERVICE_ID namespace. The fingerprint covers the operation and the entire body, including deadline/metadata. An identical body with a terminal execution is replayed with the same envelope, execution ID, and trace ID, without new events or calls, even after the request deadline has expired. Authentication and mode permissions are still checked. A different body, an in-flight or UNKNOWN execution, a corrupted trace, or a terminal execution without an envelope returns 409; an unreadable or corrupted sidecar returns 503. There is no Idempotency-Key or additional status endpoint. Keep the body identical for replay; do not change the UUID to bypass UNKNOWN. retryable does not authorize repeating inference with a new UUID.';

for (const [path, item] of Object.entries(spec.paths)) {
  if (!item.post) {
    continue;
  }

  const operation = item.post;
  const key = path.split('/').at(-1) === 'evaluate' ? 'evaluate' : path.split('/').at(-1);

  assert.ok(Object.hasOwn(descriptions, key));

  operation.tags = [path.includes('/practice/') ? 'Practice' : 'Onboarding'];
  operation.description = [
    descriptions[key],
    requestRules,
    lifecycle,
    replay,
    'Synthetic examples use historical deadlines. For a new execution, provide consistent new UUIDs and a UTC deadline that has not expired. Response examples are not model outputs or quality guarantees.',
  ].join('\n\n');

  for (const parameter of operation.parameters ?? []) {
    if (parameter.in === 'header' && parameter.name === 'X-Request-ID') {
      parameter.description = 'If provided, must match requestId and payload.metadata.requestId.';
    }
  }

  operation.requestBody.content['application/json'].schema = bundle(
    operation.requestBody.content['application/json'].schema,
  );
  const rows = fixtures.cases.filter((row) => row.operation === key);

  assert.equal(rows.length, 4);

  operation.requestBody.content['application/json'].examples = Object.fromEntries(
    rows.map((row) => [row.id, { summary: row.id, value: camelBody(row.request) }]),
  );

  for (const [status, response] of Object.entries(operation.responses)) {
    response.content['application/json'].schema = bundle(
      response.content['application/json'].schema,
    );
    response.content['application/json'].examples =
      status === '200'
        ? Object.fromEntries(
            rows.map((row) => [
              row.id,
              { summary: `Fixture ${row.id}`, value: camelBody(row.response) },
            ]),
          )
        : errorExamples(Number(status));
  }

  operation.responses['200'].description =
    'A new success envelope or an identical replay; domain data is strict, with metadata, citations, and accounting only in meta. There is no replay indicator header.';
  operation.responses['401'].headers = {
    'WWW-Authenticate': {
      description: 'Required authentication scheme.',
      schema: { type: 'string', const: 'Bearer' },
      example: 'Bearer',
    },
  };
}

for (const name of ['live', 'ready']) {
  const operation = spec.paths[`/health/${name}`].get;
  operation.tags = ['Health'];
  operation.summary =
    name === 'live' ? 'Process liveness' : 'Readiness from the latest local status';
  operation.description =
    name === 'live'
      ? 'Bearer authentication is required. A live process returns 200 live; successful authenticated probes do not call providers, Qdrant, or the registry.'
      : 'Bearer authentication is required. Starts at 503 not_ready; returns 200 ready once the corpus is configured and every permitted mode is available and has a successful execution in the running process. Dependency/trace failures clear the mode success status; restarting clears the cache. Probes perform no inference, Qdrant queries, or warmup. This status does not check current remote availability.';
  operation.responses['200'] = {
    description:
      name === 'live'
        ? 'The process is live.'
        : 'All permitted modes are ready according to the local cache.',
    content: json({
      allOf: [
        schemaRef('HealthResponse'),
        { properties: { status: { const: name === 'live' ? 'live' : 'ready' } } },
      ],
    }),
  };
  operation.responses['200'].content['application/json'].example = {
    status: name === 'live' ? 'live' : 'ready',
  };
  operation.responses['401'] = {
    description: 'AUTH_FAILED; incorrect or missing token.',
    headers: {
      'WWW-Authenticate': { schema: { type: 'string', const: 'Bearer' }, example: 'Bearer' },
    },
    content: json(schemaRef('ErrorResponse')),
  };
  operation.responses['401'].content['application/json'].examples = errorExamples(401);
  operation.responses['503'] = {
    description:
      name === 'live'
        ? 'DEPENDENCY_NOT_READY (service token not configured) or TRACE_WRITE_FAILED.'
        : 'not_ready, or a DEPENDENCY_NOT_READY (service token not configured)/TRACE_WRITE_FAILED error envelope. Distinguish them by the body shape.',
    content: json(
      name === 'live'
        ? schemaRef('ErrorResponse')
        : {
            oneOf: [
              {
                allOf: [
                  schemaRef('HealthResponse'),
                  { properties: { status: { const: 'not_ready' } } },
                ],
              },
              schemaRef('ErrorResponse'),
            ],
          },
    ),
  };
  operation.responses['503'].content['application/json'].examples = {
    ...(name === 'ready' ? { not_ready: { value: { status: 'not_ready' } } } : {}),
    ...errorExamples(503),
  };
}

// Resolve every bundled reference, including response/schema compositions, without network.
function checkReferences(value) {
  if (value === null || typeof value !== 'object') {
    return;
  }

  if ('$ref' in value) {
    assert.ok(value.$ref.startsWith('#/'), `Referensi eksternal: ${value.$ref}`);
    const target = value.$ref
      .slice(2)
      .split('/')
      .reduce((node, part) => node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], spec);
    assert.notEqual(target, undefined, `Referensi hilang: ${value.$ref}`);
  }

  Object.values(value).forEach(checkReferences);
}

checkReferences(spec);

// Ajv compiles the schema bundle separately from OpenAPI metadata; draft-07 stays unchanged.
const schemaBundle = { components: { schemas: spec.components.schemas } };
const ajv = new Ajv({
  strict: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
addFormats(ajv);
let examplesChecked = 0;

for (const item of Object.values(spec.paths)) {
  const operation = item.post ?? item.get;
  const contents = [
    operation.requestBody?.content,
    ...Object.values(operation.responses).map((response) => response.content),
  ].filter(Boolean);

  for (const content of contents) {
    const media = content['application/json'];
    const scoped = ajv.compile({ ...schemaBundle, ...media.schema });

    for (const example of [
      ...Object.values(media.examples ?? {}).map((row) => row.value),
      ...('example' in media ? [media.example] : []),
    ]) {
      assert.ok(scoped(example), JSON.stringify(scoped.errors));
      examplesChecked++;
    }
  }
}

// Emit only JSON-compatible YAML: quoted strings preserve dates, numeric keys and Japanese text.
function yamlLines(value, indentation = 0) {
  const prefix = ' '.repeat(indentation);

  if (Array.isArray(value) && value.length > 0) {
    return value.flatMap((child) => [`${prefix}-`, ...yamlLines(child, indentation + 2)]);
  }

  if (value !== null && typeof value === 'object' && Object.keys(value).length > 0) {
    return Object.entries(value).flatMap(([key, child]) => {
      const label =
        /^[a-zA-Z_$][a-zA-Z0-9_$.-]*$/.test(key) &&
        !/^(?:true|false|null|yes|no|on|off)$/i.test(key)
          ? key
          : JSON.stringify(key);
      const nested = yamlLines(child, indentation + 2);

      return nested.length === 1 &&
        (child === null || typeof child !== 'object' || Object.keys(child).length === 0)
        ? [`${prefix}${label}: ${nested[0].trimStart()}`]
        : [`${prefix}${label}:`, ...nested];
    });
  }

  return [`${prefix}${JSON.stringify(value)}`];
}

const path = 'docs/api/openapi.yaml';
const destination = new URL(path, root);
const formatting = await resolveConfig(destination.pathname);
const editorSchema = 'https://spec.openapis.org/oas/3.1/schema/2022-10-07';
const output = await format(
  `# yaml-language-server: $schema=${editorSchema}\n${yamlLines(spec).join('\n')}\n`,
  {
    ...formatting,
    parser: 'yaml',
  },
);

if (process.argv.includes('--check')) {
  assert.equal(
    await readFile(destination, 'utf8'),
    output,
    `OpenAPI drift (${path}); jalankan npm run openapi:generate`,
  );
} else {
  await writeFile(destination, output);
}

process.stdout.write(
  `API-01 OpenAPI YAML: 6 paths, ${Object.keys(spec.components.schemas).length} schemas, ${examplesChecked} examples; references valid; ${process.argv.includes('--check') ? 'no drift' : 'generated'}.\n`,
);
