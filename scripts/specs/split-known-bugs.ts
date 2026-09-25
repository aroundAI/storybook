/**
 * Splits the old single-file known-bugs register
 * (`specs/cross-cutting/FILM-CC-04-known-bugs.md`) into `specs/known-bugs/`,
 * one file per KB, and ports a PR's pending edits to the old file into the
 * new layout.
 *
 *   pnpm exec tsx scripts/specs/split-known-bugs.ts [--from <rev>] [--out <dir>]
 *     Split the old file (the working tree's, or `git show <rev>:<path>`).
 *     Every check below must pass before anything is written; it fails loudly.
 *
 *   pnpm exec tsx scripts/specs/split-known-bugs.ts --port <old-pr-head> [--onto <rev>] [--out <dir>]
 *     Take what the PR changed in the old file (merge-base → old head) and
 *     apply it to the files in <out>: entries by 3-way merge, Fixed-table rows
 *     as front matter, leads by 3-way merge per leads file. `--onto` is the
 *     main the merge-base is taken against (default origin/main). Exits 2 on a
 *     conflict or on anything it can only list for a human.
 *
 * Checks in split mode (any failure aborts, writing nothing):
 *   - every entry's text, re-read from the rendered file, is byte-identical
 *     to its slice of the old file, and the slices plus their separators
 *     rebuild the old entries region exactly;
 *   - each file passes the register's own schema rules (registerProblems);
 *   - the fixed / partial / open sets equal what the old KB-80 guard derived
 *     from the old file: the Fixed table plus non-part "Fixed" banners;
 *   - every Fixed-table row and every leads line is written exactly once.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import {
  FILE_NAME,
  KNOWN_BUGS_DIR,
  type KnownBug,
  REPO,
  bodySeverity,
  parseKnownBug,
  registerProblems,
  renderKnownBug,
} from '../../packages/shared/__tests__/known-bugs/register';

const OLD_PATH = 'specs/cross-cutting/FILM-CC-04-known-bugs.md';

/** Fixed-table cells that are not a PR reference, and what they were. */
const FIXED_IN_ALIASES: Record<string, string[]> = {
  'this batch-records PR (`docs/batch-records-2026-09-23`)': ['#335'],
};

/** Leads groups by their bold heading's first words; the rest are the 2026-09-23 audit's. */
const LEAD_SOURCES: { prefix: string; file: string; title: string }[] = [
  {
    prefix: 'Infrastructure and records',
    file: '2026-09-24-kb-2-70-81.md',
    title: 'Leads from KB-2, KB-70 and KB-81 (2026-09-24)',
  },
  {
    prefix: 'From KB-78',
    file: '2026-09-24-kb-78.md',
    title: 'Leads from KB-78 (2026-09-24)',
  },
  {
    prefix: 'Account exposure',
    file: '2026-09-24-account-exposure.md',
    title: 'Leads from KB-59, KB-60 and KB-42 (2026-09-24)',
  },
  {
    prefix: 'Untyped Supabase clients',
    file: '2026-09-24-kb-66.md',
    title: 'Leads from KB-66 (2026-09-24)',
  },
];
const AUDIT_LEADS = '2026-09-23-spec-audit.md';
const LEAD_GROUP = /^\*\*[^*]+\*\*/;

interface OldEntry {
  id: string;
  title: string;
  body: string;
  separator: string;
}

interface FixedTableRow {
  line: string;
  ids: { id: string; part: boolean }[];
  bug: string;
  fixedIn: string;
}

interface OldRegister {
  header: string;
  entries: OldEntry[];
  rows: FixedTableRow[];
  dashRows: string[];
  fixedPreamble: string[];
  leads: string[];
}

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fail(message: string): never {
  console.error(`split-known-bugs: ${message}`);
  process.exit(1);
}

