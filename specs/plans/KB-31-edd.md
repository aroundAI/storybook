# KB-31 — Engineering Design Document

**Every LLM job names only what its caller may use**

| | |
|---|---|
| Ticket | KB-31 — "Story ideation builds its prompt from any episode, for any caller" (`specs/cross-cutting/FILM-CC-04-known-bugs.md`, `## KB-31`) |
| Branch | `fix/kb-31-llm-job-target-authz` from `origin/main` @ `49b851d6` |
| Status | Plan — awaiting owner approval |
| Reproduced | **Yes**, 2026-09-23, two real users on the local Supabase stack (§8.4) |

Reading guide: §1–§7 say what the user gets; §8 is what the code does today,
with the reproduction; §9–§17 are the design; §18–§27 how it fails, is
secured, tested and verified; §28–§34 trace, trade off and close.

Terms used throughout:

- **Producer** — a server action or route that calls `queueLlmJob`.
- **Target** — the episode or project a job's worker will read or write,
  and the account that owns it.
- **Member** — a user for whom `public.has_account_access(account_id)` is
  true: the account's primary owner, or anyone with a role on it. The same
  rule the analytics guard uses (`packages/features/content-analytics/src/server/scope-access.ts:85-100`, FILM-1615).
- **Viewer** — a signed-in user who can *read* a row only because its
  project or episode is `public` or `unlisted`.

---

## 1. Start With the User

**Who.** Two kinds of user are affected:

1. A **creator** (owner or member of an account) who generates story ideas,
   stories, screenplays, shots, assets, audio cues, translations, facts or
   insights for their own episodes and projects. They see no change.
2. **Every other creator's data.** Today any signed-in user who has — or is
   handed — another account's episode or project id can have the LLM worker
   read that account's canon and send the result back to *them*, and for
   several job types can make the worker *write into* the other account's
   episode or project.

**What the creator gets when this ships.**

- Their characters, locations, season premises, verified facts, episode
  premises, dialogue and analytics are used to build prompts **only** for
  requests made by a member of their account.
- Nothing another user does can make a worker overwrite their story,
  screenplay, dialogue, shots, audio cues or assets, or add assets and facts
  to their project — including when they have made the project public or
  unlisted to share it.
- The LLM usage of a job is recorded against **the account that owns the
  episode or project**, not whichever account the requester happened to join
  first — so a creator in two workspaces is billed and budgeted in the right
  one.

**What they could not rely on before.** Keeping an episode id private was the
only protection for ideation (a UUID, not guessable — why KB-31 was rated
Medium). Making a project public — the product's sharing feature — removed
even that for thirteen other producers (eight job types), because an id on a shared page is not a
secret and the actions accept any episode they can *read*.

**Success.** A request that names a target the caller is not a member of is
refused at the server action, before anything is queued; the caller sees
"Episode not found" (or "Project not found"), worded the same whether the row
does not exist or is someone else's. A member's request behaves exactly as
today.

**Failure** (what must never happen after the fix): a job queued whose
episode, project or account the requester is not a member of; a job whose
`accountId` differs from its target's account.

**What persists.** Nothing new. A refused request writes no `generation_jobs`
row and sends no queue message. **What does not persist:** the refusal itself
(it is a message, not a record; the server log carries it — §22).

## 2. Define the Complete User Journey

The journey is unchanged for members. It is written out for the one stage
this touches — pressing a "Generate" button — because the refusal is new.

| # | User action | System response | User-visible result | Next action |
|---|---|---|---|---|
| 1 | Opens an episode stage (ideation, story, screenplay, visual studio, audio studio) or a project page (season planner, bulk generate, research, analytics) | Page renders via RSC (unchanged) | The stage, with its Generate control | Fill the form |
| 2 | Presses Generate | Server action authenticates, **resolves the target through the user's session and checks membership**, then queues | Member: the existing "…in background" toast and progress state | Wait for the WebSocket result (unchanged) |
| 2′ | Same, but not a member of the target (forged or stale id) | Refused before any write or queue message | "Episode not found" / "Project not found"; progress state does not start | Nothing to do; the form stays as filled |
| 3 | Result arrives | Worker pushes the result to the requesting user (unchanged) | Ideas / story / screenplay etc. appear | Continue the pipeline |

