# Engineering workflow

How work gets verified here, and why the rules are shaped the way they are.

## Why this exists

FILM-1609 added **one revenue category** — an `S`-sized spec. By round ten it
had drawn **roughly fifty findings**, and four of those rounds contained a defect
created by the *previous* round's fix.

(Counts are as of round ten and will be out of date; they are here for scale,
not as a score. What matters is the shape, and the shape stopped changing around
round three.)

The tempting conclusion was to stop reviewing. That is switching off the
check-engine light: the reviews were working, and the thing missing was a process
that stopped generating the defects in the first place.

The defects were not random. They have six recurring shapes, and each has a cheap
check that catches it **before** review. Every rule below cites the real incident
it comes from, because a rule without a scar gets skimmed.

---

## The six failure modes

### 1. Fixing the instance instead of the class

A review reports one occurrence. The fix addresses that occurrence. The next
review finds its siblings.

> `?? 0` was removed from the card and left in the server action. One of three
> `Select`s was made controlled. The ad-share denominator was fixed on the card
> and not in `getRevenueSummaryAction` — in a hunk that had just been edited.
> Three rounds, one defect class.

**Check:** after fixing, grep for the *shape* across the repo and say in the PR
what you found. If the same rule now exists in two places, make it one function —
`payoutShare` and `parseAmountToCents` exist because the rule kept being
restated and kept diverging.

```bash
# not "where is this bug", but "where else could this bug be"
grep -rn "defaultValue={field.value}" packages apps | grep -v node_modules
```

### 2. Claiming without executing

The strongest predictor of a defect surviving a round is the words "this should
now work".

> The manual revenue form was declared fixed **twice** without ever running its
> validation. Both times it was still unsubmittable — the failure had simply
> moved to a different field. Separately, `gh --attach` was declared impossible
> from stale memory; `gh --help` would have taken four seconds.

**Check:** execute the exact path you are claiming. A form means driving the
form. A CLI capability means running `--help`. An API behaviour means calling it.
If a claim cannot be executed, say it is unverified.

**An RLS policy is the worst offender, because it reads like it can be checked
by eye and cannot.** Round 10 reported a HIGH cross-tenant hole in
`revenue_records_update`: its `WITH CHECK` names only `source`, so on paper any
member could repoint a row at another tenant. Running it refused the write —
Postgres also applies the *SELECT* policy to the row an `UPDATE` produces, and
`revenue_records_read` tests `has_account_access` on the new `account_id`, so
the hole was closed by a rule nobody had connected to it. The same reading
missed two holes that were real: `created_by` was writable on insert **and** on
update, so anyone could plant a row attributed to a colleague.

Three claims from one policy set, all confidently reasoned: one wrong, two
absent. Exercise policies with `makerkit.authenticate_as` in
`apps/web/supabase/tests/database/`, which CI runs, and widen one policy at a
time when you need to know which is doing the work.

### 3. The fix creating the next defect

Four of the first nine rounds found a bug introduced by the previous round's
fix. The
common thread: a fix removed a constraint without naming its replacement.

> `type="number"` was swapped for `type="text"` to fix a mid-edit bug — and with
> it went the browser's own numeric validation, so a pasted `1,250.00` parsed to
> `$1.00` and overwrote a real figure. Deriving the revenue window to fix a
> mismatch made the read unbounded. Fixing a date bug introduced a two-clock bug
> in the same function.

**Check:** ask what the fix *newly permits*, and guard it in the same commit. A
fix that removes a guard — a widget, a validation, a bound — names what replaces
it, in the code, not in the PR description.

**A green test can cover the feature and miss the interaction.** There is an
account-deletion spec, and it passed throughout — its user had never saved a
revenue entry, so it never reached the trigger that made deletion impossible.
Coverage of A and coverage of B is not coverage of A-meets-B, and a passing
spec in the area is exactly what stops anyone looking.

**A new guard has a blast radius; go and find it.** The `created_by` freeze was
written as "reject any UPDATE that changes this column", which is exactly the
rule that was wanted and also rejected the foreign key's own
`on delete set null` — implemented, like every referential action, as an
internal UPDATE that fires row triggers. Every user who had saved one revenue
entry became undeletable, and account deletion with them. The question that
catches this is not "is my rule right?" but **"what else writes this column,
including things I did not write?"** — foreign key actions, cascades, triggers,
and the service-role paths that skip RLS entirely.

