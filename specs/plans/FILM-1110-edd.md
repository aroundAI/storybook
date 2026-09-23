# FILM-1110 — Content Type Configurations: Engineering Design Document

| | |
|---|---|
| Ticket | [FILM-1110](../phase-11-canon-integration/content-types/FILM-1110-content-type-enum.yaml) — PARTIAL, effort S, phase 11 (priority critical) |
| Scope | The spec's one `remaining:` criterion: **"Memory context builder uses config for budget allocation"** |
| Branch / base | `feat/film-1110-content-type-budget` / `origin/main` (49b851d6) |
| Waiting on this | FILM-1111, FILM-1112, FILM-1113, FILM-1143 (§31, "What the dependents get") |
| Author / date | teammate `film-1110`, 2026-09-23 |

**Reading order for a reviewer in a hurry:** §8 (what is actually true today —
it is worse than the spec says), §29 (the four choices), §31 (the decisions
the owner is asked for), §32 (the work).

---

## 1. Start With the User

**Who.** The owner, working as the platform's first end-to-end user: they
create a project (a series, a documentary, an ad, …), generate episodes, and
rely on the platform to keep each new episode consistent with what earlier
episodes established — the canon.

**The problem.** When a story or screenplay is generated, the platform is
meant to load the project's canon — permanent events ("Mara died in
episode 3"), each character's current state, open plot threads, the world's
state and recent episode summaries — into a bounded amount of the model's
context, and check the new content against it. How much room each kind of
canon gets, and how many past episodes count, should depend on what the
project *is*: a 50-episode series needs long memory and thread tracking; an
ad needs almost none; a documentary spends its room on sources rather than
character arcs.

The configuration that says this exists (`CONTENT_TYPE_CONFIGS`), and the
builder has a branch that would use it. **Nothing ever reaches that branch.**
And measured against the code rather than the spec, the gap is wider:

1. No caller tells the builder the project's type, so every project gets the
   same fixed split and a 10-episode horizon.
2. Every caller that runs during generation runs in the LLM Lambda, and the
   builder **cannot even be loaded there** — it imports the Next.js
   cookie-based Supabase client, whose `server-only` guard throws at import
   in a non-Next bundle (reproduced, §8). The failure is caught and logged as
   "Validation checkpoint skipped" / a tool error, so generation carries on
   with **no canon at all**, silently.
3. Two of the builder's five reads name columns that do not exist
   (`assets.asset_type`, `episodes.episode_number`), so character states and
   episode summaries come back empty even where the builder does run.

**What the user gets when this exists.**

- When a story is generated, the continuity check actually loads the
  project's canon — for the first time in production.
- The amount loaded, and how it is split, follows the project's type: a
  series gets a larger budget weighted toward threads and a longer horizon;
  an ad gets a small budget weighted toward characters; a news project
  carries no narrative canon.
- Character states recorded by earlier episodes' canon commits reach the
  check, so the rules that read them — a state change reversed without cause
  (CANON_002), a character knowing what they have not learned (CANON_003) —
  can fire instead of passing because the character list was always empty.
  (Deaths are checked from immutable events, CANON_001, which load today
  wherever the builder runs at all.)

