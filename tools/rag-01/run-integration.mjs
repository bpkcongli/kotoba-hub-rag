import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const root = new URL('../../', import.meta.url);
const compose = new URL('../../compose.yaml', import.meta.url).pathname;
const project = `rag01-${process.pid}-${randomBytes(4).toString('hex')}`;
const env = { ...process.env, QDRANT_HTTP_PORT: '0' };
const args = ['compose', '--file', compose, '--project-name', project];

function docker(command) {
  const result = spawnSync('docker', [...args, ...command], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 120000,
  });

  if (result.error || result.status !== 0) {
    throw new Error(`Docker ${command[0]} gagal: ${result.stderr || 'process error'}`);
  }

  return result.stdout.trim();
}

const startedAt = new Date().toISOString();
let exitCode = 1;
let cleanupSucceeded = false;
let report = { task: 'RAG-01', startedAt, server: null, clientVersion: null };

try {
  docker(['up', '--detach', 'qdrant']);

  const address = docker(['port', 'qdrant', '6333']);

  if (!/^127\.0\.0\.1:\d+$/.test(address)) {
    throw new Error('Instance test harus loopback dengan port sementara');
  }

  const url = `http://${address}`;
  const container = docker(['ps', '--quiet', 'qdrant']);
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
    throw new Error('Qdrant test tidak ready');
  }

  const version = await (await fetch(url)).json();
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', 'tests/retrieval.integration.ts'],
    {
      cwd: root,
      env: { ...env, RAG01_QDRANT_URL: url, RAG01_CONTAINER_ID: container },
      encoding: 'utf8',
      timeout: 120000,
    },
  );

  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  exitCode = result.status ?? 1;

  const output = new URL('../../artifacts/rag-01/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(
    new URL('integration.log', output),
    (result.stdout ?? '') + (result.stderr ?? ''),
  );

  report = {
    ...report,
    server: version,
    clientVersion: JSON.parse(
      await readFile(
        new URL('../../node_modules/@qdrant/js-client-rest/package.json', import.meta.url),
        'utf8',
      ),
    ).version,
  };
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Integration runner gagal'}\n`);
} finally {
  try {
    // Only this unique disposable Compose project and its volumes are removed.
    docker(['down', '--volumes', '--remove-orphans']);
    cleanupSucceeded = true;
  } catch {
    exitCode = 1;
    process.stderr.write(`Cleanup project ${project} gagal; periksa Docker.\n`);
  }
}

const output = new URL('../../artifacts/rag-01/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(
  new URL('integration.json', output),
  JSON.stringify(
    {
      ...report,
      completedAt: new Date().toISOString(),
      exitCode,
      cleanupSucceeded,
      image:
        'qdrant/qdrant:v1.20.2@sha256:c5e32ee251293d2e1f4dd34890ad75eeee5a4f3821a121d6d8b7e4323448b386',
      platform: 'linux/amd64',
      loopbackOnly: true,
      newProviderCalls: 0,
    },
    null,
    2,
  ) + '\n',
);

process.exitCode = exitCode;
