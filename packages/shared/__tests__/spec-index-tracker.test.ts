import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  INDEX_FILE,
  type Layout,
  type SpecFile,
  type SpecSources,
  analyse,
  checkIndex,
  keyword,
  parseSections,
  repoSources,
} from './spec-index/tracker';

/**
 * specs/INDEX.md's per-spec status cells, `(N specs)` headings, Progress
 * Tracker and By scope table agree with the spec files' own `status:`.
 * The rule and its history are in spec-index/tracker.ts. To fix a failure:
 * correct any status cell or link by hand, then `pnpm specs:index --write`.
 */

describe('specs/INDEX.md agrees with the spec files', () => {
  it('has no disagreement on the repo', () => {
    const markdown = readFileSync(INDEX_FILE, 'utf8');
    const sections = parseSections(markdown.split('\n'));
    // A parse that found nothing would pass for the wrong reason.
    expect(sections.length).toBeGreaterThanOrEqual(20);
    expect(sections.flatMap((s) => s.rows).length).toBeGreaterThan(200);

    // One line per disagreement, with the expected line for counts.
    expect(checkIndex(markdown, repoSources())).toEqual([]);
  });

  it('has counts that --write would leave as they are', () => {
    const markdown = readFileSync(INDEX_FILE, 'utf8');
    expect(analyse(markdown, repoSources()).rendered).toBe(markdown);
  });
});

