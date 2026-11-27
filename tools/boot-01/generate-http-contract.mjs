import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const { httpSchema } = await import(new URL('http-contract.mjs', import.meta.url).href);

const root = new URL('../../', import.meta.url);
const original = JSON.parse(
  await readFile(new URL('contracts/v1/contract.schema.json', root), 'utf8'),
);
const schema = httpSchema(original);
schema.$id = 'https://kotobahub.invalid/contracts/v1/http.schema.json';
const output = `${JSON.stringify(schema, null, 2)}\n`;
const destination = new URL('contracts/v1/http.schema.json', root);

if (process.argv.includes('--check')) {
  assert.equal(
    await readFile(destination, 'utf8'),
    output,
    'HTTP schema drift; jalankan npm run contracts:generate',
  );
} else {
  await writeFile(destination, output);
}
