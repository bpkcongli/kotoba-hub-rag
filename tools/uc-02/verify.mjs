// Probe kompatibilitas opt-in: source aplikasi dibaca, provider dan log diganti mock.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const app = resolve(process.env.KOTOBA_APP ?? join(root, '../kotoba-hub'));
const requireApp = createRequire(join(app, 'package.json'));
const manifest = JSON.parse(
  await readFile(join(root, 'contracts/v1/source-manifest.json'), 'utf8'),
);
const status = () =>
  execFileSync('git', ['--no-optional-locks', '-C', app, 'status', '--porcelain=v1'], {
    encoding: 'utf8',
  });
const before = status();

async function checkSources() {
  for (const [name, expected] of Object.entries(manifest.files)) {
    const hash = createHash('sha256')
      .update(await readFile(join(app, name)))
      .digest('hex');

    assert.equal(
      hash,
      expected,
      `Source KotobaHub berubah: ${name}; audit ulang sebelum verifikasi.`,
    );
  }
}

await checkSources();

for (const [name, version] of Object.entries({ zod: '4.6.5', esbuild: '0.25.12' })) {
  assert.equal(requireApp(`${name}/package.json`).version, version, `Dependency audit: ${name}`);
}

const { evaluationScenarios } = await import(
  pathToFileURL(join(root, 'tests/__fixtures__/evaluation-fixture.ts')).href
);
const { validateOutput } = await import(
  pathToFileURL(join(root, 'src/modules/rag/application/generation/schema.ts')).href
);
const scratch = await mkdtemp(join(tmpdir(), 'kotoba-uc02-'));

try {
  const entry = join(scratch, 'app-probe.mjs');

  await requireApp('esbuild').build({
    stdin: {
      contents: `
        import { AiServiceImpl } from ${JSON.stringify(join(app, 'src/backend/shared/application/services/impl/ai.service.impl.ts'))};
        import { readAiEnv } from ${JSON.stringify(join(app, 'src/backend/shared/infrastructure/config/ai-env.ts'))};

        export async function probe(payload, output) {
          let calls = 0;
          const completions = [];
          const inputs = [];
          const provider = {
            name: 'UC02_MOCK',
            async generate(input) {
              calls++;
              inputs.push(input.input);
              return { outputText: JSON.stringify(output), providerRequestId: null, usage: null };
            },
          };
          const logs = {
            async start() {},
            async recordAttempt() {},
            async complete(_id, completion) { completions.push(completion.requestStatus); },
          };
          const config = { ...readAiEnv({}), maxRetries: 0, retryDelayMs: 0, maxInputChars: 100000 };
          const service = new AiServiceImpl(provider, logs, config, async () => {});

          try {
            const data = await service.gradePracticeAnswer(payload);
            return { accepted: true, data, calls, completions, inputs };
          } catch (error) {
            return { accepted: false, code: error.code, calls, completions, inputs };
          }
        }
      `,
      resolveDir: app,
      sourcefile: 'uc02-app-probe.mjs',
      loader: 'js',
    },
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    tsconfig: join(app, 'tsconfig.json'),
    nodePaths: [join(app, 'node_modules')],
    banner: {
      js: 'import { createRequire as uc02CreateRequire } from "node:module"; const require = uc02CreateRequire(import.meta.url);',
    },
    logLevel: 'silent',
  });

  const { probe } = await import(pathToFileURL(entry).href);
  const checks = [];

  for (const scenario of evaluationScenarios()) {
    const expected = scenario.expected === null;
    const original = JSON.stringify({ request: scenario.request, output: scenario.output });
    const failure = validateOutput('evaluate', scenario.request, scenario.output);
    const result = await probe(scenario.request.payload, scenario.output);

    assert.equal(failure, scenario.expected, `${scenario.name}: hasil validator RAG`);
    assert.equal(result.accepted, expected, `${scenario.name}: hasil validator KotobaHub`);
    assert.equal(result.calls, 1, `${scenario.name}: tanpa retry aplikasi`);

    const serialized = JSON.parse(result.inputs[0]);

    assert.deepEqual(serialized.question, scenario.request.payload.question, scenario.name);
    assert.deepEqual(serialized.userAnswer, scenario.request.payload.userAnswer, scenario.name);
    assert.deepEqual(serialized.language, scenario.request.payload.language, scenario.name);
    assert.equal(Object.hasOwn(serialized, 'metadata'), false, scenario.name);
    assert.equal(Object.hasOwn(serialized, 'experiment'), false, scenario.name);
    assert.deepEqual(result.completions, [expected ? 'SUCCEEDED' : 'FAILED'], scenario.name);

    if (expected) {
      assert.deepEqual(result.data, scenario.output, `${scenario.name}: output tidak dimutasi`);
    } else {
      assert.equal(result.code, 'INVALID_OUTPUT', scenario.name);
      assert.equal(Object.hasOwn(result, 'data'), false, scenario.name);
    }

    assert.equal(
      JSON.stringify({ request: scenario.request, output: scenario.output }),
      original,
      `${scenario.name}: fixture tidak dimutasi`,
    );

    checks.push({ name: scenario.name, accepted: expected, ragFailure: failure });
  }

  const { scoreAssessment } = await import(
    pathToFileURL(join(root, 'src/modules/rag/application/generation/grading.ts')).href
  );
  const baseline = evaluationScenarios()[0];

  assert.ok(baseline);

  for (const meaning of [0, 20, 40, 60]) {
    for (const grammar of [0, 10, 20, 30]) {
      for (const naturalness of [0, 5, 10]) {
        const output = {
          ...scoreAssessment({ meaning, grammar, naturalness }),
          feedbackText: 'Synthetic server-mapped grade contract check.',
        };
        const result = await probe(baseline.request.payload, output);

        assert.equal(validateOutput('evaluate', baseline.request, output), null);
        assert.equal(result.accepted, true);
        assert.deepEqual(result.data, output);
        assert.equal(result.calls, 1);

        checks.push({
          name: `server-map/${meaning}/${grammar}/${naturalness}`,
          accepted: true,
          ragFailure: null,
        });
      }
    }
  }

  await checkSources();
  assert.equal(status(), before, 'Working tree KotobaHub berubah selama probe.');

  console.log(
    JSON.stringify(
      {
        task: 'UC-02',
        verifiedAtUtc: new Date().toISOString(),
        node: process.version,
        auditedSourceCommit: manifest.commit,
        currentSourceCommit: execFileSync(
          'git',
          ['--no-optional-locks', '-C', app, 'rev-parse', 'HEAD'],
          {
            encoding: 'utf8',
          },
        ).trim(),
        sourceFilesMatched: Object.keys(manifest.files).length,
        appWorkingTreeUnchanged: true,
        passed: checks.length,
        failed: 0,
        serverMappedGradesChecked: 48,
        accepted: checks.filter((check) => check.accepted).length,
        rejected: checks.filter((check) => !check.accepted).length,
        networkCalls: 0,
        paidCalls: 0,
        databaseWrites: 0,
        checks,
        limitations: [
          'AiServiceImpl aktual dipanggil dengan mock provider/log; bukan adapter HTTP KotobaHub INT-01.',
          'Fixture sintetis membuktikan invariant struktural; kualitas pedagogis/naturalitas Jepang belum dinilai manusia.',
          'Fixture hanya menguji kontrak dan preservasi input; skor mock tidak membuktikan konsistensi semantik EN/ID atau penerimaan variasi Jepang oleh model.',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
