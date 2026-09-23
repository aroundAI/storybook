# KB-62 — Engineering Design Document

**Ticket:** KB-62, "Edit Suite auto-save, clip split and project creation appear broken for everyone, and their functions have no access check". Severity High (functional, plus three latent cross-tenant writes). KB-40's reproduction found it on 2026-09-23 (`$SP/kb40/repro.out`, section S2). No FILM-CC-04 entry exists yet: the lead's `kb-reservations.txt` holds the number.
**Branch:** `fix/kb-62-edit-suite-rpc-write-scope`, stacked on `fix/kb-28-project-assets-insert-scope` (#313) @ `27a578e8` (rebased 2026-09-23 after KB-28 was re-timestamped; the reproduction below ran at the old tip `f9943881`, same `can_write_project`), for `public.can_write_project`. It rebases onto `fix/kb-40-edit-project-write-scope` once KB-40 is approved and pushed (agreed with kb-40, §24).
**Size:** M.
- One migration and one schema change.
- Three server actions.
- The provider's save path: rounding, the ids and media fields, and retry.
- A toolbar span.
- A pgTAP file, a Playwright spec and mutation guards.
**Status:** Phase 1 (plan). Nothing is implemented yet.

`$SP` = `/private/tmp/claude-501/-Users-xuryax-Work-code-storybook/04244c24-4477-42c9-9637-11028d9a01d4/scratchpad`.

---

## 0. What the reproduction showed

**Headline: every edit made in the Edit Suite is lost, for every user, including the project owner.** The toolbar shows a small red "✕ Save failed" until the page is reloaded. After the reload it shows a green **"✓ Saved"** over the unedited timeline (screenshot A-3). The retry controls do nothing: after a failure, 💾 Save and Cmd+S send **no request at all**. The page has no warning on leaving. Removing the first failure only exposes the next one. Four stacked failures stand between an edit and the database, and the fourth is silent.

**How it was measured.** All runs used the real UI, as a seeded team **owner** (`project_members.role = owner`, checked). The `next dev` server ran on port 3118, from this worktree at `f9943881` plus the EDD stub. Each run started with a `db reset`, under the DB lock and one heavy slot. Seeding went through the API: a team, a project, and an episode with one completed 4 s shot whose `video_url` is `https://media.kb62.invalid/shot.mp4` (it cannot resolve). Each run clicked **⚡ Auto-Assemble**, split the clip with **S**, and waited for auto-save.
- Specs (throwaway, not committed): `$SP/kb62/kb62-baseline.spec.ts`, `$SP/kb62/kb62-baseline2.spec.ts`.
- Logs: `$SP/kb62/evidence/kb62-baseline.log`, `…/kb62-baseline2.log`.
- Server logs: `$SP/kb62/dev.log`, `$SP/kb62/dev2.log`.
- Screenshots: `$SP/kb62/evidence/*.png`.
- Captured action payloads: `…/kb62-captured-save-payload.json`, `…/kb62-F-payload.json`.
- Any grant a run needed was added by the run and revoked in a `finally`. The revocation is confirmed in each log (`granted=f`).

| # | Setup | What the user did | Where it failed | Evidence |
|---|---|---|---|---|
| A | Today | Frame-stepped the playhead (→ ×30), pressed S | **In the action's zod validation, before any DB call.** The playhead was 1000.0000000000005 ms; `newClips.0.endMs: Expected integer, received float` (×4 fields). HTTP 500. The toolbar showed "✕ Save failed" | `dev.log:355`; screenshot A-2 |
| A′ | Same page | Pressed 💾 Save | Nothing sent. `performSave` returns unless the status is `dirty` (`edit-suite-provider.tsx:218`), and after a failure it is `error` | One `Invalid data` line in `dev.log` for run A |
| A″ | Same page | Reloaded | The split was gone: 2 clip blocks before, 1 after. The DB kept the single 0–4000 clip. **The toolbar read "✓ Saved"** | screenshot A-3 |
| E | Today | Set the playhead with a ruler click (rounded to 1000), pressed S | **At the database:** `42501 permission denied for function batch_save_edit_project` | `dev2.log:357-359` (info "Batch saving edit project", then error with code 42501) |
| E′ | Same page | 💾 Save, then Cmd+S | 0 further requests (1 before, 1 after) | log E |
| F | `grant execute … to authenticated` **only** | Same integer split | **Double encoding:** `22023 cannot extract elements from a scalar` | `dev2.log:874-876` |
| C | Grant, and A's real payload replayed with the strings decoded | — | `22P02 invalid input syntax for type integer: "1000.0000000000005"`, cast inside the RPC. So fixing zod alone is not enough | log C |
| **G** | Grant, and F's real payload replayed as real JSON arrays (the encoding fixed, nothing else) | — | **"Succeeds", and is wrong.** It returned `createdClips 2, deletedClips 1`. The client held ids `55ea7dce`/`2d327b50`; the DB created `b540b5a5`/`10de4ca5`. **`media_url` = NULL** on both halves, because the client never sends it and zod would strip the id if it did | log G |
| **G′** | Then a second save trimming the right half to 3000 ms, by the id the client holds | — | Returned **`updatedClips: 1`**. The DB was **unchanged** (still 1000–4000). After a reload the half is 3.0 s long again | log G; screenshot G |

**What a bare grant would open** (run D: all three granted, then called by a signed-in **stranger** whose `can_write_project` on the owner's project is `false`, with only the anon key and their own JWT):

| Call by the stranger | Result |
|---|---|
| `batch_save_edit_project` renaming the owner's track | 200, `updatedTracks: 1`. Track now "STRANGER WAS HERE" |
| `split_edit_clip` on the owner's clip | 200. The clip is split in two in the DB |
| `create_edit_project_with_tracks` on the owner's episode 3 | 200. An edit project with 5 tracks now exists on the owner's episode |
| `batch_save_edit_project` deleting every clip | 200, `deletedClips: 2`. The owner's timeline is empty |

**The ticket's framing, corrected.**
- Auto-save is broken, confirmed, and worse than reported: the 42501 is the second of four failures.
- **Clip split** in the UI is not a call to `split_edit_clip`. It is a client-side command that auto-save persists, so it fails *because* auto-save fails.
- **Project creation** in the UI goes through Auto-Assemble (`batch_assemble_edit_project`, KB-40), and it works: the baseline assembled a timeline every time.
- `split_edit_clip` and `create_edit_project_with_tracks` have **no caller** in the app (§8.2). They are dead doors that are closed today.

**Severity.** Every Edit Suite user loses every edit, and after a reload the page tells them it saved.
- In any database built from these migrations, no hand edit has ever been stored: the function has never been executable by `authenticated`.
- Only the owner can check whether production differs, for example through a grant added by hand. That check is Decision 6.

---

## 1. Start With the User

**Who.** A creator cutting an episode in the Edit Suite: the project's owner, an admin or a member. Secondarily, every other creator, whose timelines must stay theirs once saving is switched on.

**Problem today (measured, §0).** The editor lets you split, trim, move, fade and delete clips, and says it auto-saves. Nothing an editor does after Auto-Assemble is ever saved. Two seconds after each edit the toolbar changes from "● Unsaved" to a small red "✕ Save failed". Pressing 💾 Save does nothing: no request is sent. Reload, or come back tomorrow, and the timeline is exactly as Auto-Assemble left it, under a green "✓ Saved". Nothing explains why, nothing blocks leaving the page, and the only trace is a `console.error` and a server log line.

**What must not happen when this is fixed.** Switching the save on by granting the functions would let any signed-in user rename, trim, split or delete clips on any project's timeline whose ids they learn (§0 D). Fixing only the grant and the encoding would move the failure from loud to silent. A split would save both halves without their video and under different ids. Every later edit to them would then report "✓ Saved" and be thrown away (§0 G, G′).

**After the fix:**
- An owner, admin or member edits the timeline, sees "● Unsaved", then "⟳ Saving…", then "✓ Saved", and after a reload sees exactly what they saw before it: the split halves, with their media, at the positions they left them. A second edit after the first save is saved too.
- A project viewer, or a team member with no role on the project, can still open and scrub the timeline. If they edit it, the save is refused and the toolbar says in words that only the project's owner, admins and members can save its timeline. Nothing is written.
- A signed-in stranger who calls the database functions directly is refused, and nothing changes.

**Persists:** clip edits (position, trim, fades, volume, speed, active flag, order), clip deletions, new clips including split halves (with their media), keyframe edits, additions and deletions, and track property edits (name, order, volume, mute, solo, lock, height).
**Does not persist, before or after this fix:** adding or removing a track, transitions, the active-language switch, and moving a clip to another track. §8.4 lists each with its cause. Decision 2 asks whether they are in this ticket.

## 2. Define the Complete User Journey

| Stage | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| Entry | Opens the episode's Edit Suite with an existing timeline | Provider loads the edit project | Timeline, "✓ Saved" | Edit |
| Edit | Splits (S), trims, moves, fades, deletes | Reducer marks the change dirty | "● Unsaved" (amber) | Wait 2 s, or Cmd+S / 💾 Save |
| Save (writer) | — (auto-save after 2 s) | `batchSaveAction` → `batch_save_edit_project` checks `can_write_project(auth.uid())`, applies the changes inside one transaction, scoped to this edit project | "⟳ Saving…" then "✓ Saved" (green) | Keep editing |
| Second edit | Edits a clip created by the first save (a split half) | Same path; the ids the client holds are the ids in the database | "✓ Saved", and the edit is in the database | — |
| Save (viewer / no project role) | Edits, waits | RPC raises `42501`; the action returns a refusal value | Red: "Only the project's owner, admins and members can save its timeline." and 💾 Save stays | Ask for a role; the edits remain only in this tab |
| Save fails for another reason | — | Error thrown and logged | "✕ Save failed" and 💾 Save (unchanged) | Retry |
| Retry after a failure | Presses 💾 Save or Cmd+S | `performSave` runs from the `error` state too (today it returns early and sends nothing, §0 A′/E′) | "⟳ Saving…" then the outcome | — |
| Reload | Reloads | Reads the edit project | The last saved timeline | — |
| Stranger via API | `POST /rest/v1/rpc/batch_save_edit_project` (or split/create) | `42501` | HTTP 403; nothing changes | — |

## 3. Explicitly Define the Happy Path

A project **member** M opens an assembled episode with one 4 s video clip C (with its default volume keyframe).
1. M frame-steps the playhead to about 1 s (→ ×30, which leaves it at 1000.0000000000005 ms) and presses **S**. `SplitClipCommand` removes C and adds a left half (C's id, 0–1 s) and a right half (new client UUID R, 1–4 s). The toolbar shows "● Unsaved".
2. After 2 s `performSave` sends `{deletedClipIds:[C], newClips:[{id:C, trackId, mediaUrl, thumbnailUrl, syncGroupId, language, 0–1000 ms …}, {id:R, … 1000–4000 ms}]}`. Every millisecond field is rounded to a whole number at this edge, and both halves round the same shared edge to the same 1000. The arrays are sent as arrays, not strings.
3. `batch_save_edit_project` takes `auth.uid()`, resolves edit project → episode (not deleted) → project, and `can_write_project` is true for a member. It deletes C (scoped to this edit project), inserts both halves **with the ids the client sent** after checking that their track belongs to this edit project, bumps `version`, and returns the counts of rows actually changed.
4. The action returns `{ok:true}`; the provider dispatches `MARK_SAVED`; the toolbar shows "✓ Saved".
5. M trims R's end to 3 s. The next save updates row R, which exists. "✓ Saved".
6. M reloads: two clips, 0–1 s and 1–3 s, both with C's media URL.

**Success:** after the reload the database and the screen agree: two clips, the ids the client held, `media_url` set, R ending at 3000 ms.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| Caller not owner/admin/member (viewer, account-only member, stranger) | `42501` before any write | UI: the refusal sentence. API: 403 | Get a project role | Unchanged |
| Edit project missing, or its episode soft-deleted | Same `42501`, same message | Same sentence | — | Unchanged |
| A dirty or deleted id that is not in this edit project (stale, or someone else's) | Update/delete is scoped to this edit project, so it matches nothing; the real count is returned; the action logs `warn` when counts fall short | "✓ Saved" (the rest saved) | — | Other projects untouched |
| A new clip whose track, or a new keyframe whose clip, is not in this edit project | `42501`; the whole save rolls back | Refusal sentence | Reload | Unchanged |
| A new clip id that already exists (collision or replay) | `23505`, rollback | "✕ Save failed" | Reload | Unchanged |
| Two tabs save at once | Two transactions; last writer wins per row (unchanged) | Both "✓ Saved" | — | — |
| Save fails and the user leaves | Unchanged: no unload guard (Decision 4) | — | — | Edits since the last save lost |
| Old client during deploy (sends strings) | `22023 cannot … scalar`, thrown | "✕ Save failed" (as today) | App deploy | Unchanged |
| No session | `enhanceAction` redirects to sign-in | Sign-in | Sign in | Unchanged |

## 5. Establish the User-Facing Contract

- **Who may save, split, create:** exactly those for whom `can_write_project(<the edit project's or episode's project>)` is true: `project_members.role in (owner, admin, member)` for the session user.
- **Refusal text** (a value, so it survives a production build): "Only the project's owner, admins and members can save its timeline." It takes the place of "✕ Save failed" in the save-status span (`toolbar.tsx:228-241`), which gets `data-test="edit-suite-save-status"`. Other failures keep "✕ Save failed".
- **"✓ Saved" means saved.** For every change the Persists list names, a reload shows it. The four gaps in §8.4 are the exception, and are named rather than hidden (Decision 2).
- **RPC contracts** (identity from the JWT, never a parameter):
  - `batch_save_edit_project(p_edit_project_id uuid, p_dirty_tracks jsonb, p_dirty_clips jsonb, p_dirty_keyframes jsonb, p_deleted_clip_ids jsonb, p_deleted_keyframe_ids jsonb, p_new_clips jsonb, p_new_keyframes jsonb) → jsonb`. Same signature; new clips and keyframes now carry `id`.
  - `split_edit_clip(p_clip_id uuid, p_split_at_ms integer) → jsonb`. Unchanged signature.
  - `create_edit_project_with_tracks(p_episode_id uuid, …) → jsonb`. Unchanged signature.
  - All three: refusal is SQLSTATE `42501`, message `No write access to this timeline`.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Verification |
|---|---|---|
| FR-1 | All three RPCs authorise on `auth.uid()` via `public.can_write_project`, resolved from their own argument (edit project / clip / episode), before any write | pgTAP T1–T9 |
| FR-2 | `batch_save` touches only rows of `p_edit_project_id`: updates and deletes are scoped; inserts whose track/clip is outside it raise `42501` | pgTAP T10–T12 (writer on A aiming at B) |
| FR-3 | Missing, soft-deleted, unauthenticated and not-a-writer are one `42501`, one message | pgTAP T13 |
| FR-4 | `search_path = ''`; EXECUTE revoked from public/anon, granted to authenticated and service_role | pgTAP T14–T15; KB-27 inventory I1/I2 |
| FR-5 | The action sends JSON arrays, not strings (no double encoding) | Playwright P1; pgTAP T4 calls with real arrays |
| FR-6 | New clips and keyframes are inserted with the client's id, and new clips keep `media_url`, `thumbnail_url`, `sync_group_id`, `language` | pgTAP T5; Playwright P1–P2 (reload after split, then second edit) |
| FR-7 | Returned counts are rows actually changed | pgTAP T6 |
| FR-8 | A refusal reaches the page as written on a production build | Playwright P3 on `next build && next start` (§27) |
| FR-9 | Every millisecond field is rounded to a whole number at the save edge, so a frame-stepped, played-back or dragged position saves | Playwright P1 (split after frame-stepping, the §0 A path) |
| FR-10 | 💾 Save and Cmd+S retry from the `error` state | Playwright P3 counts a second request after pressing 💾 Save |

## 7. Define Non-Functional Requirements

- **Security:** tenant isolation, and isolation *between a writer's own projects* (FR-2). No existence oracle (FR-3).
- **Performance:** the check adds two indexed lookups per save. Scoping adds a join to `edit_tracks` (indexed on `edit_project_id`) per statement. A save is at most 500 dirty clips (schema cap), fired at most every 2 s.
- **Reliability:** one transaction per save, as today.
- **Observability:** refusals `warn`, count shortfalls `warn`, other errors `error`.
- **Accessibility:** the refusal is visible text in the existing status span, with `role="status"` (§21).

## 8. Analyze the Existing System

**8.1 Functions** (`apps/web/supabase/migrations/20260219100138_edit-suite-v2-rpc-functions.sql`):
- `batch_save_edit_project` `:203-376`: `security definer`, `search_path = public`, **no access check**, **no scoping**. Every `update … where id = X` and `delete … where id = any(…)` reaches any row in the database. It inserts new clips and keyframes without their `id`, so the database generates new ones (`:311-365`). The counters count loop iterations, not rows (`:246`, `:292`, `:306`). Parameters are `jsonb`.
- `split_edit_clip` `:386-472`: same header, no check. Called with any clip id, it rewrites that clip and inserts a second one.
- `create_edit_project_with_tracks` `:479-546`: same header, no check. Inserts an edit project for any episode that has none (`unique(episode_id)`, `20260219083555_edit-suite-v2.sql:44`).
- None is granted to `authenticated`: `20221215192558_schema.sql:21-69` revokes default function privileges in `public`, and no later migration grants these three (`git grep -n -i grant -- apps/web/supabase/migrations | grep -e edit_project -e edit_clip` finds only `batch_assemble_edit_project`, the positive control).
- Nothing redefines them later: the only other edit-suite migration is `20260226170054_fix-batch-assemble-replace-existing.sql`, which fixed the same three defects for assemble (unique violation, missing grant, double encoding with `text` params) and nothing else.

**8.2 Callers** (`git grep -n -e batch_save_edit_project -e create_edit_project_with_tracks -e split_edit_clip -- apps packages`, generated types excluded):
- `batch_save_edit_project` ← `batchSaveAction` (`packages/features/edit-suite/src/server/batch-actions.ts:147-199`) ← `performSave` (`components/edit-suite-provider.tsx:217-337`), fired by the 2 s debounce (`:340-352`), Cmd+S (`:377-381`) and 💾 Save (`toolbar.tsx:243-250`). **The one live path.**
- `split_edit_clip` ← `splitClipAction` (`server/clip-actions.ts:192-260`) ← **nothing.** `git grep -n splitClipAction` finds only its definition and the re-export in `server/actions.ts:23`. The UI's split is `SplitClipCommand` (`state/edit-commands.ts:247-290`), a client-side REMOVE + ADD + ADD that auto-save persists.
- `create_edit_project_with_tracks` ← `createEditProjectAction` (`server/edit-project-actions.ts:31-83`) ← **nothing** (definition and `server/actions.ts:5` only). The UI creates an edit project only through Auto-Assemble (`batch_assemble_edit_project`, KB-40).
- So the ticket's "clip split and project creation appear broken" is true at the RPC and false in the UI: split fails *because auto-save fails*, and creation works through assemble. No Lambda, worker or service-role caller exists for any of the three.

**8.3 The action and the client.**
- `batchSaveAction` passes `JSON.stringify(array)` for every `jsonb` parameter (`batch-actions.ts:167-174`). supabase-js sends that as a JSON *string*, which PostgREST binds to `jsonb` as a string scalar. The assemble function hit the same thing and was moved to `text` parameters (`20260226170054…sql:3-9`).
- It throws plain `Error`s, which a production build replaces with a generic sentence (KB-6). The provider only shows "✕ Save failed" anyway (`edit-suite-provider.tsx:320-323`, `toolbar.tsx:240`).
- `BatchSaveSchema` (`lib/schemas/index.ts:385-394`) validates `newClips` with `CreateClipSchema` (`:121-142`) and `newKeyframes` with `CreateKeyframeSchema` (`:253-263`). Neither has `id`, so zod strips the client's id before the action sees it. `DirtyClipSchema` (`:350-362`) has no `trackId`, so it is stripped as well.
- `performSave`'s `newClips` mapping (`edit-suite-provider.tsx:273-296`) omits `mediaUrl`, `thumbnailUrl`, `syncGroupId` and `language`, although the client clip has them.
- Split: `REMOVE_CLIP(C)` puts C in `deletedClipIds` (`state/edit-reducer.ts:116-156`); `ADD_CLIP(left)` reuses C's id and puts it in `newClipIds`; the right half gets `crypto.randomUUID()`. So a split saves as "delete C, insert two clips".
- `MARK_SAVED` clears the dirty sets and keeps the client's ids (`edit-reducer.ts:336-348`). Nothing reloads.
- **Fractional milliseconds.** Every `*Ms` field in the save schemas is `z.number().int()`, but most ways of positioning produce fractions:
  - frame step: `stepForward` adds `1000 / fps`, so 33.333… ms (`lib/playback-engine.ts:197-207`);
  - playback: time ticks from `requestAnimationFrame`;
  - clip drag and trim: `(deltaX / zoom) * 1000`, unrounded unless snapped (`components/timeline/clip-block.tsx:244-316`). At the default 50 px/s this happens to be whole; at other zooms it is not.
  - Only a ruler click and a playhead drag round (`timeline-ruler.tsx:59`, `playhead.tsx:52`).
  - So the ordinary split, "play, pause, S", fails validation before reaching the database (§0 A). The columns are `integer`, so the RPC's `::integer` casts would reject the same value (§0 C).
- **Retry is dead.** `performSave` begins `if (state.saveStatus !== 'dirty' || !state.project) return;` (`edit-suite-provider.tsx:218`). After `MARK_SAVE_ERROR` the status is `error`, so 💾 Save (shown exactly then, `toolbar.tsx:243`) and Cmd+S do nothing (§0 A′, E′). Only a further edit re-arms the save.
- **No unload guard.** There is no `beforeunload` anywhere in the package (`git grep beforeunload`), so leaving with unsaved or failed edits gives no warning.
- **After a reload the status reads "✓ Saved"**, because `LOAD_PROJECT` resets it (`edit-reducer.ts:28`). A user who reloads sees their edits gone under a green tick (§0 A″).

**8.4 Changes the editor makes that `batch_save` has no field for** (by reading; §0 C measures the split case):

| Edit | Reducer | Sent as | What the RPC does with it |
|---|---|---|---|
| Add track (`toolbar.tsx:69`) | `ADD_TRACK` → `dirtyTrackIds` | a *dirty* track | `update … where id = <new id>` matches nothing |
| Remove track | `REMOVE_TRACK` → `deletedTrackIds` | **not sent** (`performSave` never reads `deletedTrackIds`) | — |
| Add/edit/remove transition | `ADD/UPDATE/REMOVE_TRANSITION` set `saveStatus` only | **not sent** | — |
| Switch language | `SET_LANGUAGE` changes `isActive` without marking clips dirty | **not sent** | — |
| Move clip to another track | `MOVE_CLIP` with `trackId` | `trackId` stripped by `DirtyClipSchema` | `track_id` never updated |

**8.5 Table RLS** (`20260219083555_edit-suite-v2.sql:305-520`): insert/update on edit tables allow `project_members` owner/admin/member; **delete** on `edit_projects`, `edit_tracks`, `edit_clips` and `dialogue_sync_groups` allows **owner/admin only**. The definer functions bypass all of it. `get_project_id_for_edit_project` (`:288-302`) claims to be "used by all RLS policies" but no policy calls it (grep); it is ungranted and out of scope.

**8.6 Rule function:** `public.can_write_project(uuid)` (KB-28, `20260923042517_kb28-project-write-scope.sql:23-39`), `security definer`, `search_path = ''`, `auth.uid()`.

**8.7 Schema file:** `apps/web/supabase/schemas/36-edit-suite.sql` holds the tables and `get_project_id_for_edit_project`, not these RPCs. Nothing to mirror.

**8.8 Generated types:** the signatures do not change, so typegen should produce no diff for these three; it is run anyway. The edit-suite client is `any` (`server/db-client.ts`).

## 9. Define the Desired System Behavior

Auto-save → `batchSaveAction` (auth + schema; arrays with ids) → `rpc('batch_save_edit_project', {…arrays})` → function: `v_uid := auth.uid()`; `v_project` from `edit_projects → episodes (deleted_at is null)`; if `v_uid` null, `v_project` null or `not can_write_project(v_project)` → `42501`. Otherwise, in order: update dirty tracks of this edit project; delete keyframes and clips of this edit project; update dirty clips and keyframes of this edit project; verify every new clip's `trackId` and every new keyframe's `clipId` is in this edit project (else `42501`); insert with the given ids; bump version; return real counts.
- Refusal → `throwIfWriteRefused(rpcError, 'save its timeline')` (KB-40's helper) → `ActionRefusal` → `returnRefusals` → `{ok:false, error}` → provider `unwrap` throws → `refusalMessage(error, 'Save failed')` → save state `{status:'error', message}` → toolbar.
- `split_edit_clip` and `create_edit_project_with_tracks`: same header and check (clip → track → edit project → episode → project; episode → project), bodies unchanged. Their actions get the same refusal mapping and `returnRefusals`.

## 10. High-Level Architecture

No new components. The trust boundary moves into the database: each definer function derives the caller from the JWT and applies the one project-write rule to the rows it touches. The action becomes a thin caller that sends real JSON and translates a refusal. The client stops dropping fields on the way to the save. The reason the check lives in the function: once granted, it is reachable directly over PostgREST with any user's JWT, exactly as KB-40 and KB-27 concluded for their functions.

## 11. Architecture and Flow Diagrams

```
Browser (Edit Suite)                          Next server action                 Postgres (role authenticated, JWT sub = U)
 edit → reducer (dirty/new/deleted sets)
 2 s ─► performSave ── {ids, arrays} ──────► batchSaveAction ──rpc──► batch_save_edit_project(p_edit_project_id, jsonb…)
                                                (zod keeps id,                v_project := episode(ep).project, not deleted
                                                 no JSON.stringify)           if not can_write_project(v_project) → 42501 ─┐
                                                                              scoped update/delete (… and in this ep)       │
                                                                              new rows: track/clip in this ep? else 42501 ─┤
                                                                              insert with client ids; version+1             │
                         ◄── {ok:true} ◄─────────────────────────────────────  real counts                                  │
 MARK_SAVED "✓ Saved"                                                                                                       │
                         ◄── {ok:false, error:<sentence>} ◄── throwIfWriteRefused(42501) → ActionRefusal ◄─────────────────┘
 save state {error, message} → toolbar span

Stranger (PostgREST, own JWT) ─rpc─► any of the three → 42501 (403)
```

## 12. End-to-End Data Flow

- **Source:** the reducer's state and dirty sets (client memory only until saved).
- **Transform:** `performSave` maps them to the save payload, now including ids and media fields; zod validates (schemas extended with `id`, and `trackId` on dirty clips only if Decision 2 takes it in).
- **Persist:** `edit_tracks` (update), `edit_keyframes` / `edit_clips` (delete, update, insert), `edit_projects.version`, in one transaction.
- **Loss points today, in the order a save meets them (§0):**
  1. Fractional ms rejected by zod (A).
  2. `42501`, not granted (E).
  3. The string scalar (F).
  4. The fractional ms rejected again by the RPC's casts (C).
  5. Ids and media dropped, so later edits silently miss (G, G′).
  6. The retry sends nothing (A′, E′).
- After the fix, none of these remain. The §8.4 gaps stay, and are named.
- **Nothing is cached.** Retention and deletion unchanged.

## 13. Data Model

No new tables or columns. `edit_clips.id` and `edit_keyframes.id` become client-supplied on insert through this function (UUID v4 from `crypto.randomUUID()`), which the RLS-guarded direct inserts already allowed. Ownership chain: `edit_keyframes.clip_id → edit_clips.track_id → edit_tracks.edit_project_id → edit_projects.episode_id → episodes.project_id → project_members`.

## 14. Database Design and Changes

One hand-written migration, `apps/web/supabase/migrations/<UTC ts>_kb62-edit-suite-rpc-write-scope.sql`, whose timestamp must sort after KB-28's `20260923042517` (and after KB-40's). `create or replace` with the **same signatures** for all three. Each gets `set search_path = ''`, and all relation names are already `public.`-qualified.

1. **`batch_save_edit_project`:**
   - Header check (§9), raising `No write access to this timeline` with `errcode = '42501'`.
   - Scoping. Tracks: `… where id = X and edit_project_id = p_edit_project_id`. Clips: `… and track_id in (select id from public.edit_tracks where edit_project_id = p_edit_project_id)`. Keyframes: `… and clip_id in (select c.id from public.edit_clips c join public.edit_tracks t on t.id = c.track_id where t.edit_project_id = p_edit_project_id)`.
   - Insert guard: before any insert, `if exists (new clip whose trackId is not a track of this edit project) or exists (new keyframe whose clipId is neither an existing clip of this edit project nor one of the new clips) then raise … 42501`.
   - Insert `id` from `(value->>'id')::uuid`, falling back to `gen_random_uuid()` when absent.
   - `get diagnostics … row_count` for every counter.
2. **`split_edit_clip`:** resolve `edit_clips → edit_tracks → edit_projects → episodes (deleted_at is null) → project_id`; the same check; then the body verbatim. A missing clip now gives `42501`, where today it raises `Clip not found` (no oracle).
3. **`create_edit_project_with_tracks`:** resolve `episodes (deleted_at is null) → project_id`; the same check; then the body verbatim.
4. For each: `revoke all on function … from public, anon; grant execute on function … to authenticated, service_role;` and a `comment on function` stating the rule.

**Mirror:** none (§8.7). **Types:** `pnpm supabase:web:typegen`, generated. **Production:** no data change, no lock, milliseconds. **Rollback:** a forward migration revoking the three grants returns to today's "broken but closed" state without reopening anything.

## 15. Low-Level Design

**`lib/schemas/index.ts`:**
- `BatchSaveSchema.newClips: z.array(CreateClipSchema.extend({ id: z.string().uuid() }))`.
- `BatchSaveSchema.newKeyframes: z.array(CreateKeyframeSchema.extend({ id: z.string().uuid() }))`.
- `CreateClipSchema` itself stays as is, since other actions use it.

**`server/batch-actions.ts` (`batchSaveAction` only; KB-40 owns `batchAssembleAction`):**
- Pass the arrays directly, with no `JSON.stringify`.
- `throwIfWriteRefused(rpcError, 'save its timeline')` from KB-40's `server/write-refusal.ts`, then the existing throw.
- Compare the returned counts with the sent lengths and `logger.warn` any shortfall.
- `export const batchSaveAction = returnRefusals(enhanceAction(…))`.

**`server/clip-actions.ts` / `server/edit-project-actions.ts`:** `splitClipAction` and `createEditProjectAction` get the same mapping (`'split its clips'`, `'create its timeline'`) and `returnRefusals`. There are no callers to update (§8.2).

**`components/edit-suite-provider.tsx` (`performSave` and save state only):**
- The `newClips` map adds `mediaUrl`, `thumbnailUrl`, `syncGroupId`, `language` (the `id` is already sent).
- Every `*Ms` field in all five arrays goes through one local `wholeMs = Math.round`, and nowhere else.
  - Rounding is monotonic, so two edges that were equal stay equal: a split's shared edge becomes the same integer on both halves.
  - The client keeps its fractional value until the next load; the difference is under 1 ms.
  - The schemas stay `.int()`, because the columns are `integer`.
- The early return becomes `if ((state.saveStatus !== 'dirty' && state.saveStatus !== 'error') || !state.project) return;`, so 💾 Save and Cmd+S retry after a failure.
- `await unwrap(batchSaveAction(…))`.
- The catch dispatches `MARK_SAVE_ERROR` with `payload: { message: refusalMessage(error, 'Save failed') }`.

**`state/types.ts` / `state/edit-reducer.ts`:**
- `saveError: string | null` next to `saveStatus`. It is set by `MARK_SAVE_ERROR` and cleared by `MARK_SAVING` and `MARK_SAVED`.
- One field on the existing state object, not a new `useState`.

**`components/toolbar.tsx` (save-status span only; KB-40 owns the assembly span and `ToolbarButton`'s `data-test` prop):**
- Show `✕ ${data.saveError}` when set, in place of the fixed "✕ Save failed".
- `data-test="edit-suite-save-status"`, plus `data-test="edit-suite-save"` on 💾 Save.

There are no retries beyond the existing debounce and the manual Save.

## 16. API and Event Design

- **RPCs:** as §5. Errors: `42501` (refused, not found, deleted, foreign row on insert), `23505` (id collision), cast and check errors as today.
- **`batchSaveAction`:** input gains `id` on `newClips[]` and `newKeyframes[]`. Output becomes `ActionResult<{success, result}>`. Its one caller is updated in the same PR.
- **`splitClipAction` / `createEditProjectAction`:** output becomes `ActionResult<…>`. They have no callers.
- No events or queues.

## 17. State and Lifecycle Design

The save status machine is unchanged, `saved → dirty → saving → saved | error`, and `error` now carries `saveError`. `edit_projects.version` still increments once per successful save. Refused saves leave the client in `error` with its dirty sets intact, so a later Save, for example after a role is granted, sends everything.

## 18. Failure and Error Handling

| Failure | Behaviour | User sees | Recovery |
|---|---|---|---|
| Not a writer / not found / deleted / no uid | `42501` → `ActionRefusal` → value | Refusal sentence | Get a role |
| Foreign track/clip in a new row | `42501`, rollback | Refusal sentence (misleading for a genuine client bug; the log carries the detail) | Reload |
| Stale dirty/deleted id | Scoped no-op; `warn` on shortfall | "✓ Saved" | — |
| id collision | `23505`, thrown, logged | "✕ Save failed" | Reload |
| `can_write_project` missing | `42883` at run time | "✕ Save failed" | Deploy KB-28 first (stack enforces it) |
| KB-40 helper missing | Build error, so this branch cannot merge before KB-40 | — | Merge order (§25) |

## 19. Security

- **Authentication:** Supabase JWT via `auth.uid()`.
- **Authorisation:** `can_write_project` of the project that owns the rows. Visibility never grants a write.
- **What the fix allows that it did not before.** Owners, admins and members can save, which is the intent. Members can also *delete* clips and keyframes through the save, where table RLS lets only owner/admin delete (§8.5). Today members can already delete a whole timeline through assemble (KB-40 Decision 2), and the editor's own delete key relies on this path. See Decision 3.
- **What it prevents** that a bare grant would have allowed (§0 D): cross-tenant rename, split, create and delete. It also prevents writes between two projects of the same writer (FR-2), which no project-level check alone would catch.
- **Client-chosen ids:** an insert cannot overwrite (a PK collision is `23505`) and cannot land outside the edit project (insert guard).
- **No oracle:** one error for every refusal, including `split_edit_clip`'s old "Clip not found: <id>".
- **`search_path = ''`** on all three; **least privilege:** revoke public/anon.
- **service_role:** keeps EXECUTE; `auth.uid()` is null there, so it is refused. No service-role callers exist.

## 20. Performance and Scale

Two indexed lookups for the check, plus one indexed sub-select per scoped statement. At the schema caps (500 dirty clips, 2000 dirty keyframes) that is the same number of statements as today, and each gains a join against a handful of tracks. No concern at one save per 2 s per editor.

## 21. Accessibility and Client Behavior

- The refusal replaces "✕ Save failed" in the same span, red, and stays until the next save.
- The span gains `role="status"` so screen readers announce save state changes. That is one attribute on an existing element.
- 💾 Save stays focusable.
- No i18n exists in this toolbar (English literals), and that is unchanged.

## 22. Observability and Operations

- `editSuite.batchSave`: `info` on success with real counts; `warn` "Batch save refused" with `{projectId, code}`; `warn` "Batch save matched fewer rows than sent" with sent/actual counts; `error` otherwise (existing).
- **An operator knows it works** when "Batch save complete (atomic)" appears where it has never appeared before. Locally it has appeared zero times, because the function was never callable (§0).

## 23. Configuration and Feature Flags

None. The change is a narrowing plus a repair, with nothing to tune. A flag would either leave saving broken or open it unchecked.

## 24. Compatibility

- **Signatures unchanged**, so there is no `PGRST202` window.
  - An old app with the new DB still sends strings and still fails, as today.
  - A new app with the old DB fails on the grant, as today.
  - Neither order is worse than now; ship together.
- **KB-40 stacking:** agreed file split. KB-40 owns `batchAssembleAction`, `runAutoAssembly` and the assembly state, the assembly span and `ToolbarButton`'s `data-test`. KB-62 owns `batchSaveAction`, `performSave` and the save state, and the save span. This branch rebases onto KB-40's once it is pushed, and reuses `throwIfWriteRefused`.
- **KB-27 inventory** (`definer-functions-inventory.test.sql`, on #316) pins names. This PR adds three rows with their checks. If KB-27 merges first, this branch merges `main` and adds the rows. If this merges first, KB-27's list gains them on its rebase. Decision 1.
- **Existing data:** unaffected. No client relied on DB-generated ids for new clips, because no save has ever succeeded (§0).

## 25. Migration and Rollout Strategy

**Order:** #313 (KB-28) → KB-40 → KB-62, each retargeted to `main` after its parent merges. KB-27 (#316) can go in either order (Decision 1).

**Validation gates:** pgTAP (Supabase DB job), the Playwright spec, and the §0 D attack re-run against the fixed DB.

**After deploy:** the owner splits a clip on a real episode, waits for "✓ Saved", reloads and sees both halves. A direct `rpc` as a second account returns 403.

**Rollback trigger:** writers refused, or save errors in the logs. **Rollback:** a forward migration revoking the three grants, which restores today's closed-but-broken state.

## 26. Testing Strategy

**1. pgTAP** `apps/web/supabase/tests/database/edit-suite-save-access.test.sql`, red first against today's functions with a temporary in-test grant, so the red shows the missing check and not the missing grant.
- **Fixture:**
  - team T with project A (episode, edit project, two tracks, clip C with a keyframe) and project B (edit project, clip D);
  - owner O, member M, viewer V, account-only member AO;
  - stranger S with a personal project;
  - a soft-deleted episode with an edit project.
- **Cases:**
  - T1–T3: S, V and AO each call `batch_save` on A (rename a track, delete C). Each gets `42501`, and A is unchanged.
  - T4: M calls `batch_save` on A with real arrays: a split of C (delete C, insert two clips with ids). It returns, and the rows exist with those ids.
  - T5: the new rows keep `media_url` and `thumbnail_url`.
  - T6: the counts equal the rows changed, and a stale id counts 0.
  - T7: O calls `split_edit_clip` on C and it returns; S gets `42501`.
  - T8: O calls `create_edit_project_with_tracks` on an episode without an edit project and it returns; V gets `42501`.
  - T9: a personal-account owner calls `create_edit_project_with_tracks` on their own episode and it returns.
  - **T10**: O (a writer on A **and** B) calls `batch_save(A)` with B's clip D in `deletedClipIds`. D survives.
  - **T11**: the same with D in `dirtyClips`. D is unchanged.
  - **T12**: the same with a new clip on B's track. `42501`, and nothing is inserted.
  - T13: the nonexistent edit project, the soft-deleted episode and a nonexistent clip all give the same `42501` and message.
  - T14: `has_function_privilege`: anon false, authenticated true, service_role true, for all three.
  - T15: `proconfig` is `search_path=""` for all three.
- Plus three rows in KB-27's inventory I1 (Decision 1).

**2. Mutation guards** `tooling/mutation-guards/kb-62.json`, each seen `RED`:
- (a) the check removed from `batch_save`;
- (b) the scoping removed from the delete (caught by T10);
- (c) the insert guard removed (T12);
- (d) the insert id reverted to generated (T4);
- (e) `split_edit_clip`'s check removed (T7);
- (f) `search_path` reset (T15).

**3. Playwright** `apps/e2e/tests/edit-suite/auto-save.spec.ts`. It seeds through the API: team, project, an episode with a completed shot, and roles.
- **P1 (owner):** assemble, **frame-step** the playhead (→ ×30, the fractional path from §0 A), split with **S**, wait for "✓ Saved", reload. Two clips, and the DB rows carry the client's ids and `media_url`, with integer edges of 1000.
- **P2 (member, second submission):** after P1's save, trim the right half, wait for "✓ Saved", reload. The trim is there. This is the case that fails silently with a grant-only fix.
- **P3 (viewer):** edit, wait. The save-status span shows the refusal sentence and the DB is unchanged. Pressing 💾 Save **sends a second request** (counted, FR-10) and shows the sentence again.
- **P4 (account-only member):** the same as P3.
- Evidence screenshots after each action, behind `CAPTURE_EVIDENCE=1`.
- Red first: before the fix, P1 shows "✕ Save failed" (measured, §0 A), and P3's request count stays at 1 (§0 E′).
- Two more `e2e` mutation guards: the `wholeMs` rounding removed (P1 red), and the `error`-state retry reverted (P3 red).
- One `e2e` mutation guard: the `mediaUrl` mapping removed, caught by P1's `media_url` assertion.

**4. Attack re-run:** `$SP/kb62/kb62-baseline.spec.ts` phase D against the fixed DB (without the ad-hoc grants, which now exist for real). Before/after table in the PR.

**5. Unit:** none. The edit-suite package has no Vitest suite, and the logic under test lives in SQL (pgTAP) and in the DOM-to-save path (Playwright). The KB-6 guard `packages/next/__tests__/kb6-caught-action-message.test.ts` must stay green.

## 27. Production-Build Verification

**Applies:** the refusal must survive a production build (KB-6), and the save path is client code whose bundling matters.
- Run P1 and P3 against `next build && next start -p 3118`.
- Sandbox per the wave-1 rule: `NODE_ENV=test`, `VENDOR_SANDBOX=1`, the `VENDOR_URL_*` overrides, and a pre-flight that aborts if any override is ignored. The save path reaches no vendor; the seeded shot URL is `https://media.kb62.invalid/…`, which cannot resolve.
- Assert the exact sentence, and that it is not `PRODUCTION_SENTENCE` (`tests/refusals/refusals.po.ts`).
- Red check: with the mapping removed, the span shows "✕ Save failed".

## 28. Requirement Traceability

| User Outcome | User Flow | Requirement | Design | Component | Data/API | Test | Production Verification |
|---|---|---|---|---|---|---|---|
| Writers' edits survive a reload | Save (writer) | FR-5, FR-6, FR-7, FR-9 | §14.1, §15 | migration, schema, provider | RPC | T4–T6, P1 | P1 on prod build; owner post-deploy |
| Retry actually retries | Retry after a failure | FR-10 | §15 guard | provider | — | P3 request count | P3 on prod build |
| Second edit also saves | Second edit | FR-6 | client ids kept | schema, RPC | RPC | T4, P2 | — |
| Non-writers told, nothing written | Save (viewer) | FR-1, FR-8 | §9 | migration, action, toolbar | 42501 → value | T1–T3, P3, P4 | P3 on prod build |
| Strangers cannot touch timelines | API | FR-1, FR-3 | §14 | migration | 3 RPCs | T1, T7, T8, T13; §0 D re-run | Post-deploy direct rpc → 403 |
| One project cannot write another's rows | API | FR-2 | §14.1 scoping | migration | RPC | T10–T12 | — |
| Hardened definers | — | FR-4 | §14.4 | migration | grants | T14, T15, inventory | — |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Chosen, and why |
|---|---|---|
| Fix the encoding | (a) keep `jsonb`, send arrays; (b) `text` params cast inside, like assemble | **(a).** One side changes, the signature stays (no PGRST202 window), and the generated types describe the real shape. (b) would keep a string contract that invites this bug again |
| Keep client ids | (a) insert with the client id; (b) DB ids, returned and remapped in the client | **(a).** Split already reuses the original's id; (b) needs an id-remap across clips, keyframes, selection, undo history and sync groups |
| Scope to the edit project | (a) scope each statement; (b) check only the edit project | **(a).** (b) lets a writer on A edit B's rows by id, which is the same class one level down |
| split/create | (a) harden and grant (ticket as written); (b) harden, leave ungranted; (c) drop them and their dead actions | **(a)**, recommended. The actions are exported from `server/actions.ts`, and an exported action that always fails `42501` is a trap. With the check, their reach equals the rule. (c) is cleaner if the owner prefers less surface (Decision 5) |
| Where the rule lives | RPC only / action only / both | **RPC only**, as KB-40 decided |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| Saving has never worked, so latent bugs past the save surface for the first time | Wrong data saved | P1/P2 reload assertions; `warn` on count shortfall | Test the second submission; the §8.4 inventory is explicit | Revoke the grants (§25) |
| §8.4 gaps read as "Saved" but lost | Track adds, transitions and language lost on reload | User report | Named in §1 and in the PR; Decision 2 | Follow-up KB |
| KB-40 not approved or changed | This branch cannot build (helper missing) | Build | Stack on KB-40 | Inline the helper here if KB-40 is dropped |
| Member deletes via save while RLS says owner/admin | Policy inconsistency | — | Decision 3 | — |
| `search_path=''` breaks something in the copied bodies | Runtime error | pgTAP T4, T7, T8 run the full bodies | — | — |

## 31. Open Questions and Assumptions

- **Q1 (Decision 1):** base for the inventory rows. *Assume:* stay on #313 → KB-40, and add the three I1 rows in whichever of KB-27/KB-62 merges second.
- **Q2 (Decision 2):** are the §8.4 gaps (add/remove track, transitions, language, cross-track move) in this ticket? *Assume: no.* A follow-up KB from the lead. Cross-track move is the smallest (one field in the schema and one column in the update); take it here if the owner wants.
- **Q3 (Decision 3):** should deleting clips and keyframes through the save require owner/admin, to match RLS delete? *Assume: no.* Use `can_write_project` for the whole save, consistent with KB-40's Decision 2; a member who can edit must be able to delete a clip.
- **Q4 (Decision 4):** a `beforeunload` warning while unsaved or failed? *Assume: no, a follow-up.* It is a separate UX change.
- **Q5 (Decision 5):** split/create: grant (as the ticket says) or drop? *Assume: grant.*
- **Q7 (Decision 6):** production state. Locally, `batch_save_edit_project` has never been executable by `authenticated`, so no edit was ever stored. The owner should check production for a hand-added grant, which would also mean the cross-tenant doors in §0 D are **open there now**. Run this read-only query on production, as the owner, without sharing the credentials: `select has_function_privilege('authenticated', 'public.batch_save_edit_project(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE');` and the same for the other two. *Assume:* `false`, matching every migration.
- **Q6:** the FILM-CC-04 entry for KB-62 does not exist. *Assume:* this PR writes the entry, marked Fixed, and one Fixed-table row.
- **Class sweep noted, not fixed:**
  - KB-61 (`.delete()` without `.select()` reports success on 0 rows) is the same shape as `batch_save`'s iteration counters, fixed here only for this function.
  - `get_project_id_for_edit_project` is unused and ungranted.
  - `getEditProjectAction`'s read check uses `accounts_memberships`, which locks personal-account owners out, like KB-40 L5.
  - `SplitClipCommand` drops the original clip's keyframes from *both* halves in the client, visible on screen at once (not a persistence bug).

## 32. Implementation Plan

1. After APPROVED and KB-40 pushed: rebase onto `fix/kb-40-edit-project-write-scope`.
2. **Migration** (§14). Under the DB lock: `db reset`, typegen, pgTAP written and run **against today's functions first** (migration moved aside, temporary grant in the test), recording red T1–T3, T10–T13 and T15. Then green. Then the mutation guards, each `RED`.
3. **Schema, action, provider, reducer, toolbar** (§15). Then `pnpm typecheck` and the KB-6 guard.
4. **Playwright** P1–P4 on dev. Red first: revert the migration and the client changes, and watch P1 show "✕ Save failed", P2 lose the trim, and P3's retry send nothing. Restore. Then the production build (§27), sandboxed. Then evidence screenshots.
5. **Attack re-run** (§0 D), with the before/after table.
6. FILM-CC-04 entry and Fixed row, `pnpm lint:fix`, `pnpm format:fix`, commit, and a PR stacked on KB-40.

## 33. Definition of Done

- As the owner, a split at a frame-stepped (fractional) playhead, then a trim of a split half, survive a reload in the real UI, on dev and on a production build.
- 💾 Save sends a request after a failure.
- A viewer and an account-only member see the refusal sentence; the DB is unchanged.
- The §0 D attacks return 403 as a second real user.
- pgTAP T1–T15 green with the red run recorded; mutation guards `RED`; the inventory rows added.
- Types regenerated; typecheck, lint and format clean; KB-6 guard green.
- Screenshots after each action in the PR.
- FILM-CC-04 updated; the §8.4 gaps and the §31 sweep handed to the lead.

## 34. Final Consistency Pass

**Forward.** Editors lose every edit today. It is briefly visible, then hidden under a green "✓ Saved" after a reload, and the retry button is dead. The fix must make "✓ Saved" true for a writer, refuse everyone else in words, make retry retry, and not open the three functions to strangers or to a writer's other projects. So: whole milliseconds at the save edge, identity from the JWT, `can_write_project`, per-row scoping, real JSON, client ids and media carried through, and a live retry. pgTAP proves the rule and the scoping. Playwright proves a reload shows what was saved, including the second edit. The attack re-run proves the doors stay shut.

**Reverse.** In production the three functions refuse all but the project's writers and touch only their own edit project's rows. The save inserts exactly the clips the client holds, under their ids and with their media, so the client and the database agree after each save. Writers see "✓ Saved" and a reload confirms it. Non-writers see why nothing saved. The four named gaps still drop on reload, as today, and are called out rather than hidden. That matches §1.