**What they see.** There is no new screen. The effect is visible where
continuity already surfaces: the story agent's continuity step and the
screenplay checkpoint's log line (`[Validation Checkpoint] SCREENPLAY: N
errors, …`) now run with real canon instead of being skipped, and each build
logs which content type, budget and horizon it used. The Memory Context
Preview panel that would display this is built but not rendered anywhere
(FILM-1007) and stays out of scope.

**Success.** For a project of each type, a generation-time memory build uses
that type's budget and horizon and returns the canon the database holds.
**Failure** looks like today: a build that is skipped, or that returns empty
sections while rows exist.

**Persistence.** Nothing new is stored. The project's type is already
persisted at creation (`projects.metadata.projectType`); the memory context
is built per request and discarded, as now.

**What this does not deliver** (so no one reads it into the change): episode
summaries and world states are still never *written* by anything (FILM-1004),
so the horizon has nothing to window in production until they are; sources
and parent-movie budgets are computed and reported but not filled (FILM-1111,
FILM-1113, FILM-1135); decay and priority scoring stay unused (FILM-1111).

---

## 2. Define the Complete User Journey

| # | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| 0 | *(precondition)* Creates a project and picks **Project Type** on the new-project form | `projects.metadata.projectType` saved (existing behaviour, unchanged) | Project created | Create episodes |
| 1 | Generates a story for episode *N* (Story tab → Generate) | Job queued to the LLM Lambda; story orchestrator runs with a continuity skill bound to this project and a server-side client | Progress as today | Wait |
| 2 | *(agent)* Continuity step calls `buildMemoryContext` | Builder reads the project's type, computes the type's budget and horizon, loads canon within it | Nothing directly; the agent's tool result now lists real counts instead of an error | Agent validates the draft |
| 3 | *(agent)* `checkContinuity` on the draft | Same build, then `validatePlotSkeleton` | Violations, if any, drive a revision (existing loop) | Story saved |
| 4 | Converts story to screenplay | Lambda runs the SCREENPLAY checkpoint with its own client | Checkpoint log shows counts instead of "skipped" | Continue |
| 5 | Changes Canon settings → Memory Horizon slider, saves | `metadata.canon.memoryHorizon` saved (existing) | Toast "Canon settings saved" (existing) | Next generation honours it — **if** decision D2 is accepted |

Re-entry, refresh, navigation away and cancellation behave exactly as the
existing generation flow: the memory build is a stateless read inside a job.
A session interruption cannot affect it — the Lambda path does not use the
user's session (it never could; that is defect 2).

---

## 3. Explicitly Define the Happy Path

Series project `P`, episode 6, canon rows present: 2 immutable events (one
a `death` of `Mara`), 1 character (`Jon`) with a `knowledge` state, 1 open
thread, summaries for episodes 1–5.

1. **User** clicks Generate on episode 6's story.
2. **System receives** an `llm_jobs` message `{ projectId: P, episodeId, … }`
   (existing).
3. **Processing.** The story orchestrator builds its skills with
   `createContinuitySkill({ client: supabase, projectId: P })`. The agent calls
   `buildMemoryContext({ episodeNumber: 6 })`; the tool supplies `P` itself.
4. **Data read.** `projects.metadata` for `P` → `projectType = 'series'` →
   budget 18% of 40,000 = **7,200 tokens**, split 35/25/10/20/10, horizon
   **50**. Then `immutable_events`, `assets` (`type = 'character'`),
   `character_states`, `narrative_threads`, `episodes` (`number` in
   [1, 6)) → `episode_summaries`, `world_states`.
5. **Returned.** A `MemoryContext` with 2 events, 1 character (Jon), 1
   thread, 5 summaries, `tokenBudget.total = 7200`,
   `metadata = { projectType: 'series', memoryHorizon: 50, budgets: {…} }`.
6. **User sees** the story generate; if the draft brings Mara back, the
   continuity check reports CANON_001; if Jon acts on something he has not
   learned, CANON_003 — and the agent revises (existing loop).
7. **Why this is success.** The build ran in the Lambda, used the series
   budget and horizon, and returned every category the database holds.

---

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| `metadata.projectType` missing (projects created before the field, or by `@kit/projects`' generic `createProject`) | Resolves to `series`; logs `projectTypeSource: 'default'` | Same as a series project | Set the type (no UI to change it today — §31 Q5) | Build succeeds |
| `metadata.projectType` is a string outside the enum | `ProjectTypeSchema.safeParse` fails → `series`, logged as `default` | As above | As above | Build succeeds |
| `metadata` unreadable (RLS denies the user, or project deleted) | Same fallback; every canon read returns 0 rows under RLS | Empty context, as today for an unreadable project | None needed | No data exposed |
| Project type `news` | Budget 5% (2,000); all five canon categories 0% (FILM-1111's table) | No narrative canon in the check — intended for news | FILM-1111 owns whether that is right | Build succeeds, mostly empty |
| Project type `documentary` / `educational` | 50% / 30% reserved for `sourcesCitations`, which the builder does not fill | Smaller canon sections; the reserve is reported, not used | FILM-1111/FILM-1135 fill it | Build succeeds |
| One canon read errors | That category is empty; error logged with the table name (existing behaviour, now with correct columns) | Check runs with less canon | Next build retries | Partial context |
| Builder throws (e.g. network) | Tool returns `toolError`; checkpoint returns its empty result and logs | Generation continues (unchanged, deliberate: canon is advisory at the screenplay checkpoint) | Next job | Same as today's failure mode, but now loud and rare rather than guaranteed |
| Episode number 1 | Horizon window [max(1, 1−h), 1) is empty → no summaries | None | — | Correct: nothing precedes episode 1 |
| Horizon larger than history | Window clamps at episode 1 | — | — | Correct |
| LLM passes a `projectId` in a tool call | Ignored: the tool's schema no longer has the field; the bound id is used | — | — | Cannot read another project (§19) |
| LLM passes `memoryHorizon` 0 or 10,000 | Clamped to 1–100 (the action's existing bounds) | — | — | Bounded read |
| Duplicate / retried job | The build is a pure read; a retry reads again | — | — | Idempotent |
| Concurrent canon writes | Build sees whatever committed first; no locking (read-only, per-request) | — | — | Acceptable: the next build sees the rest |
| Unauthenticated call to `buildMemoryContextAction` | `enhanceAction` rejects (existing) | — | — | Unchanged |

Large inputs: >1,000 rows in a table is §20. Session expiry, back navigation,
browser restart: not applicable — no client state is involved.

---

## 5. Establish the User-Facing Contract

- **Inputs the user controls:** the project's type (at creation) and, if D2
  is accepted, the Canon settings Memory Horizon slider. Nothing new.
- **Outputs:** no new UI. The observable contract is the `MemoryContext` the
  builder returns and the log line it writes:
  - `tokenBudget.total` = `floor(40000 × contextWindowPercent / 100)` for the
    project's type unless the caller passes `tokenBudgetPercent`.
  - `metadata.projectType` — the type that was used.
  - `metadata.memoryHorizon` — the horizon that was used.
  - `metadata.budgets` — the per-category token budgets, including
    `parentContext` and `sourcesCitations` (reported, not filled).
- **Permissions / visibility:** unchanged. In Next.js the user's client and
  RLS decide what is readable; in the Lambda, the service-role client reads
  only the project bound from the job (§19).
- **Error messages:** none user-facing are added or changed.

If implemented correctly, a user observes: continuity checks that used to be
skipped now run, and a series project's check sees further back than an ad's.

---

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Why | Trigger / input | Processing / output | Success | Failure | Verification |
|---|---|---|---|---|---|---|---|
| **FR-1** | The builder resolves the project's type itself from `projects.metadata.projectType`, validated against `ProjectTypeSchema`, falling back to `series` | The spec's criterion; no caller has to remember to pass it, so no caller can forget | `buildMemoryContext(client, { projectId, episodeNumber })` | One `projects` read; `metadata.projectType` in the result | Result reports the stored type | Missing/invalid → `series`, logged | Unit (fake client), real-DB verify |
| **FR-2** | Budget allocation, total budget and horizon come from the resolved type | The criterion itself | Resolved type | `total = 40000 × contextWindowPercent%`; per-category = total × allocation%; horizon per §15 precedence | `tokenBudget.total` and `metadata.budgets` match the table in §9 for every type | Default split used | Unit, one case per type (7) |
| **FR-3** | An explicit `projectType`, `tokenBudgetPercent` or `memoryHorizon` argument still overrides | Backward compatibility; the action's schema already accepts the latter two | Argument present | Argument wins | Result reflects argument | — | Unit |
| **FR-4** | The builder loads with any Supabase client handed to it and imports no Next-only module | Defect 2: without it every generation-time caller fails | Lambda bundle | Module loads under plain Node | `runValidationCheckpoint` returns `canonAvailable: true` for a seeded project | Throws "cannot be imported from a Client Component" | esbuild bundle-and-run test; real-DB verify |
| **FR-5** | Character states are read via `assets.type = 'character'` and summaries via `episodes.number` | Defect 3: both reads error today | Seeded rows | Rows returned | Non-empty `characterStates` / `recentSummaries` | PostgREST 400 → empty | **Real-DB verify only** (a fake client cannot reject a column) |
| **FR-6** | Every generation-time caller passes a server client: the story orchestrator's continuity skill, the screenplay checkpoint, and the Next.js action | Otherwise FR-4 has no effect | — | — | Each call site compiles against the new signature | — | Typecheck; bundle test |
| **FR-7** | The continuity tools use the project id bound when the skill is built, never one supplied by the model | The Lambda client is service-role; an LLM-chosen id would read any project | Tool call | Bound id used; tool schema has no `projectId` | Prompt-injected id has no effect | Cross-project read | Unit |
| **FR-8** | `CONTENT_TYPE_CONFIGS` and the type resolver are importable from client code (`@kit/episodes`) | FILM-1143's banner needs them in a client component | — | No server imports in `content-type-configs.ts` | Import from a client file compiles and bundles | — | Typecheck; bundle test covers it |
| **FR-9** | Each build logs one structured line: project, type, source of the type, total budget, horizon, horizon source, counts | §22 — the only way an operator can tell a skipped build from an empty one | Build | `console.info` (Lambda) | Line present in the verify run's output | — | Verify script asserts it; manual in PR |
| **FR-10** | There is one allocation table, not two | Two tables with different numbers is a drift defect already present (§8) | — | Per D1 | A test binds the two shapes or one is removed | — | Unit |

---

## 7. Define Non-Functional Requirements

| Area | Requirement |
|---|---|
| Latency | One extra indexed primary-key read (`projects` by id) per build: target < 5 ms locally. Whole build stays within FILM-1004's (unverified) < 200 ms; measured on the seeded verify fixture and reported in the PR. |
| Throughput / cost | No new LLM calls, no new tables. The builder now *runs* in the Lambda, which adds ~6–7 PostgREST reads per continuity tool call — at most 3 tool calls per story run (8–12 agent steps). Negligible against the LLM calls. |
| Token cost | Context loaded is bounded by the type's budget: max 8,000 tokens (movie), vs 6,000 today — but today the Lambda loads 0. Story runs will send up to ~8k more prompt tokens when canon exists. At current model prices this is cents per episode; §30 R4. |
| Security | No tenant can read another's canon through the new paths (FR-7, §19). |
| Reliability | A failed build degrades exactly as today (advisory). |
| Compatibility | `buildMemoryContextAction`'s input schema is unchanged; the return type gains fields only. |
| Maintainability | One allocation table (FR-10); one resolver for "what type is this project" used by server and client. |
| Observability | FR-9. |
| Accessibility, i18n | No UI change. |

---

## 8. Analyze the Existing System

### Components

| Component | File | Runs in | Role |
|---|---|---|---|
| Content type config | `packages/features/episodes/src/lib/canon/content-type-configs.ts` | — | `CONTENT_TYPE_CONFIGS` (7 types), `getContentTypeConfig`, `getProjectContentType` (never called; imports the Next cookie client at `:9`) |
| Memory strategies | `…/canon/memory-strategies.ts` | — | `MEMORY_ALLOCATIONS` (FILM-1111), `getMemoryOptionsForContentType`, `getDecayFactor`, `calculatePriority` |
| Memory context builder | `…/canon/memory-context-builder.ts` | — | `buildMemoryContext`; imports `getSupabaseServerClient` (`:8`) and calls it in each of five loaders |
| Server action | `packages/features/episodes/src/server/canon-actions.ts:647` | Next.js | `buildMemoryContextAction`; schema at `:92` has no `projectType` |
| Continuity skill | `packages/features/episodes/src/agent/skills/continuity-skill.ts` | **LLM Lambda** | Three agent tools, each `import()`s the builder; the model supplies `projectId`; `memoryHorizon ?? 10` at `:42` |
| Story orchestrator | `packages/features/episodes/src/agent/story-orchestrator.ts:116`, skills at `:269` | **LLM Lambda** | Only live user of the continuity skill; already receives `supabase` and `contentType` |
| Screenplay checkpoint | `apps/web/lambda/llm-worker/utils/validation-checkpoint.ts:90` | **LLM Lambda** | Calls the builder; receives `supabase` in its config (`:31`) and never uses it |
| Canon settings | `apps/web/app/home/[account]/studio/[projectSlug]/settings/_components/canon-settings-{form,actions}.ts(x)` | Next.js | Saves `metadata.canon = { memoryHorizon (1–20), enforcement, contentType ('series'\|'movie'\|'factual'\|'news'), … }` |

Dead callers, for completeness: `runContentOrchestrator`
(`agent/orchestrator.ts:97`) and `agent-story-generation.ts` have no callers;
`MemoryContextPreview` is never rendered (FILM-1004/FILM-1007).

### Current flow (as the code runs, not as the spec says)

```
Story Generate ─► llm_jobs ─► Lambda story-generation.ts
   └─► runStoryOrchestrator(input{contentType}, supabase)
         └─► continuitySkill.buildMemoryContext tool (projectId from the model)
               └─► import('…/memory-context-builder')
                     └─► @kit/supabase/server-client ─► 'server-only'  ✗ THROWS
               └─► toolError("Failed to build memory context: This module cannot be imported …")
   (agent continues without canon)

