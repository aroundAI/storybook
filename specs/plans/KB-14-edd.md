# KB-14 — Typecheck the lambdas: Engineering Design Document

| | |
|---|---|
| Ticket | KB-14, "The lambdas are not typechecked" (`specs/cross-cutting/FILM-CC-04-known-bugs.md` § KB-14) |
| Severity | Medium. Nothing is known broken, and nothing would tell us if it were |
| Branch | `fix/kb-14-typecheck-lambdas` from `origin/main` @ `49b851d6` |
| Size | M. Config plus about 60 small edits across 30 files, one one-statement migration, one pgTAP file |
| Status | Plan. Waiting for owner approval |

**Reading guide.** This is a tooling fix, so the "user" in §§1–5 is the engineer or
reviewer who relies on `pnpm typecheck` and CI's **ʦ TypeScript** job. It is
also, through them, the creator whose publishes, renders, refinements and LLM
jobs run in these workers. The core of the document is the triage of every
error in §8.3. Every other section follows from that table.

---

## 1. Start With the User

**Who.** Everyone who changes code under `apps/web/lambda/`: today the owner and
parallel agents, whose PRs are judged by `pnpm typecheck` and CI's ʦ TypeScript
job. Indirectly, the creator: these eleven workers publish to every platform,
refresh OAuth tokens, render edit-suite exports, generate voice and run the
whole LLM pipeline.

**Problem.** `apps/web/tsconfig.json` does not include `lambda/`, and no other
tsconfig does. `pnpm typecheck` and CI are green over code the compiler has
never read. Measured on this branch:

```
$ cd apps/web && npx tsc -p tsconfig.json --listFilesOnly | grep -c '/apps/web/lambda/'
0
```

A throwaway config over `lambda/**/*.ts` reports **83 errors** (82 at
`dbbd5ee8` when KB-14 was filed; one more TS2345 has landed since). The
triage below shows that several are real, silent defects:

- A publish-queue worker change that breaks a type ships with a green build.
- Refinement jobs have never been tracked, because the DB rejects their job type.
- Edit-suite export renders select columns that do not exist.
- The LLM worker carries dead code.

**After this ships.**
- `pnpm typecheck` and CI's ʦ TypeScript job typecheck all 51 `.ts` files under `apps/web/lambda/`, tests included.
- A type error in any handler turns CI red, and this is shown in the PR, not asserted.
- There are zero type errors under `apps/web/lambda/`. Each of today's 83 is either fixed, or explained and filed as its own KB entry.
- There are no blanket suppressions. The shared base config's existing `skipLibCheck` is inherited unchanged and is not new. The only suppressions allowed are per-line `@ts-expect-error KB-NN: <reason>`, and only where the owner picks that option in Decision 2. Such a line fails the build with TS2578 once its bug is fixed, so it cannot outlive its reason.

**Success.** A PR that introduces a lambda type error goes red in ʦ TypeScript.
`main` stays green.

**Failure.** Any of these counts as failure:
- The lambda check silently not running, for example skipped by turbo `--affected` or a cache replay.
- A green result that relies on suppressions without reasons.
- A "type-only" edit that changed runtime behaviour without saying so.

