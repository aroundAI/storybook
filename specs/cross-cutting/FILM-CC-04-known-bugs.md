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

- [ ] pgTAP: a user who created a project, a membership, a verified fact
      and a social post can be deleted; each row stays with a null author
- [ ] E2E: "delete user flow" runs with a user who has created a project
      and fails if the delete is refused
- [ ] The query above returns no rows for authorship columns

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

Everywhere else is unchanged. These 54 client files show
`error.message` from a caught error. (Corrected 2026-09-20: the first count
of 48 searched one line at a time and missed six files that split the
expression across lines, Hook Lab's among them. The experiment log's two
files also match, and are fixed: they show a message `unwrap` returned.) Not all of those errors come from a
server action (some are `fetch` or client-only), so each one needs
triage:

- `apps/web/app/home/(user)/_components/delete-project-dialog.tsx`
- `apps/web/app/home/[account]/_components/delete-project-dialog.tsx`
- `apps/web/app/home/[account]/settings/_components/api-keys-settings.tsx`
- `apps/web/app/home/[account]/settings/platforms/youtube/select-channel/_components/channel-picker.tsx`
- `apps/web/app/home/[account]/social-posts/[postId]/_components/social-post-detail.tsx`
- `apps/web/app/home/[account]/social-posts/_components/social-posts-dashboard.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/audio-library/_components/batch-generate-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/audio-library/_components/generate-audio-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/audio-library/_components/upload-audio-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/_components/quick-actions-menu.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/audio-studio/_components/dialogue-timeline.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/publish/_components/publish-screen.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/story/_components/add-event-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/story/_components/add-thread-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/visual-studio/_components/frame-uploader.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/visual-studio/_components/shot-details-sidebar.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/bulk-generate/assets-phase.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/bulk-generate/ideation-phase.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/bulk-generate/shots-phase.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/bulk-generate/story-phase.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/create-episode-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/create-episode-wizard.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/export-content-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/generate-all-sound-modal.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/season-generator-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/season-header.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/settings/_components/audio-settings-form.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/settings/_components/canon-settings-form.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/settings/_components/studio-settings-form.tsx`
- `apps/web/app/home/[account]/studio/projects/new/_components/create-film-project-form.tsx`
- `packages/features/assets/src/components/asset-gallery.tsx`
- `packages/features/assets/src/components/character-editor/CharacterEditor.tsx`
- `packages/features/assets/src/components/location-editor.tsx`
- `packages/features/audio-generation/src/components/LipSyncEditor.tsx`
- `packages/features/audio-generation/src/components/VoiceCloningEditor.tsx`
- `packages/features/auth/src/components/auth-error-alert.tsx`
- `packages/features/content-analytics/src/components/export-reports.tsx`
- `packages/features/content-analytics/src/components/manual-revenue-form.tsx`
- `packages/features/content-analytics/src/components/scheduled-reports-manager.tsx`
- `packages/features/content-analytics/src/components/taxonomy/tag-manager.tsx`
- `packages/features/edit-suite/src/components/export/export-dialog.tsx`
- `packages/features/episodes/src/components/batch-episode-creator/batch-episode-creator.tsx`
- `packages/features/episodes/src/components/continuity-checker.tsx`
- `packages/features/episodes/src/components/refinement-chat.tsx`
- `packages/features/projects/src/components/add-project-member-form.tsx`
- `packages/features/projects/src/components/create-project-form.tsx`
- `packages/features/projects/src/components/update-project-form.tsx`
- `packages/features/publishing/src/components/upload-only-mode.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/audio-studio/_components/add-music-cue-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/audio-studio/_components/generate-scene-music-dialog.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/bulk-generate/screenplay-phase.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/hooks/_components/hook-lab-client.tsx`
- `apps/web/app/home/[account]/studio/[projectSlug]/research/_components/upload-source-dialog.tsx`
- `packages/features/assets/src/components/voice-profile-editor.tsx`