Entry points, re-entry, refresh, cancellation and navigation away are
unchanged: nothing about this fix is stored client-side or spans a reload.
A session that expired between steps 1 and 2 is handled as today (redirect to
sign-in by middleware, #264 round 5).

## 3. Explicitly Define the Happy Path

Canonical case: a member generates story ideas for their own episode.

1. **User** types a premise on `/home/<account>/studio/<project>/episodes/<episode>/ideation` and presses Generate.
2. **System receives** `generateStoryIdeasAction({ episodeId, premise, numberOfIdeas })`.
3. **Processing.** `enhanceAction` validates the schema; `requireUser`
   authenticates. `authorizeEpisodeTarget(client, episodeId)` reads
   `episodes (id, project_id, projects(account_id))` **through the user's
   client**, then calls `has_account_access(account_id)` as that user.
   Both succeed.
4. **Data read.** One `episodes` row, one RPC. **Data changed:** none by the
   action (as today).
5. **Returned.** `queueLlmJob` sends
   `{ jobType: 'story-ideation', userId, payload: { episodeId, premise, numberOfIdeas, userId, accountId: <episode's account>, projectId: <episode's project> } }`;
   the action returns `{ ok: true, data: { success: true, queued: true } }`.
6. **User sees** "Generating story ideas in background…", then the ideas.
7. **Why success.** The prompt is built only from the caller's own account's
   canon, and the usage row lands on that account.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible behaviour | Recovery | Final state |
|---|---|---|---|---|
| Episode id of another account (private project) | RLS returns no row → `ActionRefusal('Episode not found')` | "Episode not found" | None needed | Nothing queued, nothing written |
| Episode id of another account's **public/unlisted** project | Row is readable (public policy) but `has_account_access` is false → same refusal, same words | "Episode not found" | — | Nothing queued |
| Episode deleted (soft) in another tab | `deleted_at is null` filter → no row → refusal | "Episode not found" | Reload the page | Nothing queued |
| Member removed from the account mid-session | `has_account_access` false → refusal | "Episode not found" | — | Nothing queued |
| Batch action with a mix of own and foreign ids | Own ids queued; foreign ids appended to the existing `failed[]` with "Episode not found" | Existing per-episode failure display | — | Only authorised jobs queued |
| `batchCreateAssetsAction` whose `projectId` is not the episode's project | Refused per episode ("Episode is not in this project") | Per-episode failure | — | Nothing queued for it |
| `has_account_access` RPC errors (DB down) | Thrown as an unexpected error, **not** a refusal (we do not know the answer) | Existing generic failure message | Retry | Nothing queued |
| Invalid / missing input | Schema validation (unchanged) | Existing form error | Fix input | — |
| Queue unavailable (no `LLM_JOBS_QUEUE_URL`) | Unchanged: `queueLlmJob` throws after authorisation | Existing error | — | Nothing queued |
| Duplicate submission | Unchanged (rate limit, idempotency keys as today) | — | — | — |
| Unauthenticated | Unchanged: `requireUser` → "Authentication required" | Unchanged | Sign in | — |

Order matters: authorisation runs **before** the action's own
`generation_jobs` insert, so a refusal leaves no tracking row either.

## 5. Establish the User-Facing Contract

- **Inputs:** unchanged for every action.
- **Outputs:**
  - `generateStoryIdeasAction` becomes `returnRefusals`-wrapped:
    `ActionResult<{ success: true; queued?: boolean; data?: … }>`. Its one
    client caller (`ideation-screen.tsx:116`) reads it through `unwrap`, so a
    refusal arrives as an `ActionRefusal` in the existing catch. **Decision 4**
    covers the other actions.
  - Batch actions: unchanged shape; refusals appear in `failed[]`.
  - `translateDialogueToLanguageAction`: unchanged shape; refusal returned in
    its existing `error` field with `success: false`.
  - Actions already `returnRefusals`-wrapped (refine story/screenplay,
    season outline): unchanged shape; refusal as value.
- **Messages:** "Episode not found", "Project not found", "Episode is not in
  this project". The same text for "does not exist" and "not yours", so a
  refusal does not confirm that an id exists (as `assertProjectAccess` does).
- **Loading / empty / success states:** unchanged.
- **Permissions:** generation on a target requires membership of the target's
  account (§19). Read access through public sharing no longer suffices.
- **Visibility rules / editable data:** unchanged.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Trigger → processing → result | Verification |
|---|---|---|---|
| FR-1 | A producer refuses a target whose account the caller is not a member of, before any write or queue message | Generate → resolve target via user client → `has_account_access` → refuse | Unit (red first), Playwright two-user |
| FR-2 | Membership, not readability, authorises: a public/unlisted target is refused to a non-member | as FR-1 with a public project | Unit case; two-user harness (§8.4 probe 6) |
| FR-3 | `queueLlmJob` cannot be called without an authorised target (compile-time) | Type: `target: LlmJobTarget`, constructible only by the authoriser | `pnpm typecheck`; mutation guard |
| FR-4 | A job's `accountId` is the target's account | Set by `queueLlmJob` from the target, overriding any payload value | Unit |
| FR-5 | A job's `episodeId`/`projectId` in the payload must equal the target's; mismatch throws before sending | Guard inside `queueLlmJob` | Unit; covers `batchCreateAssetsAction` |
| FR-6 | Batch producers authorise every id; denied ids join `failed[]`, allowed ones proceed | per-id | Unit |
| FR-7 | Refusals reach the user as written in a production build (KB-6) for the ideation action | `returnRefusals` + `unwrap` | Playwright on `test:prod` build |
| FR-8 | Worker usage attribution uses `payload.accountId` in `analytics-insights`, `language-insights`, `fact-extraction` (today they pass `projectId` as the account, which the FK then drops) | one line each | Unit on the handler's `executeLLM` context (Decision 6) |
| FR-9 | Every `queueLlmJob` call site is listed with the read that authorises it | §8.3 table, kept in FILM-CC-04 | Review; `git grep -w queueLlmJob` count matches |

Edge cases: an episode with `project:projects(...)` null (orphaned) → refused
("Episode not found"); a personal account's owner (no membership row) →
allowed, because `has_account_access` covers primary owners
(`scope-access.ts:78-82` explains why `has_role_on_account` alone is wrong).

## 7. Define Non-Functional Requirements

- **Latency:** +1 PostgREST read (most producers already do this read) and
  +1 RPC per distinct account per action. Budget ≤ 20 ms p50 locally; batch
  actions resolve all ids in one `.in()` read and one RPC per distinct
  account (normally 1).
- **Security / tenant isolation:** FR-1–FR-5. No elevated client in the
  authorisation path.
- **Reliability:** an RPC error is not a refusal (§4) — fail closed without
  misreporting.
- **Row cap:** batch `.in()` reads are bounded by the batch size the UI sends
  (one season's episodes). Use `fetchAllByIds` for the batch read so a large
  batch neither truncates at 1000 nor hits the URI limit.
- **Observability:** each refusal logs `{ name, userId, targetKind, targetId }` at `warn` (§22).
- **Compatibility:** no schema, queue-message or worker contract change,
  except `accountId` becoming reliably correct (§24).
- **Accessibility / i18n:** the refusal text uses the existing toast/error
  surfaces; no new UI.
- **Cost:** none added; reduces unauthorised LLM spend.
- Not applicable: throughput, DR, durability (no stored state added).

## 8. Analyze the Existing System

### 8.1 Components

- **Producers**: server actions in `@kit/episodes`, `@kit/audio-generation`,
  `@kit/content-analytics`, one route (`apps/web/app/api/research/upload/route.ts`),
  and one worker handler that chains a job.
- **`queueLlmJob`** (`packages/features/prompt-engine/src/lib/server/sqs-helper.ts:72-108`):
  sends `{ jobType, userId, payload }` to SQS. `payload` is
  `Record<string, unknown>`; nothing checks it.
- **LLM worker** (`apps/web/lambda/llm-worker/index.ts`): one Supabase client
  on the **service-role key** (`:71`), shared by every handler (`:164-267`);
  results go to `job.userId` over WebSocket (`:291`).
- **Handlers** read and write by the payload's ids with that client.
- **RLS**: `projects` and `episodes` each have a public-sharing SELECT policy,
  `TO anon, authenticated`, alongside the membership policy
  (`apps/web/supabase/migrations/20260108120000_public_sharing_rls.sql:28-55`).
  Live `pg_policies` confirms both on the reset database (§8.4).
- **`has_account_access(p_account_id)`**: owner or role; used by the analytics
  guard `assertProjectAccess` (`content-analytics/src/server/scope-access.ts:85-128`).

### 8.2 The defect, and the class

`generateStoryIdeasAction` (`packages/features/episodes/src/server/story-actions.ts:47-118`)
authenticates and queues `data.episodeId` as given. It never reads the
episode, so RLS is never asked. It takes `accountId` from the caller's
*first* `accounts_memberships` row (`:74-95`). The worker builds the full
context with the service-role client —
`processStoryIdeation` → `buildEpisodeContext(data.episodeId, supabase)`
(`apps/web/lambda/llm-worker/handlers/story-ideation.ts:65`) — and the ideas
go back to the caller.

Two broader shapes sit around it, both found while listing the call sites:

- **No read at all** — the ideation instance, its batch twin, dialogue
  translation (reads, never refuses), roadmap analysis, analytics insights.
- **"Readable" taken for "mine"** — thirteen producers read the target through
  the user's client and proceed if a row comes back. Because of the
  public-sharing policies, a row comes back for **any signed-in user** when the
  project or episode is public or unlisted. Those workers then **write** to
  the target with the service role: overwrite `story_data`
  (`story-generation.ts:464`), delete and replace `dialogue_lines`
  (`screenplay-conversion.ts:470-483`), delete shots and audio cues and insert
  new shots (`shot-generation.ts:375-412`), insert audio cues, insert
  `verified_facts` (`fact-extraction.ts:85-97`), upsert assets
  (`asset-creation.ts:241`). Reproduced for story generation (§8.4 probe 6).
- **A second id taken from the caller** — `batchCreateAssetsAction` reads the
  episode through RLS but queues `projectId: data.projectId`
  (`bulk-actions.ts:607`); the worker reads that project's assets
  (`asset-creation.ts:156`) and upserts new ones into it (`:228`, `:241`). Any
  user can add assets to any project whose id they have, public or not.

### 8.3 Every `queueLlmJob` call site, with the read that authorises it today

`git grep -w queueLlmJob` finds **24 call sites** (the ticket's "52" counted
every line containing the word, including the dynamic imports). Verdict key:
**R** = reproduced on 2026-09-23; **C** = read in code, same shape as a
reproduced one, not separately run.

| # | Call site | Job | Authorising read today | Worker reads / writes by payload id | Verdict |
|---|---|---|---|---|---|
| 1 | `episodes/src/server/story-actions.ts:100` `generateStoryIdeasAction` | story-ideation | **none**; account = caller's first membership | reads episode, season, characters, locations, facts, project metadata | **Leak (R)** |
| 2 | `story-actions.ts:243` `generateFullStoryAction` | story-generation | RLS read of episode (`:162-173`) | **writes** `story_data`, assets | **Public-read write (R)** |
| 3 | `lib/server/mutations/refinement-actions.ts:100` `refineStoryAction` | story-refinement | RLS read of episode (`:52-57`); `projectId` from caller (`:104`, unused by worker) | reads context, **writes** `story_data` | Public-read write (C) |
| 4 | `refinement-actions.ts:195` `refineScreenplayAction` | screenplay-refinement | RLS read (`:145-151`) | **replaces** `dialogue_lines` | Public-read write (C) |
| 5 | `lib/server/mutations/season-generation-actions.ts:81` `analyzeSeasonRoadmapAction` | season-analysis | **none** | reads no rows | No data exposure; unauthorised spend; no attribution |
| 6 | `lib/server/mutations/shot-list-actions.ts:116` `generateShotListAction` | shot-generation | RLS read (`:52-58`) | **deletes** shots/audio cues/tracks, inserts shots, chains #24 | Public-read write (C) |
| 7 | `episodes/src/server/actions.ts:399` `createEpisodeAction` (auto story) | story-generation | episode just inserted through the user's client (insert RLS is membership-only) | writes `story_data` | Safe by construction; moved to the helper for uniformity |
| 8 | `server/batch-episode-actions.ts:79` `generateSeasonOutlineAction` | season-outline | RLS read of project (`:63-67`) | reads project's assets and facts into the prompt, returns outlines to caller | Public-read leak (C) |
| 9 | `batch-episode-actions.ts:310` `regenerateEpisodeOutlineAction` | season-outline | RLS read of project (`:296-300`) | as #8 | Public-read leak (C) |
| 10 | `server/bulk-actions.ts:110` `batchGenerateIdeasAction` | story-ideation | **none**; first membership | as #1 | **Leak (R)** |
| 11 | `bulk-actions.ts:220` `batchGenerateStoriesAction` | story-generation | RLS `.in()` read | as #2 | Public-read write (C) |
| 12 | `bulk-actions.ts:352` `batchConvertScreenplaysAction` | screenplay-conversion | RLS `.in()` read | replaces `dialogue_lines` | Public-read write (C) |
| 13 | `bulk-actions.ts:472` `batchGenerateShotsAction` | shot-generation | RLS `.in()` read | as #6 | Public-read write (C) |
| 14 | `bulk-actions.ts:602` `batchCreateAssetsAction` | asset-creation | RLS read of episode; **`projectId` from caller** (`:607`) | reads that project's assets, **upserts assets into it** | **Cross-tenant write, any project (R at the queue)** |
| 15 | `server/screenplay-actions.ts:247` `convertToScreenplayAction` | screenplay-conversion | RLS read (`:173-184`) | replaces `dialogue_lines` | Public-read write (C) |
| 16 | `server/source-upload-actions.ts:258` `extractFactsFromContentAction` | fact-extraction | RLS read of project (`:236-246`) | **inserts** `verified_facts` | Public-read write (C) |
| 17 | `apps/web/app/api/research/upload/route.ts:119` | fact-extraction | RLS read of project (`:53-63`) | as #16 | Public-read write (C) |
| 18 | `lib/server/mutations/publish-actions.ts:160` `batchTranslateMetadataAction` | batch-translate-metadata | none needed: payload is the caller's own text; worker reads no rows | — | No tenant target |
| 19 | `audio-generation/src/server/audio-cue-actions.ts:277` `generateAudioForCueAction` | audio-file-generation | RLS read of cue; `audio_cues` SELECT is `has_role_on_account` only (no public branch) | reads project's ElevenLabs key by derived `projectId` | Safe today; moved to helper |
| 20 | `audio-cue-actions.ts:492` `generateAudioCuesAction` | audio-cue-generation | RLS read of episode (`:429-434`) | inserts `audio_cues` | Public-read write (C) |
| 21 | `audio-generation/src/server/translate-dialogue-action.ts:96` | translate-dialogue | reads episode, **never refuses** (`:73-79`); account `'unknown'` | reads `dialogue_lines`, **inserts** translated lines | Leak + write (C) |
| 22 | `content-analytics/src/server/insights-actions.ts:130` `generateInsightsAction` | analytics-insights | **none**; payload data is the caller's own | reads no rows; usage account = `projectId` (`analytics-insights.ts:132`) | No exposure; usage dropped by FK |
| 23 | `content-analytics/src/server/language-insights-actions.ts:117` | language-insights | `assertScopeAccess` inside the reads (`language-analytics.ts:144`) → empty → returns before queueing | usage account = `projectId` (`language-insights.ts:93`) | Safe; usage dropped by FK |
| 24 | `apps/web/lambda/llm-worker/handlers/shot-generation.ts:494` | audio-cue-generation (chained) | ids from a job whose producer was authorised | inserts `audio_cues` | Safe iff its producer is |

**This PR fixes all 24** (Decision 1): every producer goes through the
authoriser; #24 uses an explicitly named chained constructor (§15).

### 8.4 Reproduction (before the fix)

Run 2026-09-23 under the DB lock, after `supabase db reset` from this branch.
Two real users created through the auth admin API and signed in with
passwords; **user A** owns a documentary project with a season, a character,
a location, an episode tagged with both, and a verified fact linked to the
episode, each carrying a unique canary string. **User B** has only their own
personal account. The real action modules ran in Vitest with
`getSupabaseServerClient` returning **B's signed-in client** (so RLS applied
as B), `requireUser` real, and only `enhanceAction` (reduced to schema
parsing), `queueLlmJob` and `runAgent` captured instead of sent. The real
worker handler then ran with a **service-role** client, as in production.
Harness: `$SP/kb31-repro.local.test.ts` (not committed); log:
`$SP/kb31-repro-run.log`.

| # | Probe | Result on `main` |
|---|---|---|
| 1 | B reads A's episode directly through B's client | `null` — RLS holds on a direct read |
| 2 | B calls `generateStoryIdeasAction({ episodeId: <A's> })` | `{ success: true, queued: true }`; queued `payload.episodeId = <A's>`, `userId = B`, `accountId = B` |
| 3 | Real `processStoryIdeation(<that payload>, serviceRoleClient)`; prompt captured at `runAgent` | A's character ✔, location ✔, season premise ✔, verified fact ✔, genre ✔ all present in the prompt built for B; usage context `accountId = B` |
| 4 | B calls `batchGenerateIdeasAction` with A's episode | `{ queued: 1, failed: [] }`, payload names A's episode |
| 5 | B calls `batchCreateAssetsAction({ projectId: <A's project>, episodes: [<B's own episode>] })` | `{ queued: 1 }`; payload `projectId = <A's project>` |
| 6 | A sets the project `visibility = 'public'`; B reads the episode; B calls `has_account_access(A)`; B calls `generateFullStoryAction` on A's episode | read returns the row; `has_account_access` → **false**; action returns `{ success: true, queued: true }` with a `story-generation` job for A's episode, `accountId = A` |

Live policies on the reset database (`pg_policies`): `episodes` has
`episodes_read` (membership) **and** "Allow public read of
public/unlisted/inherit episodes"; `projects` has `projects_read` **and**
"Allow public read of public/unlisted projects". `seasons`, `assets`,
`shots`, `dialogue_lines`, `verified_facts` have membership policies only.

What this does not show: the SQS hop and the LLM call (no local queue —
phase 18 README, *Known limits*); probe 6's worker write was not executed
(it would call the LLM). The write is read from `story-generation.ts:464`.

### 8.5 Elevated-client prompt paths outside `queueLlmJob`

Searched every `getSupabaseServerAdminClient` / service-role use under
`packages/features`, `apps/web/app`, `apps/web/lambda`:

| Path | What it does | Verdict |
|---|---|---|
| `episodes/src/lib/server/services/context-aggregator.ts:312`, `episodes/src/server/external-context-actions.ts:246,291,329`, `source-upload-actions.ts:66` | Global `external_sources` / `external_content` cache writes | Not tenant rows by caller id — **KB-26's area**, not touched |
| `embeddings/src/voyage-client.ts:108,172,230` | Episode embeddings, called by the worker for an already-chosen episode | Safe iff the job was authorised |
| `prompt-engine/src/lib/server/llm-executor.ts:660,731` | Usage logging | Not a read by caller id |
| `shorts/src/server/generate-short-action.ts:107` | Reads the shot through the user's client (`shots_read`, no public branch) | Safe |
| `audio-generation/src/server/voice-actions.ts:107` (`generateDialogueVoice`) | Reads the line through the user's client (`dialogue_lines_read`, no public branch) | Safe |
| `audio-generation/src/server/voice-actions.ts:627` (`generateVoiceFromTextAction`) | Reads the **episode** through the user's client (public branch applies), then fetches **that account's ElevenLabs key** and budget | **Same "readable ≠ mine" class** (C): a non-member can spend a public episode owner's ElevenLabs credit. Not an LLM job — Decision 7 |

Other queues (voice, publish, render: `voice-queue-helper.ts:90`,
`publishing/src/server/publish-actions.ts:960,1039`,
`edit-suite/src/server/render-actions.ts:146,226`) were not surveyed; the same
worker-trusts-payload shape probably applies. Decision 7.

Adjacent findings, not this ticket: `audio_cues_select_policy` uses
`has_role_on_account` only, so a personal account's owner cannot read their
own cues; `episode_facts` policies use `accounts_memberships` only, so a
personal owner cannot link facts (the reproduction had to seed that row with
the service role). Both are **KB-18-adjacent**; reported, not fixed here.

## 9. Define the Desired System Behavior

| User action | Application logic | Service interaction | Data operation | Response | User-visible |
|---|---|---|---|---|---|
| Generate (single target) | action → `authorizeEpisodeTarget` / `authorizeProjectTarget` | PostgREST as user; RPC `has_account_access` as user | read 1 row | `LlmJobTarget` or `ActionRefusal` | proceeds / refusal text |
| Generate (batch) | `authorizeEpisodeTargets(ids)` | one paged read, one RPC per distinct account | read ≤ n rows | `Map<id, target>` + denied ids | per-episode results |
| Queue | `queueLlmJob({ jobType, userId, target, payload })` | SQS | — | message with `accountId`/`projectId`/`episodeId` from the target | unchanged |
| Worker | unchanged, except FR-8 attribution | — | — | — | unchanged |

## 10. High-Level Architecture

No new components. One boundary is moved: **the trust boundary for LLM job
ids moves from "the worker trusts whatever the producer sent" to "the only
way to produce a message is through an object that proves membership"**.

- **`@kit/supabase/account-access`** (new export, server-only): the single
  membership rule — `assertAccountAccess(client, accountId)`,
  `assertProjectAccess(client, projectId) → accountId`, using
  `has_account_access`. Moved from `content-analytics/src/server/scope-access.ts`
  (Decision 3), which re-imports it. Why `@kit/supabase`: every producer
  package and `@kit/content-analytics` already depend on it; `@kit/prompt-engine`
  does too.
- **`@kit/prompt-engine/server` — `llm-job-target.ts`** (new): the target
  type and the authorisers for episodes and projects, built on the above.
- **`queueLlmJob`**: requires a `target`; stamps and cross-checks ids.
- **Worker**: unchanged trust model (Decision 5), three attribution lines
  (Decision 6).

Why at the producer and not the worker: the acceptance criterion is that the
**action** refuses and queues nothing; only the producer holds the user's
session, so only it can ask RLS and `has_account_access` *as the user*.

## 11. Architecture and Flow Diagrams

**Before**

```
Browser(B) ──action(episodeId=A's)──▶ generateStoryIdeasAction
                                        │ requireUser ✔   (no read of the episode)
                                        ▼
                                     queueLlmJob ──SQS──▶ llm-worker (service role)
                                                            │ buildEpisodeContext(A's episode)
                                                            │   episodes, seasons, assets, facts  ← RLS bypassed
                                                            ▼
                                     WebSocket ◀──ideas from A's canon── sendToUser(B)
```

**After**

```
Browser(B) ──action(episodeId=X)──▶ action
                                     │ requireUser ✔
                                     │ authorizeEpisodeTarget(userClient, X)
                                     │   ├─ select episodes(id, project_id, projects(account_id))  [RLS as B]
                                     │   └─ rpc has_account_access(account_id)                    [as B]
                                     │        ├─ no row / false ──▶ ActionRefusal("Episode not found") ──▶ B
                                     │        └─ true ──▶ LlmJobTarget{accountId, projectId, episodeId}
                                     ▼
                                  queueLlmJob({target, payload})
                                     │ payload.episodeId/projectId must equal target's, else throw
                                     │ payload.accountId := target.accountId
                                     ▼
                                    SQS ──▶ llm-worker (unchanged)
```

**Chained job (worker → worker)**

```
shot-generation handler ──chainedLlmJobTarget(payload of the authorised job)──▶ queueLlmJob(audio-cue-generation)
```

## 12. End-to-End Data Flow

**Source:** the caller's form input (ids). **Validation:** Zod `uuid()` (existing)
→ **authorisation** (new) → **transformation:** the target's `accountId`,
`projectId`, `episodeId` replace or confirm the payload's →
**persistence:** none by this layer; the SQS message → **consumer:** the worker
handler → **output:** WebSocket to `userId`.

Points of possible loss or corruption and how they are handled:

- **Stale target** (row deleted between authorise and worker run): unchanged
  from today — the handler's own read fails and it reports `llm-error`.
- **Membership revoked after queueing:** a queued job still runs (seconds to
  minutes). Accepted; Decision 5's worker-side check is what would close it.
- **Batch truncation:** the batch read uses `fetchAllByIds` (ordered by `id`),
  so no id is silently dropped and misreported as "not found".
- **Duplication / ordering:** unchanged.

## 13. Data Model

No entities, attributes or relationships change.

Authoritative sources used by the new check:

| Datum | Authority |
|---|---|
| Which account owns an episode | `episodes.project_id → projects.account_id` |
| Whether a user is a member | `public.has_account_access(account_id)` evaluated as that user |
| Which account a job's usage belongs to | the target's `account_id` (derived, never caller-supplied) |

Invariant introduced (held in the type system, not a comment): **every
`queueLlmJob` message carries `accountId` equal to its target's owning
account, and a producer could only build that target after the caller was
shown to be a member.**

## 14. Database Design and Changes

**None.** No migration, no policy change, no typegen. The public-sharing
SELECT policies stay: public pages need them. The fix stops treating them as
authorisation. No pgTAP is added because no policy changes; the RPC it relies
on is exercised by the FILM-1615 guards already.

## 15. Low-Level Design

### 15.1 `@kit/supabase/account-access` (moved, one rule)

```ts
// packages/supabase/src/account-access.ts  — 'server-only'
export async function hasAccountAccess(client, accountId): Promise<boolean>   // rpc; throws on RPC error
export async function assertAccountAccess(client, accountId): Promise<string> // throws AccessDenied
export async function assertProjectAccess(client, projectId): Promise<string> // → account_id
```

`content-analytics/src/server/scope-access.ts` keeps `assertScopeAccess` and
imports these; its existing tests and the FILM-1615 mutation guards S0/S0b
are retargeted to the new file (same `find`/`replace` strings).
The thrown type stays a plain `Error` there, as today, so analytics
behaviour is unchanged; the LLM authoriser converts to `ActionRefusal`.

### 15.2 `llm-job-target.ts`

```ts
declare const authorised: unique symbol;
export interface LlmJobTarget {
  readonly accountId: string;
  readonly projectId?: string;
  readonly episodeId?: string;
  readonly [authorised]: true;          // not constructible outside this module
}

authorizeEpisodeTarget(client, episodeId): Promise<LlmJobTarget>
  row ← episodes.select('id, project_id, project:projects(account_id)')
                .eq('id', episodeId).is('deleted_at', null).maybeSingle()   // as the user
  if !row?.project?.account_id → ActionRefusal('Episode not found')
  if !(await hasAccountAccess(client, account_id)) → ActionRefusal('Episode not found')
  return { accountId, projectId: row.project_id, episodeId }

authorizeEpisodeTargets(client, ids): Promise<{ allowed: Map<id, LlmJobTarget>; denied: string[] }>
  rows ← fetchAllByIds(ids, …same select…, ordered by id)
  accounts ← distinct account_ids → hasAccountAccess each (normally one)
  allowed/denied by row presence and account access

authorizeProjectTarget(client, projectId): Promise<LlmJobTarget>
  accountId ← assertProjectAccess (converted to ActionRefusal('Project not found'))
  return { accountId, projectId }

noTenantLlmJobTarget(): LlmJobTarget        // batch-translate-metadata only: reads no rows
  → { accountId: <caller's own personal account id = user.id> }
chainedLlmJobTarget(payload of a job the worker is processing): LlmJobTarget
  // used only by a worker handler re-queueing work for the same target;
  // its ids came from a producer that was authorised.
```

`noTenantLlmJobTarget` and `chainedLlmJobTarget` are the two escape hatches.
Both are named for what they assert, and a grep for them is the audit list.

### 15.3 `queueLlmJob`

```ts
queueLlmJob({ jobType, userId, target, payload })
  for key in ['episodeId','projectId'] if payload[key] !== undefined && target[key] && payload[key] !== target[key]
     throw new Error(`queueLlmJob: payload.${key} is not the authorised target`)   // programmer error, not a refusal
  body.payload = { ...payload, accountId: target.accountId,
                   ...(target.projectId && { projectId: target.projectId }),
                   ...(target.episodeId && { episodeId: target.episodeId }) }
```

### 15.4 Producers

Each of the 24 call sites (§8.3) replaces its ad-hoc read with the
authoriser and passes `target`. Where the action already needs more columns
(`status`, `version`, `story_data`, `screenplay_data`), it keeps its own read
for those — authorisation is the authoriser's job, validation stays the
action's. Specific changes:

- #1, #10 drop the first-membership lookup (`story-actions.ts:74-95`,
  `bulk-actions.ts:86-101`) entirely.
