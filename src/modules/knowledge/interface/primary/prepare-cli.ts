import { resolve } from 'node:path';
import { IngestionError } from '@/modules/knowledge/domain/models/ingestion';
import { prepareCorpus } from '@/modules/knowledge/interface/secondary/corpus/prepare';
import { loadRubricBundle } from '@/modules/knowledge/interface/secondary/corpus/rubric-loader';
import { BGE_TOKENIZER } from '@/modules/knowledge/interface/secondary/corpus/tokenizer';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];

    if (
      !key ||
      !['--config', '--tokenizer', '--out', '--rubric-bundle', '--rubric-bundle-sha256'].includes(
        key,
      ) ||
      !value ||
      value.startsWith('--') ||
      options.has(key)
    ) {
      throw new IngestionError('INVALID_CONFIG');
    }

    options.set(key, value);
  }

  const rubricPath = options.get('--rubric-bundle');
  const rubricHash = options.get('--rubric-bundle-sha256');

  if (
    (rubricPath === undefined) !== (rubricHash === undefined) ||
    (rubricHash !== undefined && !/^[a-f0-9]{64}$/.test(rubricHash))
  ) {
    throw new IngestionError('INVALID_CONFIG');
  }

  const rubricBundle = rubricPath
    ? await loadRubricBundle(resolve(rubricPath), undefined, rubricHash)
    : undefined;
  const manifest = await prepareCorpus({
    ...(rubricBundle ? { rubricBundle } : {}),
    repoRoot: resolve('.'),
    configPath: resolve(options.get('--config') ?? 'research/chunking/data-02-v1/config.json'),
    tokenizerDirectory: resolve(
      options.get('--tokenizer') ?? `artifacts/tokenizers/bge-m3/${BGE_TOKENIZER.revision}`,
    ),
    outputDirectory: resolve(options.get('--out') ?? 'artifacts/data-02/preparation-v2'),
  });

  process.stdout.write(JSON.stringify({ status: manifest.status, counts: manifest.counts }) + '\n');
}

main().catch((error: unknown) => {
  process.stderr.write(
    JSON.stringify({ error: error instanceof IngestionError ? error.code : 'PREPARATION_FAILED' }) +
      '\n',
  );

  process.exitCode = 1;
});
