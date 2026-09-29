/**
 * What a PR must say about itself, so a gap between the work and the records
 * shows up in a list instead of an audit (2026-09-29: three FILM-1802 PRs had
 * merged while the spec still said their behaviour was "not served").
 *
 * The title is `type(IDS): summary`. IDS are the specs and known bugs the PR
 * *does*, comma-separated; a spec or KB it only mentions stays out of the
 * parentheses ("fix(KB-111): … (KB-114 filed)"). A `feat` or `fix` scoped to
 * a record updates that record in the same PR:
 *
 * - FILM-x: the spec file changes in the PR, or already cites `#<n>`;
 * - KB-n:   its `fixed_in` lists `#<n>` (a partial fix too).
 *
 * `docs`, `test`, `chore`, `ci`, `refactor`, `perf` and `build` change no
 * criterion by definition, so they owe no record. Labels mirror the title.
 */

export const TYPES = [
  'feat',
  'fix',
  'docs',
  'test',
  'chore',
  'ci',
  'refactor',
  'perf',
  'build',
  'revert',
] as const;

export type PrType = (typeof TYPES)[number];

const TITLE = new RegExp(`^(${TYPES.join('|')})(?:\\(([^)]*)\\))?!?: \\S`);
const ID = /\b(FILM-[0-9A-Z]+(?:-[0-9]+)?[a-z]?|KB-\d+)\b/g;

export interface PullRequest {
  number: number;
  title: string;
  /** Paths the PR changes. */
  files: string[];
  labels: string[];
  /** Its description, when it is checked (`--pr`; `--commits` for an audit). */
  body?: string;
  /** Its commits, when they are checked (`--pr`; `--commits` for an audit). */
  commits?: Commit[];
}

export interface Commit {
  sha: string;
  authorEmails: string[];
  subject: string;
  body: string;
}

/**
 * Who may author a commit (owner, 2026-09-29: "everything needs to be
 * committed under shaurya@aroundai.co not claude"). Add a teammate here.
 */
export const COMMIT_AUTHORS = ['shaurya@aroundai.co'];

const CLAUDE_TRAILER = /^co-authored-by:.*\b(claude|anthropic)\b/im;

/** A commit's author, trailer and subject, against CLAUDE.md "Commit messages". */
export function commitProblems(commit: Commit): string[] {
  const at = commit.sha.slice(0, 8);
  const problems: string[] = [];
  const strangers = commit.authorEmails.filter(
    (email) => !COMMIT_AUTHORS.includes(email.toLowerCase()),
  );
  if (strangers.length)
    problems.push(`commit ${at} is authored by ${strangers.join(', ')}`);
  if (CLAUDE_TRAILER.test(commit.body))
    problems.push(`commit ${at} carries a Co-Authored-By Claude trailer`);
  if (!parseTitle(commit.subject))
    problems.push(`commit ${at}'s subject is not \`type(IDS): summary\``);
  return problems;
}

export interface Records {
  /** The spec file for a FILM id, or undefined when there is none. */
  specFile(id: string): string | undefined;
  specText(file: string): string;
  /** A known bug's `fixed_in`, or undefined when there is no such KB. */
  kbFixedIn(id: string): string[] | undefined;
  /** The label naming the spec's area, e.g. `area: analytics`. */
  specArea(file: string): string | undefined;
  /** A known bug's `status` (open, partial, fixed), or undefined. */
  kbStatus(id: string): string | undefined;
}

export interface ParsedTitle {
  type: PrType;
  ids: string[];
  /**
   * Markers at the end of the summary (CLAUDE.md): `(closes FILM-x)`,
   * `(part N)`, `(stacked on #N)`, `(re-land of #N)`. Any other
   * parenthesis, such as "(KB-114 filed)", is prose.
   */
  closes: string[];
  part?: string;
  stackedOn: number[];
  relandOf: number[];
}

const MARKER = /\((closes|part|stacked on|re-land of) ([^)]+)\)/g;
const numbers = (text: string) =>
  [...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));

