import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateAudit, validateDenseDecision } from './validate.mjs';

const directory = new URL('../../docs/inference/', import.meta.url);
const files = ['INF-01-manifest.json', 'INF-01-discovery.json', 'INF-01-fixtures.json'];
const values = await Promise.all(
  files.map(async (file) => JSON.parse(await readFile(new URL(file, directory), 'utf8'))),
);

validateAudit(...values);

const currentFiles = [
  '../../docs/inference/INF-01-manifest-v2.json',
  '../../research/protocol-v2-dense/decision.json',
  '../../research/protocol-v2-dense/manifest.template.json',
  '../../research/protocol-v1/manifest.template.json',
];
const current = await Promise.all(
  currentFiles.map(async (file) =>
    JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8')),
  ),
);

validateDenseDecision(...current);

for (const [file, checksum] of Object.entries(current[1].baseArtifacts)) {
  assert.ok(
    ['research/protocol-v1/plan.json', 'research/protocol-v1/manifest.template.json'].includes(
      file,
    ),
  );

  const bytes = await readFile(new URL(`../../${file}`, import.meta.url));

  assert.equal(createHash('sha256').update(bytes).digest('hex'), checksum);
}

console.log(
  'Snapshot historis INF-01 v1/v2 valid: audit/keputusan sebelum smoke (0 calls pada snapshot tersebut). Capture aktual diperiksa terpisah.',
);
