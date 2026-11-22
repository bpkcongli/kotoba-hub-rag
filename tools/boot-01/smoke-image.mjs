import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

const image = process.argv[2] ?? 'kotoba-hub-rag:boot-01';
const name = `kotoba-boot01-${randomUUID()}`;

const docker = async (...args) =>
  (await execute('docker', args, { timeout: 30000, maxBuffer: 1048576 })).stdout.trim();

const imageInfo = JSON.parse(await docker('image', 'inspect', image))[0];

assert.equal(imageInfo.Architecture, 'amd64');
assert.equal(imageInfo.Os, 'linux');
assert.equal(imageInfo.Config.User, 'node');

const limits = [
  '--network',
  'none',
  '--read-only',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges',
  '--cpus',
  '2',
  '--memory',
  '256m',
  '--pids-limit',
  '64',
];

let probes;
let exitCode;

try {
  await docker(
    'run',
    '--detach',
    '--name',
    name,
    ...limits,
    '--env',
    'LOG_LEVEL=silent',
    '--env',
    'PORT=8080',
    image,
  );

  // Probe memakai loopback di dalam container, tanpa port host atau network provider.
  probes = JSON.parse(
    await docker(
      'exec',
      name,
      'node',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';

    const origin = 'http://127.0.0.1:' + process.env.PORT;
    let response;

    for (let i = 0; i < 50; i++) {
      try { response = await fetch(origin + '/health/live'); break; }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }

    assert.equal(response?.status, 200);
    assert.deepEqual(await response.json(), {status:'live'});

    const ready = await fetch(origin + '/health/ready');

    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), {status:'not_ready'});

    const operation = await fetch(origin + '/v1/practice/generate', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'});

    assert.equal(operation.status, 404);

    assert.equal(process.version, 'v24.22.3');
    assert.equal(process.getuid(), 1000);

    console.log(JSON.stringify({live:response.status,ready:ready.status,operation:operation.status,node:process.version,uid:process.getuid(),port:process.env.PORT}));
  `,
    ),
  );

  assert.equal(imageInfo.Config.Healthcheck.Test[0], 'CMD');
  await docker('exec', name, ...imageInfo.Config.Healthcheck.Test.slice(1));

  await docker('stop', '--time', '5', name);

  exitCode = Number(await docker('inspect', '--format', '{{.State.ExitCode}}', name));

  assert.equal(exitCode, 0, 'SIGTERM harus ditutup bersih');
} finally {
  await docker('rm', '--force', name);
}

let invalidConfig;

try {
  await docker(
    'run',
    '--rm',
    ...limits,
    '--env',
    'PORT=secret-value-must-not-leak',
    '--env',
    'LOG_LEVEL=silent',
    image,
  );

  assert.fail('Config invalid tidak boleh startup');
} catch (error) {
  assert.equal(error.code, 1);
  assert.match(error.stderr, /Konfigurasi tidak valid: PORT/);
  assert.doesNotMatch(error.stdout + error.stderr, /secret-value-must-not-leak/);

  invalidConfig = { exit_code: error.code, stderr: error.stderr.trim() };
}

const files = [
  'Dockerfile',
  'package.json',
  'package-lock.json',
  'src/app.ts',
  'src/main.ts',
  'src/shared/config.ts',
  'src/shared/ports.ts',
  'src/adapters/system-clock.ts',
  'src/contracts/validator.ts',
  'src/contracts/v1.generated.ts',
  'contracts/v1/domain.schema.json',
  'contracts/v1/contract.schema.json',
];

const checksums = Object.fromEntries(
  await Promise.all(
    files.map(async (path) => [
      path,
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    ]),
  ),
);

const evidence = {
  task: 'BOOT-01',
  verified_at: new Date().toISOString(),
  image: {
    tag: image,
    id: imageInfo.Id,
    platform: 'linux/amd64',
    base: 'node:24.22.3-bookworm-slim@sha256:0e2646ab57e77b7a384a0cb59b6815b182c77e1f9c3ba36bd8435bd9c4e6680e',
    user: imageInfo.Config.User,
  },
  isolation: {
    network: 'none',
    read_only: true,
    host_ports: [],
    cpus: 2,
    memory_mib: 256,
  },
  probes,
  docker_healthcheck_passed: true,
  sigterm_exit_code: exitCode,
  invalid_config: invalidConfig,
  sha256: checksums,
  limitations: [
    'Health-only bootstrap; readiness sengaja 503.',
    'Tanpa model/provider, Qdrant, pipeline, auth, idempotency atau paid call.',
    'Bukan uji kapasitas corpus/produksi atau freeze eksperimen.',
  ],
};

await writeFile('docs/verification/BOOT-01-image.json', JSON.stringify(evidence, null, 2) + '\n');

console.log(
  JSON.stringify({
    status: 'passed',
    probes,
    sigterm_exit_code: exitCode,
    invalid_config_exit_code: invalidConfig.exit_code,
  }),
);