**A deferral is a claim too.** `add constraint ... not valid` was chosen to
avoid a scan and described as leaving legacy rows alone. It postpones the
*scan*, not the *rule*: every later UPDATE of one of those rows fails, and the
one caller that updates them logs the error at warn and continues, so the data
silently stops being recorded. Read what the escape hatch actually does, then
check the callers that touch the rows you just excused.

**And ask what the fix leaves open on the paths it did not touch.** Round 10
added a `WITH CHECK` that constrained `created_by` — on one of two branches —
and then wrote "defect 2 fixed" in the migration header. The sentence was the
defect: it stopped the next reader looking. Scope a claim to what you actually
tested, or test the rest.

### 4. Comments asserting what the code does not do

> A comment claiming it prevented a 500% share sat directly above code that
> produced a 500% share. A spec said `meanCtr` was "view-weighted" over
> impression-weighted code. A `CLAUDE.md` said E2E covered a component that is
> mounted nowhere.

**Check:** a comment that claims a property owes a test asserting that property,
or it is labelled a hypothesis. Where a doc describes a list the code also has,
bind them — `REVENUE_CATEGORY_LABELS` is asserted against `RevenueCategorySchema`
so the two cannot drift.

### 4b. Changing shared test infrastructure on an unreproduced hypothesis

The longest and most expensive mistake in this PR, kept in full because it is
the easiest one to repeat.

A flake was diagnosed from a single observed failure: a sign-in helper waits a
flat 500ms before typing, so on an unhydrated page the values are wiped. The
diagnosis was plausible, the helper is used by most of the suite, and **the
failure was never reproduced**. Three fixes went out on that basis:

| Change | CI result |
|---|---|
| *(baseline — the 500ms wait)* | **2 flaky**, job passed |
| Wait for the control, assert the value stuck | **5 flaky**, job passed |
| Retry the fill; retry opening the sign-out menu | **1 hard failure**, run aborted at `--max-failures=1` |

All three were reverted. Each step was locally green and each made CI worse.

Three separate errors compounded:

1. **Acting on an unreproduced diagnosis.** A delayed-JS probe passed with the
   old code, which should have stopped the change rather than prompting a
   better-sounding one.
2. **Asserting on a transient state.** The `toHaveValue` check was *correct* —
   it detected the wipe — and converted a recoverable condition into a failed
   run. When recovery is cheap, retry; reserve assertions for what should
   never happen.
3. **Changing shared infrastructure without a baseline.** `AuthPageObject` is
   used by most specs. Its flake rate before the change was never measured, so
   "is this better?" had no answer until CI produced one.

**Check:** before touching a helper the suite depends on —

- Reproduce the failure. If you cannot, say so and stop.
- Record the current flake count. That is the only number that can tell you
  whether you helped.
- Change one thing, and read CI before changing a second.

A fixed `waitForTimeout` is a bad pattern and replacing it is worth doing. It
is worth doing *with a reproduction*, which is a different piece of work from
the ticket that happens to notice it.

### 5. Tests that cannot fail

A test written against already-fixed code has demonstrated nothing.

> A test meant to prove every colour token exists hand-copied the token list out
> of the stylesheet it was checking. A date assertion matched the day number
> against `"September 2nd, 2026"` — which contains `2`, so it passed on four
> days a month regardless.

> Round 11 then found the sharpest version of this. Round 10's suite covered
> `revenue_records`' **account** branch only, its fix covered the account
> branch only, and its migration header claimed the defect fixed outright.
> Three holes sat in the publish branch — a branch that is *deliberately more
> permissive*, which is precisely why it needed its own cases instead of an
> assumption that the account ones generalise. **A guard written against one
> branch of a policy proves nothing about the other.**
>
> Two more from the pgTAP suite in round 10, both visible only because the file
> was run red first:
>
> - **Cases sharing one row chained.** The authorship case succeeded pre-fix,
>   stripping the member's own `USING` branch, so every later case matched zero
>   rows and "passed" for a reason unrelated to what it claimed. Each case now
>   resets the row first.
> - **The file aborted a third of the way in** — `create schema` while the role
>   was `authenticated` — and reported *one failing test out of four*, which
>   reads like a nearly-passing suite. `select plan(13)` rather than
>   `no_plan()` turns a truncated run into a plan mismatch.

