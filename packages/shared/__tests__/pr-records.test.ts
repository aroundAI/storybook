import { describe, expect, it } from 'vitest';

import {
  type Commit,
  type PullRequest,
  type Records,
  commitProblems,
  expectedLabels,
  parseTitle,
  prProblems,
} from './pr-records/records';

const SPEC =
  'specs/phase-18-local-vendor-sandbox/FILM-1802-social-platform-sandbox.yaml';

const records: Records = {
  specFile: (id) => (id === 'FILM-1802' ? SPEC : undefined),
  specText: () => 'reason: "Meta publishing done (#468)"',
  kbFixedIn: (id) => ({ 'KB-138': ['#454', '#475'], 'KB-114': ['#418'] })[id],
  specArea: () => 'area: vendor-sandbox',
  kbStatus: (id) =>
    ({ 'KB-138': 'fixed', 'KB-114': 'fixed', 'KB-59': 'open' })[id],
};

const pr = (over: Partial<PullRequest>): PullRequest => ({
  number: 473,
  title: 'feat(FILM-1802): the sandbox serves a Video permalink',
  files: [],
  labels: ['type: feat', 'spec', 'area: vendor-sandbox'],
  ...over,
});

describe('parseTitle', () => {
  it('reads the type and the ids in the scope, not the ones mentioned after it', () => {
    expect(
      parseTitle('fix(KB-111): a figure is null, not 0 (KB-114 filed)'),
    ).toMatchObject({
      type: 'fix',
      ids: ['KB-111'],
    });
    expect(parseTitle('feat(FILM-1805, KB-21): base URLs')).toMatchObject({
      type: 'feat',
      ids: ['FILM-1805', 'KB-21'],
    });
    expect(parseTitle('chore: tidy')).toMatchObject({ type: 'chore', ids: [] });
  });

  it('refuses a title without a type', () => {
    expect(parseTitle('Plan Document')).toBeUndefined();
    expect(
      parseTitle('Local CI: pipeline.sh creates worktrees'),
    ).toBeUndefined();
  });
});

describe('prProblems', () => {
  // The gap the 2026-09-29 audit found: #473 merged, FILM-1802 still said
  // "not served", and nothing noticed.
  it('flags a feat that names a spec it neither updates nor cites', () => {
    expect(prProblems(pr({}), records)).toEqual([
      `FILM-1802: ${SPEC} is not updated by this PR and never cites #473`,
    ]);
  });

  it('passes when the PR changes the spec, or the spec cites it', () => {
    expect(prProblems(pr({ files: [SPEC] }), records)).toEqual([]);
    expect(prProblems(pr({ number: 468 }), records)).toEqual([]);
  });

  it('flags a KB fix missing from fixed_in, and passes a listed one', () => {
    expect(
      prProblems(
        pr({
          number: 999,
          title: 'fix(KB-138): x',
          labels: ['type: fix', 'known-bug'],
        }),
        records,
      ),
    ).toEqual(["KB-138's fixed_in does not list #999"]);
    expect(
      prProblems(
        pr({
          number: 475,
          title: 'fix(KB-138): x',
          labels: ['type: fix', 'known-bug'],
        }),
        records,
      ),
    ).toEqual([]);
  });

  it('accepts a re-land entry that names the PR', () => {
    const relanded: Records = {
      ...records,
      kbFixedIn: () => ['#264 (round 4)', '#303 (re-land of #299)'],
    };
    expect(
      prProblems(
        pr({
          number: 299,
          title: 'fix(KB-6): x',
          labels: ['type: fix', 'known-bug'],
        }),
        relanded,
      ),
    ).toEqual([]);
    expect(
      prProblems(
        pr({
          number: 29,
          title: 'fix(KB-6): x',
          labels: ['type: fix', 'known-bug'],
        }),
        relanded,
      ),
    ).toEqual(["KB-6's fixed_in does not list #29"]);
  });

  it('owes no record for test, docs or chore, but the ids must still resolve', () => {
    expect(
      prProblems(
        pr({
          title: 'test(FILM-1802): steadier',
          labels: ['type: test', 'spec', 'area: vendor-sandbox'],
        }),
        records,
      ),
    ).toEqual([]);
    expect(
      prProblems(
        pr({ title: 'docs(KB-9999): x', labels: ['type: docs', 'known-bug'] }),
        records,
      ),
    ).toEqual(['KB-9999 names no file in specs/known-bugs/']);
  });

  it('flags a bad title and missing labels', () => {
    expect(prProblems(pr({ title: 'Plan Document' }), records)[0]).toMatch(
      /title is not `type\(IDS\): summary`/,
    );
    expect(prProblems(pr({ files: [SPEC], labels: [] }), records)).toEqual([
      'missing labels: area: vendor-sandbox, spec, type: feat',
    ]);
  });
});

