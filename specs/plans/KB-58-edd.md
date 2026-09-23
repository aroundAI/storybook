# KB-58 — `'use server'` library modules register secret-returning functions as unauthenticated server actions

Engineering Design Document. Follows `specs/PLAN_TEMPLATE.md`, all 34 sections.

| | |
|---|---|
| Ticket | KB-58 (reserved in the team's KB list; no FILM-CC-04 entry yet — this PR adds it) |
| Severity | **High** (defence in depth). Not Critical: a live call was never made, by rule, and the IDs of the dangerous actions were found nowhere a browser can download (§19) |
| Related | KB-29 (#310, deletes four of the functions), KB-28 (#313, cover-image RPC), KB-31 (#315, prompt-engine), KB-52 (`llm_usage_analytics`), KB-43 (members can read encrypted tokens), KB-6 (`returnRefusals`) |
| Branch / base | `fix/kb-58-use-server-exports-r2` / **stacked on `fix/kb-29-refresh-global-credentials` (#310)**, which is `origin/main` @ `49b851d6` + KB-29 |
| Author / date | kb-58-r2 teammate (takes over from kb-58, whose worktree was removed), 2026-09-23 |
| Size | M: ~35 files touched, mostly one-line directive removals and moves; no migration; one form call site |

### Changes since approval (Phase 2)

- **Base is `origin/main`.** #310 merged, so this is no longer stacked.
- **Edit Suite excluded.** FILM-607 is retiring it, so `media-bin-queries.ts` and `getMediaBinDataAction` were dropped from the decision table. Both guards skip `packages/features/edit-suite/` through a named `RETIRING_PATHS` entry, to be removed when that directory is gone.
- **Barrels split (not foreseen in §15).** Client components import `@kit/audio-generation/server` and `@kit/publishing/server` to get actions. Once the moved functions stopped being `'use server'`, re-exporting their `server-only` modules from those barrels would bundle them for the browser.
  - Those barrels now hold actions only.
  - The publishing readers moved to a new `@kit/publishing/server/queries` subpath, used by three pages.
  - `voice-queries`, `project-audio-settings` and `audio-asset-library` left the audio barrel; every caller already imported them relatively.
- **`processScheduledPublishes` added to `NEVER_REGISTERED`**, because it runs the publish cron through the admin client.
- **Build figures.** The `build:test` before D6 registers 357 actions, and none of the 16 secret or admin-client names. Before/after for each name:

  | Name | Registered on main (49b851d6) | Registered on branch |
  |---|---|---|
  | `getApiKeyForProvider`, `executeLLM`, `loadAndRenderPrompt`, `logLLMUsage` | yes | no |
  | `encrypt`, `decrypt`, `isEncrypted` | yes | no |
  | `getGlobalOAuthCredentials`, `getAccountOAuthApp`, `getAccountOAuthAppAdmin`, `refreshTikTokToken` | yes | no (deleted by #310) |
  | `getAccessToken`, `validatePlatformToken` | yes | no |
  | `getAccountElevenLabsApiKey`, `getProjectElevenLabsApiKey` | yes | no |
  | `processScheduledPublishes` | yes | no |
  | total actions | 408 | 357 (the three `create-film-project` exports are still registered, pending D6) |

### What was measured (run, not inferred)

Everything here is static or build-based. **No action was called on a running server**, and no script that sends action POSTs was written. That was the lead's scope rule.

1. **Production build of `origin/main` code.** `pnpm build:test` (`NODE_ENV=test`, `VENDOR_SANDBOX=1`; build only, no `next start`) ran at 04:05–04:07Z in this worktree. The checkout was `49b851d6` plus one EDD stub commit, so the code was identical. The manifest was saved as `$SP/kb58/server-reference-manifest.main.json`, and it must never be committed because it contains the build's `encryptionKey`.
2. **Every `'use server'` module parsed with the TypeScript compiler API.** There are 121 files and 425 exports; each export is classified by its wrapper chain (`$SP/kb58/classify-r2.cjs` → `exports-r2.json`).
3. **The two joined** (`$SP/kb58/manifest-r2.cjs` → `manifest-rows-r2.json`). Every client chunk under `.next/static` and every prerendered `.html/.rsc/.body/.meta` was searched for each action ID.
4. **The proposed guard, prototyped** (`$SP/kb58/guard-proto.cjs`). It ran against `origin/main` and #310's source, the main manifest, and the source of every open PR head.

**Correction to the handed-over evidence.** Round 1's `manifest.cjs` matched `endsWith(file#name)` against manifest filenames. Those filenames are relative to `apps/web`, so every `apps/web/**` action read as unregistered: 0 of 14, including `getApiKeysAction`, which is certainly registered. The corrected join gives **55 plain functions registered, not 52**. The extra three are in `create-film-project.action.ts`, and two of their IDs are in client JS.

| Measured on `origin/main` build | Value |
|---|---|
| Actions in `server-reference-manifest.json` (`node` / `edge`) | 408 / 0 |
| Manifest entries not traceable to a `'use server'` export | 0 |
| Registered and **plain** (no wrapper at all) | **55** |
| Registered and not bottoming out in `enhanceAction` (the 55 + `getMediaBinDataAction`) | 56 |
| Plain exports of `'use server'` files not registered in this build | 15 (4 in `apps/dev-tool`, 11 in `packages/`) |
| Action IDs present in client JS | 224 of 408 |
| …of which plain | 3: `createFilmProject`, `updateProjectCoverImage`, `refreshAuthSession` |
| Action IDs present in prerendered output | 0 |
| Secret-returning or admin-client names registered | 15 (table in §27) |
| Inline `'use server'` directives inside function bodies | 0 |

---

## 1. Start With the User

**Who.** Four people are affected:
- The owner, who runs the platform and holds its vendor keys (OpenAI, Anthropic, Gemini, DeepSeek), its `ENCRYPTION_KEY`, and its OAuth app secrets.
- Every creator whose ElevenLabs key or platform tokens the platform stores, encrypted.
- Every creator using the studio.
- Implicitly, anyone who can send an HTTP POST to the site.

**The problem.** In Next.js, a file that begins with `'use server'` turns every exported async function into a **server action**, an HTTP endpoint any client can call. Its arguments are whatever the caller sends. This repo uses `'use server'` in two ways:
- **Correctly:** each export is wrapped in `enhanceAction`, which checks the session and validates the input.
- **Mistakenly:** as a label meaning "server code". Plain helper functions are exported from files marked `'use server'`, and helpers never check who is calling, because they trust their caller.

The production build registers **55** such plain functions as actions. They include:
- `getApiKeyForProvider`, which returns the platform's LLM vendor keys.
- `encrypt` and `decrypt`, the platform's encryption oracle under `ENCRYPTION_KEY`.
- `getAccessToken` and `validatePlatformToken`, which return any platform connection's decrypted token through the service-role client.
- `getGlobalOAuthCredentials` and `getAccountOAuthAppAdmin`, which return decrypted OAuth client secrets.
- `executeLLM`, which spends the platform's LLM keys with a caller-chosen `accountId` and writes a usage row with the service-role client.

**What each user gets after the fix:**
- **The owner:** no function that returns a secret or uses the admin client is reachable from the network any more. Only functions that check the caller are, and a CI guard keeps it that way; nobody has to remember the rule.
- **Creators:** nothing visible changes. Creating a project, changing its cover, setting up MFA, the media bin, publishing, analytics and audio generation all behave exactly as before.
- **An outside caller:** asking for any of the de-registered functions by ID gets Next's "Server action not found". Asking for a real action without a session gets the sign-in redirect `enhanceAction` already gives.

**Success:**
- The production build's action manifest lists only wrapped actions.
- No secret-returning name appears in it.
- The guards fail when either stops being true.

**Failure:**
- A studio flow breaks because one of its functions stopped being callable. That is guarded by typecheck, the build, the unit tests and the create-project E2E.
- Or the guard passes while a plain function is still registered. That is guarded by red-before-green on both guards.

**What persists:** no data changes. What does not persist: nothing.

## 2. Define the Complete User Journey

**Creator (unchanged journeys, each re-verified):**

| Journey | User action → system response → result → next |
|---|---|
| Create a project | Fills /studio/projects/new → `createFilmProjectAction` (now wrapped) checks the session and inserts under RLS → redirect to the project; a duplicate name returns the refusal "A project with this name already exists…" as a value (KB-6) → user renames and resubmits |
| Change cover | Uploads in settings → `updateProjectCoverImageAction` (wrapped) → cover updates; a non-editor gets KB-28's refusal as a value |
| Set up MFA | Verifies the code → `refreshAuthSession` (wrapped, `auth: false`) refreshes the cookie session → dialog closes, factor active |
| Media bin | Opens the edit suite → `getMediaBinDataAction` (inner now `enhanceAction`) → shots, dialogue and audio listed; a stranger gets "Episode not found or access denied" as before |
| Publish, analytics, audio, shorts | Unchanged server components and actions call the moved functions as plain imports |

**Attacker journey (the one this changes).** They POST to any path with a `Next-Action: <id>` header and a JSON argument array:
- **Before:** the plain function runs with the caller's arguments.
- **After:** a de-registered ID answers 404 "Server action not found", while a wrapped action answers with a sign-in redirect, or runs only for a caller its own checks allow.

Re-entry, refresh, back navigation and session interruption are unchanged. No state machine is touched.

## 3. Explicitly Define the Happy Path

The canonical success is the owner's. After this PR merges, `pnpm --filter web build:test` produces a `server-reference-manifest.json` in which:
- every one of the 356 expected remaining entries is a `'use server'` export whose initializer bottoms out in `enhanceAction(…)`, either directly or through `returnRefusals`/`withRefusals`/`adminAction`;
- `auth: false` appears only on the two allowlisted actions;
- none of the 19 never-register names appears.

CI runs both guards and they pass. A creator then creates a project:
1. The form calls `createFilmProjectAction({ accountSlug, name, description, settings })`.
2. `enhanceAction` calls `requireUser` and gets the user.
3. The handler reads the account id by slug (RLS) and inserts the project (RLS).
4. It returns `{ ok: true, data: { projectId, projectSlug, accountSlug } }`.
5. The form uploads the cover and calls `updateProjectCoverImageAction`, which returns `{ ok: true }`.
6. The form navigates to the project.

The data changed is one `projects` row, the same as today.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| Unauthenticated POST to a de-registered ID | Next finds no action | 404 / "Server action not found" | none needed | nothing ran |
| Unauthenticated POST to `createFilmProjectAction` | `requireUser` fails → `redirect(sign-in)` | sign-in page (browser) | sign in | nothing written |
| Duplicate project name | `23505` → `{ ok:false, error }` | the existing refusal sentence | rename | no row |
| Cover update by a non-editor | KB-28's `42501` → `{ ok:false, error }` | "You can't change this project's cover." | none | unchanged |
| MFA verify while the cookie is still `aal1` | `auth: false` skips `requireUser`, so there is no MFA redirect | dialog completes as today | — | session refreshed |
| A future file adds a plain export to a `'use server'` module | source guard fails in the Unit Tests job | PR is red with the file, export and reason | wrap it or move it to a library | not merged |
| A future build registers an unwrapped or secret name some other way | manifest guard fails in the E2E evidence job (and, per D3, the deploy) | red build / blocked deploy | same | not deployed |
| A Lambda imports a module that gained `server-only` | Lambda throws at import | worker job fails | the plan adds `server-only` only where no Lambda imports (§15.3) | n/a |
| Stale browser tab from before the deploy posts an old action ID | Next: action not found (true of every deploy today, since IDs are per-build) | Next's error; reload fixes it | reload | unchanged |

## 5. Establish the User-Facing Contract

- **Inputs/outputs of wrapped actions.** `createFilmProjectAction` and `updateProjectCoverImageAction` take one object instead of positional arguments, because `enhanceAction` handlers take `(params, user)`. They return the `ActionResult` shapes they return today, after KB-28. `refreshAuthSession` still returns `{}`. `getMediaBinDataAction` keeps its input and result.
- **UI states, messages and permissions:** unchanged. The only wording involved is the two existing refusals.
- **Removed:** 55 network endpoints that had no legitimate network caller (3 of them get a wrapper instead of removal). No UI called them.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Trigger / processing | Success | Failure | Verification |
|---|---|---|---|---|---|
| FR-1 | No function that returns a secret, decrypts or encrypts, or uses the service-role client is registered as an action | build | the 19 never-register names are absent from the manifest | any present | manifest guard (§26 T2), before/after table (§27) |
| FR-2 | Every export of a `'use server'` module under `apps/web` and `packages/` is an action whose chain ends in `enhanceAction` | source | 0 violations | any plain function, re-export, default export, unknown wrapper or inline directive | source guard (T1) |
| FR-3 | `auth: false` only on an explicit, commented allowlist | source | `sendContactEmail`, `refreshAuthSession` only | any other | T1 fixture + repo scan |
| FR-4 | Every registered action traces to a classified export | build | 0 unknown origins | an action from an unscanned file or an inline directive | T2 |
| FR-5 | The creator journeys in §2 behave as before | runtime | unchanged results | any regression | unit tests T3–T6, E2E T7, typecheck, `build:test` |
| FR-6 | Functions with no production caller are deleted, not moved (per D4) | source | gone | — | typecheck + grep |
| FR-7 | Library modules that no Lambda imports gain `import 'server-only'` | source | a client import fails the build | — | build + §15.3 list |
| FR-8 | Both guards are shown red on the pre-fix code, for the stated reason | verification | red with the expected counts (§26) | green on unfixed code | red-before-green run + mutation guards |

## 7. Define Non-Functional Requirements

- **Security:** FR-1 to FR-4 are the point of the change.
- **Performance:** the source guard parses ~120 files and takes under 5 s. The manifest guard reads one JSON file. Runtime is unchanged, because the moved functions are the same code, imported directly.
- **Maintainability:** each rule lives in one place, the classifier module, which both guards import.
- **Compatibility:** no API, DB or event changes. Action IDs change on every build anyway (§23).
- **Cost:** none. The manifest guard piggybacks on the E2E-evidence job's existing `build:test`.
- **Observability:** guard failures name the file, the export and the rule.
- **Accessibility, i18n:** not applicable; no UI change.

## 8. Analyze the Existing System

**How Next 15.5.3 registers actions.**
- Any module whose first statement is `'use server'` is an action module, and each export gets an ID. Next rejects non-async exports at build time; the four sync helpers in `upload-only-actions.ts` are unregistered in this build.
- The ID is `hash(salt, file, export)`. The salt is `serverReferenceHashSalt: encryptionKey` (`next/dist/build/webpack-config.js:416,442,1882`), where `encryptionKey` is `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` or, when that is unset, a random AES key. The key is cached in `.next/cache/.rscinfo` for 14 days (`encryption-utils-server.js:28,92–110`), and the manifest's `encryptionKey` equals the cached key (measured).
- A module is registered when it is reachable from a client component (layer `action-browser`) or a server component (layer `rsc`). That is why barrels matter: `audio-generation/src/server/index.ts` does `export * from './project-audio-settings'`.
- **`server-only` does not prevent registration.** `encryption.ts` has both `'use server'` and `import 'server-only'` and is registered in 25 routes.

**The wrappers:**
- `enhanceAction` (`packages/next/src/actions/index.ts`) calls `requireUser` unless `auth: false`.
- `returnRefusals`/`withRefusals` (`packages/next/src/refusals/with-refusals.ts`) wrap a finished `enhanceAction`. They convert refusals into values and do no auth themselves.
- `adminAction` (`packages/features/admin/src/lib/server/utils/admin-action.ts`) adds a super-admin check.

**Middleware** (`apps/web/middleware.ts`):
- At `:283` it lets action POSTs on `/home/*` through without a session. Its comment explains why: an action can be posted to any path, so the redirect never guarded actions.
- At `:71` it skips its CSRF check for action POSTs, relying on Next's built-in Origin check.

**Next's Origin check** (`next/dist/server/app-render/action-handler.js:339–342`): a missing `Origin` only logs "Missing `origin` header…" and proceeds. A mismatched `Origin` aborts.

**Callers of the functions:**
- Server actions, server components and route handlers.
- Lambdas: `lambda/llm-worker/utils/commit-story-canon.ts:302` does `await import('@kit/prompt-engine/server')`, and `lambda/llm-worker/llm-utils.ts:8` imports `@kit/llm`. The other Lambdas keep local copies: `getAccountElevenLabsApiKey` in `audio-file-generation.ts:113`, and inline decryption in the voice and publish workers.
- Tests.

The full per-export table is in §15.1.

## 9. Define the Desired System Behavior

| Action | Application logic → service → data → response |
|---|---|
| Server code needs a secret (LLM key, ElevenLabs key, token, OAuth secret) | imports the library function directly → same code as today → same data → the value stays in-process |
| Browser calls a real action | `enhanceAction` → `requireUser` → the handler (RLS or `can_*` checks as today) → `ActionResult` |
| Browser or script calls a former helper | Next: no such action → 404 |
| CI builds | source guard (unit job) → manifest guard after `build:test` (E2E evidence job) → red on any violation |

## 10. High-Level Architecture

The only boundary change is at the network edge. **Action modules** (`'use server'`) contain only wrapped actions. **Library modules** (no directive; `server-only` where no Lambda imports them) hold everything else. Library code may be imported by action modules, server components, route handlers and Lambdas. Action modules may import libraries, never the reverse, except where a library composes actions (`audio-asset-library.ts` calls three wrapped actions, which is allowed).

Two guards enforce the boundary:
- **Source guard.** Every PR, before a build: is every export of a `'use server'` file a wrapped action?
- **Manifest guard.** On the real build output: does every registered action trace to a wrapped export, and is no secret name registered?

Both use one classifier, so the rule cannot drift between them. That is the reason for the design: the source guard alone cannot see inline directives or files outside the scanned roots, and the manifest alone cannot tell a wrapped export from a plain one without the source.

## 11. Architecture and Flow Diagrams

```
Before                                   After
browser/script ──POST Next-Action:id──▶  browser/script ──POST Next-Action:id──▶
  Next action router                       Next action router
   ├─ enhanceAction(fn) ─▶ requireUser     ├─ enhanceAction(fn) ─▶ requireUser ─▶ fn
   └─ decrypt(ct)  ◀── runs, returns       └─ (decrypt not registered) ─▶ 404
                        plaintext
server code ──import──▶ decrypt           server code ──import──▶ decrypt (library)

CI:  unit job ──▶ source guard (AST over 'use server' files) ──▶ pass/fail
     e2e-evidence job ──▶ build:test ──▶ manifest guard(manifest × AST) ──▶ pass/fail
     deploy (D3) ──▶ pnpm build ──▶ manifest guard ──▶ upload only if pass
```

## 12. End-to-End Data Flow

No data flow changes. Secrets keep their origins: env for vendor keys; `external_api_keys.encrypted_key` / `platform_connections.*_encrypted` / `oauth_app_credentials.client_secret_encrypted` decrypted with `ENCRYPTION_KEY`. Consumers are unchanged. The change removes one **output**: the action response body, through which a secret could leave the server. Loss, duplication and reordering points are unchanged.

## 13. Data Model

No entities, attributes or invariants change. The one new invariant is on code: a `'use server'` module's exports are wrapped actions. It is enforced by the guards, not by documentation (standing rule: invariants in types or tests, not docs).

## 14. Database Design and Changes

None. No migration, no policy, no typegen. `update_project_cover_image`'s missing access check is fixed by KB-28 (#313), not here.

## 15. Low-Level Design

### 15.1 Decision for every export

The table covers every plain export of a `'use server'` module under `apps/web` and `packages/` (66), plus `getMediaBinDataAction`: 67 rows. Of these, 56 are registered on main. KB-29 (#310, this PR's base) already deletes 4 and KB-28 (#313) deletes 1. The four `apps/dev-tool` exports are out of scope (D8). "Files naming it" counts files outside tests and barrels that contain the name; name collisions are noted.

| # | Export | File:line (49b851d6) | Registered on main | Does / returns | Files naming it (excl. tests, barrels) | Decision |
|---|---|---|---|---|---|---|
| 1 | `createFilmProject` | `studio/projects/new/_lib/server/create-film-project.action.ts:24` | yes (action-browser, 2 routes, **ID in client JS**) | creates a project (RLS-guarded insert) | 1 | Wrap: `createFilmProjectAction = enhanceAction(…)`; form call updated |
| 2 | `updateProjectCoverImage` | `studio/projects/new/_lib/server/create-film-project.action.ts:94` | yes (action-browser, 2 routes, **ID in client JS**) | SECURITY DEFINER RPC (KB-28 #313 adds `can_edit_project`) | 2 | Wrap: `updateProjectCoverImageAction = enhanceAction(…)`; 3 call sites updated |
| 3 | `uploadProjectCoverImage` | `studio/projects/new/_lib/server/create-film-project.action.ts:116` | yes (action-browser, 2 routes) | storage upsert + RPC | 0 | Deleted by KB-28 (#313) |
| 4 | `refreshAuthSession` | `f/accounts/src/server/personal-accounts-server-actions.ts:19` | yes (action-browser, 2 routes, **ID in client JS**) | refreshes the caller's own session | 1 | Wrap: `enhanceAction(…, { auth: false })`, on the public allowlist |
| 5 | `loadVoiceProviderConfig` | `f/audio-generation/src/providers/config-loader.ts:48` | no | **decrypted provider key** | 1 | Library: drop `'use server'` (already `server-only`) |
| 6 | `loadMusicProviderConfig` | `f/audio-generation/src/providers/config-loader.ts:110` | no | **decrypted provider key** | 1 | Library: drop `'use server'` (already `server-only`) |
| 7 | `hasVoiceProviderApiKey` | `f/audio-generation/src/providers/config-loader.ts:159` | no | boolean | 1 | Library: drop `'use server'` (already `server-only`) |
| 8 | `hasMusicProviderApiKey` | `f/audio-generation/src/providers/config-loader.ts:195` | no | boolean | 1 | Library: drop `'use server'` (already `server-only`) |
| 9 | `findOrCreateAudioAsset` | `f/audio-generation/src/server/audio-asset-actions.ts:433` | yes (action-browser, 4 routes) | composes three enhanceAction actions | 2 | Move to `server/audio-asset-library.ts` (`server-only`) |
| 10 | `getProjectAccountId` | `f/audio-generation/src/server/project-audio-settings.ts:12` | yes (action-browser, 4 routes) | project → account id (user client) | 1 | Library: drop `'use server'`, add `server-only` |
| 11 | `getAccountElevenLabsApiKey` | `f/audio-generation/src/server/project-audio-settings.ts:32` | yes (action-browser, 4 routes) | **decrypted ElevenLabs key** (user client, RLS) | 5 | Library: drop `'use server'`, add `server-only` |
| 12 | `getProjectElevenLabsApiKey` | `f/audio-generation/src/server/project-audio-settings.ts:59` | yes (action-browser, 4 routes) | **decrypted ElevenLabs key** via project | 4 | Library: drop `'use server'`, add `server-only` |
| 13 | `getProjectAudioSettings` | `f/audio-generation/src/server/project-audio-settings.ts:70` | yes (action-browser, 4 routes) | project audio settings | 0 | Library: drop `'use server'`, add `server-only` |
| 14 | `getProjectTTSModel` | `f/audio-generation/src/server/project-audio-settings.ts:92` | yes (action-browser, 4 routes) | model name | 2 | Library: drop `'use server'`, add `server-only` |
| 15 | `getProjectSFXModel` | `f/audio-generation/src/server/project-audio-settings.ts:109` | yes (action-browser, 4 routes) | model name | 0 | Delete (no production caller) |
| 16 | `getAvailableVoices` | `f/audio-generation/src/server/queries.ts:30` | yes (action-browser, 4 routes) | stub | 0 | Delete (no production caller) — FILM-101 stub, returns `[]` |
| 17 | `getEpisodeAudioJobs` | `f/audio-generation/src/server/queries.ts:42` | yes (action-browser, 4 routes) | stub | 0 | Delete (no production caller) — stub |
| 18 | `getAudioJob` | `f/audio-generation/src/server/queries.ts:54` | yes (action-browser, 4 routes) | stub | 0 | Delete (no production caller) — stub |
| 19 | `getVoiceProfile` | `f/audio-generation/src/server/queries.ts:66` | yes (action-browser, 4 routes) | stub | 0 | Delete (no production caller) — stub |
| 20 | `getProjectVoiceProfiles` | `f/audio-generation/src/server/queries.ts:78` | yes (action-browser, 4 routes) | stub | 0 | Delete (no production caller) — stub |
| 21 | `getVoiceIdForCharacter` | `f/audio-generation/src/server/voice-queries.ts:19` | yes (action-browser, 4 routes) | takes a client argument | 1 | Library: drop `'use server'` (already `server-only`) |
| 22 | `getVoiceSettings` | `f/audio-generation/src/server/voice-queries.ts:44` | yes (action-browser, 4 routes) | takes a client argument | 2 | Library: drop `'use server'` (already `server-only`) |
| 23 | `checkAccountBudget` | `f/audio-generation/src/server/voice-queries.ts:58` | yes (action-browser, 4 routes) | takes a client argument | 2 | Library: drop `'use server'` (already `server-only`) |
| 24 | `incrementAccountUsage` | `f/audio-generation/src/server/voice-queries.ts:83` | yes (action-browser, 4 routes) | takes a client argument | 1 | Library: drop `'use server'` (already `server-only`) |
| 25 | `queueVoiceJob` | `f/audio-generation/src/server/voice-queue-helper.ts:78` | no | enqueues to SQS | 1 | Library: drop `'use server'` (already `server-only`) |
| 26 | `queueVoiceJobs` | `f/audio-generation/src/server/voice-queue-helper.ts:114` | no | enqueues to SQS | 1 | Library: drop `'use server'` (already `server-only`) |
| 27 | `getAccountDashboardData` | `f/content-analytics/src/server/account-dashboard-actions.ts:55` | yes (rsc, 8 routes) | account analytics (RLS + ClickHouse) | 1 | Library: drop `'use server'` (already `server-only`) |
| 28 | `getLanguagePerformance` | `f/content-analytics/src/server/language-analytics.ts:179` | yes (rsc, 8 routes) | analytics; checks `assertScopeAccess` itself | 2 | Library: drop `'use server'` (already `server-only`) |
| 29 | `getPlatformLanguageMatrix` | `f/content-analytics/src/server/language-analytics.ts:334` | yes (rsc, 8 routes) | analytics; checks `assertScopeAccess` itself | 2 | Library: drop `'use server'` (already `server-only`) |
| 30 | `getContentTypeComparison` | `f/content-analytics/src/server/language-analytics.ts:434` | yes (rsc, 8 routes) | analytics; checks `assertScopeAccess` itself | 2 | Library: drop `'use server'` (already `server-only`) |
| 31 | `getShortsSourcePerformance` | `f/content-analytics/src/server/language-analytics.ts:568` | yes (rsc, 8 routes) | analytics; checks `assertScopeAccess` itself | 2 | Library: drop `'use server'` (already `server-only`) |
| 32 | `getGeographyByLanguage` | `f/content-analytics/src/server/language-analytics.ts:693` | yes (rsc, 8 routes) | analytics; checks `assertScopeAccess` itself | 2 | Library: drop `'use server'` (already `server-only`) |
| 33 | `getLanguageTrend` | `f/content-analytics/src/server/language-analytics.ts:793` | yes (rsc, 8 routes) | analytics; checks `assertScopeAccess` itself | 1 | Library: drop `'use server'` (already `server-only`) |
| 34 | `getLanguageDivergence` | `f/content-analytics/src/server/language-analytics.ts:854` | yes (rsc, 8 routes) | analytics; checks `assertScopeAccess` itself | 1 | Library: drop `'use server'` (already `server-only`) |
| 35 | `getMediaBinDataAction` | `f/edit-suite/src/server/media-bin-queries.ts:213` | yes (action-browser, 1 routes, **ID in client JS**) | already authenticates inline | client (edit suite media bin) | Wrap: inner becomes `enhanceAction` (drops inline `requireUser`) |
| 36 | `updateGenerationJobStatus` | `f/episodes/src/lib/server/mutations/generation-job-actions.ts:176` | yes (rsc,action-browser, 17 routes) | writes generation_jobs (user client) | 0 | Delete (no production caller) |
| 37 | `completeGenerationJobByType` | `f/episodes/src/lib/server/mutations/generation-job-actions.ts:230` | yes (rsc,action-browser, 17 routes) | writes generation_jobs (user client) | 0 | Delete (no production caller) |
| 38 | `failGenerationJobByType` | `f/episodes/src/lib/server/mutations/generation-job-actions.ts:269` | yes (rsc,action-browser, 17 routes) | writes generation_jobs (user client) | 0 | Delete (no production caller) |
| 39 | `runAgentStoryGeneration` | `f/episodes/src/server/agent-story-generation.ts:143` | no | runs an agent on platform LLM keys | 0 | Library: drop `'use server'`, add `server-only`; deletion is decision D5 (FILM-1110 edits it) |
| 40 | `getIntroForLanguage` | `f/episodes/src/server/intro-actions.ts:390` | yes (rsc,action-browser, 17 routes) | reads intro row (user client) | 0 | Delete (no production caller) |
| 41 | `getThumbnailForLanguage` | `f/episodes/src/server/thumbnail-actions.ts:512` | yes (rsc,action-browser, 17 routes) | reads thumbnail (user client) | 0 (2 same-named local callbacks) | Delete (no production caller) (the client callers are a same-named local callback) |
| 42 | `getApiKeyForProvider` | `f/prompt-engine/src/lib/server/llm-executor.ts:197` | yes (rsc, 18 routes) | **returns OPENAI/ANTHROPIC/GEMINI/DEEPSEEK key from env** | 2 | Library: drop `'use server'`; no `server-only` (a Lambda imports it) |
| 43 | `executeLLM` | `f/prompt-engine/src/lib/server/llm-executor.ts:270` | yes (rsc, 18 routes) | **spends platform LLM keys; caller-chosen `accountId`; service-role usage write** | 35 | Library: drop `'use server'`; no `server-only` (a Lambda imports it) |
| 44 | `loadAndRenderPrompt` | `f/prompt-engine/src/lib/server/prompt-loader.ts:24` | yes (rsc, 18 routes) | returns rendered prompt text | 1 | Library: drop `'use server'`; no `server-only` (a Lambda imports it) |
| 45 | `processScheduledPublishes` | `f/publishing/src/jobs/process-scheduled-publishes.ts:128` | yes (rsc, 3 routes) | **runs the publish cron with the admin client** | 2 | Library: drop `'use server'` (already `server-only`) |
| 46 | `refreshTikTokToken` | `f/publishing/src/oauth/tiktok/refresh.ts:18` | yes (rsc, 2 routes) | decrypts + rotates a TikTok token | 1 | Deleted by KB-29 (#310) |
| 47 | `getAccountOAuthApp` | `f/publishing/src/server/account-oauth-actions.ts:28` | yes (rsc,action-browser, 21 routes) | **decrypted client secret** | 0 | Deleted by KB-29 (#310) |
| 48 | `getAccountOAuthAppAdmin` | `f/publishing/src/server/account-oauth-actions.ts:68` | yes (rsc,action-browser, 21 routes) | **decrypted client secret, admin client** | 1 | Deleted by KB-29 (#310) |
| 49 | `getAccountOAuthApps` | `f/publishing/src/server/account-oauth-actions.ts:97` | yes (rsc,action-browser, 21 routes) | lists OAuth apps (user client) | 0 | Delete (no production caller) |
| 50 | `validatePlatformToken` | `f/publishing/src/server/connection-actions.ts:371` | yes (rsc,action-browser, 10 routes) | **decrypted token of any connection, admin client** | 0 | Delete (no production caller) |
| 51 | `getAccessToken` | `f/publishing/src/server/connection-actions.ts:379` | yes (rsc,action-browser, 10 routes) | **decrypted token of any connection, admin client** | 2 | Move to `server/connection-tokens.ts` (`server-only`) |
| 52 | `getEpisodePublishingConfigs` | `f/publishing/src/server/episode-publishing-actions.ts:53` | yes (rsc,action-browser, 10 routes) | reads configs (user client) | 0 | Delete (no production caller) |
| 53 | `getAccountPlatformConnections` | `f/publishing/src/server/episode-publishing-actions.ts:111` | yes (rsc,action-browser, 10 routes) | lists connections (user client) | 2 | Move to `server/publishing-queries.ts` (`server-only`) |
| 54 | `getGlobalOAuthApps` | `f/publishing/src/server/global-oauth-actions.ts:26` | yes (rsc,action-browser, 10 routes) | lists global apps (user client, admin page) | 1 | Move to `server/publishing-queries.ts` (`server-only`) |
| 55 | `getGlobalOAuthCredentials` | `f/publishing/src/server/global-oauth-actions.ts:52` | yes (rsc,action-browser, 10 routes) | **decrypted client secret, admin client** | 4 | Deleted by KB-29 (#310) |
| 56 | `getProjectPublishingConfigs` | `f/publishing/src/server/project-publishing-actions.ts:39` | yes (rsc,action-browser, 10 routes) | reads configs (user client) | 2 | Move to `server/publishing-queries.ts` (`server-only`) |
| 57 | `extractContentId` | `f/publishing/src/server/upload-only-actions.ts:91` | no | pure helper | 0 | Move to `lib/upload-only-format.ts` (pure) |
| 58 | `sanitizeFilename` | `f/publishing/src/server/upload-only-actions.ts:113` | no | pure helper | 3 | Move to `lib/upload-only-format.ts` (pure) |
| 59 | `formatDescriptionForPlatform` | `f/publishing/src/server/upload-only-actions.ts:124` | no | pure helper | 0 | Move to `lib/upload-only-format.ts` (pure) |
| 60 | `generateDefaultTags` | `f/publishing/src/server/upload-only-actions.ts:146` | no | pure helper | 0 | Move to `lib/upload-only-format.ts` (pure) |
| 61 | `getShortsCandidates` | `f/shorts/src/server/shorts-queries.ts:69` | yes (rsc, 1 routes) | reads shorts (user client) | 1 | Library: drop `'use server'` (already `server-only`) |
| 62 | `getShortsForEpisode` | `f/shorts/src/server/shorts-queries.ts:129` | yes (rsc, 1 routes) | reads shorts (user client) | 1 | Library: drop `'use server'` (already `server-only`) |
| 63 | `getShortById` | `f/shorts/src/server/shorts-queries.ts:226` | yes (rsc, 1 routes) | reads a short (user client) | 0 | Delete (no production caller) |
| 64 | `logLLMUsage` | `packages/llm/src/analytics.ts:85` | yes (rsc, 18 routes) | inert over the wire (its first argument is a client object) | 1 | Library: drop `'use server'`; no `server-only` (a Lambda imports it) |
| 65 | `encrypt` | `packages/shared/src/crypto/encryption.ts:49` | yes (rsc, 25 routes) | **encryption oracle under `ENCRYPTION_KEY`** | 15 | Library: drop `'use server'` (keeps `server-only`) |
| 66 | `decrypt` | `packages/shared/src/crypto/encryption.ts:77` | yes (rsc, 25 routes) | **decryption oracle under `ENCRYPTION_KEY`** | 21 | Library: drop `'use server'` (keeps `server-only`) |
| 67 | `isEncrypted` | `packages/shared/src/crypto/encryption.ts:105` | yes (rsc, 25 routes) | boolean | 0 | Library: drop `'use server'` (keeps `server-only`) |

Totals (all 67 rows):
- Wrap: 4 (`createFilmProject`, `updateProjectCoverImage`, `refreshAuthSession`, `getMediaBinDataAction`). They stay registered, now behind `enhanceAction`.
- Move to a new library module: 9.
- Directive removed in place: 34, across 13 files.
- Delete in this PR: 15. That is `getProjectSFXModel`, the five FILM-101 stubs in `queries.ts`, the three `generation-job-actions` helpers, `getIntroForLanguage`, `getThumbnailForLanguage`, `getAccountOAuthApps`, `validatePlatformToken`, `getEpisodePublishingConfigs` and `getShortById`.
- Already deleted by #310/#313: 5.

### 15.2 Files

| File | Change |
|---|---|
| `packages/shared/src/crypto/encryption.ts` | drop `'use server'` (keeps `server-only`) |
| `packages/features/prompt-engine/src/lib/server/llm-executor.ts`, `prompt-loader.ts` | drop `'use server'`; comment why no `server-only` (Lambda `commit-story-canon.ts:302`), as KB-31's `llm-job-target.ts` does |
| `packages/llm/src/analytics.ts` | drop `'use server'`; no `server-only` (`lambda/llm-worker/llm-utils.ts:8` imports `@kit/llm`) |
| `packages/features/audio-generation/src/server/project-audio-settings.ts` | drop directive, add `server-only`, delete `getProjectSFXModel` |
| `…/audio-generation/src/server/queries.ts` | delete file; drop `export * from './queries'` in `server/index.ts` and the stale doc example in `src/index.ts:18` |
| `…/audio-generation/src/server/{voice-queries,voice-queue-helper}.ts`, `…/providers/config-loader.ts` | drop directive |
| `…/audio-generation/src/server/audio-asset-actions.ts` → new `audio-asset-library.ts` | move `findOrCreateAudioAsset`; update `elevenlabs-music-actions.ts`, `sfx-actions.ts` |
| `packages/features/content-analytics/src/server/{account-dashboard-actions,language-analytics}.ts` | drop directive; fix the comment at `language-analytics.ts:36` that says the module is an endpoint |
| `packages/features/episodes/src/lib/server/mutations/generation-job-actions.ts` | delete the 3 plain exports |
| `…/episodes/src/server/{intro,thumbnail}-actions.ts` | delete `getIntroForLanguage`, `getThumbnailForLanguage` |
| `…/episodes/src/server/agent-story-generation.ts` | drop directive, add `server-only` (D5) |
| `packages/features/publishing/src/server/connection-actions.ts` → new `connection-tokens.ts` | move `getAccessToken`, delete `validatePlatformToken`; update `publish-actions.ts`, `social-post-actions.ts`, `server/index.ts`, 2 tests' mocks |
| `…/publishing/src/server/{episode-publishing,global-oauth,project-publishing}-actions.ts` → new `publishing-queries.ts` | move the 3 readers; delete `getEpisodePublishingConfigs`; `server/index.ts` re-exports from the new file, so pages keep their imports |
| `…/publishing/src/server/account-oauth-actions.ts` | delete `getAccountOAuthApps` (and its `index.ts` line) |
| `…/publishing/src/server/upload-only-actions.ts` → new `lib/upload-only-format.ts` | move 4 pure helpers; update the test import |
| `…/publishing/src/jobs/process-scheduled-publishes.ts` | drop directive |
| `packages/features/shorts/src/server/shorts-queries.ts` | drop directive; delete `getShortById` (+ index line) |
| `packages/features/edit-suite/src/server/media-bin-queries.ts` | inner `getMediaBinData` becomes `enhanceAction(async (params, user) => …)`; inline `requireUser` removed; `ActionRefusal` unchanged |
| `packages/features/accounts/src/server/personal-accounts-server-actions.ts` | `refreshAuthSession = enhanceAction(async () => { … return {}; }, { auth: false })` |
| `apps/web/app/home/[account]/studio/projects/new/_lib/server/create-film-project.action.ts` + `create-film-project-form.tsx` + `project-cover-settings.tsx` | wrap both (on top of KB-28's version, D6); call sites pass one object |
| `packages/next/__tests__/support/use-server-audit.ts` (new) | the classifier (§15.4) |
| `packages/next/__tests__/use-server-exports.test.ts` (new) | T1 |
| `packages/next/__tests__/action-manifest.guard.test.ts` (new) | T2 |
| `.github/workflows/workflow.yml` | one step after `build:test` in 🧬 E2E evidence |
| `.github/workflows/deploy-aws-{staging,production}.yml` | one step after `pnpm build` (D3) |
| `tooling/mutation-guards/kb-58.json` (new) | §26 |
| `specs/cross-cutting/FILM-CC-04-known-bugs.md` | new `## KB-58` section (Fixed) + one Fixed-table row |

### 15.3 Where `server-only` goes, and where it must not

`server-only` throws when imported outside a `react-server` bundle, and the Lambdas are bundled with esbuild, not by Next. KB-31 records the same constraint in `llm-job-target.ts`. So:
- **Added** to `project-audio-settings.ts`, `agent-story-generation.ts` and the new `audio-asset-library.ts`, `connection-tokens.ts` and `publishing-queries.ts`. No Lambda or script imports any of them (checked by grep over `apps/web/lambda`, `packages/agent` and `scripts`).
- **Not added** to `llm-executor.ts`, `prompt-loader.ts` or `analytics.ts`, because Lambdas import them.
- The guard does not require `server-only`. Its job is registration.

### 15.4 The classifier (shared by both guards)

```
isActionModule(sf)  = first statement is the directive 'use server'
verdict(export):
  type/interface export                       → ignore (erased)
  export [async] function                     → FAIL "plain exported function"
  export {…} from / export default            → FAIL "re-export / default export"
  export const X = <init>:
     init is Identifier bound to a same-file const → verdict(that initializer)
     init is call to returnRefusals|withRefusals|adminAction → verdict(last argument)
     init is call to enhanceAction(fn, cfg):
         cfg.auth === false and file#X not in PUBLIC_ACTIONS → FAIL "auth:false not allowlisted"
         else OK
     anything else                                    → FAIL "not a wrapped action"
inline 'use server' inside a function body     → FAIL (none exist; new ones need review)
scope: apps/web/**, packages/** (.ts/.tsx; not node_modules, tests, apps/dev-tool, apps/e2e)
PUBLIC_ACTIONS = {
  contact/_lib/server/server-actions.ts#sendContactEmail  — public contact form
  personal-accounts-server-actions.ts#refreshAuthSession  — runs right after MFA verify,
     while the cookie may still be aal1 (requireUser would redirect to /auth/verify);
     refreshes only the caller's own session; returns {}
}
NEVER_REGISTERED = { getApiKeyForProvider, executeLLM, loadAndRenderPrompt, logLLMUsage,
  encrypt, decrypt, isEncrypted, getOAuthAppCredentials, getGlobalOAuthCredentials,
  getAccountOAuthApp, getAccountOAuthAppAdmin, getAccessToken, validatePlatformToken,
  ensureValidToken, refreshTikTokToken, getAccountElevenLabsApiKey,
  getProjectElevenLabsApiKey, loadVoiceProviderConfig, loadMusicProviderConfig }
```

**Manifest guard (T2):**
- It reads `ACTION_MANIFEST`. If the variable is unset, the whole `describe` is skipped by name and visibly. If it is set but the file is missing or `node` is empty, the guard fails.
- For every `node` and `edge` entry it resolves `path.join('apps/web', filename)` under `ACTION_SOURCE_ROOT` (default: the repo root).
- It fails on an unknown origin, on any verdict FAIL, and on any `exportedName` in `NEVER_REGISTERED`.
- It never prints `encryptionKey`.

### 15.5 Error handling, idempotency, concurrency

Unchanged; code moves, not behaviour. Wrapped actions keep KB-6's rule: refusals are returned, crashes are thrown.

## 16. API and Event Design

| Endpoint (server action) | Before | After |
|---|---|---|
| 55 plain registered functions | callable, unauthenticated, caller-chosen arguments | not registered |
| `createFilmProject(accountSlug, formData)` | plain, ID in client JS | `createFilmProjectAction({ accountSlug, name, description?, settings })`, auth required; no Zod schema added, because the input type is unchanged and adding one could reject inputs accepted today (open question Q3) |
| `updateProjectCoverImage(projectId, url)` | plain | `updateProjectCoverImageAction({ projectId, coverImageUrl })`, auth required |
| `refreshAuthSession()` | plain | `enhanceAction(…, { auth: false })` |
| `getMediaBinDataAction` | `returnRefusals(plain fn with inline requireUser)` | `returnRefusals(enhanceAction(…))` |

There are no events, queues or versioning concerns. Action IDs are per-build hashes, so no client pins them.

## 17. State and Lifecycle Design

Not applicable: no entity gains or loses a state. The only lifecycle is the build artifact's, covered in §25.

## 18. Failure and Error Handling

| Failure | Behaviour | Visible | Recovery |
|---|---|---|---|
| Moved function's importer missed | typecheck/build fails | red CI | fix the import |
| Client component imports a new `server-only` library | build fails ("server-only cannot be imported from a Client Component") | red CI | import through an action |
| Lambda imports a module that gained `server-only` | runtime throw in the worker | job failure | prevented by §15.3; `pnpm typecheck` covers the lambdas once KB-14 (#309) lands, and a lambda import check is part of §26 T8 |
| Guard false positive on a legitimate new pattern | red CI with the reason | author sees the rule | wrap the action, or add a justified `PUBLIC_ACTIONS` entry in review |
| `ACTION_MANIFEST` set but the build failed first | T2 fails with "manifest not found", never skips | red | fix the build |

## 19. Security

### What is proven, and what is not

| Claim | Status | Evidence |
|---|---|---|
| 55 plain functions are registered as actions in the production build | **Proven** | `server-reference-manifest.json` from `build:test` of `49b851d6` code, joined to the AST (`manifest-rows-r2.json`) |
| None has an auth wrapper | **Proven** | AST: no wrapper chain. Those that read through the user client are still bounded by RLS. The ones that matter use env, the admin client or `ENCRYPTION_KEY` (the "Does / returns" column in §15.1) |
| The 15 secret or admin names are among them | **Proven** | §27 table |
| Their IDs are absent from every client chunk and prerendered file | **Proven** for this build | substring search of `.next/static/**/*.js` and prerendered `.html/.rsc/.body/.meta`: only `createFilmProject`, `updateProjectCoverImage` and `refreshAuthSession` of the plain 55 appear |
| No server component passes one of them to a client component as a prop (which would put the ID in a request-time RSC payload) | **Proven statically, same-name JSX props only** | grep of `={name}` for all 55 names: one hit, a same-named local callback in `publish-screen.tsx:248` |
| The middleware lets unauthenticated action POSTs through on `/home/*` | **Proven** (code) | `middleware.ts:283`; CSRF skipped for actions at `:71` |
| Next only warns on a missing `Origin` | **Proven** (code) | `action-handler.js:339–342` in Next 15.5.3 |
| `server-only` does not stop registration | **Proven** | `encryption.ts` has both and is registered in 25 routes |
| An outside caller can actually invoke one | **Not proven, not attempted** | no live call, by rule. It would need the action ID, which is `hash(per-build random salt, file, export)`; the salt is random per build (unset `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`), gitignored (`.next/`), and fresh on CI runners |
| The salt never leaves the server | **Not proven** | the deploy syncs `.open-next/cache/` to a public S3 path (`deploy-aws-production.yml:146`). That is OpenNext's ISR/fetch cache, which should not include `.next/cache/.rscinfo`, but it has not been built and inspected. Verification step V6 in §27 does that |

**Severity High, not Critical.** The functions are among the most sensitive in the codebase:
- the vendor keys, the encryption oracle, and any connection's token via the admin client;
- `executeLLM` on the platform's LLM keys with a caller-chosen account;
- `processScheduledPublishes` running the publish cron.

The only thing standing between them and the internet is an unguessable ID. That is obscurity, not a control, and it fails the day an ID leaks (a log line, an error page, a future `={fn}` prop, a stable key committed somewhere). Combined with KB-43 (any member can read encrypted tokens), `decrypt` alone would be token theft. It is not Critical because no path to an ID has been found.

**Abuse scenarios closed:**
- vendor key exfiltration;
- `ENCRYPTION_KEY` oracle (decrypt stolen ciphertext, forge ciphertext);
- a decrypted token of any connection by id;
- decrypted OAuth client secrets (via KB-29's deletions);
- free LLM calls billed to the platform and attributed to any account;
- triggering the publish cron;
- reading an account's decrypted ElevenLabs key as any RLS-permitted member.

**Least privilege:** after the fix, network reachability equals "wrapped by `enhanceAction`", and the guards keep it so.

### The middleware pass-through and the `Origin` warning — recommendation

- **`middleware.ts:283`: keep it.** Its comment is right. An action can be posted to any path, including public ones, so a middleware redirect never guarded actions. Removing the pass-through would bring back FILM-1610's "An unexpected response was received from the server" for signed-out users and protect nothing. The control belongs in the action, which is what the guard enforces.
- **Missing `Origin`: accept Next's behaviour.** `Origin` is a CSRF defence for browsers, and browsers always send it on a cross-site POST, where a mismatch aborts (`action-handler.js:343–356`). Only non-browser clients omit it, and they can set any `Origin` they like, so rejecting a missing one in middleware would add log noise and stop nobody. The CSRF skip at `:71` is consistent with that.
- **No new ticket is needed** for either, so none is requested from the lead. If the owner wants it anyway, "reject action POSTs without `Origin`" is a Low-severity hardening item.

### Other security notes

- The saved manifest in `$SP` contains the build's `encryptionKey`. It is never committed, and T2's fixtures are synthetic.
- `apps/dev-tool` has 4 plain `'use server'` exports: `updateEnvironmentVariableAction` writes env files, and `translateWithAIAction` uses an AI key. The app is not deployed (no reference in `sst.config.ts` or any workflow), runs on localhost, and is protected from browser CSRF by the Origin check. It is out of scope (D8).

## 20. Performance and Scale

No runtime effect. The moved functions are imported directly instead of through Next's action wrapper; the call inside the same process was already direct. The source guard adds under 5 s to the Unit Tests job and the manifest guard under 2 s to the E2E evidence job.

## 21. Accessibility and Client Behavior

No UI change. The create-project form and cover settings render and behave exactly as before; only the imported function's name and argument shape change. Keyboard, focus and screen-reader behaviour are untouched.

## 22. Observability and Operations

**How an operator knows it works:**
- CI shows both guards green.
- When D3 is taken, a deploy log line reads `KB-58 manifest guard: N actions, all wrapped, 0 never-register names`.

**How they tell it from failure:**
- A red guard names the file, the export and the rule.
- In production, calls to de-registered IDs appear as Next's "Failed to find Server Action" warnings. After a deploy these are expected from stale tabs; a steady stream would be probing, and can be investigated. No new logs or metrics are needed.

## 23. Configuration and Feature Flags

- No feature flag. The change is a code boundary, and flagging it would leave the endpoints registered.
- **`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (D1).** It is unset today, so every build (every CI runner) gets a fresh random salt, and all action IDs change on every deploy. With OpenNext on Lambda every instance of one build shares that build's key, so there is no cross-instance mismatch. Setting a stable key would help only with version skew between deploys: a tab from before a deploy calling a now-renamed action. It would also make IDs stable across deploys, which widens the window if one ever leaks. **Recommendation: leave it unset.** If the owner later sets it to fix skew, it belongs in SSM per environment as a secret, is never committed, and is rotated on any suspicion.
- **Key rotation (D2): not required.** No evidence shows any secret was read through these endpoints. The dangerous IDs were in no downloadable artifact of the measured build, the salt is random per build and gitignored, and no live call was made. Rotating the LLM vendor keys, `ENCRYPTION_KEY` (which would also need every stored ciphertext re-encrypted) or the OAuth secrets is **not warranted** on this evidence. A cheap reassurance is for the owner to look at the vendor usage dashboards for unexplained spend; that needs no action from us.

## 24. Compatibility

- **Clients:** the three changed client imports ship in the same build, and old IDs are invalid after any deploy anyway.
- **Barrel exports:** `@kit/publishing/server`, `@kit/content-analytics/server`, `@kit/shorts/server`, `@kit/prompt-engine/server`, `@kit/audio-generation/server`, `@kit/shared/crypto` and `@kit/llm` keep every export except the deleted, unused ones. Typecheck proves no importer remains.
- **Lambdas:** unaffected (§15.3).
- **Deploy order:** none; a single artifact.

## 25. Migration and Rollout Strategy

- **Preconditions:** #310 merged (or this PR retargeted after it), and #313 merged before the create-film-project commit (D6).
- **Rollout:** one normal deploy, with no flag, schema change or backfill.
- **Validation gate:** the manifest guard on the deploy build (D3).
- **Rollback:** revert the PR. That re-registers the functions, so it restores the exposure, and a rollback should be followed by a forward fix. No data rollback is involved.

## 26. Testing Strategy

| ID | Test | Layer | Red on pre-fix code (expected, measured by the prototype) | Green after |
|---|---|---|---|---|
| T1 | `use-server-exports.test.ts`: classifier fixtures (plain function; `returnRefusals(plainFn)`; `withRefusals('x', enhanceAction(…))` OK; `adminAction(enhanceAction(…))` OK; unlisted `auth:false`; re-export; default export; inline directive) + a repo scan asserting 0 violations with the list printed | unit (Unit Tests job via `scripts/test-units.sh`, `@kit/next`) | repo scan: **67** on `origin/main`, **63** on #310 (62 plain functions + `getMediaBinDataAction`) | 0 |
| T2 | `action-manifest.guard.test.ts`: synthetic fixture manifests (one wrapped, one plain, one never-register name, one unknown origin, one missing file) + the real manifest via `ACTION_MANIFEST` | unit + build (E2E evidence job after `build:test`) | real main manifest + main source: **56 unwrapped, 15 never-register names, 0 unknown** | 0 / 0 / 0 on the branch build |
| T3 | `refreshAuthSession` calls `auth.refreshSession` and returns `{}` with no session check (mocked client) | unit (`@kit/accounts`) | — | pass |
| T4 | `createFilmProjectAction`: unauthenticated → redirect; authenticated → insert and `{ok:true}`; `23505` → refusal value | unit (web vitest) | — | pass |
| T5 | `updateProjectCoverImageAction`: `42501` → refusal value; success → `{ok:true}`; unauthenticated → redirect | unit (web) | — | pass |
| T6 | `getMediaBinDataAction`: unauthenticated → redirect as before; a refusal stays a value | unit (`@kit/edit-suite` or web) | — | pass |
| T7 | Playwright `studio/create-film-project.spec.ts`: seeded user (`seedUser`/`seedTeamAccount`, `signInAs`) creates a project through the form → lands on it; **second submission** with the same name shows the refusal; screenshots of both states (evidence pattern, `CAPTURE_EVIDENCE=1`) | E2E, UI-driven only (D7) | — | pass |
| T8 | Existing suites that import moved functions: `publishing/__tests__/{connection-actions,publish-actions,token-refresh,upload-only-actions}.test.ts`, `content-analytics` language tests, `audio-generation` config-loader/factory, `shared/__tests__/crypto.test.ts`, plus `pnpm typecheck` (with KB-14's lambda typecheck, if merged) | unit | — | pass with updated import paths |
| M | `tooling/mutation-guards/kb-58.json` (kind `unit`, cwd `packages/next`): (1) put `'use server';` back on `encryption.ts` → T1 fails "plain exported function"; (2) make the classifier accept any callee → T1's "unknown wrapper" fixture fails; (3) empty `PUBLIC_ACTIONS` check → T1's allowlist fixture fails; (4) drop the `NEVER_REGISTERED` check → T2's fixture fails | mutation (CI Unit Tests job) | each mutation must turn its test red | — |

**Red-before-green (CLAUDE.md rule 1), in Phase 2:**
1. Commit the guards before the fix and run T1 on the #310 base: expect 63, listing every file.
2. Run T2 with `ACTION_MANIFEST=$SP/kb58/server-reference-manifest.main.json` and `ACTION_SOURCE_ROOT` set to a `git archive` of `origin/main` in `$SP`: expect 56 / 15 / 0.
3. Apply the fix, `build:test`, and run T2 on the new manifest: expect 0 / 0 / 0.
4. Revert the fix commits on a temporary WIP commit, rebuild, and watch T2 go red again for the same reason. Then restore.

The handed-over `manifest-rows.json` is not used for the red run, because its `apps/web` rows are wrong (see "Correction" above). The corrected `manifest-rows-r2.json` is.

## 27. Production-Build Verification

| # | Check | How |
|---|---|---|
| V1 | `pnpm --filter web build:test` succeeds | heavy slot, `VENDOR_SANDBOX=1`, build only |
| V2 | Manifest guard green on that build | T2 |
| V3 | Before/after table below, filled from the two manifests | `manifest-r2.cjs` on both |
| V4 | No plain export's ID in client JS or prerendered output; the only IDs of `auth:false` actions in client JS are the two allowlisted ones | same script |
| V5 | Registered total goes from 408 to **356**: the 56 unwrapped on main, minus the 4 that stay registered once wrapped. That assumes no other PR adds actions first; the exact figure is recorded | same script |
| V6 | `open-next build` (sandboxed, no deploy), then assert that neither `.open-next/assets/**` nor `.open-next/cache/**` contains `.rscinfo`, `server-reference-manifest*` or the build's key string | one-off, build-based, results in the PR |

No `next start` and no request to a server are made for V1–V6, per the scope rule. T7 runs against a dev server under the usual E2E rules (D7).

**Before/after for the secret-returning and admin-client functions** (before = measured on `49b851d6`; after = to be measured in Phase 2):

| Function | Before: registered? (layers, routes) | Before: ID in client JS / prerender | After |
|---|---|---|---|
| `getApiKeyForProvider` | yes (rsc, 18) | no / no | _Phase 2_ |
| `executeLLM` | yes (rsc, 18) | no / no | _Phase 2_ |
| `loadAndRenderPrompt` | yes (rsc, 18) | no / no | _Phase 2_ |
| `logLLMUsage` | yes (rsc, 18) | no / no | _Phase 2_ |
| `encrypt` | yes (rsc, 25) | no / no | _Phase 2_ |
| `decrypt` | yes (rsc, 25) | no / no | _Phase 2_ |
| `isEncrypted` | yes (rsc, 25) | no / no | _Phase 2_ |
| `getGlobalOAuthCredentials` | yes (rsc+action-browser, 10) | no / no | _Phase 2_ (deleted by #310) |
| `getAccountOAuthApp` | yes (rsc+action-browser, 21) | no / no | _Phase 2_ (deleted by #310) |
| `getAccountOAuthAppAdmin` | yes (rsc+action-browser, 21) | no / no | _Phase 2_ (deleted by #310) |
| `refreshTikTokToken` | yes (rsc, 2) | no / no | _Phase 2_ (deleted by #310) |
| `getAccessToken` | yes (rsc+action-browser, 10) | no / no | _Phase 2_ |
| `validatePlatformToken` | yes (rsc+action-browser, 10) | no / no | _Phase 2_ |
| `getAccountElevenLabsApiKey` | yes (action-browser, 4) | no / no | _Phase 2_ |
| `getProjectElevenLabsApiKey` | yes (action-browser, 4) | no / no | _Phase 2_ |
| `processScheduledPublishes` (admin client) | yes (rsc, 3) | no / no | _Phase 2_ |
| `loadVoiceProviderConfig`, `loadMusicProviderConfig` | no (not reachable in this build; would register on the next barrel import) | — | _Phase 2_ |

## 28. Requirement Traceability

| User outcome | User flow | Requirement | Design | Component | Data/API | Test | Production verification |
|---|---|---|---|---|---|---|---|
| Secrets unreachable from the network | attacker §2 | FR-1 | §15.1 | 34 in place + 9 moved + 15 deleted | action endpoints removed | T2 | V2, V3 |
| The rule cannot regress | owner §3 | FR-2, FR-3 | §15.4 | classifier, T1 | — | T1, M | CI |
| Nothing registers from outside the scan | owner | FR-4 | §15.4 | T2 | manifest | T2 | V2 |
| Creators notice nothing | §2 creator rows | FR-5 | §15.2 | wrapped actions + moved imports | same results | T3–T8 | V1, T7 |
| Dead endpoints gone | — | FR-6 | §15.1 | deletions | — | typecheck | V5 |
| Client can't import libraries | — | FR-7 | §15.3 | `server-only` | — | build | V1 |
| Guards proven | — | FR-8 | §26 | — | — | red runs, M | red/green table in the PR |
| The salt stays server-side | — | (§19) | — | deploy artifact | — | — | V6 |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Why this one |
|---|---|---|
| Remove `'use server'` from libraries | (a) wrap every helper in `enhanceAction`; (b) add an auth check inside each helper | (a) keeps 50 needless endpoints, and wrappers change signatures for server callers; (b) makes auth depend on each author remembering. Libraries should not be endpoints |
| Two guards on one classifier | source only; manifest only | source misses inline directives and unscanned roots; manifest needs the source to tell wrapped from plain. Sharing one classifier stops the rules drifting |
| Manifest guard in the E2E evidence job | a new always-on build job | reuses a build already paid for; `ENABLE_E2E_JOB` is `true`; the deploy gate (D3) covers the real artifact |
| Explicit `NEVER_REGISTERED` list on top of the wrapper rule | wrapper rule only | catches a future `export const decrypt = enhanceAction(…)`, where wrapped still means exposed |
| Stack on #310 | base on main and move the four OAuth readers myself | #310 deletes them, so building on main would conflict with it head-on |
| `refreshAuthSession` as `auth: false` + allowlist | `auth: true` | `requireUser` would redirect an `aal1` cookie to `/auth/verify` in the middle of MFA setup |
| Delete unused functions | move them | less surface and less code; typecheck proves nothing used them |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| A moved function had a hidden dynamic caller | runtime failure in that flow | typecheck, build, T8, E2E suite | grep by name (done, §15.1) | restore the export as a library |
| `server-only` reaches a Lambda | worker crash | KB-14 lambda typecheck; §15.3 grep | not added where a Lambda imports | remove the import |
| Conflicts with #313 / #315 / #311 / KB-52 | rebase work | git | D6 sequencing; changes in shared files are one-line directive removals | rebase |
| Guard too strict for a future valid pattern | blocked PR | red CI with reason | `PUBLIC_ACTIONS` with justification, or extend the wrapper list in review | — |
| The E2E evidence job gets disabled (`ENABLE_E2E_JOB`) | T2 stops running on PRs | — | D3 deploy gate; T1 still runs every PR | — |
| `.rscinfo` in a public bucket | IDs computable | V6 | V6 before merge | set a fresh `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` and redeploy |
| Behaviour change in `createFilmProject` wrapping (auth now required) | none expected; the page is already behind sign-in | T4, T7 | — | — |

## 31. Open Questions and Assumptions

| # | Question | Why it matters | Current assumption | Needed | Decision by |
|---|---|---|---|---|---|
| Q1 | Does `.open-next/cache/` ever contain `.rscinfo`? | it would make IDs computable | no (it is the ISR cache) | V6 | measured in Phase 2 |
| Q2 | Is any action ID logged anywhere (monitoring, error pages)? | a leak path for IDs | not checked; logs are not accessible without production access, which is ruled out | — | owner, optional |
| Q3 | Should `createFilmProjectAction` get a Zod schema? | input validation | no, to keep behaviour identical in this PR | — | follow-up if wanted |
| Q4 | Are the FILM-101 stubs in `queries.ts` planned work? | deletion | no (the TODOs refer to tables that now exist under other names) | D4 | owner |

## 32. Implementation Plan

1. **Guards first (red).** Add the classifier, T1 and T2 with fixtures. Run T1 on the #310 base (63) and T2 on the main manifest and source (56/15/0). Commit `test(KB-58): …`. The Unit Tests job will stay red until step 3; that is intended within the branch.
2. **Pure directive removals** (34 exports, 13 files), plus the `server-only` additions per §15.3. Typecheck.
3. **Moves** (`connection-tokens.ts`, `publishing-queries.ts`, `audio-asset-library.ts`, `lib/upload-only-format.ts`), barrel updates, test import updates. Typecheck, then T8.
4. **Deletions** (D4 list) with barrel lines. Typecheck.
5. **Wraps:** `refreshAuthSession`, `getMediaBinDataAction`, then `create-film-project.action.ts` and its two client files once #313 has merged (D6). T3–T6.
6. **CI wiring:** the E2E evidence step; the deploy steps (D3); `tooling/mutation-guards/kb-58.json`; run `run.py --only KB-58`.
7. **Production build:** V1–V6 and the before/after table. Red-before-green on T2 by reverting steps 2–5 on a temporary WIP commit, rebuilding, then restoring.
8. **T7** Playwright spec and evidence screenshots (D7).
9. **Records:** FILM-CC-04 `## KB-58` (Fixed) plus a Fixed row. Then `pnpm lint:fix` and `pnpm format:fix`.

There is no database impact and no API/event impact beyond §16. Rollback is a revert (§25).

## 33. Definition of Done

- T1 and T2 green on the branch; both shown red for the stated reason, with the counts recorded in the PR.
- The mutation guards catch all four mutations.
- The before/after table is filled from measured manifests. All 15 names are absent, and so is every plain export.
- V6 confirms no salt in any public artifact.
- `pnpm typecheck`, all unit suites, `build:test`, T7, `pnpm lint:fix` and `pnpm format:fix` all clean.
- FILM-CC-04 updated.
- The PR states that it is stacked on #310 in its first line.

## 34. Final Consistency Pass

**Forward.**
- The problem: plain helpers became endpoints.
- The outcome: only checked actions are endpoints (§1).
- Creators do the same things with the same results (§2, §5).
- The system has to remove the helpers from the action graph and keep the real actions wrapped (§9). No data changes (§12–14).
- Architecture: action modules versus library modules, plus two guards (§10). Implemented per export (§15.1).
- Tested by T1/T2 red-to-green plus behaviour tests (§26). Deployed as one artifact (§25), verified on the build (§27).

**Reverse.**
- In production, the server will register only `enhanceAction`-rooted exports (356 expected), and none of the 19 named secrets.
- It reads and writes the same data through the same functions, now imported rather than routed.
- The creator flows produce identical results (T3–T8), and an outside caller can no longer reach a helper.
- That is §1's outcome. The two directions agree.

**One residual gap is recorded, not hidden:** the claim that exploitation needs the ID, and that the ID cannot be obtained, is bounded by the static and build evidence in §19. A live call was deliberately not made.

---

## Owner decisions (each with the recommended default)

| # | Decision | Default |
|---|---|---|
| D1 | Set a stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` per environment? | **No.** Leave unset; per-build random salts are better for this ticket. If skew errors ever matter, set it in SSM as a secret, never committed |
| D2 | Rotate the LLM keys, `ENCRYPTION_KEY` or OAuth secrets? | **Not required on this evidence** (§23). Optionally glance at the vendor usage dashboards |
| D3 | Add the manifest guard to both deploy workflows after `pnpm build`? | **Yes.** It checks the artifact actually deployed, reads no secret, and costs about 2 s |
| D4 | Delete the 15 exports with no production caller (§15.1) rather than keep them as libraries? | **Yes, delete** |
| D5 | `runAgentStoryGeneration` has no importer anywhere. Delete it? | **Not in this PR.** De-register only; FILM-1110 (#311) is editing it, so its deletion belongs there or in a follow-up |
| D6 | `create-film-project.action.ts` is also changed by KB-28 (#313) | **Sequence:** wrap it after #313 merges, as the last code commit. If #313 is still open then, report `NEEDS DECISION` rather than conflict |
| D7 | T7 drives the create-project form, so the browser posts a server action to a dev server. The CLAUDE.md form rule requires it; the lead's scope rule forbids live callability probes | **Write it:** UI-driven only, no hand-made action requests, covering only the wrapped create/cover actions. The lead should confirm |
| D8 | `apps/dev-tool`'s 4 plain `'use server'` exports | **Out of scope:** it is not deployed. Noted in the KB entry |
| D9 | Middleware pass-through and missing-`Origin` warning (§19) | **No change, no new ticket** |
