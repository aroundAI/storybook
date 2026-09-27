---
id: KB-3
title: "Flaky E2E tests under parallel load"
status: open
fixed_in: []
severity: Low
found: 2026-09-19
---

## KB-3 — Flaky E2E tests under parallel load

**Severity:** Low. **Found:** FILM-1610 reviews. Each passed 3–5 times out
of 3–5 on its own; each failed once when run alongside the rest of the
suite on one dev or production server.

| Test | Failure seen |
|---|---|
| `deep-dive.spec.ts` › YPP renders one card per active YouTube channel | assertion timeout |
| `read-failures.spec.ts` › a failed refetch keeps the channel filter | assertion timeout |
| `admin.spec.ts` › delete user flow | 10s visibility timeout (production build) |

Also observed: the first E2E run after a database reset and a fresh dev
server had 11 flaky tests while routes compiled; the same run warm had 1.
Not a code defect, but a local-run pitfall worth knowing.

**Proposed fix:** look for a fixed wait or an unscoped locator in each;
none were investigated.

### A mutation guard can stay green by accident (added 2026-09-22)

Seen on PR #290, run 35656659648, job "🧬 E2E guards (5)": the FILM-1610 guard
**"F10 due date captured at render"** reported `STAYED GREEN` — its mutation
was applied to `experiments-client.tsx` and the Playwright test still passed —
so the job failed with `4 of 5 guards went red`. #290 touches only database
migrations and pgTAP; nothing near the experiments client. The same guard had
gone red correctly on seven other PRs that day, and **re-running the failed job
on the same commit passed, 12 of 12**, with no change.

This is the worse direction for a flake. A test that fails at random costs a
re-run; a *guard* that passes at random reports that a mutation survived when
it did not — and, read the other way, means a guard's "red" elsewhere may owe
something to timing too. The likeliest cause, **not yet proven**: the `e2e`
kind mutates a source file under a running dev server and starts the test
before the recompile has landed, so the test sees the unmutated bundle.

**When this entry is worked:** make the e2e guard runner wait for the mutated
module to be served (poll the dev server for the mutated string, or a build
id change) before starting Playwright, and fail loudly — `NOT APPLIED`, not
`STAYED GREEN` — if it never appears. Then run the e2e guards ×10 and show none
flips.

### The evidence job can fail before any test runs (added 2026-09-22)

Seen on PR #300, run 35741414668, job "🧬 E2E evidence" (106791846286): the
`Supabase Server` step (`supabase start`) failed with `failed to bind host
port for 0.0.0.0:55326:172.19.0.5:1110/tcp: address already in use` —
inbucket's POP3 port, fixed in `apps/web/supabase/config.toml`. No Playwright
test had started. #300 touches no infra or port config, and the same job had
passed on every other run that day. `ubuntu-latest` is a fresh VM per job, so
whatever held the port was inside that job's own VM, and it could not be
reproduced. **Re-running the failed job on the same commit passed, 12 of 12.**

The evidence job is not a required check (branch protection names TypeScript,
Unit Tests, ClickHouse SQL, Supabase DB and Test), so this alone does not
block a merge; it does hide the screenshots a reviewer wants to see.

**When this entry is worked:** only if it recurs on the same port. Then add an
`ss -ltnp` step before `Supabase Server` to name the holder, and fix from
that — not from a guess (`supabase stop` before `start` cannot help on a
fresh VM, and a change that cannot be shown red first proves nothing).


### CI runner flakes (added 2026-09-23, filed by the lead)

Each passed on a single re-run. Re-run once, and tell the lead: CI minutes are
rationed.

- `next/font`'s Google Fonts fetch fails in the build (`loader.js:122`,
  TypeError); job 107032726972 (FILM-1504, #312).
- `supabase start` fails on the runner: Docker cannot bind host port 55324
  (inbucket), "address already in use" (KB-28, #313; E2E guards 1 and
  Supabase DB).
- Docker's "unable to remove filesystem … exit 125" during the pgTAP
  mutation-guard run reports a false NOT GREEN (KB-17, #330; job
  107161869233).
