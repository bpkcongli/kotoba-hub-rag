import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

// Paid smoke is explicit and limited to one new, three-document job. Replay has zero budget.
if (process.argv.slice(2).join(' ') !== '--max-calls 3') {
  throw new Error('Gunakan npm run data:smoke -- --max-calls 3 setelah scope/budget disetujui');
}

const root = new URL('../../', import.meta.url);

try {
  loadEnvFile(new URL('../../.env', import.meta.url));
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
    throw new Error('Konfigurasi environment smoke tidak dapat dibaca');
  }
}

const suffix = `${process.pid}_${randomBytes(4).toString('hex')}`;
const project = `data03-${suffix.replaceAll('_', '-')}`;
const job = `artifacts/data-03/hf-smoke-${suffix}`;
const output = new URL(`../../${job}/`, import.meta.url);
const composeArgs = [
  'compose',
  '--file',
  new URL('../../compose.yaml', import.meta.url).pathname,
  '--project-name',
  project,
];
const env = { ...process.env, QDRANT_HTTP_PORT: '0' };
// This disposable Compose server has no authentication. Do not forward user storage
// credentials or let an empty .env placeholder become an invalid configured API key.
delete env.QDRANT_API_KEY;
const report = {
  task: 'DATA-03',
  startedAt: new Date().toISOString(),
  job,
  authorizedMaxEmbeddingPost: 3,
  provider: 'hf-inference',
  newProviderCalls: null,
  indexingCostUsd: null,
  publicRedistributionAuthorized: false,
  experimentFrozen: false,
  outcome: 'FAILED',
  cleanupSucceeded: false,
};

function docker(args) {
  const result = spawnSync('docker', [...composeArgs, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 120000,
  });

  if (result.error || result.status !== 0) {
    throw new Error('Docker smoke gagal');
  }

  return result.stdout.trim();
}

function cli(args, overrides = {}) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/ingestion/index-cli.ts', ...args],
    {
      cwd: root,
      env: { ...env, ...overrides },
      encoding: 'utf8',
      timeout: 420000,
    },
  );

  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');

  if (result.error || result.status !== 0) {
    throw new Error('CLI smoke gagal; periksa journal/report tersanitasi');
  }
}

let exitCode = 1;
// Keep the process alive while readiness fetches use unref'ed transport/timeouts.
const keepAlive = setInterval(() => undefined, 1000);

try {
  cli(['plan', '--job', job, '--revision', `data03_smoke_${suffix}`, '--sample-size', '3']);
  docker(['up', '--detach', 'qdrant']);

  const address = docker(['port', 'qdrant', '6333']);

  if (!/^127\.0\.0\.1:\d+$/.test(address)) {
    throw new Error('Smoke harus memakai loopback');
  }

  const url = `http://${address}`;
  let ready = false;

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(`${url}/readyz`, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      ready = false;
    }

    if (ready) {
      break;
    }

    await delay(100);
  }

  if (!ready) {
    throw new Error('Qdrant smoke belum ready');
  }

  report.server = await (await fetch(url)).json();

  const overrides = {
    QDRANT_ENABLED: 'true',
    QDRANT_URL: url,
    HF_INFERENCE_ENABLED: 'true',
    RETRIEVAL_PROFILE: 'DENSE',
    HF_EMBEDDING_BATCH_SIZE: '1',
    HF_MAX_CONCURRENCY: '1',
    HF_TIMEOUT_MS: '120000',
  };

  cli(['run', '--job', job, '--max-new-calls', '3'], overrides);
  const initial = JSON.parse(await readFile(new URL('report.json', output), 'utf8'));
  cli(['run', '--job', job, '--max-new-calls', '0'], overrides);
  const replay = JSON.parse(await readFile(new URL('report.json', output), 'utf8'));

  if (
    initial.providerAttemptCount !== 3 ||
    replay.providerAttemptCount !== 3 ||
    replay.newBatches !== 0 ||
    replay.validation.pointCount !== 3
  ) {
    throw new Error('Budget/idempotency smoke tidak cocok');
  }

  report.initial = initial;
  report.replay = replay;
  report.outcome = 'PASSED_THREE_DOCUMENT_SMOKE';
  exitCode = 0;
} catch (error) {
  // CLI/provider errors are already sanitized; do not print raw network causes or environment.
  process.stderr.write(`${error instanceof Error ? error.message : 'Smoke gagal'}\n`);
} finally {
  try {
    docker(['down', '--volumes', '--remove-orphans']);
    report.cleanupSucceeded = true;
  } catch {
    exitCode = 1;
    process.stderr.write(`Cleanup project ${project} gagal\n`);
  }

  try {
    const journal = (await readFile(new URL('journal.jsonl', output), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    report.observedProviderAttemptCount = journal.filter(
      (event) => event.kind === 'provider_attempt',
    ).length;
    report.embeddingIntents = journal.filter((event) => event.kind === 'embedding_started').length;
    report.newProviderCalls =
      report.observedProviderAttemptCount === report.embeddingIntents
        ? report.observedProviderAttemptCount
        : null;
  } catch {
    // No journal means no call is claimed; unknown is retained on early failure.
  }

  report.completedAt = new Date().toISOString();
  await mkdir(output, { recursive: true });
  await writeFile(new URL('smoke.json', output), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(
    JSON.stringify({
      report: `${job}/smoke.json`,
      outcome: report.outcome,
      newProviderCalls: report.newProviderCalls,
      cleanupSucceeded: report.cleanupSucceeded,
    }) + '\n',
  );

  clearInterval(keepAlive);
}

process.exitCode = exitCode;
