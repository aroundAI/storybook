# Local CI and the merge train

How to verify and merge pull requests **without GitHub Actions**: when the
Actions minutes run out, when Actions is down, or when a run would cost money
you don't want to spend. First used 2026-09-24/25, when the org hit its
50,000-minute limit: twelve PRs (#338–#352, #354) were verified with these
scripts and merged in one day.

The scripts are in [`scripts/local-ci/`](scripts/local-ci/). Their working
state (runs, logs, the lock, the train log) is written to `.local-ci/` in the
main checkout, which git ignores.

## When to use it

- **Actions minutes are exhausted, or a run would be billed.** Set an Actions
  budget of **$0 with "stop usage"** (Billing → Budgets and alerts) so a push
  can't cost anything, and turn off the required status checks on `main`
  (Settings → Branches) for the duration. Branch protection pins the checks
  to the GitHub Actions app, so a local result can't satisfy them.
- **Actions is down.**

Otherwise use CI. The local mirror is slower, and it tests on one machine.

## What it runs

Every job `.github/workflows/workflow.yml` runs on a pull request, with the
same commands:

| CI job | Local |
|---|---|
| ʦ TypeScript | `pnpm run typecheck`, `pnpm run lint` |
| 💅 Format | `pnpm turbo format --force --continue -- …` (check only) |
| 🧪 Unit Tests | classifier table tests, `scripts/test-units.sh`, guard self-test, coverage |
| 🧪 Unit guards (4 shards) | the 4 shards, 2 at a time, each on a copy-on-write clone (`cp -cR`) of the worktree |
| 🐘 Supabase DB | schema drift, start-script test, `supabase db reset` from the PR's tree, types-current, the two PostgREST verifiers, pgTAP, database mutation guards |
| 🗄️ ClickHouse SQL | migrate and verify against the local ClickHouse |
| ⚫️ Test | `build:test`, `next start -p 3000`, `supabase:test`, Playwright with **`CI=1`** (1 worker, 3 retries) |
| 🧬 E2E evidence | a second `build:test` with ClickHouse on, the KB-58 action-manifest guard, the evidence specs |

Not run, as on a PR in CI: 🧬 E2E guards (push to `main` only) and 📚 Docs
checks (CI runs them only instead of the heavy jobs).

One full run takes **about 20 minutes** per PR. Most of it is the Playwright
suite (~11 min at one worker) and the guards (~5 min).

## Prerequisites

- Docker running, and the local stack up: `./scripts/local-env.sh up`
  (Supabase and ClickHouse 24.8, as CI).
- Port **3000 free**: the E2E jobs serve the production build there, as CI does.
- `gh` authenticated. Push over SSH if the token lacks the `workflow` scope.
- The Mac must not sleep during a run: run `caffeinate -dims` in a terminal.

## The scripts

| Script | What it does |
|---|---|
| `pipeline.sh <pr>…` | Full run for each PR, one at a time: `static.sh`, then `services.sh`, then `report.sh`. Checks the PR's worktree is clean and at the PR's head first. Stops if Docker goes down. |
| `static.sh <pr> <worktree> <out>` | The jobs that need no shared service. |
| `services.sh <pr> <worktree> <out>` | The jobs on the shared Supabase, ClickHouse and port 3000. Holds the database lock while it runs. |
| `report.sh <pr> <worktree> <out> [note]` | Writes `report.md`: the commit tested, the `main` it's based on, and one row per step. This is the PR comment. |
| `rebase-pr.sh <pr>` | Rebases the PR onto `origin/main`. Resolves conflicts in the shared records (`FILM-CC-04-known-bugs.md`, `specs/INDEX.md`) by re-merging the PR's own changes onto main's. Re-points moved spec citations when `pnpm specs:citations` exists. Stops on any code conflict. |
| `reverify.sh <pr>` | After a green full run: rebases, then re-checks. If the PR's own code patch is unchanged (same `git patch-id`, the rule in `scripts/ci/code-patch-unchanged.sh`), it runs only the **📚 Docs checks** set, as CI does since #353. Otherwise it runs the full suite. Pushes with a lease and posts the report. |
| `train.sh <pr>…` | The merge train. For each PR in order: wait for its full report, stop if it isn't green, re-verify on the current `main`, then `gh pr merge --squash --match-head-commit <verified sha>`. Stops and waits for a human on any failure. |
| `status.sh` | One-screen summary: runs, the lock holder, the train's last line. |
| `dblock.sh acquire\|release <name>` | FIFO lock on the shared database, ClickHouse and port 3000. Anything that resets or reads the local DB takes it, teammates included. |
| `remerge-known-bugs.sh`, `remerge-index.py` | The record re-merges `rebase-pr.sh` uses. Both are a single checked 3-way merge. In `INDEX.md`, count cells get the PR's change added on top of main's number, not one side's value. |

## The process

1. **Full run.** `scripts/local-ci/pipeline.sh 351 352`. When it's green, post
   the report on the PR: `gh pr comment <pr> --body-file .local-ci/runs/<pr>/report.md`.
2. **Fix red runs.** Read the log before blaming the PR. Compare against
   `main`: build `main` in a scratch worktree and run the same spec. Several
   failures this wave were flakes already on `main`, or bugs in the local setup.
3. **Merge.** `scripts/local-ci/train.sh <pr>…`, in merge order. The train
   merges only the exact commit it verified, on the `main` it verified against.
4. **Rebase just before merging, one PR at a time.** Each merge conflicts
   every other open PR on the shared records, so rebasing them all up front
   gets thrown away.

## Rules

- **Red before green** still applies: a guard added this way must be seen
  failing without its fix.
- **One train at a time.** Two trains can merge a PR under another's re-check.
- **Never push speculatively.** Every push starts CI, and CI minutes cost money.

## Gotchas (each one cost hours the first time)

- **Kill only the listener on port 3000:** `lsof -ti tcp:3000 -sTCP:LISTEN`.
  Without `-sTCP:LISTEN` it also kills Docker Desktop's backend, which proxies
  container traffic on that port. Docker then shuts down cleanly, and it looks
  like a crash.
- **Playwright locally needs `CI=1`.** Without it Playwright uses about 7
  workers, which makes flakes fail where CI's 1 worker and 3 retries hide them.
- **Use the pinned Supabase CLI.** Homebrew's (2.98) is older than the one
  pinned in `apps/web/package.json` (2.117) and generates different types.
  `lib.sh` puts `apps/web/node_modules/.bin` first on `PATH`.
- **zsh doesn't word-split `$var`.** Loop over file lists with `while read`.
- **The guards mutate files in place,** so each shard needs its own tree. The
  runner mutates the first match of its `find` text, so after a rebase a guard
  can hit an earlier copy of the same line: keep `find` texts unique.
- **Docker sometimes fails to remove pg_prove's container** after the tests
  pass. `tooling/mutation-guards/run.py` reads pg_prove's own `Result:` line (#350).
- **Citations drift** (KB-81, #349): after a rebase that moves cited code, run
  `pnpm specs:citations --fix`. Citations whose code changed need a person to
  re-read the code.
- **Migrations must sort after `main`'s.** Deploys run `supabase db push`
  without `--include-all`, which refuses a pending migration older than the
  last one applied. Rename a PR's migration after rebasing if it now sorts earlier.

## When Actions is back

1. Re-add the required status checks on `main`.
2. Remove the $0 Actions budget.
3. **Run the full suite once on `main`** before any new work. It's the audit
   for what was merged locally: PRs merged on a re-check never ran the full
   suite on the final `main`. Each PR's comment says what it was tested against.
