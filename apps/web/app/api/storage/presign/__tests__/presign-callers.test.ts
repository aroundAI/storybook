import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-38: an upload URL is signed for one declared size, so every uploader
 * must declare the byte length of exactly the body it PUTs, and send the
 * headers the route returns. That is written once, in the shared
 * `@kit/storage/client` helper (the Edit Suite had a second; it went in
 * FILM-607). An uploader that calls the route itself can forget either,
 * and in production its uploads would fail.
 *
 * So: no other source file may send a request to the route.
 */

const ROOT = resolve(__dirname, '../../../../../../..');
/** The route as a string literal: something a request is sent to */
const ROUTE_LITERAL = /['"`]\/api\/storage\/presign['"`]/;

const ALLOWED = [
  'packages/features/storage/src/client/presigned-upload.ts',
];

const SKIP = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '__tests__',
  'e2e',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];

    const path = join(dir, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);

    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

describe('callers of the presign route', () => {
  const files = ['apps', 'packages'].flatMap((top) =>
    sourceFiles(join(ROOT, top)),
  );

  const callers = files
    .filter((file) => ROUTE_LITERAL.test(readFileSync(file, 'utf8')))
    .map((file) => relative(ROOT, file))
    .sort();

  it('scans the source tree, so an empty result would mean clean and not unread', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(callers).toContain(
      'packages/features/storage/src/client/presigned-upload.ts',
    );
  });

  it('is only called by the two upload helpers', () => {
    expect(callers).toEqual([...ALLOWED].sort());
  });
});
