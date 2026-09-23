# FILM-607 — Retire the Edit Suite: Engineering Design Document

| | |
|---|---|
| Ticket | FILM-607, "Retire the Edit Suite" (`specs/phase-6-edit-suite/FILM-607-retire-edit-suite.yaml`, new, DRAFT) |
| Decision | Owner, 2026-09-23: sunset the whole Edit Suite. It is barely used, a dedicated editor does the job better, and any future editor is redesigned from scratch. Everything Edit-Suite-specific leaves the codebase |
| Branch | `feat/film-607-retire-edit-suite` from `origin/main` @ `ef44ffce` |
| Size | M overall, as two PRs. **PR A** (stop-gap, XS–S): one migration, the tab, the route, pgTAP and a Playwright spec. **PR B** (removal, M): ~15,300 deleted lines, one migration, `sst.config.ts`, records |
| Supersedes | KB-40, KB-62 and KB-32 (all paused for this), and KB-64, KB-65, KB-67, KB-68, KB-69 |
| Deviations (PR B) | (1) **The presign allowlist entry is not removed here.** `EXPORT_UPLOAD_BUCKET` exists only on #313 (KB-28), which has not merged. By the lead's decision #313 keeps it, and a follow-up on this branch removes it once #313 merges. That follow-up removes the `ALLOWED_BUCKETS` entry, its import, the route tests that use the `exportUpload` fixture (the traversal cases move to a `project-assets` fixture) and the `vitest.config.ts` alias, and keeps PATH_PATTERN's underscore support (shot videos need it). G1 already lists `EXPORT_UPLOAD_BUCKET`, so it goes red on the merge until that follow-up lands. (2) **KB-47's render bullet and KB-62's entry** are on no branch but #315 and nowhere respectively, so this PR adds the Fixed-table row only (§31's assumption). (3) **The pgtap guards are replaced.** PR A's P1 (re-grant) cannot fail once the function is dropped, so R1 (a function re-created), R2 (INSERT re-granted) and R2 (a write policy re-created) take its place, plus G1 (a unit guard on the repo scan). (4) **R5/R6 run as the owner, through RLS**, not as `postgres`, so they prove the referential actions need no write grant |
| Deviations (PR A) | (1) The tab mutation guard is a **unit** entry on a new component test (`_components/__tests__/episode-workspace-tabs.test.tsx`), not an e2e one: the e2e entry went RED once and STAYED GREEN once, because the dev server had not recompiled within `run.py`'s four-second wait. That is the flakiness `tooling/mutation-guards/README.md` warns about. The Playwright spec stays as the behavioural test. (2) The active tab carries `aria-current="page"`. The spec waits on it, because a screenshot taken mid-navigation showed the previous tab highlighted. (3) The spec retries a tab click until the URL changes (`toPass`), and polls the tab list: on a cold production server, a click before hydration was dropped once, and the layout was briefly in the DOM twice |
| Status | Approved 2026-09-23 with every default (D1–D6), plus the owner's addition: no remnants in code, so PR B also writes FILM-608 (drop the kept tables once the owner has read production). PR A (stop-gap) implemented; PR B stacked on it |

`$SP` = `/private/tmp/claude-501/-Users-xuryax-Work-code-storybook/04244c24-4477-42c9-9637-11028d9a01d4/scratchpad`.
Line numbers are on `main` @ `ef44ffce` unless another branch is named.

---

## 0. What exploration found

**The Edit Suite has never produced anything a user could keep outside it.** Three separate teammates measured its three output paths this week, and I checked the fourth by reading:

| Output | Status | Evidence |
|---|---|---|
| **Saving edits** (auto-save, 💾 Save, Cmd+S) | Never worked. `batch_save_edit_project` has never been granted to `authenticated`, and three more defects sit behind that one (fractional ms, double encoding, dropped ids and media) | KB-62 EDD §0, measured through the real UI as the project owner |
| **Server Render / Export All** | Never worked. The worker's first query selects columns that don't exist (`42703`), so every job ends "Edit project not found". The rendered file would also be deleted before upload | KB-32 EDD, reproduced with real FFmpeg; `apps/web/lambda/render-worker/index.ts:170-179` |
| **Browser Export → "☁ Upload to R2"** | Never worked, by reading. The dialog builds `projects/${data.project.id}/assets/master_video/…` (`export-dialog.tsx:83,91-92`), where `data.project` is the **edit project** (`state/types.ts:33`, `lib/types.ts:22`). The presign route looks that id up in `projects` and returns 403 "Access denied to project" (`apps/web/app/api/storage/presign/route.ts:111-121`). That lookup has existed since `b1f96b03` (2026-01-28), a month before the upload shipped in `c3de1674` (2026-02-26). Phase 2 will run it | this plan |
| **Auto-Assemble** | Works, and is the one live danger: `batch_assemble_edit_project` is SECURITY DEFINER, granted to `authenticated`, and trusts a caller-supplied `p_user_id`, so **any signed-in user can wipe and replace any episode's timeline** | KB-40 EDD §0 (A1, A2), measured as a second real user over PostgREST |

So the only things a user can have made are:
- edit-project rows created by Auto-Assemble, with their tracks, clips and keyframes;
- a Browser Export MP4 downloaded to their own disk, which is unaffected by anything here.

**Nothing outside the Edit Suite reads it.** I ran `git grep` across the repo for the package name, the route, the six tables, the five functions, the queue names, `RENDER_QUEUE_URL`, `ffmpeg-static` and the WebSocket message names. Outside the package it finds only:
- the tab (`episode-workspace-tabs.tsx`);
- the page (`edit-suite/page.tsx`);
- `apps/web/package.json:64`;
- the render worker;
- `sst.config.ts`;
- the WebSocket handler;
- migrations and schema files;
- a code comment in `packages/next/__tests__/kb6-caught-action-message.test.ts:25`.

Positive control: the same grep finds the tab file.

**Publishing does not depend on it.** It reads `master_video` assets through `episodes.master_video_asset_id`. It never reads `edit_projects` or `render_url`. The Publish page uploads masters itself (`publish/_components/master-asset-manager.tsx:72`).

**Measured locally** (read-only, under the DB lock, 2026-09-23 05:12Z; `$SP/film607/measure.out`). The shared database was at KB-40's branch schema (newest migration `20260923044050`), so these rows are other teammates' test fixtures:

| Object | Rows |
|---|---|
| `edit_projects` | 7 |
| `edit_tracks` | 14 |
| `edit_clips`, `edit_keyframes`, `edit_transitions`, `dialogue_sync_groups` | 0 each |
| `edit_projects` with `render_status <> 'none'` / `render_url` set | 0 / 0 |
| `compilations` (and with `edit_project_id` set) | 0 (0) |
| `assets` of type `master_video` | 0 |
| `episodes.master_video_asset_id` set | 0 |
| `storage.objects` under `renders/`, `…/master_video/export_*`, any `…/master_video/…` | 0, 0, 0 |

`seed.sql` inserts no edit rows, so a fresh `db reset` has 0 in every table. **Production counts are the owner's to read.** A read-only query is in §31. Nobody on the team touches production.

---

## 1. Start With the User

**Who.**
- The owner, the only real user today, and later any creator in a team workspace. They make an episode in the studio: ideation → story → screenplay → shot list → audio → publish.
- Every creator whose episode timeline a stranger can currently overwrite.

**Problem.** The episode workspace has an **Edit Suite** tab that promises a non-linear editor. Behind it:
- edits are lost on reload under a green "✓ Saved" (KB-62);
- Server Render always fails with a false "not found" (KB-32);
- the upload button always fails;
- any signed-in stranger can replace any episode's timeline through the database API (KB-40).

The owner edits in a dedicated editor and uploads the finished master on the Publish tab, which works.

