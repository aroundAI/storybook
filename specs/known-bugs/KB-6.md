---
id: KB-6
title: "Server-action error messages are replaced in production"
status: fixed
fixed_in: ["#264 (round 4)", "#296", "#303 (re-land of #299)", "#406"]
fixed_summary: "Experiment log and note refusals replaced in production; Projects and episodes/studio refusals replaced in production; shared `returnRefusals` helper and guard; Assets, audio, publishing, analytics, edit-suite and admin refusals replaced in production; ten more exported actions threw a refusal unwrapped (audio library, AI insights, revenue projection, season, shot list, story, screenplay), and the manual revenue form showed a caught message"
severity: Medium
found: 2026-09-19
---

## KB-6 — Server-action error messages are replaced in production

> **Fixed (2026-09-25), #406: the remainder.** The client scan only saw
> files that read a caught message, so an action that *threw* its refusal
> was invisible to it wherever the caller showed a fallback instead. A
> server-side scan (`packages/next/__tests__/thrown-refusals.ts`) now reads
> every `enhanceAction` export and follows refusals through helpers and
> other actions by name. It found ten exported actions that could throw an
> `ActionRefusal` in production:
> - `generateMusicAssetAction` and `generateSfxAssetAction` (audio library);
> - `generateInsightsAction` and `generateLanguageInsightsAction`;
> - `getRevenueProjectionAction`, whose refusal comes only through `callerTodayOr`;
> - `analyzeSeasonRoadmapAction`, `generateShotListAction` and
>   `regenerateEpisodeOutlineAction`;
> - `convertToScreenplayAction` and `generateFullStoryAction`.
>
> Each is now `returnRefusals(inner)`, and its 11 client call sites `unwrap`.
> `manual-revenue-form.tsx` reads a crash through `refusalMessage`, and
> `KNOWN` is empty. The guard fails on any new exported action that can throw
> a refusal, including one re-exported under an alias. A production-build
> scenario (converting a story whose episode another tab deleted) asserts
> "Episode not found".

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

**Remaining:** none. `manual-revenue-form.tsx` was fixed in #406, and
`KNOWN` in the guard test is empty.

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
