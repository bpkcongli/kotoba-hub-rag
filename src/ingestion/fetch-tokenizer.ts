import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { BGE_TOKENIZER } from '@/ingestion/tokenizer';
import { IngestionError } from '@/ingestion/types';
import { hash } from '@/ingestion/validation';

async function main(): Promise<void> {
  const directory = resolve(`artifacts/tokenizers/bge-m3/${BGE_TOKENIZER.revision}`);

  await mkdir(directory, { recursive: true });

  for (const [name, expected] of Object.entries(BGE_TOKENIZER.files)) {
    const path = resolve(directory, name);

    try {
      const existing = await readFile(path);

      if (hash(existing) !== expected) {
        throw new IngestionError('INTEGRITY_ERROR');
      }

      continue;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }

    let url = new URL(
      `https://huggingface.co/${BGE_TOKENIZER.model}/resolve/${BGE_TOKENIZER.revision}/${name}`,
    );
    let body: Uint8Array | undefined;
    const signal = AbortSignal.timeout(60000);

    for (let hop = 0; hop < 5; hop++) {
      if (
        url.protocol !== 'https:' ||
        !(
          url.hostname === 'huggingface.co' ||
          url.hostname.endsWith('.huggingface.co') ||
          url.hostname === 'hf.co' ||
          url.hostname.endsWith('.hf.co')
        )
      ) {
        throw new IngestionError('INVALID_TOKENIZER');
      }

      const response = await fetch(url, { redirect: 'manual', signal });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();

        if (!location) {
          throw new IngestionError('INVALID_TOKENIZER');
        }

        url = new URL(location, url);
        continue;
      }

      if (!response.ok || !response.body) {
        throw new IngestionError('INVALID_TOKENIZER');
      }

      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let bytes = 0;

      try {
        for (;;) {
          const part = await reader.read();

          if (part.done) {
            break;
          }

          bytes += part.value.byteLength;

          if (bytes > 20 * 1024 * 1024) {
            throw new IngestionError('INVALID_TOKENIZER');
          }

          parts.push(part.value);
        }
      } finally {
        await reader.cancel();
      }

      body = Buffer.concat(parts);
      break;
    }

    if (!body || hash(body) !== expected) {
      throw new IngestionError('INTEGRITY_ERROR');
    }

    await writeFile(path, body, { flag: 'wx' });
  }

  process.stdout.write(
    JSON.stringify({
      model: BGE_TOKENIZER.model,
      revision: BGE_TOKENIZER.revision,
      filesVerified: 2,
      inferenceCalls: 0,
    }) + '\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    JSON.stringify({
      error: error instanceof IngestionError ? error.code : 'TOKENIZER_DOWNLOAD_FAILED',
    }) + '\n',
  );

  process.exitCode = 1;
});
