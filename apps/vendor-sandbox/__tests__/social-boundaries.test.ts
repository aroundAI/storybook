import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1802 criterion 11: the sandbox never ships. Nothing builds, bundles,
 * deploys or imports it.
 *
 * Its other boundary, that no app call can bypass it by naming a vendor
 * host, is FILM-1723/FILM-1801's guard
 * (packages/shared/__tests__/vendor-api-versions.test.ts), which reads every
 * host from the resolver. It is not restated here.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = ['apps/web/app', 'apps/web/lib', 'apps/web/lambda', 'packages'];
const SKIP = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  '__tests__',
  '__mocks__',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs|js)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

describe('the sandbox never ships', () => {
  const pkg = JSON.parse(
    readFileSync(join(REPO, 'apps/vendor-sandbox/package.json'), 'utf8'),
  ) as { scripts: Record<string, string>; private?: boolean };

  it('has no build script for a deploy to pick up, and is private', () => {
    expect(pkg.scripts.build).toBeUndefined();
    expect(pkg.private).toBe(true);
  });

  it('is named by no deploy configuration', () => {
    for (const file of ['sst.config.ts', 'turbo.json']) {
      expect(readFileSync(join(REPO, file), 'utf8'), file).not.toMatch(
        /vendor-sandbox/,
      );
    }
  });

  it('is imported by nothing in the app or its packages', () => {
    const importers = ROOTS.flatMap((root) => sourceFiles(join(REPO, root)))
      .filter((path) =>
        /from ['"](?:vendor-sandbox|[./]+apps\/vendor-sandbox)/.test(
          readFileSync(path, 'utf8'),
        ),
      )
      .map((path) => relative(REPO, path));
    expect(importers).toEqual([]);
  });
});
