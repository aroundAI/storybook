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
}

export interface Records {
  /** The spec file for a FILM id, or undefined when there is none. */
  specFile(id: string): string | undefined;
  specText(file: string): string;
  /** A known bug's `fixed_in`, or undefined when there is no such KB. */
  kbFixedIn(id: string): string[] | undefined;
  /** The label naming the spec's area, e.g. `area: analytics`. */
  specArea(file: string): string | undefined;
}

export interface ParsedTitle {
  type: PrType;
  ids: string[];
}

export function parseTitle(title: string): ParsedTitle | undefined {
  const match = TITLE.exec(title);
  if (!match) return undefined;
  return {
    type: match[1] as PrType,
    ids: [...(match[2] ?? '').matchAll(ID)].map((m) => m[1]!),
  };
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

  if (labels) {
    const missing = expectedLabels(pr, records).filter(
      (label) => !pr.labels.includes(label),
    );
    if (missing.length) problems.push(`missing labels: ${missing.join(', ')}`);
  }

  return problems;
}
