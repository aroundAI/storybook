# KB-32 — Server render reads columns that don't exist: Engineering Design Document

| | |
|---|---|
| Ticket | KB-32, "Every edit-suite export render fails before FFmpeg runs" (`specs/cross-cutting/FILM-CC-04-known-bugs.md` § KB-32, filed by KB-14 in #309) |
| Severity | High. The server-render buttons in the export dialog can never produce a video |
| Branch | `fix/kb-32-render-worker-columns` from `origin/fix/kb-14-typecheck-lambdas` @ `6961478c` (stacked on #309) |
| Size | S–M. Two worker files, three new test files, one mutation-guard file. No migration, no UI change |
| Status | Approved 2026-09-23 (D1–D5 as recommended; D6, D7 out of scope). **Paused the same day:** the owner is retiring the Edit Suite (FILM-607), which removes this worker |

### Paused for FILM-607: what the removal must handle

Branch `fix/kb-32-render-worker-columns` (rebased on main `ef44ffce`, not
pushed) has the fix, unit tests and mutation guards. The end-to-end evidence
run never completed (§26 T6). Nothing below was changed on main by KB-32.

- **`sst.config.ts`** (line numbers on `ef44ffce`): `StorybookRenderDLQ`
  (`:412`), `StorybookRenderQueue` with its redrive policy (`:423-439`), the
  `renderQueue.subscribe` worker (`:836-900`), `renderQueue` in the web
  server's `link` (`:1001`), `RENDER_QUEUE_URL` (`:1100`), and
  `renderQueue.arn` in the web role's `sqs:SendMessage` policy (`:1222`).
  Removing the queue drops any messages still in it and in the DLQ. Check the
  DLQ depth first if anything should be kept.
- **`ffmpeg-static`** appears only in the render worker's `nodejs.install`
  (`sst.config.ts:894`) and `handlers/ffmpeg-render.ts`. It isn't in any
  `package.json` or the lockfile, so removing the worker removes it entirely.
- **`master_video` assets are shared. Keep the type.** The worker creates an
  `assets` row of type `master_video` per render and, for `en`, sets
  `episodes.master_video_asset_id`. The Publish page's master-asset manager
  (`…/publish/_components/master-asset-manager.tsx:72`) uploads
  `master_video` assets directly, and `episodes/src/server/actions.ts:544-652`
  reads and sets the link. Only the worker's writer goes. The CHECK value,
  the column and existing rows stay, because published videos may point
  at rendered masters.
- **R2 objects left behind:** server renders at
  `renders/<editProjectId>/<language>/output.mp4` (the worker's `uploadToR2`
  bucket prefix `renders`), and Browser Export uploads at
  `projects/<projectId>/assets/master_video/export_<lang|all>_<ts>.mp4`
  (`export-dialog.tsx`). A rendered file referenced by a `master_video` asset
  must not be deleted with the feature.
- **Also tied to server render:** `edit_projects.render_*` columns,
  `packages/features/edit-suite/src/server/render-actions.ts` (and its
  re-exports in `server/actions.ts:41-43`), the WebSocket
  `render-status-changed` message (`hooks/use-edit-suite-websocket.ts`), and
  `renderStatus`/`renderProgress` in the edit-suite state.
- **Follow-ups filed by KB-32 that the sunset makes moot:** KB-64, KB-65,
  KB-67 and KB-68 are Edit Suite or render-worker only. KB-69 (the SSRF guard)
  goes with `ffmpeg-render.ts`. KB-66 (untyped clients in five *other*
  lambdas) stays relevant.
- **Reusable beyond the Edit Suite:** the `vitest.setup.ts` guard lets any
  lambda test opt into `// @vitest-environment node`. happy-dom's `fetch`
  enforces browser CORS, so a Node worker's HTTP calls can't be tested under
  it (measured: a local POST was refused as cross-origin).

**What this plan found beyond the ticket.** The ticket names one defect (the
column names). Reading the worker and running it with real FFmpeg found two
more on the same path. Each would still fail or wrongly render every export
once the first is fixed:

1. **The rendered file is deleted before it is uploaded.**
   `processFFmpegRender` returns `outputPath`, but its own
   `finally { cleanupWorkDir() }` (`handlers/ffmpeg-render.ts:552-555`)
   unlinks every file in the work dir, the output included. Reproduced with
   the real handler and FFmpeg 6.0: it rendered 53,875 bytes, then returned a
   path for which `existsSync` is `false` (§8.4).
2. **A per-language export drops that language's dialogue.** The worker's
   filter rejects `is_active = false` first (`index.ts:222`). But `is_active`
   is the *preview* toggle: `SET_LANGUAGE` flips it per language
   (`state/edit-reducer.ts:317-329`), and auto-assemble writes non-preview dubs
   as inactive (`lib/auto-assemble.ts:335`). So "Export All" renders every
   language except the one on screen with no dialogue. The phase-14 design
   says the opposite: "Each job activates only the clips matching that
   language" (`specs/phase-14-edit-suite-v2/ENGINEERING.md:443`).

---

## 1. Start With the User

**Who.** The owner, and later any project member, finishing an episode in the
Edit Suite (`/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/edit-suite`).

**Problem.** They want an MP4 of the timeline they built, rendered on the
server: FFmpeg at full quality, without keeping a browser tab open, and one
file per language for dubbed episodes.

**Today.** The export dialog offers three buttons:

| Button | Path | State today |
|---|---|---|
| 🎬 Browser Export | WebCodecs worker in the tab (`workers/export.worker.ts`), then optional "☁ Upload to R2" | Not touched by KB-32. Upload fixed by KB-28 (#313) |
| 🖥 Server Render | `enqueueRenderAction` → SQS `StorybookRenderQueue` → `lambda/render-worker` | **Always fails.** The worker's first query errors (42703) |
| 🌐 Export All (n) | `enqueueMultiLanguageRenderAction` → one SQS message per language → same worker | **Always fails**, once per language |

A server render moves the project to `queued`, then `failed` with
`render_error = "Edit project not found: <uuid>"`. The dialog shows
"✕ Render failed: Edit project not found: …", which is false: the project
exists, and the worker's own query is what's wrong. SQS retries twice more
(`maxReceiveCount: 3`), each failing the same way, then the message goes to
the DLQ.

**After this change.** Server Render produces an MP4 of the active clips for
the chosen language: video clips trimmed to their in/out points, scaled and
padded to the project's width × height at its fps; audio clips placed at their
timeline position with clip × track volume. The worker uploads it to R2 at
`renders/<editProjectId>/<language>/output.mp4` and sets
`edit_projects.render_status = 'completed'` and `render_url`. It creates a
`master_video` asset, and for `en` links it to the episode. A live WebSocket
session shows "✓ Render complete · Download ↗". Export All does the same once
per language, and each language's file carries that language's dialogue.

**Success.** A playable H.264/AAC MP4, 4:2:0 so browsers and QuickTime
play it, whose duration and resolution match the timeline and project.
**Failure.** `render_status = 'failed'` with a `render_error` that names the
stage that failed (load, render, upload), not a false "not found".

**What persists.** `edit_projects.render_*` columns, the R2 object, the
`assets` row, `episodes.master_video_asset_id`. **What does not.** Progress
percentages (WebSocket only), the worker's temp files (deleted after upload).

**Not in this change (see §31).** Server render does not apply transitions,
keyframes, title tracks or gaps in the video track. It never has; §31 Q2 and
Q3 propose a follow-up. After a page reload the dialog does not show a
finished render, because its status comes only from the WebSocket (§31 Q4).

## 2. Define the Complete User Journey

| Stage | User action | System response | User sees | Next |
|---|---|---|---|---|
| Entry | Opens Edit Suite, clicks Export in the toolbar | `ExportDialog` mounts (`toolbar.tsx:271`) | Language chips, FFmpeg preview, three buttons | Pick a language / render |
| Queue | Clicks 🖥 Server Render | `enqueueRenderAction` checks membership, sets `render_status='queued'`, sends SQS `{editProjectId,userId,language}` | "⟳ Queueing render job…", then "⏳ Render queued" on WebSocket | Wait / close dialog |
| Render | none | Worker: set `rendering`, load rows, filter clips, download media, run FFmpeg, upload, create asset | Progress bar 0→100 over WebSocket | Wait |
| Done | none | `render_status='completed'`, `render_url` set, WebSocket `completed` | "✓ Render complete · Download ↗" | Download |
| Fail | none | `render_status='failed'`, `render_error` set, WebSocket `failed` | "✕ Render failed: <stage>: <reason>" | Retry the render |
| Close / navigate away | Closes dialog or leaves | Job continues on SQS/Lambda | Nothing | Return later |
| Refresh / re-entry | Reloads page | Client state starts at `renderStatus: 'idle'` (`state/types.ts:172`); DB value not read | No status, even if completed (existing gap, §31 Q4) | Re-open dialog |
| Cancel | none exists | Server renders cannot be cancelled (unchanged) | n/a | n/a |

## 3. Explicitly Define the Happy Path

Fixture used throughout (and in the evidence test, §26): project 1280×720 @
30 fps; video track with clip V1 (timeline 0–2000 ms, source 0–2000) and V2
(2000–3000, source 1000–2000); dialogue track with an EN line (500–2500,
active) and its ES dub (500–2500, **inactive**).

1. **User** clicks Server Render with EN selected. **Action** verifies
   membership and writes `render_status='queued'`, then sends the SQS message.
2. **Worker step 1** updates the row to `rendering` and reads back
   `id, episode_id, width, height, fps` (real columns). It returns
   `{width:1280,height:720,fps:30}`.
3. **Worker step 2** reads every track and clip of the project, paged (§15),
   on real columns: `media_url, start_ms, end_ms, in_point_ms, out_point_ms,
   volume, speed, fade_in_ms, fade_out_ms, language, is_active`.
4. **Filter** for `en`: V1, V2 (no language, active) and the EN line. For `es`:
   V1, V2 and the ES dub, although the dub is inactive in the preview.
5. **FFmpeg**: `trim=0:2` and `trim=1:2` on the videos, each scaled and padded
   to 1280:720, concatenated. `atrim=0:2,adelay=500|500` on the line.
   `-r 30 -pix_fmt yuv420p`.
6. **Output** lives in a per-job directory until the upload and the hash have
   read it. Duration ≈ 3.0 s video / 2.5 s audio, 1280×720, yuv420p.
7. **Upload** to `renders/<id>/en/output.mp4`. Then the asset row is created
   and linked, `render_status='completed'` and `render_url` set, and the work
   dir removed.
8. **User** sees "✓ Render complete · Download ↗". That is success because the
   file exists, plays, and matches the timeline.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User sees | Recovery | Final state |
|---|---|---|---|---|
| Edit project deleted between queue and render | Step 1 returns PGRST116 | "Render failed: edit project not found" | None needed | message retried ×3 then DLQ; row gone |
| Step-1 query error (schema drift, permissions) | Error code logged with context; `render_error = "Could not load the edit project (<code>)"` | That message | Operator fixes; user retries | `failed` |
| Tracks/clips read errors | Now thrown (previously ignored, rendering as "no clips") | "Could not load the timeline (<code>)" | Retry | `failed` |
| No active clip with media for that language | `No valid clips with media to render` (unchanged) | That message | Add media, retry | `failed` |
| Clip media download fails (non-2xx, SSRF block) | Throws (unchanged) | "Failed to download media: 404 …" | Fix media, retry | `failed` |
| FFmpeg exits non-zero | stderr logged, throws (unchanged) | "FFmpeg failed: …" | Operator reads log | `failed` |
| R2 upload fails | Throws; work dir still removed in `finally` | "R2 …" message | Retry | `failed` |
| Asset creation fails | Logged, non-fatal (unchanged) | "✓ Render complete" | none | `completed`, no asset |
| Duplicate SQS delivery / retry | Re-renders; same R2 key overwritten; asset dedup by SHA-256 (unchanged) | Same as success | n/a | `completed` |
| Two languages concurrently (Export All) | Separate per-job dirs, so no collision (today they share `/tmp/render`, and one job's cleanup deletes the other's files) | Each completes | n/a | Last to finish wins `render_url` (existing, §31 Q5) |
| Clip count > 1000 | Paged reads return every clip (today silently truncated at 1000) | Complete render | n/a | `completed` |
| Compilation edit project (`episode_id` null) | Refused earlier by `verifyEditProjectOwnership` (`episodes!inner`) | "Failed to enqueue render" | Out of scope, §31 Q6 | `none` |
| Unauthorised user | Unchanged: action checks account membership (KB-47 owns the write-rule question) | Refusal | n/a | unchanged |
| Large input exceeding Lambda `/tmp` (512 MB default) | ENOSPC from download or FFmpeg | "…ENOSPC…" | Out of scope, §30 R5 | `failed` |

## 5. Establish the User-Facing Contract

No UI change. The contract is the existing dialog's, now honoured:

- **Inputs:** `editProjectId`, `language` (2–10 chars) via the two enqueue actions (unchanged).
- **Status values:** `none → queued → rendering → completed | failed` in `edit_projects.render_status` (unchanged CHECK).
- **Success:** `render_url` = public R2 URL of an MP4 (H.264 yuv420p + AAC 48 kHz), `render_completed_at` set.
- **Failure:** `render_error` is a one-line message naming the stage: `Could not load the edit project (<code>)`, `Could not load the timeline (<code>)`, or the existing download/FFmpeg/R2 messages. It never says "not found" for a query error.
- **Language rule:** a render for language L includes every active clip without a language, plus every clip whose `language = L`, whether or not it is active in the preview. Clips on muted tracks are excluded.
- **Permissions/visibility:** unchanged (§19).

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Why | Verification |
|---|---|---|---|
| FR-1 | Step 1 selects only columns that exist (`id, episode_id, width, height, fps`) and succeeds against the real schema | The 42703 | Real-DB run (§8.3 red → green); typecheck with typed client |
| FR-2 | Tracks and clips are read on real columns, typed from `Database`, so a missing column fails `pnpm typecheck` | Fix the class for this worker | Red: restore one old column → `tsc` error |
| FR-3 | Transitions and keyframes are no longer fetched (the renderer ignores them), or fetched on real columns if the owner prefers (D2) | The `clip_id`/`time_ms` selects | Typecheck; code review |
| FR-4 | Every read's error is checked; a query error is not reported as "not found" | This bug hid behind "Edit project not found" | Unit test on the load function with a failing fake |
| FR-5 | Reads whose completeness matters are paged (`fetchAllRows`/`fetchAllByIds`, ordered by `id`) | PostgREST caps at 1000 silently | Code review; `@kit/shared` pagination tests |
| FR-6 | The output file exists when the caller uploads and hashes it; temp files are removed after that, on success and failure | Output deleted before upload | Unit test with fake FFmpeg; real run |
| FR-7 | Concurrent jobs in one container use separate work dirs | Shared `/tmp/render` cleanup races | Unit test: two dirs differ; code review |
| FR-8 | Language selection: no-language clips when active; language-L clips regardless of `is_active`; muted tracks excluded | Per-language export drops dialogue | Unit tests (en, es, muted, inactive no-language) |
| FR-9 | Output is `-pix_fmt yuv420p` (D3) | Non-4:2:0 sources give High 4:4:4, which browsers and QuickTime don't play | Unit test on args; real run probes `yuv420p` |
| FR-10 | The four `@ts-expect-error KB-32` markers are removed | They fail the build (TS2578) once fixed | `grep -rn KB-32 apps/web/lambda` empty; typecheck |
| FR-11 | One export renders end to end from seeded clips; output duration and resolution checked | KB-32 acceptance criterion 3 | Local evidence test (§26 T6) |

## 7. Define Non-Functional Requirements

- **Performance:** paging adds one request per 500 clips; a typical episode (<200 clips) stays at one request per table. Two fewer requests (transitions and keyframes dropped).
- **Reliability:** no shared mutable temp state between jobs (FR-7).
- **Resource use:** temp usage unchanged per job; removed on failure too (today a thrown FFmpeg error does clean up, but an upload failure after the fix must as well).
- **Security:** no new inputs, no new endpoints; the SSRF guard is unchanged (§19).
- **Observability:** failure logs carry `editProjectId`, `language`, stage, PostgREST code (§22).
- **Compatibility:** SQS message shape, DB schema and UI unchanged (§24).
- **Cost:** the same one FFmpeg run per job. The fix makes jobs succeed, so each queued render now costs a real Lambda run: up to 15 min × 2 GB, versus about 1 s today.

## 8. Analyze the Existing System

### 8.1 Components

| Piece | File | Role |
|---|---|---|
| Export dialog | `packages/features/edit-suite/src/components/export/export-dialog.tsx` | Three export buttons; shows `data.renderStatus` |
| Enqueue actions | `packages/features/edit-suite/src/server/render-actions.ts` | Membership check, `render_status='queued'`, SQS send |
| Queue | `sst.config.ts:411-439` `StorybookRenderQueue` (+ DLQ, 3 receives, 15-min visibility) | |
| Worker | `apps/web/lambda/render-worker/index.ts` | Load rows, filter, call renderer, upload, asset, status |
| Renderer | `apps/web/lambda/render-worker/handlers/ffmpeg-render.ts` | Download media, build args, run FFmpeg |
| R2 upload | `apps/web/lambda/render-worker/utils/r2-storage.ts` | `PutObject` to `https://<account>.r2.cloudflarestorage.com` |
| FFmpeg | `ffmpeg-static` installed by SST (`nodejs.install`, unpinned → 5.3.0 today = FFmpeg 6.0) | |
| Status push | WebSocket via DynamoDB connections + API Gateway (`sendToUser`) | Skipped when not configured |
| Client status | `hooks/use-edit-suite-websocket.ts` → `SET_RENDER_STATUS` | Only source of `renderStatus` |

Tables (`20260219083555_edit-suite-v2.sql`; `compilation_id` added by
`20260722172000_compilations.sql:182-187`; no migration adds the worker's
columns): `edit_projects(width,height,fps,…)`, `edit_tracks`, `edit_clips(media_url,
start_ms,end_ms,in_point_ms,out_point_ms,volume,speed,fade_in_ms,fade_out_ms,language,is_active,…)`,
`edit_transitions(from_clip_id,to_clip_id,…)`, `edit_keyframes(clip_id,offset_ms,…)`.

### 8.2 The two halves disagree

`index.ts` (the loader) was written against a schema that was never
migrated. `ffmpeg-render.ts` (the renderer) was written against the real one.

| Loader selects (`index.ts`) | Real column | Renderer reads (`ffmpeg-render.ts`) |
|---|---|---|
| `metadata, canvas_width, canvas_height, duration_ms` (`:179`) | `width, height, fps` | `project.width/height/fps` (`:324, :431`) |
| `duration_ms, source_url, source_type, params, content_type, trim_start_ms, trim_end_ms` (`:201`) | `end_ms, media_url, in_point_ms, out_point_ms, speed, fade_in_ms, fade_out_ms` | `clip.media_url, in_point_ms, out_point_ms, speed, fade_*_ms, end_ms` |
| transitions `clip_id` (`:211-212`) | `from_clip_id, to_clip_id` | not read |
| keyframes `time_ms` (`:215`) | `offset_ms` | not read |

The client is `createClient(url, key)` with no `Database` generic (`index.ts:45`),
so the select strings are unchecked. KB-14's typecheck saw the mismatch only
because the renderer's hand-written interfaces disagreed with the loader's
inferred rows. The four markers at `index.ts:246, 249, 251, 253` record it.

### 8.3 Reproduced against the local database

(DB lock held; `supabase db reset` from this worktree; fixture from §3 seeded;
requests sent through supabase-js as the worker's service role; script in the
PR evidence.)

Run 2026-09-23 04:13:36–04:14:05Z (lock held 29 s; fixture deleted before release):

| # | Request (verbatim from `index.ts`) | Result |
|---|---|---|
| 1 | `update edit_projects set render_status='rendering' … select id, episode_id, render_status, render_url, metadata, canvas_width, canvas_height, fps, duration_ms` | `42703 column edit_projects.canvas_height does not exist` |
| | `render_status` before / after | `none` / `none`. The whole update is rejected |
| 2 | `edit_clips select … duration_ms, source_url, source_type, … params, content_type, trim_start_ms, trim_end_ms …` | `42703 column edit_clips.duration_ms does not exist` |
| 3 | `edit_transitions select id, clip_id, … .in('clip_id', …)` | `42703 column edit_transitions.clip_id does not exist` |
| 4 | `edit_keyframes select … time_ms …` | `42703 column edit_keyframes.time_ms does not exist` |
| 1c | Control: same update, `select id, episode_id, render_status, width, height, fps` | `{"render_status":"rendering","width":1280,"height":720,"fps":30}` |
| 2c–4c | Controls on real columns | All four clips (numeric `volume`/`speed` arrive as JSON numbers), the transition, the keyframe |

Worker filter (`index.ts:220-232`) applied to the real rows:

| Language | Clips kept | Should be |
|---|---|---|
| `en` | V1, EN line, V2 | same |
| `es` | V1, V2 | V1, **ES dub**, V2. The dub is dropped because it is inactive in the EN preview |

From the code (the handler itself is run red in Phase 2, T6), the worker then
throws `"Edit project not found: <id>"` and its catch block stores that as
`render_error` with `failed` (`index.ts:183-185, 419-430`). The 42703 is
discarded, so the stored error is false.

Scripts (session scratchpad `kb32/`): `seed.sql`, `repro-db.mjs`,
`run-db-repro.sh` (lock → reset → seed → repro → delete → release),
`repro-output-deleted.ts` (§8.4). Phase 2 folds them into T6.

### 8.4 Reproduced: the output is deleted before upload (real FFmpeg, no DB)

`ffmpeg-static@5.3.0` (FFmpeg 6.0, the package SST installs into the
Lambda) was installed into the session scratchpad. That left the lockfile
untouched. The real `processFFmpegRender` ran on two seeded clips. Media was
pre-placed where `downloadMedia` caches it, and the URLs used the reserved
`.invalid` TLD, so no request left the machine.

```
[FFmpeg] Render complete: 53875 bytes (0.1 MB)
returned outputPath: …/render/output_kb32_en.mp4
returned durationMs: 3000
outputPath exists after return: false
```

`index.ts:271` then calls `createReadStream(result.outputPath)`, so every
render that got past the columns would fail at upload with ENOENT.

### 8.5 A second finding from the same probe: pixel format

The worker's filter graph ran as written, but the output was `yuv444p`
(H.264 High 4:4:4) because the source was not 4:2:0 and no `-pix_fmt` is set.
Safari, QuickTime and most hardware decoders can't play 4:4:4. VEO output is
normally 4:2:0, but uploaded clips and stills are not guaranteed to be (D3).

### 8.6 Siblings (fix the class)

- **Untyped clients in the other lambdas.** Six workers construct
  `createClient` without `Database` (`render-worker`, `voice-worker`,
  `publish-worker`, `llm-worker`, `scheduled-publish`, `email-worker`), about 130
  `.from()` calls. Any of them could select a missing column unseen.
  **Reported, not fixed here** (D5): typing them all is its own sweep and
  may surface many errors. Recommend the lead file it as a KB.
- **Three FFmpeg/export builders with different rules.** Client preview
  (`lib/ffmpeg-builder.ts`: `upload` tracks are audio; applies transitions and
  keyframes), worker (`upload` is video; ignores both), Browser Export
  (`export-dialog.tsx:149` filters `isActive` first, so it has the same
  language bug as the worker). **Reported, not fixed** (D1, §31 Q2).
- **The status path never reads the DB.** `getRenderStatusAction` ("fallback
  when WebSocket is unavailable") has no caller (§31 Q4).

## 9. Define the Desired System Behavior

| User action | Application logic | Service interaction | Data operation | Response | User-visible |
|---|---|---|---|---|---|
| Server Render | unchanged enqueue | SQS send | `render_status='queued'` | `{success,status:'queued'}` | Queued |
| (worker) | `loadRenderInput` | PostgREST (service role, typed) | update→`rendering`; paged reads of tracks and clips | typed rows | Progress 0/10 |
| (worker) | `selectRenderClips(tracks, clips, language)` | none | none | clip subset | Progress 10 |
| (worker) | `processFFmpegRender({…, workDir})` | HTTPS media fetch, FFmpeg | files in `workDir` | `{outputPath,durationMs}` | Progress 10–90 |
| (worker) | upload, hash, asset, status | R2, PostgREST | R2 object; `assets`, `episodes`, `edit_projects` | URL | Complete |
| (worker, finally) | `rmSync(workDir)` | none | temp removed | none | none |

## 10. High-Level Architecture

Unchanged topology: browser → server action → SQS → Lambda → (PostgREST, R2,
media host, FFmpeg child process, API Gateway WebSocket). The changes are
inside the Lambda:

- **Loader** (`index.ts`) owns the typed DB reads and the work-dir lifecycle.
- **Renderer** (`ffmpeg-render.ts`) is a pure pipeline over a caller-given
  work dir. It downloads, builds args and runs FFmpeg, and never deletes the
  file it returns.
- **Types**: the renderer's row types are derived from `Database`
  (`Tables<'edit_clips'>` picks), so the loader and the renderer can't
  disagree again without a compile error.

Trust boundary: SQS body is trusted as before (KB-33/KB-47 own validation and
authz of payloads).

## 11. Architecture and Flow Diagrams

```
ExportDialog ──enqueueRenderAction──▶ SQS StorybookRenderQueue ──▶ render-worker handler
                                                                        │
     ┌──────────────────────────────────────────────────────────────────┘
     ▼
 loadRenderInput(db, id)            (typed; update→rendering; paged tracks, clips)
     │  42703 today ✗ ── fixed: real columns
     ▼
 selectRenderClips(tracks, clips, lang)   (language rule, FR-8)
     ▼
 workDir = mkdtemp(tmpdir()/render-)       (per job, FR-7)
     ▼
 processFFmpegRender({project,tracks,clips,lang,workDir})
     │  download → buildFFmpegArgs (+ -pix_fmt yuv420p) → ffmpeg
     │  returns outputPath   ── today: finally deletes it ✗ ── fixed: no cleanup here
     ▼
 uploadToR2(stream(outputPath)) → sha256 → assets/episodes → edit_projects completed
     ▼
 finally: rmSync(workDir, recursive)
```

State transitions: see §17.

## 12. End-to-End Data Flow

**Source:** edit-suite rows written by the editor and `batch_assemble_edit_project`
(KB-40 is changing that RPC's authz, not its columns). **Validation:** DB
CHECKs (`end_ms > start_ms`, speed 0.25–4.0, volume 0–2). **Transformation:**
rows → renderer types (identity on real columns) → FFmpeg filter strings
(ms→s). **Filtering:** FR-8. **Ordering:** reads ordered by `id` for stable
paging; the renderer sorts by `start_ms` itself (`ffmpeg-render.ts:274, 286`).
**Persistence:** R2 object, `assets` row, `edit_projects.render_*`.
**Consumers:** export dialog (via WebSocket), publishing (via master asset).

Loss and duplication points:
- *Lost:* clips beyond 1000 rows (fixed by paging). The output file (fixed).
  A dialogue language (fixed).
- *Duplicated:* SQS redelivery re-renders to the same key. Asset dedup by hash (unchanged).
- *Stale:* the same R2 key is overwritten per render, so a CDN may serve the old file (§31 Q5).
- *Incorrectly transformed:* gaps in the video track are not preserved
  (concat ignores `start_ms`), so audio placed by `adelay` can drift from
  video when the video track has gaps (§31 Q3).

## 13. Data Model

No change. Authoritative sources: `edit_projects.width/height/fps` for canvas;
`edit_clips` timeline and trim columns for timing; `edit_tracks.volume/is_muted`
for mix; `edit_clips.language` for language membership. `is_active` is
**preview state**, authoritative only for clips without a language.
`render_*` columns are owned by the worker after `queued`.

## 14. Database Design and Changes

None. No migration, no type regeneration. The fix aligns code to the
existing schema. (`schemas/` is not consulted.)

## 15. Low-Level Design

**`index.ts`**
```ts
import type { Database } from '@kit/supabase/database';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
const supabase = createClient<Database>(url, key, {...});

async function loadRenderInput(db, editProjectId) {
  const { data: project, error } = await db.from('edit_projects')
    .update({ render_status: 'rendering', render_started_at: now, render_error: null })
    .eq('id', editProjectId)
    .select('id, episode_id, width, height, fps')
    .maybeSingle();
  if (error) { log(error); throw new RenderStageError('Could not load the edit project', error.code); }
  if (!project) throw new RenderStageError('Edit project not found');
  const tracks = await fetchAllRows(r => db.from('edit_tracks')
    .select('id, type, name, sort_order, volume, is_muted')
    .eq('edit_project_id', editProjectId).order('id').range(...r), 'edit_tracks');
  const clips = await fetchAllByIds(tracks.map(t => t.id), (chunk, from, to) =>
    db.from('edit_clips').select(RENDER_CLIP_COLUMNS).in('track_id', chunk)
      .order('id').range(from, to), 'edit_clips');
  return { project, tracks, clips };
}
```
`fetchAllRows` throws on a query error; the loader wraps that as
"Could not load the timeline (<code>)".

`selectRenderClips(tracks, clips, language)` is exported and pure (FR-8):
```
track muted or missing → drop
clip.language set      → keep iff clip.language === language
else                   → keep iff clip.is_active
```

Work dir: `const workDir = mkdtempSync(join(tmpdir(), 'render-'))` before
rendering; `try { render; upload; hash; asset; status } finally { rmSync(workDir, {recursive:true, force:true}) }`.

**`ffmpeg-render.ts`**
- Types: `EditProject = Pick<Tables<'edit_projects'>, 'id'|'width'|'height'|'fps'>`,
  `EditTrack`, `EditClip` likewise; `RENDER_CLIP_COLUMNS` exported next to
  `EditClip` so the select string and the type sit together.
- `RenderInput` gains `workDir`; loses `transitions`/`keyframes` (D2).
- `WORK_DIR` constant and `cleanupWorkDir` removed; `downloadMedia` writes into `workDir`.
- `buildFFmpegArgs` exported for tests; adds `-pix_fmt yuv420p` (D3).
- No other change to filter construction (gap and transition fidelity out of scope).

`FFMPEG_PATH` is still resolved at module load. Tests set it before importing.

## 16. API and Event Design

No change. SQS message `{editProjectId, userId, language}` with attribute
`jobType=video-render`. Delivery is at least once. Up to 3 receives, then DLQ.
A failed record goes back via `batchItemFailures`. The WebSocket event
`render-status-changed` keeps its shape.

## 17. State and Lifecycle Design

`edit_projects.render_status`: `none → queued` (action) `→ rendering` (worker
step 1) `→ completed | failed` (worker). Retry path: `failed → rendering` on SQS
redelivery or a new user request. Terminal for a job: `completed`, or `failed`
after the third receive. Today `queued → rendering` never happens: the step-1
update is rejected as a whole by 42703, and the catch block writes `failed`.
After the fix every transition occurs.

## 18. Failure and Error Handling

| Operation | Failure | Behaviour | User sees | Recovery |
|---|---|---|---|---|
| Step 1 | PostgREST error | log `{editProjectId, language, code, message}`; throw stage error | "Could not load the edit project (42703)" | Operator |
| Step 1 | 0 rows | throw | "Edit project not found" | none |
| Reads | error in any page | `fetchAllRows` throws; wrapped | "Could not load the timeline (<code>)" | Retry |
| Render | download/FFmpeg | unchanged messages; workDir removed | message | Retry |
| Upload | R2 error | throw; workDir removed | message | Retry |
| Asset | error | logged, non-fatal (unchanged) | success | none |
| Status write on failure | error | logged (unchanged) | stale `rendering` | Retry |

SQS retries a failed record up to 3 receives, then DLQ (unchanged).

## 19. Security

No change to authentication, authorisation or tenant isolation. The worker
already uses the service role and trusts the SQS body. Whether the *producer*
applies the owner's project write rule (`can_write_project`) is **KB-47**, and
this plan does not touch `render-actions.ts`. Noted for KB-47:
`enqueueRenderAction` checks only account membership. Its `.update` goes
through RLS (`edit_projects_update` requires a project member), so for a
non-member it updates 0 rows **without an error**, and the SQS message is
still sent. The SSRF guard in `downloadMedia` is unchanged. Its "DNS lookup
failed, proceeding" branch is what makes the `.invalid` fixture work locally.
It's pre-existing and noted for the SSRF owner. The error text written to
`render_error` contains no secrets (stage, PostgREST code, FFmpeg or R2 message).

## 20. Performance and Scale

Expected volume: a handful of renders per day (one owner). Reads: at most 1
update, 1 track page, ⌈tracks/200⌉ × ⌈clips/500⌉ clip pages. That's normally 3
requests, down from 5. FFmpeg time and memory unchanged. `/tmp` 512 MB
(no `ephemeralStorage` in `sst.config.ts`) bounds media + output per job (R5).

## 21. Accessibility and Client Behavior

No client change. Existing dialog markup is unchanged.

## 22. Observability and Operations

- Each stage failure logs `[Render] <stage> failed` with `editProjectId`,
  `language`, PostgREST `code`/`message` or FFmpeg stderr. The swallowed
  PostgREST error is how 42703 hid as "not found".
- Success logs clip count, output bytes and duration (existing lines).
- **Operator check that it works:** `edit_projects.render_status='completed'`
  with a `render_url`, and a `master_video` asset per render. **Failure:** a
  non-empty `render_error`, CloudWatch `/aws/lambda/*RenderWorker*` stage logs,
  and DLQ depth on `StorybookRenderDLQ`.

## 23. Configuration and Feature Flags

No new configuration. Existing: `FFMPEG_PATH` (override), R2 vars,
`CONNECTIONS_TABLE_NAME`/`WEBSOCKET_ENDPOINT` (WebSocket skipped when empty),
`RENDER_QUEUE_URL`/`Resource.StorybookRenderQueue` (producer). No flag: the
feature is broken today, so there is nothing to protect by gating the fix.

## 24. Compatibility

SQS payload, DB schema, WebSocket event and UI are unchanged. Messages already
in the queue or DLQ are processed by the new worker unchanged. Deployment
order: none (worker-only change). `processFFmpegRender`'s signature changes
(adds `workDir`, drops `transitions`/`keyframes`); its only caller is
`index.ts`.

## 25. Migration and Rollout Strategy

No migration. Ships with the next `sst deploy` (worker bundle). Validation
gate before merge: typecheck, unit tests, mutation guards, the local evidence
run (§26 T6). After deploy, the owner renders one episode in EN from the Edit
Suite and checks the file plays. The rollback trigger is `render_error` on
that render. Rollback is a redeploy of the previous bundle, which restores
"always fails", so there's no data to undo (rows written are the ordinary
render outputs).

## 26. Testing Strategy

All unit tests live in `apps/web/lambda/render-worker/__tests__/`. They run
in CI via `pnpm --filter web test` (Unit Tests job, `scripts/test-units.sh`),
under `// @vitest-environment node`.

| # | Test | Layer | Red before green |
|---|---|---|---|
| T1 | Typed client: `pnpm typecheck` (`tsc -p lambda/tsconfig.json`) | CI TypeScript job | Restore `canvas_width` in the step-1 select → TS error at the use site; record in PR |
| T2 | `select-render-clips.test.ts`: en keeps EN line, drops ES; es keeps inactive ES dub, drops EN; inactive no-language clip dropped; muted track dropped | Unit | Mutation guard: reinstate `if (!clip.is_active) return false` first → ES case red |
| T3 | `ffmpeg-render-output.test.ts`: `processFFmpegRender` with `FFMPEG_PATH` = a 3-line fake `ffmpeg` script that writes its last argument; media pre-seeded under `workDir` via `.invalid` URLs; asserts output exists after return and `workDir` differs per call | Unit, no binary needed | Mutation guard: re-add a `finally` that empties `workDir` → red |
| T4 | `build-ffmpeg-args.test.ts`: fixture rows → `trim=1:2`, `scale=1280:720`, `-r 30`, `-pix_fmt yuv420p`, `adelay=500\|500` | Unit | Mutation guard: drop `-pix_fmt` → red; swap `in_point_ms`→`0` → red |
| T5 | `load-render-input.test.ts`: fake client whose update returns an error → message contains the code, not "not found"; fake returning 0 rows → "not found"; failing clip page → throws | Unit | Mutation guard: collapse to `if (projectError \|\| !project) throw 'not found'` → red |
| T6 | `render-evidence.test.ts`, skipped unless `RENDER_EVIDENCE=1`: seeds §3's fixture through the service role on **local** Supabase; calls the real `handler` with an SQS event; real FFmpeg via `FFMPEG_PATH`; `../utils/r2-storage` mocked to copy the stream to a local file | Local evidence (DB + FFmpeg) | Run on the unfixed worker first: `render_status='failed'`, `render_error` "Edit project not found" |

T6 asserts: `render_status='completed'`, `render_url` set, `render_error`
null; one `master_video` asset linked to the episode (EN); output probed with
`ffmpeg -i`: 1280×720, `yuv420p`, h264 + aac, duration 3.0 s ± 0.1 (video), and
the ES render's audio stream present (the dub included). A second run for
`es` asserts the ES dub's clip is in the args (via a spy on the renderer's
log line) and that its render succeeds.

**Sandbox pre-flight in T6** (aborts before any work if violated):
`SUPABASE_URL` host is `127.0.0.1`/`localhost`; `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`,
`CONNECTIONS_TABLE_NAME`, `WEBSOCKET_ENDPOINT` and `AWS_LAMBDA_FUNCTION_NAME` are
unset; every seeded `media_url` host ends in `.invalid`; `NODE_ENV=test`,
`VENDOR_SANDBOX=1`, `AWS_EC2_METADATA_DISABLED=true`. The worker reaches no
`vendorUrl` host, so no `VENDOR_URL_*` override applies. It's asserted by
the list above, and the R2 module is mocked, not pointed elsewhere. T6 runs
under the DB lock, after a `db reset` from this worktree, and removes its rows.

Mutation guards: `tooling/mutation-guards/kb-32.json` (T2–T5 entries, kind
`unit`). No UI change, so no Playwright or screenshots. The dialog is not
driven, because locally there is no SQS and no WebSocket to carry the status
back (§27).

## 27. Production-Build Verification

The production artifact is the esbuild bundle SST builds, run on Lambda
(linux-arm64, `ffmpeg-static` installed at deploy).

- **Verified locally:** the worker bundles with esbuild
  (`--platform=node --bundle`, SST's externals: `ffmpeg-static`, AWS SDK,
  `@supabase/supabase-js`, `ws`). The bundle loads and exports `handler`.
  `@kit/shared/pagination` is inlined (it's pure; `@kit/shared/vendors` is
  already inlined into other workers the same way). T6 runs the source
  through the real handler with the same FFmpeg major/minor (6.0,
  `ffmpeg-static@5.3.0`).
- **Not verifiable locally, stated in the PR:** the Lambda runtime and its
  linux-arm64 FFmpeg binary; the real R2 upload and public URL; WebSocket
  delivery to the dialog; SQS redrive; `/tmp` limits. The first owner render
  after deploy is the check (§25).

## 28. Requirement Traceability

| User Outcome | User Flow | Requirement | Design | Component | Data/API | Test | Production Verification |
|---|---|---|---|---|---|---|---|
| A render starts | Server Render | FR-1, FR-10 | §15 step 1 | index.ts | edit_projects | T1, T6, §8.3 | first owner render |
| No future column drift | n/a | FR-2, FR-3 | typed client | index.ts, ffmpeg-render.ts | Database types | T1 | CI TypeScript |
| Honest failure | Fail | FR-4 | §18 | index.ts | render_error | T5 | render_error text |
| Complete timeline | Render | FR-5 | paging | index.ts | edit_tracks, edit_clips | code review + shared tests | n/a |
| File exists to upload | Done | FR-6, FR-7 | workDir lifecycle | both | R2 | T3, T6 | first owner render |
| Right language | Export All | FR-8 | selectRenderClips | index.ts | edit_clips.language | T2, T6 (es) | owner renders es |
| Plays everywhere | Done | FR-9 | -pix_fmt | ffmpeg-render.ts | MP4 | T4, T6 probe | owner plays file |
| End-to-end | all | FR-11 | §3 | all | all | T6 | first owner render |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Chosen because |
|---|---|---|
| Fix loader to the real schema | Add the worker's columns by migration | The renderer, the editor and the RPCs all use the real columns. A migration would add a second, unused shape |
| Typed client (`createClient<Database>`) | Hand-written row interfaces (today) | The hand-written interfaces are what drifted. The generated types track migrations and CI enforces regeneration |
| Caller-owned per-job `workDir` | Keep `WORK_DIR`, exempt the output from cleanup | The shared dir also races between concurrent jobs in one container. The caller is the only party that knows when the output is no longer needed |
| Drop transitions/keyframes reads (D2) | Fix their columns and keep passing them unused | Unused reads are dead weight and imply a fidelity the render doesn't have. Re-adding is trivial when a renderer consumes them |
| Language rule on `language`, not `is_active` | Keep the current rule | The current rule contradicts the phase-14 design and drops dubs from Export All |
| Local evidence gated (T6) | New CI job with FFmpeg | CI has no FFmpeg or R2 stand-in today. A job is a separate decision (D4) |

## 30. Risk Register

| # | Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | Another defect past the upload that local runs can't see (R2 URL, WebSocket) | Render still fails in prod | First owner render; `render_error` | T6 covers everything up to the upload call | Fix forward; the status is truthful |
| R2 | `ffmpeg-static` unpinned in `sst.config.ts` drifts from 5.3.0 | Filter behaviour differs | Deploy log | Recorded (§31 Q7) | Pin in a follow-up |
| R3 | Typed client surfaces further type errors in the file | More work | Typecheck | Scope limited to this worker | Resolve in-PR |
| R4 | Language rule change renders a clip the user had deliberately deactivated | Unexpected line in output | Owner review | Rule only affects clips with a language (dubs); no-language clips still honour `is_active` | D1 |
| R5 | Large episode exceeds `/tmp` 512 MB | ENOSPC failure | `render_error` | Out of scope | Raise `ephemeralStorage` |
| R6 | Stacked on #309: if #309 changes before merge, conflicts at `index.ts:246-253` | Rebase | git | Small hunk | Rebase on #309 |
| R7 | KB-40 changes `batch_assemble_edit_project` columns | Loader types out of date | Typecheck after rebase | Typed client makes it a compile error | Rebase |

## 31. Open Questions and Assumptions

| # | Question | Why it matters | Current assumption | Decision |
|---|---|---|---|---|
| Q1 | Should a render for L include L's clips even when inactive in the preview? | FR-8 | Yes, per ENGINEERING.md §Per-Language Export | D1 |
| Q2 | Server render ignores transitions, keyframes, title tracks | Output ≠ preview; the dialog's FFmpeg preview shows `xfade` the server doesn't run | Out of scope; follow-up KB (lead assigns) | D2 |
| Q3 | Video gaps: concat ignores `start_ms`; audio uses `adelay` | A/V drift when the video track has gaps | Out of scope; follow-up KB | D2 |
| Q4 | Dialog status is WebSocket-only; reload loses a finished render; `getRenderStatusAction` unused | User can't find a finished render after reload | Out of scope; follow-up KB | D6 |
| Q5 | One `render_url` per project, same R2 key per language; Export All overwrites | Only the last language's URL is kept; CDN staleness | Out of scope | none now |
| Q6 | Compilation edit projects are refused by `verifyEditProjectOwnership` | Compilations can't server-render | Out of scope (render-actions not touched) | none now |
| Q7 | Pin `ffmpeg-static@5.3.0` in `sst.config.ts`? | Verified binary = deployed binary | Not in this PR (shared infra file) | D7 |

## 32. Implementation Plan

1. **Tests first (red).** Write T2–T5 against the current code and watch
   them fail for the stated reasons. Take the DB lock, `db reset`, and run T6
   on the unfixed worker (red: "Edit project not found"). Release.
2. **Renderer** (`ffmpeg-render.ts`): derive types from `Database`, export
   `RENDER_CLIP_COLUMNS`, add `workDir` and remove the global cleanup, export
   `buildFFmpegArgs`, add `-pix_fmt yuv420p`, drop transitions/keyframes from
   `RenderInput`.
3. **Loader** (`index.ts`): `createClient<Database>`, `loadRenderInput` with
   error-checked paged reads, `selectRenderClips`, work-dir lifecycle, stage
   errors and logs. Remove the four markers.
4. **Green.** T2–T5, then `pnpm typecheck` (heavy slot). T1 red check: restore
   `canvas_width` → error → restore.
5. **Evidence.** Take the DB lock, `db reset`, and run T6 green for `en` and
   `es`. Record probe values in a table. Esbuild bundle smoke (§27). Release.
6. **Guards.** `tooling/mutation-guards/kb-32.json`; `run.py --only KB-32…`
   all RED.
7. **Record.** Mark KB-32 **Fixed** with the PR number; add one Fixed-table row.
8. `pnpm lint:fix`, `pnpm format:fix`, commit, push, open the PR stacked on #309.

Rollback at any stage: revert the commit. No data implications.

## 33. Definition of Done

- [ ] No `KB-32` marker under `apps/web/lambda/` (`grep -rn "KB-32" apps/web/lambda` empty)
- [ ] Step-1 query succeeds against a reset local DB (red run recorded first)
- [ ] One export renders end to end from seeded clips (T6). Output duration and resolution checked, plus pix_fmt and codecs
- [ ] ES render includes the inactive ES dub (T6)
- [ ] T2–T5 pass, each mutation guard RED
- [ ] `pnpm typecheck`, relevant unit tests, lint and format pass
- [ ] Esbuild bundle smoke passes. What remains unverified is stated in the PR
- [ ] FILM-CC-04 KB-32 entry marked Fixed; follow-ups requested from the lead (untyped lambda clients, render fidelity, status after reload)

## 34. Final Consistency Pass

**Forward.** A user can't get a server-rendered MP4 (§1). They click Server
Render and expect a file per language (§2–3). The system must read real
columns, keep the file until upload, and pick clips by language
(FR-1, 6, 8). No data changes (§14). The loader and renderer share generated
types (§10, 15). T1–T6 test it (§26), the next deploy ships it (§25), and the
first owner render verifies it (§27).

**Reverse.** The new worker updates `edit_projects` to `rendering`, reads
tracks and clips on real columns, renders into a per-job dir, uploads, writes
the asset and status, then deletes the dir. That produces a `completed` render
with a URL the dialog shows over the WebSocket. It meets §2's Done stage, and
the file contains the chosen language's dialogue (§5 rule). Both directions
converge on the user outcome in §1. The recorded gaps (Q2–Q5) are the places
where the output still differs from the preview, and they're named rather
than hidden.