**What persists.** The new tsconfig, the script change and the fixes. One
DB migration, under Decision 1's default. **What does not persist:** nothing
user-visible changes, except where §9 lists it explicitly (refinement jobs
begin to be recorded, under Decision 1's default).

## 2. Define the Complete User Journey

| Stage | Engineer action | System response | Visible result | Next |
|---|---|---|---|---|
| Entry | Edits `apps/web/lambda/**` or any workspace package a lambda imports | — | — | Runs typecheck |
| Local check | `pnpm typecheck` (root, `turbo typecheck --affected`) or `pnpm --filter web typecheck` | `web#typecheck` runs `tsc --noEmit` (app), then `tsc --noEmit -p lambda/tsconfig.json` | Errors listed with `lambda/...` paths; exit ≠ 0 | Fix, rerun |
| Push / PR | Opens PR | ʦ TypeScript → `pnpm run typecheck` → turbo marks `web` affected (any change under `apps/web/` or in a dependency of `web`) → both `tsc` runs | Job red at step **Typecheck** with the lambda file:line, or green | Fix or merge |
| Re-entry | A cached turbo hit | Turbo's hash covers every tracked file in `apps/web`, including `lambda/` → a lambda edit is a cache miss | The same result as a fresh run | — |
| Interruption | First `tsc` fails | `&&` short-circuits; the lambda check does not run in that invocation | The app errors are shown first | Fix app errors, rerun |

## 3. Explicitly Define the Happy Path

1. The engineer changes `lambda/publish-worker/handlers/youtube.ts` correctly.
2. The engineer runs `pnpm --filter web typecheck`. The app `tsc` passes (about as fast as today). The lambda `tsc` reads the 51 lambda files plus their transitive imports from `packages/*` and exits 0. Measured wall time for the lambda pass: **~4 s**.
3. The engineer pushes. In CI, `turbo typecheck --affected` selects `web`, runs the same script and passes. The **Lint** step follows, unchanged.
4. This is success because the compiler has now read every handler under the same `strict` + `noUncheckedIndexedAccess` rules as the app.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | Engineer sees | Recovery | Final state |
|---|---|---|---|---|
| Type error in a handler | Lambda `tsc` exits 2 | `lambda/<worker>/<file>.ts(L,C): error TSxxxx` locally and in ʦ TypeScript | Fix it | Green |
| Type error in the app **and** a lambda | App `tsc` fails first; `&&` skips the lambda pass | Only the app errors on that run | Fix the app errors; the lambda errors appear on the next run | Green after two rounds at worst |
| New lambda imports a package `web` does not depend on | TS2307 at the import | Red | Add the dependency to `apps/web/package.json`. esbuild would have failed to bundle it too, or silently dropped it inside `try` (see G6: this is exactly what `@kit/embeddings` did) | Green |
| PR only changes a `packages/*` file a lambda imports | `web` depends on every such package (verified: `@kit/episodes`, `film-studio-schemas`, `llm`, `prompt-engine`, `publishing`, `shared`) → `web` is affected | The lambda pass runs | — | — |
| A later fix makes a `@ts-expect-error KB-NN` line obsolete (only if Decision 2 = default) | TS2578 "Unused '@ts-expect-error'" | Red, pointing at the directive | Delete the directive in the fixing PR | Green |
| A parallel ticket merges lambda code with type errors before this PR | This PR goes red on rebase | Red, in someone else's file | Fix trivially here, or ask that ticket's owner | Green |

## 5. Establish the User-Facing Contract

- **Input.** Any `.ts` file under `apps/web/lambda/`, tests included.
- **Output.**
  - Commands: `pnpm --filter web typecheck`, root `pnpm typecheck`, CI ʦ TypeScript → Typecheck.
  - Exit code is 0 only if both the app and the lambdas are clean.
  - Error lines carry `lambda/...` paths relative to `apps/web`.
- **Contract for suppressions.** No `@ts-ignore`. No `@ts-nocheck`. No new
  `skipLibCheck`, `noImplicitAny: false`, `strict: false` or similar loosening in
  `lambda/tsconfig.json` relative to the shared base. Every `@ts-expect-error`
  names a KB entry and a reason on the same line.
- **Contract for casts.** Every `as unknown as T` added by this change sits at an
  untyped trust boundary (an SQS payload, a JSON import). It is listed in §8.3
  and has a KB entry for the missing validation. No cast is added to hide a
  mismatch between two in-repo types. Those mismatches are fixed at the type.
- **Discoverability.** `--listFilesOnly` under the lambda config lists every lambda file (acceptance criterion 1).

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Why | Verification |
|---|---|---|---|
| FR-1 | `apps/web/lambda/tsconfig.json` includes `**/*.ts` under `lambda/`, extends `@kit/tsconfig/base.json` and adds no loosening | Criterion 1. It uses the same rules as every other package | `tsc -p lambda/tsconfig.json --listFilesOnly \| grep -c '/apps/web/lambda/'` = 51 (all files); diff the effective config (`--showConfig`) against base |
| FR-2 | `web`'s `typecheck` script runs the app check and the lambda check. Root `pnpm typecheck` and CI therefore run it with no workflow change | Criterion 1: "under CI's typecheck" | Read `package.json`; the CI log for the PR shows both invocations |
| FR-3 | Zero errors under the lambda config | Criterion 2 | `pnpm --filter web typecheck` exit 0 |
| FR-4 | Each of the 83 errors has a recorded disposition: fixed-real, fixed-type, or filed and suppressed | Criterion 2: "fixed or explained" | §8.3 table, carried into the PR body |
| FR-5 | An injected handler type error fails `pnpm typecheck` locally **and** CI ʦ TypeScript. It is then reverted | Criterion 3, red before green | Local transcript and two CI run links (red, then green) in the PR |
| FR-6 | Worker dependencies resolve for the checker: `@types/ws`, `@aws-sdk/client-s3`, `@aws-sdk/client-sqs` as `devDependencies` of `apps/web` at the versions already in the lockfile | The 9 module-resolution errors are artefacts of missing declarations. They are not code bugs | TS7016/TS2307 gone; `pnpm install --frozen-lockfile` passes in CI |
| FR-7 | Real defects found by the check are fixed where the fix is local and verifiable. Otherwise they are filed as new KB entries with a reproduction | The ticket: "fix what is real". The brief: stay in scope | §8.3 plus FILM-CC-04 diff |
| FR-8 | `generation_jobs.job_type` accepts `story-refinement` and `screenplay-refinement` (Decision 1 default) | The app already inserts them (`refinement-actions.ts:81`, `:176`) and the DB refuses them | pgTAP `lives_ok` / `throws_ok`, red before the migration and green after |
| FR-9 | The existing lambda unit tests still pass | Type-only edits must not change behaviour | `pnpm --filter web exec vitest run lambda` |
| FR-10 | Bundled handler output is unchanged, except in the files §9 says change behaviour | Proves "type-only" empirically rather than by reading | esbuild before/after diff (§27) |

## 7. Define Non-Functional Requirements

- **Latency of the check.** The lambda pass adds ~4 s wall time (measured, 51 files, M-series). CI's ʦ TypeScript job has a 10-minute timeout, and the `format` job was split out once already for time. The extra ~4–10 s on a CI runner is acceptable. `incremental: false` for the lambda pass avoids adding a second build-info file to turbo's `outputs`.
- **Determinism.** No dependence on env vars or on the network. Same result locally and in CI (same lockfile).
- **Maintainability.** One config, not eleven. Workers share dependencies and there is no per-worker `node_modules`.
- **Backward compatibility.** No change to how SST/esbuild bundles workers (§24). The `devDependencies` added are already in the lockfile at the same versions, and SST lists them as `nodejs.install` externals.
- **Security, privacy, accessibility and i18n.** Not applicable to a compile-time check. The migration widens one CHECK constraint (§19).
- **Cost.** Negligible CI minutes.

## 8. Analyze the Existing System

### 8.1 What exists

- **Workers.** 11 directories, 51 `.ts` files (`analytics-sync`, `email-worker`, `llm-worker`, `publish-worker`, `render-worker`, `report-ingest`, `scheduled-publish`, `scheduled-reports`, `subscriber-snapshot`, `token-refresh`, `voice-worker`). Two test files: `email-worker/__tests__/index.test.ts` and `publish-worker/__tests__/twitter.test.ts`. They are run by `apps/web` vitest, since there is no `include` filter, but they are typechecked by nothing.
- **Bundling.** `sst.config.ts` points `handler:` at `apps/web/lambda/<w>/index.handler`. esbuild strips types without checking them. `nodejs.install` lists packages kept external and installed at deploy time: `ws`, `@aws-sdk/client-s3` (llm, render), `@aws-sdk/client-sqs` (scheduled-publish), and others.
- **Typecheck.**
  - `apps/web/package.json` → `"typecheck": "tsc --noEmit"` against `apps/web/tsconfig.json`, whose `include` lists `app`, `lib`, `components`, `config`, `scripts` and root `*.ts`, but not `lambda/` or `websocket/`.
  - Root `pnpm typecheck` = `turbo typecheck --affected --cache-dir=.turbo`.
  - `turbo.json` `typecheck` caches `node_modules/.cache/tsbuildinfo.json`.
  - CI `.github/workflows/workflow.yml` job `typescript` ("ʦ TypeScript") runs `pnpm run typecheck`, then `pnpm run lint`, with `TURBO_SCM_BASE` set to the PR base.
- **Shared base.** `tooling/typescript/base.json`: `strict`, `noUncheckedIndexedAccess`, `skipLibCheck: true` (repo-wide, applies to `.d.ts` only), `lib: [dom, dom.iterable, esnext]`, `moduleResolution: bundler`.
- **Dependency resolution from `apps/web`, measured.**

  | Resolves | Does not resolve |
  |---|---|
  | `ws` (untyped), `@aws-sdk/client-dynamodb`, `@aws-sdk/client-sesv2`, `@googleapis/youtube`, `google-auth-library`, `@types/aws-lambda`, `@supabase/supabase-js`, `zod` | `@types/ws`, `@aws-sdk/client-s3`, `@aws-sdk/client-sqs`, `ffmpeg-static` (`require`d, untyped: no error), `@kit/embeddings` (not a `web` dependency) |

### 8.2 Reproduction (this branch, 2026-09-23)

```
$ cd apps/web && npx tsc -p tsconfig.json --listFilesOnly | grep -c '/apps/web/lambda/'
0
# throwaway: extends ./tsconfig.json, include lambda/**/*.ts
$ npx tsc --noEmit -p tsconfig.kb14-throwaway.json | grep -c 'error TS'
83
# same with extends @kit/tsconfig/base.json (the planned config): identical 83 file:line pairs
```

| Code | Count |
|---|---|
| TS2345 | 21 |
| TS2352 | 18 |
| TS2339 | 17 |
| TS7016 | 6 |
| TS2459 | 5 |
| TS2322 | 5 |
| TS2307 | 4 |
| TS2769 | 3 |
| TS7006 | 1 |
| TS2739 | 1 |
| TS2578 | 1 |
| TS1117 | 1 |

A variant without `dom` in `lib` gave 156 errors. Seventy of them came from
browser code in `packages/*` that the lambdas import transitively, so that
variant is rejected (§29).

### 8.3 Triage of all 83. The core of this plan

Dispositions:
- **type**: the runtime is right and the type is wrong or stale. Fix the type. No runtime change.
- **real-fix**: a defect, fixed here.
- **file**: a defect too large or too product-shaped for this ticket. File it as a new KB entry and make the check green as the decision says.

| Group | # | Where | What it is | Evidence | Disposition |
|---|---|---|---|---|---|
| **G1** Module resolution | 9 | `ws` TS7016 ×6 (`email-worker`, `llm-worker`, `publish-worker`, `render-worker`, `scheduled-publish`, `voice-worker` `index.ts`); `@aws-sdk/client-s3` TS2307 ×2 (`llm-worker/utils/r2-storage.ts:7`, `render-worker/utils/r2-storage.ts:7`); `@aws-sdk/client-sqs` ×1 (`scheduled-publish/index.ts:13`) | Declarations are missing for the checker. At runtime SST installs these as externals | §8.1 table; `sst.config.ts:679`, `:771-778`, `:888-896`, `:1467` | **type**: add `@types/ws` (8.18.1), `@aws-sdk/client-s3` (^3.964.0), `@aws-sdk/client-sqs` (^3.968.0) to `apps/web` devDependencies. All three are already resolved in `pnpm-lock.yaml` |
| **G2** Job types the DB rejects | 18 | `'story-refinement'` ×4 (`story-refinement.ts:62,147,228,255`), `'screenplay-refinement'` ×4 (`screenplay-refinement.ts:63,145,281,310`), `'audio_file_generation'` ×4 (`audio-file-generation.ts:158,226,245,266`), `'dialogue_voice_generation'` ×3 (`llm-worker/handlers/dialogue-voice-generation.ts:145,234,269`) + ×3 (`voice-worker/voice-generation.ts:156,262,297`) | **Real.** `GenerationJobType` (`llm-worker/utils/job-tracking.ts:11-16`) mirrors the DB's `generation_jobs_job_type_check` (`migrations/20260120000000_add_audio_cue_generation_job.sql:4-5`), which does **not** allow these four. Details follow the table | Reading; pgTAP will reproduce it (§26) | **real-fix** (Decision 1) |
| **G3** Unvalidated SQS payload casts | 12 | `payload as XPayload` where `payload: Record<string, unknown>`: `analytics-insights.ts:78`, `asset-creation.ts:77`, `batch-translate-metadata.ts:43`, `fact-extraction.ts:44`, `language-insights.ts:43`, `screenplay-conversion.ts:78`, `season-analysis.ts:97`, `season-outline.ts:57`, `shot-generation.ts:59`, `story-generation.ts:236`, `story-ideation.ts:58`, `translate-dialogue.ts:59` | The cast is unchecked. The payload is never validated, and a missing field surfaces as `undefined` deep in the handler. Two sibling handlers already write `as unknown as` (`story-refinement.ts:58`, `screenplay-refinement.ts:57`). Three validate with zod (`audio-cue-`, `audio-file-`, `dialogue-voice-generation`) | Reading | **file** (Decision 3): `as unknown as` at each site and a new KB entry "LLM-worker payloads are cast, not validated" |
| **G4** Embedded joins typed as arrays | 9 | `context-builder.ts:239, 271, 275, 287, 288, 393, 1445` (`episode.project` / `episode.season`); `screenplay-conversion.ts:174` (`episode.project`); `scheduled-publish/index.ts:188` (`publishes → episodes → projects`) | **Not a bug.** The workers use an untyped `SupabaseClient`, so supabase-js types every embedded resource as an array. These are many-to-one FKs (`episodes.project_id → projects`, `episodes.season_id → seasons`, `film-studio-tables.sql:59-60`), and PostgREST returns a single object for those, which is what the code reads. KB-14's "reads like a real one" is answered: the type is wrong, not the code | FK definitions; confirm at runtime against the local DB (§26, T-6) | **type**: declare the row shape with supabase-js's `.overrideTypes<…>()` on those three queries |
| **G5** Stale or incomplete in-repo types | 27 | See the list following the table | The runtime shape is right and a hand-written type lags behind it | Per item, in the list | **type** |
| **G6** Real, behaviour-neutral defects | 4 | `story-generation.ts:323`/`:329` TS1117; `commit-story-canon.ts:57` TS2339; `context-builder.ts:302` TS2307 + `:313` TS7006 | Details follow the table | Reading and grep, each with a positive control | **real-fix** |
| **G7** Render worker queries columns that do not exist | 4 | `render-worker/index.ts:244, 246, 247, 248` (TS2739/TS2322 at the `processFFmpegRender` call) | **Real and large.** Details follow the table | Migrations; to reproduce against the local DB (§26, T-7) | **file** (Decision 2) |
| **Total** | **83** | | | | |

**G2 detail.**
- `refinement-actions.ts:77-90` inserts `job_type: 'story-refinement'`, and `:172-190` inserts `'screenplay-refinement'`. Both go through `(client as any)`, which hid the mismatch from the app's own typecheck. The CHECK constraint rejects the insert, the action logs "Failed to create generation job entry" at warn and carries on, and the lambda's `markJob*` updates then match no row.
- For `audio_file_generation` and `dialogue_voice_generation` **no code creates a row at all**. The lambda calls `markJob*` with `reference_type='episode'` and `reference_id = cueId / dialogueLineId`. Those calls can never match a row, yet they log "Marked … as processing" (`job-tracking.ts:47-51`) regardless.
- No UI reads `generation_jobs` for these types: `useActiveGenerationJob` is called only for episode-level types. So nothing user-visible is broken today. What is broken is tracking and the logs' claims.
- Sibling (report only): `packages/features/episodes/src/lib/types.ts:728` has its own `GenerationJobType`, which lacks `audio_cue_generation`.

**G5 detail** (27 errors, all type-only):
- `shot-generation.ts:351-358` ×7: `GeneratedShotResult` (`packages/features/episodes/src/agent/shot-orchestrator.ts:57`) lacks `transitionType`, `frameStrategy`, `primarySubject`, `firstFrameDescription`, `lastFrameDescription`, `locationArea` and `locationEnvironmentDescription`. The prompt `scene-shot-generation.json` asks for all seven, and `shot-director-skill.ts` produces them. Add them as optional fields.
- `shot-generation.ts:183` TS2352: `s as Record<string, unknown>` to read `estimatedDuration` and `text`. Widen the local scene/dialogue types instead of casting.
- `screenplay-conversion.ts:512` TS2322: the local `ScreenplayScene.dialogue` is `{character, dialogue, sceneNumber}`. The orchestrator returns `{character, text, parenthetical}`, and the consumer `bulk-generate/screenplay-phase.tsx:36-47` expects `text`. Type the output with the orchestrator's `ScreenplayScene`.
- `prompt-registry.ts:92, 94, 104, 106` ×4: `PromptTemplate.output.schema` is typed `{type:'zod'; definition}`. Two prompt JSONs (`extract-asset-description`, `batch-translate-metadata`) carry a JSON-Schema object instead, and nothing in the lambda reads `.schema`. Widen the type.
- `llm-utils.ts:97` TS2322: `PromptLLMConfig.response_format` is `string`, while templates have `string | {type}`. Nothing reads it. Align the type.
- `context-builder.ts:404`: `projectAestheticStyle` is missing from the cast shape. The app writes it (`update-studio-settings.action.ts:100`). Add it.
- `validation-checkpoint.ts:100`: the local `plotSkeleton.characters` lacks `role` (required by `PlotCharacter`, `canon/types.ts:294`). The validator never reads `role`, and no caller passes `plotSkeleton`. Add `role` to the local type.
- `voice-worker/index.ts:201`: `VoiceJobMessage` is passed where `Record<string, unknown>` is expected, and the callee zod-parses it. Change the callee parameter to `unknown`.
- `llm-worker/index.ts:49`, `voice-worker/index.ts:49` TS2769: `Buffer.from(parts[1], 'base64')` under `noUncheckedIndexedAccess`, where the code already guards `parts.length === 3`. Destructure with a guard.
- `email-worker/index.ts:69` TS2769: `Unit: string` → type the parameter as CloudWatch's `StandardUnit`.
- TS2459 ×5 (`publish-worker/handlers/facebook.ts:6`, `linkedin.ts:6`, `tiktok.ts:6`, `youtube.ts:11`, `scheduled-publish/index.ts:16`): `PublishJobMessage` is imported from `../index`, which imports it and does not re-export it. The import is type-only and erased, so there is no runtime impact. Import from `@kit/publishing/lib/job-types` directly.
- `render-worker/index.ts:286` TS2578: an unused `@ts-expect-error`. Remove it.
- `email-worker/__tests__/index.test.ts:111`: the test helper's parameter is the full message type while the test passes `{to}`. Type the helper parameter `Partial<…>`.

**G6 detail.**
1. **Duplicate `verifiedFacts` key** (`story-generation.ts:323`, `:329`). JS keeps the last key, so the orchestrator gets `factsContext || undefined`. The earlier `verifiedFactsContext` is discarded. Both are built from the **same** rows (`episode_facts → verified_facts` for this episode: `context-builder.ts:293` via `fetchEpisodeFacts`, and `:338-368`) and differ only in framing ("NON-NEGOTIABLE plot constraints" vs "use accurately"). So the audit lead's "can drop project facts" (FILM-CC-04 leads list) overstates it: no fact is lost, only a framing. **Fix:** delete the first key and the now-unused `verifiedFactsContext`. This is exactly today's runtime (Decision 7).
2. **`_episodeSummary`** (`commit-story-canon.ts:57`) destructures a property that does not exist (the field is `episodeSummary`, `:27`) and is never used. **Fix:** remove it from the destructuring.
3. **Dead semantic-search branch** (`context-builder.ts:298-327`). It needs `useSemanticSearch === true`, and **no caller passes it** (all six callers use the default `false`: `story-ideation.ts:65`, `story-generation.ts:247`, `shot-generation.ts:101`, `screenplay-conversion.ts:119`, `story-refinement.ts:88`, `screenplay-refinement.ts:96`). Even if a caller did, it could not work:
   - `@kit/embeddings` is not a `web` dependency, and esbuild downgrades an unresolvable `import()` inside `try` to a warning.
   - `voyage-client.ts:1` imports `server-only`, which throws outside a React Server environment.
   - `getSupabaseServerAdminClient` is a Next-side helper.

   **Fix:** delete the branch and the `useSemanticSearch` parameter, and record in FILM-CC-04 that lambda semantic previous-episode search has never run. That is a feature gap, not a regression.

**G7 detail.** `render-worker/index.ts` selects, at `:176-178`, `metadata, canvas_width, canvas_height, duration_ms` from `edit_projects`. At `:196-199` it selects `duration_ms, source_url, source_type, params, content_type, trim_start_ms, trim_end_ms` from `edit_clips`, then `clip_id` from `edit_transitions` and `time_ms` from `edit_keyframes` (`:207-213`). None of those columns exists. The tables are `edit_projects(width, height, fps, …)`, `edit_clips(end_ms, in_point_ms, out_point_ms, speed, fade_in_ms, media_url, …)`, `edit_transitions(from_clip_id, to_clip_id, …)` and `edit_keyframes(offset_ms, …)` (`20260219083555_edit-suite-v2.sql`; no later `ALTER` adds them). `handlers/ffmpeg-render.ts:27-72` is written against the **real** columns (`project.width` at `:324`). PostgREST answers an unknown column with an error. The `update … select` at `:170-178` would therefore fail, and the worker would throw "Edit project not found" **before any rendering**. Every edit-suite export would fail. This is reachable: `packages/features/edit-suite/src/server/render-actions.ts` and `components/export/export-dialog.tsx`. Fixing it means rewriting three selects and the clip filter, then proving a render end to end with FFmpeg. That is a feature-sized piece of work with its own verification, and outside a typecheck ticket.

### 8.4 Siblings of the class, found and not fixed here

- **`apps/web/websocket/`** (10 files; SST handlers `connect`, `disconnect`, `default`) is also outside every tsconfig. The same throwaway method gives **~125 errors**. About 112 are in `__tests__/`, where the tests call a 3-arg `Handler` with 1 arg. 13 are in handlers: `connect.ts` reads `headers`/`queryStringParameters`, which the `aws-lambda` WebSocket event type omits; `default.ts:212-214` narrowing; `ws` and `jose` resolution. **Proposed:** a new KB entry, which is Decision 4.
- `apps/web/test/`, `__mocks__/` and the `vitest.*` files are excluded from the app's tsconfig deliberately; they are not lambdas. Not in scope.
- `refinement-actions.ts` uses `(client as any)` for its `generation_jobs` inserts. That hid G2 from the app's typecheck. Reported, not changed (it is `@kit/episodes`).

## 9. Define the Desired System Behavior

| Change | Runtime effect |
|---|---|
| tsconfig, script, devDeps, G1/G4/G5 | **None.** Types are erased and the bundles are identical (proved in §27) |
| G3 `as unknown as` | **None** (same erased cast) |
| G6.1 duplicate key | **None.** The removed key was already overwritten |
| G6.2 `_episodeSummary` | **None** (unused binding) |
| G6.3 dead branch | **None.** Unreachable: no caller passes `true` |
| G2, Decision 1 default: migration adds `story-refinement`, `screenplay-refinement` to the CHECK | **Changes:** story and screenplay refinements now create a `generation_jobs` row (`queued`), and the lambda moves it to `processing`, then `completed` or `failed`. The action's warn log stops firing. No UI reads these rows today (§8.3 G2) |
| G2: delete the `markJob*` calls for `audio_file_generation` / `dialogue_voice_generation` | **None** in the DB (no row can match). The misleading "Marked … as processing/completed" log lines disappear |
| G7 `@ts-expect-error KB-NN` (Decision 2 default) | **None**. The renders stay broken until the new KB is fixed |

## 10. High-Level Architecture

There are no new components. The change consists of:
- A second **compilation unit**, `apps/web/lambda/tsconfig.json`, beside the app's.
- One more command in `web`'s `typecheck` script.
- Three devDependencies.
- One migration.

Why this shape:
- The workers already resolve modules from `apps/web/node_modules`, because esbuild bundles them from there. A config in that tree checks exactly what esbuild bundles. A separate workspace package (§29) would change esbuild's resolution root.
- One config for all workers: they share dependencies and helpers. `llm-worker` imports `voice-worker`-style helpers, and `scheduled-publish` imports `publish-worker` types.
- Wiring through the existing `web#typecheck` turbo task means CI, turbo caching and `--affected` need **no change**.

## 11. Architecture and Flow Diagrams

```
pnpm typecheck ──► turbo typecheck --affected ──► web#typecheck
                                                     │
                                                     ├─ tsc --noEmit                       (apps/web/tsconfig.json: app, lib, components, config, scripts)
                                                     └─ && tsc --noEmit -p lambda/tsconfig.json   (NEW: lambda/**/*.ts incl. __tests__)
                                                              │ extends @kit/tsconfig/base.json (strict, noUncheckedIndexedAccess)
                                                              └─ resolves from apps/web/node_modules (same root esbuild bundles from)

CI  ʦ TypeScript:  checkout → pnpm install → turbo cache restore → [Typecheck: pnpm run typecheck] → [Lint]
                                                                     ▲ unchanged step; the script it runs grew
```

G2 after the migration:

```
refineStoryAction ──insert generation_jobs(job_type='story-refinement', status='queued')──► OK (was: CHECK violation, warn, continue)
        └─ queueLlmJob ─SQS─► llm-worker story-refinement
                                 ├─ markJobProcessing  → UPDATE … status='processing'  (was: 0 rows)
                                 └─ markJobCompleted / markJobFailed                   (was: 0 rows)
```

## 12. End-to-End Data Flow

The only data flow that changes is G2 (Decision 1 default):
- **Source:** `story-refinement` / `screenplay-refinement` server actions.
- **Row:** `generation_jobs{reference_type:'episode', reference_id, job_type, status:'queued', account_id, project_id, idempotency_key, input_data}`.
- **Validation:** the CHECK constraint, now widened.
- **Processing:** the lambda's `markJob*` updates, keyed by `(reference_type, reference_id, job_type, status)`.
- **Consumers:** none in the UI today.
- **Retention:** as for other job rows. No retention job exists for `generation_jobs` (not changed).
- **Loss and duplication:**
  - Two quick refinements on one episode create two `queued` rows, and `markJobProcessing` moves both to `processing`, because it filters on status and not on id. That is the same semantics as the existing `story` job type, and is recorded as existing behaviour, not introduced.
  - Before the migration every row was lost, because the insert was rejected.

## 13. Data Model

- `generation_jobs.job_type` is `text` with CHECK `generation_jobs_job_type_check`. It is authoritative for which job types exist.
- The lambda's `GenerationJobType` union must mirror that constraint exactly. After this change it does, and a comment names the migration so the next person to widen one widens both.
- No other data model change.

## 14. Database Design and Changes

This section applies only with Decision 1 = default.

```sql
-- apps/web/supabase/migrations/<UTC ts>_generation_jobs_refinement_job_types.sql
-- KB-14: refinement actions insert these job types (refinement-actions.ts) and the
-- llm-worker tracks them; the CHECK rejected both, so no refinement was ever recorded.
alter table public.generation_jobs drop constraint if exists generation_jobs_job_type_check;
alter table public.generation_jobs add constraint generation_jobs_job_type_check
  check (job_type in ('video','voice','music','sfx','story','screenplay','shot_list',
                      'translate-dialogue','audio_cue_generation',
                      'story-refinement','screenplay-refinement'));
```

- **Before:** 9 allowed values. **After:** 11. It is a pure superset, so every existing row satisfies the new constraint.
- **Locking:** `ADD CONSTRAINT … CHECK` validates existing rows under an `ACCESS EXCLUSIVE` lock. `generation_jobs` is small (one row per generation), so this is milliseconds. `NOT VALID` is not used: the rows are all valid by construction, and "a deferral is a claim too" (workflow doc).
- **Schema file:** `apps/web/supabase/schemas/` mirror applies only if a schema file defines `generation_jobs`. This will be checked, and the file updated only if one exists.
- **Types:** CHECK constraints do not appear in generated types. Typegen is still run and expected to produce no diff, which is itself verified.
- **Rollback:** re-add the 9-value constraint. That fails if refinement rows exist, so delete or relabel them first. This is documented in the migration comment.
- **pgTAP:** a new `apps/web/supabase/tests/database/generation-jobs-job-type.test.sql` with `lives_ok` for each of the two new values, `throws_ok` (`23514`) for `'bogus'`, and `lives_ok` for an existing value.

## 15. Low-Level Design

**`apps/web/lambda/tsconfig.json`**

```json
{
  "extends": "@kit/tsconfig/base.json",
  "compilerOptions": { "incremental": false },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

**`apps/web/package.json`**
- `"typecheck": "tsc --noEmit && tsc --noEmit -p lambda/tsconfig.json"`
- Add `"@types/ws"`, `"@aws-sdk/client-s3"` and `"@aws-sdk/client-sqs"` to `devDependencies`. The lockfile changes only in the `apps/web` importer block.

**Per-group edits** (from §8.3):
- **G4.** Append `.overrideTypes<{ project: { id: string; metadata: unknown } | null; season: {…} | null }>()` (the merge form keeps the other inferred columns) to the three selects. There is no `as`.
- **G5.**
  - Optional fields on `GeneratedShotResult`.
  - Import the orchestrator's `ScreenplayScene` for the conversion output.
  - Widen `PromptTemplate.output.schema` to `{type:'zod'; definition:string} | Record<string, unknown>`.
  - `PromptLLMConfig = PromptTemplate['llm']`, making it one source.
  - Add `projectAestheticStyle?: string` and `role: string`.
  - Callee parameter `unknown`.
  - `const [, body] = parts; if (body) …`.
  - `Unit: StandardUnit`.
  - Direct type import of `PublishJobMessage`.
  - Drop the unused directive.
  - `Partial<>` in the test helper.
- **G3.** `payload as unknown as XPayload` ×12, each with a one-line comment: `// SQS payload, unvalidated: KB-NN`.
- **G6.** As in §8.3.
- **G2.**
  - Add the two refinement values to `GenerationJobType`, with a comment pointing at the migration.
  - Delete the 10 `markJob*` calls, and their imports, for `audio_file_generation` / `dialogue_voice_generation` (`audio-file-generation.ts`, `llm-worker/handlers/dialogue-voice-generation.ts`, `voice-worker/voice-generation.ts`).
- **G7 (Decision 2 default).** Four `// @ts-expect-error KB-NN: render-worker selects columns edit_* does not have; every export render fails before FFmpeg` lines, one above each failing property at `:244-248`.

No new modules, no retries and no concurrency concerns.

## 16. API and Event Design

- No new or changed APIs.
- SQS message shapes are untouched. G3 changes only the erased cast.
- `PublishJobMessage` stays defined in `@kit/publishing/lib/job-types`.

## 17. State and Lifecycle Design

`generation_jobs.status`: `queued → processing → completed | failed` (existing). The only change is that refinement rows now enter this lifecycle (Decision 1). There are no new states.

## 18. Failure and Error Handling

| Failure | Behaviour | Seen by | Recovery |
|---|---|---|---|
| Lambda type error | `tsc` exit 2 | Engineer / CI | Fix |
| Refinement insert fails for another reason (for example a column mismatch hidden by `as any`) | Unchanged: warn and continue | Logs | This will be checked in Phase 2 by running the action's exact insert in a rolled-back transaction. If it fails for a second reason, stop and report `NEEDS DECISION` |
| Migration fails on deploy | The deploy workflow stops at migrations | Deploy log | None expected: a superset constraint over valid rows |
| `@types/ws` exposes a real mismatch between `ws` and supabase-js's `realtime.transport` type | New errors appear | Engineer | Fix at the type. If a real incompatibility turns up, stop and report |

## 19. Security

- The migration widens a CHECK by two string values. RLS policies and grants are untouched, so there is no tenant-isolation change and no pgTAP obligation for policies. The pgTAP test in §14 covers the constraint.
- The G3 casts make the lack of validation at an untrusted boundary (SQS message bodies) **visible** and filed, rather than hidden behind a TS2352.
- No production credentials or production config are read or needed anywhere in this plan.
- Removing the dead `@kit/embeddings` branch removes a code path that would have called the service-role admin client from an unexpected place.

## 20. Performance and Scale

- Lambda `tsc` is ~4 s locally, and turbo caches it with the rest of `web#typecheck`.
- No runtime performance change, apart from 10 fewer no-op `UPDATE`s per audio/dialogue job and two new tracking writes per refinement.

## 21. Accessibility and Client Behavior

Not applicable. There is no UI change. Refinement rows are not rendered anywhere.

## 22. Observability and Operations

**How an operator knows it works:**
- The CI log for every PR touching `apps/web` shows `web:typecheck: > tsc --noEmit && tsc --noEmit -p lambda/tsconfig.json`.
- A red run names `lambda/...` paths.
- In the runtime logs, the refinement-action warning "Failed to create generation job entry" stops. The lambda's "[Job Tracking] Marked story-refinement as processing" lines are now true: they previously logged after 0-row updates too, and remain unconditional, which is noted in the risk register.

**Follow-up to note, not fix:** `job-tracking.ts` logs "Marked" without checking the updated row count.

## 23. Configuration and Feature Flags

- No flags and no environment variables.
- The only configuration is the new tsconfig and the script.
- `incremental: false` is deliberate (§7).

## 24. Compatibility

- **Bundles.** esbuild ignores types, and the devDependencies are either already `nodejs.install` externals (`client-s3`, `client-sqs`, `ws`) or types-only (`@types/ws`). Bundles are proved identical in §27, except for the files listed in §9.
- **Other PRs.** Once merged, every open PR touching `lambda/` must pass the new check. Notably KB-29 and FILM-1504 may add lambda code. The lead should tell those teammates.
- **DB.** The migration is backward-compatible: old app code simply stops failing its insert.
- **Deploy order.** The migration can land before or with the code. The lambda keeps tolerating 0-row updates either way.

## 25. Migration and Rollout Strategy

1. Merge. CI Supabase DB job applies the migration and runs pgTAP. ʦ TypeScript runs the lambda check.
2. The normal deploy applies the migration, and SST redeploys the workers with identical bundles, except the §9 files.
3. **Validation gate:**
   - The CI run on `main` after merge shows the lambda pass.
   - On staging, not production, one story refinement creates a `generation_jobs` row that ends `completed`. This is an owner step. I cannot and will not touch deployed environments.
4. **Rollback:**
   - Revert the PR. For the migration, see §14.
   - The tsconfig/script can be reverted independently of the migration.

## 26. Testing Strategy

| ID | Test | Layer | Red before green |
|---|---|---|---|
| T-1 | `tsc -p lambda/tsconfig.json --listFilesOnly \| grep -c '/apps/web/lambda/'` ≥ 51 (and `0` under the app config, already recorded) | Config | The "before" number is 0 (§8.2) |
| T-2 | `pnpm --filter web typecheck` exit 0 | Typecheck | The 83 errors are the recorded red state. Each group's edit is checked by re-running and watching its errors disappear |
| T-3 | **Injected error:** add `const kb14Probe: number = 'x';` to `lambda/publish-worker/handlers/youtube.ts` → `pnpm --filter web typecheck` **and** root `pnpm typecheck` exit ≠ 0 naming that line → revert → exit 0 | Local red→green | This is the test |
| T-4 | **CI red→green:** push the T-3 injection as its own commit → ʦ TypeScript fails at step "Typecheck" with that file:line → push a revert commit → green. Both run URLs go in the PR (Decision 6) | CI | This is the test |
| T-5 | pgTAP `generation-jobs-job-type.test.sql` | DB | Run it **before** applying the migration: fails on `story-refinement` (23514). After: passes |
| T-6 | **Join shape (G4):** under the DB lock, seed an episode with a project and season, run the exact `context-builder` and `scheduled-publish` selects with supabase-js as service role, and assert `!Array.isArray(row.project)` | Runtime | Establishes that the type was wrong and the code right. If it **is** an array, G4 flips to real-fix and I stop and report |
| T-7 | **Render worker (G7):** under the DB lock, run `render-worker/index.ts:170-178`'s `update … select` through supabase-js against a seeded `edit_projects` row → expect PostgREST error `42703` / "column … does not exist" | Runtime | This is the reproduction for the new KB entry |
| T-8 | Refinement insert: run `refinement-actions.ts:77-90`'s exact insert in a rolled-back transaction, before (fails `23514`) and after (succeeds) the migration | DB | This is the test |
| T-9 | Existing lambda unit tests: `pnpm --filter web exec vitest run lambda` | Unit | They pass before, and must pass after |
| T-10 | Mutation checks on the real fixes: re-add the duplicate key → TS1117; re-add `_episodeSummary` → TS2339 | Typecheck | This is the test |
| T-11 | Bundle identity (§27) | Build | — |
| T-12 | Full `pnpm typecheck`, `pnpm lint:fix`, `pnpm format:fix`, `pnpm --filter web test` | All | — |

No Playwright: there is no form or interactive UI change.

## 27. Production-Build Verification

The production artefact for a worker is SST's esbuild bundle, not the Next build. I cannot run `sst deploy`, because it needs cloud credentials, which are off-limits. Instead:

- Bundle each of the 11 handlers with esbuild from the repo's own `node_modules`, **before and after** the change, using `--bundle --platform=node --format=esm` with `--external:` for each worker's `nodejs.install` list from `sst.config.ts`. Diff the outputs.
- **Expected:** byte-identical output for every worker, except the `llm-worker` bundle (G6.1, G6.3, G2 deletions) and the `voice-worker` bundle (G2 deletions). Those diffs are inspected and must contain only the removed code.
- Any other diff is a finding, and stops the PR.
- It also proves that `esbuild` still resolves everything, including the removed `@kit/embeddings` import, whose warning disappears.

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Prod verification |
|---|---|---|---|---|---|---|---|
| Lambda files are checked | §2 local/CI | FR-1, FR-2 | §15 | `lambda/tsconfig.json`, `package.json` | — | T-1 | CI log on `main` |
| Green is honest | §3 | FR-3, FR-4 | §8.3 | 30 lambda files, 2 package files | — | T-2, T-10 | CI on `main` |
| Breakage goes red | §4 row 1 | FR-5 | §11 | CI ʦ TypeScript | — | T-3, T-4 | Run URLs in PR |
| Deps resolve | §4 | FR-6 | §15 | `apps/web/package.json`, lockfile | — | T-2 | `pnpm install --frozen-lockfile` in CI |
| Real defects fixed or filed | — | FR-7 | §8.3 G2/G6/G7 | as listed | FILM-CC-04 | T-5, T-7, T-8, T-10 | Staging refinement row (owner) |
| Refinements tracked | §11 G2 | FR-8 | §14 | migration | `generation_jobs` | T-5, T-8 | Staging (owner) |
| No behaviour drift | — | FR-9, FR-10 | §9 | bundles | — | T-9, T-11 | Bundle diff |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Why this one |
|---|---|---|
| One config under `apps/web/lambda/` | (a) Add `lambda` to `apps/web/tsconfig.json`'s `include`. (b) One tsconfig per worker. (c) Make `lambda/` a workspace package `@kit/lambdas` with its own deps and turbo task | (a) mixes Next-specific settings (the `next` plugin, `~/` paths, `.next/types`) into workers that must not use them, and would let a worker import `~/…` and pass the check while esbuild fails. (b) is 11 identical files for no gain. (c) moves esbuild's resolution root, which could change what gets bundled and at which version. That is a deploy risk this ticket should not take |
| Extend `@kit/tsconfig/base.json` with its `lib` including `dom` | Node-only `lib` (`ES2023`, `types: [node]`) | Measured: 156 errors, ~70 from browser code in `packages/*` that the lambdas import transitively. Correct in principle, but it belongs to a separate server/client package split |
| Chain in the `typecheck` script | A separate turbo task `typecheck:lambda` in `turbo.json`, or a new CI step | The chain inherits turbo caching, `--affected` and CI with **zero** shared-config change. A new task would need `turbo.json` and CI edits for no added coverage |
| `incremental: false` | A second tsbuildinfo, with the `turbo.json` outputs glob widened | Saves a shared-config edit. The pass is ~4 s |
| G4 via `.overrideTypes` | Type the clients with `Database` (`SupabaseClient<Database>`) | The real long-term fix, but it types **every** lambda query at once. That surfaces an unknown number of new errors and belongs in its own ticket, which is proposed as a follow-up |
| G3 `as unknown as` + KB | zod schemas for all 12 payloads now | A schema stricter than what producers send would reject real jobs in production, and each producer would need auditing. That is its own ticket. The explicit cast is behaviour-identical and the gap is filed |
| G7 file + `@ts-expect-error` | Rewrite the selects here | A render cannot be verified end to end without FFmpeg media fixtures. A half-fixed render worker that typechecks is worse than an honest red marker |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| A "type-only" edit changes runtime | Silent behaviour change | T-11 bundle diff | Only §9's files may differ | Revert that edit |
| `@types/ws` conflicts with supabase-js `realtime.transport` typing | New errors | T-2 | Fix at the type | Report if it is a real incompatibility |
| The refinement insert fails for a second reason (hidden by `as any`) | The migration alone does not start tracking | T-8 | Run the exact insert | `NEEDS DECISION` |
| Parallel tickets (KB-31, KB-18, KB-27, KB-22) edit the same lambda files | Merge conflicts | Rebase | Keep edits to 1–3 lines per shared file | Rebase and re-run T-2 |
| KB-29 / FILM-1504 land lambda code with type errors first | This PR goes red | CI | Fix trivially or coordinate | Lead mediates |
| New KB numbers collide with other teammates filing | Duplicate IDs | Review | Ask the lead for numbers before committing | Renumber |
| The `--affected` base misses a change | Lambda check skipped | — | `web` depends on every package the lambdas import (§4) | — |
| `[Job Tracking] Marked …` still logs after 0-row updates | Misleading logs | Reading | Out of scope; noted in §22 | Follow-up |

## 31. Open Questions and Assumptions

| Question | Why it matters | Assumption | Needs |
|---|---|---|---|
| Does PostgREST return objects for these many-to-one embeds? | G4 disposition | Yes (FKs plus PostgREST semantics) | T-6 under the DB lock |
| Does the render worker fail exactly as read? | G7 severity | Yes | T-7 under the DB lock (the lock was held by KB-31 and then KB-28 while this plan was written) |
| Is `edit_projects` render export used today by the owner? | G7 priority | Reachable from the export dialog. Usage unknown | Owner |
| Are Decisions 1–8 accepted? | Scope | Defaults as listed | Owner |

## 32. Implementation Plan

1. **Config and dependencies.** Add `lambda/tsconfig.json`, the script and the devDependencies. `pnpm install`. Record T-1 and the red count, which should be 74 once G1 resolves.
2. **G5 and G4 type fixes.** File by file, re-running the lambda `tsc` after each. Then T-6 under the DB lock.
3. **G6 real fixes.** T-10 mutations.
4. **G2.** Migration, pgTAP (T-5 red then green), T-8, typegen (expect no diff), union and deletions. All under the DB lock, starting with `db reset` from this worktree.
5. **G3 and G7** per the decisions. T-7 under the DB lock. Write the new KB entries in FILM-CC-04, with numbers from the lead.
6. **Green:** T-2, T-9, T-11, T-12.
7. **Record.** Update FILM-CC-04:
   - Mark KB-14 **Fixed** and add one Fixed-table row.
   - Move or strike the `verifiedFacts` audit lead with the correction from G6.1.
   - Add the new KB entries: render worker, unvalidated payloads, websocket typecheck, lambda semantic search never ran.
8. **PR.** Push, open the PR, then T-4 (inject commit → red run → revert commit → green run). Put run URLs, the triage table and the bundle diff in the body.

## 33. Definition of Done

- [ ] `--listFilesOnly` under the lambda config lists every lambda file, and `web#typecheck` runs it (criterion 1)
- [ ] Zero lambda errors, and all 83 dispositioned in the PR body (criterion 2)
- [ ] A handler type error was seen to fail locally and in CI, then reverted (criterion 3)
- [ ] pgTAP red then green; the refinement insert is proven before and after
- [ ] G4 runtime shape and G7 failure reproduced against the local DB
- [ ] Bundles identical outside §9's files
- [ ] `pnpm typecheck`, `lint:fix`, `format:fix` and web unit tests green
- [ ] FILM-CC-04 updated (KB-14 Fixed; new entries filed; audit lead corrected)
- [ ] The lead has told the teammates on lambda-touching tickets that the check now exists

## 34. Final Consistency Pass

**Forward.**
1. Problem: 51 files unchecked.
2. Outcome: they are checked, and breakage goes red.
3. Flow: the same `pnpm typecheck` / ʦ TypeScript.
4. System: a second `tsc` in `web#typecheck`.
5. Data: only G2's rows.
6. Architecture: one config, no CI edit.
7. Tests: T-1 to T-12 cover each criterion with a red state.
8. Deploy: identical bundles plus one superset migration.
9. Verification: CI on `main`, and staging refinement by the owner.

**Reverse.**
1. What production will do after merge:
   - Run the same bundles, except that dead code and no-op calls are gone.
   - Record refinement jobs.
   - Still fail edit-suite renders (filed, not hidden).
2. What CI will do: read every lambda file and fail on any type error.
3. That is the outcome stated in §1, with the one behaviour change (refinement tracking) made explicit in §9 and gated by Decision 1.

The two directions agree.
