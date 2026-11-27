import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { test } from 'node:test';
import { createApplication } from '@/app';
import { readConfig } from '@/bootstrap/config';
import { ObservationStore } from '@/bootstrap/observation-store';
import type { AdmissionInput } from '@/modules/execution/application/services/execution-registry.service';
import { HF_IDENTITY } from '@/modules/knowledge/application/inference-identity';
import type { TraceEvent } from '@/modules/observability/application/events';
import { parseTraceEvent } from '@/modules/observability/application/events';
import { JsonlTraceSink } from '@/modules/observability/interface/secondary/files/jsonl-sink';
import { readHfConfig } from '@/modules/rag/infrastructure/config/hf-config';
import type { InferenceAttempt } from '@/modules/rag/interface/secondary/inference/hf-inference';
import type { Clock } from '@/shared/clock';

async function directory(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'kotoba-obs-'));
  t.after(() => rm(path, { recursive: true, force: true }));

  return path;
}

function admission(overrides: Partial<AdmissionInput> = {}): AdmissionInput {
  return {
    serviceId: 'service-a',
    requestId: randomUUID(),
    operation: 'generate',
    mode: 'ADAPTIVE',
    request: { note: 'private learner answer', token: 'hf-secret' },
    ...overrides,
  };
}

function executionId(value: {
  readonly correlation: { readonly executionId: string | null };
}): string {
  assert.ok(value.correlation.executionId);

  return value.correlation.executionId;
}

function attempt(id: string): InferenceAttempt {
  return {
    attemptId: randomUUID(),
    executionId: id,
    operation: 'embedding',
    purpose: 'query',
    itemCount: 1,
    identity: HF_IDENTITY,
    configuration: {
      profile: 'DENSE',
      embeddingBatchSize: 1,
      rerankerBatchSize: 2,
      maxConcurrency: 1,
      maxItems: 128,
      maxTextChars: 8192,
      timeoutMs: 15000,
      maxResponseBytes: 2097152,
    },
    profile: 'DENSE',
    timestamp: '2026-11-25T01:00:00.000Z',
    durationMs: 5,
    httpStatus: 200,
    providerRequestId: 'sensitive-provider-id',
    errorCode: null,
    retryAfterMs: null,
    remoteOutcome: 'response_received',
    usage: null,
    costUsd: null,
  };
}

