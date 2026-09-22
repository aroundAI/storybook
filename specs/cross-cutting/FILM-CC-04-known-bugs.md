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

**Remaining** — every file is named in `KNOWN` in the guard test, which
fails if one is fixed without being removed from it, so the list can only
shrink:

- *PR B (KB-6 part 2: assets, audio, publishing, analytics, edit suite,
  admin):* `packages/features/assets/src/components/{asset-gallery,location-editor,voice-profile-editor}.tsx`,
  `character-editor/CharacterEditor.tsx`, `hooks/{use-assets,use-character-assets}.ts`
  (the last two also *branch* on `error.message.includes('in use')`, which
  cannot match in production);
  `packages/features/audio-generation/src/components/{DialogueList,LipSyncEditor,MusicTrackList,VoiceAssignment,VoiceCloningEditor}.tsx`;
  `apps/web/…/audio-library/_components/{batch-generate,generate-audio,upload-audio}-dialog.tsx`;
  `apps/web/…/audio-studio/_components/{add-music-cue,generate-scene-music}-dialog.tsx`,
  `dialogue-timeline.tsx`, `use-audio-studio-data.ts`, `use-batch-generation.ts`;
  `apps/web/…/episodes/_components/generate-all-sound-modal.tsx`;
  `apps/web/…/publish/_components/publish-screen.tsx`;
  `apps/web/app/home/[account]/social-posts/**` (2 files);
  `apps/web/app/home/[account]/settings/_components/api-keys-settings.tsx`;
  `packages/features/publishing/src/components/{publish-hub,upload-only-mode}.tsx`;
  `packages/features/content-analytics/src/components/{export-reports,scheduled-reports-manager}.tsx`;
  `packages/features/content-analytics/src/components/video-log/note-cell.tsx`
  (its `catch` fallback only);
  `packages/features/edit-suite/src/components/export/export-dialog.tsx`,
  `hooks/use-media-bin.ts`;
  `packages/features/admin/src/components/{admin-create-user,admin-reset-password}-dialog.tsx`.
- *Deferred — owned by an open PR:*
  `packages/features/content-analytics/src/components/manual-revenue-form.tsx`
  (KB-12). `taxonomy/tag-manager.tsx` reads the message of an error its
  *caller* throws — fixed when `tag-manager-client.tsx` unwraps
  `createTagAction` in PR B.

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

## Fixed

| ID | Bug | Fixed in |
|---|---|---|
| — | `analytics_experiments`, `content_tags`, `hook_tests` authors blocked user deletion | #264 |
| — | GitHub deploy workflows never applied migrations; tests could not stop a deploy | #264 |
| — | CI tested `@kit/mailers-core`, which does not exist; `@kit/mailers` never ran | #264 |
| — | The experiment lifecycle was held only by the actions; a direct API call could reopen, back-date or forge an experiment | #264 (round 4) |
| KB-6 (part) | Experiment log and note refusals replaced in production | #264 (round 4) |
| KB-6 (part) | Projects and episodes/studio refusals replaced in production; shared `returnRefusals` helper and guard | KB-6 PR A |
| KB-9, KB-10 | Hook Lab: a cross-tenant retention read, and a feature that could not be used and measured the wrong point | #269 (removed) |
| KB-11 | Another account could read a public project's analytics | FILM-1615 Step 0 |
| — | A server action after the session ended showed "An unexpected response was received from the server" instead of going to sign-in: middleware redirected the action's request, which Next's client cannot follow. Fixed for every action under `/home` | #264 (round 5) |
