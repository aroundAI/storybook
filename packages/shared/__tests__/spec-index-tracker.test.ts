import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  INDEX_FILE,
  type Layout,
  type SpecFile,
  type SpecSources,
  analyse,
  checkIndex,
  formatTotals,
  keyword,
  parseSections,
  repoSources,
  withoutCounts,
} from './spec-index/tracker';

/**
 * specs/INDEX.md's per-spec status cells agree with the spec files' own
 * `status:`, and INDEX.md stores no count: `pnpm specs:index` prints the
 * totals. The rule and its history are in spec-index/tracker.ts. To fix a
 * failure: correct any status cell or link by hand; a stored count is
 * removed by `pnpm specs:index --write`.
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

  // The merge queue (2026-10-01): counts in INDEX.md made every merge
  // conflict with every open PR that touched a status. They are printed by
  // `pnpm specs:index`, never stored.
  it('INDEX.md has no count tables', () => {
    const markdown = readFileSync(INDEX_FILE, 'utf8');
    const lines = markdown.split('\n');
    expect(
      lines.filter((l) => /^\| (Phase|Scope) \| Total \|/.test(l)),
    ).toEqual([]);
    expect(
      lines.filter((l) => /^### .+ \(\d+ (specs?|docs?)\)\s*$/.test(l)),
    ).toEqual([]);
  });

  it('is left as it is by --write', () => {
    const markdown = readFileSync(INDEX_FILE, 'utf8');
    expect(withoutCounts(markdown)).toBe(markdown);
  });

  it('totals every row but the register', () => {
    const markdown = readFileSync(INDEX_FILE, 'utf8');
    const rows = parseSections(markdown.split('\n')).flatMap((s) => s.rows);
    const { total } = analyse(markdown, repoSources()).totals;
    const sum = Object.values(total).reduce((a, b) => a + b, 0);
    expect(sum).toBe(rows.length - 1);
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
    '### Phase 1: Alpha',
    '',
    ...HEADER,
    '| FILM-1 | [one](./p1/FILM-1.yaml) | ✅ DONE | S | - |',
    '| FILM-2 | [two](./p1/FILM-2.yaml) | 🟡 PARTIAL | S | - |',
    '| FILM-3 | [three](./p1/FILM-3.yaml) | 🗑️ RETIRED (abc12345) | S | - |',
    '',
    '### Cross-Cutting Concerns',
    '',
    ...HEADER,
    '| FILM-CC-01 | [upload](./cc/FILM-CC-01.yaml) | DRAFT | M | - |',
    '| FILM-CC-04 | [known-bugs](./cross-cutting/FILM-CC-04-known-bugs.md) | OPEN | M | - |',
    '',
    '### Docs',
    '',
    ...HEADER,
    '| DOC-1 | [doc](./DOC-1.md) | ⏸️ DEFERRED | — | — |',
    '',
    '---',
    '',
    '## Progress Tracker',
    '',
    'Run `pnpm specs:index` for the counts.',
    '',
    '---',
    '',
  ].join('\n');

  // The tables INDEX.md used to store, as `pnpm specs:index` now prints them.
  const TOTALS = [
    '| Phase | Total | Draft | Partial | Deferred | Retired | Done |',
    '|-------|-------|-------|---------|----------|---------|------|',
    '| 1. Alpha | 3 | 0 | 1 | 0 | 1 | 1 |',
    '| Cross-Cutting | 1 | 1 | 0 | 0 | 0 | 0 |',
    '| Docs | 1 | 0 | 0 | 1 | 0 | 0 |',
    '| **TOTAL** | **5** | **1** | **1** | **1** | **1** | **1** |',
    '',
    '| Scope | Total | Done | Partial | Retired | Draft / Deferred |',
    '|-------|-------|------|---------|---------|------------------|',
    '| Core | 4 | 1 | 1 | 1 | 1 |',
    '| Other | 1 | 0 | 0 | 0 | 1 |',
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
    expect(formatTotals(analyse(index, sources(), layout).totals)).toBe(TOTALS);
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

  it('flags a stored heading count, and --write removes it', () => {
    const text = edit('### Phase 1: Alpha', '### Phase 1: Alpha (3 specs)');
    expect(check(text)).toEqual([
      'INDEX.md:5: stores a count, which INDEX.md no longer keeps: ### Phase 1: Alpha (3 specs)',
      'Run `pnpm specs:index --write` to remove it; `pnpm specs:index` prints the totals.',
    ]);
    expect(withoutCounts(text)).toBe(index);
  });

  it('flags a stored count table, and --write removes it and nothing else', () => {
    const text = edit(
      'Run `pnpm specs:index` for the counts.\n',
      `Run \`pnpm specs:index\` for the counts.\n\n${TOTALS}\n`,
    );
    expect(check(text)).toEqual([
      'INDEX.md:32: stores a count, which INDEX.md no longer keeps: | Phase | Total | Draft | Partial | Deferred | Retired | Done |',
      'INDEX.md:39: stores a count, which INDEX.md no longer keeps: | Scope | Total | Done | Partial | Retired | Draft / Deferred |',
      'Run `pnpm specs:index --write` to remove it; `pnpm specs:index` prints the totals.',
    ]);
    // The blank lines around the tables stay; the rows of By Phase are untouched.
    expect(withoutCounts(text)).toBe(
      edit(
        'Run `pnpm specs:index` for the counts.\n',
        'Run `pnpm specs:index` for the counts.\n\n\n',
      ),
    );
  });

  it('recounts after a status change, the edit every PR makes', () => {
    const files = {
      ...baseFiles,
      'p1/FILM-2.yaml': { status: 'DONE', specId: 'FILM-2' },
    };
    const text = edit('| 🟡 PARTIAL | S |', '| ✅ DONE | S |');
    const printed = formatTotals(analyse(text, sources(files), layout).totals);

    expect(printed).toContain('| 1. Alpha | 3 | 0 | 0 | 0 | 1 | 2 |');
    expect(printed).toContain(
      '| **TOTAL** | **5** | **1** | **0** | **1** | **1** | **2** |',
    );
    expect(printed).toContain('| Core | 4 | 2 | 0 | 1 | 1 |');
    // Only the row changed: nothing else in INDEX.md has to.
    expect(checkIndex(text, sources(files), layout)).toEqual([]);
  });

  it('flags a section that LAYOUT does not know', () => {
    const text = edit('### Docs', '### Phase 19: New');
    const problems = check(text).join('\n');
    expect(problems).toContain('section "Phase 19: New" is not in LAYOUT');
    expect(problems).toContain(
      'LAYOUT names section "Docs", which INDEX.md does not have',
    );
  });

  it('refuses to parse an index without its anchor', () => {
    expect(() => check(edit('## By Phase', '## Phases'))).toThrow(
      'no "## By Phase" heading',
    );
  });
});
