# Mutation guards

**A test that passed once can stop guarding after a later change.** This
directory makes the check that catches that — take the fix out, watch the
test fail — repeatable and enforced, instead of something done once by hand
and then trusted.

It exists because it happened. FILM-1610's double-click test kept passing
after the in-flight guard it was written for was removed: Playwright lets the
page re-render between two clicks, so a disabled button stopped the second
one and the guard itself was never exercised. The test was green, and
guarding nothing. Only re-running every red check against the final code
found it.

## Running

```bash
python3 tooling/mutation-guards/run.py --self-test   # the runner's own red check
python3 tooling/mutation-guards/run.py --kind unit   # CI: Unit Tests job
python3 tooling/mutation-guards/run.py --kind pgtap  # CI: Supabase DB job (needs supabase start)
python3 tooling/mutation-guards/run.py --kind e2e    # by hand (see below)
python3 tooling/mutation-guards/run.py --only "R6 list unpaged"   # one entry, by its whole name
```

`--only` matches a whole entry name exactly, and a value that names no entry
stops the run before anything executes, listing names that contain it. It used
to match any name *containing* the value, so `--only "U1"` ran five guards from
four features, one of them an E2E guard that seeds the shared database.

`--kind e2e` needs a dev server that reads the local ClickHouse, because the
evidence entries measure real figures:

```bash
./scripts/local-env.sh up
set -a; . deployment/config/local.env; set +a
cd apps/web && npx next dev --turbo -p 3100
```

In CI, E2E entries run in the `🧬 E2E guards & evidence` job, which runs a
dev server (a production build cannot recompile after a mutation) against a
real ClickHouse, next to the happy-flow evidence specs. It runs as parallel
shards (`--shard 1/5` … `5/5`): the E2E guards together outgrew a 45-minute
job.

