import { describe, expect, it } from 'vitest';

import {
  checkAll,
  describeCitation,
  mapLine,
  parseHunks,
} from './spec-citations/citations';

/**
 * KB-81. A spec's `path:line` citation names a line of code; when the code
 * moves, the citation silently points at something else. After #309 about
 * fifteen FILM-502/503 citations had shifted; measured over every spec, 187
 * had moved and 16 cited lines had changed.
 *
 * This fails on any citation whose line has moved, changed, disappeared or
 * run past the end of its file since the spec line was written. How to clear
 * each (see `spec-citations/citations.ts` for how they are found):
 *
 *   moved    → `pnpm specs:citations --fix` rewrites it exactly
 *   changed  → re-read the code and correct the citation by hand
 *   gone / past end of file → find what it meant, or drop it
 */

describe('mapLine', () => {
  const hunks = parseHunks(
    [
      '@@ -3,0 +4,2 @@', // two lines inserted after old line 3
      '@@ -10 +12 @@', // old line 10 rewritten
      '@@ -20,3 +21,0 @@', // old lines 20-22 deleted
    ].join('\n'),
  );

  it.each([
    [1, 1],
    [3, 3],
    [4, 6],
    [9, 11],
    [11, 13],
    [19, 21],
    [23, 22],
  ])('old line %i is now line %i', (from, to) => {
    expect(mapLine(hunks, from)).toBe(to);
  });

  it.each([10, 20, 21, 22])('old line %i was rewritten or removed', (line) => {
    expect(mapLine(hunks, line)).toBeNull();
  });
});

describe('spec citations point at the code they name (KB-81)', () => {
  it('no citation has moved, changed, gone or run past its file', () => {
    const citations = checkAll();
    expect(citations.length, 'citations found').toBeGreaterThan(500);

    const drifted = citations
      .filter((c) => c.verdict.kind !== 'ok')
      .map(describeCitation);

    expect(
      drifted,
      'run `pnpm specs:citations --fix`, then re-read any left',
    ).toEqual([]);
  }, 120_000);
});
