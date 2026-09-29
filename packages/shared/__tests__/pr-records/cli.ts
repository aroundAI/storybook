/**
 * `pnpm prs:records` checks PRs against the convention in CLAUDE.md
 * ("Opening a pull request") and prints each gap, one line per problem.
 *
 *   --pr <n>          one PR, open or merged (local CI runs this)
 *   --since <date>    every PR merged on or after the date, e.g. 2026-09-22
 *   --no-labels       skip the label check
 *   --commits         check each PR's commits in an audit too (--pr always does)
 *   --apply-labels    add the labels a PR is missing, on GitHub (writes)
 *
 * Exits 1 when any PR has a problem. The changed files come from the merge
 * commit on main for a merged PR, and from `origin/main...HEAD` otherwise.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { REPO, loadKnownBugs } from '../known-bugs/register';
import {
  type PullRequest,
  type Records,
  expectedLabels,
  prProblems,
} from './records';

const AREAS: Record<string, string> = {
  'phase-1-foundation': 'foundation',
  'phase-2-assets': 'assets',
  'phase-3-episodes': 'episodes',
  'phase-4-video-generation': 'video',
  'phase-5-audio-generation': 'audio',
  'phase-6-edit-suite': 'edit-suite',
  'phase-7-publishing': 'publishing',
  'phase-8-analytics': 'analytics',
  'phase-9-integration': 'integration',
  'phase-10-canon-management': 'canon',
  'phase-11-canon-integration': 'canon',
  'phase-12-scale': 'scale',
  'phase-13-hook-optimization': 'analytics',
  'phase-14-edit-suite-v2': 'edit-suite',
  'phase-15-deep-analytics': 'analytics',
  'phase-16-workbook-parity': 'analytics',
  'phase-17-analytics-provenance': 'analytics',
  'phase-18-local-vendor-sandbox': 'vendor-sandbox',
  'cross-cutting': 'cross-cutting',
  'design-system': 'design-system',
};

function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === 'known-bugs' ? [] : specFiles(path);
    return /\.(yaml|md)$/.test(entry.name) ? [path] : [];
  });
}

const specById = new Map<string, string>();
for (const path of specFiles(join(REPO, 'specs'))) {
  const id = /^spec_id: "?([^"\n]+)"?/m.exec(readFileSync(path, 'utf8'))?.[1];
  if (id) specById.set(id, relative(REPO, path));
}
const bugs = new Map(loadKnownBugs().map((bug) => [bug.id, bug.fixedIn]));

const records: Records = {
  specFile: (id) =>
    specById.get(id) ??
    [...specById].find(([specId]) => specId.startsWith(id))?.[1],
  specText: (file) => readFileSync(join(REPO, file), 'utf8'),
  kbFixedIn: (id) => bugs.get(id),
  specArea: (file) => {
    const area = AREAS[file.split('/')[1] ?? ''];
    return area && `area: ${area}`;
  },
};

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
/** GitHub's API answers 502/504 now and then; a label run of 180 PRs met one. */
function gh(...args: string[]): string {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync('gh', args, { cwd: REPO, encoding: 'utf8' });
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? '');
      if (attempt === 3 || !/HTTP 50[234]|timeout/i.test(stderr)) throw error;
      execFileSync('sleep', [String(attempt * 5)]);
    }
  }
}

interface GhPr {
  number: number;
  title: string;
  state: string;
  baseRefName: string;
  labels: { name: string }[];
  mergeCommit: { oid: string } | null;
}
const FIELDS = 'number,title,state,baseRefName,labels,mergeCommit';

interface GhCommit {
  oid: string;
  messageHeadline: string;
  messageBody: string;
  authors: { email: string }[];
}

function changedFiles(pr: GhPr): string[] {
  const range =
    pr.state === 'MERGED' && pr.mergeCommit
      ? [`${pr.mergeCommit.oid}^`, pr.mergeCommit.oid]
      : ['origin/main...HEAD'];
  return git('diff', '--name-only', ...range)
    .split('\n')
    .filter(Boolean);
}

const argv = process.argv.slice(2);
const option = (name: string) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

const prNumber = option('--pr');
const since = option('--since');
if (!prNumber && !since) {
  console.error('usage: pnpm prs:records --pr <n> | --since <YYYY-MM-DD>');
  process.exit(2);
}

const prs: GhPr[] = prNumber
  ? [JSON.parse(gh('pr', 'view', prNumber, '--json', FIELDS))]
  : JSON.parse(
      gh(
        'pr',
        'list',
        '--state',
        'merged',
        '--search',
        `merged:>=${since}`,
        '--limit',
        '1000',
        '--json',
        FIELDS,
      ),
    );

const applyLabels = argv.includes('--apply-labels');
let failing = 0;

for (const raw of prs.sort((a, b) => a.number - b.number)) {
  const pr: PullRequest = {
    number: raw.number,
    title: raw.title,
    files: changedFiles(raw),
    labels: raw.labels.map((label) => label.name),
  };
  if (prNumber || argv.includes('--commits')) {
    const { commits, body } = JSON.parse(
      gh('pr', 'view', String(raw.number), '--json', 'commits,body'),
    ) as { commits: GhCommit[]; body: string };
    pr.body = body;
    pr.commits = commits.map((commit) => ({
      sha: commit.oid,
      authorEmails: commit.authors.map((author) => author.email),
      subject: commit.messageHeadline,
      body: commit.messageBody,
    }));
  }

  if (applyLabels) {
    const missing = expectedLabels(pr, records).filter(
      (label) => !pr.labels.includes(label),
    );
    if (missing.length) {
      gh('pr', 'edit', String(pr.number), '--add-label', missing.join(','));
      pr.labels.push(...missing);
    }
  }

  // Merged into another branch: its work reaches main through a later PR,
  // which is the one the records cite (#322 → #334). Labelled, not checked.
  if (raw.state === 'MERGED' && raw.baseRefName !== 'main') continue;

  const problems = prProblems(pr, records, {
    labels: !argv.includes('--no-labels'),
  });
  if (problems.length) {
    failing++;
    for (const problem of problems)
      console.log(`#${pr.number} ${problem}  — ${pr.title}`);
  }
}

console.log(`${prs.length} PR(s) checked; ${failing} with problems.`);
process.exit(failing ? 1 : 0);