await test('admission concurrent, canonical fingerprint, mode/service scope dan terminal tetap idempoten setelah reopen', async (t) => {
  const path = await directory(t);
  const store = new ObservationStore(path);
  const input = admission({ request: { a: 1, b: 2 } });

  const [first, same] = await Promise.all([
    store.admit(input),
    store.admit({ ...input, request: { b: 2, a: 1 } }),
  ]);

  assert.equal(first.status, 'admitted');
  assert.equal(same.status, 'IN_FLIGHT');
  assert.deepEqual(first.correlation, same.correlation);
  await assert.rejects(store.admit({ ...input, mode: 'SINGLE_STAGE' }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  await assert.rejects(store.admit({ ...input, operation: 'evaluate' }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  await assert.rejects(store.admit({ ...input, request: { a: 2 } }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });

  const otherService = await store.admit({ ...input, serviceId: 'service-b' });

  assert.notEqual(executionId(first), executionId(otherService));

  const terminal = await store.finish(executionId(first), 'SUCCESS', null);
  await store.finish(executionId(otherService), 'FAILED', 'PROVIDER_FAILED');
  await store.close();

  const reopened = new ObservationStore(path);
  const replay = await reopened.admit(input);

  assert.equal(replay.status, 'TERMINAL');
  assert.deepEqual(replay.terminal, terminal);
  assert.deepEqual(replay.correlation, first.correlation);
  assert.equal((await readdir(join(path, 'events'))).length, 2);
  assert.deepEqual(await reopened.reconcile(), []);

  await reopened.close();
});

await test('durasi request/span/rejection monotonic tetap benar saat UTC bergerak mundur; attempt usage/cost unknown', async (t) => {
  const path = await directory(t);
  let mono = 10;
  let utc = '2026-11-25T01:00:00.000Z';
  const clock: Clock = { now: () => new Date(utc), monotonicMs: () => mono };
  const store = new ObservationStore(path, clock);
  const admitted = await store.admit(admission());
  const id = executionId(admitted);
  const span = store.startSpan(id, 'generation');

  mono = 25;
  utc = '2026-11-24T01:00:00.000Z';
  await span.finish('SUCCESS', null);
  await store.recordHfAttempt(attempt(id));
  const terminal = await store.finish(id, 'TIMEOUT', 'TIMEOUT');
  const rejected = await store.reject({ code: 'AUTH_FAILED', startedMs: 5 });
  const rejections = await store.rejected();
  await store.close();

  assert.equal(terminal.durationMs, 15);
  assert.equal(terminal.timestamp, utc);
  assert.equal(rejected.correlation.executionId, null);
  assert.equal(rejected.correlation.requestId, null);
  assert.equal(rejected.durationMs, 20);
  assert.deepEqual(rejections, [rejected]);
  assert.match(rejected.correlation.traceId, /^[a-f0-9-]{36}$/);
  await assert.rejects(span.finish('SUCCESS', null));

  const raw = await readFile(join(path, 'events', `${id}.jsonl`), 'utf8');
  const events = raw
    .trim()
    .split('\n')
    .map((line) => parseTraceEvent(JSON.parse(line)));
  const model = events.find((event) => event.data.kind === 'model_attempt');

  assert.equal(events.length, 4);
  assert.equal(events[1]?.durationMs, 15);
  assert.ok(model?.data.kind === 'model_attempt');
  assert.ok('accounting' in model.data);
  assert.equal(model.data.accounting.usage, null);
  assert.ok(model.data.accounting.cost.kind === 'PER_CALL');
  assert.equal(model.data.accounting.cost.totalUsd, null);
  assert.equal(model.durationMs, 5);
  assert.doesNotMatch(
    raw,
    /private learner|hf-secret|sensitive-provider-id|"token"|"configuration"/,
  );
  assert.match(model.data.providerRequestIdHash ?? '', /^[a-f0-9]{64}$/);

  const registry = await readFile(
    join(path, 'admissions', (await readdir(join(path, 'admissions')))[0] ?? ''),
    'utf8',
  );

  assert.doesNotMatch(registry, /private learner|hf-secret|service-a/);
});

await test('sink failure mempertahankan admission dan UNKNOWN tanpa mengizinkan eksekusi ulang', async (t) => {
  const path = await directory(t);
  let writes = 0;
  const store = new ObservationStore(path, undefined, {
    sinkFactory: () => ({
      write: () => {
        writes++;
        return Promise.reject(new Error('raw-secret-disk-error'));
      },
      close: () => Promise.resolve(),
    }),
  });
  const input = admission();

  await assert.rejects(store.admit(input), { message: 'TRACE_WRITE_FAILED' });

  const replay = await store.admit(input);

  assert.equal(replay.status, 'UNKNOWN');
  assert.equal(replay.terminal?.data.kind, 'terminal');
  assert.ok(replay.terminal?.data.kind === 'terminal');
  assert.equal(replay.terminal.data.code, 'TRACE_WRITE_FAILED');
  assert.equal(replay.terminal.data.traceComplete, false);
  assert.equal(writes, 1);
  assert.throws(() => store.assertActive(executionId(replay)), { code: 'EXECUTION_NOT_ACTIVE' });

  await store.close();

  const reopened = new ObservationStore(path);

  assert.equal((await reopened.admit(input)).status, 'UNKNOWN');
  assert.equal((await reopened.inspect())[0]?.traceIntegrity, 'MISSING');

  await reopened.close();
});

await test('filesystem terminal ikut gagal: admission tetap tersedia, pulih UNKNOWN setelah storage kembali', async (t) => {
  const path = await directory(t);
  let writes = 0;
  const store = new ObservationStore(path, undefined, {
    sinkFactory: () => ({
      write: () =>
        ++writes === 1 ? Promise.resolve() : Promise.reject(new Error('Disk unavailable')),
      close: () => Promise.resolve(),
    }),
  });
  const input = admission();
  const admitted = await store.admit(input);

  await rename(join(path, 'terminals'), join(path, 'terminals-saved'));
  await writeFile(join(path, 'terminals'), 'unavailable');
  await assert.rejects(store.recordHfAttempt(attempt(executionId(admitted))), {
    code: 'TRACE_WRITE_FAILED',
  });

  assert.equal((await store.admit(input)).status, 'UNKNOWN');
  assert.equal(
    (await readdir(join(path, 'admissions'))).filter((name) => name.endsWith('.json')).length,
    1,
  );

  await store.close();
  await rm(join(path, 'terminals'));
  await rename(join(path, 'terminals-saved'), join(path, 'terminals'));

  const reopened = new ObservationStore(path);
  const recovered = await reopened.reconcile();

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.durationMs, null);
  assert.equal((await reopened.admit(input)).status, 'UNKNOWN');
  assert.deepEqual(await reopened.reconcile(), []);

  await reopened.close();
});

await test('crash nyata meninggalkan lock/admission; recovery menutup UNKNOWN dan mendeteksi torn JSONL tanpa menghapus bukti', async (t) => {
  const path = await directory(t);
  const input = admission();
  const source = new URL('../../../src/bootstrap/observation-store.ts', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import {writeSync} from 'node:fs'; import {ObservationStore} from ${JSON.stringify(source)};
     const s = new ObservationStore(process.argv[1]);
     const a = await s.admit(JSON.parse(process.argv[2]));
     writeSync(1, JSON.stringify(a)); process.kill(process.pid, 'SIGKILL');`,
      path,
      JSON.stringify(input),
    ],
    { encoding: 'utf8', timeout: 15000 },
  );

  assert.equal(child.error, undefined);
  assert.equal(child.signal, 'SIGKILL', child.stderr);

  const raw: unknown = JSON.parse(child.stdout);

  assert.ok(typeof raw === 'object' && raw !== null && 'correlation' in raw);

  const file = (await readdir(join(path, 'events')))[0];

  assert.ok(file);

  await appendFile(join(path, 'events', file), '{partial');
  const before = await readFile(join(path, 'events', file), 'utf8');

  const locked = new ObservationStore(path);

  await assert.rejects(locked.reconcile(), { code: 'TRACE_WRITE_FAILED' });
  await locked.close();

  const recovered = new ObservationStore(path, undefined, { recoverStaleLock: true });
  const terminals = await recovered.reconcile();
  const replay = await recovered.admit(input);
  const inspection = await recovered.inspect();
  await recovered.close();

  assert.equal(terminals.length, 1);
  assert.equal(terminals[0]?.durationMs, null);
  assert.equal(replay.status, 'UNKNOWN');
  assert.equal(inspection[0]?.traceIntegrity, 'INVALID');
  assert.equal(await readFile(join(path, 'events', file), 'utf8'), before);

  const cli = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/bootstrap/cli.ts', '--directory', path],
    { encoding: 'utf8', timeout: 15000 },
  );

  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /"recoveredCount":0/);
  assert.match(cli.stdout, /"unknownCount":1/);
  assert.match(cli.stdout, /"invalidTraceCount":1/);
});

await test('writer kedua tidak dapat menulis ataupun menghapus lock writer hidup dengan flag recovery', async (t) => {
  const path = await directory(t);
  const first = new ObservationStore(path);
  await first.admit(admission());

  for (const recoverStaleLock of [false, true]) {
    const second = new ObservationStore(path, undefined, { recoverStaleLock });
    await assert.rejects(second.reconcile(), { code: 'TRACE_WRITE_FAILED' });
    await second.close();
  }

  await first.admit(admission());

  assert.equal((await first.inspect()).length, 2);

  await first.close();
});

await test('antrean penuh saat finish membuat UNKNOWN yang dapat direkonsiliasi dalam proses yang sama', async (t) => {
  const path = await directory(t);
  let release: (() => void) | undefined;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const store = new ObservationStore(path, undefined, {
    sinkFactory: () => ({
      write: () => (++writes === 2 ? blocker : Promise.resolve()),
      close: () => Promise.resolve(),
    }),
  });
  const input = admission();
  const admitted = await store.admit(input);
  const id = executionId(admitted);
  const records = Array.from({ length: 128 }, () => store.recordHfAttempt(attempt(id)));

  await assert.rejects(store.finish(id, 'SUCCESS', null), { code: 'TRACE_WRITE_FAILED' });

  release?.();
  await Promise.allSettled(records);
  const replay = await store.admit(input);
  const recovered = await store.reconcile();
  await store.close();

  assert.equal(replay.status, 'UNKNOWN');
  assert.equal(recovered.length, 1);
  assert.ok(recovered[0]?.data.kind === 'terminal');
  assert.equal(recovered[0].data.code, 'TRACE_WRITE_FAILED');
});

await test('guard recovery yang tertinggal memerlukan pemeriksaan operator, tanpa membuka inferensi baru', async (t) => {
  const path = await directory(t);
  const store = new ObservationStore(path);
  const input = admission();
  await store.admit(input);
  await store.close();
  await writeFile(
    join(path, 'recovery.lock'),
    JSON.stringify({ pid: 2147483647, host: 'fixture' }),
  );
  const blocked = new ObservationStore(path, undefined, { recoverStaleLock: true });

  await assert.rejects(blocked.reconcile(), { code: 'TRACE_WRITE_FAILED' });

  await blocked.close();

  assert.equal((await readdir(join(path, 'admissions'))).length, 1);

  // Simulate the documented operator cleanup after confirming no recovery process is running.
  await rm(join(path, 'recovery.lock'));
  const recovered = new ObservationStore(path, undefined, { recoverStaleLock: true });

  assert.equal((await recovered.reconcile()).length, 1);
  assert.equal((await recovered.admit(input)).status, 'UNKNOWN');

  await recovered.close();
});

await test('kegagalan penulisan terminal sesudah attempt sukses tetap menjadi UNKNOWN', async (t) => {
  const path = await directory(t);
  let writes = 0;
  const store = new ObservationStore(path, undefined, {
    sinkFactory: () => ({
      write: () =>
        ++writes === 3 ? Promise.reject(new Error('terminal disk failure')) : Promise.resolve(),
      close: () => Promise.resolve(),
    }),
  });
  const input = admission();
  const admitted = await store.admit(input);
  const id = executionId(admitted);
  await store.recordHfAttempt(attempt(id));

  await assert.rejects(store.finish(id, 'SUCCESS', null), { code: 'TRACE_WRITE_FAILED' });

  const replay = await store.admit(input);
  await store.close();

  assert.equal(replay.status, 'UNKNOWN');
  assert.ok(replay.terminal?.data.kind === 'terminal');
  assert.equal(replay.terminal.data.traceComplete, false);
});

await test('terminal registry lengkap dengan baris terminal JSONL hilang terdeteksi INVALID', async (t) => {
  const path = await directory(t);
  const store = new ObservationStore(path);
  const input = admission();
  const admitted = await store.admit(input);
  const id = executionId(admitted);
  await store.finish(id, 'SUCCESS', null);

  assert.equal((await store.inspect())[0]?.traceIntegrity, 'VALID');

  await store.close();

  const tracePath = join(path, 'events', `${id}.jsonl`);
  const lines = (await readFile(tracePath, 'utf8')).trimEnd().split('\n');
  await writeFile(tracePath, `${lines[0] ?? ''}\n`);
  const reopened = new ObservationStore(path);
  const inspection = await reopened.inspect();
  await reopened.close();

  assert.equal(inspection[0]?.traceIntegrity, 'INVALID');
  assert.equal(inspection[0]?.state, 'TERMINAL');
});

await test('JSONL strict, antrean concurrent utuh dan snapshot tidak berubah sesudah write', async (t) => {
  const path = join(await directory(t), 'events.jsonl');
  const sink = new JsonlTraceSink(path);
  const event: TraceEvent = {
    schemaVersion: 'obs-01-v1',
    eventId: randomUUID(),
    correlation: {
      requestId: randomUUID(),
      executionId: randomUUID(),
      traceId: randomUUID(),
      mode: 'LLM_ONLY',
      operation: 'generate',
      experiment: null,
    },
    timestamp: '2026-11-25T00:00:00.000Z',
    durationMs: 0,
    data: { kind: 'request_started', fingerprint: 'a'.repeat(64) },
  };

  await assert.rejects(sink.write({ ...event, prompt: 'SECRET' }));
  await assert.rejects(sink.write({ ...event, durationMs: -1 }));
  await assert.rejects(sink.write({ ...event, durationMs: null }));
  await assert.rejects(sink.write({ ...event, timestamp: '2026-11-25T00:00:00+07:00' }));

  const mutable = structuredClone({ ...event, correlation: { ...event.correlation } });
  const pending = sink.write(mutable);
  mutable.correlation.traceId = randomUUID();
  await Promise.all([
    pending,
    ...Array.from({ length: 30 }, () => sink.write({ ...event, eventId: randomUUID() })),
  ]);
  await sink.close();

  const lines = (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => parseTraceEvent(JSON.parse(line)));

  assert.equal(lines.length, 31);
  assert.equal(lines[0]?.correlation.traceId, event.correlation.traceId);
  assert.equal(new Set(lines.map((line) => line.eventId)).size, 31);
  await assert.rejects(sink.write(event));
});

await test('composition root mencegah HF tanpa admission; attempt provider disimpan durable melalui observer mock', async (t) => {
  const path = await directory(t);
  const observations = new ObservationStore(path);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    return Promise.resolve(
      new Response(JSON.stringify([Array.from({ length: 1024 }, () => 1 / 32)]), { status: 200 }),
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const app = createApplication(
    readConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    undefined,
    readHfConfig({ HF_INFERENCE_ENABLED: 'true', HF_TOKEN: 'private-token' }),
    null,
    observations,
  );
  t.after(() => app.server.close());

  assert.ok(app.inference);

  const context = {
    executionId: randomUUID(),
    deadlineAt: new Date(Date.now() + 5000).toISOString(),
    signal: new AbortController().signal,
  };

  await assert.rejects(app.inference.embedding.embed(['私'], 'query', context), {
    code: 'EXECUTION_NOT_ACTIVE',
  });
  assert.equal(calls, 0);

  const admitted = await observations.admit(admission());
  const id = executionId(admitted);
  await app.inference.embedding.embed(['私'], 'query', { ...context, executionId: id });
  await observations.finish(id, 'SUCCESS', null);
  await app.server.close();

  assert.equal(calls, 1);

  const raw = await readFile(join(path, 'events', `${id}.jsonl`), 'utf8');

  assert.match(raw, /model_attempt/);
  assert.doesNotMatch(raw, /private-token|私/);
});
