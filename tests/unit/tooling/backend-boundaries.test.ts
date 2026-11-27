import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);

function check(directory?: string) {
  return spawnSync(
    process.execPath,
    ['tools/ref-01/check-boundaries.mjs', ...(directory ? ['--root', directory] : [])],
    { cwd: root, encoding: 'utf8', timeout: 10000 },
  );
}

async function fixture(files: Readonly<Record<string, string>>) {
  const directory = await mkdtemp(join(tmpdir(), 'rag-boundaries-'));

  for (const [name, content] of Object.entries(files)) {
    const file = join(directory, 'src', name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }

  return directory;
}

await test('actual backend import graph respects layers, public facades and has no implementation cycle', () => {
  const result = check();

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Boundary check passed/);
});

await test('consumer adapter may implement its own port and call a public provider facade', async () => {
  const directory = await fixture({
    'modules/consumer/application/ports/catalog.ts':
      'export interface CatalogPort { get(): number; }',
    'modules/provider/application/public.ts': 'export const catalog = { get: () => 1 };',
    'modules/consumer/interface/secondary/catalog.ts': `
      import type { CatalogPort } from '@/modules/consumer/application/ports/catalog';
      import { catalog } from '@/modules/provider/application/public';
      export class Adapter implements CatalogPort { get() { return catalog.get(); } }
    `,
  });

  try {
    const result = check(directory);

    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('boundary guard rejects imports, re-exports and dynamic dependencies that bypass layers', async () => {
  const violations = [
    [
      'modules/sample/domain/model.ts',
      "import { readFile } from 'node:fs/promises';",
      /I\/O dependency|external validator/,
    ],
    [
      'modules/sample/application/service.ts',
      "export { value } from '@/modules/sample/interface/secondary/store';",
      /inner layer imports adapter/,
    ],
    [
      'modules/sample/application/service.ts',
      "void import('@/modules/sample/interface/secondary/store');",
      /inner layer imports adapter/,
    ],
    ['modules/sample/application/service.ts', "void import('openai');", /I\/O dependency/],
    [
      'modules/sample/application/service.ts',
      'const name = process.argv[2]; void import(name);',
      /nonliteral module dependency/,
    ],
    ['modules/sample/application/service.ts', 'const config = process.env;', /reads process.env/],
    [
      'modules/sample/application/service.ts',
      "import type { Secret } from '@/modules/other/domain/model';",
      /bypasses public facade/,
    ],
    [
      'shared/kernel.ts',
      "import type { Secret } from '@/modules/other/domain/model';",
      /shared kernel imports feature/,
    ],
  ] as const;

  for (const [file, source, expected] of violations) {
    const directory = await fixture({
      'modules/sample/interface/secondary/store.ts': 'export const value = 1;',
      'modules/other/domain/model.ts': 'export interface Secret { value: number; }',
      [file]: source,
    });

    try {
      const result = check(directory);

      assert.equal(result.status, 1, `${file}: ${source}`);
      assert.match(result.stderr, expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

await test('runtime dependency cycles fail while a cycle of type-only contracts is permitted', async () => {
  for (const typeOnly of [false, true]) {
    const declaration = typeOnly ? 'type ' : '';
    const directory = await fixture({
      'modules/one/application/public.ts': `import ${declaration}{ Two } from '@/modules/two/application/public'; export class One { next?: Two; }`,
      'modules/two/application/public.ts': `import ${declaration}{ One } from '@/modules/one/application/public'; export class Two { next?: One; }`,
    });

    try {
      const result = check(directory);

      assert.equal(result.status, typeOnly ? 0 : 1, result.stderr);
      if (!typeOnly) {
        assert.match(result.stderr, /implementation cycle/);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
