# FILM-1111 — Content Type Configurations and Memory Strategies: Engineering Design Document

| | |
|---|---|
| Ticket | [FILM-1111](../phase-11-canon-integration/content-types/FILM-1111-content-type-configs.yaml) — PARTIAL, effort M, phase 11 (priority critical) |
| Scope | The spec's two `remaining:` items, as FILM-1110 left them: **"`buildMemoryContext` uses content-type strategies"** (decay + priority scoring; the `sourcesCitations` and `parentContext` budgets) and **"News type has zero memory horizon"** |
| Branch / base | `feat/film-1111-content-type-configs` / `origin/feat/film-1110-content-type-budget` (e84c1810), stacked on PR #311 |
| Depends on | FILM-1110 (#311): type resolved in the builder, injected client, one allocation table, `memory-horizon.ts` |
| Waiting on this | FILM-1112 (act bridge), FILM-1113 (sequels) |
| Author / date | teammate `film-1111`, 2026-09-23 |

**Reading order for a reviewer in a hurry:** §8 (what is true today, and
one finding that changes what "decay" can do), §29 (the choices), §31 (the
decisions asked of the owner), §32 (the work).

---

## 1. Start With the User

**Who.** The owner, as the platform's first end-to-end user: they create a
project of some type (series, documentary, news, …), generate episodes, and
rely on the story agent's continuity step to load the project's canon — the
permanent events, character states, open plot threads, episode summaries and,
for factual work, verified facts — and check new content against it.

**The problem.** After FILM-1110 the canon a build loads is *sized* by the
project's type, but not *chosen* by it. Two gaps remain:

1. **What goes first when the budget is full is arbitrary.** A series
   budgets 1,800 tokens for characters and 1,440 for threads — room for a
   handful of each. When a project has more, the builder keeps whatever the
   database returned first: characters in the `assets` table's physical order
   (the read has no `.order()`), threads by `updated_at`. The per-type decay
   (`getDecayFactor`) and scoring (`calculatePriority`) written for this are
   called only by tests (§8).
2. **Factual projects get none of their facts.** A documentary reserves 50%
   of its budget (2,000 tokens), educational 30%, news 100%, for sources —
   and nothing fills it. A news project's build today returns *nothing at
   all*: every narrative category is 0% and the only non-zero one is empty.

**What the user gets when this exists.**

- When canon exceeds the budget, the characters, threads and summaries that
  survive are the ones most recently active in the story, with threads that
  have been touched in many episodes ranked up — instead of an arbitrary cut.
- A documentary, educational or news project's continuity step sees the
  project's **verified** facts (highest confidence first), within that type's
  source budget. The story agent receives them in the `buildMemoryContext`
  tool result, next to the canon.
- A news project carries no narrative history, provably, while still loading
  its facts.

**Stated plainly so no one reads more into it** (§8, finding F-3): with the
data the canon tables hold — an episode number and, for threads, a touch
count — every per-type decay curve is monotonic in distance, so ranking by
score is ranking by recency (plus the thread-touch boost) for every type. The
*shape* of each curve (0.95ⁿ vs linear vs flat) changes which items are
*dropped* only if a score threshold is applied, and the threshold conflicts
with the horizon the user sets in Canon settings (FILM-1110 D2). That is
decision **D1** (§31).

**What they see.** No screen changes. The effect shows where continuity
already surfaces: the story agent's `buildMemoryContext` tool result (now
with `sources` for factual types) and the build's log line, which gains
`decay=…`, `sources=…`. The Memory Context Preview panel is still not
rendered anywhere (FILM-1007), and stays out of scope.

**Success.** For a project with more canon than fits, a build keeps the most
recently active items; a documentary build returns its verified facts; a news
build returns facts and no narrative items. **Failure** looks like today: an
arbitrary cut, and an empty sources section.

**Persistence.** Nothing new is stored. The context is built per request and
discarded.

