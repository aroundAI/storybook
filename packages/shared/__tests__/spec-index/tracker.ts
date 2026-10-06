import { load } from 'js-yaml';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * `specs/INDEX.md`'s rows checked against the spec files, and the totals
 * derived from them. `pnpm specs:index` checks the rows and prints the
 * totals; INDEX.md stores no count (the merge queue, 2026-10-01): a stored
 * count changed with every status flip, so every merge conflicted with every
 * open PR that touched one, and each resolution cost a CI run.
 *
 * The rule, which is also INDEX's note above its legend: every row in a
 * `### …` table under `## By Phase` is one spec, counted by its
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
 * exactly one row; and INDEX.md stores no count — no `(N specs)` heading, no
 * Progress Tracker or By scope table. `--write` removes any such count and
 * nothing else. It never edits a status cell: which status is right is a
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
const COUNTED_HEADING = /^### (.+) \(\d+ (?:specs?|docs?)\)\s*$/;
const COUNT_TABLE = /^\| (Phase|Scope) \| Total \|/;

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
const DUAL_AI = 'Dual AI (Ph 19)';
const STUDIO = 'StorybookStudio (Ph 20)';
const VOICEOVER = 'Master-video Voiceover (Ph 22)';
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
    {
      heading: 'Phase 19: Dual AI (Gemini in the app, Claude over MCP)',
      label: '19. Dual AI',
      scope: DUAL_AI,
    },
    {
      heading: 'Phase 20: StorybookStudio (the desktop AI editor)',
      label: '20. StorybookStudio',
      scope: STUDIO,
    },
    {
      heading: 'Phase 22: Master-video voiceover',
      label: '22. Master-video Voiceover',
      scope: VOICEOVER,
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
    DUAL_AI,
    STUDIO,
    VOICEOVER,
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
      // A stored `(N specs)` is reported by checkIndex; the name is the same.
      const name = (COUNTED_HEADING.exec(line)?.[1] ?? line.slice(4)).trim();
      current = { name, line: i, rows: [] };
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

export interface Totals {
  /** Per `###` section, in LAYOUT order, by its tracker label. */
  phases: { label: string; counts: Counts }[];
  total: Counts;
  /** Per By scope label, in LAYOUT order. */
  scopes: { label: string; counts: Counts }[];
}

export interface Analysis {
  /** Row and file disagreements, for a person to fix. */
  problems: string[];
  /** The counts, from the files' own `status:`. Printed, never stored. */
  totals: Totals;
}

export function analyse(
  markdown: string,
  sources: SpecSources,
  layout: Layout = LAYOUT,
): Analysis {
  const lines = markdown.split('\n');
  const sections = parseSections(lines);
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
        // Count it by its cell, so the totals stay right about the row count
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

  return {
    problems,
    totals: {
      phases: layout.sections.map((s) => ({
        label: s.label,
        counts: bySection.get(s.heading) ?? zero(),
      })),
      total: sum(() => true),
      scopes: layout.scopes.map((label) => ({
        label,
        counts: sum((s) => s.scope === label),
      })),
    },
  };
}

/** The totals as the two Markdown tables INDEX.md used to store. */
export function formatTotals(totals: Totals): string {
  return [
    TRACKER_HEADER,
    '|-------|-------|-------|---------|----------|---------|------|',
    ...totals.phases.map((p) => trackerRow(p.label, p.counts)),
    trackerRow('TOTAL', totals.total, true),
    '',
    SCOPE_HEADER,
    '|-------|-------|------|---------|---------|------------------|',
    ...totals.scopes.map((s) => scopeRow(s.label, s.counts)),
  ].join('\n');
}

/** Each line of INDEX.md that stores a count (0-based), and whether it is a heading. */
function storedCounts(lines: string[]): { line: number; heading: boolean }[] {
  const found: { line: number; heading: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (COUNTED_HEADING.test(lines[i]!)) found.push({ line: i, heading: true });
    if (COUNT_TABLE.test(lines[i]!)) {
      for (let j = i; lines[j]?.startsWith('|'); j++) {
        found.push({ line: j, heading: false });
      }
    }
  }
  return found;
}

/** INDEX.md with no stored count: `(N specs)` dropped, count tables removed. */
export function withoutCounts(markdown: string): string {
  const lines = markdown.split('\n');
  const stored = new Set(storedCounts(lines).map((c) => c.line));
  return lines
    .flatMap((line, i) => {
      if (!stored.has(i)) return [line];
      const heading = COUNTED_HEADING.exec(line);
      return heading ? [`### ${heading[1]!.trim()}`] : [];
    })
    .join('\n');
}

/** Every disagreement between INDEX.md and the spec files; `[]` when none. */
export function checkIndex(
  markdown: string,
  sources: SpecSources,
  layout: Layout = LAYOUT,
): string[] {
  const { problems } = analyse(markdown, sources, layout);
  const lines = markdown.split('\n');
  const counts = storedCounts(lines)
    .filter((c) => c.heading || COUNT_TABLE.test(lines[c.line]!))
    .map(
      (c) =>
        `INDEX.md:${c.line + 1}: stores a count, which INDEX.md no longer keeps: ${lines[c.line]}`,
    );
  if (counts.length > 0) {
    counts.push(
      'Run `pnpm specs:index --write` to remove it; `pnpm specs:index` prints the totals.',
    );
  }
  return [...problems, ...counts];
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
