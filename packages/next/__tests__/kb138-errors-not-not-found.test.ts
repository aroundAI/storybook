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

/**
 * KB-138's remainder, and the lead it explained: the same `if (error ||
 * !row)` shape that throws a plain `Error`, or returns "not found" as a
 * value, said "Social post not found" for KB-137's statement timeouts. A
 * block that says "not found" words its message with `whyNoRow` (failed
 * reads say what failed), or is preceded by `if (readFailed(error)) throw`
 * so it only ever answers a missing row. Both from `@kit/shared/rows`.
 */
export function findFailedReadsWordedNotFound(source: string): number[] {
  const lines = source.split('\n');
  const found: number[] = [];
  const shape = /if \(\s*(\w*[eE]rror)\s*(\|\||\?\?)\s*!\w+\s*\)\s*\{/g;

  for (let match; (match = shape.exec(source)); ) {
    const line = source.slice(0, match.index).split('\n').length;
    if (/^\s*(\*|\/\/)/.test(lines[line - 1]!)) continue;

    let depth = 1;
    let end = match.index + match[0].length;
    while (depth && end < source.length) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
      end++;
    }
    const body = source.slice(match.index + match[0].length, end - 1);
    const guarded = lines
      .slice(Math.max(0, line - 9), line - 1)
      .some((before) => before.includes(`readFailed(${match![1]})`));

    if (/not found/i.test(body) && !body.includes('whyNoRow(') && !guarded) {
      found.push(line);
    }
  }
  return found;
}

describe('KB-138: a failed read is not worded as "not found", thrown or returned', () => {
  it('finds none in the repo', () => {
    const found = ROOTS.flatMap((root) =>
      sourceFiles(join(REPO, root)).flatMap((file) =>
        findFailedReadsWordedNotFound(readFileSync(file, 'utf8')).map(
          (line) => `${relative(REPO, file)}:${line}`,
        ),
      ),
    );

    expect(
      found,
      "word the message with whyNoRow(error, '… not found'), or throw first when readFailed(error), from @kit/shared/rows",
    ).toEqual([]);
  });

  it('finds a thrown Error and a returned value', () => {
    expect(
      findFailedReadsWordedNotFound(
        `if (fetchError || !episode) {\n  throw new Error('Episode not found');\n}`,
      ),
    ).toEqual([1]);
    expect(
      findFailedReadsWordedNotFound(
        `x;\nif (error || !connection) {\n  return { valid: false, error: 'Platform connection not found' };\n}`,
      ),
    ).toEqual([2]);
  });

  it('passes whyNoRow, a readFailed guard, and blocks that are not about a row', () => {
    expect(
      findFailedReadsWordedNotFound(
        `if (fetchError || !episode) {\n  throw new Error(whyNoRow(fetchError, 'Episode not found'));\n}`,
      ),
    ).toEqual([]);
    expect(
      findFailedReadsWordedNotFound(
        `if (readFailed(error)) {\n  throw new Error(whyNoRow(error, 'X not found'));\n}\n\nif (error || !row) {\n  return { error: 'X not found' };\n}`,
      ),
    ).toEqual([]);
    expect(
      findFailedReadsWordedNotFound(
        `if (authError || !user) {\n  throw new Error('Authentication required');\n}\nif (!target) {\n  throw new ActionRefusal('Project not found');\n}`,
      ),
    ).toEqual([]);
  });
});