- #14 authorises each episode, refuses when `target.projectId !== data.projectId`.
- #21 refuses in its existing `{ success: false, error }` shape.
- #22, #23 authorise the project (attribution), #23 keeps its analytics guard.
- #24 `chainedLlmJobTarget`.
- `apps/web/lambda/llm-worker/LLM-ACTIONS-GUIDE.md:119-135` example updated.

### 15.5 Refusal delivery

`ActionRefusal` from `@kit/next/actions`. Per Decision 4:
`generateStoryIdeasAction` wrapped with `returnRefusals`, caller uses `unwrap`;
batch → `failed[]`; actions with an error field → that field; already-wrapped
→ value; the rest throw `ActionRefusal` where they throw
`Error('Episode not found')` today.

### 15.6 Worker attribution (Decision 6)

`analytics-insights.ts:132`, `language-insights.ts:93`, `fact-extraction.ts:61`:
`accountId: data.projectId` → `accountId: data.accountId`.

No transactions, locks, retries, caches or flags are introduced.

## 16. API and Event Design

**Server actions:** inputs unchanged. Output changes listed in §5. Auth:
unchanged (`requireUser`). **Authorisation: new — membership of the target's
account.** Errors: `ActionRefusal` messages in §5.

**SQS message `llm-jobs` (producer → llm-worker):**