Screenplay ─► Lambda screenplay-conversion.ts:244
   └─► import('../utils/validation-checkpoint')  ✗ same throw
   └─► catch → console.warn('Validation checkpoint skipped')
```

### Defects found while planning (evidence)

| # | Defect | Evidence | Reproduced |
|---|---|---|---|
| D-a | No caller passes `projectType`; the content-type branch is unreachable | `memory-context-builder.ts:431`; callers `continuity-skill.ts:39,143,196`, `validation-checkpoint.ts:90`, `canon-actions.ts:649` | By reading all five call sites (`git grep -n buildMemoryContext`) |
| D-b | The builder cannot load outside Next.js | `memory-context-builder.ts:8` → `packages/supabase/src/clients/server-client.ts:1` (`import 'server-only'`); `server-only`'s default export is `throw new Error(…)` | **Yes.** Bundled `validation-checkpoint.ts` with esbuild (`--bundle --platform=node --format=esm`, as SST does) and called `runValidationCheckpoint`: `FAILED AT IMPORT/CALL: This module cannot be imported from a Client Component module. It should only be used from a Server Component.` The repo already knows the class: `llm-executor.ts:658` — "Avoids server-only import … which crashes in Lambda" — and ships `@kit/supabase/lambda-admin-client` for it |
| D-c | `assets.asset_type` does not exist (column is `type`) | `memory-context-builder.ts:146`; `database.types.ts` `assets.Row` has `type`, no `asset_type` | See §8 "Reproduced against the local database" |
| D-d | `episodes.episode_number` does not exist (column is `number`) | `memory-context-builder.ts:345-346`; `episodes.Row.number` | Same |
| D-e | Two allocation tables that disagree | `CONTENT_TYPE_CONFIGS.allocations` vs `MEMORY_ALLOCATIONS` — e.g. short-film 35/25/15/15/10 vs 30/30/10/15/15; news 5/5/5/5/5/10/65 vs 0/0/0/0/0/0/100 | Reading; neither is read by anything live |
| D-f | `contextWindowPercent` per type is never applied; the builder always uses 15% | `memory-context-builder.ts:411` | Reading |
| D-g | The continuity tools take `projectId` from the model | `continuity-skill.ts:24,131,184` | Reading. Harmless today only because D-b stops the read |
| D-h | Three "content type" fields on one project | `metadata.projectType` (creation form), `metadata.canon.contentType` (canon settings, read by nothing), `metadata.contentType` (read by `season-outline.ts:124`, written by nothing) | `git grep -n contentType` |

**Reproduced against the local database** (2026-09-23 02:17Z, DB lock held,
`supabase db reset` from this branch, service-role key from `supabase
status`; the builder's two filters sent to PostgREST as the client sends
them, each with the corrected column as a positive control):

| Request (project filter omitted) | Result |
|---|---|
| `assets?…&asset_type=eq.character` | **HTTP 400** `42703` "column assets.asset_type does not exist" |
| `assets?…&type=eq.character` | HTTP 200 `[]` |
| `episodes?…&episode_number=gte.1&episode_number=lt.6` | **HTTP 400** `42703` "column episodes.episode_number does not exist" |
| `episodes?…&number=gte.1&number=lt.6` | HTTP 200 `[]` |

The builder turns the first 400 into `console.error` + `[]`
(`memory-context-builder.ts:148-151`) and the second into a silent `[]`
(`:348-350`, no log at all), so both categories are always empty — while `character_states` *is* written in production, by
`apps/web/lambda/llm-worker/utils/commit-story-canon.ts:214`.

D-c and D-d are **not** recorded in FILM-1004's audit or FILM-CC-04; D-b is
not recorded as a known bug either (KB-14 is about the Lambdas not being
typechecked, which is why none of this surfaced).

### Where this change enters

The builder (all of it), `content-type-configs.ts` (drop the server import),
`memory-strategies.ts` (per D1), the three call sites that run it, and the
continuity skill's construction.

---

## 9. Define the Desired System Behavior

**Generate story (Lambda)** → story orchestrator builds skills with
`createContinuitySkill({ client, projectId })` → agent calls
`buildMemoryContext({ episodeNumber })` → tool calls
`buildMemoryContext(client, { projectId: bound, episodeNumber })` → builder
reads `projects.metadata`, resolves type and budgets, reads five canon
tables with the correct columns → returns `MemoryContext` → tool returns
counts to the agent → the agent's continuity step and check run on real canon.

**Screenplay checkpoint (Lambda)** → `runValidationCheckpoint` passes
`config.supabase` → same builder → `validateSceneBlocks` → log line.

**Preview action (Next.js)** → `buildMemoryContextAction` passes
`getSupabaseServerClient()` → same builder under RLS.

Resulting budgets (40,000-token window; allocation from `MEMORY_ALLOCATIONS`
per the recommended D1; horizon from `CONTENT_TYPE_CONFIGS`):

| Type | Total (%) | Events | Characters | World | Threads | Summaries | Sources (reported) | Parent (reported) | Horizon |
|---|---|---|---|---|---|---|---|---|---|
| *today, every type* | 6,000 (15) | 2,100 | 1,500 | 600 | 900 | 900 | — | — | 10 |
| short-film | 6,000 (15) | 1,800 | 1,800 | 600 | 900 | 900 | 0 | 0 | 10 |
| series | 7,200 (18) | 2,520 | 1,800 | 720 | 1,440 | 720 | 0 | 0 | 50 |
| movie | 8,000 (20) | 2,400 | 2,400 | 1,200 | 1,200 | 800 | 0 | 0 | 3 |
| documentary | 4,000 (10) | 400 | 200 | 200 | 400 | 800 | 2,000 | 0 | 5 |
| educational | 4,800 (12) | 720 | 720 | 480 | 720 | 720 | 1,440 | 0 | 5 |
| ad | 4,000 (10) | 800 | 1,600 | 600 | 400 | 600 | 0 | 0 | 1 |
| news | 2,000 (5) | 0 | 0 | 0 | 0 | 0 | 2,000 | 0 | 1 |

These are the numbers the unit tests assert, computed by hand from the two
tables — not read back from the code under test.

---

## 10. High-Level Architecture

No new services, queues, tables or caches. One library changes shape:

- **`content-type-configs.ts`** becomes pure and client-safe: the config
  table, `getContentTypeConfig`, and a new `resolveProjectType(metadata)`.
  *Why:* FILM-1143 needs it in a client component (FR-8); a pure resolver is
  also what lets server and client agree on a project's type.
- **`memory-context-builder.ts`** takes its Supabase client as an argument
  and never imports one. *Why:* FR-4 — it is the only way the one component
  that runs at generation time (the Lambda) can load it; it also follows the
  repo's existing answer to this class (`llm-executor`'s injected
  `supabaseClient`).
- **`createContinuitySkill({ client, projectId })`** replaces the static
  `continuitySkill`. *Why:* the tools need a client, and binding the project
  id at construction is the security boundary (FR-7).

Trust boundaries: the Next.js action runs as the user (RLS); the Lambda runs
as service role and trusts the job's `projectId` (authorised at enqueue —
KB-31 is hardening exactly that; §19). Failure boundary: a failed build is
contained inside the tool / checkpoint `try`, as today.

---

## 11. Architecture and Flow Diagrams

**Sequence — story generation after the change**

```
Lambda story-generation ─► runStoryOrchestrator(input, supabase)
   buildSkillsForContentType(contentType, { client: supabase, projectId })
      └─ createContinuitySkill({ client, projectId })   ◄── id bound here
   agent ─► tool buildMemoryContext({ episodeNumber })
      └─► buildMemoryContext(client, { projectId, episodeNumber })
             ├─ projects.metadata ─► resolveProjectType ─► 'series'
             ├─ options = getMemoryOptionsForContentType('series')
             ├─ horizon = arg ?? canon.memoryHorizon* ?? options.memoryHorizon
             ├─ parallel: immutable_events · assets(type=character)+character_states
             │            · narrative_threads · episodes(number in window)+episode_summaries
             └─ world_states
          ◄── MemoryContext{ tokenBudget.total=7200, metadata.projectType='series', … }
      * only if D2 accepted