**Fix, per surface:** return expected refusals as values, the repo's
existing `{ success: false, error }` pattern (71 actions already do).
Assert the message *text* in an E2E test that runs on a production build.
A test that only checks that an error is visible passes on the generic
sentence too.

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
[FILM-1724 channel experiments](../phase-17-analytics-provenance/FILM-1724-channel-experiments.md)
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
(finding F-2), 2026-09-20. **Open**, except in the Video Log.

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
currency select (`manual-revenue-form.tsx`), and the bulk import beside it
(`revenue-actions.ts`, `record.currency ?? 'USD'`) — a sponsorship paid in
euros, entered as euros. That makes this rarer than the entry's first
paragraph suggests, and means the ClickHouse side (`video_metrics.revenue_cents`,
no currency column) is USD **by construction today** — which the fix should
state and guard, because it stops being true the day a provider reports in
the channel's own currency.

**How to reproduce:** add two `revenue_records` for one publish with
different `currency` values, and read the revenue mix or the account
dashboard: one number, neither currency.

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
**Open.**

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

- [ ] `tsc --listFilesOnly` under CI's typecheck lists the lambda files
- [ ] Zero type errors under `apps/web/lambda/`, each of today's 82 fixed or explained
- [ ] A type error introduced in a handler fails CI — demonstrated, then reverted

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
as outside its file map. **Open.**

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

- [ ] `no-literal-fallbacks` guard covers every component under `content-analytics/src/components`, seen red on today's code for each row above
- [ ] No share donut, revenue split, projection or canned footer renders without data behind it
- [ ] Revenue split comes from recorded revenue, per currency, or is absent
- [ ] A metric with no previous period shows no change indicator; `calculateChange(n, 0)` no longer reports 100%
- [ ] Playwright evidence: Overview for an account with no breakdown data, and one with real revenue mix — screenshots of both, values read from the DOM

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
- [ ] Canon UI still creates and removes events — existing E2E green

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
against a local server). **Open.**

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

