import { load } from 'js-yaml';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * KB-81. Spec citations (`path:line`, `path:line-line`) drift when the code
 * they cite moves. This finds them, and can rewrite the ones that only moved.
 *
 * Each citation is dated by the commit that last wrote its spec line
 * (`git blame`): that is when someone asserted "this is the line". The cited
 * line is then followed from that commit to the working tree through
 * `git diff -U0`, which says exactly where it went:
 *
 *   ok       — same line number, same content
 *   moved    — same content, different number (fixable with --fix)
 *   changed  — the line's text is no longer there; a human re-reads
 *   gone     — the cited file no longer exists
 *   past-eof — the line number is beyond the end of the file
 *
 * Only paths rooted at a top-level directory are checked; abbreviated ones
 * (`…/studio/x.ts:12`) and bare continuations (`, :403`) name no file.
 * RETIRED specs are archival and skipped. A spec line not yet committed is
 * taken as asserted against the working tree.
 *
 * Limits: a spec line re-edited for another reason re-dates its citations,
 * so drift that happened before that edit is not seen. In a shallow clone,
 * lines older than the clone are dated at its oldest commit, so CI sees the
 * drift a change introduces — which is when drift is created.
 */

export const REPO = resolve(__dirname, '../../../..');

const CITATION =
  /(?<![\w@.\-/[\]…])((?:apps|packages|specs|tooling|scripts|docs|\.github|deployment)\/[\w@.\-/[\]()]+\.(?:tsx?|sql|json|ya?ml|md|mdoc|sh|toml|m?js|cjs)):(\d+)(?:-(\d+))?(?!\d)/g;

const UNCOMMITTED = /^0{40}$/;

export type Verdict =
  | { kind: 'ok' }
  | { kind: 'moved'; from: number; to: number; toEnd?: number }
  | { kind: 'changed'; since: string }
  | { kind: 'gone' }
  | { kind: 'past-eof'; lines: number };

export interface Citation {
  specFile: string;
  specId: string;
  specLine: number;
  column: number;
  path: string;
  from: number;
  to?: number;
  raw: string;
  verdict: Verdict;
}

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newCount: number;
}

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function parseHunks(diff: string): Hunk[] {
  return diff
    .split('\n')
    .map((line) => /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      oldStart: Number(m[1]),
      oldCount: m[2] === undefined ? 1 : Number(m[2]),
      newCount: m[3] === undefined ? 1 : Number(m[3]),
    }));
}

/**
 * Where old line `line` is now, given the hunks of `git diff -U0 old new`,
 * or null when a hunk rewrote or removed it. A hunk with `oldCount` 0 inserts
 * after `oldStart`.
 */
export function mapLine(hunks: Hunk[], line: number): number | null {
  let shift = 0;
  for (const h of hunks) {
    if (
      h.oldCount > 0 &&
      line >= h.oldStart &&
      line < h.oldStart + h.oldCount
    ) {
      return null;
    }
    const before =
      h.oldCount === 0 ? h.oldStart < line : h.oldStart + h.oldCount <= line;
    if (before) shift += h.newCount - h.oldCount;
  }
  return line + shift;
}

export function specFiles(): string[] {
  return git(
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    'specs/*.yaml',
  )
    .trim()
    .split('\n')
    .filter((f) => f && existsSync(join(REPO, f)));
}

function blameCommits(specFile: string): string[] {
  const commits: string[] = [];
  for (const line of git('blame', '--porcelain', '--', specFile).split('\n')) {
    const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (m) commits[Number(m[2])] = m[1] as string;
  }
  return commits;
}

const fileText = new Map<string, string[] | null>();
function linesNow(path: string): string[] | null {
  if (!fileText.has(path)) {
    const abs = join(REPO, path);
    fileText.set(
      path,
      existsSync(abs)
        ? readFileSync(abs, 'utf8').replace(/\n$/, '').split('\n')
        : null,
    );
  }
  return fileText.get(path) ?? null;
}

const oldText = new Map<string, string[]>();
function linesAt(commit: string, path: string): string[] {
  const key = `${commit} ${path}`;
  if (!oldText.has(key)) {
    oldText.set(key, git('show', `${commit}:${path}`).split('\n'));
  }
  return oldText.get(key) ?? [];
}

/**
 * Where a line the diff rewrote went, judged by its text: the same number if
 * the text is still there, the one other line holding it if there is exactly
 * one, else null. `-U0` hunks sometimes swallow an unchanged line that sits
 * among edits; this keeps those from reading as "changed".
 */
