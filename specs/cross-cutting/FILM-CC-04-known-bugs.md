---
spec_id: FILM-CC-04
title: Known Bugs — Found, Not Yet Fixed
status: OPEN
effort: M
dependencies: -
---

# Known Bugs — Found, Not Yet Fixed

Bugs found while reviewing other work, recorded so they are not lost and
not rediscovered. **None is blocking today**; each says who it affects and
how it was confirmed. When one is fixed, move it to *Fixed* with the PR.

Every entry here was **reproduced**, not inferred. Where an earlier
statement turned out wrong on testing, the entry says so.

---

## KB-1 — Deleting a user who has created anything fails

> **Fixed (2026-09-21), #290.** All seventeen keys are `ON DELETE SET NULL`
> (`20260921205124_authors-deletable.sql`). The keys were not the whole bug:
> three BEFORE UPDATE triggers undid or refused the key's own `SET NULL`
> (`trigger_set_user_tracking`, `kit.prevent_memberships_update`,
> `enforce_verified_facts_update_rules`), so each now lets through a
> foreign-key action that clears an author, and nothing else. Kept here as
> the record of what was found.
>
> **Owner decision (2026-09-22):** the two audit columns "keep a snapshot of
> the author's name". `immutable_events.created_by_name` and
> `verified_facts.verified_by_name` (`20260921211043_audit-author-name-snapshot.sql`)
> hold the author's display name — their personal account's `accounts.name`,
> not their email — written by trigger when the author is, never taken from
> the client, backfilled for existing rows, and kept when the key goes to
> NULL. A fact's name lasts as long as its verification does.
>
> Still open, for the owner: `accounts` / `accounts_memberships` now diverge
> from the upstream kit, which a future upstream sync must not undo.

**Severity:** Medium — affects account deletion for every user who has
ever created a project, and super-admin "delete user". Few users today.
**Found:** FILM-1610 review, round 3.

### What happens

Users are **hard-deleted**. Both paths call Supabase's
`auth.admin.deleteUser(userId)` without the soft-delete flag:

- `packages/features/accounts/src/server/services/delete-personal-account.service.ts:49`
  (a user deleting their own account)
- `packages/features/admin/src/lib/server/services/admin-auth-user.service.ts:35`
  (super-admin "delete user")

Content is soft-deleted (`deleted_at` on episodes, assets, seasons, project
templates), but users and accounts have no such column. The delete reaches
Postgres, and every foreign key to `auth.users` with **no ON DELETE action**
refuses it while any row still points at the user.

### Reproduced (local API, 2026-09-19)

| Setup | `DELETE /auth/v1/admin/users/:id` |
|---|---|
| User owns a team, created nothing | **200** — succeeds |
| User owns a team and created one project | **500** — `23503 ... violates foreign key constraint "projects_created_by_fkey"` |

The existing E2E "delete user flow" (`apps/e2e/tests/admin/admin.spec.ts`)
passes only because its user never creates anything.

*Correction:* an earlier note said "deleting a user referenced by any of
these keys fails" as though it always did. It fails only when a row
actually references the user — `accounts.created_by`, for instance, is not
written by `create_team_account`, so owning a team alone does not block a
delete.

### The keys (17, measured on the live local schema)

`NO ACTION` foreign keys to `auth.users` in `public`, with how often each
was set in the local database when measured. A non-zero count means the
column is written, so it blocks deletes in practice.

| Column | Set locally |
|---|---|
| `projects.created_by`, `projects.updated_by` | 2 |
| `project_members.created_by`, `.updated_by` | 1 |
| `accounts_memberships.created_by`, `.updated_by` | 1 |
| `accounts.created_by`, `.updated_by` | 1 (seed data) |
| `verified_facts.created_by`, `.updated_by`, `.verified_by` | 0 |
| `episode_facts.linked_by` | 0 |
| `character_states.created_by` | 0 |
| `immutable_events.created_by` | 0 |
| `fact_extraction_jobs.created_by` | 0 |
| `project_intros.created_by` | 0 |
| `social_posts.created_by` | 0 |

Measure again rather than trust this table:

```sql
select conrelid::regclass, conname from pg_constraint
 where confrelid = 'auth.users'::regclass and confdeltype = 'a'
   and connamespace = 'public'::regnamespace;
```