| Field | Before | After |
|---|---|---|
| `jobType`, `userId` | unchanged | unchanged |
| `payload.accountId` | caller's first membership (#1, #10), `'unknown'` (#6, #13, #14, #19, #20, #21), absent (#3–5, #16–18, #22–24) or the target's | **always the target's account** |
| `payload.projectId`, `payload.episodeId` | as sent by the caller | **the authorised target's** (mismatch throws before send) |

Delivery semantics, retries, DLQ, ordering: unchanged. Version evolution: the
worker ignores unknown fields and already reads `accountId`; adding it where
it was missing is backward compatible, and a worker older than this PR
receives exactly the shape it reads today.

## 17. State and Lifecycle Design

No lifecycle changes. `episodes.status` transitions and `generation_jobs`
states are untouched; a refusal occurs before either is read for
transition or written.

## 18. Failure and Error Handling

| Failure | Behaviour | User sees | Recovery |
|---|---|---|---|
| Target not visible | `ActionRefusal` | "Episode not found" / "Project not found" | — |
| Visible but not a member | `ActionRefusal`, same text | same | — |
| `has_account_access` RPC error | thrown `Error` (not a refusal) | existing generic failure | retry |
| Payload id ≠ target id | thrown `Error` in `queueLlmJob` | generic failure; logged as a bug | fix the producer (a test covers every producer) |
| Batch partly denied | denied → `failed[]` | per-episode failure | — |
| Queue send fails | unchanged | unchanged | unchanged |