export function parseTitle(title: string): ParsedTitle | undefined {
  const match = TITLE.exec(title);
  if (!match) return undefined;
  const parsed: ParsedTitle = {
    type: match[1] as PrType,
    ids: [...(match[2] ?? '').matchAll(ID)].map((m) => m[1]!),
    closes: [],
    stackedOn: [],
    relandOf: [],
  };
  for (const [, kind, value] of title.matchAll(MARKER)) {
    if (kind === 'closes')
      parsed.closes.push(...[...value!.matchAll(ID)].map((m) => m[1]!));
    if (kind === 'part') parsed.part = value!.trim();
    if (kind === 'stacked on') parsed.stackedOn.push(...numbers(value!));
    if (kind === 're-land of') parsed.relandOf.push(...numbers(value!));
  }
  return parsed;
}

/** The labels a PR should carry, from its title and the specs it names. */
export function expectedLabels(pr: PullRequest, records: Records): string[] {
  const parsed = parseTitle(pr.title);
  if (!parsed) return [];
  const labels = new Set([`type: ${parsed.type}`]);
  for (const id of parsed.ids) {
    if (id.startsWith('KB-')) labels.add('known-bug');
    const file = id.startsWith('FILM-') ? records.specFile(id) : undefined;
    if (file) {
      labels.add('spec');
      const area = records.specArea(file);
      if (area) labels.add(area);
    }
  }
  return [...labels].sort();
}

export function prProblems(
  pr: PullRequest,
  records: Records,
  { labels = true } = {},
): string[] {
  const parsed = parseTitle(pr.title);
  if (!parsed) {
    return [
      `title is not \`type(IDS): summary\` with type one of ${TYPES.join(', ')}`,
    ];
  }

  const problems: string[] = [];
  const recordOwed = parsed.type === 'feat' || parsed.type === 'fix';
  const ref = `#${pr.number}`;

  for (const id of parsed.ids) {
    if (id.startsWith('KB-')) {
      const fixedIn = records.kbFixedIn(id);
      if (!fixedIn) problems.push(`${id} names no file in specs/known-bugs/`);
      else if (
        recordOwed &&
        !fixedIn.some((entry) => new RegExp(`${ref}\\b`).test(entry))
      )
        problems.push(`${id}'s fixed_in does not list ${ref}`);
      continue;
    }
    const file = records.specFile(id);
    if (!file) problems.push(`${id} names no spec in specs/`);
    else if (
      recordOwed &&
      !pr.files.includes(file) &&
      !new RegExp(`${ref}\\b`).test(records.specText(file))
    )
      problems.push(
        `${id}: ${file} is not updated by this PR and never cites ${ref}`,
      );
  }

  // `closes` is a promise the records must keep: the spec reads DONE, the
  // KB fixed. And a PR closes only what it does.
  for (const id of parsed.closes) {
    if (!parsed.ids.includes(id)) {
      problems.push(`closes ${id}, which is not in the title's (IDS)`);
      continue;
    }
    if (id.startsWith('KB-')) {
      if (records.kbStatus(id) && records.kbStatus(id) !== 'fixed')
        problems.push(
          `closes ${id}, but its status is ${records.kbStatus(id)}`,
        );
      continue;
    }
    const file = records.specFile(id);
    const status = file && /^status: (\S+)/m.exec(records.specText(file))?.[1];
    if (file && status !== 'DONE')
      problems.push(`closes ${id}, but ${file} says ${status ?? 'no status'}`);
  }

  for (const commit of pr.commits ?? [])
    problems.push(...commitProblems(commit));
  // Owner, 2026-09-29: nothing is signed as Claude's, the PR text included.
  if (pr.body && /generated with \[?claude code/i.test(pr.body))
    problems.push(
      'the description carries a "Generated with Claude Code" line',
    );

  if (labels) {
    const missing = expectedLabels(pr, records).filter(
      (label) => !pr.labels.includes(label),
    );
    if (missing.length) problems.push(`missing labels: ${missing.join(', ')}`);
  }

  return problems;
}
