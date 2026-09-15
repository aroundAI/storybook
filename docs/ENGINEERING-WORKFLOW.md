# Engineering workflow

How work gets verified here, and why the rules are shaped the way they are.

## Why this exists

FILM-1609 added **one revenue category** — an `S`-sized spec. It took **nine
review rounds and roughly forty findings**, and four of those rounds contained a
defect created by the *previous* round's fix.

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

### 3. The fix creating the next defect

Four of the nine rounds found a bug introduced by the previous round's fix. The
common thread: a fix removed a constraint without naming its replacement.

> `type="number"` was swapped for `type="text"` to fix a mid-edit bug — and with
> it went the browser's own numeric validation, so a pasted `1,250.00` parsed to
> `$1.00` and overwrote a real figure. Deriving the revenue window to fix a
> mismatch made the read unbounded. Fixing a date bug introduced a two-clock bug
> in the same function.

**Check:** ask what the fix *newly permits*, and guard it in the same commit. A
fix that removes a guard — a widget, a validation, a bound — names what replaces
it, in the code, not in the PR description.

### 4. Comments asserting what the code does not do

> A comment claiming it prevented a 500% share sat directly above code that
> produced a 500% share. A spec said `meanCtr` was "view-weighted" over
> impression-weighted code. A `CLAUDE.md` said E2E covered a component that is
> mounted nowhere.

**Check:** a comment that claims a property owes a test asserting that property,
or it is labelled a hypothesis. Where a doc describes a list the code also has,
bind them — `REVENUE_CATEGORY_LABELS` is asserted against `RevenueCategorySchema`
so the two cannot drift.

### 4b. Detecting a race instead of surviving it

> A sign-in helper was changed to assert that typed credentials had survived
> hydration. The assertion was correct — and it turned a recoverable condition
> into a test failure. **CI flakes went from 2 to 5**, two of them in the specs
> the change was meant to protect.

**Check:** when the condition is transient and recovery is cheap, retry it;
reserve assertions for conditions that should never happen. `expect(...).toPass()`
refills and re-reads; `expect(...).toHaveValue()` fails the run. Asking "is this
state wrong, or just early?" picks the right one.

### 5. Tests that cannot fail

A test written against already-fixed code has demonstrated nothing.

> A test meant to prove every colour token exists hand-copied the token list out
> of the stylesheet it was checking. A date assertion matched the day number
> against `"September 2nd, 2026"` — which contains `2`, so it passed on four
> days a month regardless.

**Check: red before green, every guard, no exceptions.** Revert the fix, watch
the test fail *for the stated reason*, restore it. This is the single highest-
value habit in this document — it has caught a bad test every time it was used.

### 6. Not knowing what your green covers

> `@kit/content-analytics` and `@kit/clickhouse` unit tests **never ran in CI** —
> the job lists packages by name and both were missing. `__tests__` was in both
> `include` and `exclude` in a tsconfig, so those tests were never typechecked. A
> mocked ClickHouse client passed SQL that the real server rejected outright.

**Check:** before citing a number, confirm CI actually runs it. And pin what CI
holds constant — it runs in UTC, so a date bug that only appears west of UTC is
invisible unless a test sets `timezoneId`.

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
