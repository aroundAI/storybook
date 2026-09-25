import { JSON_SCHEMA, load } from 'js-yaml';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The known-bugs register: one file per KB, `specs/known-bugs/KB-<n>.md`.
 *
 * Each file is YAML front matter followed by the entry, whose first line is
 * `## KB-<n> — <title>`. The front matter is what tools read; the body is the
 * record a person reads. `registerProblems` keeps the two from disagreeing.
 * Rules for writing an entry: `specs/known-bugs/README.md`.
 */

export const REPO = resolve(__dirname, '../../../..');
export const KNOWN_BUGS_DIR = join(REPO, 'specs/known-bugs');

export const STATUSES = ['open', 'partial', 'fixed'] as const;
export const SEVERITIES = ['High', 'Medium', 'Low', 'unrated'] as const;
export const FILE_NAME = /^KB-\d+\.md$/;

const KEYS = [
  'id',
  'title',
  'status',
  'fixed_in',
  'fixed_summary',
  'severity',
  'found',
] as const;

export type Status = (typeof STATUSES)[number];
export type Severity = (typeof SEVERITIES)[number];

export interface KnownBugFile {
  /** Path relative to the repo, for messages. */
  file: string;
  text: string;
}

export interface KnownBug {
  file: string;
  id: string;
  title: string;
  status: Status;
  fixedIn: string[];
  fixedSummary: string;
  severity: Severity;
  found: string;
  body: string;
}

