import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectRubricCorpus } from '@/modules/knowledge/application/rubric-projection';
import { prepareFromInputs } from '@/modules/knowledge/application/services/preparation';
import { parseChunkConfig } from '@/modules/knowledge/application/validation';
import { IngestionError } from '@/modules/knowledge/domain/models/ingestion';
import type { RubricBundle } from '@/modules/knowledge/domain/models/rubric';
import { loadApprovedCorpus } from '@/modules/knowledge/interface/secondary/corpus/corpus-loader';
import { normalizeCorpus } from '@/modules/knowledge/interface/secondary/corpus/normalize';
import {
  BGE_TOKENIZER,
  loadBgeTokenCounter,
} from '@/modules/knowledge/interface/secondary/corpus/tokenizer';

export async function buildPreparation(options: {
  readonly repoRoot: string;

  readonly configPath: string;

  readonly tokenizerDirectory: string;

  readonly rubricBundle?: RubricBundle;
}) {
  const config = parseChunkConfig(JSON.parse(await readFile(options.configPath, 'utf8')));
  const corpus =
    options.rubricBundle === undefined
      ? await loadApprovedCorpus(options.repoRoot)
      : projectRubricCorpus(options.rubricBundle);
  const counter = await loadBgeTokenCounter(options.tokenizerDirectory);

  return prepareFromInputs(corpus, config, counter, BGE_TOKENIZER.files, normalizeCorpus);
}

export async function prepareCorpus(options: {
  readonly repoRoot: string;

  readonly configPath: string;

  readonly tokenizerDirectory: string;

  readonly outputDirectory: string;

  readonly rubricBundle?: RubricBundle;
}) {
  const { manifest, files } = await buildPreparation(options);

  try {
    await mkdir(resolve(options.outputDirectory, '..'), { recursive: true });
    await mkdir(options.outputDirectory);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new IngestionError('OUTPUT_EXISTS');
    }

    throw error;
  }

  for (const [name, body] of Object.entries(files)) {
    await writeFile(resolve(options.outputDirectory, name), body, { flag: 'wx' });
  }

  await writeFile(
    resolve(options.outputDirectory, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  );

  return manifest;
}
