import { load } from 'js-yaml';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * `specs/INDEX.md`'s counts, derived from the spec files instead of kept by
 * hand. `pnpm specs:index` checks them; `--write` rewrites them.
 *
 * The rule, which is also INDEX's note above its legend: every row in a
 * `### … (N specs)` table under `## By Phase` is one spec, counted by its
 * linked file's own frontmatter `status:` — YAML task specs and the Markdown
 * documents (PHASE-14, the two Public Sharing docs) alike. FILM-CC-04, the
 * known-bugs register, is the one OPEN row and is not counted.
 *
 * Two PRs reported the tracker "one off" (#337, #343) when it was right: they
 * recounted `status:` in `*.yaml` only, which misses the Markdown rows. And a
 * real drift went unseen for three merges: from #307 to #335 the five SPIKE
 * rows linked Markdown files that #307 had converted to YAML.
 *
 * Checked: each row's link exists; its status cell names the same status as
 * the file; its Task ID is the file's `spec_id`; every `specs/**∕*.yaml` has
 * exactly one row; each heading's N is its row count; the Progress Tracker's
 * phase rows, TOTAL and By scope rows are the sums. `--write` rewrites only
 * those numbers. It never edits a status cell: which status is right is a
 * judgement about the code, not arithmetic.
 */

export const REPO = resolve(__dirname, '../../../..');
export const SPECS_DIR = join(REPO, 'specs');
export const INDEX_FILE = join(SPECS_DIR, 'INDEX.md');

export const STATUSES = [
  'DRAFT',
  'PARTIAL',
  'DEFERRED',
  'RETIRED',
  'DONE',
] as const;
export type Status = (typeof STATUSES)[number];
type Counts = Record<Status, number>;

/** The known-bugs register: a living list, not a spec. */
export const REGISTER = {
  id: 'FILM-CC-04',
  status: 'OPEN',
  links: ['cross-cutting/FILM-CC-04-known-bugs.md', 'known-bugs/README.md'],
};

const TRACKER_HEADER =
  '| Phase | Total | Draft | Partial | Deferred | Retired | Done |';
const SCOPE_HEADER =
  '| Scope | Total | Done | Partial | Retired | Draft / Deferred |';
const HEADING = /^### (.+) \((\d+) (specs?|docs?)\)\s*$/;

export interface Layout {
  /** Every `###` section under By Phase, in tracker order. */
  sections: { heading: string; label: string; scope: string }[];
  /** The By scope rows, in order. */
  scopes: string[];
}

const MVP = 'MVP (Ph 1–5, Cross-Cutting, Design System, Spikes)';
const POST_MVP = 'Post-MVP (Ph 6–9)';
const CANON = 'Canon (Ph 10–11)';
const SCALE = 'Scale & Hooks (Ph 12–13)';
const EDIT_V2 = 'Edit Suite v2 (Ph 14)';
const DEEP = 'Deep Analytics (Ph 15)';
const WORKBOOK = 'Workbook Parity (Ph 16)';
const PROVENANCE = 'Provenance & Signal (Ph 17)';
const SANDBOX = 'Vendor Sandbox (Ph 18)';
const SHARING = 'Public Sharing';

/**
 * A new `###` section fails the check until it is added here: its tracker
 * label and which scope it counts toward are decisions, not arithmetic.
 */
export const LAYOUT: Layout = {
  sections: [
    { heading: 'Phase 1: Foundation', label: '1. Foundation', scope: MVP },
    { heading: 'Cross-Cutting Concerns', label: 'Cross-Cutting', scope: MVP },
    { heading: 'Design System', label: 'Design System', scope: MVP },
    { heading: 'Phase 2: Assets', label: '2. Assets', scope: MVP },
    { heading: 'Phase 3: Episodes & Story', label: '3. Episodes', scope: MVP },
    { heading: 'Phase 4: Video Generation', label: '4. Video Gen', scope: MVP },
    { heading: 'Phase 5: Audio Generation', label: '5. Audio Gen', scope: MVP },
    { heading: 'Phase 6: Edit Suite', label: '6. Edit Suite', scope: POST_MVP },
    { heading: 'Phase 7: Publishing', label: '7. Publishing', scope: POST_MVP },
    { heading: 'Phase 8: Analytics', label: '8. Analytics', scope: POST_MVP },
    {
      heading: 'Phase 9: Integration',
      label: '9. Integration',
      scope: POST_MVP,
    },
    {
      heading: 'Phase 10: Canon Management',
      label: '10. Canon Mgmt',
      scope: CANON,
    },
    {
      heading: 'Phase 11: Canon Integration & Content Types',
      label: '11. Canon Integ',
      scope: CANON,
    },
    {
      heading: 'Phase 12: Scale & Network Strategy',
      label: '12. Scale',
      scope: SCALE,
    },
    {
      heading: 'Phase 13: Hook Optimization',
      label: '13. Hook Opt',
      scope: SCALE,
    },
    {
      heading: 'Phase 14: Edit Suite v2',
      label: '14. Edit Suite v2',
      scope: EDIT_V2,
    },
    {
      heading: 'Phase 15: Deep Analytics Discipline',
      label: '15. Deep Analytics',
      scope: DEEP,
    },
    {
      heading: 'Phase 16: Workbook Parity',
      label: '16. Workbook Parity',
      scope: WORKBOOK,
    },
    {
      heading: 'Phase 17: Analytics Provenance and Signal',
      label: '17. Analytics Provenance',
      scope: PROVENANCE,
    },
    {
      heading: 'Phase 18: Local Vendor Sandbox',
      label: '18. Vendor Sandbox',
      scope: SANDBOX,
    },
    { heading: 'Spikes', label: 'Spikes', scope: MVP },
    { heading: 'Public Sharing', label: 'Public Sharing', scope: SHARING },
  ],
  scopes: [
    MVP,
    POST_MVP,
    CANON,
    SCALE,
    EDIT_V2,
    DEEP,
    WORKBOOK,
    PROVENANCE,
    SANDBOX,
    SHARING,
  ],
};

export interface SpecFile {
  status?: string;
  specId?: string;
}

export interface SpecSources {
  /** A spec's frontmatter, `{}` for a directory or no frontmatter, `null` if the path does not exist. */
  read(link: string): SpecFile | null;
  /** Every task spec YAML, relative to `specs/`. */
  yamlLinks: string[];
}

export interface IndexRow {
  id: string;
  link: string;
  cell: string;
  line: number;
}

export interface IndexSection {
  name: string;
  claimed: number;
  noun: string;
  line: number;
  rows: IndexRow[];
}

function cellsOf(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/** The first status word in a cell or `status:` value (`🗑️ RETIRED (5b88db3a)` → RETIRED). */
export function keyword(text: string): Status | 'OPEN' | undefined {
  let found: { word: Status | 'OPEN'; at: number } | undefined;
  for (const word of [...STATUSES, 'OPEN' as const]) {
    const at = text.search(new RegExp(`\\b${word}\\b`));
    if (at !== -1 && (!found || at < found.at)) found = { word, at };
  }
  return found?.word;
}

export function parseSections(lines: string[]): IndexSection[] {
  const start = lines.findIndex((l) => l.trim() === '## By Phase');
  if (start === -1) throw new Error('INDEX.md: no "## By Phase" heading');

  const sections: IndexSection[] = [];
  let current: IndexSection | undefined;

  for (let i = start + 1; i < lines.length && !/^## /.test(lines[i]!); i++) {
    const line = lines[i]!;
    if (line.startsWith('### ')) {
      const m = HEADING.exec(line);
      if (!m) {
        throw new Error(
          `INDEX.md:${i + 1}: a By Phase heading needs a "(N specs)" count: ${line}`,
        );
      }
      current = {
        name: m[1]!,
        claimed: Number(m[2]),
        noun: m[3]!,
        line: i,
        rows: [],
      };
      sections.push(current);
      continue;
    }
    if (!line.startsWith('|') || !current) continue;

    const cells = cellsOf(line);
    if (cells[0] === 'Task ID' || /^:?-+:?$/.test(cells[0] ?? '')) continue;
    const link = /\]\(\.\/([^)\s]+)\)/.exec(cells[1] ?? '');
    if (!link) {
      throw new Error(
        `INDEX.md:${i + 1}: a spec row needs a ./link in its Name cell: ${line}`,
      );
    }
    current.rows.push({
      id: cells[0]!,
      link: link[1]!,
      cell: cells[2] ?? '',
      line: i,
    });
  }
  return sections;
}