A shard is chosen by measured duration, not position: longest first, each
entry goes to the shard with the least time so far, using the median seconds
in `e2e-durations.tsv` (an unmeasured entry counts as the median). Position
round-robin put 36 minutes on one shard and 16 on another in the same run,
and the long ones hit the job timeout (#519, #521). Each guard's line ends
with its seconds; refresh the file from recent green queue runs with
`python3 tooling/mutation-guards/durations.py <run-id>…`.

## What each outcome means

| Outcome | Meaning | What to do |
|---|---|---|
| `RED` | The test failed with its fix removed. It guards. | Nothing |
| `STAYED GREEN` | The test passed with its fix removed. | The test no longer checks what it claims. Fix the test |
| `MISSING` | The mutation's target text is not in the file. | The code moved. Update `find` to the new code — deliberately a failure, so a refactor cannot quietly orphan a guard |
| `NOT GREEN` | The test fails even on the real code — or, for an E2E guard, every test it selects skipped, so it could never fail. An E2E baseline whose every failed attempt is a navigation timeout (`page.goto`, `page.waitForURL`, … `Timeout Nms exceeded`) is first re-run once, after 30 seconds, and its line says `[baseline retried after a navigation timeout]`; it is `NOT GREEN` only if the re-run fails too. Any other failure is not re-run. | Fix the test first; a failure under mutation would prove nothing. For a skip, give the run what the skip asks for (K11 needed `ENCRYPTION_KEY`) |
| `TIMED OUT` | The guard never finished, on the real code or the mutated one. Either Playwright ended it at its `--global-timeout` (10 minutes, or the entry's `timeout`), or its command ran 90 seconds past that and was killed with every process it started (a unit or pgTAP command: 15 minutes, `GUARD_TIMEOUT`). The 90 seconds are there because Playwright's own runner can freeze too: on #521 KB-95 ran to a flat 15 minutes with a 150-second budget. It proved nothing either way, and is never counted as `RED`. The run goes on to the next entry, so a shard still reports every guard (KB-165). | Read the output printed under it: it is the test's own report up to the hang. A Playwright test has a 2-minute timeout, and that runs inside the worker, so a run this long means the worker itself stopped answering |
| `AMBIGUOUS` | A `find` matches more than once in its file (counted after the entry's earlier edits), or an edit names a `file` other than the entry's. Checked before any test runs, and for every entry by `--self-test`. | Extend `find` with surrounding lines until it names one place. The runner used to mutate the first match, which after a rebase can be another copy of the line (#350) |

Any outcome but `RED` fails the run, with one exception. An E2E entry may
carry `"known_flake": "KB-<n>"`, naming the known bug that makes it hang at
random. Its `TIMED OUT` is then printed but not counted. Its other outcomes
still fail the run. Give such an entry a short `"timeout"` (seconds, for
Playwright's `--global-timeout`) so the hang costs minutes, not the shard.
`KB-95 E1` is the first (KB-165). Remove the mark when the KB is fixed.

## Adding an entry

Every fix that has a regression test gets an entry, **in the same commit as
the fix**, so its red check is recorded rather than remembered. Entries live
in one JSON file per feature (`film-1610.json`):

```jsonc
// Code mutation, checked by a unit test
{
  "name": "R6 list unpaged",
  "kind": "unit",
  "file": "packages/features/content-analytics/src/server/experiment-actions.ts",
  "find": ".range(from, to);\n    }, 'experiments');",
  "replace": ".range(0, 999);\n    }, 'experiments');",
  "cwd": "packages/features/content-analytics",
  "test": "__tests__/experiment-list-paging.test.ts"
}

// Database mutation: SQL run inside the pgTAP file's own transaction
{
  "name": "DB R5 freeze trigger dropped",
  "kind": "pgtap",
  "test": "apps/web/supabase/tests/database/experiments-integrity.test.sql",
  "sql": "drop trigger analytics_experiments_freeze_started on public.analytics_experiments;"
}
```

Optional fields: `pattern` (vitest `-t`) for unit entries; `spec`, `grep` and
`env` for e2e entries; `edits` (a list of `{find, replace}`) when one
mutation needs several changes applied together.

A good mutation is the **smallest plausible regression** — the line someone
might reasonably delete, not a sabotage. Reverting a whole function proves
less than removing the one condition the test was written for.

## Prefer a unit entry when the mutation is a server module

An `e2e` entry mutates a file under a **running** dev server and hopes it
recompiles before the spec runs — `run.py` waits four seconds, which is a
sleep, not synchronisation. The entries that work this way reliably are the
ones whose mutation shows up in the browser: a client component, a form, the
middleware.

A server module is where it stops being reliable, and the failure is the
expensive kind: the guard passes.

Measured on FILM-1615's S0e, which mutated `scope-access.ts` — the tenant
check — and drove the leak through the analytics page:

- It went **red every time locally** (5 runs), and **never once in CI**.
- Two CI runs reported `STAYED GREEN`: the guard said the fix was
  unnecessary while the fix was removed.
- A third reported `NOT GREEN`, failing on the *real* code, at a sign-in
  that exceeded a 60-second navigation timeout.

That last one names the cause. All of a shard's e2e guards share one dev
server, and every mutation makes it recompile; the guard that runs seventh
is driving a server that six mutation cycles have already worn down. Which
reads the page issues, and whether they finish, then varies by machine —
and a guard whose subject varies by machine is not a guard.

So: **if the line being mutated lives on the server, guard it with a unit
entry.** S0e's check is covered by `S0`/`S0b` on `assertProjectAccess` and
`S0d`/`S0f` on the dashboard reads, all four deterministic and red, and the
end-to-end behaviour is still asserted on every pull request by
`tenant-isolation-evidence.spec.ts` in the evidence step. What was lost by
dropping the e2e entry is the proof that *removing* the fix is caught
end-to-end; what was gained is a guard set that means what it says.

## A guard cannot prove a race

`--retries=2` on both runs, and a mutation counts as caught only if **every**
attempt fails. That rule is what keeps one flaky failure from being read as
detection, and it also means a defect that only appears *sometimes* cannot
have an e2e guard.

FILM-1615's note editor is the example. Reopening a popover quickly enough
reuses the same component instance, which still holds the note version it
first opened with, so the next save is refused as someone else's edit. Under
its mutation in CI the first attempt failed with exactly that — the cell
still reading the old note — and the retry passed, because the retry was
slow enough for the popover to have unmounted. Caught once, then not, so the
runner reported STAYED GREEN.

The spec stays: it found the bug, and it passes reliably on the fixed code.
The guard entry does not, because "removing this fix is caught" is not a
claim this runner can make about a race.