**After this change:**
- The episode workspace shows **Ideation, Story, Screenplay, Shot List, Audio | Publish**. The post-production group holds only Publish. There is no Edit Suite tab, and `/…/episodes/<episode>/edit-suite` shows the standard "page not found".
- The user uploads a finished video on the Publish tab exactly as today. Nothing about Publish changes.
- No signed-in user can write another creator's timeline, or any timeline, through the API.
- Rows Auto-Assemble made stay in the database, read-only, until the owner decides (Decision D3). No storage object and no `master_video` asset is deleted.

**Persists:** every existing row (default), every asset, every storage object. **Stops existing:** the tab, the page, the editor, the render queue and worker, the Edit Suite database functions, and the editor's live-collaboration messages.

**Success:** the workspace loads with six tabs, each of which works. The stranger attack returns `42501`. No other feature changes.
**Failure would look like:** a workspace tab or the Publish page breaking, a missing master video, or a deploy stopped by a migration.

## 2. Define the Complete User Journey

| Stage | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| Entry | Opens an episode | Layout loads the episode; tabs render from `STORY_TABS` + `POST_TABS` | Six tabs; locked ones show a lock as today | Pick a tab |
| Story tabs | Clicks Ideation/Story/Screenplay/Shot List/Audio | Unchanged routes | Unchanged pages | — |
| Publish | Clicks Publish | Unchanged route | Unchanged page, including the master-asset manager | Upload / publish |
| Old bookmark | Opens `…/edit-suite` | No route segment | The app's not-found page | Back to the episode |
| Stranger via API | `POST /rest/v1/rpc/batch_assemble_edit_project` | PR A: `42501 permission denied for function`. PR B: `PGRST202`, no such function | HTTP 403 / 404; nothing changes | — |
| Direct table write via API (PR B, default) | `POST /rest/v1/edit_clips` | No INSERT privilege | 403 (`42501`) | — |
| Direct table read via API (PR B, default) | `GET /rest/v1/edit_projects` | Existing read policy (account role, or personal owner) | Own rows only, as today | — |
| Refresh / navigate away | — | Nothing is in flight, because there is no editor | — | — |

There is no in-product export of the kept rows: no user can use them, and the owner reads them with SQL (Decision D3).

## 3. Explicitly Define the Happy Path

The owner opens an episode whose shot list exists.
1. The episode layout renders `EpisodeWorkspaceTabs`. `POST_TABS` is `[Publish]` only.
2. The tab bar shows Ideation, Story, Screenplay, Shot List and Audio, then a separator, then Publish. Every tab is a link with `data-test="episode-tab-<id>"`.
3. The owner clicks **Publish**. The URL ends `/publish` and the Publish screen renders as today.
4. The owner uploads the edited master in the master-asset manager (`type="master_video"`), as today.