## 19. Security

- **Authentication:** unchanged (`requireUser`).
- **Authorisation:** membership (`has_account_access`) of the target's account,
  evaluated **as the user**, never with the service role.
- **Trust boundary:** producers are the only code with the user's session;
  the worker keeps trusting its queue (only the app can send to it — SST
  linking). Decision 5 records the defence-in-depth option.
- **Tenant isolation:** closes: cross-tenant canon read into prompts (#1, #10,
  #8–9, #21); cross-tenant writes via public/unlisted sharing (#2–4, #6,
  #11–13, #15–17, #20); cross-tenant asset writes into any project (#14);
  usage attributed to the wrong account (#1, #10, #22–23 and the handlers).
- **Enumeration:** identical refusal text for missing and foreign ids.
- **Least privilege:** no new elevated client; the authorisation path uses
  only the user's client.
- **Abuse / rate limit:** unchanged `checkRateLimit`; refused requests cost
  one read and one RPC.
- **Audit logging:** refusals logged at `warn` with ids only (no user text).
- **Secrets:** none touched. No production credentials or config are used
  or needed.

**What this fix newly permits** (workflow question 3): nothing a member could
not do before. It newly *forbids* one thing that may have been relied on:
generating on a public/unlisted project you do not belong to. No product
flow does that (all generate controls live under `/home/<account>/studio`,
which requires membership to render), so nothing legitimate is lost.

## 20. Performance and Scale

Expected traffic: generation clicks, human-paced (the rate limits are
30–120/min per user). Per request: ≤ 1 extra read (most producers already
read the same row) and 1 RPC; batch actions: 1 paged read + 1 RPC per
distinct account. `has_account_access` is a `SECURITY DEFINER` lookup on
indexed membership columns. No measurable change to LLM latency (seconds to
minutes) is possible from this.

## 21. Accessibility and Client Behavior

No new UI. The ideation refusal appears through the existing `triggerLlm`
error path (the same toast used for any failed generation), so focus,
keyboard and screen-reader behaviour are those of the existing error toast.
The only client edit is `ideation-screen.tsx:116` reading the result through
`unwrap`.

## 22. Observability and Operations

- **Log:** `warn` `{ name: 'llm-job.refused', userId, targetKind, targetId, jobType }`
  on every refusal; `error` on an RPC failure or an id mismatch.
- **How an operator knows it works:** refusals appear only for forged or
  stale ids — a steady non-zero rate from one user is abuse; a spike across
  many users after a deploy is a regression (a member being refused).
- **Usage attribution check:** `llm_usage_analytics.account_id` stops being
  null for insights and fact-extraction jobs (today the `projectId` fails the
  FK and the row is dropped, logged as "[LLM Analytics] Failed to log usage").
- No metrics, dashboards or alerts are added (none exist for this surface).

## 23. Configuration and Feature Flags

None. The fix is unconditional: a flag would leave a cross-tenant hole
switchable. Absent config changes nothing here.

## 24. Compatibility

- **Clients:** one caller changes with its action (#1). Batch and other
  actions keep their shapes (Decision 4 default).
- **Queue messages:** additive and corrective (§16); worker handlers read the
  same fields. Deploy order does not matter: an old worker reads new messages
  unchanged; a new worker (FR-8) given an old message whose `accountId` is
  missing logs usage with `account_id = null`, as those three handlers
  effectively do today.
- **Content-analytics:** `assertProjectAccess` moves module but keeps its
  behaviour and message.
- **Existing records:** untouched.

## 25. Migration and Rollout Strategy

No schema or infra change. Ships with the app deploy; the worker change
(FR-8) ships with the Lambda deploy — either order is safe (§24). Validation
gates: unit + mutation guards (CI), Playwright on the production build (CI
E2E job). Rollback: revert the PR; no data to restore.

## 26. Testing Strategy

| Layer | Test | Proves | Red before green |
|---|---|---|---|
| Unit — `@kit/prompt-engine` (in CI) | `__tests__/llm-job-target.test.ts` | no row → refusal; row + `has_account_access=false` → refusal with the **same** text; member → target with the row's account; RPC error → thrown, not a refusal; `queueLlmJob` stamps `accountId`, rejects payload/target id mismatch | Remove the `hasAccountAccess` call → the public-project case goes green-to-red |
| Unit — `@kit/supabase` (in CI) | `__tests__/account-access.test.ts` (moved from content-analytics' scope-access cases) | owner/role/none | existing FILM-1615 guards retargeted |
| Unit — `@kit/episodes` (in CI) | `__tests__/llm-job-authorization.test.ts` | **Acceptance 1**: `generateStoryIdeasAction` refuses an unreadable episode and a readable-but-foreign one, and `queueLlmJob` is not called; member → queued with the **episode's** account (Acceptance 3) even when the caller's first membership is another account; `batchGenerateIdeasAction` splits allowed/denied; `batchCreateAssetsAction` refuses a foreign `projectId`; one case per remaining episodes producer asserting it calls the authoriser before queueing | Written and run against `main` first: must fail (queued) |
| Unit — `@kit/audio-generation` | `translate-dialogue-action.test.ts`, `audio-cue-actions.test.ts` | #19–21 refuse | red on `main`. **`@kit/audio-generation` is not in `scripts/test-units.sh`** — this PR adds it (after confirming its existing tests pass) |
| Unit — `@kit/content-analytics` (in CI) | extend `insights-actions` / `language-insights-actions` tests | project authorised, `accountId` is the project's account | red on `main` |
| Unit — worker handlers | `analytics-insights`, `language-insights`, `fact-extraction` pass `data.accountId` | FR-8 | red on `main` (they pass `projectId`) — where they run is checked against KB-14's typecheck work first |
| Mutation guards (CI) | `tooling/mutation-guards/kb-31.json` | removing the membership call, restoring the first-membership lookup, or dropping the id cross-check each makes its test fail | the runner itself proves it |
| Two-user, real DB (local, evidence) | the §8.4 harness re-run after the fix | probes 2, 4, 5, 6 now refuse and queue nothing; probe 3 cannot be reached | the before-run in §8.4 is the red |
| E2E — Playwright, production build (CI) | `apps/e2e/tests/studio/llm-job-tenant-isolation.spec.ts`: seed A (project, season, episode) and B (own project and episode) through the API; sign in as B; open B's own ideation page; rewrite the server-action request's `episodeId` to A's; assert the page shows **"Episode not found"**; repeat with A's project public; assert no `generation_jobs` row for A's episode (service-role read) | Refusal reaches the user as written in a prod build (FR-7) and holds for public projects (FR-2) | On `main` the same spec fails: the action gets past the (absent) check and dies on "LLM_JOBS_QUEUE_URL not configured", which the prod build replaces with a generic sentence |

Every producer in §8.3 has at least one unit case; the E2E covers the
ticket's own path end to end. No pgTAP (no policy change).

## 27. Production-Build Verification

`pnpm --filter web-e2e test:prod` (the three steps CI's E2E job runs:
`next build` → `start:test` → `playwright test`) with the new spec, so the
refusal text is observed through the production bundle, where thrown
messages are replaced (KB-6). Evidence in the PR: the spec's run output and
a screenshot of the refusal state on the ideation page, plus the §8.4
harness output after the fix as a before/after table. The SQS hop and the
worker's LLM call remain unverifiable locally (phase 18 *Known limits*); the
harness runs the real worker handler with those two captured.

## 28. Requirement Traceability

| User outcome | User flow | Requirement | Design | Component | Data/API | Test | Production verification |
|---|---|---|---|---|---|---|---|
| My canon is used only for my account's requests | §2 row 2′ | FR-1, FR-2 | §15.2 | `llm-job-target.ts`, `account-access.ts` | `has_account_access` RPC | prompt-engine + episodes unit; two-user harness | E2E on `test:prod` |
| No one can write into my episodes/projects via a job | §4 rows 1–2, 5 | FR-1, FR-2, FR-5, FR-6 | §15.3, §15.4 | every producer | SQS payload ids | per-producer unit; mutation guards | E2E (public case) |
| Guard cannot be skipped by a new producer | — | FR-3 | §15.2 branded type | `queueLlmJob` | — | `pnpm typecheck`; guard | CI typecheck |
| Usage billed to the right account | §3 step 7 | FR-4, FR-8 | §15.3, §15.6 | `queueLlmJob`, 3 handlers | `llm_usage_analytics.account_id` | unit | Operator check in §22 |
| Refusal readable in production | §2 row 2′ | FR-7 | §15.5 | `generateStoryIdeasAction`, `ideation-screen.tsx` | `ActionResult` | unit | E2E on `test:prod` + screenshot |
| Every call site accounted for | — | FR-9 | §8.3 | FILM-CC-04 KB-31 entry | — | count check in review | — |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Chosen because |
|---|---|---|
| Authorise at the producer | (a) worker checks `userId` membership before dispatch; (b) both | Only the producer can return a refusal to the user (acceptance 1) and ask as the user. (a) alone would still queue, spend, and report asynchronously. (b) is Decision 5 — defence in depth, deferred for KB-14 overlap. |
| Membership via `has_account_access` | RLS read only (the ticket's first proposal) | Reproduced wrong: probe 6 — a public project's episode is readable by every signed-in user. `has_role_on_account` alone would lock out personal-account owners. |
| Type-enforced target in `queueLlmJob` | per-call-site checks with no type change | 24 sites, 4 packages, and new producers arrive often; a check that can be forgotten will be (the ticket is that instance). Cost: every call site touched once. |
| One rule in `@kit/supabase` | keep content-analytics' copy and write a second | CLAUDE.md "fix the class": the same rule in two places diverges. Cost: moving FILM-1615 code and retargeting two guards. |
| Refuse with one message for missing and foreign | distinct messages | Distinct messages confirm existence of another tenant's id. |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| A legitimate flow is refused (e.g. a role not covered by `has_account_access`) | Members cannot generate | E2E positive control; unit "member" cases; refusal-rate log | Same function analytics has used since FILM-1615 | Revert; widen the rule |
| A producer's extra columns read moved/dropped | action misvalidates status/version | per-producer unit | keep each action's own validation read | fix forward |
| Touching 24 call sites collides with parallel tickets | merge conflicts | Overlap warnings; rebase before PR | small, mechanical diffs per site | resolve on rebase |
| Ideation client breaks on the new result shape | ideation unusable | E2E drives the page; typecheck | `unwrap` in the one caller | revert that file |
| Worker attribution change mis-types under KB-14's stricter lambda typecheck | red CI after KB-14 lands | CI | 3 lines; coordinate with KB-14 | rebase |
| Queued jobs still run after membership revoked | seconds-long window | — | accepted | Decision 5 |
| Playwright request rewrite is brittle across Next versions | flaky E2E | CI | rewrite by replacing the uuid string in the body, not by parsing the RSC format | fall back to calling the action id with B's cookies |

## 31. Open Questions and Assumptions

| Question | Why it matters | Assumption | Needed | Decision |
|---|---|---|---|---|
| Is generating on another account's public project ever intended? | FR-2 forbids it | No — every generate control is under `/home/<account>/studio` | Owner confirmation | Decision 2 |
| Should all newly-refusing actions return refusals as values? | KB-6 rule vs UI diff size | Only ideation (the ticket's path) changes shape; others keep today's throw site | Owner | Decision 4 |
| Does the ideation page route work for a personal account's project in E2E seeding? | E2E design | Seed B's project under a team account if not | Check at implementation | — |
| Is `@kit/audio-generation`'s suite green today? | Adding it to CI | Yes; verify before adding | Run it | — |
| Does KB-14 change the worker files this touches? | Merge order | Small, rebaseable | Coordinate via lead | Overlap warning |

## 32. Implementation Plan

1. **Surface first.** Run `@kit/audio-generation` tests; add it to
   `scripts/test-units.sh` if green (else report). Confirm the worker handler
   tests can run in an existing CI package (or place them under
   `apps/web` whose `test` CI runs).
2. **Red tests.** Write the episodes/prompt-engine/audio/analytics unit tests
   against `main`; watch each fail for the stated reason (queued / wrong
   account).
3. **Move the rule.** `@kit/supabase/account-access` + export; content-analytics
   imports it; retarget `film-1615.json` S0/S0b; its tests stay green.
4. **Authoriser + `queueLlmJob` type.** `llm-job-target.ts`; `queueLlmJob`
   requires `target`. Typecheck now fails at all 24 sites — the checklist.
5. **Producers**, package by package (episodes → audio → analytics → route →
   worker chain), each with its unit cases going green.
6. **Ideation refusal as value**: `returnRefusals` + `unwrap` in
   `ideation-screen.tsx`.
7. **Worker attribution** (3 lines) + tests.
8. **Mutation guards** `kb-31.json`.
9. **Two-user harness** re-run (DB lock) → after-table.
10. **E2E spec** on `test:prod` (DB lock + heavy slot) → screenshot.
11. `pnpm typecheck`, `lint:fix`, `format:fix`; FILM-CC-04 KB-31 entry marked
    Fixed with the §8.3 table, one row in *Fixed*; `LLM-ACTIONS-GUIDE.md`.

Rollback at any step: revert; no data implications.

## 33. Definition of Done

- [ ] All three KB-31 acceptance criteria met, each with a test seen red on `main`
- [ ] All 24 call sites authorise through the one helper; `git grep -w queueLlmJob` shows no call without `target:`; escape hatches limited to #18 and #24
- [ ] Public/unlisted targets refused to non-members (unit + E2E)
- [ ] `accountId` is the target's on every message (unit)
- [ ] Two-user harness: before/after table in the PR
- [ ] E2E spec green on the production build; red on `main`; screenshot attached
- [ ] Mutation guards pass; `pnpm typecheck`, lint, format clean
- [ ] FILM-CC-04 updated (entry + one *Fixed* row); new leads from §8.5 recorded per Decision 7

## 34. Final Consistency Pass

**Forward.** Problem: a signed-in user can have the worker read — and for
most job types write — another account's canon by naming its id. Outcome:
only members' requests touch an account's data, and usage is billed there.
User action: press Generate. Expectation: members unchanged; others refused
with "Episode not found". System: authorise the target as the user before
queueing (§15). Data: none changes; ids and `accountId` in messages become
the target's. Architecture: one membership rule, one authoriser, a typed
queue entry. Tests: red-first units per producer, mutation guards, two-user
harness, production-build E2E. Deploy: app and Lambda, any order. Verify:
§27.

**Reverse.** Production will: read one row and call `has_account_access` as
the user for each Generate; refuse or queue a message whose ids and account
are the target's; workers unchanged except three attribution fields. User
behaviour produced: members see no difference; non-members are refused
before anything is written or spent. That satisfies §2's flow and FR-1–FR-9,
which deliver §1's outcome.

The two directions meet. The one residual gap — a job queued before a
membership is revoked still runs — is recorded (§12, Decision 5), not hidden.