describe('positive control: a planted index', () => {
  const layout: Layout = {
    sections: [
      { heading: 'Phase 1: Alpha', label: '1. Alpha', scope: 'Core' },
      {
        heading: 'Cross-Cutting Concerns',
        label: 'Cross-Cutting',
        scope: 'Core',
      },
      { heading: 'Docs', label: 'Docs', scope: 'Other' },
    ],
    scopes: ['Core', 'Other'],
  };

  const HEADER = [
    '| Task ID | Name | Status | Effort | Dependencies |',
    '|---------|------|--------|--------|--------------|',
  ];

  const index = [
    '# Index',
    '',
    '## By Phase',
    '',
    '### Phase 1: Alpha (3 specs)',
    '',
    ...HEADER,
    '| FILM-1 | [one](./p1/FILM-1.yaml) | ✅ DONE | S | - |',
    '| FILM-2 | [two](./p1/FILM-2.yaml) | 🟡 PARTIAL | S | - |',
    '| FILM-3 | [three](./p1/FILM-3.yaml) | 🗑️ RETIRED (abc12345) | S | - |',
    '',
    '### Cross-Cutting Concerns (2 specs)',
    '',
    ...HEADER,
    '| FILM-CC-01 | [upload](./cc/FILM-CC-01.yaml) | DRAFT | M | - |',
    '| FILM-CC-04 | [known-bugs](./cross-cutting/FILM-CC-04-known-bugs.md) | OPEN | M | - |',
    '',
    '### Docs (1 doc)',
    '',
    ...HEADER,
    '| DOC-1 | [doc](./DOC-1.md) | ⏸️ DEFERRED | — | — |',
    '',
    '---',
    '',
    '## Progress Tracker',
    '',
    '| Phase | Total | Draft | Partial | Deferred | Retired | Done |',
    '|-------|-------|-------|---------|----------|---------|------|',
    '| 1. Alpha | 3 | 0 | 1 | 0 | 1 | 1 |',
    '| Cross-Cutting | 1 | 1 | 0 | 0 | 0 | 0 |',
    '| Docs | 1 | 0 | 0 | 1 | 0 | 0 |',
    '| **TOTAL** | **5** | **1** | **1** | **1** | **1** | **1** |',
    '',
    '### By scope',
    '',
    '| Scope | Total | Done | Partial | Retired | Draft / Deferred |',
    '|-------|-------|------|---------|---------|------------------|',
    '| Core | 4 | 1 | 1 | 1 | 1 |',
    '| Other | 1 | 0 | 0 | 0 | 1 |',
    '',
    '---',
    '',
  ].join('\n');

  const baseFiles: Record<string, SpecFile> = {
    'p1/FILM-1.yaml': { status: 'DONE', specId: 'FILM-1' },
    'p1/FILM-2.yaml': { status: 'PARTIAL', specId: 'FILM-2' },
    'p1/FILM-3.yaml': { status: 'RETIRED', specId: 'FILM-3' },
    'cc/FILM-CC-01.yaml': { status: 'DRAFT', specId: 'FILM-CC-01' },
    'cross-cutting/FILM-CC-04-known-bugs.md': {
      status: 'OPEN',
      specId: 'FILM-CC-04',
    },
    'known-bugs/README.md': {},
    // A Markdown document keeps its emoji in frontmatter.
    'DOC-1.md': { status: '⏸️ DEFERRED', specId: 'DOC-1' },
  };

  const sources = (
    files: Record<string, SpecFile> = baseFiles,
  ): SpecSources => ({
    read: (link) => files[link] ?? null,
    yamlLinks: Object.keys(files).filter((l) => /\.ya?ml$/.test(l)),
  });

  const edit = (from: string, to: string, text = index) => {
    expect(text).toContain(from);
    return text.replace(from, to);
  };

  const check = (text: string, files?: Record<string, SpecFile>) =>
    checkIndex(text, sources(files), layout);

  it('passes a correct index, counting Markdown rows and not the register', () => {
    expect(check(index)).toEqual([]);
    expect(analyse(index, sources(), layout).rendered).toBe(index);
  });

  it('reads the first status word of a cell', () => {
    expect(keyword('🗑️ RETIRED (removed; FILM-CC-04 KB-9)')).toBe('RETIRED');
    expect(keyword('✅ DONE (Change log; was PARTIAL)')).toBe('DONE');
    expect(keyword('In Progress')).toBeUndefined();
  });

  it('flags a status cell that disagrees with its file', () => {
    const problems = check(index, {
      ...baseFiles,
      'p1/FILM-2.yaml': { status: 'DONE', specId: 'FILM-2' },
    });
    expect(problems[0]).toBe(
      'INDEX.md:10 FILM-2: INDEX says "🟡 PARTIAL", p1/FILM-2.yaml says DONE',
    );
  });

  it('flags a Markdown row whose frontmatter disagrees', () => {
    const problems = check(index, {
      ...baseFiles,
      'DOC-1.md': { status: '🟡 PARTIAL', specId: 'DOC-1' },
    });
    expect(problems[0]).toContain('DOC-1: INDEX says "⏸️ DEFERRED"');
  });

  it('flags a dead link and the spec file left without a row (#307 to #335)', () => {
    const text = edit('(./p1/FILM-1.yaml)', '(./p1/FILM-1.md)');
    expect(check(text)).toEqual([
      'INDEX.md:9 FILM-1: links p1/FILM-1.md, which does not exist',
      "specs/p1/FILM-1.yaml has no row under INDEX.md's By Phase",
    ]);
  });

  it('flags a row listed twice', () => {
    const text = edit(
      '| FILM-2 | [two](./p1/FILM-2.yaml)',
      '| FILM-1 | [two](./p1/FILM-1.yaml)',
    );
    expect(check(text)).toContain(
      'INDEX.md:10 FILM-1: links p1/FILM-1.yaml, already listed as FILM-1',
    );
  });

  it('flags a Task ID that is not the file spec_id', () => {
    const text = edit('| FILM-3 |', '| FILM-33 |');
    expect(check(text)).toContain(
      'INDEX.md:11 FILM-33: p1/FILM-3.yaml has spec_id FILM-3',
    );
  });

  it('flags a status with no tracker column', () => {
    const problems = check(index, {
      ...baseFiles,
      'p1/FILM-2.yaml': { status: 'In Progress', specId: 'FILM-2' },
    });
    expect(problems[0]).toContain(
      'p1/FILM-2.yaml has status "In Progress", which has no tracker column',
    );
  });

  it('keeps OPEN for the register alone', () => {
    const text = edit('| DRAFT | M |', '| OPEN | M |');
    expect(check(text).join('\n')).toContain("OPEN is FILM-CC-04's alone");
  });

  it('accepts the register at known-bugs/README.md, and nowhere else', () => {
    const moved = edit(
      './cross-cutting/FILM-CC-04-known-bugs.md',
      './known-bugs/README.md',
    );
    expect(check(moved)).toEqual([]);

    const elsewhere = edit(
      './cross-cutting/FILM-CC-04-known-bugs.md',
      './p1/FILM-1.yaml',
    );
    expect(check(elsewhere).join('\n')).toContain(
      'the register row links cross-cutting/FILM-CC-04-known-bugs.md or known-bugs/README.md',
    );
  });

  it('flags a heading count, and --write fixes it', () => {
    const text = edit('Alpha (3 specs)', 'Alpha (4 specs)');
    expect(check(text)).toEqual([
      'INDEX.md:5: "Phase 1: Alpha" says 4 specs, and has 3 rows',
      'Run `pnpm specs:index --write` to rewrite the counts.',
    ]);
    expect(analyse(text, sources(), layout).rendered).toBe(index);
  });

  it.each([
    [
      'a phase row',
      '| 1. Alpha | 3 | 0 | 1 | 0 | 1 | 1 |',
      '| 1. Alpha | 3 | 0 | 2 | 0 | 0 | 1 |',
    ],
    [
      'the TOTAL row',
      '| **TOTAL** | **5** | **1** | **1** | **1** | **1** | **1** |',
      '| **TOTAL** | **6** | **1** | **2** | **1** | **1** | **1** |',
    ],
    [
      'a scope row',
      '| Other | 1 | 0 | 0 | 0 | 1 |',
      '| Other | 1 | 1 | 0 | 0 | 0 |',
    ],
  ])(
    'flags %s with the expected line, and --write fixes it',
    (_, good, bad) => {
      const text = edit(good, bad);
      const problems = check(text);
      expect(problems).toHaveLength(2);
      expect(problems[0]).toContain(`have     ${bad}`);
      expect(problems[0]).toContain(`expected ${good}`);
      expect(analyse(text, sources(), layout).rendered).toBe(index);
    },
  );

  it('recounts after a status change, the edit every PR makes', () => {
    const files = {
      ...baseFiles,
      'p1/FILM-2.yaml': { status: 'DONE', specId: 'FILM-2' },
    };
    const text = edit('| 🟡 PARTIAL | S |', '| ✅ DONE | S |');
    const { rendered } = analyse(text, sources(files), layout);

    expect(rendered).toContain('| 1. Alpha | 3 | 0 | 0 | 0 | 1 | 2 |');
    expect(rendered).toContain(
      '| **TOTAL** | **5** | **1** | **0** | **1** | **1** | **2** |',
    );
    expect(rendered).toContain('| Core | 4 | 2 | 0 | 1 | 1 |');
    expect(checkIndex(rendered, sources(files), layout)).toEqual([]);
  });

  it('flags a section that LAYOUT does not know', () => {
    const text = edit('### Docs (1 doc)', '### Phase 19: New (1 doc)');
    const problems = check(text).join('\n');
    expect(problems).toContain('section "Phase 19: New" is not in LAYOUT');
    expect(problems).toContain(
      'LAYOUT names section "Docs", which INDEX.md does not have',
    );
  });

  it('refuses to parse an index without its anchors', () => {
    expect(() => check(edit('## By Phase', '## Phases'))).toThrow(
      'no "## By Phase" heading',
    );
    expect(() =>
      check(
        edit('| Phase | Total | Draft |', '| Phase | Total | New | Draft |'),
      ),
    ).toThrow('update tracker.ts');
    expect(() => check(edit('Alpha (3 specs)', 'Alpha'))).toThrow(
      'needs a "(N specs)" count',
    );
  });
});