```

**Module dependencies — before / after**

```
before:  continuity-skill ─import()─► memory-context-builder ─► @kit/supabase/server-client ─► server-only ✗
                                      content-type-configs    ─► @kit/supabase/server-client ─► server-only ✗
after:   continuity-skill(client) ─► memory-context-builder(client) ─► (types only)
         content-type-configs ─► @kit/film-studio-schemas/project (zod enum) — client-safe
```

---

## 12. End-to-End Data Flow

| Stage | Detail |
|---|---|
| Source | `projects.metadata.projectType` (written by `create-film-project.action.ts:59` from the form's validated `settings`); canon tables written by `commit-story-canon.ts` (Lambda) and canon actions |
| Validation | `ProjectTypeSchema.safeParse` on read — the column is JSONB and untyped, so the reader validates rather than casts (today's `getProjectContentType` casts) |
| Transformation | type → options → per-category budgets (integer floors) |
| Filtering | Horizon window on `episodes.number`; status filter on threads (unchanged) |
| Ordering | Unchanged per loader (events oldest first, states/threads newest first) |
| Persistence | None — the context is not stored |
| Consumers | Continuity tools (agent), screenplay checkpoint, preview action |
| Retention / deletion | N/A |

**Where data can go wrong:**

- *Stale:* a type changed after a job is enqueued is read at build time —
  the build uses the current type. Acceptable; there is no UI to change it.
- *Lost:* PostgREST's 1,000-row cap applies to `immutable_events`,
  `narrative_threads`, `character_states` reads. Budgets hold at most a few
  dozen items, so truncation cannot reduce what fits *unless* the rows kept
  are the wrong ones: events are read oldest-first, so past 1,000 events the
  newest are never considered. Pre-existing, not changed here; recorded in
  §30 and for FILM-1111 (which owns priority ordering).
- *Incorrectly transformed:* rounding — budgets are `Math.floor`, so the sum
  can be up to 4 tokens under the total. Asserted, not hidden.
- *Partially processed:* a single loader error empties that category only
  (unchanged).

---

## 13. Data Model

No new entities. Authoritative sources:

| Datum | Authoritative | Notes |
|---|---|---|
| Project type | `projects.metadata.projectType` | Per the spec ("not a new column"). `metadata.canon.contentType` and `metadata.contentType` are **not** authoritative (D-h, §31 Q4) |
| Horizon override | `projects.metadata.canon.memoryHorizon` — only if D2 accepted | Present only once canon settings are saved |
| Per-type budgets / horizon | Code: `CONTENT_TYPE_CONFIGS` (+ `MEMORY_ALLOCATIONS` per D1) | Derived, not stored |
| `MemoryContext` | Derived per request | `metadata` gains `projectType`, `projectTypeSource`, `memoryHorizonSource`, `budgets` |

Invariant (asserted by test): for every `ProjectType`, the allocation used by
the builder sums to 100 and every category the builder reads has a budget.

---

## 14. Database Design and Changes

**None.** No migration, no RLS change, no typegen. The two column fixes
(D-c, D-d) correct the *reads* to match the existing schema.

Indexes relied on (existing): `projects` PK; `idx_assets_project_type` on
`assets(project_id, type)` — the corrected character read can now use it,
where the broken one could not run at all; `episodes(project_id, …)`.

---

## 15. Low-Level Design

### `content-type-configs.ts` (client-safe)

- Remove the `@kit/supabase/server-client` import and `getProjectContentType`
  (never called).
- Add:
  ```ts
  export type ProjectTypeSource = 'argument' | 'metadata' | 'default';
  export function resolveProjectType(metadata: unknown):
    { projectType: ProjectType; source: 'metadata' | 'default' }
  // reads (metadata as object)?.projectType, ProjectTypeSchema.safeParse,
  // falls back to DEFAULT_PROJECT_TYPE = 'series'
  ```
- `getContentTypeConfig` unchanged.
- Per D1 (recommended): remove `allocations` from `ContentTypeConfig`; the
  allocation lives in `MEMORY_ALLOCATIONS` only. (Alternative D1-b keeps it
  and derives `MEMORY_ALLOCATIONS` from it — §29.)

### `memory-context-builder.ts`

```ts
type CanonReadClient = SupabaseClient<Database>;   // type-only import

