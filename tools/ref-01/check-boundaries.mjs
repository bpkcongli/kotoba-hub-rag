import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root =
  process.argv[2] === '--root'
    ? resolve(process.argv[3])
    : fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = resolve(root, 'src');
const files = readdirSync(sourceRoot, { recursive: true })
  .filter((file) => file.endsWith('.ts'))
  .map((file) => resolve(sourceRoot, file));
const graph = new Map(files.map((file) => [file, []]));
const failures = [];
const moduleOf = (file) =>
  relative(sourceRoot, file)
    .replaceAll('\\', '/')
    .match(/^modules\/([^/]+)\/([^/]+)\//);

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const owner = moduleOf(file);
  const layer = owner?.[2];
  const inner = layer === 'domain' || layer === 'application';

  const report = (node, rule) => {
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    failures.push(`${relative(root, file)}:${line}: ${rule}`);
  };

  const dependency = (node, specifier, typeOnly) => {
    const local = specifier.startsWith('@/') || specifier.startsWith('.');
    const target = local
      ? resolve(
          specifier.startsWith('@/') ? sourceRoot : dirname(file),
          specifier.startsWith('@/') ? specifier.slice(2) : specifier,
        ).replace(/\.(js|ts)$/, '') + '.ts'
      : null;
    const provider = target === null ? null : moduleOf(target);

    if (local && !graph.has(target)) {
      report(node, `unresolved project dependency ${specifier}`);
    }

    if (inner && target && /\/(?:interface|infrastructure|bootstrap)\//.test(target)) {
      report(node, `inner layer imports adapter/composition ${specifier}`);
    }

    if (
      layer === 'domain' &&
      target &&
      !(provider?.[1] === owner[1] && provider?.[2] === 'domain') &&
      !relative(sourceRoot, target).startsWith('shared/')
    ) {
      report(node, `domain imports outside its model boundary ${specifier}`);
    }

    if (layer === 'domain' && !local && !['node:crypto'].includes(specifier)) {
      report(node, `domain imports external validator/transport ${specifier}`);
    }

    if (
      inner &&
      /^(?:node:(?:fs|http|https|net|os)(?:\/|$)|@qdrant\/|openai(?:\/|$)|parse5(?:\/|$)|tokenizers(?:\/|$))/.test(
        specifier,
      )
    ) {
      report(node, `inner layer imports I/O dependency ${specifier}`);
    }

    if (
      owner &&
      provider &&
      owner[1] !== provider[1] &&
      layer !== 'infrastructure' &&
      !specifier.endsWith('/application/public')
    ) {
      report(node, `context crossing bypasses public facade ${specifier}`);
    }

    if (
      relative(sourceRoot, file).startsWith('shared/') &&
      (provider || specifier.startsWith('@contracts/') || specifier.startsWith('@/contracts/'))
    ) {
      report(node, `shared kernel imports feature/transport ${specifier}`);
    }

    if (target && graph.has(target) && !typeOnly) {
      graph.get(file).push(target);
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      const typeOnly =
        node.importClause?.isTypeOnly ||
        (!node.importClause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.every((entry) => entry.isTypeOnly));
      dependency(node, node.moduleSpecifier.text, typeOnly);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly =
        node.isTypeOnly ||
        (node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.every((entry) => entry.isTypeOnly));
      dependency(node, node.moduleSpecifier.text, typeOnly);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      dependency(node, node.argument.literal.text, true);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      if (node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) {
        dependency(node, node.arguments[0].text, false);
      } else if (inner) {
        report(node, 'inner layer uses a nonliteral module dependency');
      }
    } else if (
      inner &&
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env'
    ) {
      report(node, 'inner layer reads process.env');
    }

    ts.forEachChild(node, visit);
  };

  visit(tree);
}

const done = new Set();
const active = new Set();
const visitGraph = (file, chain) => {
  if (active.has(file)) {
    failures.push(
      `implementation cycle: ${[...chain.slice(chain.indexOf(file)), file].map((item) => relative(sourceRoot, item)).join(' -> ')}`,
    );

    return;
  }

  if (done.has(file)) {
    return;
  }

  active.add(file);

  for (const next of graph.get(file)) {
    visitGraph(next, [...chain, file]);

  }
  active.delete(file);
  done.add(file);
};

for (const file of files) {
  visitGraph(file, []);
}

if (failures.length) {
  process.stderr.write([...new Set(failures)].join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Boundary check passed: ${files.length} TypeScript files; no implementation cycles.\n`,
  );
}