function tableBody(lines: string[], header: string) {
  const at = lines.findIndex((l) => l.startsWith(header.slice(0, 16)));
  if (at === -1) throw new Error(`INDEX.md: no table headed "${header}"`);
  if (lines[at]!.trim() !== header) {
    throw new Error(
      `INDEX.md:${at + 1}: the table header is now "${lines[at]}"; update tracker.ts to match`,
    );
  }
  let end = at + 2;
  while (lines[end]?.startsWith('|')) end++;
  return { start: at + 2, end };
}

const zero = (): Counts => ({
  DRAFT: 0,
  PARTIAL: 0,
  DEFERRED: 0,
  RETIRED: 0,
  DONE: 0,
});
const total = (c: Counts) => STATUSES.reduce((sum, s) => sum + c[s], 0);

function trackerRow(label: string, c: Counts, bold = false) {
  const b = (v: string | number) => (bold ? `**${v}**` : `${v}`);
  const cells = [total(c), c.DRAFT, c.PARTIAL, c.DEFERRED, c.RETIRED, c.DONE];
  return `| ${b(label)} | ${cells.map(b).join(' | ')} |`;
}

function scopeRow(label: string, c: Counts) {
  const cells = [total(c), c.DONE, c.PARTIAL, c.RETIRED, c.DRAFT + c.DEFERRED];
  return `| ${label} | ${cells.join(' | ')} |`;
}

