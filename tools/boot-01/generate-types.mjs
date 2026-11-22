import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const inputs = ['domain', 'contract'];
const parts = ['// Generated from contracts/v1; run npm run contracts:generate.\n'];

const literals = (values) => values.map((v) => JSON.stringify(v)).join(' | ');

// Subset draft-07 yang dipakai snapshot CON-01. Node baru gagal eksplisit.
function typeOf(schema) {
  if (schema.$ref) {
    return schema.$ref.split('/').at(-1);
  }
  if ('const' in schema) {
    return JSON.stringify(schema.const);
  }
  if (schema.enum) {
    return literals(schema.enum);
  }

  const union = schema.anyOf ?? schema.oneOf;

  if (union) {
    return union.map(typeOf).join(' | ');
  }

  switch (schema.type) {
    case 'null':
      return 'null';
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'integer':
    case 'number':
      return 'number';
    case 'array':
      return `Array<${typeOf(schema.items)}>`;

    case 'object':
      if (schema.additionalProperties !== false) {
        throw new Error('Object harus strict');
      }

      return `{ ${Object.entries(schema.properties)
        .map(
          ([name, child]) =>
            `${JSON.stringify(name)}${schema.required.includes(name) ? '' : '?'}: ${typeOf(child)};`,
        )
        .join(' ')} }`;

    default:
      throw new Error(`Schema tidak didukung: ${JSON.stringify(schema)}`);
  }
}

for (const input of inputs) {
  const path = `contracts/v1/${input}.schema.json`;
  const source = await readFile(resolve(root, path), 'utf8');

  parts.push(`// ${path}: sha256 ${createHash('sha256').update(source).digest('hex')}\n`);

  for (const [name, schema] of Object.entries(JSON.parse(source).definitions)) {
    parts.push(`export type ${name} = ${typeOf(schema)};\n`);
  }
}

// Formatter yang sama dengan checks root, bukan format snapshot kontrak.
const { format, resolveConfig } = await import('prettier');
const destination = resolve(root, 'src/contracts/v1.generated.ts');
const config = await resolveConfig(destination);

const output = await format(parts.join('\n'), { ...config, parser: 'typescript' });

if (process.argv.includes('--check')) {
  if ((await readFile(destination, 'utf8')) !== output) {
    throw new Error('Tipe kontrak drift; jalankan npm run contracts:generate');
  }
} else {
  await writeFile(destination, output);
}
