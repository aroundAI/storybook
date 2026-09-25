# Known Bugs — Found, Not Yet Fixed

The known-bugs register (spec id **FILM-CC-04**). It has one file per bug, so a
PR that files or fixes one touches only that bug's file.

Bugs found while reviewing other work, recorded so they are not lost and
not rediscovered. **None is blocking today**; each says who it affects and
how it was confirmed.

Every entry here was **reproduced**, not inferred. Where an earlier
statement turned out wrong on testing, the entry says so.

## Reading it

```bash
pnpm specs:known-bugs          # the Open and Fixed tables
pnpm specs:known-bugs --open   # only what is open (partial fixes included)
pnpm specs:known-bugs --ids    # ids per status, one line each
```

The tables are printed from each file's front matter. They are never
committed, so there is no shared table to conflict on.

| Path | What |
|---|---|
| `KB-<n>.md` | One entry: front matter, then the entry as written |
| `_pre-numbering.md` | Fixes from before entries had numbers. Frozen |
| `leads/<date>-<source>.md` | Leads: possible bugs read in the code, not reproduced |

## An entry

```markdown
---
id: KB-99
title: "What the user sees go wrong, in one line"
status: open            # open | partial | fixed
fixed_in: []            # the PRs, e.g. ["#360"]; a spec id if no PR, e.g. ["FILM-1615 Step 0"]
severity: Medium        # High | Medium | Low | unrated
found: 2026-09-25       # the date the entry reached main
---

## KB-99 — What the user sees go wrong, in one line

**Severity:** Medium — who it affects and how badly. **Found:** what
you were doing (FILM-/KB-/PR).

What happens, how it was reproduced, the proposed fix, and the acceptance
criteria, as the existing entries do.
```

**Filing one.**
- Take the next number. In a fleet run, the lead hands them out
  (`claim-kb.sh`). Otherwise use the next number above the highest file here.
- Two PRs that pick the same number meet as a git add/add conflict on
  `KB-<n>.md`. Renumber the later one.
- Reproduce it before you write it down. What was only read belongs in
  `leads/`.

**Fixing one.**
- Set `status: fixed` and `fixed_in: ["#<PR>"]`.
- Add `fixed_summary: "…"`: one past-tense line saying what was wrong. It is
  the row `pnpm specs:known-bugs` prints.
- Open the entry with a banner, `> **Fixed (<date>), #<PR>.** …`, saying what
  the fix did and what it found.

  If only part is fixed, use `status: partial` and say "in part" in the
  banner. Every PR that fixed part of it goes in `fixed_in`, and its
  summaries in `fixed_summary`, joined with `; `. Then `closed_by` pointers
  to the KB stay valid (below).
- When you fix a KB, reconcile the specs that wait on it:
  `git grep 'closed_by: .*KB-<n>\b' specs`.

**What is checked** (`packages/shared/__tests__/known-bugs-register.test.ts`):
- the front matter's keys and values;
- `id` matches the file name, and no id is used twice;
- the entry's first line is `## <id> — <title>`;
- `fixed` or `partial` needs `fixed_in`, and `open` has none;
- `fixed_in` needs `fixed_summary`;
- a banner that says **Fixed** (not "in part") needs `status: fixed`;
- `severity` matches the entry's `**Severity:**` (`unrated` when it gives
  none).

KB-80 (`spec-closed-by-drift.test.ts`) fails any spec item still waiting,
through `closed_by`, on a KB whose `status` is `fixed`.

## Leads

**Leads are not entries.** An entry is reproduced before it is written down.
A lead was seen in the code and has **not** been run.

Each source of leads gets its own file, `leads/<date>-<source>.md` (an audit,
or a KB whose work turned them up). When one is worked:
- reproduce it first and file it as a KB entry, or strike it with what proved
  it wrong;
- then edit its line in place (`~~…~~ **Reproduced: KB-<n>**`).

## History

Until 2026-09-25 the register was one file,
`specs/cross-cutting/FILM-CC-04-known-bugs.md`. Every PR appended to the
same two places in it (the end of the entries, and the Fixed table), so
concurrent PRs always conflicted. It was split mechanically by
`scripts/specs/split-known-bugs.ts`:
- each entry's text is unchanged;
- the Fixed table became the front matter;
- the leads section became `leads/`.

Its history is in `git log -- specs/cross-cutting/FILM-CC-04-known-bugs.md`.
A PR still editing the old file is ported with
`pnpm exec tsx scripts/specs/split-known-bugs.ts --port <its head>`.