export async function buildMemoryContext(
  client: CanonReadClient,
  input: BuildMemoryContextInput,
): Promise<MemoryContext> {
  const project = await client.from('projects').select('metadata')
                              .eq('id', input.projectId).maybeSingle();
  const resolved = input.projectType
    ? { projectType: input.projectType, source: 'argument' }
    : resolveProjectType(project.data?.metadata);
  const options = getMemoryOptionsForContentType(resolved.projectType);
  const percent = input.tokenBudgetPercent ?? options.maxTokenPercentage;
  const [memoryHorizon, horizonSource] =
      input.memoryHorizon            ? [clamp(input.memoryHorizon,1,100), 'argument']
    : savedCanonHorizon(metadata)    ? [it, 'canon-settings']        // D2
    :                                  [options.memoryHorizon, 'content-type'];
  const total = floor(CONTEXT_WINDOW × percent / 100);
  const budgets = mapValues(options.allocation, pct => floor(total × pct / 100));
  … five loaders, each (client, …) — with 'type' and 'number' …
  log FR-9 line
  return { …, metadata: { builtAt, memoryHorizon, totalTokensUsed,
                          projectType, projectTypeSource, memoryHorizonSource, budgets } };
}
```

- The `projects` read and the canon reads are independent; the `projects`
  read must finish first (it decides budgets), then the four parallel loaders
  run as today. One extra round trip.
- `maybeSingle()` rather than `single()`: a missing row is a fallback, not an
  error.
- The dynamic `import('./memory-strategies')` becomes a static import (it is
  pure).
- Loaders get the client as their first parameter; their bodies change only
  in the two column names.
- Client first, as a required parameter, makes a forgotten client a compile
  error rather than an `undefined` at run time.

### `continuity-skill.ts`

```ts
export function createContinuitySkill(deps: {
  client: CanonReadClient; projectId: string;
}): Skill
```

Each tool's zod schema drops `projectId`; `execute` uses `deps.projectId`.
`buildMemoryContext` tool keeps an optional `memoryHorizon` (described as
"default: the project's content type"), clamped by the builder. The static
`continuitySkill` export is removed, and its two dead importers
(`agent/orchestrator.ts`, `server/agent-story-generation.ts`) are switched to
the factory with the client they already have / `getSupabaseServerClient()`,
so nothing keeps compiling against a skill that cannot work.

### Call sites

| File | Change |
|---|---|
| `story-orchestrator.ts` `buildSkillsForContentType` | add `deps: { client, projectId }`; `createContinuitySkill(deps)` |
| `validation-checkpoint.ts:90` | `buildMemoryContext(config.supabase, { … })` |
| `canon-actions.ts:649` | `buildMemoryContext(getSupabaseServerClient(), data)` |
| `agent/orchestrator.ts:114`, `server/agent-story-generation.ts:176` | factory (dead code kept compiling) |

`BuildMemoryContextSchema` is **not** given `projectType`: a project's type
is the project's, not something a client should be able to choose per call.

No transactions, locking, retries or caching: a per-request read.

---

## 16. API and Event Design

| Interface | Change | Compatibility |
|---|---|---|
| `buildMemoryContext(input)` → `buildMemoryContext(client, input)` | Breaking for in-repo callers (all five updated in this PR); no external consumers | Compile-time: every caller must change, so none can be missed |
| `buildMemoryContextAction` (server action) | Input unchanged; output gains `metadata.{projectType, projectTypeSource, memoryHorizonSource, budgets}` | Additive |
| `MemoryContext.metadata` type | Gains four fields | Additive (four new fields); `MemoryContextPreview` reads only existing fields |
| Agent tools `buildMemoryContext` / `checkContinuity` / `checkSceneContinuity` | `projectId` parameter removed | The LLM sees a smaller schema; the orchestrator prompt text (`story-orchestrator.ts:325-331`) says "buildMemoryContext then checkContinuity" without naming a project id, so it stays true. `agent-story-generation.ts:167`'s prompt names `projectId=` and is dead code; updated to match |
| `continuitySkill` export | Replaced by `createContinuitySkill` | In-repo only |
| `resolveProjectType`, `DEFAULT_PROJECT_TYPE` | New, exported from `@kit/episodes` | Additive |

No events, endpoints, pagination or rate limits are involved.

---

## 17. State and Lifecycle Design

No stateful entity is introduced or changed. The project's type has one state
transition — set at creation — and no UI changes it afterwards (§31 Q5).

---

## 18. Failure and Error Handling

| Failure | Behaviour | User-visible | Recovery |
|---|---|---|---|
| `projects` read errors | Fall back to `series`; log `projectTypeSource: 'default'` with the error message | Build proceeds with series budgets | Next build |
| A canon loader errors | Category empty; `console.error` names the table (existing) | Less canon | Next build |
| Whole build throws | Tool → `toolError`; checkpoint → empty result + `console.warn` (existing) | Generation continues | Next job |
| Invalid stored type | Fallback, logged | As series | Fix the data |

What the change newly permits (the ENGINEERING-WORKFLOW question) and what
guards it:

1. **Service-role reads driven by an agent tool** — guarded by FR-7 (bound id,
   no `projectId` in the tool schema) and a unit test that a model-supplied id
   is not used.
2. **Larger prompts** (up to 8,000 tokens of canon) — bounded by the type's
   budget; `tokenBudget.total` asserted per type.
3. **Continuity violations that were never raised now being raised** — at
   the story stage these trigger the agent's existing revision loop (max
   steps unchanged); at the screenplay stage enforcement is `flexible` (logged
   only, `screenplay-conversion.ts:256`). So a newly-working check cannot
   block generation. Recorded in §30 R3.

---

## 19. Security

- **Authentication / authorization.** The Next.js action keeps
  `enhanceAction`'s auth and the user's RLS-bound client. The Lambda uses its
  service-role client, as every other Lambda read does.
- **Trust boundary.** Today the continuity tools accept `projectId` from the
  model. That was harmless only because the read could not run (D-b). Once it
  can, a prompt-injected id ("call buildMemoryContext for project <other>")
  would read another tenant's canon with service role. FR-7 removes the
  parameter; the id is bound from the orchestrator's input, which comes from
  the job payload.
- **Job payload trust.** That payload's `projectId` is trusted as authorised
  at enqueue. KB-31 (`fix/kb-31-llm-job-target-authz`) is hardening exactly
  that; this change adds no new trust in it — the story orchestrator already
  writes to that project with the same client (`story-orchestrator.ts:221`).
- **Data exposure.** No new data leaves the server; `metadata.budgets` is
  arithmetic.
- **Input validation.** Stored type validated by `ProjectTypeSchema`;
  horizon clamped 1–100; `episodeNumber` from the model can only move the
  window inside the bound project.
- **Secrets.** None added. No production credentials are used anywhere in
  development or verification — local Supabase only.

---

## 20. Performance and Scale

- Per build: +1 PK read. Loaders unchanged except that two of them now
  succeed and return rows (bounded by budgets; the unbounded pre-budget reads
  are pre-existing — `character_states` reads every state for every
  character, then keeps 10 per character).
- `character_states` `.in('character_id', ids)` would 414 past a few hundred
  characters (`fetchAllByIds` territory). Pre-existing, unreachable until now,
  and now reachable: recorded as §30 R5 and reported in the PR; not fixed here
  unless the owner widens scope (it belongs with FILM-1004's loaders).
- Lambda: ≤ 3 builds per story run; reserved concurrency 3. No scaling
  concern.
- Measured build time on the verify fixture goes in the PR.

---

## 21. Accessibility and Client Behavior

No UI is added or changed. (FILM-1143 will render the type; it inherits
nothing here beyond the resolver.)

---

## 22. Observability and Operations

- **Log line (FR-9)**, one per build, structured:
  `[MemoryContext] project=<id> type=series(metadata) budget=7200 horizon=50(content-type) events=2 characters=1 threads=1 summaries=5 world=1 tokens=1843`.
  `console.info`, because the builder runs in both runtimes and the Lambda
  has no `getLogger`; existing canon logs use `console` too.
- **How an operator knows it works:** in the Lambda's logs, a story run shows
  this line instead of `Failed to build memory context: This module cannot be
  imported…`, and the screenplay checkpoint shows
  `[Validation Checkpoint] SCREENPLAY: …` instead of `Validation checkpoint
  skipped`.
- **Distinguishing expected from failure:** `type=…(default)` on a project
  that has a type means the metadata read failed; `characters=0` with rows in
  `character_states` means a loader failed (its own error line precedes it).
- No metrics, dashboards or alerts are added (none exist for this pipeline).

---

## 23. Configuration and Feature Flags

- No env vars, secrets or flags. The Lambda already has
  `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (sst.config.ts,
  llm-worker environment) and the client is passed in, not built.
