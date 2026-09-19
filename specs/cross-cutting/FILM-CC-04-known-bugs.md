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

**Proposed:** fix KB-9 now. Don't repair Hook Lab on its own: fold hook
tests into FILM-1724 as experiments whose styles are hooks, measured on
early retention for short-form videos only, once FILM-1710 and FILM-1716
land. Until then, keep the route unlinked (as it is) and mark FILM-1510
incomplete.

---

## Fixed

| ID | Bug | Fixed in |
|---|---|---|
| — | `analytics_experiments`, `content_tags`, `hook_tests` authors blocked user deletion | #264 |
| — | GitHub deploy workflows never applied migrations; tests could not stop a deploy | #264 |
| — | CI tested `@kit/mailers-core`, which does not exist; `@kit/mailers` never ran | #264 |
| — | The experiment lifecycle was held only by the actions; a direct API call could reopen, back-date or forge an experiment | #264 (round 4) |
| KB-6 (part) | Experiment log and note refusals replaced in production | #264 (round 4) |
| — | A server action after the session ended showed "An unexpected response was received from the server" instead of going to sign-in: middleware redirected the action's request, which Next's client cannot follow. Fixed for every action under `/home` | #264 (round 5) |