**Check: red before green, every guard, no exceptions.** Revert the fix, watch
the test fail *for the stated reason*, restore it. This is the single highest-
value habit in this document — it has caught a bad test every time it was used.

### 6. Not knowing what your green covers

> `@kit/content-analytics` and `@kit/clickhouse` unit tests **never ran in CI** —
> the job lists packages by name and both were missing. `__tests__` was in both
> `include` and `exclude` in a tsconfig, so those tests were never typechecked. A
> mocked ClickHouse client passed SQL that the real server rejected outright.

> And a whole directory can sit outside every green. `apps/web/supabase/schemas/`
> is read by no test, no CI job and no `db reset` — the database is built from
> `migrations/`. It is missing **33 of the database's 99 tables**, while the root
> `CLAUDE.md` called generating from it the "Recommended" workflow; a `db diff`
> against it proposes dropping those 33. Nothing was wrong with the code. The
> instructions were wrong, and no test covers instructions.

> And a red job is not automatically a defect in the change. `🐘 Supabase DB`
> failed on `supabase/setup-cli@v1` with *"Failed to resolve latest Supabase CLI
> release: rate limit exceeded"* — `version: latest` resolves through the GitHub
> API unauthenticated — and every later step *skipped*, so the job read as red
> for a commit that had nothing to do with it. Read **which step** failed before
> touching the code, and pin the versions CI installs, or the same code can be
> green and red on consecutive days.

**Check:** before citing a number, confirm CI actually runs it. And pin what CI
holds constant — it runs in UTC, so a date bug that only appears west of UTC is
invisible unless a test sets `timezoneId`. When a file tells
someone to run a command, run it once yourself.

**And know what your *local* green covers.** CI's E2E job builds and serves a
**production** bundle (`next build` → `start:test` → `playwright test`). A local
run against `pnpm dev` pays an on-demand compile at every first navigation, so
specs that chain several routes fail locally and pass in CI.

That is not hypothetical: a full local suite on a dev server produced **12
failures** against CI's **48 passed / 2 flaky** on the same commit. Five of those
were A/B'd against a reverted baseline and failed identically — the environment,
not the change.

| Running | Good for | Not a gate for |
|---|---|---|
| `pnpm dev` + `PLAYWRIGHT_BASE_URL` | The specs you are writing; fast iteration | The suite as a whole |
| `pnpm --filter web-e2e test:prod` | The suite, the way CI runs it | — |

`test:prod` exists because the first version of this section said "let CI judge
the rest", which was a worse answer than reproducing CI locally. It runs the same
three steps the job does.

So: iterate locally on your own specs, and let CI judge the rest. If you suspect
you broke a shared helper, **A/B it** — run the suspect specs with and without
your change on the same server — rather than reading a local failure count as a
verdict.

---

## What each layer can see

Choosing the wrong layer is why four rounds missed the same bug.

| Layer | Sees | Blind to |
|---|---|---|
| Unit (pure functions) | Arithmetic, rules, edge cases | The DOM, a real server, the second interaction |
| Mocked-client tests | Call shapes, branching | **SQL a real server rejects** |
| `pnpm --filter @kit/clickhouse verify` | Real SQL against real ClickHouse | Correctness beyond the fixtures |
| Evidence specs on a `local.env` server | A known ClickHouse input reaching the page as the right figure | Production data; CI (no ClickHouse there) |
| Supabase DB job | RLS, migrations, PostgREST row caps | Anything rendered |
| **E2E (Playwright)** | DOM ↔ form-state drift, **the second submission**, timezone and locale | Anything not driven |
| Screenshots | What a person notices instantly | Anything not captured |

Two rules of thumb earned the hard way:

- **If a defect can live between the DOM and form state, only a browser finds
  it** — and it usually appears only on the *second* submission, after a reset.
  Every UI bug in FILM-1609 was of this kind.
- **A mocked client cannot reject your SQL.** Anything that talks to ClickHouse
  or Postgres needs a run against the real thing before it is believed.