describe('expectedLabels', () => {
  it('mirrors the title: type, known-bug, spec and its area', () => {
    expect(
      expectedLabels(pr({ title: 'fix(FILM-1802, KB-138): x' }), records),
    ).toEqual(['area: vendor-sandbox', 'known-bug', 'spec', 'type: fix']);
  });
});

describe('commitProblems', () => {
  const commit = (over: Partial<Commit>): Commit => ({
    sha: 'f5b0259d0000',
    authorEmails: ['shaurya@aroundai.co'],
    subject: 'fix(KB-138): a failed read says what failed',
    body: 'Why it was wrong, and what now happens.',
    ...over,
  });

  it('passes a commit by the owner with a typed subject', () => {
    expect(commitProblems(commit({}))).toEqual([]);
  });

  // Owner, 2026-09-29: committed under shaurya@aroundai.co, not Claude.
  it('flags another author and a Claude co-author trailer', () => {
    expect(
      commitProblems(
        commit({
          authorEmails: ['t@t'],
          body: 'Why.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
        }),
      ),
    ).toEqual([
      'commit f5b0259d is authored by t@t',
      'commit f5b0259d carries a Co-Authored-By Claude trailer',
    ]);
  });

  it('flags an untyped subject', () => {
    expect(commitProblems(commit({ subject: 'wip' }))).toEqual([
      "commit f5b0259d's subject is not `type(IDS): summary`",
    ]);
  });

  it('makes a PR with a bad commit fail', () => {
    expect(
      prProblems(
        pr({ files: [SPEC], commits: [commit({ authorEmails: ['t@t'] })] }),
        records,
      ),
    ).toEqual(['commit f5b0259d is authored by t@t']);
  });

  it('flags a "Generated with Claude Code" description', () => {
    expect(
      prProblems(
        pr({
          files: [SPEC],
          body: '## What\n\nx\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
        }),
        records,
      ),
    ).toEqual(['the description carries a "Generated with Claude Code" line']);
  });
});

describe('title markers', () => {
  it('reads closes, part, stacked on and re-land of; other parentheses are prose', () => {
    expect(
      parseTitle(
        'fix(KB-113, KB-125): land the fixes (re-land of #395, #400) (stacked on #421) (part B) (closes KB-113) (KB-99 filed)',
      ),
    ).toEqual({
      type: 'fix',
      ids: ['KB-113', 'KB-125'],
      closes: ['KB-113'],
      part: 'B',
      stackedOn: [421],
      relandOf: [395, 400],
    });
  });

  it('holds closes to the records: in the IDS, and the KB fixed or the spec DONE', () => {
    const at = (title: string, labels: string[]) =>
      prProblems(pr({ number: 454, title, labels, files: [SPEC] }), {
        ...records,
        kbFixedIn: () => ['#454'],
      });
    expect(
      at('fix(KB-138): x (closes KB-138)', ['type: fix', 'known-bug']),
    ).toEqual([]);
    expect(
      at('fix(KB-59): x (closes KB-59)', ['type: fix', 'known-bug']),
    ).toEqual(['closes KB-59, but its status is open']);
    expect(
      at('fix(KB-138): x (closes KB-59)', ['type: fix', 'known-bug']),
    ).toEqual(["closes KB-59, which is not in the title's (IDS)"]);
    expect(
      at('feat(FILM-1802): x (closes FILM-1802)', [
        'type: feat',
        'spec',
        'area: vendor-sandbox',
      ]),
    ).toEqual([`closes FILM-1802, but ${SPEC} says no status`]);
  });
});
