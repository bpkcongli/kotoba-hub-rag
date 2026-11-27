import { readFile } from 'node:fs/promises';
import { readQdrantConfig } from '@/modules/knowledge/application/connection-settings';
import { parseIndexManifest, StoreError } from '@/modules/knowledge/application/index-manifest';
import { QdrantIndexStore } from '@/modules/knowledge/interface/secondary/qdrant/qdrant-index';
import { ConfigError } from '@/shared/errors/config-error';

async function main(): Promise<void> {
  const [action, file, ...extra] = process.argv.slice(2);

  if ((action !== 'prepare' && action !== 'validate') || !file || extra.length) {
    throw new Error('Gunakan: npm run store -- prepare|validate path/manifest.json');
  }

  const config = readQdrantConfig(process.env);

  if (!config) {
    throw new ConfigError(['QDRANT_ENABLED']);
  }

  const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
  const manifest = parseIndexManifest(raw);
  const store = new QdrantIndexStore(config);
  const result =
    action === 'prepare' ? await store.prepare(manifest) : await store.validate(manifest);

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof StoreError || error instanceof ConfigError ? error.message : 'Operasi storage gagal; periksa command dan manifest'}\n`,
  );
  process.exitCode = 1;
});