---

## Local environment: Supabase *and* ClickHouse

**Both run on this machine. `CLICKHOUSE_ENABLED=false` describes production,
not your laptop.** Specs say "the numbers cannot be verified" because
production has no ClickHouse; that sentence is true of CI and false locally,
and reading it as a local fact is how FILM-1610 first shipped a PR saying no
watched value had been checked — while a ClickHouse container sat running.

```bash
./scripts/local-env.sh up       # supabase start + ClickHouse 24.8 (CI's version) + CH migrations
./scripts/local-env.sh verify   # every ClickHouse query and insert, for real
./scripts/local-env.sh status
./scripts/local-env.sh down
```

`up` writes `deployment/config/local.env` (no secrets; regenerated on demand)
with `CLICKHOUSE_ENABLED=true`. **The app only reads ClickHouse if that file is
in the server's environment** — `apps/web/.env*` does not enable it, so a plain
`pnpm dev` still behaves like production and every analytics read returns `[]`:

```bash
# a dev server that reads the local ClickHouse
set -a; . deployment/config/local.env; set +a
cd apps/web && npx next dev --turbo -p 3100

# evidence specs that seed ClickHouse rows and read real figures off the page
set -a; . deployment/config/local.env; set +a
cd apps/e2e && CAPTURE_EVIDENCE=1 CLICKHOUSE_EVIDENCE=1 EVIDENCE_DIR=/tmp/evidence \
  PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test <name>-evidence
```

Check it before believing it: `./scripts/local-env.sh status` prints the
ClickHouse version, and a page that still shows "no data" for rows you just
inserted means the server was started without `local.env`.

| Question | Local ClickHouse answers it? |
|---|---|
| Does the SQL run at all? | Yes — `local-env.sh verify` |
| Does a known input produce the right figure *on the page*? | Yes — seed rows, drive the UI, assert the value (`experiments-evidence.spec.ts`, `subscriber-evidence.spec.ts`) |
| Are production's figures right? | No — production has no instance yet |

The pattern for a measured-value check: seed rows whose right answer you
computed by hand, and pick them so the plausible *wrong* implementation gives a
different number. FILM-1610 seeds 1,000 impressions at 10% and 9,000 at 2%:
impression-weighted is 2.8%, a plain mean is 6.0%, and the page says which one
shipped.

CI does not run these — its E2E job has no ClickHouse — so they are evidence
for the PR, gated behind `CLICKHOUSE_EVIDENCE`, not guards.

---

## The sequence for a change

1. **Check the verification surface first.** Does CI run this package's tests? Is
   this file typechecked? If not, fix that before writing code — otherwise the
   green you are about to report means nothing.
2. **Write the failing test**, at the layer that can actually see the defect.
3. **Implement.**
4. **Prove red → green** for every guard you added (mode 5).
5. **Sweep for siblings** of the class you just fixed (mode 1).
6. **Name what the fix newly permits**, and guard it in the same commit (mode 3).
7. **Screenshot any UI change** into the PR (see root `CLAUDE.md`).
8. **Run the pre-PR audit** below against your own diff.
9. **Report with commands and their output**, not adjectives.

---

## Pre-PR audit

Run this against your own diff before asking anyone to read it.

- [ ] Every guard I added has been seen to fail without its fix
- [ ] I ran the exact path I am claiming works — not a proxy for it
- [ ] I grepped for siblings of this defect class and reported what I found
- [ ] Any rule that now exists twice has been collapsed into one function
- [ ] Every comment claiming a property has a test asserting it
- [ ] I know which CI job runs each number I am quoting
- [ ] UI changes have screenshots, including the state *after* the action
- [ ] Specs, `CLAUDE.md` and README claims I touched are still true of the code
- [ ] Docs I wrote describe what the code does, not what I intended it to do

The three questions that would have caught the most in FILM-1609:

1. **Did I fix every sibling, or only the one reported?**
2. **Did I run it, or reason about it?**
3. **What does my fix now allow that it did not before?**

---

## What this does not mean

It does not mean fewer review rounds are the goal. A review that finds nothing is
not evidence of quality — it is one sample. The goal is that what reviews find
are things the author could not reasonably have caught, rather than the author's
last three fixes.