- The behaviour is code configuration (`CONTENT_TYPE_CONFIGS`,
  `MEMORY_ALLOCATIONS`). A malformed stored type falls back to `series`.
- **No feature flag.** The change turns on a path that is fully off today and
  advisory once on (§18 item 3). A flag would default to off and leave the
  criterion unmet. If the owner wants a kill switch anyway, it is a one-line env check in
  the builder; say so in review.

---

## 24. Compatibility

- Existing projects without `projectType` resolve to `series`: 7,200
  tokens and a 50-episode horizon, where the (unreachable) default today is
  6,000 and 10. For those projects the change is a larger budget. Stated,
  not hidden.
- `buildMemoryContextAction` clients: input unchanged, output additive.
- The Lambda and the Next.js app deploy together (one SST deploy); the
  builder is bundled into each, so there is no version skew between them.
- No database or event compatibility concerns.

---

## 25. Migration and Rollout Strategy

- No schema or data migration.
- Deploy: normal merge → SST deploy. Order does not matter.
- Validation gate before merge: the real-DB verify (§26) green locally and
  in CI's Supabase DB job; the bundle test green in Unit Tests.
- After deploy (owner, one-person runbook): generate one story on a project
  with canon; in CloudWatch for the llm-worker, find the `[MemoryContext]`
  line with the right type and non-zero counts, and no `Failed to build
  memory context`.
- Rollback trigger: generation failures or cost spikes attributable to canon
  in the prompt. Rollback: revert the PR (no data to undo).

---

## 26. Testing Strategy

Each test is written to fail first on `main` for the stated reason.

| Layer | Test | Proves | Red on main because |
|---|---|---|---|
| Unit (`packages/features/episodes/__tests__/memory-context-builder.test.ts`, new) | For each of the 7 types, a fake client whose `projects` read returns that type; assert `tokenBudget.total`, `metadata.budgets`, `metadata.memoryHorizon` against §9's hand-computed table | FR-1, FR-2 | Builder ignores the stored type (every total is 6,000) |
| Unit | Missing / invalid / unreadable type → `series`, `projectTypeSource: 'default'` | FR-1 edges | Field absent |
| Unit | Explicit `projectType` / `tokenBudgetPercent` / `memoryHorizon` args win; horizon clamps | FR-3 | Horizon not clamped |
| Unit | Horizon precedence incl. saved `canon.memoryHorizon` (if D2) | D2 | Not read |
| Unit | Fake client records the filters used: `assets` filtered on `type`, `episodes` on `number` | FR-5 (call shape only — a fake cannot reject SQL; the real proof is below) | Filters name the wrong columns |
| Unit (`continuity-skill.test.ts`, new) | Tool schemas have no `projectId`; a call that smuggles one reads the bound id | FR-7 | Schema has it; model id used |
| Unit | Allocation for every type sums to 100 and covers every category the builder reads | FR-10 | Two tables disagree (D1-dependent) |
| **Bundle** (`apps/web/lambda/llm-worker/__tests__/canon-bundle.test.ts`, new) | esbuild-bundles `utils/validation-checkpoint.ts` exactly as SST does (node, esm, no `react-server` condition), imports it, and calls `runValidationCheckpoint` with a stub client returning no rows → resolves with `canonAvailable: true` | FR-4, FR-8 — the only layer that sees D-b; vitest aliases `server-only` to a mock (`episodes/vitest.config.ts:9`), so no unit test can | Import throws the `server-only` error (reproduced, §8) |
| **Real DB** (`packages/features/episodes/scripts/verify-memory-context.ts`, new; `pnpm --filter @kit/episodes verify`) | Seeds, via service role on local Supabase, one project per type (series, documentary, ad, news) with events, a character + state, a thread, 5 episodes + summaries; calls the real builder with a real client; asserts counts per category, the resolved type, totals, horizon windowing (series ep 6 → 5 summaries; ad ep 6 → 1), and that no loader logged an error; cleans up | FR-1, FR-2, FR-5 against a real PostgREST — the only layer that can reject a column | `characters=0`, `summaries=0` (PostgREST 400), and totals 6,000 |
| Mutation guards (`tooling/mutation-guards/film-1110.json`) | Unit entries: restore `asset_type`; restore `episode_number` (for the call-shape test); drop the stored-type read; re-add `projectId` to a tool schema; re-add the server-client import to `content-type-configs.ts` (bundle test) | That each guard stays a guard | — |
| Typecheck | `pnpm typecheck` | All callers updated | — |
| E2E | **None.** No form or interactive component changes; the preview panel is unrendered. Driving a full story generation needs a live LLM — out of scope for a test | — | — |

