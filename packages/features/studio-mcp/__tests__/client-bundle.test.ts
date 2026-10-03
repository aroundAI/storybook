import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * KB-180: the request context holds an `AsyncLocalStorage` from
 * `node:async_hooks`, and the package root re-exports it. A client component
 * that imports a value from `@kit/studio-mcp` pulls that into the browser
 * bundle and the page fails to build. Client code takes values from the
 * client-safe subpath `@kit/studio-mcp/scopes` (types may still come from the
 * root: they are erased).
 */

const REPO = resolve(__dirname, '../../../..');
const SRC = resolve(__dirname, '../src');
const ROOTS = ['apps/web', 'packages'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.open-next',
  '.sst',
  'dist',
  'build',
  'coverage',
]);
const TEST_FILE =
  /(?:^|\/)(?:__tests__|__mocks__|e2e)\/|\.(?:test|spec)\.[jt]sx?$/;

function sourceFiles(path: string): string[] {
  const absolute = join(REPO, path);

  if (!statSync(absolute).isDirectory()) {
    return /\.tsx?$/.test(path) ? [path] : [];
  }

  return readdirSync(absolute).flatMap((entry) =>
    SKIP_DIRS.has(entry) ? [] : sourceFiles(join(path, entry)),
  );
}

const parse = (file: string, text: string) =>
  ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

const isUseClient = (source: ts.SourceFile) => {
  const first = source.statements[0];

  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use client'
  );
};

/** Import declarations that survive compilation (not `import type`). */
function valueImports(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement)) return [];
    if (!ts.isStringLiteral(statement.moduleSpecifier)) return [];

    const clause = statement.importClause;
    const erased =
      !!clause &&
      (clause.isTypeOnly ||
        (!clause.name &&
          !!clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every(
            (element) => element.isTypeOnly,
          )));

    return erased ? [] : [statement.moduleSpecifier.text];
  });
}

/** Every `'use client'` file that mentions the package at all, or imports relatively. */
const clientFiles = () =>
  ROOTS.flatMap(sourceFiles)
    .map((file) => join(REPO, file))
    .filter(
      (file) => !TEST_FILE.test(relative(REPO, file).split(sep).join('/')),
    )
    .filter((file) => {
      const text = readFileSync(file, 'utf8');

      return text.includes('use client') && isUseClient(parse(file, text));
    });

describe('KB-180: client bundles stay free of node builtins', () => {
  it("nothing a 'use client' file imports reaches the @kit/studio-mcp root", () => {
    const resolveRelative = (from: string, spec: string): string | null => {
      const base = resolve(dirname(from), spec);

      return (
        [
          `${base}.ts`,
          `${base}.tsx`,
          join(base, 'index.ts'),
          join(base, 'index.tsx'),
        ].find((candidate) => existsSync(candidate)) ?? null
      );
    };

    const violations: string[] = [];

    for (const file of clientFiles()) {
      const seen = new Set<string>();
      const visit = (current: string) => {
        if (seen.has(current)) return;
        seen.add(current);

        const source = parse(current, readFileSync(current, 'utf8'));

        for (const from of valueImports(source)) {
          if (from === '@kit/studio-mcp') {
            violations.push(
              `${relative(REPO, file)} reaches the root through ${relative(REPO, current)}`,
            );
          } else if (from.startsWith('.')) {
            const target = resolveRelative(current, from);
            if (target) visit(target);
          }
        }
      };

      visit(file);
    }

    expect(violations).toEqual([]);
  });

  it('the scopes subpath reaches no node builtin and no server-only module', () => {
    const seen = new Set<string>();
    const problems: string[] = [];

    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);

      const source = parse(file, readFileSync(file, 'utf8'));

      for (const from of valueImports(source)) {
        if (from.startsWith('node:') || from === 'server-only') {
          problems.push(`${relative(SRC, file)} imports ${from}`);
        } else if (from.startsWith('.')) {
          const target = resolve(dirname(file), from);
          visit(`${target}.ts`);
        }
      }
    };

    visit(join(SRC, 'scopes.ts'));

    expect(problems).toEqual([]);
    expect([...seen].map((file) => relative(SRC, file))).toEqual(['scopes.ts']);
  });

  it('the package exposes the client-safe scopes subpath', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
    ) as { exports: Record<string, string> };

    expect(pkg.exports['./scopes']).toBe('./src/scopes.ts');
  });
});
