import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const root = new URL('../../../', import.meta.url);
const eslint = new ESLint();

await test('ESLint menolak import relatif dan alias # pada src dan tests', async () => {
  const samples = [
    ["import { readConfig } from './shared/config.ts'; readConfig({});", 'no-restricted-imports'],
    ["import '../shared/config.ts';", 'no-restricted-imports'],
    [
      "import type { AppConfig } from './shared/config.ts'; export type Config = AppConfig;",
      'no-restricted-imports',
    ],
    ["export * from './shared/config.ts';", 'no-restricted-imports'],
    ["export { readConfig } from './shared/config.ts';", 'no-restricted-imports'],
    ["void import('./shared/config.ts');", 'no-restricted-syntax'],
    ['void import(`./shared/config.ts`);', 'no-restricted-syntax'],
    ["const module = 'config'; void import(`../shared/${module}.ts`);", 'no-restricted-syntax'],
    ["export type Config = import('./shared/config.ts').AppConfig;", 'no-restricted-syntax'],
    ["import { readConfig } from '#src/shared/config'; readConfig({});", 'no-restricted-imports'],
    ["void import('#src/shared/config');", 'no-restricted-syntax'],
    ['void import(`#src/shared/config`);', 'no-restricted-syntax'],
    ["export type Config = import('#src/shared/config').AppConfig;", 'no-restricted-syntax'],
  ] as const;

  for (const filePath of ['src/main.ts', 'tests/unit/app/app.test.ts']) {
    for (const [source, rule] of samples) {
      const [result] = await eslint.lintText(source, { filePath });

      assert.ok(result);
      assert.equal(result.fatalErrorCount, 0, source);
      assert.ok(
        result.messages.some(({ ruleId }) => ruleId === rule),
        `${filePath}: ${source}`,
      );
    }
  }
});

await test('ESLint menerima alias, import bawaan Node dan dependency eksternal', async () => {
  const samples = [
    "import { readConfig } from '@/bootstrap/config'; readConfig({});",
    "import type { AppConfig } from '@/bootstrap/config'; export type Config = AppConfig;",
    "export { readConfig } from '@/bootstrap/config';",
    "void import('@/bootstrap/config');",
    "void import('@tests/unit/app/app.test');",
    "export type Config = import('@/bootstrap/config').AppConfig;",
    "import fixtures from '@contracts/v1/fixtures.json' with { type: 'json' }; void fixtures;",
    "void import(`@contracts/v1/${'fixtures'}.json`, { with: { type: 'json' } });",
    "import { readFileSync } from 'node:fs'; import { Ajv } from 'ajv'; void readFileSync; void new Ajv();",
  ];

  for (const source of samples) {
    const [result] = await eslint.lintText(source, { filePath: 'src/main.ts' });

    assert.ok(result);
    assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
  }
});

await test('ESLint juga menolak import relatif pada konfigurasi dan tooling runtime', async () => {
  for (const filePath of ['eslint.config.mjs', 'tools/boot-01/generate-types.mjs']) {
    const [result] = await eslint.lintText("import './local.mjs';", { filePath });

    assert.ok(result);
    assert.equal(result.fatalErrorCount, 0);
    assert.ok(result.messages.some(({ ruleId }) => ruleId === 'no-restricted-imports'));
  }
});

await test('tsx memuat alias source dan fixture JSON tanpa build', () => {
  const source = `
    import { readConfig } from '@/bootstrap/config';
    import fixtures from '@contracts/v1/fixtures.json' with { type: 'json' };

    console.log(JSON.stringify([readConfig({}).port, fixtures.cases.length]));
  `;

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', source],
    {
      cwd: root,
      env: { ...process.env, NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 10000,
    },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '[3000,16]');
});