**Success:** six tabs; each navigates; Publish works; no request anywhere touches an edit table or function.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| Bookmark to `/edit-suite` | No segment → Next not-found | Not-found page | Episode link | — |
| Browser tab left open on the old Edit Suite across the PR A deploy | Its Auto-Assemble call fails `42501`; its server actions are gone after the next page load | "Assembly failed", then the page is gone on reload | Reload | Unchanged data |
| Stranger calls the function | PR A: `42501`. PR B: `PGRST202` | 403 / 404 | — | Unchanged |
| Deleting an episode that has an edit project (PR B, tables kept read-only) | FK `on delete cascade` runs as the table owner, not the caller | Episode deleted, as today | — | Edit rows for it removed |
| Deleting a shot, dialogue line or audio track referenced by an `edit_clip` | FK `on delete set null` runs as the table owner | As today | — | Clip's source id nulled |
| SQS message in `StorybookRenderQueue` or its DLQ at PR B's deploy | The queues are deleted and the messages go with them | None: every such job already failed at step 1 (KB-32) | — | — |
| Owner chooses "drop" (D3), and production has rows | The guarded migration raises and the deploy stops at it | Deploy fails loudly; nothing is lost | Export, then decide (§25) | Unchanged |
| KB-28 (#313) merged first | Presign allowlist names `EXPORT_UPLOAD_BUCKET` from the deleted package | Build breaks unless PR B removes it | PR B removes the entry (§15.6) | — |

## 5. Establish the User-Facing Contract

- **Tabs:** exactly `ideation, story, screenplay, shot-list, audio` + `publish`, with the same labels, icons and unlock rules as today. The Edit Suite's rule (`hasShotList`) goes with it.
- **Route:** `/home/<account>/studio/<project>/episodes/<episode>/edit-suite` is not found.
- **Data:** nothing a user owns is deleted by this spec (default D3). `master_video` assets and every storage object are untouched.
- **API:** the five Edit Suite functions are not executable by `anon` or `authenticated` (PR A) and do not exist (PR B). By default the six edit tables are SELECT-only for `authenticated`, under the existing read policies.
- **No messages, no i18n:** the tab labels are English literals today (`episode-workspace-tabs.tsx:29-82`), and there are no locale keys to remove (`git grep -i "edit suite" apps/web/public/locales` finds nothing).

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | PR | Verification |
|---|---|---|---|
| FR-1 | No role other than `service_role` and `postgres` can execute any of the five functions | A | pgTAP P1–P3; stranger attack P4 red→green |
| FR-2 | The workspace shows exactly the six tabs, and each navigates to its page | A | Playwright W1–W2 |
| FR-3 | `/edit-suite` is not found | A | Playwright W3 |
| FR-4 | No code, route, server action, Lambda, queue, env var or WebSocket case of the Edit Suite remains | B | Repo-scan guard G1 (red on `main`); build manifest check (§27) |
| FR-5 | The five functions are dropped | B | pgTAP R1 (`hasnt_function`) |
| FR-6 | Default D3: the six tables keep every row; `authenticated` and `anon` hold no INSERT, UPDATE, DELETE or TRUNCATE; the existing read policies remain | B | pgTAP R2–R4 |
| FR-7 | Referential actions into the kept tables still work (episode delete cascades; shot delete nulls) | B | pgTAP R5–R6 |
| FR-8 | `master_video` assets, `episodes.master_video_asset_id` and storage are untouched | B | pgTAP R7 (type still allowed); no storage statement in the migration (review); Publish E2E W2 |
| FR-9 | The workspace, Publish and the other tabs behave the same on a production build | A, B | §27 |
| FR-10 | Records say what happened: FILM-601/602 RETIRED, PHASE-14 retired, KB entries resolved by removal, INDEX updated | B | Review; the INDEX counts recomputed |

## 7. Define Non-Functional Requirements

- **Security:** closes KB-40's cross-tenant destructive write (High) at PR A. The only new state is an absence.
- **Reliability:**
  - No migration may stop a production deploy on an assumption about production data. The default keeps the tables for this reason (§29).
  - Removing the queues must not strand a message that matters. None can: every render has failed at step 1.
- **Performance:**
  - The client bundle loses the edit-suite chunks (`ssr: false` dynamic import).
  - One Lambda (2 GB, 15 min) and two queues are gone.
  - Nothing gets slower.
- **Cost:** no idle cost removed beyond SQS/Lambda's per-request pricing. The removal is about attack surface and maintenance, not money.
- **Maintainability:**
  - About 15,300 lines leave: 14,207 in the package, 1,086 in the worker, and ~130 in the WebSocket handler.
  - So do 23 server actions and one dependency (`mp4box`).
- **Accessibility:** the tab bar keeps its structure. It loses one link.

## 8. Analyze the Existing System

### 8.1 UI entry points

- **Tab.** `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/_components/episode-workspace-tabs.tsx`:
  - `Scissors` import `:13`;
  - `POST_TABS` entry `:68-74`;
  - unlock rule `:104`;
  - active-tab match `:131`.
  - No `data-test` on any tab.
- **Route.** `…/[episodeSlug]/edit-suite/page.tsx` (54 lines). It is `'use client'` and dynamically imports `EditSuiteProvider` and `EditSuiteShell` from `@kit/edit-suite/components` with `ssr: false`. It is the package's **only** importer in the app.
- **Nothing else links to the route.** `git grep -n "edit-suite" -- apps/web/app` finds only the tab and the page. Emails, notifications, the sidebar and the locales have nothing.

### 8.2 `packages/features/edit-suite/` (58 files, 14,207 lines)

- **Exports** (`package.json:14-20`): `./schemas`, `./types`, `./components`, `./state`, `./server/actions`.
- **Dependencies:** `mp4box` (only here: `workers/export.worker.ts`), plus devDeps `@aws-sdk/client-sqs` and workspace packages.
- **Server** (`src/server/`): 23 server actions.

| File | Actions | Tables / RPCs |
|---|---|---|
| `edit-project-actions.ts` (332) | create (→ `create_edit_project_with_tracks`, no UI caller), find, get, update | `edit_projects`, children |
| `track-actions.ts` (156) | create, update, delete | `edit_tracks` |
| `clip-actions.ts` (404) | create, update, delete, split (→ `split_edit_clip`, no UI caller), transition create/update/delete | `edit_clips`, `edit_transitions` |
| `keyframe-actions.ts` (158) | create, update, delete | `edit_keyframes` |
| `batch-actions.ts` (196) | `batchAssembleAction` (→ `batch_assemble_edit_project`), `batchSaveAction` (→ `batch_save_edit_project`) | all |
| `media-bin-queries.ts` (213) | `getMediaBinDataAction` | reads `shots`, `dialogue_lines`, `dubbed_dialogue_lines`, `audio_tracks` |
| `render-actions.ts` (305) | `enqueueRenderAction`, `enqueueMultiLanguageRenderAction`, `getRenderStatusAction` (unused, KB-67) | `edit_projects.render_*`; SQS `StorybookRenderQueue` / `RENDER_QUEUE_URL` (`:42-50`) |
| `db-client.ts` (30) | — | untyped (`any`) client |

- **Lib:**
  - `auto-assemble.ts`, which feeds the assemble RPC;
  - `presigned-upload.ts`, which calls `/api/storage/presign`;
  - `ffmpeg-builder.ts`, `playback-engine.ts`, `keyframe-engine.ts`, `audio-engine.ts`, `transition-renderer.ts`, `sync-group-engine.ts`, `operational-transforms.ts`, `lru-cache.ts`;
  - `schemas/index.ts` and `types.ts`.
- **State:** `edit-reducer.ts`, `edit-commands.ts`, `types.ts`. **Hooks:** WebSocket, export worker, media bin, waveform worker, visible clips. **Workers:** `export.worker.ts` (WebCodecs + mp4box) and `waveform.worker.ts`.
- **Components:** provider, shell, toolbar, timeline (9), preview (3), inspector (3), media bin (3), export dialog.
- **Tests:** none on `main`. KB-40's unmerged branch adds `vitest.config.ts` and `__tests__/write-refusal.test.ts`.
- **`EXPORT_UPLOAD_BUCKET`** is not on `main`. KB-28 (#313, open) creates `src/lib/export-upload.ts` and a `./export-upload` export. It imports that export in `apps/web/app/api/storage/presign/route.ts` (`ALLOWED_BUCKETS`), in its `__tests__/route.test.ts` ("signs the export dialog's upload…"), and as an alias in `apps/web/vitest.config.ts`. #318 (KB-26, stacked on #313) carries the same files.
  - **Finding for KB-28:** that test uses a project id, but the real dialog sends the edit project's id (§0), so the allowlisted shape has never been produced by the product.

### 8.3 Render worker and infrastructure

- **`apps/web/lambda/render-worker/`:**
  - `index.ts` (446) holds the four `@ts-expect-error KB-32` markers (`:246-253`). It writes `edit_projects.render_*` and creates a `master_video` asset (`:296-360`), which is unreachable because step 1 fails.
  - `handlers/ffmpeg-render.ts` (556) has `require('ffmpeg-static')` at `:104` and the SSRF guard of KB-69 at `:166-170`.
  - `utils/r2-storage.ts` (84).
  - No tests.
- **`sst.config.ts`** (confirmed against KB-32's hand-off):
  - `StorybookRenderDLQ` `:411-420` (14-day retention);
  - `StorybookRenderQueue` with its redrive to the DLQ after 3 receives `:422-440`;
  - the worker `renderQueue.subscribe` `:836-900`, including `nodejs.install: [..., 'ffmpeg-static', ...]` at `:894`;
  - `renderQueue` in the web `link` `:1001`;
  - `RENDER_QUEUE_URL` `:1100`;
  - `renderQueue.arn` in the web role's `sqs:SendMessage` `:1222`.
  - `renderWorker` is referenced nowhere else.
- **`ffmpeg-static`** is in no `package.json` or lockfile. It exists only at `:894` and `ffmpeg-render.ts:104`.
- **Lambda typecheck** (KB-14): `apps/web/lambda/tsconfig.json` includes `**/*.ts`. Deleting the directory deletes the markers with it, so there is no TS2578.
- **WebSocket** (`apps/web/websocket/default.ts`):
  - `case 'edit-operation'` `:488-561` and `case 'cursor-update'` `:563-617` exist only for the editor's live collaboration. Their one sender is `edit-suite/src/hooks/use-edit-suite-websocket.ts:307-335`.
  - `render-status-changed` is sent by the render worker and read by that hook.
  - `subscribe`, `unsubscribe`, `broadcast`, `send-to-user` and `ping` are generic and stay.
  - `__tests__/default.test.ts` does not exercise the two cases.
  - The `$default` route comment "(edit-operation, cursor-update)" at `sst.config.ts:625` needs rewording. The permission itself stays, because `broadcast` uses it.

### 8.4 Database

- **Tables** (`20260219083555_edit-suite-v2.sql`): `edit_projects` `:19` (with `render_*`, `version`, `unique(episode_id)`), `edit_tracks` `:66`, `dialogue_sync_groups` `:109`, `edit_clips` `:139`, `edit_transitions` `:214`, `edit_keyframes` `:245`.
  - Plus `idx_edit_clips_language` (`20260528163000_performance_indexes.sql:10`).
  - Plus `edit_projects.compilation_id` and `edit_projects_source_check` (`20260722172000_compilations.sql:182-187`).
- **Policies:** 24 (a read, create, update and delete for each table). `dialogue_sync_groups_update` and `edit_transitions_update` come from `20260219100138…sql:16,29`.
  - Read is account role or personal owner.
  - Insert/update is `project_members` owner/admin/member.
  - Delete is owner/admin.
  - Measured: 4 per table.
- **Triggers:** `edit_projects_set_timestamps`, `edit_tracks_set_timestamps`, `edit_clips_set_timestamps` (shared `trigger_set_timestamps()`). There are no views over the tables and no realtime publication (measured).
- **Foreign keys** (measured):

| From | To | On delete |
|---|---|---|
| `edit_projects.episode_id` | `episodes` | cascade |
| `edit_projects.compilation_id` | `compilations` | cascade |
| `compilations.edit_project_id` | `edit_projects` | set null |
| `edit_clips.source_shot_id` / `source_dialogue_id` / `source_dubbed_dialogue_id` / `source_audio_track_id` | `shots` / `dialogue_lines` / `dubbed_dialogue_lines` / `audio_tracks` | set null |
| `dialogue_sync_groups.anchor_dialogue_id` | `dialogue_lines` | cascade |
| children → parents inside the suite | — | cascade / set null |

- **Functions** (measured on the KB-40 branch schema; `main`'s assemble signature is KB-40 EDD §8's):

| Function | DEFINER | `search_path` on `main` | EXECUTE to `authenticated` on `main` | Caller |
|---|---|---|---|---|
| `batch_assemble_edit_project(uuid p_episode_id, uuid p_user_id, int, int, int, varchar, text, text, text, text)` | yes | `public` | **yes** (`20260226170054…sql:195-201`) | `batch-actions.ts:68` |
| `batch_save_edit_project(uuid, jsonb ×7)` | yes | `public` | no | `batch-actions.ts` |
| `create_edit_project_with_tracks(uuid, int, int, int, varchar, jsonb)` | yes | `public` | no | none reachable |
| `split_edit_clip(uuid, int)` | yes | `public` | no | none reachable |
| `get_project_id_for_edit_project(uuid)` (`20260219083555…sql:288`) | yes | `public` | no | none; no policy calls it |

- **Grants:** Supabase's defaults give `anon` and `authenticated` all table privileges on these tables (measured). RLS policies are `to authenticated`, so `anon` sees no rows.
- **Schema files:**
  - `apps/web/supabase/schemas/36-edit-suite.sql` (623 lines) holds the tables, policies and `get_project_id_for_edit_project`. It does not hold the RPCs.
  - `schemas/56-compilations.sql:38` holds the `compilations` FK.
- **Generated types:** both `database.types.ts` copies list the tables and functions.
- **`compilations` / `compilation_segments`** have no application code at all (`git grep compilation` in `apps`/`packages` finds only an unrelated comment and `scripts/check-schema-drift.ts:5`). They are out of scope, and stay.

### 8.5 Storage and `master_video`

- `assets.type` allows `master_video` (`schemas/35-master-video-schema.sql:25`). `episodes.master_video_asset_id` is a FK with `on delete set null`.
- **Readers, all independent of the Edit Suite:**
  - the episode layout (`[episodeSlug]/layout.tsx:140-211`);
  - `episodes/src/hooks/use-episode-query.ts:163-166`;
  - `episodes/src/server/actions.ts:544-652, :930`;
  - the Publish master-asset manager (`:72`);
  - the asset card and schema in `@kit/assets`.
- **Writers from the Edit Suite:** only the render worker (`index.ts:296-360`), which is unreachable. The Browser Export upload never reaches storage (§0) and creates no asset row even when it could.
- **Objects the Edit Suite could have written:** `renders/<editProjectId>/<lang>/output.mp4` (worker) and `projects/<editProjectId>/assets/master_video/export_*.mp4` (dialog). Both paths are unreachable (§0), and 0 exist locally.

### 8.6 Tests, guards, records

- No E2E spec, unit test, pgTAP file or mutation guard on `main` references the Edit Suite. Checked with `git grep -l -i -E 'edit.suite|edit_project|edit_clip|render-worker|batch_assemble' -- apps/e2e tooling apps/web/supabase/tests apps/web/test apps/web/lambda scripts .github`. That finds only `render-worker/index.ts`, the positive control.
- **In flight:**
  - KB-40's and KB-62's unmerged branches carry `write-refusal.test.ts`, `edit-project-assemble-access.test.sql`, `kb-40.json` and the KB-62 specs. All are abandoned with this spec.
  - KB-27 (#316) adds `definer-functions-inventory.test.sql`, which lists `public.batch_assemble_edit_project` in I1.
- **Specs:**
  - FILM-601 and FILM-602 are PARTIAL, with `remaining:` rows about snap, undo and lock. FILM-603 to FILM-606 are RETIRED.
  - PHASE-14 (`specs/phase-14-edit-suite-v2/ENGINEERING.md`) is PARTIAL.
  - Other specs cite edit-suite files as evidence or reasons: FILM-DS-01 `:20,:36`, FILM-DS-03 `:24,:27,:39`, FILM-DS-04 `:25,:28,:37,:92-120`, FILM-DS-05 `:35-70`, FILM-312 `:36,:114`, FILM-508 `:92`, FILM-512 `:60`, FILM-712 `:36,:45,:91`, SPIKE-02 `:19`, SPIKE-04 `:36`, FILM-101 audio-tracks `:14`, FILM-1804 `:54`, and FILM-711 (RETIRED; depends on FILM-601/604).
  - `specs/README.md:59,67`, the INDEX phase 6 and 14 tables, the dependency graph (`:123-129,179-180`) and the tracker counts.
- **FILM-CC-04:**
  - KB-32 (Open, on `main`).
  - KB-40 (in #316).
  - KB-47 (in #315; names `render-actions.ts:146,:226`).
  - KB-62 to KB-69 are reserved in `$SP/kb-reservations.txt`. KB-62 has no entry on any branch. KB-64 to KB-69 are on KB-32's unpushed branch.
  - The "UI that is broken" list bullet for the Edit Suite (`:1974`).
- **Docs:** root `README.md:37-40` ("✂️ Edit Tab"). `docs/video-rendering-comparison.md` and `docs/ffmpeg-integration.md` are SPIKE-02 research and stay as history.

## 9. Define the Desired System Behavior

**After PR A:**
- The tab bar renders six tabs, and `/edit-suite` is not found.
- The package is still in the repo but imported by nothing, so Next bundles none of its client code or server actions.
- `has_function_privilege(authenticated | anon | public, f, 'EXECUTE')` is false for all five functions. The KB-40 attack returns `42501` before the function body runs.
- The render queue and worker still exist, idle: nothing can enqueue.

**After PR B:**
- The package, the worker, the queues, the two WebSocket cases and the five functions no longer exist.
- The six tables exist with every row. `authenticated` may only SELECT them, through the existing read policies. `anon` has nothing. `service_role` keeps everything for owner exports.
- Referential actions from `episodes`, `shots`, `dialogue_lines`, `dubbed_dialogue_lines`, `audio_tracks` and `compilations` still run.
- A guard test fails the build if any retired name returns.

## 10. High-Level Architecture

No new components. Two boundaries shrink:
- **The database's public API** loses five DEFINER functions, which are doors past RLS, and all write access to six tables.
- **The AWS footprint** loses one queue pair and one Lambda.

The episode workspace keeps its two-group tab layout. The post-production group has one member, which keeps a place for anything post-production later without inventing it now.

The removal is split in two because the two halves have different urgency and different blast radius:
- **PR A** closes a live High in about 30 changed lines, overlaps nothing but one test line in #316, and can ship today.
- **PR B** is large but mechanical. It touches files that five open PRs also touch (§ overlap), so it should land after, or in coordination with, #313, #316, #318, #322 and #323.

## 11. Architecture and Flow Diagrams

```
BEFORE                                             AFTER PR A                         AFTER PR B
Episode tabs ─► …/edit-suite/page.tsx              Episode tabs (6)                   Episode tabs (6)
                 └► @kit/edit-suite (client)        …/edit-suite → 404                 …/edit-suite → 404
                      ├► 23 server actions ─► edit_* tables (RLS)                      edit_* tables: SELECT only
                      │                    └─► 5 DEFINER RPCs ◄── any JWT (KB-40)       RPCs: revoked → dropped
                      ├► presign ─► 403 (edit-project id)                              (package deleted)
                      └► enqueueRender ─► SQS StorybookRenderQueue ─► render-worker ─► 42703 (KB-32)
                                              └─► StorybookRenderDLQ (14 d)            (queues + worker deleted)
                      WebSocket: edit-operation / cursor-update / render-status-changed  (cases deleted)
Publish tab ─► master-asset-manager ─► assets(master_video) ◄─ episodes.master_video_asset_id   UNCHANGED
```

## 12. End-to-End Data Flow

- **Before.** The media bin reads shots, lines, dubs and audio under RLS. Auto-Assemble writes the edit tables through the DEFINER RPC. Saving fails. Render fails. Upload fails.
- **After.** No flow reads or writes the edit tables except:
  - referential actions (cascade / set null) when their parents change;
  - a user's own `SELECT` through PostgREST, which no UI makes;
  - the owner's SQL.
- **Data retained (default):** every edit row and every `render_*` value (all `none`/null locally).
- **Data deleted:** none.
- **Storage:** no object is created, moved or deleted.
- **Messages in flight at PR B's deploy:** any SQS render message is dropped with its queue. It would have failed anyway.

## 13. Data Model

No new entities or columns. Ownership stays `edit_projects.episode_id → episodes.project_id → projects.account_id`, and the retained read policy uses it. Default D3 changes privileges only. The `drop` option removes the six tables and `compilations.edit_project_id`.

## 14. Database Design and Changes

Every migration is hand-written (never `db diff`), timestamped after the newest migration on `main` at the time (today `20260923025438`, and after KB-28's and KB-27's if they merge first), then followed by `pnpm supabase:web:typegen`.

**PR A — `<ts>_film607-revoke-edit-suite-functions.sql`**

```sql
-- FILM-607 stop-gap: the Edit Suite is retired. Close KB-40 (a stranger can
-- replace any episode's edit project through batch_assemble_edit_project)
-- by revoking every Edit Suite function from the API roles. The other four
-- were never granted; revoking them too guards against a hand-added grant.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('batch_assemble_edit_project', 'batch_save_edit_project',
                        'create_edit_project_with_tracks', 'split_edit_clip',
                        'get_project_id_for_edit_project')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
```

The loop covers every overload, so it works whichever `batch_assemble` signature is live (`main`'s, or KB-40's if that had landed). `service_role` keeps EXECUTE: there are no callers, and PR B drops the functions. No schema file holds these RPCs, so there is nothing to mirror.

**PR B — `<ts>_film607-retire-edit-suite.sql`**

1. **Drop the five functions** (same loop, with `drop function %s`).
2. **Default D3 (keep, read-only):**
   - `revoke insert, update, delete, truncate, references, trigger on public.edit_projects, public.edit_tracks, public.edit_clips, public.edit_keyframes, public.edit_transitions, public.dialogue_sync_groups from public, anon, authenticated;`
   - `revoke select on … from anon;`
   - Drop the 18 write policies (`*_create`, `*_update`, `*_delete`). Keep the six `*_read` policies.
   - `comment on table … is 'Retired with the Edit Suite (FILM-607, 2026-09-23). Read-only; kept until the owner decides.'`
   - Mirror all of this in `schemas/36-edit-suite.sql`: a header note, the revokes, and the write policies removed.
3. **Option "drop" (D3-b), only if the owner chooses it.** A Hook-Lab-style guard (`20260919193447_remove-hook-lab.sql`) that raises with the counts if any of the six tables has a row. Then:
   - `alter table public.compilations drop column edit_project_id;`
   - `drop table` the six tables, children first;
   - `schemas/36-edit-suite.sql` deleted;
   - `schemas/56-compilations.sql:38` removed.
4. **Types:** regenerate. The five functions leave both copies. The tables stay (default). `check:schema-drift` stays green either way, because it only flags tables in the types that no migration creates.

**Production implications.**
- PR A: metadata only, milliseconds.
- PR B default: metadata only.
- The drop option locks six empty-or-refusing tables briefly.
- **Rollback:**
  - PR A: a forward migration re-granting `batch_assemble` reopens KB-40. Don't; restore KB-40's fixed function instead (`20260923044050_kb40-batch-assemble-write-scope.sql` on KB-40's branch).
  - PR B default: re-grant table privileges and re-create the policies from `20260219083555`.
  - The drop option has no rollback once rows are gone. That is why it is guarded.

## 15. Low-Level Design

**15.1 PR A.**
- `episode-workspace-tabs.tsx`: delete the `edit-suite` entry (`:68-74`), `'edit-suite': hasShotList` (`:104`), the `/edit-suite` match (`:131`) and the `Scissors` import (`:13`).
- Add `data-test={\`episode-tab-${tab.id}\`}` to both the locked `<div>` and the `<Link>`, so tests select tabs by id, not by label.
- Delete `…/[episodeSlug]/edit-suite/page.tsx` (the directory has only this file).

**15.2 PR B, deletions.**
- `packages/features/edit-suite/` (whole directory).
- `apps/web/package.json:64` (`"@kit/edit-suite": "workspace:*"`).
- `pnpm install` to regenerate `pnpm-lock.yaml`: drops the `packages/features/edit-suite` importer, apps/web's link and `mp4box@2.3.0`. **A required lockfile change**, which is allowed because this ticket removes a dependency. `@aws-sdk/client-sqs` stays for its other users.
- `apps/web/lambda/render-worker/` (whole directory).

**15.3 `sst.config.ts`.**
- Delete `:411-440` (both queues and their log line) and `:836-900` (the worker).
- Remove `renderQueue,` from the web `link` (`:1001`) and `RENDER_QUEUE_URL` (`:1100`).
- Change `:1222` to `Resource: [queue.arn, voiceQueue.arn]`.
- Reword the comment at `:625` to "(broadcast, send-to-user)".
- #322 (KB-22) also edits `sst.config.ts`, adding a vendor-data-purge cron. The hunks don't overlap, but whichever lands second rebases.

**15.4 `apps/web/websocket/default.ts`.**
- Delete the `edit-operation` and `cursor-update` cases (`:488-617`).
- `getSenderUserId` stays, because `send-to-user` and `subscribe` use it.
- `pnpm --filter web test` covers `websocket/__tests__`.

**15.5 Database** (§14).

**15.6 Presign allowlist** (depends on #313 and #318).
- **If #313 has merged when PR B is cut:** remove `EXPORT_UPLOAD_BUCKET` from `ALLOWED_BUCKETS` and its import in `route.ts`, the "signs the export dialog's upload" case in `__tests__/route.test.ts`, and the `@kit/edit-suite/export-upload` alias in `apps/web/vitest.config.ts`.
  - The pgTAP `lives_ok` "The owner may upload the edit-suite export path" in `project-assets-storage-rls.test.sql` is a generic `projects/<id>/assets/<type>/…` path. Keep it, renamed to "…the master_video path".
  - KB-28's allowlist then equals `{PROJECT_ASSETS_BUCKET}`.
  - Question for KB-28's owner: does any other uploader send `NEXT_PUBLIC_R2_BUCKET_NAME` as the bucket? `apps/web/lib/presigned-upload.ts` (#323) should be checked when rebasing.
- **If #313 has not merged:** ask KB-28 to drop `EXPORT_UPLOAD_BUCKET` in #313 itself. That is the smallest diff for everyone.

**15.7 Records** (§32 step B6).
- FILM-601 and FILM-602: `status: RETIRED`, a `retirement:` block (`commit:` PR B's squash, `date:`, `what_happened:`, `replacement: null`), `remaining:` removed.
- PHASE-14: front-matter `status: 🗑️ RETIRED (FILM-607)` and a banner.
- FILM-607 → DONE when every criterion is met.
- INDEX:
  - add a FILM-607 row;
  - FILM-601/602 → `🗑️ RETIRED (FILM-607)`;
  - PHASE-14 → retired;
  - the Phase 6 row → Total 7, Draft 0, Partial 0, Retired 6, Done 1;
  - the Phase 14 row → Retired 1;
  - recompute the TOTAL and By-scope rows;
  - a note in the dependency graph.
- FILM-CC-04:
  - KB-32 → "Resolved by removal (FILM-607, #N)" banner, as KB-9/KB-10 were closed;
  - KB-40, KB-62, KB-64, KB-65, KB-67, KB-68 and KB-69: the same banner where the entry exists on `main` at that point, otherwise one Fixed-table row naming them;
  - KB-47: strike the `render-actions.ts` bullet;
  - the `:1974` bullet struck;
  - one Fixed-table row: `KB-32, KB-40, KB-62, KB-64, KB-65, KB-67, KB-68, KB-69 | Edit Suite: … | #A (KB-40 closed), #B (removed)`.
- Specs citing deleted files: each `met: true` whose evidence is an edit-suite file gets a new non-edit-suite evidence, or becomes `met: false, reason: "retired with the Edit Suite (FILM-607)"`. For example, FILM-DS-03's "Timeline supports keyboard shortcuts" and "Drag and drop has clear visual feedback": check the audio-studio timelines first. Each `reason:` citing a deleted file is reworded.
- Root `README.md`: delete the "✂️ Edit Tab" block. `specs/README.md:59,67`: "retired (FILM-607)".
- PRD.md and ENGINEERING_DESIGN.md are historical plans: one line under their Phase 6 headings, "Retired 2026-09-23 (FILM-607)".

**15.8 Guard** (§26 G1): `apps/web/test/film-607-edit-suite-retired.test.ts`, a repo scan like `packages/features/content-analytics/__tests__/platform-field-names.test.ts`.

## 16. API and Event Design

**Removed:**
- **RPCs:** `rpc/batch_assemble_edit_project`, `batch_save_edit_project`, `create_edit_project_with_tracks`, `split_edit_clip`, `get_project_id_for_edit_project`. PR A makes them 403; PR B makes them 404/`PGRST202`.
- **Server actions:** 23. Their ids leave the server-reference manifest at PR A, because the page is gone and nothing imports them.
- **SQS:** `StorybookRenderQueue`, `StorybookRenderDLQ`.
- **WebSocket actions:** `edit-operation` and `cursor-update`, and their outbound `remote-operation`, `operation-ack` and `cursor-position` messages.
- **Worker message:** `render-status-changed`.
- **Env:** `RENDER_QUEUE_URL`.

**Changed:** PostgREST on the six tables becomes read-only for `authenticated` (default).

**No new API.**

## 17. State and Lifecycle Design

- `edit_projects.render_status` (`none → queued → rendering → completed | failed`) has no writer after PR B. It is frozen at whatever each row holds, which is `none` for every local row.
- There are no other lifecycles.

## 18. Failure and Error Handling

| Failure | Behaviour | Detection | Recovery |
|---|---|---|---|
| PR A migration runs before the app deploy | The old Edit Suite's assemble fails `42501`, and the page shows "Assembly failed" | Expected | App deploy removes the page |
| App deploys before the migration | The tab is gone, and the RPC is still granted for minutes | — | Migration follows in the same workflow |
| PR B deploy while an old client is open on a (pre-A) Edit Suite | Its server actions are already gone since A. Direct table writes now get 403 | — | Reload |
| Guarded drop (D3-b) meets rows | Raises with counts, and the deploy stops | Deploy log | Export (§31 query), then decide; never edit the guard to force it |
| A later PR re-imports a retired name | G1 fails CI | Unit Tests job | Remove, or reopen with an owner decision |
| #313/#316 merge order | A compile error (`EXPORT_UPLOAD_BUCKET`) or inventory I1 red | CI | §15.6, §24 |

## 19. Security

- **Closed:**
  - KB-40: a cross-tenant destructive write, High, live in production.
  - KB-62's three latent DEFINER doors. They are not granted today, but they are one grant away from three more cross-tenant writes.
  - KB-69: a render-worker SSRF guard that proceeds on a DNS failure.
  - The KB-47 render producer, which enqueued on account membership.
  - `get_project_id_for_edit_project`, a DEFINER function with `search_path=public` and no check.
- **Attack surface removed:**
  - 23 server-action endpoints;
  - an unauthenticated-channel collaboration relay (`edit-operation` broadcasts any payload to anyone subscribed to a channel name);
  - a 2 GB Lambda that downloads caller-influenced URLs.
- **What this now allows that it did not before:** nothing. Every change removes a capability.
  - **Newly refused:** direct writes to the six tables by project writers. These succeeded before under RLS, and no UI makes them after PR A.
- **Tenant isolation of the kept rows:** the existing read policy (account role, or personal owner) is unchanged, and `anon` loses its unused table grants.
- **No production credentials** are used anywhere. The production counts are the owner's query (§31).

## 20. Performance and Scale

- There is nothing to scale.
- The client JS for the episode workspace no longer has the (lazy) edit-suite chunks.
- The deploy has one fewer Lambda to bundle, and the arm64 `ffmpeg-static` install goes with it, which makes the deploy faster.

## 21. Accessibility and Client Behavior

- The tab bar keeps its links and focus order, minus one.
- The post-production group renders one link inside the same pill container.
- There is no new text and no i18n.
- The removed export dialog was itself an accessibility failure (FILM-DS-04: no focus trap, no focus restore). That criterion's `reason:` is reworded, not fixed.

## 22. Observability and Operations

- **Before PR B:** the owner may check the render DLQ's depth in the AWS console (`StorybookRenderDLQ`, ApproximateNumberOfMessagesVisible). It is diagnostic only: each message there is a job that failed at step 1.
- **After PR B:** the SST deploy log shows the queues and the worker being deleted. CloudWatch keeps the worker's log group until its retention expires. SST does not delete log groups by default, so the owner may delete it by hand.
- **After PR A:** the Supabase API logs show `42501` for any call to the five functions.

## 23. Configuration and Feature Flags

- **No flag.** A flag would keep the KB-40 door open while off, and the owner decided to remove the feature, not to hide it.
- **Env removed:** `RENDER_QUEUE_URL` (SST-injected, not in any `.env*`).
- **R2 env** (`R2_*`) stays: other workers and the presign route use it.

## 24. Compatibility

- **DB ↔ app (PR A):** either order is safe (§18). The only caller of the revoked function is the page PR A deletes.
- **DB ↔ app (PR B):** the migration drops functions nothing calls and revokes writes nothing makes.
- **Old app + new DB** (a rollback of the app alone): the Edit Suite page would load and fail on every write. Acceptable, and not a data risk.
- **Generated types:** regenerated in both PRs.
- **Other open PRs:**
  - **#316 (KB-27):** its I1 lists `public.batch_assemble_edit_project`, which PR A's revoke removes from the "granted to authenticated" set. Whichever merges second deletes that line (and its comment).
  - **#313 / #318:** see §15.6.
  - **#323 (KB-38):** edits `packages/features/edit-suite/src/lib/presigned-upload.ts`. If #323 merges first, PR B deletes the file anyway. If PR B merges first, #323 drops that hunk and any `presign-callers.test.ts` entry for the edit suite.
  - **#322 (KB-22):** `sst.config.ts`, with no overlapping hunk.
  - **KB-58 (planning):** its inventory rows for the seven `edit-suite/src/server/*` files and `getMediaBinDataAction` (its T6) go away. After PR A the ids are already out of the manifest.
  - **KB-40 / KB-62 / KB-32 branches:** not merged. Their migrations (`20260923044050_kb40-…` and KB-62's) must **not** land after this. The owner or lead closes those branches.
  - **KB-66** stays open: it covers the five other lambdas.
- **`check:schema-drift`:** unaffected.
- **Lambda tsconfig:** `**/*.ts` minus a deleted directory. The markers go with it.

## 25. Migration and Rollout Strategy

**Order:**
1. **PR A** (stop-gap). Merge as soon as approved. Its timestamp is newer than `main`'s newest. It deploys through the normal workflow (migrations, then app).
   - Post-deploy check, by the owner: a direct `rpc/batch_assemble_edit_project` call as any signed-in user returns 403.
   - The workspace shows six tabs.
2. **Coordinate:** #313 (and #318), #316 and #323 merge, or are told to drop their edit-suite hunks.
3. **PR B.** Rebase on `main`, then refresh the migration timestamp (brief: "Rebasing after merges").
   - The owner may glance at the render DLQ depth first. Draining is not needed (§22).
   - The SST deploy removes the queues and the worker in the same apply that removes the web server's link and env. So no server version that can still send exists after the new one is live, and PR A already removed the only sender.

**Validation gates:** §26 and §27, in CI and locally.

**Rollback:**
- PR A: see §14.
- PR B: `git revert` restores the code. A forward migration re-grants the table privileges and re-creates the policies, and SST re-creates the queues (empty).
- Data is never at risk in the default path.

**The drop option (D3-b), if chosen.** Run the §31 query in production first. If every count is 0, the guarded migration is safe. If any count is non-zero, either export first (the owner runs `copy (select …) to …` through the dashboard or `pg_dump -t`) and decide, or stay with keep.

## 26. Testing Strategy

**PR A:**

- **pgTAP `apps/web/supabase/tests/database/edit-suite-retired.test.sql`** (red first against `main`'s schema, with the migration moved aside):
  - **P1–P3:** `has_function_privilege` is false for `anon` and `authenticated` on every overload of all five, and true for `service_role`.
  - **P4 (the attack):** with a fixture of owner O (a team project, an episode with an edit project and two tracks) and stranger S (personal account only), as S (`set local role authenticated` with S's claims), call `batch_assemble_edit_project(E, p_user_id => O, …)`. Expect `throws_ok '42501'`, then the victim project id and both tracks unchanged.
  - Red on `main`: P1 fails for assemble, and P4 does not throw. This is KB-40's A1, reproduced in SQL.
- **Playwright `apps/e2e/tests/episodes/workspace-tabs.spec.ts`.** Seed through the API (`seedTeamAccount`, `seedProject`, and an episode with `story_data`, `screenplay_data` and `shot_list` set so every tab unlocks), then `signInAs`.
  - **W1:** the tab bar's `[data-test^="episode-tab-"]` ids equal `ideation, story, screenplay, shot-list, audio, publish` exactly, and no element has the text "Edit Suite".
  - **W2:** each tab's link navigates to its URL and its page's own landmark (a heading or `data-test`) is visible. Publish shows the master-asset manager.
  - **W3:** `…/edit-suite` shows the not-found page.
  - Screenshots behind `CAPTURE_EVIDENCE=1`: the tab bar, Publish after clicking, and the not-found page.
  - **Red first:** W1 and W3 fail on `main`. The Edit Suite tab is present, and the page renders the editor.
- **Mutation guards** in `tooling/mutation-guards/film-607.json`, each seen `RED`:
  - (pgtap) the revoke loop's `proname` list without `batch_assemble_edit_project` → P1/P4 red;
  - (e2e) the `edit-suite` `POST_TABS` entry restored → W1 red.

**PR B:**

- **G1, a unit repo scan** `apps/web/test/film-607-edit-suite-retired.test.ts`. It walks `apps/` and `packages/` source plus `sst.config.ts`, skipping `node_modules`, `.next`, `apps/web/supabase/migrations/`, the generated types and this test. It fails, listing file:line, on any of:
  - `@kit/edit-suite`, `edit-suite/`, `render-worker`, `StorybookRender`, `RENDER_QUEUE_URL`, `ffmpeg-static`;
  - `batch_assemble_edit_project`, `batch_save_edit_project`, `create_edit_project_with_tracks`, `split_edit_clip`, `get_project_id_for_edit_project`;
  - `EXPORT_UPLOAD_BUCKET`, `'edit-operation'`, `'cursor-update'`, `render-status-changed`.
  - **Red on `main`:** it must name the tab, the page, `apps/web/package.json`, `sst.config.ts`, `websocket/default.ts` and the package and worker files.
  - Positive control inside the test: a fixture string proves the matcher fires.
- **pgTAP additions** to `edit-suite-retired.test.sql`:
  - **R1:** `hasnt_function` for all five names.
  - **R2:** for each of the six tables, `authenticated` lacks INSERT, UPDATE, DELETE and TRUNCATE, and `anon` lacks SELECT.
  - **R3:** as an account member, `select` returns their own edit project, so the read policy is kept.
  - **R4:** as the project owner, `insert into edit_tracks` throws `42501`.
  - **R5:** as the owner, deleting the episode removes its edit project and tracks (the cascade works without grants).
  - **R6:** deleting a shot referenced by an `edit_clip` sets `source_shot_id` null.
  - **R7:** `assets` still accepts `type = 'master_video'`.
  - **For the drop option instead:** `hasnt_table` ×6 and `hasnt_column('compilations','edit_project_id')`, plus the guard seen raising on a seeded row, then passing after the row is removed (FILM-513 §4.1's procedure).
- **Mutation guards:**
  - (unit) re-add `"@kit/edit-suite": "workspace:*"` to `apps/web/package.json` → G1 red;
  - (pgtap) the INSERT revoke removed → R2/R4 red;
  - (pgtap) the drop of `batch_assemble` removed → R1 red.
- **Existing suites that must stay green:**
  - `pnpm --filter web test` (includes `websocket/__tests__`);
  - `scripts/test-units.sh`;
  - `pnpm typecheck` (web and the lambda config);
  - the KB-6 guard (`packages/next/__tests__/kb6-caught-action-message.test.ts`), whose comment's "edit suite" mention is harmless;
  - all pgTAP;
  - `check:schema-drift`;
  - `check:types-current`.
- **E2E:** W1–W3 re-run on PR B, plus the Publish page's existing specs. A lambda test is not needed, because none remains for the render worker. KB-32's note on `// @vitest-environment node` applies to other lambdas only.

## 27. Production-Build Verification

**Applies:** the tab bar and the route are user-visible, and removing a package can break the production bundle in ways dev does not.
- `next build` in `apps/web`. It must succeed with no `@kit/edit-suite` module.
- Assertions on the artifacts:
  - `.next/app-paths-manifest.json` / `server/app-paths-manifest.json` has no `…/edit-suite/page` key;
  - `server/server-reference-manifest.json` has no action whose file is under `edit-suite`;
  - `grep -r "edit-suite" .next/static` finds nothing.
- These are recorded before (red: present on `main`) and after.
- `next start -p 3122`, sandboxed per the wave-1 rule:
  - `NODE_ENV=test`, `VENDOR_SANDBOX=1`, and the `VENDOR_URL_*` overrides;
  - a pre-flight that aborts if any override is ignored;
  - the episode workspace and Publish reach no vendor, but the server boots with every route.
- Then W1–W3 against it (`PLAYWRIGHT_BASE_URL=http://localhost:3122`).
- The build and `next start` take a heavy slot. The DB lock is taken first.

## 28. Requirement Traceability

| User Outcome | User Flow | Requirement | Design | Component | Data/API | Test | Production Verification |
|---|---|---|---|---|---|---|---|
| No stranger can wipe a timeline | API attack | FR-1, FR-5 | §14 revoke → drop | migrations | 5 RPCs | P1–P4, R1 | Owner's post-deploy `rpc` → 403/404 |
| No Edit Suite in the product | Entry, bookmark | FR-2, FR-3, FR-4 | §15.1–15.4 | tabs, route, package, worker, sst, websocket | route, actions, SQS | W1–W3, G1 | §27 manifests + W1–W3 on `next start` |
| Nothing a user made is lost | — | FR-6, FR-8 | §14 default D3 | migration | 6 tables, assets, storage | R2–R3, R7 | Row counts unchanged (owner, §31) |
| Nothing else breaks | Other tabs, Publish | FR-7, FR-9 | §9 | tabs, FKs | cascades | W2, R5–R6, full suites | §27 |
| Records tell the truth | — | FR-10 | §15.7 | specs, INDEX, FILM-CC-04 | — | Review | — |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Chosen, and why |
|---|---|---|
| Stop-gap | (a) revoke EXECUTE on the five; (b) drop them in PR A; (c) ship KB-40's fixed function (keeps assemble working); (d) no stop-gap, one big PR | **(a)**, as KB-40 and the lead recommend. It is the smallest reversible close of the live hole, and needs no code change for the RPC. (b) is equally small but irreversible while the package still exists. (c) spends effort on a feature being deleted. (d) leaves a High open while PR B waits on five other PRs |
| Tab in the stop-gap | (a) remove tab and route; (b) hide the tab only; (c) leave both | **(a).** With assemble revoked the page can do nothing, so a reachable broken editor is worse than a 404. Deleting the page also takes the 23 actions out of the manifest immediately |
| Data | (a) keep rows, read-only; (b) guarded drop; (c) unguarded drop | **(a)**, the owner's standing keep-until-asked rule. (b) is right only once production counts are known: a guard that raises stops every later migration in the deploy. (c) is never acceptable |
| WebSocket cases | remove / keep | **Remove.** Their only sender is deleted. Kept, they are an unauthenticated relay nobody uses |
| Storage | delete orphaned objects / keep | **Keep.** None can exist (§0), and `master_video` is shared with Publish. Deleting by prefix risks a Publish master |
| Records | retire FILM-601/602 only / also rewrite PRD/ENGINEERING_DESIGN | Retire the specs and add one-line notes to the historical plans. They are history, not claims about the code |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| Production has hand-added grants or objects that differ from migrations (#240 class) | The revoke loop still covers every overload, and the kept tables are unaffected | pgTAP locally; owner's post-deploy check | Revoke all five, not just the granted one | Owner reports; a follow-up migration |
| Merge-order collisions (#313, #316, #318, #322, #323) | Red CI on the second merge | CI | §24; PR A touches only #316's one line | Rebase; keep every side's text |
| A shared deletion removes something another feature needed | Build or runtime break | `pnpm typecheck`, G1, full unit/E2E, §27 build | The grep inventory (§8) shows no importer outside the page | Revert PR B (code only; no data change) |
| The owner later wants the edit rows gone | Rows linger | — | D3 recorded; §31 query | Guarded drop as a follow-up |
| Someone restores an Edit Suite file by copy-paste | Reintroduces a door | G1 | Guard names | Owner decision to reopen as a new spec |
| Browser Export 403 claim wrong (read, not run) | An export object could exist in R2 | Phase 2: call the presign route with the dialog's exact path | Default is keep-all storage, so being wrong loses nothing | — |

## 31. Open Questions and Assumptions

- **Owner production check (read-only; the owner runs it, the team never does):**

  ```sql
  select 'edit_projects', count(*) from public.edit_projects
  union all select 'edit_tracks', count(*) from public.edit_tracks
  union all select 'edit_clips', count(*) from public.edit_clips
  union all select 'edit_keyframes', count(*) from public.edit_keyframes
  union all select 'edit_transitions', count(*) from public.edit_transitions
  union all select 'dialogue_sync_groups', count(*) from public.dialogue_sync_groups
  union all select 'render_status<>none', count(*) from public.edit_projects where render_status <> 'none'
  union all select 'master_video made by the render worker', count(*) from public.assets where type = 'master_video' and metadata ? 'editProjectId';
  ```

  Needed only for the drop option. Keep needs nothing. The last line uses the tag the worker writes (`render-worker/index.ts:336-340`); `file_url` is the asset's URL column.
- **Assumption:** no production caller of the five functions other than the app. Checked by grep; there is no service-role or worker caller (KB-40 §8, KB-62 §8.2).
- **Assumption:** `compilations` stays out of scope (no code), and keeps its FK while `edit_projects` exists.
- **Question for the lead:** KB-62 has no FILM-CC-04 entry anywhere, and KB-64 to KB-69 exist only on KB-32's unpushed branch. Should PR B add short "resolved by removal" entries for them, or only the Fixed-table row? *Assume:* only the Fixed-table row, naming each id, plus the KB-32 banner, which is on `main`.

## 32. Implementation Plan

**PR A — `feat/film-607-retire-edit-suite` (or `fix/film-607-stop-gap` if the owner wants it separate; D1):**
1. Migration (§14 A). Under the DB lock: `db reset` from this worktree, then typegen. Write the pgTAP P1–P4 and run it **with the migration moved aside** to record red. Restore the migration and run green. Then the pgTAP mutation guard, seen `RED`.
2. Tabs and route (§15.1). `pnpm typecheck`.
3. Playwright W1–W3 on `next dev -p 3122`. Record red on `main` first (revert the tab change and restore the page), then green. Then the e2e mutation guard, and screenshots.
4. §27 production build and W1–W3 on `next start`, sandboxed.
5. The #316 inventory line, if #316 has merged. `pnpm lint:fix`, `pnpm format:fix`. Commit `fix(FILM-607): revoke the Edit Suite functions and remove its tab (closes KB-40)`. Push, and open a PR with screenshots.

**PR B (after A, and after coordinating #313/#316/#318/#323):**
1. G1 written first and run on the branch before any deletion. It must be red and name every file.
2. Delete the package; edit `apps/web/package.json`; `pnpm install` (lockfile). Then `pnpm typecheck`.
3. Delete the render worker; edit `sst.config.ts` (§15.3); edit the WebSocket handler (§15.4). Then `pnpm typecheck` and `pnpm --filter web test`.
4. §15.6 presign follow-up if #313 merged.
5. Migration (§14 B, per D3). Under the DB lock: reset, typegen, pgTAP R1–R7 red then green, guards `RED`.
6. Records (§15.7). Recompute the INDEX counts by script, not by hand.
7. G1 green; full unit (`scripts/test-units.sh`), pgTAP, E2E W1–W3 plus the Publish specs, §27 build. `lint:fix`, `format:fix`. The PR body lists the deleted surface as a table, and includes the screenshots.

One commit per group (UI, package, infra, database, records), so review reads as five deletions.

## 33. Definition of Done

- The KB-40 attack returns `42501` as a second real user (pgTAP P4 red→green). After PR B it returns "no such function".
- The workspace shows exactly six tabs, all working, on a production build. `/edit-suite` is not found. There are screenshots in both PRs.
- The package, worker, queues, env, WebSocket cases and five functions are gone, and G1 proves it (red on `main`).
- The six tables keep every row, read-only (default), and cascades still work (R2–R6).
- No storage object or `master_video` asset is touched.
- Typecheck (web and lambdas), lint, format, unit, pgTAP, `check:types-current` and `check:schema-drift` are green. Every mutation guard is `RED`.
- The records are updated: FILM-601/602 and PHASE-14 are RETIRED, FILM-607 is DONE, the KB entries are resolved by removal, and INDEX is recounted.

## 34. Final Consistency Pass

**Forward.**
- The problem is a tab that promises an editor which saves nothing, renders nothing, uploads nothing, and lets strangers overwrite timelines.
- The owner wants it gone, with nothing a user owns lost.
- The user sees six working tabs and uses Publish as today.
- The system must stop exposing the functions and remove the code and infrastructure. The data stays read-only.
- The architecture only shrinks. The work is two PRs: a stop-gap that closes the High today, and a mechanical removal coordinated with five open PRs.
- pgTAP proves the doors are shut, the data is kept and cascades work. Playwright proves the tabs on a production build, and G1 proves nothing returns.

**Reverse.**
- In production after both PRs, no code path reads or writes the edit tables. The rows sit read-only under their original read policy.
- The five functions do not exist, and the queues and worker do not exist.
- The episode workspace renders six tabs, and Publish reads `master_video` assets exactly as before.
- A user loses a tab that could not keep their work, and keeps everything they had. This matches §1.

---

## Decisions needed from the owner

| # | Decision | Recommended default |
|---|---|---|
| D1 | Ship the stop-gap (PR A) ahead of the full removal? | **Yes.** Revoke EXECUTE on all five functions from `public`, `anon` and `authenticated`, and remove the tab and route, today. PR B follows once #313/#316/#318/#323 settle |
| D2 | In PR A, revoke or drop the functions? | **Revoke** (reversible, and the lead's and KB-40's recommendation). PR B drops them |
| D3 | The edit tables' rows: (a) keep, read-only; (b) guarded drop (refuses if any row); (c) export then drop | **(a) keep, read-only.** Locally: 7 `edit_projects`, 14 `edit_tracks`, 0 in the other four (test fixtures). Production counts: the owner's query (§31). (b) is safe only if production is all zeros. A non-zero table would stop the deploy |
| D4 | Storage objects (`renders/…`, `…/master_video/export_*`) and `master_video` assets | **Keep all.** None can have been written by the Edit Suite (§0). `master_video` is shared with Publish. The owner may list the two R2 prefixes to confirm |
| D5 | Remove the WebSocket `edit-operation` / `cursor-update` relay? | **Yes.** It is Edit-Suite-only and unauthenticated per channel |
| D6 | Historical docs (PRD.md, ENGINEERING_DESIGN.md, research docs) | **One-line retirement notes** in PRD and ENGINEERING_DESIGN. The research docs stay untouched |