/** An entry's opening banner that marks it Fixed, as the register has always written it. */
const BANNER = /\*\*Fixed\*\*|\*\*Fixed \(\d{4}-\d{2}-\d{2}\)/;
const BODY_SEVERITY = /\*\*Severity:\*\*\s*(?:\*\*)?(High|Medium|Low)\b/;
const FIXED_IN_ITEM = /^(?:#\d+|FILM-[\w-]+)\b/;

export function splitFrontMatter(text: string): {
  data: unknown;
  body: string;
} {
  if (!text.startsWith('---\n')) {
    throw new Error('does not start with a `---` front matter block');
  }
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) throw new Error('front matter is not closed by `---`');

  // JSON_SCHEMA: an unquoted 2026-09-23 stays a string, not a Date.
  const data = load(text.slice(4, end + 1), { schema: JSON_SCHEMA });
  return {
    data,
    body: text
      .slice(end + 5)
      .replace(/^\n/, '')
      .replace(/\n$/, ''),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads one file. Returns the problems instead of throwing, so the schema
 * test can list every bad file at once.
 */
export function parseKnownBug({ file, text }: KnownBugFile): {
  bug?: KnownBug;
  problems: string[];
} {
  const problems: string[] = [];
  let data: unknown;
  let body: string;
  try {
    ({ data, body } = splitFrontMatter(text));
  } catch (error) {
    return { problems: [`${file}: ${(error as Error).message}`] };
  }
  if (!isRecord(data)) {
    return { problems: [`${file}: front matter is not a mapping`] };
  }

  const str = (key: string) => {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (value !== undefined && value !== null && value !== '') {
      problems.push(`${file}: \`${key}\` must be a string`);
    }
    return '';
  };

  for (const key of Object.keys(data)) {
    if (!(KEYS as readonly string[]).includes(key)) {
      problems.push(`${file}: unknown key \`${key}\``);
    }
  }

  const id = str('id');
  const title = str('title');
  const status = str('status');
  const severity = str('severity');
  const found = str('found');
  const fixedSummary = str('fixed_summary');
  const rawFixedIn = data.fixed_in ?? [];
  const fixedIn = Array.isArray(rawFixedIn)
    ? rawFixedIn.map((item) => String(item))
    : [];

  if (!/^KB-\d+$/.test(id)) problems.push(`${file}: \`id\` must be KB-<n>`);
  if (!title) problems.push(`${file}: \`title\` is required`);
  if (!(STATUSES as readonly string[]).includes(status)) {
    problems.push(`${file}: \`status\` must be one of ${STATUSES.join(', ')}`);
  }
  if (!(SEVERITIES as readonly string[]).includes(severity)) {
    problems.push(
      `${file}: \`severity\` must be one of ${SEVERITIES.join(', ')}`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(found)) {
    problems.push(`${file}: \`found\` must be a date, YYYY-MM-DD`);
  }
  if (!Array.isArray(rawFixedIn)) {
    problems.push(`${file}: \`fixed_in\` must be a list`);
  }
  for (const item of fixedIn) {
    if (!FIXED_IN_ITEM.test(item)) {
      problems.push(
        `${file}: \`fixed_in\` item "${item}" must start with #<PR> or a spec id`,
      );
    }
  }

  return {
    bug: {
      file,
      id,
      title,
      status: status as Status,
      fixedIn,
      fixedSummary,
      severity: severity as Severity,
      found,
      body,
    },
    problems,
  };
}

/** True when the entry's opening banner (before its first `###`) says Fixed, not in part. */
export function bannerSaysFixed(body: string): boolean {
  const lead = body.split(/\n### /)[0] ?? '';
  const paragraph = lead.split(/\n\s*\n/).find((p) => BANNER.test(p));
  return paragraph !== undefined && !/in part|\(part\)/i.test(paragraph);
}

export function bodySeverity(body: string): Severity {
  return (BODY_SEVERITY.exec(body)?.[1] as Severity | undefined) ?? 'unrated';
}

/**
 * Every rule a register file must satisfy, over the whole set: the fields,
 * the filename, unique ids, and front matter that agrees with the body.
 */
export function registerProblems(files: KnownBugFile[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();

  for (const input of files) {
    const { bug, problems: own } = parseKnownBug(input);
    problems.push(...own);
    if (!bug) continue;
    const { file, id, title, status, fixedIn, fixedSummary, body } = bug;

    const name = file.split('/').pop() ?? file;
    if (id && name !== `${id}.md`) {
      problems.push(`${file}: \`id\` ${id} does not match the file name`);
    }
    const other = seen.get(id);
    if (id && other) problems.push(`${file}: ${id} is also used by ${other}`);
    seen.set(id, file);

    const firstLine = body.split('\n')[0];
    if (firstLine !== `## ${id} — ${title}`) {
      problems.push(
        `${file}: the entry must start with "## ${id} — ${title}" (the front matter's id and title)`,
      );
    }

    if (status === 'open' && fixedIn.length > 0) {
      problems.push(
        `${file}: open, but \`fixed_in\` names ${fixedIn.join(', ')}`,
      );
    }
    if ((status === 'fixed' || status === 'partial') && fixedIn.length === 0) {
      problems.push(`${file}: ${status} needs \`fixed_in\` (the PR)`);
    }
    if (fixedIn.length > 0 && !fixedSummary) {
      problems.push(`${file}: \`fixed_in\` needs a one-line \`fixed_summary\``);
    }
    if (status !== 'fixed' && bannerSaysFixed(body)) {
      problems.push(
        `${file}: the entry's banner says Fixed, but \`status\` is ${status}`,
      );
    }
    const severity = bodySeverity(body);
    if (bug.severity && severity !== bug.severity) {
      problems.push(
        `${file}: \`severity\` is ${bug.severity}, the entry's **Severity:** says ${severity}`,
      );
    }
  }
  return problems;
}

export function readRegisterFiles(dir = KNOWN_BUGS_DIR): KnownBugFile[] {
  return readdirSync(dir)
    .filter((name) => FILE_NAME.test(name))
    .map((name) => ({
      file: `specs/known-bugs/${name}`,
      text: readFileSync(join(dir, name), 'utf8'),
    }));
}

/** The register, parsed; throws if any file is malformed (the schema test says which). */
export function loadKnownBugs(files = readRegisterFiles()): KnownBug[] {
  return files
    .map((input) => {
      const { bug, problems } = parseKnownBug(input);
      if (!bug || problems.length > 0) throw new Error(problems.join('\n'));
      return bug;
    })
    .sort((a, b) => kbNumber(a.id) - kbNumber(b.id));
}

export function kbNumber(id: string): number {
  return Number(id.replace(/^KB-/, ''));
}

/** KB ids whose work is finished, with where it was fixed. `partial` is not finished. */
export function fixedIds(bugs: KnownBug[]): Map<string, string> {
  return new Map(
    bugs
      .filter((bug) => bug.status === 'fixed')
      .map((bug) => [
        bug.id,
        `${bug.file}, fixed_in ${bug.fixedIn.join(', ')}`,
      ]),
  );
}

export function renderFrontMatter(
  bug: Omit<KnownBug, 'file' | 'body'>,
): string {
  const lines = [
    '---',
    `id: ${bug.id}`,
    `title: ${JSON.stringify(bug.title)}`,
    `status: ${bug.status}`,
    `fixed_in: [${bug.fixedIn.map((item) => JSON.stringify(item)).join(', ')}]`,
  ];
  if (bug.fixedSummary) {
    lines.push(`fixed_summary: ${JSON.stringify(bug.fixedSummary)}`);
  }
  lines.push(`severity: ${bug.severity}`, `found: ${bug.found}`, '---', '');
  return lines.join('\n');
}

export function renderKnownBug(bug: Omit<KnownBug, 'file'>): string {
  return `${renderFrontMatter(bug)}\n${bug.body}\n`;
}

export interface FixedRow {
  ids: string[];
  summary: string;
  fixedIn: string;
}

/**
 * The Fixed table, derived: KBs fixed together with one summary share a row,
 * as they did in the old table (`KB-9, KB-10`). A partial KB shows as `(part)`.
 */
export function fixedTable(bugs: KnownBug[]): FixedRow[] {
  const rows = new Map<string, FixedRow>();
  for (const bug of bugs) {
    if (bug.status === 'open') continue;
    const id = bug.status === 'partial' ? `${bug.id} (part)` : bug.id;
    const fixedIn = bug.fixedIn.join(', ');
    const key = `${bug.status}\u0000${fixedIn}\u0000${bug.fixedSummary}`;
    const row = rows.get(key);
    if (row) row.ids.push(id);
    else rows.set(key, { ids: [id], summary: bug.fixedSummary, fixedIn });
  }
  return [...rows.values()];
}