function plural(noun: string, n: number) {
  const stem = noun.replace(/s$/, '');
  return n === 1 ? stem : `${stem}s`;
}

export interface Analysis {
  /** Row and file disagreements `--write` cannot fix. */
  problems: string[];
  /** The index with every count recomputed. */
  rendered: string;
}

export function analyse(
  markdown: string,
  sources: SpecSources,
  layout: Layout = LAYOUT,
): Analysis {
  const lines = markdown.split('\n');
  const sections = parseSections(lines);
  const tracker = tableBody(lines, TRACKER_HEADER);
  const scope = tableBody(lines, SCOPE_HEADER);
  const problems: string[] = [];
  const listed = new Map<string, string>();
  const bySection = new Map<string, Counts>();

  for (const section of sections) {
    const counts = zero();
    for (const row of section.rows) {
      const where = `INDEX.md:${row.line + 1} ${row.id}`;
      const earlier = listed.get(row.link);
      if (earlier) {
        problems.push(
          `${where}: links ${row.link}, already listed as ${earlier}`,
        );
      }
      listed.set(row.link, row.id);

      const file = sources.read(row.link);
      const cellStatus = keyword(row.cell);
      if (!file) {
        problems.push(`${where}: links ${row.link}, which does not exist`);
        // Count it by its cell, so `--write` stays right about the row count
        // while the link is fixed by hand.
        if (cellStatus && cellStatus !== 'OPEN') counts[cellStatus]++;
        continue;
      }

      if (row.id === REGISTER.id) {
        if (cellStatus !== REGISTER.status) {
          problems.push(
            `${where}: the known-bugs register's status is ${REGISTER.status}, not "${row.cell}"`,
          );
        }
        if (!REGISTER.links.includes(row.link)) {
          problems.push(
            `${where}: links ${row.link}; the register row links ${REGISTER.links.join(' or ')}`,
          );
        }
        continue;
      }
      if (cellStatus === 'OPEN') {
        problems.push(
          `${where}: OPEN is ${REGISTER.id}'s alone (a register, not a spec); give this spec a status from ${STATUSES.join(', ')}`,
        );
      }

      const fileStatus = keyword(file.status ?? '');
      if (!fileStatus || fileStatus === 'OPEN') {
        problems.push(
          `${where}: ${row.link} has status "${file.status ?? ''}", which has no tracker column (${STATUSES.join(', ')})`,
        );
        continue;
      }
      if (cellStatus !== fileStatus) {
        problems.push(
          `${where}: INDEX says "${row.cell}", ${row.link} says ${file.status}`,
        );
      }
      if (file.specId !== undefined && file.specId !== row.id) {
        problems.push(`${where}: ${row.link} has spec_id ${file.specId}`);
      }
      counts[fileStatus]++;
    }
    bySection.set(section.name, counts);
  }

  for (const link of sources.yamlLinks) {
    if (!listed.has(link)) {
      problems.push(`specs/${link} has no row under INDEX.md's By Phase`);
    }
  }

  const known = new Set(layout.sections.map((s) => s.heading));
  const present = new Set(sections.map((s) => s.name));
  for (const s of sections) {
    if (!known.has(s.name)) {
      problems.push(
        `INDEX.md:${s.line + 1}: section "${s.name}" is not in LAYOUT (packages/shared/__tests__/spec-index/tracker.ts); give it a tracker label and a scope`,
      );
    }
  }
  for (const s of layout.sections) {
    if (!present.has(s.heading)) {
      problems.push(
        `LAYOUT names section "${s.heading}", which INDEX.md does not have`,
      );
    }
  }

  const sum = (pick: (s: Layout['sections'][number]) => boolean) => {
    const c = zero();
    for (const s of layout.sections.filter(pick)) {
      const counts = bySection.get(s.heading) ?? zero();
      for (const status of STATUSES) c[status] += counts[status];
    }
    return c;
  };

  const trackerLines = [
    ...layout.sections.map((s) =>
      trackerRow(s.label, bySection.get(s.heading) ?? zero()),
    ),
    trackerRow(
      'TOTAL',
      sum(() => true),
      true,
    ),
  ];
  const scopeLines = layout.scopes.map((label) =>
    scopeRow(
      label,
      sum((s) => s.scope === label),
    ),
  );

  const out = [...lines];
  for (const s of sections) {
    out[s.line] =
      `### ${s.name} (${s.rows.length} ${plural(s.noun, s.rows.length)})`;
  }
  // The scope table follows the tracker, so splice it first.
  out.splice(scope.start, scope.end - scope.start, ...scopeLines);
  out.splice(tracker.start, tracker.end - tracker.start, ...trackerLines);

  return { problems, rendered: out.join('\n') };
}

