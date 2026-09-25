import { describe, expect, it } from 'vitest';

import {
  type KnownBug,
  readRegisterFiles,
  registerProblems,
  renderKnownBug,
} from './known-bugs/register';

/**
 * The known-bugs register, one file per KB (`specs/known-bugs/`, rules in its
 * README). A tool reads each file's front matter; a person reads the entry
 * under it. These rules keep the two telling the same story, and keep ids
 * usable as keys: `closed_by: "KB-14"` (KB-80) must name exactly one file.
 */

describe('known-bugs register', () => {
  it('every file is a valid entry, with a unique id matching its name', () => {
    const files = readRegisterFiles();
    // A scan that found nothing would pass for the wrong reason.
    expect(files.length).toBeGreaterThan(90);

    // One line per problem: file: what is wrong.
    expect(registerProblems(files)).toEqual([]);
  });

  describe('positive control: planted files', () => {
    const base: Omit<KnownBug, 'file'> = {
      id: 'KB-5',
      title: 'Planted',
      status: 'open',
      fixedIn: [],
      fixedSummary: '',
      severity: 'Low',
      found: '2026-09-25',
      body: '## KB-5 — Planted\n\n**Severity:** Low — planted.',
    };
    const plant = (over: Partial<KnownBug> = {}, file = 'KB-5.md') => ({
      file: `specs/known-bugs/${file}`,
      text: renderKnownBug({ ...base, ...over }),
    });
    const fixedBody = (banner: string) =>
      `## KB-5 — Planted\n\n${banner}\n\n**Severity:** Low — planted.\n\n### Details\n\n**Fixed** as a sub-note only.`;

    it('accepts well-formed open, partial and fixed entries', () => {
      expect(
        registerProblems([
          plant(),
          plant(
            {
              id: 'KB-6',
              status: 'partial',
              fixedIn: ['#264 (round 4)', '#296'],
              fixedSummary: 'Half',
              body: '## KB-6 — Planted\n\n> **Fixed (2026-09-22)** in part, #7.\n\n**Severity:** Low',
            },
            'KB-6.md',
          ),
          plant(
            {
              id: 'KB-7',
              status: 'fixed',
              fixedIn: ['FILM-1615 Step 0'],
              fixedSummary: 'Done',
              severity: 'unrated',
              body: '## KB-7 — Planted\n\n> **Fixed (2026-09-21), #1.** Done.',
            },
            'KB-7.md',
          ),
        ]),
      ).toEqual([]);
    });

    it.each<[string, { text: string; file: string }[], string]>([
      [
        'id not matching the file',
        [plant({}, 'KB-6.md')],
        'does not match the file name',
      ],
      [
        'a duplicate id',
        [plant(), { ...plant(), file: 'specs/known-bugs/nested/KB-5.md' }],
        'KB-5 is also used by',
      ],
      [
        'a bad status',
        [plant({ status: 'done' as KnownBug['status'] })],
        '`status` must be one of',
      ],
      [
        'a bad severity',
        [plant({ severity: 'Critical' as KnownBug['severity'] })],
        '`severity` must be one of',
      ],
      [
        'a bad found date',
        [plant({ found: '23 Sept' })],
        '`found` must be a date',
      ],
      [
        'fixed without fixed_in',
        [
          plant({
            status: 'fixed',
            body: fixedBody('> **Fixed (2026-09-21).**'),
          }),
        ],
        'fixed needs `fixed_in`',
      ],
      [
        'partial without fixed_in',
        [plant({ status: 'partial' })],
        'partial needs `fixed_in`',
      ],
      [
        'open with fixed_in',
        [plant({ fixedIn: ['#1'], fixedSummary: 'x' })],
        'open, but `fixed_in` names #1',
      ],
      [
        'fixed_in without a summary',
        [plant({ status: 'partial', fixedIn: ['#1'] })],
        'needs a one-line `fixed_summary`',
      ],
      [
        'a fixed_in that is not a PR',
        [plant({ status: 'partial', fixedIn: ['soon'], fixedSummary: 'x' })],
        'must start with #<PR>',
      ],
      [
        'a Fixed banner on an open entry',
        [plant({ body: fixedBody('> **Fixed (2026-09-21), #1.** Done.') })],
        'banner says Fixed, but `status` is open',
      ],
      [
        'a Fixed banner on a partial entry',
        [
          plant({
            status: 'partial',
            fixedIn: ['#1'],
            fixedSummary: 'x',
            body: fixedBody('**Fixed** in #1.'),
          }),
        ],
        'banner says Fixed, but `status` is partial',
      ],
      [
        'a title that disagrees with the heading',
        [plant({ title: 'Renamed' })],
        'the entry must start with',
      ],
      [
        'a severity that disagrees with the entry',
        [plant({ severity: 'High' })],
        '`severity` is High, the entry',
      ],
      [
        'an unknown key',
        [
          {
            file: 'specs/known-bugs/KB-5.md',
            text: renderKnownBug(base).replace(
              'found:',
              'fixed-in: []\nfound:',
            ),
          },
        ],
        'unknown key `fixed-in`',
      ],
      [
        'no front matter',
        [{ file: 'specs/known-bugs/KB-5.md', text: base.body }],
        'front matter',
      ],
    ])('rejects %s', (_label, files, message) => {
      const problems = registerProblems(files);
      expect(problems.join('\n')).toContain(message);
    });
  });
});