The verify script runs locally under the DB lock and, per D3, as one extra
step in CI's `🐘 Supabase DB` job next to `@kit/supabase verify`.

---

## 27. Production-Build Verification

The production artifact that matters is the **Lambda bundle**, not the Next
build — the defect is invisible to `next build` (Next resolves `server-only`
to its empty `react-server` entry). So:

1. The bundle test (§26) reproduces SST's esbuild step and runs the result.
2. Locally, the same bundle is run against the seeded local database with the
   local service-role key (from `supabase status`, never a production value)
   and the `[MemoryContext]` line is captured for the PR.
3. `pnpm --filter web build` (heavy slot) confirms the Next side still builds
   with the action's new call.

Does the production build produce the behaviour? Steps 1–2 answer it for the
Lambda; nothing else in production runs the builder.

---

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Production verification |
|---|---|---|---|---|---|---|---|
| Canon reaches generation | §3 steps 3–5 | FR-4, FR-6 | §15 client injection | builder, skill, checkpoint | `buildMemoryContext(client, …)` | Bundle test; verify script | §27 (1–2); post-deploy log |
| Budget follows type | §3 step 4 | FR-1, FR-2, FR-3 | §15 resolve + options | builder | `projects.metadata` | Unit ×7; verify | `[MemoryContext] type=…` line |
| Characters and summaries load | §3 step 4 | FR-5 | column fixes | loaders | `assets.type`, `episodes.number` | Verify script (real PostgREST) | counts in log line |
| No cross-project reads | §4 row "LLM passes a projectId" | FR-7 | bound id | skill | tool schema | Unit | — (security property; test is the proof) |
| FILM-1143 can show the type | — | FR-8 | pure resolver | configs | — | Bundle test (imports it without server deps) | FILM-1143's own |
| One allocation table | — | FR-10 | D1 | strategies/configs | — | Unit | — |
| Operator can tell it works | — | FR-9 | log line | builder | — | Verify asserts line | CloudWatch check (§25) |

No requirement lacks a test; no test lacks a requirement. The one production
behaviour without automated verification is the post-deploy log check, which
is manual by nature (§25).

---

## 29. Architectural Alternatives and Trade-offs

**A1 — How the builder gets a client.**
- *Chosen:* required first parameter. Compile-time guarantee every caller
  passes one; no Next import; matches `llm-executor`'s `supabaseClient`.
- *Alt:* optional parameter defaulting to `getSupabaseServerClient()` via
  dynamic import. Fewer call-site edits, but keeps a hidden Next dependency
  and a runtime failure mode for any caller that forgets.
- *Alt:* `createLambdaAdminClient()` inside the builder. Would make the
  Next.js action read as service role, bypassing the user's RLS — rejected.

**A2 — Where the type is resolved.**
- *Chosen:* inside the builder, from the database. No caller can forget; the
  one `remaining:` bullet was precisely that callers forgot.
- *Alt:* each caller passes `projectType` (the story orchestrator already has
  it). Five places to keep right, and the checkpoint and action do not have
  it.

**A3 — Which allocation table (D1).**
- *D1-a (recommended):* `MEMORY_ALLOCATIONS` is the single table;
  `ContentTypeConfig.allocations` is removed. It is what the builder's branch
  already reads, its keys are the builder's categories, and it has the
  `parentContext` slot FILM-1113 needs. Cost: FILM-1110's spec text listed
  `allocations` in the interface — the spec's notes are updated to say
  allocation moved to FILM-1111's table.
- *D1-b:* `CONTENT_TYPE_CONFIGS.allocations` is the table; `MEMORY_ALLOCATIONS`
  is derived (`facts + external → sourcesCitations`, `parentContext: 0`).
  Honours FILM-1110's numbers; breaks FILM-1111's met criterion "documentary
  allocates 50% to sources" (derived value 45) and its "news 100% sources"
  test; FILM-1113 then needs a new field anyway.
- *D1-c:* keep both, add a test that they agree. Requires editing numbers in
  one of them to agree — D1-a or D1-b with extra steps.

**A4 — Binding the project id.** Factory with bound id (chosen) vs keeping
the parameter and asserting it equals the bound id (a model that is told the
id could still be tricked into a mismatch, which then only errors). The
factory removes the surface.

**A5 — Test layer for the column fixes.** A mocked client cannot reject a
column (ENGINEERING-WORKFLOW, "What each layer can see"), so the call-shape
unit test is only a tripwire; the verify script against real PostgREST is the
proof, and it is the pattern CI already uses (`@kit/supabase verify`).

---

## 30. Risk Register

| # | Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | A caller missed → still uses the cookie client | That path stays broken | Typecheck (signature change makes it a compile error); bundle test | Required parameter | — |
| R2 | Lambda files are not typechecked (KB-14), so a Lambda call site can be wrong and green | Checkpoint passes wrong args | Bundle test executes the checkpoint | KB-14 will add the check; the bundle test covers this path meanwhile | — |
| R3 | Canon checks that never ran start raising violations | Story agent revises more (cost/latency) | Log lines; agent step counts | Screenplay enforcement is `flexible`; story agent's max steps unchanged | Revert |
| R4 | Larger prompts cost more | Up to ~8k tokens per build where canon exists | LLM usage logs (`llm_usage`) | Budgets are bounded per type | Lower `contextWindowPercent` |
| R5 | `character_states` `.in()` 414s for a project with hundreds of characters | Characters empty for that project | Loader error line | Pre-existing; reported | `fetchAllByIds` (FILM-1004) |
| R6 | Series default horizon 50 vs canon slider max 20 | Saving canon settings silently lowers a series' horizon (D2) | Log `horizon=…(canon-settings)` | Owner decision D2 | Adjust precedence |
| R7 | Overlap with KB-31 / KB-14 / KB-27 files | Merge conflicts | — | Edits are a few lines in each shared file | Rebase |
| R8 | News projects get zero narrative canon | By design of FILM-1111's table; could surprise | Log `type=news` | FILM-1111 owns | — |

---

## 31. Open Questions and Assumptions

### Decisions for the owner (each with a recommended default)

- **D1 — One allocation table.** Which wins: FILM-1111's `MEMORY_ALLOCATIONS`
  (**recommended**, D1-a) or FILM-1110's `CONTENT_TYPE_CONFIGS.allocations`
  (D1-b)? *Why it matters:* they disagree for every type; the loser is
  removed or derived. *Assumed:* D1-a.
- **D2 — Does the saved Canon settings horizon override the type's?**
  **Recommended: yes** — the settings page tells the user the slider sets
  "how many prior episodes to consider", so ignoring it would make that page
  false. Consequence: once canon settings are saved, a series uses the slider
  (1–20), not 50. Alternative: the type wins and the slider stays
  dashboard-only (stale-thread threshold, `canon-actions.ts:717`), and its
  description is corrected in a follow-up.
- **D3 — Run the real-DB verify in CI** as one step in the `🐘 Supabase DB`
  job? **Recommended: yes** — the column defects are exactly the kind only a
  real PostgREST sees, and that job already starts one. Cost: seconds.