function countDiffs(
  lines: string[],
  body: { start: number; end: number },
  expected: string[],
  what: string,
): string[] {
  const have = lines.slice(body.start, body.end);
  if (have.length !== expected.length) {
    return [
      `INDEX.md:${body.start + 1}: the ${what} has ${have.length} rows, expected ${expected.length}:\n    ${expected.join('\n    ')}`,
    ];
  }
  return have.flatMap((line, i) =>
    line.trim() === expected[i]
      ? []
      : [
          `INDEX.md:${body.start + i + 1}: ${what} row\n    have     ${line}\n    expected ${expected[i]}`,
        ],
  );
}

/** Every disagreement between INDEX.md and the spec files; `[]` when none. */
export function checkIndex(
  markdown: string,
  sources: SpecSources,
  layout: Layout = LAYOUT,
): string[] {
  const { problems, rendered } = analyse(markdown, sources, layout);
  const lines = markdown.split('\n');
  const next = rendered.split('\n');

  const counts: string[] = [];
  for (const s of parseSections(lines)) {
    if (s.claimed !== s.rows.length) {
      counts.push(
        `INDEX.md:${s.line + 1}: "${s.name}" says ${s.claimed} ${s.noun}, and has ${s.rows.length} rows`,
      );
    }
  }
  counts.push(
    ...countDiffs(
      lines,
      tableBody(lines, TRACKER_HEADER),
      next.slice(...span(tableBody(next, TRACKER_HEADER))),
      'Progress Tracker',
    ),
    ...countDiffs(
      lines,
      tableBody(lines, SCOPE_HEADER),
      next.slice(...span(tableBody(next, SCOPE_HEADER))),
      'By scope',
    ),
  );
  if (counts.length > 0) {
    counts.push('Run `pnpm specs:index --write` to rewrite the counts.');
  }
  return [...problems, ...counts];
}

function span(body: { start: number; end: number }): [number, number] {
  return [body.start, body.end];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (v: unknown) =>
  v === undefined || v === null ? undefined : String(v);

function listYaml(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listYaml(path);
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  });
}

export function repoSources(specsDir: string = SPECS_DIR): SpecSources {
  return {
    yamlLinks: listYaml(specsDir)
      .map((path) => relative(specsDir, path))
      .sort(),
    read(link) {
      const path = join(specsDir, link);
      if (!existsSync(path)) return null;
      if (statSync(path).isDirectory()) return {};
      const content = readFileSync(path, 'utf8');
      if (/\.ya?ml$/.test(link)) {
        const data = load(content);
        if (!isRecord(data)) return {};
        return { status: text(data.status), specId: text(data.spec_id) };
      }
      // Markdown frontmatter is not held to YAML (FILM-CC-04's is not valid
      // YAML), so read only the two keys this needs.
      const front = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? '';
      const key = (name: string) =>
        new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'm').exec(front)?.[1];
      return { status: key('status'), specId: key('spec_id') };
    },
  };
}
