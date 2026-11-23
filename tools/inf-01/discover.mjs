import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const sources = Object.freeze([
  'https://huggingface.co/api/models/BAAI/bge-m3?expand%5B%5D=sha&expand%5B%5D=inferenceProviderMapping',
  'https://huggingface.co/api/models/BAAI/bge-reranker-v2-m3?expand%5B%5D=sha&expand%5B%5D=inferenceProviderMapping',
  'https://api.github.com/repos/huggingface/text-embeddings-inference/pulls/899',
]);

// Fixed public metadata only: no environment/token, POST, inference, or redirects.
export async function discover(fetcher = fetch) {
  const records = [];

  for (const url of sources) {
    const started = performance.now();
    const record = { url, retrievedAt: new Date().toISOString() };

    try {
      const response = await fetcher(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { accept: 'application/json' },
      });

      record.httpStatus = response.status;

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('HTTP_STATUS');
      }

      const chunks = [];
      let size = 0;

      for await (const chunk of response.body ?? []) {
        size += chunk.length;

        if (size > 262144) {
          throw new Error('RESPONSE_TOO_LARGE');
        }

        chunks.push(chunk);
      }

      const bytes = Buffer.concat(chunks);
      const data = JSON.parse(bytes.toString('utf8'));

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('INVALID_METADATA');
      }

      if (url.startsWith('https://huggingface.co/')) {
        assert.equal(data.id, new URL(url).pathname.slice('/api/models/'.length));
        assert.match(data.sha, /^[a-f0-9]{40}$/);
        assert.ok(
          data.inferenceProviderMapping &&
            typeof data.inferenceProviderMapping === 'object' &&
            !Array.isArray(data.inferenceProviderMapping),
        );
      } else {
        assert.equal(data.number, 899);
        assert.ok(['open', 'closed'].includes(data.state));
        assert.equal(typeof data.merged, 'boolean');
      }

      record.sha256 = createHash('sha256').update(bytes).digest('hex');
      record.data = url.startsWith('https://huggingface.co/')
        ? { id: data.id, sha: data.sha, inferenceProviderMapping: data.inferenceProviderMapping }
        : {
            number: data.number,
            state: data.state,
            merged: data.merged,
            updated_at: data.updated_at,
          };
      record.outcome = 'success';
    } catch {
      // Never persist raw errors, headers, or response bodies on failure.
      record.outcome = 'failed';
      record.data = null;
    }

    record.elapsedMs = performance.now() - started;
    records.push(record);
  }

  return {
    kind: 'PUBLIC_DISCOVERY_NOT_INFERENCE',
    inferenceCalls: 0,
    records,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2];

  if (!output || process.argv.length !== 3) {
    throw new Error('Usage: node tools/inf-01/discover.mjs NEW_OUTPUT.json');
  }

  const result = await discover();

  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });

  process.exitCode = result.records.every((record) => record.outcome === 'success') ? 0 : 1;
}
