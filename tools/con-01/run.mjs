// Tooling audit terisolasi; dependency aplikasi dibaca tanpa install atau edit.
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));

if (process.version !== "v24.22.3")
  throw new Error("Gunakan Node 24.22.3 sesuai pin DEC-01.");

const root = resolve(here, "../..");

const app = resolve(process.env.KOTOBA_APP ?? resolve(root, "../kotoba-hub"));

const requireApp = createRequire(resolve(app, "package.json"));

const expected = {
  zod: "4.6.5",
  ajv: "8.20.0",
  "ajv-formats": "3.0.1",
  typescript: "5.9.3",
  esbuild: "0.25.12",
};

for (const [name, version] of Object.entries(expected)) {
  if (requireApp(`${name}/package.json`).version !== version) {
    throw new Error(
      `Dependency ${name} harus ${version}; audit ulang sebelum mengganti pin.`,
    );
  }
}

const action = process.argv[2] ?? "verify";

if (!["export", "verify", "typecheck"].includes(action))
  throw new Error("Gunakan export, verify, atau typecheck.");

const scratch = await mkdtemp(resolve(tmpdir(), "kotoba-con01-"));

try {
  const config = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      // Mengompilasi source aplikasi read-only dengan semantik optional milik aplikasi.
      // exactOptionalPropertyTypes dievaluasi kembali pada BOOT-01 untuk runtime RAG.
      noUncheckedIndexedAccess: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
      types: ["node"],
      typeRoots: [resolve(app, "node_modules/@types")],
      baseUrl: app,
      paths: {
        "@/*": ["src/*"],
        "kotoba-app/*": ["./*"],
        zod: ["node_modules/zod"],
        ajv: ["node_modules/ajv"],
        "ajv-formats": ["node_modules/ajv-formats"],
      },
    },
    files: ["definition.ts", "fixtures.ts", "verify.ts"].map((f) =>
      resolve(here, f),
    ),
  };

  const tsconfig = resolve(scratch, "tsconfig.json");

  await writeFile(tsconfig, JSON.stringify(config));

  const check = spawnSync(
    process.execPath,
    [requireApp.resolve("typescript/bin/tsc"), "-p", tsconfig],
    { stdio: "inherit" },
  );

  if (check.status !== 0) throw new Error("Typecheck gagal.");

  if (action !== "typecheck") {
    const entry = resolve(scratch, "entry.ts");

    await writeFile(
      entry,
      `import { run } from ${JSON.stringify(resolve(here, "verify.ts"))}; await run();`,
    );
    await requireApp("esbuild").build({
      entryPoints: [entry],
      outfile: resolve(scratch, "entry.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      packages: "bundle",
      alias: { "kotoba-app": app },
      nodePaths: [resolve(app, "node_modules")],
      tsconfig: resolve(app, "tsconfig.json"),
      banner: {
        js: 'import { createRequire as con01CreateRequire } from "node:module"; const require = con01CreateRequire(import.meta.url);',
      },
    });

    const result = spawnSync(
      process.execPath,
      [resolve(scratch, "entry.mjs"), action],
      {
        stdio: "inherit",
        cwd: root,
        env: { ...process.env, CON01_APP: app, CON01_ROOT: root },
      },
    );

    if (result.status !== 0) throw new Error("Verifikasi CON-01 gagal.");
  }

  console.log(`CON-01 ${action}: lulus (Node ${process.version}).`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