- [ ] Playwright, per platform, seeded via API: a callback hit with `?error=access_denied` and one with a bad `state` both end on a real page showing a message — asserted by text; screenshots in the PR
- [ ] Each failure branch writes one log line; a test asserts no token, `code` or secret appears in it
- [ ] A hostile `error_description` (`<script>`, a long string) is shown inert or replaced
- [ ] `docs/vendor-review-runbook.md` (#289) updated: the pre-deploy check reads the page, not the address bar

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
| **Same policies:** stored API data has retention limits and must be deleted when a user revokes (the runbook records 30-day refresh / 7-day deletion windows — **confirm the exact figures against the cited page before writing them into a policy**) | Nothing deletes or expires analytics rows when a connection is removed. Disconnect revokes the token at the vendor and deletes the `platform_connections` row; ClickHouse `video_metrics`, `video_audience`, `video_traffic_sources` and Postgres `content_analytics` / `revenue_records` (`source = 'api'`) stay |

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

**Legal text is the owner's to approve.** A teammate can draft from the vendor
requirements and the code's actual behaviour; the PR must say DRAFT and must
not claim a behaviour (a deletion window, a retention period) the code does
not implement. Item 3 exists so that items 1–2 never have to.

### Acceptance criteria

- [ ] Data-deletion instructions page live, linked from the privacy policy and footer; every sentence on it checked against what the code does
- [ ] Privacy policy carries the three YouTube-required items — each cited to the policy text in the PR
- [x] Owner has decided what disconnect deletes (2026-09-22: keep until asked — see above)
- [ ] Vendor retention/revocation clauses quoted and cited for YouTube, Meta and TikTok; any conflict with the decision brought to the owner before the pages are finalised
- [ ] Item 3: after a disconnect (or on request), vendor-sourced rows for that connection are gone from ClickHouse and Postgres within the stated window; manual entries untouched — pgTAP/ClickHouse test with seeded rows, red first
- [ ] Runbook (#289) updated: the two blockers struck, with the URLs to paste into each vendor form

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

### Decided (owner, 2026-09-22): close them — with one that is in use

- `SYNCLABS_BASE_URL`, `WAV2LIP_API_URL`, `LOCAL_API_URL`: **no longer used.**
  Remove the reads; route the hosts through the resolver like every other
  vendor. If the Wav2Lip and `local` LLM providers are themselves dead, say so
  in the PR and ask before deleting a provider — removing an env read is in
  scope, removing a feature is not.
- `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`: not used, but the providers stay
  supported. Close the silent path.
- **`GOOGLE_GEMINI_BASE_URL` is set in production today** (owner). It is not set
  anywhere in `sst.config.ts` or `deployment/`, so it lives in the hosting
  environment directly. **"Close" must not mean "break production."** Closing
  this one means replacing a silent override with an explicit one:

### Proposed fix

- **Pass `baseURL` explicitly to every SDK client** from the resolver, so the
  SDKs' own environment lookup is never what decides the host. (Check each
  SDK: an explicit option should take precedence over its env var — verify by
  running the real SDK against a local listener with the env var set, as
  FILM-1801 did for YouTube's `rootUrl`. Do not assume.)
- **A production override becomes a declared thing, not an ambient one:** an
  allow-list in the resolver of vendor → permitted non-default production
  hosts, https only, no credentials in the URL, exact host match. Gemini's
  current production value goes on that list. Anything else set in production
  is ignored *and logged by name at server start*, as FILM-1801 already does
  for `VENDOR_URL_*`.
- **No production value is needed to build this, and none may be asked for**
  (owner, 2026-09-22: *"do not use production credentials for anything"* — that
  includes asking what a production variable is set to). So it ships in two
  steps, and the first cannot break production whatever the value is:
  1. **Observe.** In production the resolver *honours* the six variables exactly
     as today, and logs once at server start which are set — by variable name
     and destination **host only**, never a key, a path, a query string or a
     URL carrying credentials. Behaviour is unchanged. The owner reads their own
     log and learns what Gemini points at.
  2. **Enforce.** A later PR turns the allow-list on. The owner adds the Gemini
     host to it in code review, from what step 1 showed them. Until a host is
     on the list, step 2 does not merge.
  The three unused variables can be removed in step 1 — the owner has said they
  are not set.
- Extend FILM-1801's guard (`vendor-api-versions.test.ts`): a new
  `process.env.*_BASE_URL` / `*_API_URL` read for a vendor host fails the
  build, with the resolver call to use instead.
- Depends on #291.

### Acceptance criteria

- [ ] Step 2: none of the six variables changes a request's host unless the allow-list permits it — proven per SDK against a **local** listener, env var set, production settings: **0 requests arrive**. No production system, credential or value is used at any point
- [ ] Step 1: with any of the six set under production settings, requests still reach that host (behaviour unchanged) and one start-up log line names the variable and the host — a test asserts no key, path, query or credential appears in it
- [ ] Step 2 (separate PR, after the owner has read their log): Gemini reaches only the allow-listed host; an undeclared value is ignored and logged
- [ ] The three unused variables are gone from source, docs and env examples
- [ ] The guard fails on a newly introduced vendor base-URL env read — seen red
- [ ] FILM-1803's spec updated: it planned to rely on these variables for the AI sandbox and must use `VENDOR_URL_*` instead

---

## Fixed

| ID | Bug | Fixed in |
|---|---|---|
| — | `analytics_experiments`, `content_tags`, `hook_tests` authors blocked user deletion | #264 |
| — | GitHub deploy workflows never applied migrations; tests could not stop a deploy | #264 |
| — | CI tested `@kit/mailers-core`, which does not exist; `@kit/mailers` never ran | #264 |
| — | The experiment lifecycle was held only by the actions; a direct API call could reopen, back-date or forge an experiment | #264 (round 4) |
| KB-6 (part) | Experiment log and note refusals replaced in production | #264 (round 4) |
| KB-9, KB-10 | Hook Lab: a cross-tenant retention read, and a feature that could not be used and measured the wrong point | #269 (removed) |
| KB-11 | Another account could read a public project's analytics | FILM-1615 Step 0 |
| — | A server action after the session ended showed "An unexpected response was received from the server" instead of going to sign-in: middleware redirected the action's request, which Next's client cannot follow. Fixed for every action under `/home` | #264 (round 5) |