FILM-1610 (#264) already fixed the same defect on
`analytics_experiments.created_by`, `content_tags.created_by` and
`hook_tests.created_by` — see `analytics-authors-deletable.test.sql`.

### Proposed fix

- Every **authorship** column (`created_by`, `updated_by`, `linked_by`,
  `verified_by`) becomes `ON DELETE SET NULL`: the row belongs to the
  account, not to whoever typed it. One migration, dropping and re-adding
  each constraint.
- **Decide before changing:** `immutable_events.created_by` and
  `verified_facts.verified_by` may be audit records where losing the
  author matters. Nulling is still better than blocking deletion, but an
  audit table might instead want a snapshot of the author's name.
- Makerkit core tables (`accounts`, `accounts_memberships`) come from the
  upstream kit; check upstream's current definition before diverging.

### Acceptance criteria

- [x] pgTAP: a user who created a project, a membership, a verified fact
      and a social post can be deleted; each row stays with a null author
      (`authors-deletable.test.sql`, one row per key — all seventeen)
- [x] E2E: "delete user flow" runs with a user who has created a project
      and fails if the delete is refused (`admin.spec.ts`; the same for a
      user deleting their own account, in `account.spec.ts`)
- [x] The query above returns no rows for authorship columns (no rows at
      all; asserted by the pgTAP file, so a new key without an action fails
      the suite)
- [x] Added by the owner's decision: after the author is deleted, the event
      and the verified fact survive with a NULL key and the author's name
      intact; a forged name loses to the id (`audit-author-snapshot.test.sql`)

---

## KB-2 — `scripts/deploy.sh` deploys even when migrations fail

**Severity:** Low — deploys work today (`pnpm deploy:production`), and the
risk is only on a failed migration. **Found:** FILM-1610 review, round 3.

Step 5 applies migrations before the build, which is the right order, but
it **fails open** at three points (`scripts/deploy.sh`, from the
"Apply Supabase Migrations" section):

- the `supabase` CLI is not installed → prints "Skipping migrations" and
  continues;
- `supabase link` fails → prints debug info and continues;
- `supabase db push` fails → prints "You may need to apply migrations
  manually" and continues.

In each case the app is built and deployed against the old schema. For a
change like FILM-1610, whose code reads columns only its migrations
create, that means every read touching them fails in production.

**Proposed fix:** exit non-zero at each of the three points, as the GitHub
deploy workflows now do (#264).

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

---

## KB-4 — `config.toml` still points `db diff` at `schemas/`

**Severity:** Low. **Found:** the `db diff` removal (#265).

`apps/web/supabase/config.toml` sets `schema_paths = ["./schemas/*.sql"]`.
`schemas/` is incomplete, so a stray `supabase db diff` proposes dropping
live tables. #265 removed every script and doc that suggested running it;
this setting is what makes running it harmful.

**Proposed fix:** remove `schema_paths` (it is read only by `db diff`), or
keep it once `schemas/` is reconciled. Needs a decision; nothing else
reads it.

---

## KB-5 — README gives the wrong local Supabase ports

**Severity:** Low. **Found:** the `db diff` removal (#265).

`README.md` ("Database Management" section) says Supabase is on
`http://localhost:54321` and email on `:54325`; this repo's
`config.toml` runs them on `55321` and `55324`.

---

## KB-6 — Server-action error messages are replaced in production

**Severity:** Medium. **Found:** FILM-1610 review, round 4 (#264).

A production build replaces the message of an error *thrown* from a
server action with "An error occurred in the Server Components render.
The specific message is omitted in production builds…". Only a dev
server passes the real message through, so every E2E run shows the right
text, and so does any manual check on `pnpm dev`.

Reproduced on `pnpm --filter web build:test`: the experiment log's
stale-tab refusal ("Only a planned experiment can be started…") reached
the page as that sentence. #264 fixes the experiment log and the video
note: mutations *return* `{ ok: false, error }` (`withRefusals` and
`unwrap` in `@kit/content-analytics`), and the stale-tab spec asserts the
text on ⚫️ Test's production build.

**Re-measured 2026-09-22** with a multi-line-aware scan of every `'use
client'` file under `apps/web/app` and `packages/`: 75 files read
`error.message` from a caught error. The 54 listed on 2026-09-20 missed the
hooks and mutation `onError` callbacks. Triaged by where the error comes
from, each file is one of:

| Origin | Files | What production shows today | Action |
|---|---|---|---|
| Server action that **throws** an expected refusal | 57 | "An error occurred in the Server Components render…" | fix: return the refusal as a value |
| Server action that already returns `{ success: false, error }` | 4 | the returned text (the `catch` only ever sees crashes) | none — but the `catch` fallback must not read `error.message` (`refusalMessage`) |
| `fetch` to a route handler, Supabase client, presigned upload, worker, form state | 14 | the real text (never crossed a server action) | none |

The shared helpers now live where `enhanceAction` does:
`@kit/next/action-result` (`ActionRefusal`, `ActionResult`, `unwrap`,
`refusalMessage`) and `@kit/next/refusals` (`returnRefusals`,
`withRefusals`); `@kit/content-analytics` re-exports them so #264's call
sites did not change. `returnRefusals` returns an `ActionRefusal` and leaves
everything else thrown — a crash still reaches monitoring, and a returned
message is always wording written for the page (a Postgres constraint name
or vendor body never is: the redaction was incidentally hiding those).

**Fixed (PR A — shared helper, guard, projects, episodes/studio):**
`packages/next/__tests__/kb6-caught-action-message.test.ts` fails on any
client file that reads a caught server-action message, and on any wrapped
action called without `unwrap`; `tooling/mutation-guards/kb-6.json` holds
its red checks. `apps/e2e/tests/refusals/action-refusals.spec.ts` asserts
the wording on ⚫️ Test's production build (a dev server passes with the
fix removed, so only that job can see it). The 27 client files:

- `apps/web/app/home/(user)/_components/delete-project-dialog.tsx`
- `apps/web/app/home/[account]/_components/delete-project-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/_components/quick-actions-menu.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/story/_components/add-event-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/story/_components/add-thread-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/visual-studio/_components/frame-uploader.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/visual-studio/_components/shot-details-sidebar.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/bulk-generate/{assets,ideation,screenplay,shots,story}-phase.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/create-episode-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/create-episode-wizard.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/season-generator-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/season-header.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/settings/_components/{audio,canon,studio}-settings-form.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/settings/_components/project-cover-settings.tsx` (not on the first list)
- `apps/web/app/home/[account]/studio/projects/new/_components/create-film-project-form.tsx`
- `packages/features/projects/src/components/{create,update}-project-form.tsx`, `add-project-member-form.tsx`
- `packages/features/episodes/src/components/batch-episode-creator/batch-episode-creator.tsx`
- `packages/features/episodes/src/components/continuity-checker.tsx`
- `packages/features/episodes/src/components/refinement-chat.tsx`

**Fixed (PR B — assets, audio, publishing, analytics, edit suite, admin),
33 client files, 28 more actions** — `asset-gallery`, `location-editor`,
`voice-profile-editor`, `CharacterEditor`, `use-assets`,
`use-character-assets` (the last two also *branched* on
`error.message.includes('in use')`, which cannot match in production);
`DialogueList`, `LipSyncEditor`, `MusicTrackList`, `VoiceAssignment`,
`VoiceCloningEditor`; the three audio-library dialogs; the audio-studio
dialogs, timeline and hooks; `generate-all-sound-modal`;
`publish-screen`, `publish-hub`, `upload-only-mode`, both social-posts
surfaces; `api-keys-settings`; `export-reports`,
`scheduled-reports-manager`, `note-cell` (fallback), `tag-manager` via
its caller; `export-dialog`, `use-media-bin`; both admin dialogs. The
E2E spec asserts one refusal per area (assets, audio, publishing,
analytics) on the production build. It also found that the location
editor could never save a location without an image (`fileUrl: ''`
against `.url().optional()` — the FILM-1609 class); fixed in the same PR.

**Remaining** — named in `KNOWN` in the guard test, which fails if the
file is fixed without being removed from it:

- `packages/features/content-analytics/src/components/manual-revenue-form.tsx`
  — deferred while KB-12 owned the file; KB-12 merged in #293, so it is now
  unowned and still open.

**No change needed** (the error never crossed a server action):
`channel-picker.tsx`, `research/_components/upload-source-dialog.tsx`,
`export-content-dialog.tsx` (Supabase client), `auth-error-alert.tsx`
(i18n code), `packages/ui` (`dropzone`, `form`, `use-llm-job` — the last
shows a caught message from a caller-supplied action; its callers are
audited with the audio work), `assets/…/image-uploader/**`,
`episodes/…/video-uploader.tsx`, `hooks/use-video-upload.ts`,
`edit-suite/hooks/use-export-worker.ts`,
`experiments/_components/experiments-client.tsx` and
`experiments/experiment-form.tsx` (already show what `unwrap` returned).

**Fix, per surface:** return expected refusals as values — `ActionRefusal`
inside the action, `returnRefusals` around it, `unwrap` +
`refusalMessage(error, fallback)` in the client. Assert the message *text*
in an E2E test that runs on a production build. A test that only checks
that an error is visible passes on the generic sentence too.

---

## KB-7 — No UI to abandon, edit or delete an experiment

**Severity:** Low. **Found:** FILM-1610 review, round 4.

`abandonExperimentAction`, `updateExperimentAction` and
`deleteExperimentAction` exist, are tested, and are exported, but the
experiment log page calls none of them. That predates FILM-1610. An
experiment logged by mistake can only be started and concluded. The
table and the actions already hold the rules (the lifecycle trigger,
`assertEditable`), so a UI needs no new server work.

---

## KB-8 — An experiment's baseline misses days not yet ingested

**Severity:** Low, and disclosed. **Found:** FILM-1610 review, round 4.

The baseline is measured when the experiment starts, over the
`review_window_days` before the start. YouTube's reporting data arrives
days late, so the last days of that window usually have no rows yet, and
the baseline never picks them up later. The page says so ("data on N of
M days"), so nothing is misreported, but the figure is less complete than
it could be. Option: measure the baseline window again at conclusion,
when it is fully ingested, and keep both. That changes what the baseline
means, so it needs a decision first.

---

## KB-9 — Hook Lab reads another account's retention (cross-tenant)

> **Resolved by removal (2026-09-20).** Hook Lab's code and tables are gone,
> so nothing reads a variant's video any more. Kept here as the record of
> what was found; the same-account rule it lacked is a requirement of
> FILM-1724.

**Severity:** High — a data leak across accounts, though it needs the
other account's publish id (a UUID), and Hook Lab has no page for adding
variants, so only a direct API call reaches it. **Found:** Hook Lab review,
2026-09-20. **Fix it on its own, before anything else here.**

`hook_variants_create` checks that the caller can reach the *test*, never
that `publish_id` belongs to the test's account. `queryRetentionCurve`
then reads ClickHouse by `video_id` alone, and ClickHouse has no row-level
security. The refresh writes that curve into the caller's variant.

**Reproduced** on a production build, as account A's owner through
PostgREST: a variant linked to account B's video was accepted (201), and
"Refresh retention" on the page stored B's retention (0.4242, a value only
B's curve had) and showed it in A's test.

`hook_tests` has the same shape of gap: `project_id` is not checked to be
in `account_id` (the FILM-1608 composite-key pattern). Neither table has a
pgTAP test.

**Proposed fix:** the FILM-1610 same-account rule. The variant insert and
update policies require the publish's project to be in the test's account;
`hook_tests` gets a composite `(project_id, account_id)` key; the retention
read goes through a publish the caller can see, as FILM-1610's
`linkedPublishes` does. pgTAP for each, including a user in two accounts,
seen failing first.

---

## KB-10 — Hook Lab (FILM-1510) does not work as specified

> **Resolved by removal (2026-09-20).** The route, actions, components and
> both tables are deleted; the drop migration refuses to run if either table
> has rows, so a production copy with data would stop there and lose
> nothing. Hook tests are redesigned in FILM-1724.

**Severity:** Medium — nobody can use it today, so nothing is misreported
in practice, but its numbers would be wrong if anyone could. **Found:**
Hook Lab review, 2026-09-20, twelve passes; every finding below was
reproduced on a production build (a throwaway spec seeding a 10-minute
video with a known curve, 1 − 0.8x in 1% steps), or confirmed absent by
searching the code.

| # | What happens | How it was shown |
|---|---|---|
| H-1 | **A test cannot be created or a variant added from the product.** `createHookTestAction` and `addHookVariantAction` exist; no page calls them. The page lists tests, which can only ever be empty | No create or add control on the page; no caller in the code |
| H-2 | **Retention is read at the wrong place in the video.** The variant's `duration_seconds` (default 5 — the hook's length) is used as the *video's* length, so "at 3s" reads 3/5 = 60% through the video, and "at 5s" reads the end. The comment says it falls back to the video's duration; no code does | Same video: 52% "at 3s" with the default, 99% with 600. The true value at 3s is 99.2% |
| H-3 | **Three seconds cannot be measured on a long video.** YouTube's curve is 1% steps of the video's length: the first point of a 10-minute video is at 6s, so 1s, 3s and 5s all read that one point, and a winner is declared on it | With the correct 600s: 1s, 3s and 5s all 0.992; "99% at 3s · winner" |
| H-4 | **No way to reach it.** The spec calls for a sidebar entry; neither the team nor the project navigation links to `/hooks` | 0 links on the project page |
| H-5 | **Page not found for a user in two accounts** whose projects share a slug. The page looks the project up by slug alone; slugs are unique per account, and every other studio page also filters by account | "Sorry, this page does not exist" on the user's own project |
| H-6 | **Two acceptance criteria were never built:** a queryable archive of winning hooks, and `hook_type` tag medians beside the results. The spec is marked ✅ DONE with none of its five criteria ticked | Not in the code |
| H-7 | A refusal's wording is lost in production (KB-6); the page is now on KB-6's list | KB-6 class, reproduced in FILM-1610 |

Not reproduced, so not recorded as a finding: two refreshes at once could
race on the one-winner index (clear, then set) and report a winner that was
not stored; `refreshTestRetention` ignores its write errors.

**What this means for the design.** A hook is part of the video, so a hook
test is a comparison between *different* videos — exactly what
[FILM-1724 channel experiments](../phase-17-analytics-provenance/FILM-1724-channel-experiments.yaml)
is for. Early retention is measurable only where the curve resolves the
first seconds: a 1%-step curve places its first point at 1% of the length,
so 3 seconds needs a video of about 150 seconds or less (FILM-1716's short
form). And the length has to be the published video's, which
`video_dim.duration_seconds` is not yet (FILM-1710).

**Decided:** removed rather than repaired. Nothing of its model carries
over to FILM-1724, which compares groups of videos at the same age and
reuses FILM-1610's measurement code.

---

## KB-11 — Another account could read a public project's analytics

**Severity:** High — cross-tenant data. **Found:** FILM-1615 EDD (finding
F-0), 2026-09-20. **Fixed** in the PR that adds this entry.

A project with `visibility` public or unlisted is readable by any signed-in
user (`Allow public read of public/unlisted projects`, `{anon,
authenticated}`), and the analytics guards accepted "the project row is
readable" as proof of access before reading ClickHouse, which has no
row-level security.

**Reproduced** on a production build: account A's owner rewrote the project
id in their own dashboard and Deep Dive requests to account B's public
project and got back B's project analytics (platform totals), daily
metrics (777,777 views) and median views (777,777). With B's project
private, the same rewrite returned nothing.

**Affected:** `assertScopeAccess` (26 call sites: Deep Dive, segments,
subscribers, taxonomy, Video Log), `getProjectAnalytics` and
`getProjectDailyMetrics`. Not affected, checked: every reader that finds
its videos through `publishes` (episode, season, audience and content-list
analytics, language analytics, reports, revenue, experiments, the account
dashboard), since `publishes` has no public read.

**Fix:** `assertProjectAccess` / `assertAccountAccess` require
`has_account_access` — the account's owner or a role on it, the rule the
analytics tables' own policies use. Not `has_role_on_account` alone:
personal-account owners have no membership row (10 of 10 locally), and
would have lost access to their own analytics. An `accounts` read is not
proof either: public-profile accounts are readable by anyone.

**Tests:** `scope-access.test.ts` (9); `tenant-isolation-evidence.spec.ts`
(fails on the old build with all three paths leaking, passes on the fixed
one; the owner's own control sees the figure); mutation guards S0, S0b,
S0d, S0e, each seen red.

---

## KB-12 — Revenue is added across currencies

**Severity:** Medium — wrong figures, quietly. **Found:** FILM-1615 EDD
(finding F-2), 2026-09-20. **Fixed** in #293 — see *Fixed* at the end of
this entry for what changed and what was proven rather than changed.

`revenue_records.currency` is a column, and a channel can be paid in more
than one — a sponsorship in euros beside AdSense in dollars. Almost every
reader adds `revenue_cents` without looking at it, so `$12.00` and `€5.00`
are reported as `1700` cents of nothing in particular. Nobody notices while
an account uses one currency, and nobody is told when it stops.

**Where:** `forEachAccountRevenueRow` hands `currency` to its callers and
none of them read it — `segment-revenue.ts` (`channelLevelCents`,
`unattributedCents`, `revenueBySegment`), `revenue-alerts.ts`,
`revenue-actions.ts`, `segment-actions.ts`. The same applies to the
ClickHouse side (`aggregation-queries.ts:215`, `:427`;
`account-dashboard-actions.ts:241`), where `video_metrics.revenue_cents`
carries no currency at all — so there the fix is a schema question, not
only a summing one.

**Fixed here:** the Video Log only. `getVideoLogAction` now groups by
`(publish_id, currency)` and `VideoLogRow.revenue` is a list, rendered
`$12.00 + €5.00`. There are no exchange rates in this system, and
inventing one to produce a single number would be worse than showing two.

**Why it is not fixed everywhere in that PR:** every one of those figures
is a total on a card or a chart, and each needs its own answer to "what
does this show when an account has two currencies" — one card per
currency, a selector, or a stated base currency. That is a design
decision, not a refactor.

**Said out loud in one place:** the scheduled raw export's column header
is literally `Revenue (USD)` (`raw-export-generator.ts`), over a figure
taken from ClickHouse, which carries no currency at all. Left as it is on
purpose — that header is a column name in files recipients already parse,
and renaming it in a bug-fix PR breaks their spreadsheets to make a caveat
that this entry records instead.

**Decided (owner, 2026-09-22): one card per currency.** A total that spans
currencies is shown as one figure per currency — the Video Log's
`$12.00 + €5.00`, carried to every card and chart. No exchange rates, no
base currency, no selector. An account with a single currency sees exactly
what it sees today.

**How a second currency gets in — there is one door.** Every API-sourced row
is written `currency: 'USD'` (`analytics-sync-cron.ts`, `source: 'api'`):
YouTube's Analytics API reports `estimatedRevenue` in USD unless a `currency`
parameter is sent, and we never send one. So platform revenue cannot be
mixed. The only way to a non-USD row is a person: the manual revenue form's
currency select (`manual-revenue-form.tsx`) — a sponsorship paid in euros,
entered as euros. *(Corrected 2026-09-22 by the KB-12 fix, #293: this
paragraph first also named "a bulk import beside it". There is none —
`record.currency ?? 'USD'` in `revenue-actions.ts` is the return mapping of
`addManualRevenueAction`. The form is the only door.)* That makes this rarer than the entry's first
paragraph suggests, and means the ClickHouse side (`video_metrics.revenue_cents`,
no currency column) is USD **by construction today** — vacuously: #293 found every ingest path writes a literal `0` there, so there is no ClickHouse revenue to mix yet — which the fix should
state and guard, because it stops being true the day a provider reports in
the channel's own currency.

**How to reproduce:** add two `revenue_records` for one publish with
different `currency` values, and read the revenue mix or the account
dashboard: one number, neither currency.

### Fixed (#293)

**One primitive** — `lib/money.ts` in `@kit/content-analytics`:
`CurrencyAmount`, `MoneyByCurrency`, `createMoneyFold` / `foldMoney`,
`createCurrencyPartition`, `formatCurrencyAmount` / `formatMoney`. The Video
Log's own fold and formatter were replaced by it, so the rule lives once.
`forEachAccountRevenueRow` now hands its callers `amount: { currency, cents }`
and no bare `revenue_cents`, so adding two rows of unknown currency no longer
typechecks (`money.test.ts` holds the type with `@ts-expect-error`).

**Every Postgres reader folds per currency:** the summary, trend, daily
average, RPM, revenue mix and ad share, platform shares, chart series,
projection and top-content ranking (`lib/revenue-by-currency.ts`, drawn by
`revenue-dashboard.tsx` as one row of tiles, one chart, one mix and one
ranking per currency); the segment fold and its RPM (`segment-revenue.ts`,
`segment-actions.ts`); the stored revenue report (`summary_data` schema
version 3). A share, a trend and an RPM are computed **within** a currency —
a mixed sum is never divided.

**Alerts are evaluated per currency** (`revenue-alerts.ts`): each currency
against its own trailing days, month-to-date and milestones. Summed, a euro
sponsorship tripped a dollar spike, steady euro income hid a real one, and
$95 + €20 "passed $100". The milestone ladder is the same nominal ladder in
every currency (100, 500, 1,000 …), because one that meant the same *value*
would need the exchange rates this system does not have. No UI reads
`revenue_alerts` yet, so this is covered by unit tests, not a screenshot.

**ClickHouse is USD by construction, and now bound to it.**
`video_metrics.revenue_cents` has no currency column and did not get one.
Measured: every ingest path writes a literal `0` there, the only platform
revenue we fetch is YouTube's — requested without a `currency` parameter, so
USD — and it goes to `revenue_records` stamped `currency: 'USD'`. No path
copies a manual (possibly non-USD) record into ClickHouse. So the ClickHouse
figures (`aggregation-queries.ts`, `account-dashboard-actions.ts`, the
language, experiment and report reads, and the raw export's `Revenue (USD)`
column, which keeps its name) are dollars. `revenue-writers.test.ts` reads
the source and fails on any new, moved or changed `revenue_cents` write until
it is listed with its store and currency.

**Tests:** `money.test.ts`, `revenue-by-currency.test.ts`,
`revenue-alerts.test.ts` (seen red on the old evaluator: 4 of 5 failed, the
single-currency case passed), `revenue-writers.test.ts`,
`segment-revenue.test.ts`; `revenue-currency.spec.ts` (seen red: the total
tile read `$2,400` for $1,600 + €800; its single-currency case was written
against the old build and passes unchanged on the new one);
`revenue-currency-evidence.spec.ts`; mutation guards `kb-12.json`, each seen
red.

**Not part of this, noticed while here:** `idx_revenue_records_unique_scope`
keys on scope, date, category and source — not currency — so a euro and a
dollar sponsorship for the same scope on the same day are one slot, and the
second entry replaces the first (the form's standing note says a save for
the same date and category replaces the last one). That is a
limit on what can be recorded, not a wrong sum.

---

## KB-13 — Row-level security costs a second on a page of revenue

**Severity:** Low — slow, not wrong. **Found:** FILM-1615 review,
2026-09-20. **Open.**

`revenue_records_read` decides each row with an `exists` over
publishes → episodes → projects. That is per row, before any aggregation,
so summing a page of the Video Log's revenue — 100 videos with a year of
daily rows, 36,500 of them — spends **~1.1s** in the policy. The same
aggregate with RLS off is **11ms**. Measured with `\timing` on the local
database, against seeded rows.

It is the dominant remaining cost of a Video Log page read. Measured end to
end on a production build, one page of 100 videos:

| That page's revenue | Cold | Warm |
|---|---|---|
| none | 932 ms | ~480 ms |
| a year of daily rows (36,500) | 4,224 ms | ~3,550 ms |

So the phase's 2-second budget holds for the data these accounts have today
and is missed by a page where every video has a year of daily revenue. It is
the price of the policy being the single thing that decides who may read a
revenue row — a `security definer` aggregate would be ~100× faster and would
have to re-derive that policy by hand, which is how KB-11 happened.

**If it needs fixing:** a rollup the sync writes (per publish per currency)
would make this an indexed lookup, at the cost of a second place revenue
can be wrong. Not worth it until someone has a real account that is slow.

---

## KB-14 — The lambdas are not typechecked

**Severity:** Medium — nothing is known to be broken in production, and
nothing would tell us if it were. **Found:** FILM-1723 (#284), 2026-09-22.
**Fixed** in #309 — `apps/web/lambda/tsconfig.json`, run by `web`'s
`typecheck` script and so by `pnpm typecheck` and CI's ʦ TypeScript job.
All 83 errors (82 when filed) are dispositioned in `specs/plans/KB-14-edd.md`
§8.3. The real defects it surfaced are KB-32 to KB-35 below, the refinement
job types (fixed in the same PR) and the duplicate `verifiedFacts` key
(fixed; see the corrected audit lead).

`apps/web/tsconfig.json` includes `app`, `lib`, `components`, `config`,
`scripts` and the root files. It does not include `lambda/`, and no other
tsconfig does. So `pnpm typecheck`, and CI's TypeScript job, have never
looked at the eleven workers under `apps/web/lambda/` — the code that
publishes to every platform, refreshes tokens, renders video and runs the
LLM pipeline. They are bundled by esbuild through SST, which strips types
without checking them.

### Reproduced (2026-09-22, `main` at dbbd5ee8)

```bash
cd apps/web
npx tsc -p tsconfig.json --listFilesOnly | grep -c '/apps/web/lambda/'   # 0
```

With a throwaway tsconfig that extends the app's and includes
`lambda/**/*.ts`: **82 errors**.

| Code | Count | What it is here |
|---|---|---|
| TS2345 | 20 | Mostly job types the union does not contain: `'story-refinement'`, `'screenplay-refinement'`, `'audio_file_generation'`, `'dialogue_voice_generation'` passed as `GenerationJobType` |
| TS2352 | 18 | Casts between shapes that do not overlap — prompt templates, `ScheduledPublish[]` |
| TS2339 | 17 | Properties read off an array as though it were a row (`context-builder.ts`: `.id`, `.metadata` on `{…}[]`) |
| TS7016 / TS2307 | 10 | `ws`, `@aws-sdk/client-sqs`, `@aws-sdk/client-s3` not resolvable from `apps/web` — the workers' dependencies are not the app's |
| TS2459 | 5 | `PublishJobMessage` imported from `../index`, which declares it and does not export it: `handlers/facebook.ts`, `linkedin.ts`, `tiktok.ts`, `youtube.ts`, and `scheduled-publish/index.ts` |
| others | 12 | TS2322 (5), TS2769 (3), TS7006, TS2739, TS2578, TS1117 |

**Not every one of the 82 is a bug.** The ten module-resolution errors are
an artefact of checking the workers with the app's config. But the TS2339s
in `context-builder.ts` read like a real one — a Supabase join typed as an
array and read as an object — and the job-type strings mean either the union
is stale or the workers write values the app's types say cannot exist.
Nobody has looked, which is the bug.

### Proposed fix

- A `tsconfig.json` for the lambdas (one, or one per worker, with the
  workers' own dependency resolution), wired into `pnpm typecheck` and so
  into CI.
- Triage the 82: fix what is real, and leave no `@ts-expect-error` without a
  reason beside it.
- **Red before green:** the CI job must be seen to fail on a deliberately
  broken handler before it is trusted.

### Acceptance criteria

- [x] `tsc --listFilesOnly` under CI's typecheck lists the lambda files (51 of 51)
- [x] Zero type errors under `apps/web/lambda/`, each of today's 82 fixed or explained
- [x] A type error introduced in a handler fails CI — demonstrated, then reverted (runs linked in #309)

---

## KB-15 — X connections are never refreshed

**Severity:** Medium — every X connection stops working two hours after it
is made. Masked today, because X video publishing does not work for another
reason (FILM-1729). **Found:** FILM-1723 (#284), 2026-09-22. **Open.**

`TWITTER_OAUTH_CONFIG` requests `offline.access` "for refresh tokens" and
records a two-hour access token with a 180-day refresh token
(`oauth/twitter/config.ts`). Nothing ever uses the refresh token.

`packages/features/publishing/src/lib/token-refresh.ts`:

- `type Platform` is `'youtube' | 'tiktok' | 'instagram' | 'facebook' |
  'linkedin'` — no `'twitter'` (`:36`).
- The connection's platform is forced into it with `connection.platform as
  Platform` (`:186`, `:243`), which is how a sixth value reaches the switch
  without the compiler objecting.
- `refreshTokenForPlatform` has no X case and falls to
  `default: throw new Error(`Unknown platform: ${platform}`)` (`:303-313`).

So an X token past its two hours is not refreshed: the refresh path throws
and the connection is treated as broken. Both publish paths go through it —
`process-scheduled-publishes.ts:222` and `connection-actions.ts` — and the
publish lambda's own `ensureValidToken` (`lambda/publish-worker/index.ts:132`)
does not refresh at all; it reports *"Token expired - please reconnect your
account or wait for refresh"*, a refresh that for X never comes.

**Confirmed by reading, not by running against X** — we hold no X
credentials (FILM-1729 §2), and this entry says so rather than claiming a
reproduction it does not have. What *can* be run locally: a unit test that
calls `ensureValidToken` for a connection with `platform: 'twitter'` and an
expired token, and sees `Unknown platform: twitter`.

### Proposed fix

- Add `'twitter'` to `Platform` and a `refreshXToken` beside the others
  (`POST https://api.x.com/2/oauth2/token`, `grant_type=refresh_token`; host from `@kit/shared/vendors`). X is understood
  to issue a **new refresh token on every use** — confirm against docs.x.com
  and cite it in the capability reference before relying on it; if so, the
  rotated token **must** be stored or the second refresh fails.
- **Fix the class:** remove the `as Platform` casts and derive `Platform`
  from the same source as `platform_connections.platform`, so the switch is
  exhaustive and a seventh platform is a compile error rather than a runtime
  throw. That cast is the actual defect; X is the instance.
- The unit half can land now. The live half — one real refresh — waits on X
  credentials and rides with FILM-1729 / FILM-1725 Check E.

### Acceptance criteria

- [ ] Unit: an expired X connection is refreshed and the **rotated** refresh token stored; seen red first with `Unknown platform: twitter`
- [ ] `Platform` is derived, not restated; no `as Platform` cast remains; the switch is exhaustive under `tsc`
- [ ] The publish lambda's token check agrees with the app's for X
- [ ] One live refresh against X *(deferred with FILM-1729 — no credentials)*

---

## KB-16 — The Overview tab shows figures nobody measured

**Severity:** High — invented numbers presented as a creator's own data, on
the first screen they see. Not a leak and not a crash, which is how it has
survived; by this product's own standard (never render a default as a
measurement) it is the worst kind of wrong. **Found:** FILM-1701 (#288),
2026-09-22, which fixed the same defect on the Audience tab and listed these
as outside its file map. **Fixed** in #300 for every row of the table
below; the guard's widening and the items under *Remaining* are still open.

Every line below was re-read on `main` (dbbd5ee8) before being written down.

| Where | What the creator sees | Why it is invented |
|---|---|---|
| `overview/shares-card.tsx:23` | A donut: 83% direct, 17% copy link | `breakdown \|\| { direct: 83, copyLink: 17 }` — commented "from prototype". `analytics-dashboard.tsx` never passes `shareBreakdown` to `OverviewGrid`, so the donut is 83/17 for **every account, always** |
| `overview/revenue-card.tsx:33-36,55,68` | Ad Revenue and Sponsorships, with bars | `revenue * 0.7` and `revenue * 0.3`; bars fixed at 70/30. `revenueBreakdown` is never passed either. The real split exists — FILM-1609's revenue mix — and is not used |
| `overview/revenue-card.tsx:43` | "Projection: $10k by month end" | A string literal |
| `overview/shares-card.tsx:30` | "Viral coefficient is rising" | A string literal. Nothing computes a viral coefficient |
| `overview/platform-split-card.tsx:30` | "Dominant performance on short-form" | A string literal |
| `overview/comments-card.tsx:41` | "*X* generated the most discussion" | Rendered with 0 comments |
| `metric-cards.tsx` + `lib/format.ts:79-83` | **+100.0%** beside every non-zero metric | `calculateChange` returns 100% "up" when `previous === 0`, and three of the four callers pass `previousData={null}` (`analytics-dashboard.tsx:379`, `project-dashboard.tsx:51`, `episode-analytics.tsx:51`), which the card reads as 0. Only `company-dashboard.tsx` passes a real previous period. "No comparison available" is being drawn as "doubled" |

**The class, not the instances.** These are one defect seven times: a
component that accepts optional data and, when it is absent, draws something
anyway. FILM-1701 added `no-literal-fallbacks.test.ts` for the Audience
components. The fix here is to widen that guard to every analytics component
and then make it pass — not to patch seven lines.

### Proposed fix

- **Remove, do not replace with a nicer guess.** No breakdown → no donut; an
  empty state in the manner of FILM-1701's `NotCollectedCard`. We do not
  collect a share breakdown at all, so that card says so.
- **Revenue card:** plumb the real mix from FILM-1609's revenue queries, per
  currency (KB-12 — one figure per currency; coordinate with that fix, it
  touches the same card). No mix → no bars.
- **Footers:** delete all four literals. A footer earns its place by stating
  a denominator or a caveat (FILM-1701's Device card is the pattern), not by
  sounding insightful.
- **The +100%:** `previousData: null` must mean "no comparison" — no arrow,
  no percentage. `calculateChange` should return a no-baseline result for
  `previous === 0` rather than `100`; a change from nothing is not a
  percentage. Then either pass a real previous period to the three callers
  (`company-dashboard` shows how) or show nothing.
- **Invariant in the type:** the cards take a discriminated
  `measured | absent` prop, so "absent" cannot fall through to a default.

### Acceptance criteria

- [ ] `no-literal-fallbacks` guard covers every component under `content-analytics/src/components`, seen red on today's code for each row above — **Overview only** (#300, `no-literal-fallbacks-overview.test.ts`, red on the unfixed base for every row) plus Audience (#288); deep-dive, content, experiments, video-log and the rest are not scanned yet
- [x] No share donut, revenue split, projection or canned footer renders without data behind it — #300
- [x] Revenue split comes from recorded revenue, per currency, or is absent — #300
- [x] A metric with no previous period shows no change indicator; `calculateChange(n, 0)` no longer reports 100% — #300
- [x] Playwright evidence: Overview for an account with no breakdown data, and one with real revenue mix — screenshots of both, values read from the DOM — #300

### Remaining (listed by #300, not fixed there)

- Widen the guard to every component directory, and unify #288's
  `no-literal-fallbacks.test.ts` with #300's `no-literal-fallbacks-overview.test.ts`
  into one file.
- Plumb a real previous period into the project Overview, project dashboard
  and episode analytics (`company-dashboard` shows the shape); they now show
  no change indicator, which is honest but less than they could.
- Found, not yet reproduced as their own entries: Top Content prints
  `0.0% ER` for a video with 0 views (0/0), and the AI Insight summary says
  "average engagement rate of 0.0%" the same way; `OverviewGrid` renders `0`
  for every total when `analytics` is `null`; the metric row's **Revenue $0**
  is ClickHouse `revenue_cents`, which every writer sets to `0`.
- Found in the 2026-09-23 spec audit (FILM-805, by reading): the project metric row draws hard-coded
  `watchTimeSeconds: 0` and `subscribersGained: 0` as measurements
  (`packages/features/content-analytics/src/components/analytics-dashboard.tsx:192-193`).

---

## KB-17 — `immutable_events` are not immutable

**Severity:** Medium — an integrity hole inside an account, not across
accounts. Any member of a team can silently rewrite or remove the canon
record the continuity validator treats as fixed, and put someone else's
name on it. **Found:** KB-1 (#290), 2026-09-22, while adding the author-name
snapshot: the brief asked that "any immutability guard still refuse ordinary
edits", and there was no guard to ask. **Open.**

The table has one policy and, before #290, no triggers:

```sql
create policy "immutable_events_project_access" on public.immutable_events
  for all to authenticated using (... has_role_on_account(p.account_id));
```

`FOR ALL` with only a `USING` clause grants SELECT, INSERT, UPDATE and DELETE
alike to every member of the account, and with no `WITH CHECK` nothing
constrains what a row is changed *to*.

### Reproduced (local database, 2026-09-22, in a rolled-back transaction)

As an ordinary `authenticated` account member (JWT `sub` set, `set local role
authenticated`), against an event they did not need to have created:

| Statement | Result |
|---|---|
| `update immutable_events set description = 'REWRITTEN canon', created_by = '<another user>'` | **UPDATE 1** — description changed, `created_by` now names the other user |
| `delete from immutable_events where id = …` | **DELETE 1** |

With #290's snapshot trigger in place the forged row's `created_by_name`
follows the forged id — the name always matches the id, but the id is only as
trustworthy as this policy. That is the one place KB-1's snapshot guarantee
has nothing to stand on.

The application only ever inserts and deletes these rows
(`packages/features/episodes` canon actions), so nothing in the product needs
UPDATE.

### Proposed fix

- Split the policy: SELECT for members; INSERT `WITH CHECK (created_by =
  auth.uid())`; **no UPDATE policy for `authenticated`**; DELETE limited to the
  roles the canon UI actually offers it to (decide: owner/admin, or the event's
  author). `revenue_records` is the precedent for pinning an author column.
- A `BEFORE UPDATE` trigger that refuses any change except the nested
  (`pg_trigger_depth() > 1`) clearing of `created_by` that KB-1 relies on for
  user deletion — so immutability does not depend on the policy alone.
- **Fix the class:** grep for every other `for all … using (` policy without a
  `WITH CHECK` in `apps/web/supabase/migrations/` — the canon migration
  (`20260128225704_canon_management.sql`) wrote several tables in one sitting.
  List them in the PR; fix those with an authorship or immutability claim.

### Acceptance criteria

- [ ] pgTAP, red first: a member cannot UPDATE an immutable event, cannot insert one naming another author, and can delete one only if their role allows it
- [ ] User deletion (KB-1) still succeeds against a user who authored an immutable event, name snapshot intact
- [ ] Every `FOR ALL` policy lacking `WITH CHECK` is listed, with a decision beside each
- [ ] Canon UI still creates events — shown by an E2E written for this fix. *(Corrected 2026-09-23: there is no canon E2E to keep green, and no UI removes events — `deleteImmutableEventAction` has no caller.)*

---

## KB-18 — Verifying or disputing a fact is always refused

**Severity:** Medium — a whole feature that cannot work: no fact can ever
reach `verified` or `disputed` through the app, for any user, owner included.
Nothing is corrupted, and nothing downstream can trust a status the UI cannot
set. **Found:** KB-1 (#290), 2026-09-22, reported as a lead from reading;
reproduced below. **Open.**

`verifyFactAction` and `disputeFactAction`
(`packages/features/episodes/src/server/fact-actions.ts`) check that the
caller is an owner or admin, then write with the **user's** client
(`getSupabaseServerClient()`):

```ts
.update({ verification_status: 'verified', verified_by: user?.id, verified_at: … })
```

The UPDATE policy on `verified_facts` lets owners, admins and members through
its `USING` clause, and then its `WITH CHECK` demands of the **new** row:

```sql
verification_status in ('unverified', 'pending_review')
and verified_by is null and verified_at is null
```

So the policy permits editing a fact only into a state that is not verified —
exactly the states these two actions exist to leave. It reads as a guard
against members self-verifying that was never paired with a privileged path
for the people who may verify.

### Reproduced (local database, 2026-09-22, in a rolled-back transaction)

As an `authenticated` member of the project's account, on a fresh
`unverified` fact:

| Statement (what the action sends) | Result |
|---|---|
| `update … set verification_status='verified', verified_by=<self>, verified_at=now()` | `ERROR: new row violates row-level security policy for table "verified_facts"` |
| `update … set verification_status='disputed'` | same error |

Not yet driven through the UI. Per KB-6, a thrown server-action error is
replaced by a generic sentence in production builds, so what a user most
likely sees is "something went wrong" — confirm when fixing. The local
database holds **0** `verified_facts` rows in any status, consistent with
nobody having been able to use it.

### Proposed fix

- **Do not loosen the member policy.** Its refusal is correct for members, and
  KB-1's tests rely on members being unable to forge a verifier.
- Give verification its own path: a `security definer` function (or a
  role-scoped policy) that checks owner/admin on the project, sets
  `verified_by = auth.uid()` itself — never from the caller — and moves the
  status. The actions call that instead of a bare UPDATE. It must coexist with
  `enforce_verified_facts_update` and #290's name-snapshot trigger: a verified
  fact ends up with `verified_by_name` set.
- Return refusals **as values** with their text asserted in a production-build
  E2E (KB-6).
- FILM-1123 (fact-checker role) and FILM-1121 (fact management UI) are marked
  done. When this is fixed, check their acceptance criteria against what
  actually runs — a form needs driving, not reading.

**It reaches further than the dialog** (found in the 2026-09-23 spec audit, by reading): season analysis only passes *verified* facts to generation (`packages/features/episodes/src/server/external-context-actions.ts:401`), so it never receives any; and `runFactCheck` needs verified facts, so it always exits early (`packages/features/episodes/src/lib/documentary/fact-checker.ts:120`). FILM-1121, 1122, 1123, 1140 and 1143 are 🟡 PARTIAL on this entry.

### Acceptance criteria

- [ ] pgTAP, red first: owner and admin can verify and dispute; a member cannot; nobody can set `verified_by` to another user
- [ ] Playwright: verify a fact, reload, it is still verified and shows who verified it; dispute another — asserted on the **second** action as well as the first; screenshots in the PR
- [ ] A refusal reaches the user as a readable message in a production build
- [ ] FILM-1121 / FILM-1123 criteria re-checked against the running feature, corrections noted in those specs

---

## KB-19 — A failed platform connect lands on a 404, and nothing is logged

**Severity:** Medium — every refused or cancelled OAuth connect, on every
platform, ends on a "page not found" with the reason hidden in the address
bar. It matters now: FILM-1711 (#289) starts requesting scopes a vendor may
refuse, and its pre-deploy check is *reading that failure*. **Found:**
FILM-1711's runbook work, 2026-09-22 (the teammate saw the 404 with `curl`
against a local server). **Fixed** in #297.

All five callbacks under `apps/web/app/api/platforms/callback/` — `youtube`,
`tiktok`, `meta`, `twitter`, `linkedin` — send every failure to

```ts
`${appUrl}/settings/platforms?error=${encodeURIComponent(errorDesc || error)}`
```

There is no `/settings/platforms` route. The page lives at
`/home/[account]/settings/platforms`, which is where the same files send a
*successful* connect. Three things are wrong at once, re-checked on `main`
(dbbd5ee8):

1. **The path.** Failure redirects omit `/home/${accountSlug}`. On several
   failure branches (`missing_params`, `invalid_state`) the account slug is not
   known yet, because it lives in the state that failed to parse — so the fix
   is not only a string.
2. **Nothing logs.** The `if (error)` branch redirects without a log line, so
   a vendor refusing a scope leaves no trace server-side.
3. **Nobody reads it.** `home/[account]/settings/platforms/page.tsx` never
   looks at `searchParams.error`, so even a correct redirect would show
   nothing.

And one to check while there: the vendor's `error_description` is reflected
into a URL and would be rendered. Treat it as untrusted text — map known
codes to our own messages, show the raw string only escaped and clearly
attributed, never as HTML.

### Proposed fix

- One shared helper for callback failures: logs (platform, error code, which
  branch — never tokens or the `code`), and redirects to the account's
  platforms page when the slug is known, else to a slug-less route that
  resolves the user's account (or `/home`) carrying the error.
- The platforms page reads the error and shows it: what failed, on which
  platform, what to do. Known codes (`access_denied`, `invalid_scope`,
  `state_expired`, `*_not_configured`) get written messages.
- **Fix the class:** the five callbacks restate the same branches; the helper
  is where they become one function.

### Acceptance criteria

- [x] Playwright, per platform, seeded via API: a callback hit with `?error=access_denied` and one with a bad `state` both end on a real page showing a message — asserted by text; screenshots in the PR — #297, `connect-failure.spec.ts` (29 cases, dev and production build)
- [x] Each failure branch writes one log line; a test asserts no token, `code` or secret appears in it — #297, `failConnect`
- [x] A hostile `error_description` (`<script>`, a long string) is shown inert or replaced — #297 (rendered as a text node, capped at 300 chars)
- [x] `docs/vendor-review-runbook.md` (#289) updated: the pre-deploy check reads the page, not the address bar — #297

---

## KB-20 — Two vendor submissions are blocked by what the site does not say

**Severity:** Medium — nothing is broken for a user; the owner cannot pass
Meta App Review or Google's OAuth verification until these exist. Both are
review prerequisites, and a rejection costs a week. **Found:** FILM-1711's
runbook work, 2026-09-22, with vendor citations in
`docs/vendor-review-runbook.md` (#289). **Open.**

Re-checked on `main` (dbbd5ee8):

| Vendor requirement | What we have |
|---|---|
| **Meta:** any app accessing user data must provide a data-deletion **callback URL or an instructions URL** | Neither. No route handles a `signed_request`; no page says how to ask. The privacy policy lists erasure as a right and not how to exercise it. `grep -r "signed_request\|data-deletion"` over `apps/web` and `packages`: nothing |
| **YouTube API Services developer policies:** the privacy policy must link the **YouTube Terms of Service**, link the **Google Privacy Policy**, and state that users can **revoke access via Google's security settings page** | None of the three. `apps/web/app/(marketing)/(legal)/privacy-policy/page.tsx` contains no `youtube.com/t/terms`, no `policies.google.com/privacy`, no Google security-settings link |
| **Same policies:** stored API data must be deleted after revocation (figures and clauses now quoted — see *What the vendors actually require*, below) | **Corrected 2026-09-22 — the first version of this row was wrong.** It said disconnect leaves Postgres rows in place and named `content_analytics`. That table was dropped by `20260212080000_drop_content_analytics.sql`, and disconnect does the opposite of leaving Postgres alone: see **KB-22**. ClickHouse is the side that is never deleted |

**What already works, and the page can truthfully say:** disconnecting a
platform revokes access at the vendor (Meta: `DELETE /me/permissions`), and
account deletion exists (and, after KB-1 (#290), succeeds).

**Not needed to be the first user.** Meta grants Standard Access to anyone with
a role on the app, so the owner can connect their own Instagram and run
analytics today; App Review and Business Verification gate *other* users. Do
not let this entry hold up the owner's own use.

### Proposed fix — in this order

1. **A data-deletion instructions page** under `(marketing)/(legal)/`, linked
   from the privacy policy and the footer: how to disconnect a platform, how
   to delete the account, what each removes and within what time, and a
   contact for anything else. Cheapest thing that satisfies Meta. A
   `signed_request` callback can follow if wanted; the runbook sketches a path.
2. **The three YouTube items** in the privacy policy, plus a plain statement
   of what API data we store, why, and for how long.
3. **Make the page true:** deleting vendor-sourced analytics when a connection
   is removed or its access revoked, within the stated window — ClickHouse and
   Postgres both, scoped to that connection's publishes, leaving manual
   revenue entries (the user's own data, `source != 'api'`) alone. **This is
   the real work** and may deserve its own spec: it needs a decision on
   whether disconnect means "forget my history" (a creator who reconnects next
   week loses their charts) or whether deletion runs only on explicit request
   and on expiry. Owner decision before code.

### Decided (owner, 2026-09-22): keep it until asked

**Disconnecting does not delete history.** Vendor-sourced analytics are deleted
only on an explicit request, or when a retention window runs out. The owner's
reasoning, which the design has to honour: a connection can drop *by mistake* or
*because a token expired*, neither of which is the creator asking to be
forgotten; and someone who stops using the product for five months and returns
in the sixth should find their data. A disconnect that silently wipes charts
punishes exactly those people.

**This has to be squared with the vendor's text, not assumed compatible with
it.** YouTube's API Services policies set limits on how long stored API data
may be kept without the user's authorisation still being valid, and require
deletion when a user revokes access. Read against the decision above, three
cases are genuinely different, and the drafts (items 1–2) and the mechanism
(item 3) must treat them differently:

| What happened | Is it the user asking to be forgotten? | Expected handling |
|---|---|---|
| Token expired / refresh failed / disconnected inside *our* app | No | Keep. Prompt to reconnect. This is the owner's case |
| User revoked our app's access **at the vendor** (Google security settings, TikTok, Meta) | Arguably yes, and the vendor's policy says so | **Verify the policy text first.** If it requires deletion within a fixed window of revocation, that window wins over "keep until asked" for that platform's data — and the page must say so |
| User asks us to delete (the instructions page, account deletion) | Yes | Delete within the stated window |

**So the first deliverable is a citation, not a page:** the exact current
wording and figures of YouTube's retention and revocation clauses (the runbook
recorded 30-day and 7-day windows from a first read — *unconfirmed*), and the
equivalent clauses for Meta and TikTok. If they conflict with "keep until
asked" for the revoked-at-vendor case, **stop and bring the conflict to the
owner with the quoted text** rather than drafting around it. A retention
window long enough for the six-month case (the owner's example) is the default
to propose if the policies allow it.

### What the vendors actually require (quoted by the KB-20 teammate, 2026-09-22)

YouTube API Services Developer Policies, read from the page itself ("Last
updated 2026-09-14 UTC"), https://developers.google.com/youtube/terms/developer-policies:

| Event | Clause (III.D, III.E.4) | Window |
|---|---|---|
| User disconnects **inside our app** — our button *is* "this mechanism"; `oauth/youtube/disconnect.ts:43-49` revokes at Google | "you and your API Clients must delete all Authorized Data that was accessed or stored pursuant to that consent… must take place within 7 calendar days of the revocation" | **7 days** |
| User revokes at Google's security page, **or the token cannot be refreshed** | "periodically reconfirm that its authorization tokens are still valid and delete API Data associated with users whose authorization tokens cannot be refreshed… within 30 calendar days of that revocation" | **30 days** |
| Connection still valid | Analytics data may be stored "for as long as is necessary", but "the Client must still ensure every 30 days that it is still authorized" | **no cap**, 30-day re-check |
| User asks us to delete, or deletes their account | "as soon as possible and within 7 calendar days" | **7 days** |

**This conflicts with "keep until asked" for YouTube** — for a deliberate
in-app disconnect (7 days) and for the owner's own token-expired case (30
days). The policy does not distinguish a mistake from a wish to be forgotten.
It does **not** conflict for the returning-after-five-months user *whose token
stayed valid*. Meta (Platform Terms §3.d, "Last updated February 3, 2026")
requires deletion "promptly" on request and sets nothing off on disconnect: no
conflict. TikTok's terms could not be read from this network: **not verified**.

**Decided (owner, 2026-09-22, on the conflict): (A) — YouTube is carved out.**
YouTube statistics are deleted within **7 calendar days** of a disconnect made
in our app and within **30 calendar days** of revocation at Google or an
authorisation that cannot be renewed; "keep until asked" stands for every
other platform, **with no time limit** (a 12-month window was offered and
declined). Three more decisions taken with it: the 7-day request window is
real — the owner performs the deletion by hand, commands in
`docs/data-deletion-runbook.md`; `privacy@storybook.digital` is monitored; no
*Pause* action (B) is built. Because the owner is today the only user, the
person who disconnects is the person who deletes, which is what makes the
page's YouTube sentences true now. **Automating it — item 3, built together
with KB-22 because the two pull the same lever in opposite directions — is a
precondition before a second account is onboarded.**

**Legal text is the owner's to approve.** A teammate can draft from the vendor
requirements and the code's actual behaviour; the PR must say DRAFT and must
not claim a behaviour (a deletion window, a retention period) the code does
not implement. Item 3 exists so that items 1–2 never have to.

### Acceptance criteria

- [x] Data-deletion instructions page, linked from the privacy policy and footer; every sentence on it checked against what the code does — #294; the three BLOCKED boxes replaced with the decided text; live on deploy
- [x] Privacy policy carries the three YouTube-required items — each cited to the policy text in #294 (§III.A.1, §III.A.2.c, §III.A.2.i)
- [x] Owner has decided what disconnect deletes (2026-09-22: keep until asked; then, on the YouTube conflict, option A — see above)
- [x] Vendor retention/revocation clauses quoted and cited for YouTube and Meta; TikTok **[not verified]** (its terms were unreachable from this network); the conflict was brought to the owner and decided
- [ ] Item 3: after a disconnect (or on request), vendor-sourced rows for that connection are gone from ClickHouse and Postgres within the stated window; manual entries untouched — pgTAP/ClickHouse test with seeded rows, red first. **Precondition before a second account**; until then the YouTube windows are met by hand (`docs/data-deletion-runbook.md`)
- [x] Runbook (#289) updated in #294: both blockers marked resolved, the URLs to paste kept in each vendor's form table

---

## KB-21 — Six environment variables redirect vendor traffic in production

**Severity:** Medium — not exploitable from outside: it needs write access to
the deployment's environment. But a variable that silently moves API traffic,
*carrying the API key in its headers*, to another host is an exfiltration path
with no log line, and FILM-1801 (#291) has just built the guarded way to do
the same thing. These six go around it. **Found:** FILM-1801 (#291),
2026-09-22, reported and deliberately not changed. **Open.**

FILM-1801's resolver honours an override only when `NODE_ENV` is `development`
or `test` by name, `VENDOR_SANDBOX=1`, the process is not a Lambda, and the
value is a credential-free http(s) URL on a **local** address — and it logs
ignored overrides at server start. These have none of that:

| Variable | Read by | Re-checked on `main` |
|---|---|---|
| `SYNCLABS_BASE_URL` | our code | `packages/features/audio-generation/src/providers/lip-sync/factory.ts:131` |
| `WAV2LIP_API_URL` | our code | same file `:143`; `audio-generation/src/lib/constants.ts:248` (defaults to `http://localhost:8000`) |
| `LOCAL_API_URL` | our code | `packages/llm/src/factory.ts:79` (the `local` LLM provider) |
| `OPENAI_BASE_URL` | the OpenAI SDK itself | no reference in our source; present only in the bundled SDK |
| `ANTHROPIC_BASE_URL` | the Anthropic SDK itself | same |
| `GOOGLE_GEMINI_BASE_URL` | the Google GenAI SDK itself | same |

### Decided (owner, 2026-09-22): close all six — specified in FILM-513 and FILM-1805

**None of the six is set in production** (owner, 2026-09-22 — a first reading
that `GOOGLE_GEMINI_BASE_URL` was in use was wrong; the owner sets API keys, not
base URLs). No deployment depends on any of them. The fix is split by what each
variable is for, and each spec carries its own proof (PR #301):

| Variable(s) | Owner's call | Spec |
|---|---|---|
| `SYNCLABS_BASE_URL`, `WAV2LIP_API_URL` | Both providers deprecated — and the whole lip-sync feature is unreachable (editor mounted nowhere, no API key anywhere). **Delete the feature.** | [FILM-513](../phase-5-audio-generation/providers/FILM-513-retire-lip-sync.yaml) |
| `LOCAL_API_URL` | **Keep** — for testing local models. The `local` provider is already an OpenAI-compatible client, i.e. the Ollama path; retarget it, gate it to dev/test with FILM-1801's rules, validate the URL, and add `LLM_FORCE_PROVIDER=local` so the prompt executor actually uses it | [FILM-1805](../phase-18-local-vendor-sandbox/FILM-1805-local-models-and-sdk-base-urls.yaml) §4 |
| `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `GOOGLE_GEMINI_BASE_URL` (+ `GOOGLE_VERTEX_BASE_URL`, same class) | The SDKs read these only when no base URL is passed; ours pass none. **Pass `vendorUrl()` explicitly** at every construction site; prove per SDK against a local listener under production settings that 0 requests arrive | FILM-1805 §3 |

**No production credentials, config or values are used or requested at any
point** (standing owner rule). Every proof is local.

### Acceptance criteria

- [ ] FILM-513 landed: the two lip-sync variables no longer exist in source
- [ ] FILM-1805 landed: the three SDK variables provably ignored under production settings; `LOCAL_API_URL` gated and validated
- [ ] A set-but-ignored variable is logged by name at server start (never by value), as FILM-1801 already does for `VENDOR_URL_*`
- [ ] Then this entry moves to *Fixed* with both PR numbers

---

## KB-22 — Disconnecting a platform deletes the creator's own records, and says nothing

**Severity:** **High** — irreversible loss of user-entered data from one
click, behind a dialog that describes something else. **Found:** KB-20's
drafting (2026-09-22), when "what does disconnect remove?" turned out to have
an answer nobody had written down. It also corrects KB-20, whose first version
asserted the opposite. **Open.**

The disconnect dialog says, in full (`platforms:disconnectDescription`):
*"This will remove access to {{accountName}}. You won't be able to publish to
this account until you reconnect."*

What it does: every disconnect path ends in a `DELETE` on
`platform_connections`, and the schema takes it from there
(`pg_constraint` on the live local database, 2026-09-22):

```
platform_connections
 └─ publishes                     ON DELETE CASCADE   (20251205125737_film-studio-tables.sql:471)
     ├─ revenue_records           ON DELETE CASCADE   ← includes source = 'manual'
     ├─ publish_tags              ON DELETE CASCADE   ← the creator's own tagging
     ├─ experiment_publishes      ON DELETE CASCADE   ← experiment membership
     └─ manual_tasks              ON DELETE CASCADE
 ├─ episode_publishing_configs    ON DELETE CASCADE
 ├─ project_publishing_configs    ON DELETE CASCADE
 ├─ youtube_report_jobs           ON DELETE CASCADE
 └─ channel_analytics_settings    ON DELETE CASCADE   ← YPP targets (FILM-1608)
```

### Reproduced (local database, rolled-back transaction, by the KB-20 teammate)

Deleting one `platform_connections` row: its `publishes` went **1 → 0**, and
`revenue_records` **162 → 158** — three `source = 'api'` rows **and one
`source = 'manual'` row**, a figure a person typed in. Rolled back; 162 again.

### And the other half is wrong in the other direction

Vendor per-video data lives only in ClickHouse, in seven tables —
`video_metrics`, `video_audience`, `video_traffic_sources`,
`video_reach_daily`, `video_retention_curves`, `video_snapshots`, `video_dim`.
There is no `TTL` and no `DELETE` anywhere in `packages/clickhouse/src`. So
after a disconnect those rows **stay forever, orphaned** — the `publishes`
rows that gave them an owner are gone, which also means nothing can later find
them to delete on request.

So one click today:

| | Does | Should (owner's decision + YouTube's policy, KB-20) |
|---|---|---|
| Postgres — the creator's own entries (manual revenue, tags, experiment membership, YPP targets) | **deleted, silently** | kept — always. It is their data, not the vendor's |
| Postgres — the publish record itself | deleted | kept: it is the history of what was published, and the only key to the ClickHouse rows |
| ClickHouse — vendor analytics | **kept forever** | deleted on request; for YouTube within 7 days of an in-app disconnect, 30 of a dead token |

What is **not** affected (checked): a token expiring only sets
`is_active = false` (`token-refresh.ts:278`) and a reconnect upserts — the OAuth
callbacks delete `oauth_states` rows, not connections. So the owner's
"disconnected by mistake / token expired / back after five months" cases lose
nothing **unless someone presses Disconnect**. That is the button this entry
is about.

### Proposed fix — with KB-20 item 3, as one design

- **Disconnect stops deleting the row.** Revoke at the vendor, wipe the
  encrypted tokens, mark the connection disconnected — keep the row, so
  `publishes` and everything under it survive. A reconnect of the same platform
  account re-attaches to it. (`publishes.platform_connection_id` becoming
  `SET NULL` is the blunter alternative; it keeps the publish and loses which
  channel it went to — worse for a multi-channel account.)
- **Vendor data deletion becomes a deliberate, scoped job** — by connection,
  across all seven ClickHouse tables and `revenue_records where source='api'`
  — driven by the policy windows in KB-20, never by a cascade. Manual entries
  are out of its reach by construction, not by care.
- **The dialog tells the truth** about whatever the final behaviour is, and a
  destructive path asks for a typed confirmation.
- **Fix the class:** list every `ON DELETE CASCADE` whose parent is a
  *connection/credential* row and whose child is *user-authored* — a credential
  going away should never be able to delete something a person wrote.

### Acceptance criteria

- [ ] pgTAP, red first: disconnecting leaves `publishes`, manual `revenue_records`, `publish_tags`, `experiment_publishes`, `channel_analytics_settings` intact
- [ ] Reconnecting the same platform account restores the connection to its publishes; analytics resume without duplicates
- [ ] The deletion job removes one connection's vendor rows from all seven ClickHouse tables and `source='api'` revenue — and nothing else; tested with two connections seeded side by side, against the real local ClickHouse
- [ ] Dialog copy matches behaviour; Playwright covers disconnect → reconnect, asserting the manual revenue figure is still there **after** reconnect; screenshots in the PR
- [ ] No production data or credentials are used to verify any of this

---

## KB-23 — A second currency for the same day overwrites the first

**Severity:** Medium — silent loss of a figure the creator typed, and it only
became reachable in practice once revenue was made per-currency (KB-12, #293).
**Found:** KB-12 fix (#293), 2026-09-22, noted as out of scope. **Open.**

`revenue_records` is unique on

```sql
(coalesce(publish_id, account_id), record_date, category, source)
```

(`idx_revenue_records_unique_scope`, read from the live index) — **currency is
not part of the key.** `addManualRevenueAction`
(`packages/features/content-analytics/src/server/revenue-actions.ts`) cannot
name that expression index as an `onConflict` target, so it looks up the
existing manual row by date, category and scope and replaces it. That lookup
does not filter on currency either.

So a creator who records a **€50** sponsorship and a **$100** sponsorship
against the same video, on the same date, in the same category, ends up with
whichever they entered last. No error, no warning; the form resets as for any
successful save.

**Confirmed by reading the index and the action; not yet driven through the
form.** The reproduction is two saves and a reload.

### Proposed fix

- Add `currency` to the unique key (hand-written migration; check for existing
  collisions first — there can be none today, since the key forbids them) and
  to the action's lookup.
- The form's "replace existing entry" behaviour then means *same currency*;
  say so where the form tells the user an entry was updated rather than added.
- pgTAP for the index; a Playwright spec that saves €, then $, reloads, and
  finds **both** — asserted on the second submission, which is where form-state
  bugs in this form have lived before (FILM-1609).

### Acceptance criteria

- [ ] Two manual entries differing only in currency coexist — pgTAP and E2E, red first
- [ ] Same scope/date/category/**currency** still replaces, not duplicates
- [ ] Types regenerated, not hand-edited; screenshots of the form after the second save

---

## KB-24 — The revenue projection and the entry form disagree about what day it is

**Severity:** Low — a wrong-looking `0` for a few hours a day, east of UTC;
nothing is stored wrongly. **Found:** KB-12 fix (#293), 2026-09-22; measured by
that teammate at 03:30 IST. **Not re-run by the coordinator. Open.**

`getRevenueProjectionAction`'s window ends at the **server's UTC today**; a
manual revenue entry is dated the **browser's local today**. Between local
midnight and UTC midnight — 00:00 to 05:30 in India — a fresh entry is dated
"tomorrow" as far as the projection is concerned, so a just-saved €50 shows a
`€0` projection.

It is the same two-clock class FILM-1610 met in the experiment log, where
`localToday()` was introduced for exactly this. #293 added the missing query
invalidation on save (the projection was never refreshed at all) but left the
window alone.

### Proposed fix

- One definition of "today" for revenue: the caller passes its local date
  (`asOf`), as the experiment log's actions do, and the projection window is
  built from it. **Fix the class:** grep the revenue and analytics actions for
  `new Date()` used as a window boundary and list them.

### Acceptance criteria

- [ ] With the browser clock set east of UTC and the server at UTC just before midnight, an entry saved "today" appears in the projection — Playwright with a fixed clock, red first
- [ ] Every server-side "today" used as an analytics window boundary is listed, each fixed or justified

---

## KB-25 — Disconnecting X or LinkedIn does not revoke anything at the vendor

**Severity:** Medium — the creator believes access is withdrawn and it is not.
The token stays valid at X / LinkedIn until it expires on its own (X refresh
tokens: 180 days by our own config). **Found:** KB-20's drafting (#294),
2026-09-22, while writing down what disconnect does; re-read on `main` by the
coordinator. **Open.**

`connection-actions.ts:130-133`:

```ts
case 'twitter':
case 'linkedin':
  result = await deleteConnection(connectionId);
```

YouTube, TikTok and Meta each go through a platform `disconnect*Action` that
revokes at the vendor first. X and LinkedIn go straight to the row delete.
`oauth/twitter/disconnect.ts` exports `disconnectTwitterAction` — which does
call X's revoke endpoint — and **nothing in the repo calls it**. LinkedIn has
no revoke code at all (`oauth/linkedin/` holds only `config.ts` and
`index.ts`).

The data-deletion page drafted in #294 therefore has to say, truthfully,
"for X and LinkedIn we do not yet ask the platform to revoke" — a sentence
that should not need to exist.

### Proposed fix

- Route `'twitter'` through the existing `disconnectTwitterAction`; add a
  LinkedIn revoke (LinkedIn documents token revocation on its OAuth 2.0
  pages — cite before writing). Design it together with KB-22, which changes
  what `deleteConnection` itself does.
- **Fix the class:** the switch is the shape of the bug — a platform that
  lands in `default`, or in a bare `deleteConnection`, silently skips revocation.
  Make the per-platform disconnect a required member of the provider
  interface, so a sixth platform cannot compile without one.
- Verifying the revoke against X needs the credentials we do not hold
  (FILM-1729); the LinkedIn one likewise. Unit-test that the vendor call is
  made; record the live check in FILM-1725.

### Acceptance criteria

- [ ] Disconnecting X calls X's revoke endpoint; LinkedIn calls LinkedIn's — unit-tested against a local listener, red first
- [ ] No platform can reach `deleteConnection` without a revoke step — enforced by the type, not the switch
- [ ] #294's "we do not yet ask the platform to revoke" sentence removed once true
- [ ] Live revoke on X and LinkedIn — FILM-1725, blocked on credentials

---

## KB-26 — Any signed-in user can read every account's uploaded research sources

**Severity:** High — a cross-tenant read of text a creator uploaded as their own
research. No one is exposed today only because the owner is the only account;
fixing it is a precondition before a second one. **Found:** the spec audit of
FILM-1135 (2026-09-23); reproduced by the coordinator. **Open.**

`external_content` holds both the shared news/research cache and every user
upload — `uploadSourceAction`
(`packages/features/episodes/src/server/source-upload-actions.ts:99-110`) writes
the uploaded text there with the admin client. The table has no account or
project column, and its read policy is:

```sql
create policy "Authenticated users can view content" on external_content
  for select to authenticated using (true);
-- 20260211200000_create_external_context_tables.sql:91-94
```

So the full `content` of every upload is readable, through the Data API, by
any authenticated user in any account. Three more effects of the same design
(read, not reproduced):

- An upload's `external_sources` row is upserted `onConflict: 'slug'`, the
  slug being the lower-cased name — two accounts uploading a source with the
  same name share one row, and the second overwrites the first's URL and
  category. An upload named like a seeded source ("Reuters") rewrites that
  global row as `manual` / `tier_3` for every tenant
  (`source-upload-actions.ts:78`, `:87`).
- Upload names are visible to every account (`"Anyone can view active
  sources"`, `using (is_active = true)`).
- Any user who owns **some** account can add, edit or deactivate the
  platform-wide `external_sources` registry: `requireAccountOwner`
  (`external-context-actions.ts:215`) checks for an owner membership anywhere,
  and the write then goes through the admin client (`:243`, `:288`, `:326`).

### Reproduced (local database, 2026-09-23, in a rolled-back transaction)

A source and a content row inserted the way the upload action writes them,
then read as `authenticated` with a fresh random `sub` that belongs to no
account:

| Statement | Result |
|---|---|
| `select count(*), max(title), max(content) from external_content where external_id = 'manual-audit-probe'` | **1 row** — `Private research notes`, `CONFIDENTIAL draft text` |

Rolled back.

### Proposed fix

- Give uploads an owner: `account_id` (and `project_id`, if uploads belong to
  a project) on `external_content`, set by the action — or move uploads to a
  table of their own. Shared cache rows (news, providers) keep a null owner.
- Replace the `using (true)` read policy: shared rows readable by any
  authenticated user, owned rows only by members of that account
  (`has_role_on_account`).
- Key uploaded `external_sources` by account as well as slug, or stop
  upserting them by name.
- **Fix the class:** list every `using (true)` policy granted to
  `authenticated` in `apps/web/supabase/migrations/`, and say beside each why
  the table holds nothing account-scoped.

### Acceptance criteria

- [ ] pgTAP, red first: a user in another account cannot read an uploaded source's content; a member of the uploading account can; shared news rows stay readable
- [ ] Two accounts uploading a source with the same name get two sources, neither overwriting the other
- [ ] Every `using (true)` policy granted to `authenticated` is listed, with a decision beside each

---

## KB-27 — Any signed-in user can write canon into any project

**Severity:** High — a cross-tenant write. A user with no access to a project
can add permanent canon to it and overwrite an episode's canon summary, and
the forged event carries no author. **Found:** the spec audit of FILM-1002
(2026-09-23); reproduced by the coordinator. **Open.**

`commit_canon_changes`
(`apps/web/supabase/migrations/20260130004332_add_commit_canon_changes_function.sql`)
is `SECURITY DEFINER`, sets no `search_path`, checks no membership, and is
granted to `authenticated` (`:77`). It inserts `immutable_events` for whatever
`p_project_id` it is given and merges `canonSummary` / `sentimentScore` into
whatever `p_episode_id` it is given — the two are not even checked against each
other. `commitCanonChangesAction`
(`packages/features/episodes/src/server/canon-actions.ts:1201`) passes the
client's ids through. Row-level security does not apply inside the function, so
a direct `rpc('commit_canon_changes', …)` from any session reaches every
project. (`anon` has no `EXECUTE`; checked.)

### Reproduced (local database, 2026-09-23, in a rolled-back transaction)

As `authenticated` with a fresh random `sub` that belongs to no account,
against a seeded episode in another account's project:

| Statement | Result |
|---|---|
| `has_role_on_account(<the project's account>)` | `false` |
| `select count(*) from projects where id = <project>` | `0` — the stranger cannot see the project |
| `select commit_canon_changes(<project>, <episode>, 1, 1, '[{"type":"death",…}]', 'FORGED canon summary', 0.10)` | `{"eventsCreated": 1, "summaryStored": true}` |
| afterwards, as postgres | 1 new `immutable_events` row, `created_by` NULL; the episode's `canonSummary` is `FORGED canon summary` |

Rolled back.

### Proposed fix

- Inside the function: require `has_role_on_account` for the project's
  account, require the episode to belong to that project, set
  `created_by = auth.uid()`, and `set search_path = ''` with qualified names.
  Or make it `SECURITY INVOKER` and let KB-17's policies decide — which needs
  KB-17 fixed first.
- **Fix the class:** list every `SECURITY DEFINER` function granted to
  `authenticated` in `apps/web/supabase/migrations/`, with the membership check
  each performs (or why it needs none). KB-11 was the same shape: a
  definer path re-deriving access by hand, or not at all.

### Acceptance criteria

- [ ] pgTAP, red first: a non-member's call is refused and writes nothing; a member's call still commits; an episode from another project is refused
- [ ] Events written by the function carry `created_by` = the caller
- [ ] Every `SECURITY DEFINER` function granted to `authenticated` is listed with its access check, or the reason it needs none

---

## KB-28 — Any signed-in user can upload into any project's storage folder

**Severity:** Medium — a cross-tenant write, bounded: existing files cannot
be overwritten or deleted (those policies are scoped), but new ones can be
planted under another project's path on a **public** bucket, with no size
limit. **Found:** the spec audit of FILM-203 (2026-09-23); the policy read
from the live local database and the insert reproduced by the coordinator.
**Open.**

Live policies on `storage.objects` for the `project-assets` bucket (public,
`file_size_limit` none):

| Policy | Check |
|---|---|
| `project_assets_insert` | `bucket_id = 'project-assets'` — nothing else ("validated at the application layer", `20251207162036_project-assets-bucket.sql:57-60`) |
| `project_assets_update` / `_delete` | `has_role_on_project(kit.get_project_id_from_path(name))` |

The application layer does not close it either. The live upload path,
`apps/web/app/api/storage/presign/route.ts`, authorises on **read** access to
the project (`:111-122`), and a public or unlisted project is readable by any
signed-in user (`20260108120000_public_sharing_rls.sql:28-34`). The bucket
name is taken from the client unchecked (`:37`, `:147`), and since c17efd37
moved uploads to presigned URLs there is no server-side size, type or
magic-byte check (FILM-CC-01's validator is bypassed; the client checks alone,
`use-image-upload.ts:57`). The orphaned FILM-203 route
(`apps/web/app/api/projects/[projectId]/assets/upload/route.ts:51-60`) has the
same read-only check and is still deployed.

### Reproduced (local database, 2026-09-23, in a rolled-back transaction)

As `authenticated` with a fresh random `sub` that has no role on a seeded
project (`has_role_on_project` → `false`): `insert into storage.objects
(bucket_id, name, owner_id) values ('project-assets', '<that project id>/audit-probe/planted.png', auth.uid())`
→ **INSERT 0 1**. That is the row the Storage API writes under the user's
session. Rolled back.

### Proposed fix

- `project_assets_insert` checks what update and delete already check:
  `has_role_on_project(kit.get_project_id_from_path(name))`.
- The presign route authorises on **write** access (a project role, not
  visibility), pins the bucket, and enforces size and type server-side — or
  sets `file_size_limit` and `allowed_mime_types` on the bucket so storage
  enforces them.
- Delete the orphaned FILM-203 route (retired in the 2026-09-23 audit).
- **Fix the class:** list every storage bucket's four policies side by side;
  an insert looser than its delete is the shape of this bug.

### Acceptance criteria

- [ ] pgTAP, red first: a non-member's insert into another project's path is refused; a member's insert succeeds
- [ ] The presign route refuses a user who can read a public project but has no role on it — test red first
- [ ] Size and type are enforced server-side or by the bucket, not only in the browser
- [ ] The orphaned upload route is gone

---

## KB-29 — Token refresh reads app credentials from a table connect stopped writing

> **Fixed (2026-09-23), #310.** Reproduced first on the local stack: with global
> credentials and no `account_oauth_apps` row, YouTube, TikTok, Instagram and
> LinkedIn refresh each returned `REFRESH_FAILED` with **zero** vendor requests
> and deactivated the connection. Connect, callback and refresh now take app
> credentials from one function, `getOAuthAppCredentials`
> (`packages/features/publishing/src/server/oauth-app-credentials.ts`): the
> global table for YouTube and Meta, env for TikTok, LinkedIn and X. Missing
> credentials now return `APP_NOT_CONFIGURED` and leave the connection active,
> so fixing the configuration heals every connection without a reconnect.
> `account_oauth_apps` is no longer read (the table is kept). The admin page's
> TikTok row is saved and ignored — KB-36. Design and the owner's pre-deploy
> query: `specs/plans/KB-29-edd.md`.

**Severity:** High if it applies to a live account, and it probably applies to
every account connected since 2026-01-21 — the connection dies at its first
token expiry (about an hour for YouTube), taking the analytics sync with it.
**Found:** the spec audit of FILM-706/707 (2026-09-23); confirmed by the
coordinator by reading, then reproduced on the local stack (see the banner).
**Fixed.**

`3238dd61` (2026-01-21, "move OAuth App Credentials to Super Admin") moved the
YouTube and Meta app credentials to the global `oauth_app_credentials` table:
connect and callback now call `getGlobalOAuthCredentials`
(`apps/web/app/api/platforms/connect/youtube/route.ts:61`,
`callback/youtube/route.ts:98`, and the same for Meta). TikTok connects with env
keys. **Refresh was not moved.** `refreshYouTubeToken`, `refreshTikTokToken`
and `refreshMetaToken` still call `getAccountOAuthAppAdmin(accountId, …)`
(`packages/features/publishing/src/lib/token-refresh.ts:332`, `:377`, `:428`),
which reads the per-account `account_oauth_apps` and returns `null` when there
is no row (`src/server/account-oauth-actions.ts:67-90`) — no fallback to the
global credentials. Refresh then throws "OAuth credentials not configured for
this account" and the connection is set inactive. The only writer of
`account_oauth_apps`, `OAuthAppConfig`, has been rendered by no page since
that commit.

The analytics sync takes the same path: `analytics-sync-cron.ts:459-460` and
`asset-duration-sync.ts:112` call `ensureValidToken`. LinkedIn is worse: its
refresh looks up `platform = 'linkedin'` under a `@ts-expect-error`
(`token-refresh.ts:516-520`), which the table's `CHECK` does not allow
(`20260102221811_add_account_oauth_apps.sql:8`), so no LinkedIn token can ever
be refreshed. The passing unit test mocks the lookup
(`__tests__/token-refresh.test.ts:55`), and the YouTube and TikTok refresh
tests call `fetch` themselves before asserting it was called (`:199`, `:235`),
so no test could have seen this.

**Whether it bites the owner today depends on production data** that this entry
does not read: an account holding a pre-2026-01-21 `account_oauth_apps` row for
the platform refreshes fine. The owner can check with one query in the
production dashboard — `select platform from account_oauth_apps where
account_id = '<their account>'` — or by whether a YouTube connection stays
active past its first hour.

### Proposed fix

- One source of app credentials for connect **and** refresh: refresh reads
  `getGlobalOAuthCredentials(platform)` (env for TikTok, as connect does), with
  a per-account override only if that is still a product decision.
- LinkedIn gets credentials the same way, and the `@ts-expect-error` goes.
- Replace the two self-fulfilling refresh tests with ones that call
  `refreshTokenForPlatform` against a local listener — seen red on today's
  code first.
- **Fix the class:** the credential lookup is the same rule stated in two
  places (connect, refresh); make it one function both import.

### Acceptance criteria

- [x] Unit, red first: an account with global credentials and no `account_oauth_apps` row refreshes YouTube, Meta and TikTok tokens
- [x] LinkedIn refresh works without `@ts-expect-error`
- [x] Connect and refresh import one credential lookup
- [x] No refresh test asserts a `fetch` it made itself

---

## KB-30 — Every YouTube upload declares "not made for kids", with no way to change it

**Severity:** Medium — a compliance risk that depends on the channel: YouTube
requires each upload's audience to be declared (COPPA), and for a channel
whose content is made for children a wrong declaration is the creator's
liability. **Found:** the spec audit of FILM-710 (2026-09-23); confirmed by
the coordinator by reading. **Open.**

The live publish screen builds YouTube payloads with `platformSpecific: {}` —
only Facebook gets a value (`{ isReel: true }`) —
(`apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/publish/_components/publish-screen.tsx:845`,
`:872`, `:1070`, `:1113`). Both upload paths then default the audience and
category: `madeForKids ?? false`, `categoryId ?? '22'`
(`packages/features/publishing/src/server/publish-actions.ts:682-685`;
`apps/web/lambda/publish-worker/handlers/youtube.ts:39-45`, which also sets
`selfDeclaredMadeForKids: false`). The only control that could set them is in
`platform-specific-settings.tsx`, rendered only inside `MetadataEditor`, which
no page has rendered since `baa752eb` (FILM-710, retired in the 2026-09-23
audit). The tags placeholder reads "animation, kids, story"
(`publish-settings-sidebar.tsx:86`).

### Proposed fix

- An audience choice on the publish screen, per project or per episode, that
  YouTube uploads send explicitly — with no default the user has not seen.
- Category chosen the same way, or at least not silently `22`.
- The owner decides the right audience for their own channel; the product's
  job is to ask, not to assume.

### Acceptance criteria

- [ ] A YouTube publish sends the audience the user chose; with none chosen, publishing asks rather than defaulting — Playwright, asserted on the request payload, red first
- [ ] The lambda path sends the same value as the in-app path

---

## KB-31 — Story ideation builds its prompt from any episode, for any caller

**Severity:** Medium — an indirect cross-tenant read: a signed-in user who has
another account's episode id gets back LLM output built from that account's
characters, locations, verified facts and season premise. It needs the id — a
UUID, not guessable — which is what keeps this below High. **Found:** the spec
audit of FILM-305 (2026-09-23); confirmed by the coordinator by reading. **Not
run**: the LLM worker consumes SQS, which has no local equivalent (phase 18
README, *Known limits*). **Open.**

`generateStoryIdeasAction`
(`packages/features/episodes/src/server/story-actions.ts:54-117`) authenticates
the user and queues `data.episodeId` as given — it never reads the episode
through the user's client, so RLS is never asked. The worker runs on the
service-role key (`apps/web/lambda/llm-worker/index.ts:71`) and
`processStoryIdeation` builds the whole prompt context from that id
(`apps/web/lambda/llm-worker/handlers/story-ideation.ts:65`,
`buildEpisodeContext`), then returns the ideas to the requesting user. It also
attributes the job's LLM usage to the caller's *first* account membership, not
the episode's account (`story-actions.ts:74-95`).

**Fix the class, not this action:** 52 call sites queue LLM jobs, across
episodes, audio, analytics and research (`git grep -w queueLlmJob`), and the
worker trusts every id in every payload. Each action must prove the caller can
read what it names before queueing — a read through the user's client, the
shape `has_role_on_account` guards everywhere else — or the worker must check
membership itself against the payload's `userId`.

### Proposed fix

- Every `queueLlmJob` caller reads its target (episode, project, account)
  through the user's client first and refuses when RLS returns nothing; the
  payload carries the account that owns the target, not the caller's first
  membership.
- Or, in one place: the worker verifies `userId`'s membership of the target's
  account before building any context.

### Acceptance criteria

- [ ] Unit, red first: `generateStoryIdeasAction` refuses an episode id the caller cannot read, and queues nothing
- [ ] Every `queueLlmJob` call site is listed with the read that authorises it
- [ ] LLM usage is attributed to the target's account

---

## KB-32 — Every edit-suite export render fails before FFmpeg runs

**Severity:** High — the export button can never produce a video. It fails
at step 1, before any rendering or cost. **Found:** KB-14, 2026-09-23.
**Open.**

`apps/web/lambda/render-worker/index.ts` asks for columns the edit-suite
tables do not have:

| Query | Selects (missing) | The table has |
|---|---|---|
| `edit_projects` update…select (`:170-178`) | `metadata`, `canvas_width`, `canvas_height`, `duration_ms` | `width`, `height`, `fps` |
| `edit_clips` (`:196-199`) | `duration_ms`, `source_url`, `source_type`, `params`, `content_type`, `trim_start_ms`, `trim_end_ms` | `end_ms`, `in_point_ms`, `out_point_ms`, `media_url`, `speed`, `fade_in_ms`, `fade_out_ms` |
| `edit_transitions` (`:207-209`) | `clip_id` | `from_clip_id`, `to_clip_id` |
| `edit_keyframes` (`:211-213`) | `time_ms` | `offset_ms` |

(`20260219083555_edit-suite-v2.sql`; no later migration adds any of them.)
`handlers/ffmpeg-render.ts` is written against the **real** columns
(`project.width` for the scale filter, `clip.in_point_ms`, …), so the two
halves of the worker disagree. KB-14's typecheck shows it as four errors at
the `processFFmpegRender` call, marked `@ts-expect-error KB-32`. Those markers
fail the build (TS2578) as soon as this is fixed, and must be removed then.

### Reproduced (local database, 2026-09-23, through supabase-js as the worker's service role)

The worker's step-1 request, verbatim, against a seeded `edit_projects` row:

| Request | Result |
|---|---|
| `update edit_projects set render_status='rendering' … select id, …, metadata, canvas_width, canvas_height, fps, duration_ms` | `42703 column edit_projects.canvas_height does not exist` |
| `render_status` afterwards | `none` — the update never happened |
| Control: `select id, width, height, fps` on the same row | `{"width":1920,"height":1080,"fps":30}` |

So the worker throws `Edit project not found` on every job. Reachable from
`packages/features/edit-suite/src/components/export/export-dialog.tsx` via
`render-actions.ts`.

### Proposed fix

- Select the real columns and map them to the renderer's types in one place.
  Better still, type the worker's client with `Database` so a missing column
  is a compile error.
- Rebuild the clip filter (`is_active`, `language`, the track mute) on the
  real columns.

### Acceptance criteria

- [ ] No `KB-32` marker remains under `apps/web/lambda/`
- [ ] Red first: the step-1 query above succeeds against a local database
- [ ] One export renders end to end from seeded clips, and its output duration and resolution are checked

---

## KB-33 — LLM-worker payloads are cast, not validated

**Severity:** Low — nothing is known to send a bad payload, and a bad one
fails late and obscurely rather than doing harm. **Found:** KB-14, 2026-09-23.
**Open.**

Twelve `llm-worker` handlers take `payload: Record<string, unknown>` straight
off SQS and cast it to their payload type:
`analytics-insights`, `asset-creation`, `batch-translate-metadata`,
`fact-extraction`, `language-insights`, `screenplay-conversion`,
`season-analysis`, `season-outline`, `shot-generation`, `story-generation`,
`story-ideation` and `translate-dialogue` (each marked `KB-33` at the cast).
`story-refinement` and `screenplay-refinement` do the same. Nothing checks
the shape, so a missing or renamed field surfaces as `undefined` somewhere
deep in the handler — typically in a prompt, or in a query that then matches
nothing. Three handlers already validate with zod at this boundary
(`audio-cue-generation`, `audio-file-generation`, `dialogue-voice-generation`).

**Reproduced:** under KB-14's typecheck each of the twelve was TS2352
("neither type sufficiently overlaps") before it was made an explicit
`as unknown as` cast. The cast is what the code always did at runtime; the
marker records that it is unvalidated.

### Proposed fix

- One zod schema per payload, parsed at the top of each handler, exported
  from where the producer (`queueLlmJob` caller) can use it too, so the two
  sides share one definition.
- Audit each producer before tightening a schema: a schema stricter than what
  is sent would reject real jobs.

### Acceptance criteria

- [ ] No `KB-33` marker remains under `apps/web/lambda/`
- [ ] Each payload has one schema, used by its producer and its handler
- [ ] Unit: a payload missing a required field is refused with a message naming it

---

## KB-34 — The WebSocket handlers are not typechecked

**Severity:** Medium — the same gap KB-14 closed for `lambda/`, on the code
that authenticates every realtime connection. **Found:** KB-14, 2026-09-23.
**Open.**

`apps/web/websocket/` (the SST handlers `connect`, `disconnect`, `default`,
plus `utils/` and tests — 10 files) is included by no tsconfig.

**Reproduced** (2026-09-23, KB-14's lambda config pointed at `websocket/`):
**133 errors**. 119 are in `__tests__/`, which call the handlers with one
argument where the `Handler` type takes three and read `statusCode` off a
`void | …` result. 14 are in the handlers:

- `connect.ts:26-46` ×9: `event.headers` / `queryStringParameters`, which
  `aws-lambda`'s `APIGatewayProxyWebsocketEventV2` does not declare (the
  `$connect` event carries them at runtime — likely a type gap, to confirm)
- `default.ts:212-214` ×3: properties read off a union without narrowing
- `default.ts:32`: the `ws` realtime transport typing KB-14 met in the lambdas
- `utils/auth.ts:1`: `jose` does not resolve from `apps/web`

### Proposed fix

Mirror KB-14: `apps/web/websocket/tsconfig.json`, a third command in `web`'s
`typecheck` script, then triage the 133 the same way.

### Acceptance criteria

- [ ] `tsc --listFilesOnly` under CI's typecheck lists the websocket files
- [ ] Zero type errors under `apps/web/websocket/`, each fixed or explained
- [ ] A type error introduced in a handler fails CI — demonstrated, then reverted

---

## KB-35 — Semantic previous-episode search never ran in the LLM worker

**Severity:** Low — a feature gap, not a regression: story prompts have always
used the sequential previous episodes. **Found:** KB-14, 2026-09-23.
**Open.** The dead code was removed in KB-14's PR; this entry records the gap.

`buildEpisodeContext` (`apps/web/lambda/llm-worker/utils/context-builder.ts`)
had a branch that fetched thematically similar episodes through
`@kit/embeddings/voyage-client` when called with `useSemanticSearch = true`.
It could not run, three ways over:

- **No caller turned it on.** All six callers (`story-ideation`,
  `story-generation`, `shot-generation`, `screenplay-conversion`,
  `story-refinement`, `screenplay-refinement`) used the default `false`.
- **The module does not resolve from the worker.** `@kit/embeddings` is not a
  dependency of `apps/web` (`require.resolve` fails from there; TS2307 under
  KB-14's check). esbuild downgrades an unresolvable `import()` inside `try`
  to a warning, so the bundle would have thrown at runtime and fallen back.
- **It would have thrown if it had resolved.** `voyage-client.ts` imports
  `server-only` and calls `getSupabaseServerAdminClient`, both Next-side.

### Proposed fix

If semantic continuity is wanted: a worker-safe embeddings client (no
`server-only`, the worker's own service client), a dependency the bundle can
resolve, and callers that opt in — then a test that the similar episodes reach
the prompt.

### Acceptance criteria

- [ ] Owner decides whether semantic previous-episode context is wanted
- [ ] If so: one caller opts in and a test shows similar episodes in the prompt

---

## Fixed

| ID | Bug | Fixed in |
|---|---|---|
| — | `analytics_experiments`, `content_tags`, `hook_tests` authors blocked user deletion | #264 |
| — | GitHub deploy workflows never applied migrations; tests could not stop a deploy | #264 |
| — | CI tested `@kit/mailers-core`, which does not exist; `@kit/mailers` never ran | #264 |
| — | The experiment lifecycle was held only by the actions; a direct API call could reopen, back-date or forge an experiment | #264 (round 4) |
| KB-6 (part) | Experiment log and note refusals replaced in production | #264 (round 4) |
| KB-6 (part) | Projects and episodes/studio refusals replaced in production; shared `returnRefusals` helper and guard | #296 |
| KB-6 (part) | Assets, audio, publishing, analytics, edit-suite and admin refusals replaced in production | #303 (re-land of #299) |
| KB-9, KB-10 | Hook Lab: a cross-tenant retention read, and a feature that could not be used and measured the wrong point | #269 (removed) |
| KB-11 | Another account could read a public project's analytics | FILM-1615 Step 0 |
| KB-1 | Deleting a user who had created anything failed: seventeen authorship keys to `auth.users` had no ON DELETE action, and three triggers refused or undid the key's own set-null | #290 |
| KB-12 | Revenue was added across currencies | #293 |
| KB-16 | The Overview tab drew figures nobody measured: a fixed share donut, a 70/30 revenue split, canned footers, +100% beside every metric | #300 |
| KB-19 | A failed platform connect landed on a 404 and logged nothing | #297 |
| KB-29 | Token refresh read app credentials from a table nothing had written since 2026-01-21, so connections died at their first expiry; LinkedIn could never refresh | #310 |
| KB-41 | Any signed-in user could list any project's members with their emails, public or private; `get_project_members` now requires access to the project's account | #319 |
| — | A server action after the session ended showed "An unexpected response was received from the server" instead of going to sign-in: middleware redirected the action's request, which Next's client cannot follow. Fixed for every action under `/home` | #264 (round 5) |
| KB-14 | The lambdas were not typechecked; with them checked, story and screenplay refinements are recorded (the job-type constraint refused them) and the duplicate `verifiedFacts` key is gone | #309 |
| KB-52 | Every signed-in user could read, rewrite, forge and delete every account's `llm_usage_analytics` rows: a policy with no `TO` clause and `using (true)`; writes are now service-role only, and a pgTAP guard fails any new policy of that shape | #321 |

---

## Leads from the 2026-09-23 spec audit — read, not reproduced

**These are not entries.** The rule above holds: an entry is reproduced before
it is written down. Thirteen auditors reading the code against the specs found
more than 80 possible bugs; the ones below are those most likely to matter to a
user. Each was seen in the code and has **not** been run. When one is worked,
reproduce it first and move it up as a KB entry, or strike it here with what
proved it wrong. Paths abbreviated with `…/studio/` are under
`apps/web/app/home/[account]/studio/[projectSlug]/`.

**Analytics correctness**
- `channel_daily`: the reach and basic report branches write rows on one ReplacingMergeTree key, each zeroing the other's columns, so whichever lands later zeroes that day's residual watch time (a YPP input) or impressions — `packages/features/content-analytics/src/server/reporting/report-ingest.ts:349`, `:403`; `packages/clickhouse/src/migrations/003_reach_and_traffic.ts:56`
- The Analytics-API sync re-fetches three days and overwrites Reporting-API-only columns (`subscribers_lost`, `dislikes`, `avg_view_percentage`) with zeros — `packages/features/content-analytics/src/server/ingest.ts:81`, `:124`
- The scheduled raw CSV repeats the period's total impressions on every daily row, and CTR/AVD are period rates repeated per day — `apps/web/app/api/reports/scheduled/route.ts:517-519` (FILM-1601)
- Instagram's never-requested `follows` is stored as `subscribers_gained = 0` — `packages/features/content-analytics/src/server/analytics-sync-cron.ts:915` (FILM-803; FILM-1712 covers the class)
- Audience breakdowns mix fetches: `argMax` per key keeps a country or OS missing from the latest fetch at its old value — `packages/clickhouse/src/queries-detail.ts:246`
- The YouTube backfill can stall for good behind 50 permanently failing publishes, retried first each run — `packages/features/content-analytics/src/server/backfill/youtube-backfill.ts:253`, `:20`

**UI that is broken or says something untrue**
- The AI Insights tab renders nothing: the worker's `{ success, data }` is stored without unwrapping — `packages/features/content-analytics/src/components/ai-insights.tsx:52`; the Language insights card likely crashes on the same shape — `language-insights-cards.tsx:184`, `:272`
- The canon dashboard's Facts tab is always empty and its badge never shows — regression `3581f78f`: `…/studio/episodes/[episodeSlug]/story/_components/episode-facts-panel.tsx:61` expects an array, `packages/features/episodes/src/server/episode-fact-actions.ts:178` returns `{ facts, totalCount }` (FILM-1142)
- Every studio page load sends a failing request: the sidebar filters `external_content.project_id`, a column that does not exist — `…/studio/layout.tsx:84`
- Visual Studio's "Generate All Pending" and "Regenerate" toast success and do nothing; "Replace" discards the chosen file; the "Add New Shot" tile has no handler — `…/studio/episodes/[episodeSlug]/visual-studio/_components/visual-studio-screen.tsx:240`, `shot-details-sidebar.tsx:332`, `:835`, `shot-grid.tsx:54`
- An assembled VEO prompt over 2,000 characters cannot be saved: update caps `prompt` at 2000, create allows 8000 — `packages/features/episodes/src/lib/schemas/shot.schema.ts:194`
- Edit suite: the Inspector says "Coming soon", so speed, fades and keyframes cannot be edited; the Snap toggle is never read; clips on a locked track can be moved and deleted; many edits bypass undo — `packages/features/edit-suite/src/components/inspector/inspector-panel.tsx:37`, `timeline/clip-block.tsx:172`, `timeline/track-row.tsx:303` (PHASE-14, FILM-601, FILM-602)
- Settings still ask for, and validate against the vendor, Kling/Runway/Hailuo keys (retired) and OpenAI/Claude/Gemini keys that nothing reads — `apps/web/app/home/[account]/settings/_components/api-keys-settings.tsx:55-125`; the project form saves "Default Video Provider" and "Enable Subtitles", which nothing reads — `apps/web/app/home/[account]/studio/projects/new/_components/create-film-project-form.tsx:131`, `:705`
- X and LinkedIn cannot be connected or published from the UI, yet the social-post page tells creators to "Connect one in Settings → Platforms" — `packages/features/publishing/src/components/platform-connections.tsx:90`, `packages/features/publishing/src/lib/constants.ts:45-51`, `apps/web/app/home/[account]/social-posts/[postId]/_components/social-post-detail.tsx:381`

**Studio data**
- Shots: soft-deleted rows keep their `sequence_number` under a non-partial unique key, so reorder, close-gap and add-after-delete collide, and the reorder loop ignores the error — `packages/features/episodes/src/lib/server/mutations/shot-actions.ts:425-431`, `:45`, `:125`; `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:331`
- A deleted asset's name cannot be reused: `unique(project_id, type, name)` counts soft-deleted rows (seasons got the partial-index fix, assets did not) — `20251205125737_film-studio-tables.sql:134`
- ~~Story generation can drop project facts: a duplicate `verifiedFacts` key lets episode facts, or `undefined`, overwrite them — `apps/web/lambda/llm-worker/handlers/story-generation.ts:323`, `:329` (TS1117, hidden by KB-14)~~ **Resolved by KB-14 (#309), and overstated:** both keys were built from the same rows — the facts linked to this episode through `episode_facts` (`context-builder.ts` `fetchEpisodeFacts` and the linked-facts query) — and differed only in framing ("NON-NEGOTIABLE constraints" vs "use accurately"). No fact was dropped. The later key always won at runtime, so KB-14 removed the earlier one and kept the prompt exactly as it was (owner decision, 2026-09-23).
- Episode numbers can repeat: `createEpisode` relies on a unique constraint no migration creates — `packages/features/episodes/src/server/actions.ts:67`
- Resetting an episode leaves canon rows behind: `character_states` and `state_deltas` have no DELETE policy, so the user-client delete removes nothing and raises nothing — `packages/features/episodes/src/server/actions.ts:1227`, `:1241`
- `reel_note` is passed to the shot director and never interpolated into the prompt — `packages/features/prompt-engine/src/prompts/story-generation/scene-shot-generation.json:128`
- The assets page caches its project lookup for an hour by slug alone, with no account in the key or the query, so another account's same-slug project can be served — `…/studio/assets/page.tsx:79-90`
- Asset delete fails open: a failed in-use check deletes anyway — `packages/features/assets/src/lib/server/asset.queries.ts:139-143`, and bulk delete goes straight to confirmation — `packages/features/assets/src/components/asset-gallery.tsx:222-224` (FILM-201)

**Audio**
- Voice `speed` is accepted and never sent to ElevenLabs — `apps/web/lambda/voice-worker/voice-generation.ts:204`
- Batch dialogue: an SQS redelivery counts a failure again, so a batch can close while lines are still queued; a cancelled batch keeps generating, at cost, and is then marked completed — `apps/web/lambda/voice-worker/index.ts:291`; `apps/web/supabase/migrations/20260527094643_increment_batch_progress_rpc.sql:64`
- A 429 is treated as permanent, with no backoff, for every provider built on `fetchWithRetry` — `packages/features/audio-generation/src/lib/http.ts:72`

**Publishing and vendors**
- TikTok direct posting calls `/v2/post/publish/video/init/`, but connect never requests `video.publish`; the immediate path also sends an undocumented `privacy_level: 'PUBLIC'` and `video_upload_id` — `packages/features/publishing/src/providers/tiktok/tiktok-provider.ts:264`, `apps/web/lambda/publish-worker/handlers/tiktok.ts:16`, `packages/features/publishing/src/oauth/tiktok/config.ts:12` (the FILM-1729 class)
- One channel still cannot be connected for two languages: the shorts migration dropped a constraint name that never existed, so the three-column key survives — `apps/web/supabase/migrations/20260101120000_add_shorts_tables.sql:236`
- Token refresh: a failed lock retries every second with no cap — `packages/features/publishing/src/lib/token-refresh.ts:180-183`; the expiring-connections read is unpaged, under the 1000-row cap — `packages/features/publishing/src/jobs/refresh-expiring-tokens.ts:75-81`

**Facts, news and the rest**
- Fact search passes raw input to `to_tsquery`, so a trailing space likely breaks the page, and the claim query cannot use its full-text index — `packages/features/episodes/src/server/fact-actions.ts:298`
- Each uncached news search calls NewsAPI once per active source (12 seeded) with identical parameters — `packages/features/episodes/src/lib/server/services/context-aggregator.ts:229`
- `/sitemap.xml` has two handlers — `apps/web/app/sitemap.ts:13`, `apps/web/app/sitemap.xml/route.ts:16`
- Two status colours fail WCAG AA 4.5:1 on small badges — `apps/web/styles/shadcn-ui.css:51`, `:55`
- The live Suno dialogs need `SUNO_API_KEY`, which `sst.config.ts` does not pass to the server (production config not checked, by rule) — `packages/features/audio-generation/src/server/music-actions.ts:83`
