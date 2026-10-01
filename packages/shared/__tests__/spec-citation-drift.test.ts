import { describe, expect, it } from 'vitest';

import {
  type Citation,
  type Verdict,
  checkAll,
  describeCitation,
  mapLine,
  parseHunks,
  triage,
} from './spec-citations/citations';

/**
 * KB-81. A spec's `path:line` citation names a line of code; when the code
 * moves, the citation silently points at something else. After #309 about
 * fifteen FILM-502/503 citations had shifted; measured over every spec, 187
 * had moved and 16 cited lines had changed.
 *
 * This fails on any citation whose line has changed, disappeared or run past
 * the end of its file since the spec line was written; one that only moved
 * is printed as a warning (the merge queue, 2026-10-01). How to clear each
 * (see `spec-citations/citations.ts` for how they are found):
 *
 *   moved    → `pnpm specs:citations --fix` rewrites it exactly (a warning)
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

describe('a moved citation warns, a gone citation fails (merge queue)', () => {
  // A moved citation still names the right code, one --fix away; failing on
  // it made every merge that shifted a line fail every other open PR's
  // records, and each re-point was a push and a CI run.
  const cite = (verdict: Verdict): Citation => ({
    specFile: 'specs/x.yaml',
    specId: 'FILM-X',
    specLine: 1,
    path: 'packages/x.ts',
    from: 10,
    column: 0,
    raw: 'packages/x.ts:10',
    verdict,
  });
  const ok = cite({ kind: 'ok' });
  const moved = cite({ kind: 'moved', from: 10, to: 12 });
  const changed = cite({ kind: 'changed', since: 'abc12345' });
  const gone = cite({ kind: 'gone' });
  const pastEof = cite({ kind: 'past-eof', lines: 5 });

  it('reports a moved citation as a warning, not a failure', () => {
    const { warnings, failures } = triage([ok, moved]);
    expect(warnings).toEqual([moved]);
    expect(failures).toEqual([]);
  });

  it('fails a citation whose text is gone, changed or past its file', () => {
    const { warnings, failures } = triage([ok, changed, gone, pastEof]);
    expect(warnings).toEqual([]);
    expect(failures).toEqual([changed, gone, pastEof]);
  });
});

describe('spec citations point at the code they name (KB-81)', () => {
  it('no cited text has changed, gone or run past its file', () => {
    const citations = checkAll();
    expect(citations.length, 'citations found').toBeGreaterThan(500);

    const { warnings, failures } = triage(citations);
    if (warnings.length > 0) {
      console.warn(
        `${warnings.length} citation(s) moved; \`pnpm specs:citations --fix\` re-points them:\n` +
          warnings.map(describeCitation).join('\n'),
      );
    }

    expect(
      failures.map(describeCitation),
      'find what each meant in the code now, and correct it by hand',
    ).toEqual([]);
  }, 120_000);
});
