import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

// Renamed source files must not leave executable copies from an older layout.
await rm(new URL('dist/', root), { recursive: true, force: true });

const commands = [
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'],
  [
    'node_modules/tsc-alias/dist/bin/index.js',
    '-p',
    'tsconfig.build.json',
    '--resolve-full-paths',
    '--resolve-full-extension',
    '.js',
  ],
];

for (const args of commands) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });

  if (result.error || result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
