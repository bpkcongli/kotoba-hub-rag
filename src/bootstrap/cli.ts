import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ObservationStore } from '@/bootstrap/observation-store';
import { publishJson } from '@/shared/files';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--directory');
  const directoryArg = flag >= 0 ? args[flag + 1] : undefined;
  const recoverStaleLock = args.includes('--recover-stale-lock');
  const allowed = new Set(['--directory', '--recover-stale-lock', directoryArg]);

  if (
    !directoryArg ||
    directoryArg.startsWith('--') ||
    args.some((arg) => !allowed.has(arg)) ||
    args.filter((arg) => arg === '--directory').length !== 1
  ) {
    throw new Error('Gunakan --directory <path> [--recover-stale-lock]');
  }

  const directory = resolve(directoryArg);
  if (!(await stat(directory)).isDirectory()) {
    throw new Error('Registry tidak ditemukan');
  }

  const store = new ObservationStore(directory, undefined, { recoverStaleLock });

  try {
    const recovered = await store.reconcile();
    const executions = await store.inspect();
    const rejections = await store.rejected();
    const report = {
      schemaVersion: 'obs-01-reconciliation-v1',
      timestamp: new Date().toISOString(),
      recoveredCount: recovered.length,
      executions,
      rejections,
    };
    const filename = `reconciliation-${randomUUID()}.json`;

    await publishJson(resolve(directory, filename), report);
    process.stdout.write(
      `${JSON.stringify({
        report: filename,
        recoveredCount: recovered.length,
        executionCount: executions.length,
        rejectionCount: rejections.length,
        unknownCount: executions.filter((row) => row.state === 'UNKNOWN').length,
        invalidTraceCount: executions.filter((row) => row.traceIntegrity !== 'VALID').length,
        terminalWithoutResponseCount: executions.filter(
          (row) => row.state === 'TERMINAL' && row.responseIntegrity === 'MISSING',
        ).length,
        invalidResponseCount: executions.filter((row) => row.responseIntegrity === 'INVALID')
          .length,
      })}\n`,
    );
  } finally {
    await store.close();
  }
}

void main().catch(() => {
  process.stderr.write(
    'Rekonsiliasi OBS-01 gagal; periksa registry dan kepemilikan writer tanpa menjalankan inferensi ulang.\n',
  );
  process.exitCode = 1;
});