export function parseOld(text: string): OldRegister {
  const lines = text.split('\n');
  const h2 = lines.flatMap((line, i) => (/^## /.test(line) ? [i] : []));
  const fixedAt = lines.findIndex((l) => /^## Fixed\s*$/.test(l));
  const leadsAt = lines.findIndex((l) => /^## Leads\b/.test(l));
  if (fixedAt === -1 || leadsAt === -1) {
    fail(`${OLD_PATH} has no "## Fixed" or "## Leads" section: nothing to split`);
  }

  const entries: OldEntry[] = [];
  for (const [n, start] of h2.entries()) {
    const heading = /^## (KB-\d+) — (.*)$/.exec(lines[start] ?? '');
    if (!heading) continue;
    const end = h2[n + 1] ?? lines.length;
    if (end > fixedAt) fail(`${heading[1]} runs into the Fixed section`);
    const segment = lines.slice(start, end);
    let keep = segment.length;
    while (keep > 0 && /^(---)?\s*$/.test(segment[keep - 1] ?? '')) keep--;
    entries.push({
      id: heading[1]!,
      title: heading[2]!,
      body: segment.slice(0, keep).join('\n'),
      separator: segment.slice(keep).join('\n'),
    });
  }
  const otherH2 = h2.filter(
    (i) => i !== fixedAt && i !== leadsAt && !/^## KB-\d+ — /.test(lines[i]!),
  );
  if (otherH2.length > 0) {
    fail(`unexpected sections: ${otherH2.map((i) => lines[i]).join('; ')}`);
  }
  const firstEntry = h2.find((i) => /^## KB-\d+ — /.test(lines[i]!)) ?? fixedAt;

  const rows: FixedTableRow[] = [];
  const dashRows: string[] = [];
  const fixedPreamble: string[] = [];
  for (const line of lines.slice(fixedAt, leadsAt)) {
    const cells = line.split('|').map((c) => c.trim());
    if (!line.startsWith('| ') || cells[1] === 'ID') {
      if (line.startsWith('|')) fixedPreamble.push(line);
      continue;
    }
    if (cells[1] === '—') {
      dashRows.push(line);
      continue;
    }
    const ids = (cells[1] ?? '').split(',').map((part) => {
      const m = /^(KB-\d+)( \(part\))?$/.exec(part.trim());
      if (!m) fail(`Fixed-table row with an id cell I cannot read: ${line}`);
      return { id: m[1]!, part: Boolean(m[2]) };
    });
    rows.push({
      line,
      ids,
      bug: cells.slice(2, -2).join(' | '),
      fixedIn: cells[cells.length - 2] ?? '',
    });
  }

  return {
    header: lines.slice(0, firstEntry).join('\n'),
    entries,
    rows,
    dashRows,
    fixedPreamble,
    leads: lines.slice(leadsAt),
  };
}

/** The old KB-80 guard's reading of the old file, kept here to check the split against. */
function oldGuardFixedIds(text: string): Set<string> {
  const { entries, rows } = parseOld(text);
  const fixed = new Set<string>();
  for (const row of rows) {
    for (const { id, part } of row.ids) if (!part) fixed.add(id);
  }
  const BANNER = /\*\*Fixed\*\*|\*\*Fixed \(\d{4}-\d{2}-\d{2}\)/;
  for (const { id, body } of entries) {
    const lead = body.split(/\n### /)[0] ?? '';
    const paragraph = lead.split(/\n\s*\n/).find((p) => BANNER.test(p));
    if (paragraph && !/in part|\(part\)/i.test(paragraph)) fixed.add(id);
  }
  return fixed;
}

function fixedInItems(cell: string): string[] {
  const alias = FIXED_IN_ALIASES[cell];
  if (alias) return alias;
  return cell.split(/,\s*(?=#|FILM-)/).map((item) => item.trim());
}

/** status, fixed_in and fixed_summary for one id, from the Fixed-table rows naming it. */
function fixedFields(id: string, rows: FixedTableRow[]) {
  const naming = rows.filter((row) => row.ids.some((i) => i.id === id));
  const whole = naming.some((row) =>
    row.ids.some((i) => i.id === id && !i.part),
  );
  return {
    status: (whole ? 'fixed' : naming.length > 0 ? 'partial' : 'open') as
      | 'fixed'
      | 'partial'
      | 'open',
    fixedIn: naming.flatMap((row) => fixedInItems(row.fixedIn)),
    fixedSummary: naming.map((row) => row.bug).join('; '),
  };
}

/** The date each entry's heading first reached `rev`'s first-parent history. */
function foundDates(ids: string[], rev: string): Map<string, string> {
  const dates = new Map<string, string>();
  for (const id of ids) {
    const out = git(
      'log',
      '--first-parent',
      '--reverse',
      '--format=%ad',
      '--date=short',
      `-S## ${id} —`,
      rev,
      '--',
      OLD_PATH,
    ).trim();
    const first = out.split('\n')[0];
    if (!first) fail(`no commit in ${rev} adds the heading of ${id}`);
    dates.set(id, first);
  }
  return dates;
}

function leadsTarget(groupLine: string): string | undefined {
  const title = LEAD_GROUP.exec(groupLine)?.[0].replace(/\*/g, '') ?? '';
  return LEAD_SOURCES.find((s) => title.startsWith(s.prefix))?.file;
}

/**
 * The leads section as one text per leads file. Lines before the first group
 * and every unlisted group go to the audit's file. Each file other than the
 * audit's opens with a title and a pointer to the rule.
 */
export function splitLeads(leads: string[]): Map<string, string[]> {
  const files = new Map<string, string[]>([[AUDIT_LEADS, []]]);
  for (const source of LEAD_SOURCES) {
    files.set(source.file, [
      `# ${source.title}`,
      '',
      'Read, not reproduced. The rule for leads is in [the README](../README.md#leads).',
      '',
    ]);
  }
  let current = AUDIT_LEADS;
  for (const line of leads) {
    if (LEAD_GROUP.test(line)) current = leadsTarget(line) ?? AUDIT_LEADS;
    files.get(current)!.push(line);
  }
  for (const [file, lines] of files) {
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    files.set(file, lines);
  }
  return files;
}

function preNumbering(old: OldRegister): string {
  return [
    '# Fixed before the register numbered its entries',
    '',
    'Frozen: these fixes predate `KB-<n>` numbers, so they have no file of',
    'their own. Rows copied verbatim from the old register\'s *Fixed* table.',
    '',
    ...old.fixedPreamble,
    ...old.dashRows,
    '',
  ].join('\n');
}

function buildEntries(old: OldRegister, found: Map<string, string>): KnownBug[] {
  return old.entries.map(({ id, title, body }) => ({
    file: `specs/known-bugs/${id}.md`,
    id,
    title,
    ...fixedFields(id, old.rows),
    severity: bodySeverity(body),
    found: found.get(id)!,
    body,
  }));
}

function checkSplit(text: string, old: OldRegister, bugs: KnownBug[]) {
  const problems: string[] = [];

  const rendered = bugs.map((bug) => ({
    file: bug.file,
    text: renderKnownBug(bug),
  }));
  problems.push(...registerProblems(rendered));

  for (const [n, { file, text: fileText }] of rendered.entries()) {
    const { bug } = parseKnownBug({ file, text: fileText });
    if (bug?.body !== old.entries[n]!.body) {
      problems.push(`${file}: the entry does not read back byte for byte`);
    }
  }

  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## KB-\d+ — /.test(l));
  const end = lines.findIndex((l) => /^## Fixed\s*$/.test(l));
  const region = lines.slice(start, end).join('\n');
  const rebuilt = old.entries
    .map((e) => (e.separator ? `${e.body}\n${e.separator}` : e.body))
    .join('\n');
  if (rebuilt !== region) {
    problems.push('the entries do not rebuild the old entries region exactly');
  }
  // What is cut from each entry must be its `---` separator and blank lines,
  // nothing else: otherwise text could move from a body into the cut unseen.
  for (const { id, separator } of old.entries) {
    const cut = separator.split('\n');
    if (
      cut.filter((l) => l === '---').length !== 1 ||
      cut.some((l) => l !== '---' && l.trim() !== '')
    ) {
      problems.push(`${id}: the text cut after the entry is not one \`---\` separator`);
    }
  }

  const expectFixed = oldGuardFixedIds(text);
  const gotFixed = new Set(
    bugs.filter((b) => b.status === 'fixed').map((b) => b.id),
  );
  const diff = [
    ...[...expectFixed].filter((id) => !gotFixed.has(id)).map((id) => `-${id}`),
    ...[...gotFixed].filter((id) => !expectFixed.has(id)).map((id) => `+${id}`),
  ];
  if (diff.length > 0) {
    problems.push(`fixed set differs from the old KB-80 reading: ${diff.join(' ')}`);
  }

  const ids = new Set(bugs.map((b) => b.id));
  for (const row of old.rows) {
    for (const { id } of row.ids) {
      if (!ids.has(id)) problems.push(`Fixed row names ${id}, which has no entry`);
    }
  }

  const leadFiles = splitLeads(old.leads);
  const written = [...leadFiles.values()].flat();
  for (const line of old.leads) {
    if (line.trim() === '') continue;
    const count = written.filter((w) => w === line).length;
    const inOld = old.leads.filter((w) => w === line).length;
    if (count !== inOld) {
      problems.push(`leads line written ${count}× (old: ${inOld}×): ${line.slice(0, 80)}`);
    }
  }

  if (problems.length > 0) {
    fail(`self-check failed, nothing written:\n  ${problems.join('\n  ')}`);
  }
}

function readOld(rev: string | undefined): string {
  return rev
    ? git('show', `${rev}:${OLD_PATH}`)
    : readFileSync(join(REPO, OLD_PATH), 'utf8');
}

function split(rev: string | undefined, out: string) {
  const text = readOld(rev);
  const old = parseOld(text);
  const bugs = buildEntries(
    old,
    foundDates(
      old.entries.map((e) => e.id),
      rev ?? 'HEAD',
    ),
  );
  checkSplit(text, old, bugs);

  mkdirSync(join(out, 'leads'), { recursive: true });
  for (const name of readdirSync(out)) {
    if (FILE_NAME.test(name)) rmSync(join(out, name));
  }
  for (const bug of bugs) writeFileSync(join(out, `${bug.id}.md`), renderKnownBug(bug));
  writeFileSync(join(out, '_pre-numbering.md'), preNumbering(old));
  for (const [file, lines] of splitLeads(old.leads)) {
    writeFileSync(join(out, 'leads', file), `${lines.join('\n')}\n`);
  }

  const counts = { fixed: 0, partial: 0, open: 0 };
  for (const bug of bugs) counts[bug.status]++;
  console.log(
    `Split ${bugs.length} entries (${counts.fixed} fixed, ${counts.partial} partial, ${counts.open} open), ` +
      `${old.dashRows.length} pre-numbering rows, ${splitLeads(old.leads).size} leads files → ${relative(REPO, out) || out}`,
  );
}

/** 3-way merge of text: `ours` with the change base → theirs. Returns null on conflict. */
function merge3(ours: string, base: string, theirs: string): string | null {
  if (base === theirs) return ours;
  if (base === ours) return theirs;
  const dir = mkdtempSync(join(tmpdir(), 'kb-port-'));
  try {
    const [o, b, t] = ['ours', 'base', 'theirs'].map((n) => join(dir, n));
    writeFileSync(o!, `${ours}\n`);
    writeFileSync(b!, `${base}\n`);
    writeFileSync(t!, `${theirs}\n`);
    try {
      execFileSync('git', ['merge-file', o!, b!, t!], { stdio: 'ignore' });
    } catch {
      return null;
    }
    return readFileSync(o!, 'utf8').replace(/\n$/, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readBug(out: string, id: string): KnownBug | undefined {
  const path = join(out, `${id}.md`);
  if (!existsSync(path)) return undefined;
  const { bug, problems } = parseKnownBug({
    file: `specs/known-bugs/${id}.md`,
    text: readFileSync(path, 'utf8'),
  });
  if (!bug || problems.length > 0) fail(problems.join('\n'));
  return bug;
}

function port(oldHead: string, onto: string, out: string) {
  const base = git('merge-base', oldHead, onto).trim();
  const before = parseOld(git('show', `${base}:${OLD_PATH}`));
  const after = parseOld(git('show', `${oldHead}:${OLD_PATH}`));
  const today = new Date().toISOString().slice(0, 10);
  const conflicts: string[] = [];
  const byHand: string[] = [];
  const changed: string[] = [];
  const conflicted = new Set<string>();

  if (before.header !== after.header) {
    byHand.push('the register header changed: carry it to specs/known-bugs/README.md');
  }
  const beforeEntries = new Map(before.entries.map((e) => [e.id, e]));
  const afterIds = new Set(after.entries.map((e) => e.id));
  for (const id of beforeEntries.keys()) {
    if (!afterIds.has(id)) byHand.push(`${id} was removed from the old file`);
  }

  const bugs = new Map<string, KnownBug>();
  const load = (id: string) => {
    if (!bugs.has(id)) {
      const bug = readBug(out, id);
      if (bug) bugs.set(id, bug);
    }
    return bugs.get(id);
  };

  for (const entry of after.entries) {
    const was = beforeEntries.get(entry.id);
    if (was?.body === entry.body) continue;
    const current = load(entry.id);
    const body = current
      ? merge3(current.body, was?.body ?? '', entry.body)
      : entry.body;
    if (body === null) {
      conflicts.push(`specs/known-bugs/${entry.id}.md (entry text)`);
      conflicted.add(entry.id);
      continue;
    }
    const title = /^## KB-\d+ — (.*)$/.exec(body.split('\n')[0] ?? '')?.[1];
    bugs.set(entry.id, {
      file: `specs/known-bugs/${entry.id}.md`,
      id: entry.id,
      title: title ?? entry.title,
      status: current?.status ?? 'open',
      fixedIn: current?.fixedIn ?? [],
      fixedSummary: current?.fixedSummary ?? '',
      severity: bodySeverity(body),
      found: current?.found ?? today,
      body,
    });
    changed.push(entry.id);
  }

  const beforeRows = new Set(before.rows.map((r) => r.line));
  const afterRows = new Set(after.rows.map((r) => r.line));
  for (const row of before.rows) {
    if (!afterRows.has(row.line)) byHand.push(`Fixed row removed or edited: ${row.line}`);
  }
  for (const row of after.rows) {
    if (beforeRows.has(row.line)) continue;
    for (const { id, part } of row.ids) {
      const bug = load(id);
      if (!bug) {
        byHand.push(`Fixed row names ${id}, which has no file: ${row.line}`);
        continue;
      }
      const items = fixedInItems(row.fixedIn);
      bug.status = part ? (bug.status === 'fixed' ? 'fixed' : 'partial') : 'fixed';
      bug.fixedIn = [...bug.fixedIn, ...items.filter((i) => !bug.fixedIn.includes(i))];
      if (!bug.fixedSummary.includes(row.bug)) {
        bug.fixedSummary = bug.fixedSummary
          ? `${bug.fixedSummary}; ${row.bug}`
          : row.bug;
      }
      if (!changed.includes(id)) changed.push(id);
    }
  }
  for (const row of after.dashRows) {
    if (!before.dashRows.includes(row)) byHand.push(`new "—" Fixed row: ${row}`);
  }

  const leadsBefore = splitLeads(before.leads);
  const leadsAfter = splitLeads(after.leads);
  const leadWrites = new Map<string, string>();
  for (const [file, lines] of leadsAfter) {
    const baseText = (leadsBefore.get(file) ?? []).join('\n');
    const theirs = lines.join('\n');
    if (baseText === theirs) continue;
    const path = join(out, 'leads', file);
    const ours = existsSync(path) ? readFileSync(path, 'utf8').replace(/\n$/, '') : '';
    const merged = merge3(ours, baseText, theirs);
    if (merged === null) conflicts.push(`specs/known-bugs/leads/${file}`);
    else leadWrites.set(file, merged);
  }

  // A conflicted entry is left exactly as it was, Fixed rows included.
  for (const id of changed.filter((i) => !conflicted.has(i))) {
    const bug = bugs.get(id);
    if (bug) writeFileSync(join(out, `${id}.md`), renderKnownBug(bug));
  }
  for (const [file, text] of leadWrites) {
    writeFileSync(join(out, 'leads', file), `${text}\n`);
  }

  const problems = registerProblems(
    readdirSync(out)
      .filter((n) => FILE_NAME.test(n))
      .map((n) => ({
        file: `specs/known-bugs/${n}`,
        text: readFileSync(join(out, n), 'utf8'),
      })),
  );

  console.log(
    `Ported ${oldHead.slice(0, 8)} (merge-base ${base.slice(0, 8)}): ` +
      `${changed.length} KB file(s) [${changed.join(', ')}], ${leadWrites.size} leads file(s).`,
  );
  for (const line of conflicts) console.log(`CONFLICT  ${line}: left unchanged; apply the PR's entry and Fixed row by hand`);
  for (const line of byHand) console.log(`BY HAND   ${line}`);
  for (const line of problems) console.log(`INVALID   ${line}`);
  if (conflicts.length + byHand.length + problems.length > 0) process.exit(2);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const out = arg('--out') ?? KNOWN_BUGS_DIR;
const portHead = arg('--port');
if (portHead) port(portHead, arg('--onto') ?? 'origin/main', out);
else split(arg('--from'), out);