function followText(commit: string, path: string, line: number): number | null {
  const want = linesAt(commit, path)[line - 1]?.trim();
  const now = linesNow(path) ?? [];
  if (!want) return null;
  if (now[line - 1]?.trim() === want) return line;
  const hits = now.flatMap((l, i) => (l.trim() === want ? [i + 1] : []));
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

const hunkCache = new Map<string, Hunk[] | null>();
function hunksSince(commit: string, path: string): Hunk[] | null {
  const key = `${commit} ${path}`;
  if (!hunkCache.has(key)) {
    let hunks: Hunk[] | null = null;
    try {
      git('cat-file', '-e', `${commit}:${path}`);
      hunks = parseHunks(
        git(
          'diff',
          '-U0',
          '-w',
          '--no-color',
          '--no-ext-diff',
          commit,
          '--',
          path,
        ),
      );
    } catch {
      hunks = null; // the file did not exist when the citation was written
    }
    hunkCache.set(key, hunks);
  }
  return hunkCache.get(key) ?? null;
}

function judge(
  commit: string | undefined,
  path: string,
  from: number,
  to?: number,
): Verdict {
  const now = linesNow(path);
  if (now === null) return { kind: 'gone' };

  const hunks =
    commit && !UNCOMMITTED.test(commit) ? hunksSince(commit, path) : null;
  if (hunks) {
    const follow = (line: number) =>
      mapLine(hunks, line) ?? followText(commit as string, path, line);
    const newFrom = follow(from);
    const newTo = to === undefined ? undefined : follow(to);
    if (newFrom === null || newTo === null) {
      return { kind: 'changed', since: (commit ?? '').slice(0, 8) };
    }
    if (newFrom !== from || (to !== undefined && newTo !== to)) {
      return { kind: 'moved', from, to: newFrom, toEnd: newTo };
    }
  }

  const last = to ?? from;
  if (last > now.length) return { kind: 'past-eof', lines: now.length };
  return { kind: 'ok' };
}

export function checkSpec(specFile: string): Citation[] {
  const text = readFileSync(join(REPO, specFile), 'utf8');
  const doc = load(text) as { spec_id?: string; status?: string } | null;
  if (doc?.status === 'RETIRED') return [];

  const lines = text.split('\n');
  if (!lines.some((l) => l.match(CITATION))) return [];

  const commits = blameCommits(specFile);
  return lines.flatMap((lineText, i) =>
    [...lineText.matchAll(CITATION)].map((m) => {
      const from = Number(m[2]);
      const to = m[3] === undefined ? undefined : Number(m[3]);
      return {
        specFile,
        specId: doc?.spec_id ?? specFile,
        specLine: i + 1,
        column: m.index,
        path: m[1] as string,
        from,
        to,
        raw: m[0],
        verdict: judge(commits[i + 1], m[1] as string, from, to),
      };
    }),
  );
}

export function checkAll(): Citation[] {
  return specFiles().flatMap(checkSpec);
}

/**
 * Which drifted citations fail the check, and which are only reported (the
 * merge queue, 2026-10-01). A `moved` citation's text is still in its file,
 * one `--fix` away, so it is a warning: failing on it made every merge that
 * shifted a cited line fail every other open PR. Text that changed, a file
 * that is gone, a line past the end: those fail, since the spec now names
 * code that is not there.
 */
export function triage(citations: Citation[]): {
  warnings: Citation[];
  failures: Citation[];
} {
  const drifted = citations.filter((c) => c.verdict.kind !== 'ok');
  return {
    warnings: drifted.filter((c) => c.verdict.kind === 'moved'),
    failures: drifted.filter((c) => c.verdict.kind !== 'moved'),
  };
}

export function describeCitation(c: Citation): string {
  const where = `${c.specId} ${c.specFile}:${c.specLine} → ${c.raw}`;
  switch (c.verdict.kind) {
    case 'moved': {
      const { to, toEnd } = c.verdict;
      return `${where} moved to :${to}${toEnd !== undefined ? `-${toEnd}` : ''}`;
    }
    case 'changed':
      return `${where} changed since ${c.verdict.since}: re-read the code`;
    case 'gone':
      return `${where} file no longer exists`;
    case 'past-eof':
      return `${where} past end of file (${c.verdict.lines} lines)`;
    default:
      return where;
  }
}

/** Rewrite every `moved` citation in place. Returns the number rewritten. */
export function fixMoved(citations: Citation[]): number {
  const bySpec = new Map<string, Citation[]>();
  for (const c of citations) {
    if (c.verdict.kind === 'moved') {
      bySpec.set(c.specFile, [...(bySpec.get(c.specFile) ?? []), c]);
    }
  }

  let fixed = 0;
  for (const [specFile, moved] of bySpec) {
    const abs = join(REPO, specFile);
    const lines = readFileSync(abs, 'utf8').split('\n');
    // Right to left, so an earlier rewrite never shifts a later column.
    for (const c of [...moved].sort(
      (a, b) => b.specLine - a.specLine || b.column - a.column,
    )) {
      if (c.verdict.kind !== 'moved') continue;
      const { to, toEnd } = c.verdict;
      const line = lines[c.specLine - 1] ?? '';
      if (line.slice(c.column, c.column + c.raw.length) !== c.raw) continue;
      const replacement = `${c.path}:${to}${c.to !== undefined ? `-${toEnd}` : ''}`;
      lines[c.specLine - 1] =
        line.slice(0, c.column) +
        replacement +
        line.slice(c.column + c.raw.length);
      fixed++;
    }
    writeFileSync(abs, lines.join('\n'));
  }
  return fixed;
}
