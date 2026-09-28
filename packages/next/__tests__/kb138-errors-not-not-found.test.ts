import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-138: a read's error must not reach the user as "not found". Seventeen
 * actions refused with `if (error || !row) throw new ActionRefusal('… not
 * found')`, so a statement timeout read as a missing row (KB-137) and was
 * never logged as the crash it was. `requireRow` (@kit/next/refusals) refuses
 * only when there is no row, and throws any other error.
 */
const REPO = join(__dirname, '..', '..', '..');
const ROOTS = ['apps/web/app', 'apps/web/lambda', 'packages'];
const SKIPPED = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '__tests__',
  '__mocks__',
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED.has(entry.name) ? [] : sourceFiles(path);
    }

    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

export function findErrorsRefusedAsNotFound(source: string): number[] {
  const lines = source.split('\n');

  return lines.flatMap((line, index) =>
    !/^\s*(\*|\/\/)/.test(line) &&
    /if \(\s*\w*[eE]rror\s*(\|\||\?\?)\s*!\w+\s*\)/.test(line) &&
    /new ActionRefusal\([^)]*not found/i.test(
      lines.slice(index, index + 3).join(' '),
    )
      ? [index + 1]
      : [],
  );
}

describe('KB-138: a failed read is not refused as "not found"', () => {
  it('finds none in the repo', () => {
    const found = ROOTS.flatMap((root) =>
      sourceFiles(join(REPO, root)).flatMap((file) =>
        findErrorsRefusedAsNotFound(readFileSync(file, 'utf8')).map(
          (line) => `${relative(REPO, file)}:${line}`,
        ),
      ),
    );

    expect(
      found,
      "pass the read to requireRow(await ….single(), '… not found') from @kit/next/refusals",
    ).toEqual([]);
  });

  it('finds the shape it guards against', () => {
    expect(
      findErrorsRefusedAsNotFound(
        `if (fetchError || !post) {\n  throw new ActionRefusal('Social post not found');\n}`,
      ),
    ).toEqual([1]);
  });

  it('passes a refusal that is not about a failed read', () => {
    expect(
      findErrorsRefusedAsNotFound(
        `if (!post) {\n  throw new ActionRefusal('Social post not found');\n}`,
      ),
    ).toEqual([]);
  });
});
