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
python3 tooling/mutation-guards/run.py --only "R6"   # one entry by name
```

`--kind e2e` needs a dev server that reads the local ClickHouse, because the
evidence entries measure real figures:

```bash
./scripts/local-env.sh up
set -a; . deployment/config/local.env; set +a
cd apps/web && npx next dev --turbo -p 3100
```

In CI, E2E entries run in the `🧬 E2E guards & evidence` job, which runs a
dev server (a production build cannot recompile after a mutation) against a
real ClickHouse, next to the happy-flow evidence specs. It runs as three
parallel shards (`--shard 1/3` … `3/3`): the E2E guards together outgrew a
45-minute job.

## What each outcome means

| Outcome | Meaning | What to do |
|---|---|---|
| `RED` | The test failed with its fix removed. It guards. | Nothing |
| `STAYED GREEN` | The test passed with its fix removed. | The test no longer checks what it claims. Fix the test |
| `MISSING` | The mutation's target text is not in the file. | The code moved. Update `find` to the new code — deliberately a failure, so a refactor cannot quietly orphan a guard |
| `NOT GREEN` | The test fails even on the real code. | Fix the test first; a failure under mutation would prove nothing |

Any outcome but `RED` fails the run.

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