- **D4 — Scope of the Lambda fix.** Making the builder loadable in the Lambda
  (FR-4/FR-6/FR-7) is larger than the spec's one bullet. **Recommended:
  include** — without it the criterion is met in a library no production
  path can load, and the audit's rule is that DONE means "in the product".
  Alternative: FILM-1110 fixes resolution + columns only (Next-side), and the
  Lambda half becomes a new KB entry.

### Questions recorded, not blocking

- **Q4 — Three content-type fields (D-h).** `metadata.projectType` is
  authoritative here. `metadata.canon.contentType` (the Canon settings
  "Content Type" select) drives nothing; `metadata.contentType` is read by
  `season-outline.ts:124` and written by nothing, so a documentary's season
  outline never gets its facts. *Assumed:* out of scope; reported in the PR
  for FILM-1143 (season dialog) and as a known-bug candidate. `resolveProjectType`
  is the one-line fix for the season outline when someone takes it.
- **Q5 — No UI changes a project's type after creation**, and the create form
  does not offer `news` (the enum does). *Assumed:* out of scope.
- **Q6 — News horizon 0 vs 1** — FILM-1111's open `remaining:` item; the
  builder takes whatever the config says.

### Assumptions

- The job payload's `projectId` is authorised at enqueue (KB-31's subject).
- `episodes.number` is the project-wide episode number the horizon should
  window over (it is what `getCanonHealthAction` uses, `canon-actions.ts:696`).

### What the dependents get from this change

| Ticket | Needs from FILM-1110 | Provided by this change | Still theirs |
|---|---|---|---|
| **FILM-1111** Memory strategies | The builder to use content-type strategies for *real* callers | Type resolved in the builder; `getMemoryOptionsForContentType` is the single entry point for allocation/horizon/total; `metadata.budgets` reported; builder runs in the Lambda | Using `calculatePriority`/`getDecayFactor` inside the loaders (they can now, per item, with the resolved type in scope); filling `sourcesCitations`; news horizon decision |
| **FILM-1112** Act context bridge | Know a project is a movie, at generation time, with a working client | `resolveProjectType` and the `(client, input)` pattern; the movie's budget (8,000) and horizon (3) | `act-context-bridge.ts` still imports the Next client (same class as D-b — must adopt the injected-client pattern before it can run in the Lambda); storing and reading bridges |
| **FILM-1113** Sequel system | A `parentContext` budget slot the builder honours | With D1-a, `parentContext` stays in the single table and is reported in `metadata.budgets.parentContext` (0 for every type today) | Setting a non-zero `parentContext` for sequels (sequel is a relation, `projects.sequel_of`, not a `ProjectType` — no enum change needed); filling it via `getSequelParentContexts`; `sequel-system.ts` has the same Next-client import |
| **FILM-1143** Generate Season | The project's type on the client, and whether it is factual/news | `resolveProjectType(project.metadata)` + `getContentTypeConfig(type).requiresFacts / requiresExternalContext`, client-safe from `@kit/episodes` | The banner; typing its prop as `ProjectType` rather than the canon-settings taxonomy (`'series'\|'movie'\|'factual'\|'news'`); Q4 |

---

## 32. Implementation Plan

Ordered by dependency. Each stage is a commit.

1. **Tests first (red).** New builder unit tests (7 types, fallbacks,
   precedence, call shape), continuity-skill tests, bundle test, verify
   script. Run them on `main` code and record each failure's reason for the
   PR. *DB:* verify script under the DB lock after `db reset`.
2. **`content-type-configs.ts`** — remove the server import and
   `getProjectContentType`; add `resolveProjectType`. Per D1, remove
   `allocations` (D1-a) or derive (D1-b); update
   `content-type-configs.test.ts` accordingly.
3. **`memory-context-builder.ts`** — client parameter; `projects` read and
   resolution; options-driven total/allocation/horizon (with D2 precedence);
   column fixes; metadata fields; log line. Update `types.ts`
   (`MemoryContext.metadata`).
4. **`continuity-skill.ts`** — `createContinuitySkill`; bound id; update
   `skills/index.ts` export.
5. **Call sites** — story orchestrator, validation checkpoint, canon action,
   the two dead importers.
6. **Green:** unit, bundle, verify (DB lock), `pnpm typecheck` (heavy slot),
   `pnpm --filter web build` (heavy slot).
7. **Red-before-green proof** for every guard; add
   `tooling/mutation-guards/film-1110.json`; run
   the film-1110 entries with `python3 tooling/mutation-guards/run.py --kind unit`.
8. **CI step** (if D3): `pnpm --filter @kit/episodes verify` in the Supabase
   DB job.
9. **Records:** FILM-1110 spec (`met`, `evidence`, `remaining: []`, status
   per §33), note in FILM-1111's `remaining` that the "no caller passes
   projectType" half is closed (its decay/scoring half stays), FILM-1004's
   audit reasons updated for D-c/D-d, `specs/INDEX.md` row.
10. `pnpm lint:fix`, `pnpm format:fix`, push, PR.

Rollback at any stage is a revert; no stage touches data.

---

## 33. Definition of Done

- [ ] For each type, a real-DB build returns that type's total, split and
      horizon (verify script, measured table in the PR).
- [ ] Character states and episode summaries load from a real database.
- [ ] The Lambda bundle loads the builder and the checkpoint returns
      `canonAvailable: true` (bundle test + local run log in the PR).
- [ ] Continuity tools cannot be pointed at another project.
- [ ] One allocation table.
- [ ] Every guard seen red on `main`-equivalent code, with the reason; mutation
      guard entries recorded.
- [ ] `pnpm typecheck`, episodes + web unit tests, `next build`, lint, format.
- [ ] FILM-1110 `status: DONE` — its only open criterion is the builder's use
      of the config, which the above closes. FILM-1111/1112/1113/1143 keep
      their own open items, updated where this closes part of one.
- [ ] Siblings reported in the PR: `act-context-bridge.ts`,
      `sequel-system.ts`, `documentary/helpers.ts` import the Next client (D-b
      class); `season-outline.ts:124` reads a field nothing writes (D-h);
      R5.

---

## 34. Final Consistency Pass

**Forward.** Problem: generation runs without canon, and even where the
builder runs, every project is treated alike and two reads fail. Outcome:
canon reaches generation, sized by type. User action: generate a story —
unchanged. System: the Lambda loads the builder with its client, resolves
the type, sizes and loads canon (FR-1–6). Data: reads only. Architecture:
client injection + in-builder resolution. Tests: bundle test sees the
Lambda failure, verify script sees the column failures, unit tests pin the
arithmetic. Deploy: plain. Production: the `[MemoryContext]` log line.

**Reverse.** In production the system will: on each continuity tool call and
each screenplay checkpoint, read `projects.metadata` and five canon tables for
the job's project with the service-role client, and log one line. That
produces continuity checks that run with canon sized for the project type —
the user flow in §2–3, and the spec's criterion ("memory context builder uses
config for budget allocation") for every caller rather than none.

**Where they do not fully converge, stated:** the horizon has no observable
production effect until something writes `episode_summaries` (FILM-1004); the
sources and parent budgets are reported but unfilled (FILM-1111/1113/1135).
Both are outside FILM-1110's criterion and are said so in §1 rather than left
for a reader to discover.