**What this does not deliver:** topic-relevance ranking for documentaries
(the spec's "topic match" — no canon row carries a topic; §31 Q2); filling
`parentContext` for sequels (FILM-1113, D3); external news/research content
(FILM-1135; KB-26 is changing that table's scope); episode summaries and
world states are still never *written* by anything (FILM-1004), so ranking
summaries has no production effect until they are.

---

## 2. Define the Complete User Journey

| # | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| 0 | *(precondition)* Project exists with a type; canon committed by earlier episodes (`commit-story-canon.ts` writes events, character states, threads); for factual types, facts extracted and some marked verified (KB-18 makes verify work) | — | — | Generate |
| 1 | Generates a story for episode *N* | Job to the LLM Lambda; story orchestrator runs with the continuity skill (unchanged) | Progress as today | Wait |
| 2 | *(agent)* calls `buildMemoryContext` | Builder resolves type (FILM-1110), reads canon, **ranks** threads, characters and summaries by `calculatePriority`, **loads verified facts** when the type has a source budget, fits each within its budget | Tool result lists events, characters, threads, world, and — for factual types — `sources` | Agent drafts |
| 3 | *(agent)* `checkContinuity` | Same build → `validatePlotSkeleton` | Violations drive revision (existing loop) | Story saved |
| 4 | Screenplay conversion | Checkpoint build (same builder) | Log line as today, with the new fields | Continue |

Refresh, navigation, cancellation, retries: unchanged — the build is a
stateless read inside a job.

---

## 3. Explicitly Define the Happy Path

Series project `P`, generating episode 60. Canon: 60 episodes; threads
T-old (touched only in eps 1–2), T-mid (last touched ep 30), T-hot (touched
in eps 40, 48, 52, 55 — four touches); characters Jon (last state ep 58) and
Mara (last state ep 3); summaries for eps 10–59.

1. **User** clicks Generate on episode 60's story.
2. **System receives** the `llm_jobs` message (existing).
3. **Processing.** The agent calls `buildMemoryContext({ episodeNumber: 60 })`.
   The builder resolves `series` (budget 7,200, horizon 50), reads canon,
   and resolves the episode numbers the threads and states reference (one
   `episodes` read by id).
4. **Ranking** (`calculatePriority`, series decay 0.95ⁿ, distance clamped ≥ 0):
   T-hot 0.95⁵ × 1.2 = **0.93**; T-mid 0.95³⁰ = **0.21**; T-old 0.95⁵⁸ =
   **0.05**. Order: T-hot, T-mid, T-old. Characters: Jon (0.95²=0.90) before
   Mara (0.95⁵⁷=0.05). Summaries: ep 59 first, down to ep 10.
5. **Fit.** Each category is filled in rank order until its budget
   (threads 1,440, characters 1,800, summaries 720 tokens) would overflow.
6. **Returned.** `MemoryContext` with the ranked lists; `metadata.decay =
   { function: 'exponential', … }`; log line
   `[MemoryContext] project=P type=series(metadata) budget=7200 horizon=50(content-type) decay=exponential … sources=0`.
7. **User sees** the story generate; the agent's canon is the story's live
   threads and characters rather than a database-order sample.
8. **Why this is success.** Under budget pressure, what was cut was the least
   recently active canon.

Documentary variant: same flow; `budgets.sourcesCitations = 2,000`; the
builder reads the project's `verified_facts` with `verification_status =
'verified'`, highest `confidence_score` first, and returns as many as fit in
`sources`. The tool result includes them (sanitised, §19).

---

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| An item's episode cannot be resolved (episode deleted — FKs cascade, but `episodes_touched` is a plain `uuid[]`) | Ranked with the lowest score and kept (never dropped for lack of a number) | None | — | Build succeeds |
| Item from a *later* episode than the one being generated (regenerating ep 3 when ep 7 exists) | Distance clamped to 0 → top score; included as today | None | — | Unchanged semantics: canon is project-wide today (§31 A2) |
| Type with flat decay (movie, documentary, educational: 1.0) | All scores equal → tie-break: most recent episode first, then id | None | — | Deterministic order |
| `news` | Every narrative budget is 0 → no narrative item fits; sources loaded (100% = 2,000 tokens) | Facts only | — | "No history" (D4) |
| No verified facts | `sources = []`; the budget stays reported | As today | Verify facts (KB-18) | Build succeeds |
| Only unverified / disputed / retracted facts | Not loaded (only `verified`, as `researcher.ts:80` and `fact-checker.ts:82` already do) | None | Verify them | `sources = []` |
| `verified_facts` read errors | `sources = []`; error logged with the table name | Less context | Next build | Partial context |
| A paged read errors mid-way | That category empty; logged (same as today's per-loader failure) | Less canon | Next build | Partial context |
| Type without a source budget (series, movie, short-film, ad) | The `verified_facts` read is skipped entirely | — | — | No extra query |
| > 1,000 rows in `immutable_events` / `narrative_threads` / `character_states` | Paged to completion before ranking (§20) | — | — | Ranking over every row |
| Retried / concurrent job | Pure read | — | — | Idempotent |

---

## 5. Establish the User-Facing Contract

No UI and no user input changes. The observable contract is the
`MemoryContext` the builder returns, the continuity tool result, and the log
line:

- **Order.** `activeThreads`, `characterStates` and `recentSummaries` are in
  descending `calculatePriority` score (ties: higher episode number first,
  then id). `immutableEvents` keep today's order (oldest first) and are never
  scored (D1, both options).
- **Sources.** `sources: SourceCitation[]` — `{ factId, claim, citation?,
  sourceTitle?, category?, confidence? }`, only `verified` facts of the
  project, highest confidence first, fitted to `budgets.sourcesCitations`.
  Empty when the type has no source budget.
- **Metadata.** `metadata.decay = { function: DecayFunction; dropped: {
  narrativeThreads; episodeSummaries } }` (`dropped` is always 0 under D1-a);
  `tokenBudget.byCategory.sourcesCitations`.
- **Tool result.** `buildMemoryContext` tool gains `sources: [{ claim,
  citation }]` (sanitised) and a `sources` count in its summary line.
- **Log line** gains ` decay=<function> dropped=<n> sources=<n>`.
- **Permissions:** unchanged (FILM-1110 §19): user client + RLS in Next.js;
  service role bound to the job's project in the Lambda.
- **Errors:** none user-facing added.

---

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Why | Trigger / input | Processing / output | Success | Failure | Verification |
|---|---|---|---|---|---|---|---|
| **FR-1** | Threads, characters and summaries are ordered by `calculatePriority(item, current, itemEpisode, type).score` before budget fitting | The open criterion | Build | Pure `rankByPriority` in `memory-strategies.ts` | Most recently active kept under pressure | Arbitrary cut (today) | Unit (fake client, budget-limited); real-DB verify |
| **FR-2** | A thread's episode is the highest episode number among `opened_at` ∪ `episodes_touched`; its `mentions` is `episodes_touched.length`. A character's episode is that of its newest state. A summary's is its episode's number | These are the only per-item signals the tables hold | Rows | One `episodes (id, number)` read by the referenced ids | Scores match hand-computed values (§9) | — | Unit |
| **FR-3** | Distance is clamped at 0; an unresolvable episode ranks last and is kept | `getDecayFactor` grows above 1 for negative distance (`0.95⁻²`); a missing number must not drop canon | Edge rows | — | §4 rows 1–2 | Item dropped or ranked first wrongly | Unit |
| **FR-4** | Immutable events are never scored or dropped by decay | CANON_001 (resurrection, hard fail) reads deaths from this list; decaying an early death would let a dead character return | — | Unchanged loader order | A death from ep 1 is present at ep 60 when it fits | — | Unit (mutation guard) |
| **FR-5** | Under D1-a, decay never removes an item: only the horizon (summaries) and the budget remove | The user's Canon settings horizon (FILM-1110 D2) must mean what its label says | — | `include` not applied | Series summary 45 episodes back is kept when it fits and is inside the horizon | — | Unit |
| **FR-6** | Sources: when `budgets.sourcesCitations > 0`, read the project's facts with `verification_status = 'verified'`, ordered `confidence_score desc nulls last, id`, limited to a candidate cap, fitted to the budget | Fills the reserved budget (D2) | Type has sources | `MemoryContext.sources` | Documentary / educational / news builds return verified facts | Empty (today) | Unit; real-DB verify (verified vs unverified vs disputed) |
| **FR-7** | No `verified_facts` read for types with no source budget | No cost for narrative types | — | Read skipped | Series build issues no `verified_facts` query | — | Unit (call record) |
| **FR-8** | Fact text returned to the agent passes `sanitizeForPrompt` | Facts come from uploaded documents (fact extraction) — the least trusted text in the context | Tool result | Sanitised `claim`, `citation` | Injection markers neutralised | Raw text to the LLM | Unit |
| **FR-9** | A news build returns no narrative items even when narrative rows exist, and returns its facts | "News has no history" (D4) | news project with rows | Budgets 0 | 0 events/characters/threads/summaries; sources > 0 | Narrative items leak in | Unit; real-DB verify |
| **FR-10** | `CONTENT_TYPE_CONFIGS[t].decayFunction` names the curve `getDecayFactor(t, ·)` actually computes, for every type | Two definitions disagree for three types today (§8 F-2); the reported `metadata.decay.function` must be true | — | Labels corrected | Property test: `none`/`topic_match` ⇒ constant; `linear` ⇒ constant step until the floor; `exponential` ⇒ constant ratio | — | Unit (red on today's labels) |
| **FR-11** | Reads whose rows are ranked are paged to completion (`fetchAllRows` / `fetchAllByIds`) | Ranking a truncated set silently ranks the wrong set (CLAUDE.md, "Reading more than 1000 rows"); FILM-1110 §12 deferred the "newest events never considered past 1,000" case here | — | `immutable_events`, `narrative_threads`, `character_states`, `episodes` lookup | Fake with 1,200 rows: all considered | Only first 1,000 | Unit (fake with `range`) |
| **FR-12** | The build logs decay function, dropped count and sources count | §22 — only way to tell "no facts" from "facts not read" | Build | Log line | Line present | — | Unit asserts the line |
| **FR-13** | The builder still loads in the Lambda bundle | FILM-1110's bundle guard; `@kit/shared/pagination` is new to this module | — | — | FILM-1110's bundle test stays green | Import throws | Existing bundle test |

---

## 7. Define Non-Functional Requirements

| Area | Requirement |
|---|---|
| Latency | +1 `episodes` read by id (≤ a few hundred ids, chunked at 200) and, for factual types, +1 `verified_facts` read (indexed on `project_id`). Target: build stays < 200 ms on the verify fixture; measured and reported in the PR. |
| Cost | No LLM calls added. Factual types send up to their source budget (≤ 2,000 tokens) more to the agent — budget already allotted by FILM-1110. |
| Security | No new reader, no new tenant path; fact text sanitised before it reaches a model (FR-8). |
| Reliability | Any new read that fails empties only its own category. |
| Determinism | Same rows → same order (tie-break by episode number, then id). |
| Compatibility | `MemoryContext` gains fields only; `buildMemoryContextAction` input unchanged. |
| Maintainability | One decay definition (FR-10); ranking is one pure function used by every ranked loader. |
| Accessibility, i18n | No UI. |

---

## 8. Analyze the Existing System

### Components (on the base branch, after FILM-1110)

| Component | File | Role today |
|---|---|---|
| Strategies | `packages/features/episodes/src/lib/canon/memory-strategies.ts` | `MEMORY_ALLOCATIONS` (the one table, FILM-1110 D1), `getMemoryOptionsForContentType` (used by the builder), `getDecayFactor`, `calculatePriority` (**tests only**) |
| Configs | `…/canon/content-type-configs.ts` | `CONTENT_TYPE_CONFIGS` incl. `decayFunction` label, `resolveProjectType` |
| Builder | `…/canon/memory-context-builder.ts` | Resolves type, budgets, horizon; five loaders; `metadata.budgets` reports `sourcesCitations` / `parentContext` (`:441-442`) that nothing fills |
| Continuity skill | `packages/features/episodes/src/agent/skills/continuity-skill.ts` | Agent tools; `buildMemoryContext` tool returns events, characters, threads, world (`:63-99`) |
| Validator | `…/canon/continuity-validator.ts` | CANON_001 reads deaths from `immutableEvents` (`:187`); 002/003 characters; 007 threads; 008/009 summaries |
| Facts | `verified_facts` (migration `20260211100000`) | Project-scoped, RLS by project membership; `verification_status`, `confidence_score` |

### Gap, reproduced (2026-09-23, on e84c1810)

```
$ git grep -n "calculatePriority(" -- packages apps | grep -v "export function"
  → 10 hits, all packages/features/episodes/__tests__/memory-strategies.test.ts
$ git grep -n "getDecayFactor(" -- packages apps | grep -v "export function"
  → 15 hits in the same test file + memory-strategies.ts:249 (inside calculatePriority)
$ git grep -n "budgets\.\(sourcesCitations\|parentContext\)" -- packages apps
  → no hits      (positive control: "budgets.immutableEvents" → 1 hit in the builder)
```

### Findings while planning

| # | Finding | Evidence |
|---|---|---|
| F-1 | Characters are cut in physical table order: the `assets` read has no `.order()` | `memory-context-builder.ts:161-165`, then `:204-238` breaks at the first overflow |
| F-2 | **Two decay definitions disagree** — the same class as FILM-1110's two allocation tables. The label in `CONTENT_TYPE_CONFIGS` vs the curve `getDecayFactor` computes: short-film `exponential` vs linear (1−0.1n, floor 0.3); series `linear` vs 0.95ⁿ; ad `none` vs linear (1−0.2n, floor 0.5). `getDecayFactor` matches the spec's table and its met criterion; the labels do not. `options.decayFunction` passes the wrong label on | `content-type-configs.ts:55,65,105` vs `memory-strategies.ts:167-182`; `content-type-configs.test.ts:86` pins one wrong label |
| F-3 | **With the available signals, curve shape cannot change ranking.** Canon rows carry no `importance`; the only inputs are distance and (threads) touch count. Every curve is non-increasing in distance, so ordering by score = ordering by recency, modulo the ×1.2 touch boost. Shape matters only through the `include` threshold (score > 0.1), which under the current curves bites only for series (distance ≥ 45; ≥ 49 with the boost) and news (always) | `memory-strategies.ts:238-271`; 0.95⁴⁴ = 0.1047, 0.95⁴⁵ = 0.0994 |
| F-4 | Applying that threshold to summaries would contradict FILM-1110 D2: a series with a custom horizon of 100 in Canon settings would still lose every summary ≥ 45 back, while the label says "100 episodes (custom)" | `memory-horizon.ts:85-112`; FILM-1110 EDD §5 |
| F-5 | Decaying immutable events would remove early deaths from the list CANON_001 checks — the one hard-fail rule | `continuity-validator.ts:187-205` |
| F-6 | Distance can be negative (regenerating an earlier episode), and `getDecayFactor` then returns > 1 for series (0.95⁻²) and short-film (1.2) | `memory-strategies.ts:169,173` |
| F-7 | CANON_007 reads `openedEpisodeNumber`, a field `NarrativeThread` does not have, so its staleness estimate always starts at 0 | `continuity-validator.ts:510-512` — **reported, not fixed** (FILM-1003's validator, not a memory strategy) |
| F-8 | `formatMemoryContextForPrompt` has no caller | `git grep -n formatMemoryContextForPrompt` → definition only — **not changed** |

### FILM-1110's three reported problems — scope decision

| Problem | In FILM-1111? | Why |
|---|---|---|
| `act-context-bridge.ts`, `sequel-system.ts`, `documentary/helpers.ts` import the Next-only client | **No** | None of the three has a caller (`buildActContextBridge`, `linkAsSequel`/`buildParentContext`/`getSequelParentContexts`, `runResearchPhase`/`runFactCheck`: `git grep` finds definitions and tests only), and none is a memory strategy. Each belongs to the ticket that wires it: FILM-1112 (and KB-52, which is already editing `act-context-bridge.ts`), FILM-1113, FILM-1122/1123. The injected-client pattern is ready for them (FILM-1110). |
| `apps/web/lambda/llm-worker/handlers/season-outline.ts:124` reads `metadata.contentType`, which nothing writes | **No** | Season outlining (FILM-1143's area), not memory. Proposed as a new KB entry (number from the lead); `resolveProjectType(projectMetadata)` is the one-line fix. |
| Three content-type fields on a project | **No** | Same KB entry. FILM-1111 reads only the authoritative `metadata.projectType`, via FILM-1110's resolver. |

---

## 9. Define the Desired System Behavior

**Build** → resolve type/budgets/horizon (FILM-1110, unchanged) → read events
(paged; order unchanged), threads (paged), characters + states (states paged
by id chunks), summaries (horizon window, unchanged), and, if
`budgets.sourcesCitations > 0`, verified facts → resolve the episode numbers
threads and states reference → **rank** threads, characters, summaries with
`rankByPriority` → fit each to its budget → return, log.

Scores the unit tests assert (series, current episode 60; hand-computed, not
read back from the code):

| Item | Episode | Distance | Mentions | Score |
|---|---|---|---|---|
| T-hot | 55 | 5 | 4 | min(1, 0.7738 × 1.2) = **0.9285** |
| T-mid | 30 | 30 | 1 | **0.2146** |
| T-old | 2 | 58 | 2 | **0.0510** (kept under D1-a; dropped under D1-b) |
| Jon | 58 | 2 | — | **0.9025** |
| Mara | 3 | 57 | — | **0.0537** |
| Thread from ep 62 | 62 | clamped 0 | 1 | **1.0** |

Per-type behaviour after the change:

| Type | Decay (after FR-10 labels) | Ranking effect | Sources |
|---|---|---|---|
| short-film | linear, floor 0.3 | Recency; ties past distance 7 broken by episode number | — |
| series | exponential 0.95ⁿ | Recency, touch boost moves a thread ~3–4 episodes up | — |
| movie | none (1.0) | Recency by tie-break | — |
| documentary | topic_match (1.0 — no topic data) | Recency by tie-break | verified facts, 2,000 tokens |
| educational | topic_match (1.0) | Recency by tie-break | verified facts, 1,440 tokens |
| ad | linear, floor 0.5 | Recency | — |
| news | none (0) | Nothing narrative fits (budgets 0) | verified facts, 2,000 tokens |

---

## 10. High-Level Architecture

No new services, tables, queues or caches. Three library changes:

- **`memory-strategies.ts`** gains `rankByPriority` — pure, client-safe: takes
  items with an episode number (or none) and optional mentions, the current
  episode and the type; returns them with scores in rank order. *Why here:*
  the scoring already lives here; the builder should only fetch and fit.
- **`memory-context-builder.ts`** — loaders fetch every candidate (paged),
  hand them to `rankByPriority`, then fit. A new `loadSources` loader.
  *Why:* the builder is the single place every caller (agent tools,
  screenplay checkpoint, preview action) goes through (FILM-1110).
- **`content-type-configs.ts`** — three `decayFunction` labels corrected.

Trust boundary unchanged (FILM-1110 §10). New untrusted text (fact claims)
crosses into a prompt only through the tool result, sanitised there.

---

## 11. Architecture and Flow Diagrams

```
buildMemoryContext(client, {projectId, episodeNumber})
  ├─ projects.metadata ─► type, budgets, horizon                (FILM-1110)
  ├─ parallel:
  │    immutable_events   (paged, id order) ─► oldest-first ─► fit(events)      no scoring
  │    narrative_threads  (paged, open|progressed) ─┐
  │    assets(type=character) → character_states    ├─► episode ids ─► episodes(id,number) by id
  │       (fetchAllByIds on character_id)          ─┘
  │    episodes window → episode_summaries          (FILM-1110, unchanged filters)
  │    verified_facts (only if budgets.sourcesCitations>0; verified; confidence desc; limit)
  ├─ rankByPriority(threads | characters | summaries, current, type)
  │      score = calculatePriority({mentions}, current, max(itemEp≤…), type).score
  │      order: score desc, episode desc, id
  ├─ fit each list to its budget (unchanged fit loop)
  └─ world_states (unchanged) ─► MemoryContext{…, sources, metadata.decay} + log line

continuity tool ─► toolSuccess({… , sources: sanitize(claim, citation)})
```

---

## 12. End-to-End Data Flow

| Stage | Detail |
|---|---|
| Source | Canon tables (written by `commit-story-canon.ts` and canon actions); `verified_facts` (fact extraction, uploads, manual; verified by owner/admin — KB-18) |
| Validation | Unchanged row mapping; fact rows mapped with nullable fields → optional |
| Transformation | Episode-id → number map; score per item; sort; fit |
| Filtering | Threads `status in (open, progressed)`; facts `verification_status = 'verified'`; summaries by horizon window |
| Ordering | Ranked categories by score; events oldest-first; facts by confidence then id |
| Persistence | None |
| Consumers | Continuity tools (agent), screenplay checkpoint, preview action |

**Where data can go wrong:**
- *Lost:* a truncated read ranks the wrong set — prevented by paging (FR-11).
  Facts are not paged on purpose: the server orders them and the builder
  takes a prefix no longer than any budget can hold, so the prefix of the
  truncated result *is* the prefix of the full ordering (§20).
- *Stale:* an episode renumbered after a job is queued is read at build time.
- *Incorrectly transformed:* a thread whose touched episodes were deleted
  resolves to its remaining numbers, or none (ranked last, kept).

---

## 13. Data Model

No new entities. Derived per request:

| Datum | Source | Notes |
|---|---|---|
| Item episode number | `episodes.number` via `opened_at`, `episodes_touched[]`, `character_states.episode_id`, `episode_summaries.episode_id` | Project-wide numbering (episodes are numbered max+1 across the project, `server/actions.ts:80-88`) |
| Mentions | `narrative_threads.episodes_touched.length` | Threads only |
| Score | `calculatePriority(...).score` | Not stored |
| `SourceCitation` | `verified_facts` (`id, claim, source_citation, source_title, category, confidence_score`) | New type in `canon/types.ts` |

---

## 14. Database Design and Changes

**None.** No migration, RLS change or typegen. Indexes relied on (existing):
`idx_verified_facts_project`, `idx_verified_facts_status`; `episodes` PK for
the by-id lookup; `idx_narrative_threads_*` (project, status).

---

## 15. Low-Level Design

### `memory-strategies.ts`

```ts
export interface RankCandidate<T> {
  item: T;
  /** Project-wide episode number the item was last active in; undefined if unknown */
  episode?: number;
  mentions?: number;
  /** Stable tie-break */
  id: string;
}
export interface RankedItem<T> { item: T; score: number; include: boolean }

export function rankByPriority<T>(
  candidates: RankCandidate<T>[],
  currentEpisode: number,
  projectType: ProjectType,
): RankedItem<T>[]
```

- Known episode: `calculatePriority({ createdAt: new Date(0), mentions },
  currentEpisode, Math.min(episode, currentEpisode), projectType)` — the
  `min` clamps distance at 0 (FR-3) without changing `calculatePriority`.
- Unknown episode: score `-1`, `include: true` → sorts after every scored
  item, never dropped.
- Sort: score desc, then episode desc (unknown last), then id.
- `calculatePriority`'s `createdAt` parameter is unused by its body; passing
  a constant keeps its signature (a met criterion's export) untouched.

### `content-type-configs.ts`

`decayFunction`: short-film `'linear'`, series `'exponential'`, ad
`'linear'`. `content-type-configs.test.ts:86` and
`memory-strategies.test.ts:117` updated to the corrected labels.

### `memory-context-builder.ts`

- `loadImmutableEvents`: `fetchAllRows` over `.order('id')`, then sort by
  `created_at` asc, id — today's order, now over every row. No scoring.
- `loadActiveThreads`: `fetchAllRows` (order id) → candidates with
  `episode = max(num(opened_at), num(t) for t in episodes_touched)`,
  `mentions = episodes_touched.length` → rank → fit.
- `loadCharacterStates`: the `assets` read is unchanged (FILM-1110 guard B1's
  line stays byte-identical); `character_states` via `fetchAllByIds` on
  `character_id` (order id; fixes FILM-1110 R5's 414 as a side effect of
  paging) → per character, the 10 newest states as today → candidate episode
  = number of the newest state's `episode_id` → rank → fit.
- `loadEpisodeSummaries`: window read unchanged except `select('id, number')`
  (guard B2's `.gte/.lt` lines stay identical) → rank → fit.
- Episode numbers for threads and states: one `fetchAllByIds` over
  `episodes (id, number)` for the ids those rows reference, after the thread
  and state reads resolve. The four loaders still run in parallel; the
  lookup is a second phase inside a small `resolveEpisodeNumbers` step.
- `loadSources(client, projectId, budget)`: returns `[]` without a query when
  `budget <= 0`; otherwise
  `.from('verified_facts').select('id, claim, source_citation, source_title, category, confidence_score').eq('project_id', projectId).eq('verification_status', 'verified').order('confidence_score', { ascending: false, nullsFirst: false }).order('id').limit(SOURCE_CANDIDATE_LIMIT)`
  (`200`) → map → fit.
- Fit loops unchanged (stop at first overflow).
- Result: `sources`, `tokenBudget.byCategory.sourcesCitations`,
  `metadata.decay = { function: options.decayFunction, dropped: {…} }`; log
  line extended.
- Under D1-b (if chosen): the ranked lists of threads and summaries are
  filtered by `include` before fitting, and `dropped` counts them.

### `continuity-skill.ts`

`buildMemoryContext` tool result gains
`sources: context.sources.map(s => ({ claim: sanitizeForPrompt(s.claim), citation: s.citation ? sanitizeForPrompt(s.citation) : '' }))`
and the summary string names the count. `summarizeResult` keeps counts only
(sources count added). The `execute` signature line (FILM-1110 guard C1)
is not touched.

### `types.ts`

`SourceCitation`; `MemoryContext.sources`; `TokenBudget.byCategory.sourcesCitations`;
`MemoryContext.metadata.decay`.

### Test helper

`__tests__/helpers/fake-canon-client.ts` gains `range(from, to)` that slices
the table's rows, so `fetchAllRows` terminates against the fake. Additive:
existing tests never call `range`. (ENGINEERING-WORKFLOW 4b: the change is
required by a reproduced need — `fetchAllRows` loops until an empty page —
not a hypothesis.)

No transactions, locking, retries or caching.

---

## 16. API and Event Design

| Interface | Change | Compatibility |
|---|---|---|
| `buildMemoryContext(client, input)` | Signature unchanged; result gains `sources`, `metadata.decay`, `tokenBudget.byCategory.sourcesCitations` | Additive; no consumer constructs a `MemoryContext` (`git grep` — only the builder) |
| `buildMemoryContextAction` | Input unchanged; output additive | Additive |
| Agent tool `buildMemoryContext` | Result gains `sources` | Additive; the LLM sees more fields |
| `rankByPriority`, `RankCandidate`, `RankedItem`, `SourceCitation` | New exports | Additive |
| `CONTENT_TYPE_CONFIGS.*.decayFunction` | Three values corrected | Read only by `getMemoryOptionsForContentType` → `metadata.decay.function` and tests |

No endpoints, events, pagination contracts or rate limits.

---

## 17. State and Lifecycle Design

No stateful entity is introduced or changed. Fact `verification_status`
transitions are KB-18's; this change only reads `verified`.

---

## 18. Failure and Error Handling

| Failure | Behaviour | User-visible | Recovery |
|---|---|---|---|
| Paged read throws (`fetchAllRows` throws on error) | Caught in the loader; category empty; `console.error` with the table | Less canon | Next build |
| `episodes` lookup fails | Every item ranks as unknown (kept, order = fetch order by id) | Ranking lost for that build, nothing dropped | Next build |
| `verified_facts` read fails | `sources = []`, logged | No facts | Next build |
| Whole build throws | Unchanged (tool error / checkpoint warn) | Unchanged | Next job |

**What the change newly permits** (ENGINEERING-WORKFLOW mode 3), and its guard:

1. **Uploaded-document text reaching the story agent** (facts). Guard:
   `sanitizeForPrompt` at the tool boundary (FR-8), unit-tested; only
   `verified` facts — a project owner/admin has reviewed each (KB-18).
2. **A different subset of canon under budget pressure.** An early,
   long-dormant character or thread can now be the one cut where before it
   might have survived by table order. Guard: events are exempt (FR-4), so
   CANON_001 inputs cannot shrink; the log line's counts show what was kept.
3. **More reads per build** (+1, +1 for factual types). Bounded; §20.

---

## 19. Security

- **AuthZ.** Unchanged. Next.js: user client + RLS (`verified_facts` SELECT
  is limited to members of the project's account). Lambda: service role,
  project id bound from the job at skill construction (FILM-1110 FR-7) — the
  new facts read uses that same bound id, never a model-supplied one.
- **Prompt injection.** Fact claims and citations come from user uploads and
  model extraction. They reach an LLM only via the tool result, sanitised
  (FR-8). Existing canon strings (event descriptions, thread names) are
  returned unsanitised today — a pre-existing sibling, reported in the PR,
  not widened here.
- **Data exposure.** No field leaves the project it belongs to.
- **Secrets.** None. Verification uses local Supabase demo keys only.

---

## 20. Performance and Scale

- **Reads per build:** today 6–7; after: +1 `episodes` by id (chunks of 200
  ids), +1 `verified_facts` for factual types. Paging adds requests only past
  500 rows per table.
- **Facts not paged, deliberately:** ordered server-side by
  `(confidence_score desc nulls last, id)` and limited to 200. The largest
  source budget is 2,000 tokens; a fact row is ≥ 10 tokens as JSON, so no
  budget can hold more than 200 — the first 200 of the server's ordering are
  exactly the candidates the full set would yield. Asserted in a comment and
  a unit test (budget/row-size bound).
- **Ranking cost:** O(n log n) in memory over at most the project's open
  threads, characters and ≤ 100 summaries.
- **`character_states` 414** (FILM-1110 R5) closes as a side effect of
  `fetchAllByIds`.
- Measured build time on the verify fixture goes in the PR.

---

## 21. Accessibility and Client Behavior

Not applicable: no UI, form or client component changes. The only UI that
could show the new fields (Memory Context Preview) is not rendered
(FILM-1007).

---

## 22. Observability and Operations

- **Log line** (one per build), extended:
  `[MemoryContext] project=<id> type=documentary(metadata) budget=4000 horizon=5(content-type) decay=topic_match dropped=0 events=… characters=… threads=… summaries=… world=… sources=12 tokens=…`
- **Reading it:** `sources=0` on a documentary with verified facts means the
  read failed (its own error line precedes it); `dropped>0` appears only under
  D1-b.
- No metrics, dashboards or alerts are added (none exist for this pipeline).

---

## 23. Configuration and Feature Flags

No env vars, secrets or flags. Behaviour is code configuration
(`MEMORY_ALLOCATIONS`, `CONTENT_TYPE_CONFIGS`, `getDecayFactor`).
`SOURCE_CANDIDATE_LIMIT = 200` is a constant with its derivation in §20. No
flag: the change is advisory context, reversible by revert.

---

## 24. Compatibility

- Narrative types see the same items when everything fits; only the order
  (and, under pressure, which items survive) changes.
- Factual types gain `sources`; the agent sees more context.
- Consumers of `MemoryContext` read fields by name; all additions are new
  fields. `continuity-validator` ignores `sources`.
- Lambda and Next deploy together (one SST deploy); no skew.
- **Stacking:** this branch contains #311. If #311 changes in review, this
  branch rebases onto it; nothing here edits FILM-1110's guarded lines.

---

## 25. Migration and Rollout Strategy

- No schema or data migration. Merge after #311 (retarget to `main` first).
- Gate before merge: unit tests, FILM-1110's bundle test, the extended
  real-DB verify (locally under the DB lock and in CI's `🐘 Supabase DB` job,
  which already runs `pnpm --filter @kit/episodes verify`).
- **Post-deploy check (owner, one-person runbook):** generate one story on a
  documentary project that has verified facts; in the llm-worker's CloudWatch
  logs find `[MemoryContext] … type=documentary … sources=N` with N > 0.
- Rollback: revert the PR; no data to undo.

---

## 26. Testing Strategy

Each test is written to fail first on the base branch for the stated reason.

| Layer | Test | Proves | Red on base because |
|---|---|---|---|
| Unit (`memory-strategies.test.ts`) | `rankByPriority`: §9 scores; order score→episode→id; negative distance clamped (ep 62 at current 60 → 1.0, not 1.108); unknown episode last and kept; under D1-a no item removed | FR-1, FR-3, FR-5 | Function absent |
| Unit (`content-type-configs.test.ts`) | For every type, the label describes the curve: `none`/`topic_match` constant over d=0..60; `linear` constant step until floor; `exponential` constant ratio | FR-10 | short-film, series, ad labels wrong (F-2) |
| Unit (`memory-context-builder.test.ts`) | Series, budget forced small (`tokenBudgetPercent`): threads come back T-hot, T-mid, T-old; characters Jon before Mara even when the `assets` rows list Mara first | FR-1, FR-2 | Threads in `updated_at` order; characters in row order |
| Unit | Events: 1,200 rows via the fake with `range` — all considered; order oldest-first; no score applied (a death from ep 1 is first at ep 60) | FR-4, FR-11 | Unpaged read sees only the first page's worth… (fake returns all — red via the `range` call assertion) |
| Unit | Documentary: `verified_facts` queried with `eq verification_status verified`, the two `order`s and `limit 200`; facts fitted to 2,000 tokens; `sources` in result; series issues **no** `verified_facts` query | FR-6, FR-7 | No such read |
| Unit | News with rows in every narrative table: 0 events/characters/threads/summaries; `sources` non-empty | FR-9 | `sources` absent |
| Unit (`continuity-skill.test.ts`) | Tool result carries `sources`; a claim containing `<system>…</system>` and `IGNORE PREVIOUS` comes back neutralised | FR-8 | No `sources` |
| Unit | Log line contains `decay=exponential dropped=0 … sources=0` | FR-12 | Fields absent |
| **Bundle** (FILM-1110's `canon-bundle.test.ts`) | Still green with `@kit/shared/pagination` imported | FR-13 | — (regression guard) |
| **Real DB** (`scripts/verify-memory-context.ts`, extended) | New scenarios: (a) series, 60 episodes, T-hot/T-mid/T-old and Jon/Mara as §3, small `tokenBudgetPercent` → first thread T-hot, first character Jon; (b) documentary with one verified, one unverified, one disputed fact → `sources` = exactly the verified one; (c) news with narrative rows + a verified fact → 0 narrative, 1 source. Existing FILM-1110 scenarios unchanged | FR-1, FR-6, FR-9 against real PostgREST (filters, `nullsFirst`, `.in` chunking) | (a) T-old/Mara first or absent; (b)(c) `sources` 0 |
| Mutation guards (`tooling/mutation-guards/film-1111.json`) | Unit entries: skip ranking (return candidates unsorted); drop the distance clamp; score immutable events; remove the `verification_status` filter (call-shape test); skip sanitisation; restore a wrong decay label | Each guard stays a guard | — |
| FILM-1110 guards | `run.py --kind unit --only` each FILM-1110 entry still RED-able (their `find` lines untouched) | Base branch's guards intact | — |
| Typecheck / lint / format | `pnpm typecheck`, `pnpm lint:fix`, `pnpm format:fix` | — | — |
| E2E | **Not applicable** — no form or interactive UI changes | — | — |

Story generation end to end is not driven (needs a live LLM); the builder,
the tool result and the Lambda bundle are covered by the rows above.

---

## 27. Production-Build Verification

The production artifact that runs this code is the **LLM Lambda bundle**.

1. FILM-1110's bundle test (esbuild as SST does, run in a separate `node`)
   must stay green with the new import — proves the builder still loads.
2. The real-DB verify runs the builder with a service-role
   `createLambdaAdminClient` against local Supabase (demo keys from
   `supabase status`; never a production value).
3. `next build` is not affected (no app code changes beyond the package the
   preview action imports); CI's build job covers it. No `next start` run is
   needed, so no vendor sandboxing applies — no path in this change reaches a
   vendor.

---

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Production verification |
|---|---|---|---|---|---|---|---|
| Most recently active canon survives the budget | §3 steps 4–5 | FR-1–FR-3, FR-5, FR-11 | `rankByPriority`; paged loaders | strategies, builder | thread/state/summary reads; `episodes` by id | Unit; verify (a) | Log counts |
| Deaths never decay out | §4 | FR-4 | events exempt | builder | `immutable_events` | Unit + guard | — |
| Factual projects see verified facts | §3 documentary | FR-6–FR-8 | `loadSources`; tool result | builder, skill | `verified_facts` | Unit; verify (b) | `sources=N` in CloudWatch (§25) |
| News carries no history | §4 news | FR-9 | budgets 0 | builder | — | Unit; verify (c) | `type=news … sources=N`, narrative 0 |
| Reported decay is the real one | — | FR-10 | labels | configs | `metadata.decay.function` | Property unit test | Log line |
| Operator can tell | — | FR-12 | log line | builder | — | Unit | CloudWatch |
| Still loads in the Lambda | — | FR-13 | pure imports | builder | — | Bundle test | — |

---

## 29. Architectural Alternatives and Trade-offs

**A1 — What decay may do (D1).**
- *D1-a (recommended): rank only.* Decay orders; the horizon and the budget
  remove. Keeps FILM-1110 D2's label true and keeps open threads (promises to
  pay off) in front of the agent however old. Cost: per F-3, the per-type
  curves then change nothing observable except the touch boost — ranking is
  effectively recency for every type. Said in §1, not hidden.
- *D1-b: rank + threshold (score ≤ 0.1 dropped) for threads and summaries,*
  as the spec's sketch implies. Makes the series curve bite (≥ 45 episodes
  back) and would matter more if importance data ever exists. Cost: a series
  with a custom horizon of 100 silently gets 44 (F-4); a thread untouched for
  45 episodes disappears from the agent's view — the orphaned-thread case
  CANON_007 exists to catch.
- Immutable events are exempt under both (F-5).

**A2 — Sources (D2).** *Recommended:* project `verified_facts`,
`verified` only (the precedent in `researcher.ts`/`fact-checker.ts`),
confidence-ranked. *Alt:* include `unverified` too (more context, but
unreviewed extraction output reaching the agent as "sources"). *Alt:* leave
to FILM-1135 (external content) — that table is global and being re-scoped
by KB-26 (#318); it is not per-project canon.

**A3 — parentContext (D3).** *Recommended:* FILM-1113. No `ProjectType` is a
sequel (sequels are `projects.sequel_of`), every allocation has
`parentContext: 0`, and reading `sequel_parent_contexts` is FILM-1113's open
criterion "Parent canon inherited to sequel validation". Filling it here
means choosing a sequel allocation and wiring `sequel-system.ts` (which
still imports the Next client) — FILM-1113's work, not a memory-strategy
change. *Alt:* do it here, widening scope into FILM-1113.

**A4 — News horizon (D4).** *Recommended:* keep `memoryHorizon: 1` and
reword the criterion to its intent, "News carries no episode history",
proven by FR-9 (narrative budgets are 0). *Alt:* set news to 0 — requires
`MIN_MEMORY_HORIZON = 0`, which changes FILM-1110's shared 1–100 bound for
the slider, the action schemas and the memory-context action, to change
nothing a build returns.

**A5 — Where ranking lives.** Pure function in `memory-strategies.ts`
(chosen) vs inside each loader. One definition, testable without a client.

**A6 — Episode numbers.** One by-id `episodes` lookup (chosen) vs a
project-wide `episodes` read shared with the summaries window. The shared
read would rewrite the summaries loader's window query, which FILM-1110's
guard B2 pins by text; the by-id lookup leaves it untouched and reads only
the ids needed.

**A7 — Decay definitions (FR-10).** Correct the labels to match
`getDecayFactor` (chosen: the function matches the spec's table and a met
criterion) vs derive the function from the labels (would change tested,
met behaviour) vs a single decay table from which both derive (cleanest, but
a rewrite of met code for no behavioural gain; the property test holds them
together instead).

---

## 30. Risk Register

| # | Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | #311 changes in review | Rebase work | PR updates | Nothing here edits FILM-1110's guarded lines | Rebase |
| R2 | Fact text used for prompt injection | Agent misled | Sanitiser unit test | `sanitizeForPrompt`; verified-only | Drop sources from the tool result |
| R3 | Long-dormant canon cut first under pressure | Agent not reminded of an old thread/character | Log counts | Events exempt; D1-a keeps everything that fits | Raise budget % |
| R4 | Fake client's added `range` masks a real paging bug | False green | Real-DB verify pages real tables (seeded > 500 rows? — no: covered by `@kit/shared/pagination`'s own tests; verify covers filters) | Paging helper is shared and already tested | — |
| R5 | Extra tokens for factual types | Cost | `llm_usage` | Bounded by the existing source budget | Lower `contextWindowPercent` |
| R6 | Overlap: KB-18 (#314) changes how facts get verified | Semantics of "verified" | Read its diff | Reads only the existing `verified` value, as two existing readers do | — |
| R7 | Overlap: KB-14 (#309) edits `validation-checkpoint.ts`; KB-52 edits `act-context-bridge.ts` | Conflicts | — | Neither file is edited here | — |

---

## 31. Open Questions and Assumptions

### Decisions for the owner (each with a recommended default)

- **D1 — Can decay remove canon, or only order it?** **Recommended: order
  only (D1-a)**, with immutable events exempt either way. Consequence: per-type
  curve shapes are mostly inert (F-3). Alternative D1-b adds the 0.1
  threshold for threads and summaries (§29 A1).
- **D2 — Fill `sourcesCitations` with the project's verified facts?**
  **Recommended: yes**, `verified` only, confidence-ranked, sanitised in the
  tool result.
- **D3 — `parentContext` moves to FILM-1113.** **Recommended: yes** —
  FILM-1111's `remaining` drops it and FILM-1113's "Parent canon inherited to
  sequel validation" gains "fill `budgets.parentContext`" in its reason.
- **D4 — News "zero memory horizon".** **Recommended: accept horizon 1** and
  reword the criterion to "News carries no episode history", closed by test
  (FR-9). (The spec already names the owner as `closed_by` for this item.)
- **D5 — Correct the three `decayFunction` labels** to what `getDecayFactor`
  computes. **Recommended: yes** (FR-10).

### Questions recorded, not blocking

- **Q1 — KB number** for `season-outline.ts:124` reading
  `metadata.contentType` (written by nothing) and the three content-type
  fields; to be assigned by the lead, recorded in FILM-CC-04 in this PR or by
  the lead.
- **Q2 — Topic relevance for documentaries.** No canon or fact row carries a
  topic tied to the episode; a cheap proxy would be to rank facts linked to
  the current episode (`episode_facts`) first. Not in scope; recorded as a
  follow-up.
- **Q3 — F-7 (CANON_007 reads a missing field)** — reported for FILM-1003.

### Assumptions

- A1: `episodes.number` is project-wide (auto-numbering is max+1 over the
  project, `server/actions.ts:80-88`), as FILM-1110 assumed.
- A2: Canon from later episodes stays visible when regenerating an earlier
  one (today's behaviour); ranking puts it first (distance 0).
- A3: KB-18 (#314) leaves `verification_status = 'verified'` as the meaning
  of "reviewed and accepted".

---

## 32. Implementation Plan

Each stage is a commit.

1. **Tests first (red).** `rankByPriority` tests; label property test;
   builder tests (ranking, events exempt, paging, sources, news, log);
   continuity-skill sanitisation test; fake-client `range`. Run on the base,
   record each failure reason for the PR.
2. **`content-type-configs.ts`** — three labels (D5).
3. **`memory-strategies.ts`** — `rankByPriority`.
4. **`types.ts`** — `SourceCitation`, `sources`, `byCategory.sourcesCitations`,
   `metadata.decay`.
5. **`memory-context-builder.ts`** — paging, episode lookup, ranking,
   `loadSources`, metadata, log line.
6. **`continuity-skill.ts`** — `sources` in the tool result, sanitised.
7. **Verify script** — scenarios (a)–(c). Run under the DB lock after
   `supabase db reset` from this worktree (lock first, then a heavy slot).
8. **Green + red-before-green:** unit (`@kit/episodes`), bundle test, verify,
   `tooling/mutation-guards/film-1111.json` run with
   `python3 tooling/mutation-guards/run.py --kind unit`; FILM-1110 guards
   re-run.
9. **`pnpm typecheck`** (heavy slot), `pnpm lint:fix`, `pnpm format:fix`.
10. **Records:** FILM-1111 spec (`met`/`evidence`, `remaining: []`, status
    DONE only if D1–D4 are resolved so every criterion is met), FILM-1113's
    reason (D3), `specs/INDEX.md` row; siblings in the PR body.
11. Push, `gh pr create --base feat/film-1110-content-type-budget`, body
    line 1: "Stacked on #311 — retarget to main after #311 merges."

Rollback at any stage: revert.

---

## 33. Definition of Done

- [ ] Threads, characters and summaries ranked by `calculatePriority`; §9
      scores asserted; order verified against a real database (verify (a)).
- [ ] Immutable events unscored and paged; guard seen red.
- [ ] Documentary/educational/news builds return verified facts only
      (verify (b)); narrative types issue no facts query.
- [ ] News returns no narrative items with rows present (verify (c)).
- [ ] Decay labels agree with `getDecayFactor` (property test red on base).
- [ ] Fact text sanitised in the tool result (unit; guard red).
- [ ] Every new guard in `film-1111.json` seen RED; FILM-1110's still RED-able.
- [ ] Bundle test green; `@kit/episodes` unit tests green; typecheck, lint,
      format clean.
- [ ] FILM-1111 spec updated (`remaining: []` if D1–D4 resolved), FILM-1113
      reason updated (D3), INDEX row; siblings (F-7, F-8, unsanitised canon
      strings, season-outline/three fields) reported in the PR.

---

## 34. Final Consistency Pass

**Forward.** Problem: the builder sizes canon by type but cuts it
arbitrarily and never fills factual projects' source budget. Outcome: the
most recently active canon survives; factual projects see verified facts;
news carries no history. User action: generate — unchanged. System: rank
(FR-1–5), fill sources (FR-6–8), keep news narrative-free (FR-9), report
the true decay (FR-10), over complete reads (FR-11). Data: reads only.
Architecture: one pure ranking function, one new loader. Tests: unit for
arithmetic and call shape, real-DB verify for filters and order, bundle test
for the Lambda. Deploy: plain. Production: the log line's `sources=` and
counts.

**Reverse.** In production, on each continuity tool call and screenplay
checkpoint, the builder reads the project's canon completely, orders
threads, characters and summaries by type-specific priority, loads verified
facts for factual types, and fits each to its budget — so the agent's
continuity context is the story's live canon plus, for factual work, its
reviewed facts. That is the spec's criterion "`buildMemoryContext` uses
content-type strategies" for scoring, decay and the sources budget, and the
reworded news criterion.

**Where they do not fully converge, stated:** under D1-a the per-type curve
*shapes* are mostly inert (F-3) — ranking is recency for every type until
richer signals exist; summaries have no production effect until something
writes them (FILM-1004); `parentContext` is FILM-1113's (D3); topic ranking
for documentaries is not possible with today's data (Q2).
