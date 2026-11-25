import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { aggregateAccounting } from '@/observability/aggregation';
import { publishJson } from '@/observability/files';
import { ObservationStore } from '@/observability/store';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const position = args.indexOf('--directory');
  const directoryArg = position < 0 ? undefined : args[position + 1];
  const allowed = new Set([
    '--directory',
    directoryArg,
    '--resource-inventory-complete',
    '--recover-stale-lock',
  ]);

  if (
    !directoryArg ||
    directoryArg.startsWith('--') ||
    args.some((arg) => !allowed.has(arg)) ||
    args.filter((arg) => arg === '--directory').length !== 1
  ) {
    throw new Error('Argumen accounting tidak valid');
  }

  const directory = resolve(directoryArg);

  if (!(await stat(directory)).isDirectory()) {
    throw new Error('Registry tidak ditemukan');
  }

  const store = new ObservationStore(directory, undefined, {
    recoverStaleLock: args.includes('--recover-stale-lock'),
  });

  try {
    const ledger = await store.exportAccounting(args.includes('--resource-inventory-complete'));
    const summary = aggregateAccounting(ledger.input);
    const filename = `cost-report-${randomUUID()}.json`;

    await publishJson(resolve(directory, filename), {
      schemaVersion: 'obs-02-report-v1',
      timestamp: new Date().toISOString(),
      ...ledger,
      summary,
    });

    process.stdout.write(
      `${JSON.stringify({
        report: filename,
        callCount: ledger.input.calls.length,
        unaccountedAttemptCount: ledger.unaccountedAttemptIds.length,
        ...summary.runTotal,
      })}\n`,
    );
  } finally {
    await store.close();
  }
}

void main().catch(() => {
  process.stderr.write(
    'Ekspor accounting OBS-02 gagal; periksa trace, snapshot harga dan resource ledger tanpa inferensi ulang.\n',
  );
  process.exitCode = 1;
});
