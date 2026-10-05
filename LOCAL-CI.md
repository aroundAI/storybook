# Local CI and the merge train

> **Since 2026-10-01 GitHub's merge queue is the gate**, not this. A PR run is
> the fast lane; the full suite runs once in the queue, on main + the PR, and
> ✅ CI result is the one required check (CLAUDE.md, "The merge queue is the
> gate"). Use what follows only when Actions cannot run. It mirrors the jobs,
> not the triggers: a local run is the full suite, as the queue's is.

How to verify and merge pull requests **without GitHub Actions**. First used
2026-09-24/25, when the org hit its 50,000-minute limit: twelve PRs
(#338–#352, #354) were verified with these scripts and merged in one day.

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
| 📋 PR records (its own workflow, `pr-records.yml`) | `pnpm -s prs:records --pr <n>`: title, records, labels |
| 🧪 Unit Tests | classifier table tests, `scripts/test-units.sh`, guard self-test, coverage |
| 🧪 Unit guards (6 shards) | the 6 shards, 2 at a time, each on a copy-on-write clone (`cp -cR`) of the worktree |
| 🐘 Supabase DB | schema drift, start-script test, `supabase db reset` from the PR's tree, types-current, the two PostgREST verifiers, pgTAP, database mutation guards |
| 🗄️ ClickHouse SQL | migrate and verify against the local ClickHouse |
| ⚫️ Test | `build:test`, `next start -p 3000`, `supabase:test`, Playwright (see Gotchas for `CI=1`) |
| 🧬 E2E evidence | a second `build:test` with ClickHouse on, the KB-58 action-manifest guard, the evidence specs |

Not run: 🧬 E2E guards (the merge queue only) and 📚 Docs checks (CI runs
them only instead of the heavy jobs).

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
| `pipeline.sh <pr>…` | Full run for each PR, one at a time: `static.sh`, then `services.sh`, then `report.sh`. Checks the PR's worktree is clean and at the PR's head first, creating it at `.local-ci/worktrees/pr-<n>` when there is none. Stops if Docker goes down. |
| `static.sh <pr> <worktree> <out>` | The jobs that need no shared service. |
| `services.sh <pr> <worktree> <out>` | The jobs on the shared Supabase, ClickHouse and port 3000. Holds the database lock while it runs. |
| `report.sh <pr> <worktree> <out> [note]` | Writes `report.md`: the commit tested, the `main` it's based on, and one row per step. This is the PR comment. |
| `rebase-pr.sh <pr>` | Rebases the PR onto `origin/main`, resolving conflicts in `specs/INDEX.md`, known-bugs registers, and spec citations. Stops on any code conflict. |
| `reverify.sh <pr>` | After a green full run: rebases, then re-checks. If the PR's own code patch is unchanged (same `git patch-id`, the rule in `scripts/ci/code-patch-unchanged.sh`), it runs only the **📚 Docs checks** set, as CI does since #353. Otherwise it runs the full suite, and a green full run becomes the PR's baseline (`runs/<pr>/report.md`; the previous one is kept as `report.<sha>.md`). Pushes with a lease and posts the report. |
| `train.sh <pr>…` | The merge train (see The process, step 3). For each PR in order: wait for its full report, stop if it isn't green, re-verify on the current `main`, then `gh pr merge --squash --match-head-commit <verified sha>`. Stops and waits for a human on any failure. |
| `stop.sh <pr> [--keep-run]` | Stops a run and everything it started, children first and the parent last, then deletes `runs/<pr>`. Use it instead of `pkill -f pipeline.sh`, which ends the parent and leaves the guard runners, tests and servers running against the shared database (that ruined three runs of #486). Exits non-zero, naming what is left, if anything ignores it. `scripts/ci/local-ci-stop.test.sh` proves it ends a three-level tree. |
| `status.sh` | One-screen summary: runs, each lane's lock holder and queue length, the train's last line. |
| `dblock.sh acquire\|release <name>` | FIFO lock on one lane's database, ClickHouse and web port (`LANE=B` for lane B). Anything that resets or reads the local DB takes it, teammates included. Local CI for a PR (`localci-*`) goes to the front of the queue. |
| `lane.sh` | Sourced by every script: the lane's ports, lock and hosts. |
| `lane-b.sh up\|down\|status` | Starts, stops or reports lane B's stack. |
| `ch-reset.sh` | Recreates the lane's ClickHouse container empty and applies the migrations. `services.sh` runs it at the start of the 🗄️ ClickHouse SQL step so every PR verifies on a fresh server, as CI does: `@kit/clickhouse verify` asserts over live rows (no `watch_time` for a platform without one, every live platform/content-type pair mapped), and a lane that days of Playwright and seed runs wrote into fails those on leftovers, not on the PR (2026-10-05, #629: 49,704 leftover rows, 3 red). Lane-aware (`LANE=B`); takes the lane's db lock when run by hand. |
| `webhooks-to.sh <port>` | Points the database webhooks (invitation, account teardown, subscription delete) at `<port>` on the current lane. `seed.sql` points them at :3000, so `services.sh` runs it on lane B after the reset; run it yourself after any reset on lane B, or with your own server on another port. |
| `remerge-index.py` | The `INDEX.md` re-merge `rebase-pr.sh` uses: a single checked 3-way merge. Count cells get the PR's change added on top of main's number, not one side's value, and `rebase-pr.sh` then recounts them from the files, which corrects the arithmetic if it was wrong. |

## Lanes: two PRs at once

One full run holds the database and the web port for about 20 minutes, so one
stack verifies about two PRs an hour. A second stack doubles that.

| | Lane A (default) | Lane B |
|---|---|---|
| Supabase | project `storybook`, 55321–55327 | project `storybook-b`, 55420–55429 |
| ClickHouse | `storybook-clickhouse`, 8123 | `storybook-clickhouse-b`, 18123 (capped at 2 GB; diagnostic logs off, `clickhouse-b.xml`, so it idles near 300 MB, not 1.7 GB — a container made before this file needs `docker rm -f storybook-clickhouse-b && scripts/local-ci/lane-b.sh up` once) |
| Web app | :3000 | :3001 |
| Lock | `.local-ci/db.lock`, `lockq/` | `.local-ci/db-b.lock`, `lockq-b/` |
| Started by | `./scripts/local-env.sh up` | `scripts/local-ci/lane-b.sh up` |

```bash
scripts/local-ci/lane-b.sh up            # once; about a minute
scripts/local-ci/pipeline.sh 351         # lane A
LANE=B scripts/local-ci/pipeline.sh 352  # lane B, at the same time
```

- **Lane B is environment only.** The Supabase CLI reads `SUPABASE_<SECTION>_<KEY>`
  over `config.toml` (`SUPABASE_PROJECT_ID`, `SUPABASE_API_PORT`,
  `SUPABASE_LOCAL_SMTP_PORT`, …), so lane B runs each PR's own
  `apps/web/supabase` (migrations, seeds, and the pgTAP files the guards mutate
  in place) and leaves its worktree clean. The app's `NEXT_PUBLIC_*` hosts are
  baked in at build, so lane B builds with its own; the E2E suite reads
  `E2E_SUPABASE_URL`, `MAILBOX_URL`, `CLICKHOUSE_HOST` and `PLAYWRIGHT_BASE_URL`.
  `local.env` holds lane A's hosts, so lane B re-applies its own after loading it.
- **Lane A is unchanged.** It exports nothing, and every command it runs is
  byte-identical to the commands before lanes existed.
- **Both stacks use the same demo JWT secret**, so the anon and service-role
  keys in `.env.test` are valid for both (checked, not assumed).
- **Static stages run one at a time across both lanes** (`.local-ci/static.lock`,
  taken by `pipeline.sh`); only service stages overlap. Running both lanes'
  static stages next to an E2E suite starved the Mac: tests timed out on
  unchanged code (Vitest worker RPC, a 5s test timeout).
- **Memory:** lane B's stack takes about 1.7 GB. Run lane B only when Docker
  has room for it beside lane A. `lane-b.sh status` shows the figure.
- **Teammates stay on lane A** unless told otherwise: `LANE=B` on a teammate's
  `dblock.sh` would take lane B's lock, not lane A's.

## The process

1. **Full run.** `scripts/local-ci/pipeline.sh 351 352`. When it's green, post
   the report on the PR: `gh pr comment <pr> --body-file .local-ci/runs/<pr>/report.md`.
2. **Fix red runs.** Read the log before blaming the PR. Compare against
   `main`: build `main` in a scratch worktree and run the same spec. Several
   failures this wave were flakes already on `main`, or bugs in the local setup.
3. **Merge.** `scripts/local-ci/train.sh <pr>…`, in merge order. The train
   merges only the exact commit it verified, on the `main` it verified against.
4. **Rebase one PR at a time, just before merging.** Each merge conflicts every
   other open PR on the shared records (`specs/INDEX.md`, known-bugs files,
   cited spec code), so rebasing all up front gets discarded. `rebase-pr.sh`
   resolves these conflicts, updates index counts, and re-points citations.

## Rules

- **Red before green** still applies: a guard added this way must be seen
  failing without its fix.
- **One train at a time.** Two trains can merge a PR under another's re-check.
- **Never push speculatively.** Every push starts CI, and CI minutes cost money.

## Gotchas (each one cost hours the first time)

- **`supabase db reset` sometimes races its own setup:** `LegacyDbSetupError:
  error running container: exit 1`, with `FATAL: role "postgres" does not
  exist` in the db log, and every later stage fails. `db-reset.sh` retries
  that error once (twice in ~60 resets on 2026-09-29); any other failure
  still fails at once.

- **A stacked PR whose parent merged: retarget first, then push.** `gh pr edit
  <n> --base main`, *then* push the rebase. Pushed while the PR still targets
  the merged parent's branch, the push starts no `pull_request` runs (GitHub
  skips a PR it can't merge into its base), and the base change is an
  `edited` event only `pr-records.yml` (#477) listens to, so the PR shows one check
  (#477). If it happens, `gh pr close <n> && gh pr reopen <n>` fires every
  workflow.

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
  runner refuses a `find` text that matches more than once (`AMBIGUOUS`),
  because a rebase can add an earlier copy of the same line; `--self-test`
  checks every entry for it.
- **Docker sometimes fails to remove pg_prove's container** after the tests
  pass. `tooling/mutation-guards/run.py` reads pg_prove's own `Result:` line (#350).
- **Citations drift** (KB-81, #349): after a rebase that moves cited code, run
  `pnpm specs:citations --fix`. Citations whose code changed need a person to
  re-read the code.
- **Migrations must sort after `main`'s.** Deploys run `supabase db push`
  without `--include-all`, which refuses a pending migration older than the
  last one applied. Rename a PR's migration after rebasing if it now sorts earlier.

## When Actions is back

1. Re-add the required status check on `main`: ✅ CI result, and only that.
   Not 📋 PR records: it never runs in the merge queue, so the queue would
   wait for it forever.
2. Remove the $0 Actions budget.
3. **Run the full suite once on `main`** (Actions → Workflow → Run workflow)
   before any new work. It's the audit
   for what was merged locally: PRs merged on a re-check never ran the full
   suite on the final `main`. Each PR's comment says what it was tested against.
