# EDD — KB-48 and KB-71: facts and audio for personal owners; season outlines that read the project type

- Teammate: `facts` (NN=05) · Branch: `fix/kb-48-71-facts-owners` (from `origin/main` 52ed2ade)
- Tickets: FILM-CC-04 **KB-48**, **KB-71**. Related records: FILM-1120, FILM-1142, FILM-1143
- Pattern followed: KB-18 (#314). One project rule per verb, refusals as values, pgTAP red-first; KB-27's rule for writes (owner decision 2026-09-23: `can_write_project`)
- Date: 2026-09-24

---

## 0. What I found (reproduced 2026-09-24, local DB, a transaction that was rolled back)

Script: `/Users/xuryax/.claude/jobs/d614354f/tmp/facts/repro.sql`, output `…/facts/repro.out`. Run as `authenticated` via `makerkit.authenticate_as`.

| # | Who | Statement | Result on `main` | Expected |
|---|---|---|---|---|
| R1 | personal owner P, project owner in `project_members` (checked: 1 row) | `select` own `episodes` / `verified_facts` | 2 / 1 rows | same |
| R2 | P | `select` own `audio_cues` | **0 rows** (1 seeded) | 1 |
| R3 | P | `select` own `audio_assets` | **0 rows** (1 seeded) | 1 |
| R4 | P | `insert episode_facts` (own fact → own episode) | **42501 RLS** | allowed |
| R5 | P | `insert audio_cues` on own episode | **42501 RLS** | allowed |
| R6 | P | `insert audio_assets` on own project | **42501 RLS** | allowed |
| R7 | team user T (account member + project owner) | `insert episode_facts` linking **another tenant's** fact (T cannot even `select` it: 0 rows) to T's episode | **accepted**, row visible to T | refused |
| R8 | T | the same link again with `on conflict (episode_id, fact_id) do update` — exactly what `supabase-js .upsert()` sends | **42501 "(USING expression)"** — `episode_facts` has no UPDATE policy | the re-link is a no-op |
| R9 | T (account member) | `select audio_cues` on an episode with `season_id is null` | **0 rows** — the policy joins `episodes → seasons → projects`; `episodes.season_id` is nullable (`on delete set null`) | 1 |

So KB-48 is **bigger than recorded**:

- **R2–R6** confirm the entry (it had `audio_cues` and `audio_assets` as "read, not reproduced"). `shot_transitions` has the identical `accounts_memberships`-only predicate as `episode_facts` (no app code uses the table today; `git grep shot_transitions` hits only the generated types).
- **R7 is a cross-tenant read, not just an access denial.** The INSERT check tests only the *episode's* account; `fact_id` is checked only by the FK. The LLM worker reads `episode_facts → verified_facts` on the **service-role** client (`apps/web/lambda/llm-worker/utils/context-builder.ts:318`, `:434`; `index.ts:36`), so another tenant's fact claim, citation and category go into this user's generated story. Requires knowing a fact UUID (not guessable, but UUIDs are not secrets). Severity: I'd call it Medium-High; it lives in the same `WITH CHECK` I am rewriting.
- **R8**: `linkFactsToEpisodeAction` (`packages/features/episodes/src/server/episode-fact-actions.ts:55`) and `createEpisode`'s fact links (`packages/features/episodes/src/server/actions.ts:345`) both `.upsert()`; the comment says "gracefully handle facts that are already linked". Any batch containing one already-linked fact fails whole, for every user. `createEpisode` swallows it as a warning (new episode, so no conflict in practice); the link dialog shows "Failed to link facts".
- **R9**: season-less episodes' audio cues are invisible and unwritable for everyone but the service role.
- `audio_cues` and `verified_facts` policies still have **no `TO` clause** — `policy-shape.test.sql:22-30` allowlists both "until KB-18 / KB-27 / KB-48 land". KB-18 merged without removing `verified_facts`; this PR can empty the allowlist.

KB-71 **reproduced by reading and search, re-checked on 52ed2ade** (a handler unit test will be the executable repro, red first):

- `apps/web/lambda/llm-worker/handlers/season-outline.ts:125` reads `projectMetadata.contentType`; nothing writes it. `git grep -n "etadata\.contentType"` finds only this line; positive control `etadata\.projectType` finds 4 hits.
- Three more defects in the same 40 lines:
  1. it loads facts of **every** `verification_status` — `disputed` and `retracted` included — under the heading "VERIFIED FACTS … Every fact MUST appear" (`:130-156`);
  2. claims go to the model **unsanitised** (FILM-1111 / KB-72 sanitise every other fact path with `sanitizeForPrompt`);
  3. `limit(100)` with no `order` — which 100 is arbitrary and the truncation is silent.
- Sibling: `context-builder.ts:384` passes `projectMetadata.projectType` to story generation/ideation as a bare cast, not through `resolveProjectType` (an invalid stored value flows as a string that is not a `ProjectType`).
- The three fields: `metadata.projectType` (set at creation, read by `resolveProjectType`); `metadata.canon.contentType` (written by **two** actions — `settings/_components/canon-settings-actions.ts:24` and `packages/features/episodes/src/server/canon-actions.ts:874` — read by nothing except the form's own default); `metadata.contentType` (read here only). The season dialog also has a fourth, local one: `useState<string|null>(null)` whose setter is never called (`season-generator-dialog.tsx:285`, FILM-1143).

---

## 1. The user

**Who:** a creator working alone on a **personal account** (the owner is the product's first end-to-end user, and works personal-first), and any team project writer.

**What they get after this fix:**

- On their own project they can link research facts to an episode, and the link persists; linking a set that includes an already-linked fact succeeds instead of failing the whole batch.
- Their audio cues and audio-library assets are visible and editable (audio studio, audio library page), including on episodes that are not in a season.
- A **documentary, educational or news** project's season outline is generated with that project's **verified** facts, each assigned to an episode; a series/movie/ad/short-film outline gets none (unchanged).
- The canon settings no longer offer a "Content Type" choice that silently does nothing (see Open Question Q1 for what replaces it).

**What they could not do before:** R2–R6, R8, R9 above; and no season outline ever received facts.

**What does not change:** team members' reads (account-scoped, as on `episodes`/`shots`); who may verify facts (KB-18); the member UPDATE rule on `verified_facts`.

**What the fix newly refuses (named on purpose — mode 3):** (a) linking a fact from a different project (R7), including the same account's other project; (b) writes on these four tables by an account member who holds no writing role on the project (a project `viewer`, or an account member not on the project). (b) is KB-27/KB-28's owner-decided rule applied to four more tables.

---

## 2. User journeys

J1 — personal owner links facts (Story → Canon dashboard → Facts tab → Link facts dialog)
: select facts → Link → toast "Linked N fact(s)" → facts appear in the tab (**only if FILM-1142's panel regression is fixed — see O1**; otherwise the tab stays "No facts linked" even though the rows exist). Refresh → still linked. Unlink → gone.

J2 — personal owner opens Audio Studio / Audio library
: cues and assets they generated are listed; editing a cue's status/placement saves.

J3 — documentary owner generates a season outline (Episodes → Generate Season → outline)
: worker loads the project's verified facts; the outline's episodes carry `fact_ids`. No UI change in the dialog.

J4 — canon settings (Project settings → Canon)
: per Q1: the Content Type select is gone and the project's type is shown read-only (recommended), or the select edits the project's type.

Re-entry/refresh: all state is in Postgres; nothing is client-only. Cancellation: no partial writes (single statements).

## 3. Happy path (reference)

1. P (personal account, project creator → `project_members.owner` by `add_project_owner`) links fact F (project X) to episode E (project X).
2. `linkFactsToEpisodeAction` → `insert … on conflict do nothing` via the user's client.
3. Policy: `can_write_project(E.project_id)` ✔ and `F.project_id = E.project_id` ✔ → row written.
4. `getEpisodeFactsAction` → `select` passes `has_account_access(project.account_id)` ✔ → F returned.
5. Season outline for documentary X: handler resolves `projectType = documentary` → `requiresFacts` → loads X's `verified` facts ordered by `created_at, id`, sanitised → passed as `verifiedFacts` to `runSeasonOrchestrator`.

## 4. Alternate paths

| Trigger | System | User sees | Final state |
|---|---|---|---|
| Fact from another project/tenant | INSERT `WITH CHECK` fails, 42501 | Link action returns a refusal value "These facts are not in this episode's project" (KB-6: refusal as value, not a thrown message) | nothing written |
| Batch has an already-linked fact | `on conflict do nothing` | toast counts only newly linked | no dupes |
| Project viewer / account member off the project writes | 42501 | refusal value "You can't edit this project's facts" / audio action's existing error | unchanged |
| Stranger (other tenant) reads | 0 rows | empty state | — |
| Documentary with 0 verified facts (only unverified) | no facts section in prompt; log line `Loaded 0 verified facts (N unverified skipped)` | outline without facts (as today) | — |
| > 100 verified facts | first 100 by `created_at, id`; log `truncated to 100 of N` | outline covers 100 | — |
| Stored `projectType` invalid/absent | `resolveProjectType` → `series` → no facts | as today | — |
| Fact query error | logged, outline continues without facts (as today) | — | — |

## 5. User-facing contract

- Facts tab: linked facts list, unlink button, count badge (only with O1). Link dialog: success toast with count of newly linked; readable refusal.
- Audio studio / library: unchanged UI; data now present for personal owners.
- Canon settings: per Q1.
- Season outline: no UI change; content difference only.

## 6. Functional requirements

| ID | Requirement | Verification |
|---|---|---|
| FR1 | A personal owner can select/insert/update/delete `episode_facts`, `audio_cues`, `shot_transitions`, `audio_assets` rows of their own projects | pgTAP per table per verb, red first |
| FR2 | Reads on the four tables use the sibling read rule: `has_account_access(project.account_id)` (personal owner or account role), as `episodes_read`/`shots_read` | pgTAP: team account member reads; stranger reads 0 |
| FR3 | Writes on the four tables use `can_write_project(project_id)` (owner/admin/member). Viewer and off-project account member refused | pgTAP |
| FR4 | `episode_facts` insert requires `verified_facts.project_id = episodes.project_id` | pgTAP: cross-tenant and cross-project (same account) link refused (R7 red first) |
| FR5 | `audio_cues` resolves the project via `episodes.project_id`, not `seasons` | pgTAP: season-less episode's cue readable/writable (R9 red first) |
| FR6 | Re-linking an already-linked fact is a no-op, not an error | pgTAP (`on conflict do nothing` as writer) + unit test that both callers pass `ignoreDuplicates: true` |
| FR7 | Every policy on the four tables and on `verified_facts` names `TO authenticated`; `policy-shape.test.sql` allowlist emptied | `policy-shape.test.sql` check 1 |
| FR8 | Season outline decides fact loading with `getContentTypeConfig(resolveProjectType(metadata).projectType).requiresFacts` | vitest on `processSeasonOutline`: documentary → facts passed (red first); series → none |
| FR9 | Only `verification_status = 'verified'` facts are passed (Q2), ordered `created_at, id`, `limit 100`, each claim/citation/category through `sanitizeForPrompt`; truncation logged | vitest |
| FR10 | `context-builder.ts:384` reads the type through `resolveProjectType` (one reader) | vitest or typecheck + unit |
| FR11 | One authoritative content-type field: `metadata.projectType`. `canon.contentType` is no longer written by either action, removed from `CanonSettings`/schemas; `metadata.contentType` is no longer read | typecheck + grep + Playwright on the canon form (Q1) |

## 7. Non-functional

- Performance: policies call `security definer` `stable` helpers (`can_write_project`, `has_account_access`) — same cost class as siblings; tables are per-episode small. No new indexes needed (`idx_episode_facts_episode`, FKs indexed).
- Security: tenant isolation strengthened (R7). No new grants. No `security definer` function added.
- Compatibility: no column changes; existing rows untouched; stale `canon.contentType` values in JSON are ignored (harmless).
- Observability: season outline logs the loaded/skipped/truncated counts.
- Accessibility: canon form change keeps labels; read-only type shown as text, not a disabled control (Q1).

## 8. Existing system

- Tables and current policies: listed in §0; live dump taken from `pg_policies` on 2026-09-24.
- Helpers: `has_role_on_account` (memberships only — the root cause), `has_account_access` (owner OR role; `20251210201500`), `can_write_project` (`20260923042517`, KB-28), `can_edit_project`.
- Writers: user client — `episode-fact-actions.ts`, `actions.ts:345` (createEpisode), `audio-cue-actions.ts`, `audio-asset-actions.ts`, `audio-asset-core.ts`, `audio-library/page.tsx`. Service role — llm-worker handlers (unaffected by RLS).
- Content type: see §0.

## 9. System behaviour

User action → server action (user's client) → PostgREST → RLS predicate (§14) → row / 42501 → action returns value or refusal → UI toast/list. Worker: SQS job → service-role reads → `resolveProjectType` → facts query → orchestrator.

## 10–11. Architecture / diagrams

No new components. Change is (1) one migration replacing 16 policies + altering 4 `verified_facts` policies' role, (2) two action tweaks, (3) handler + context-builder change, (4) canon settings form/action/type change.

```
link facts (user client) ──▶ episode_facts INSERT
                               ├─ can_write_project(e.project_id)
                               └─ f.project_id = e.project_id
worker (service role) ──▶ episode_facts ⋈ verified_facts  (now only same-project links can exist via the app)
season-outline ──▶ resolveProjectType(metadata) ─▶ requiresFacts? ─▶ verified facts (sanitised) ─▶ orchestrator
```

## 12. Data flow

Facts: `verified_facts` (user-authored) → `episode_facts` link (user) → worker context (service role) → prompt. Points of corruption: cross-project link (closed by FR4). Existing cross-project links already in the DB: migration **reports** a count via `raise notice` but does not delete (no production credentials; owner decides — Q3).
Season outline: `projects.metadata.projectType` → `resolveProjectType` → facts → prompt; truncation at 100 is logged.

## 13. Data model

No entity changes. Authoritative project type: `projects.metadata.projectType`. `canon.contentType` becomes dead JSON (not written, not read).

## 14. Database changes

One hand-written migration `<ts>_kb48-studio-owner-access.sql`:

```sql
-- episode_facts: drop 3 membership policies; recreate TO authenticated
select: exists(select 1 from episodes e join projects p on p.id = e.project_id
               where e.id = episode_id and public.has_account_access(p.account_id))
insert: with check exists(select 1 from episodes e join verified_facts f on f.project_id = e.project_id
               where e.id = episode_id and f.id = fact_id and public.can_write_project(e.project_id))
delete: using exists(select 1 from episodes e where e.id = episode_id and public.can_write_project(e.project_id))
-- (no UPDATE policy: the app never updates a link; upserts become DO NOTHING)

-- audio_cues: 4 policies via episodes.project_id (not seasons); select=has_account_access; insert/update/delete=can_write_project; update has USING and WITH CHECK
-- shot_transitions: same shape via episode_id
-- audio_assets: same via project_id
-- verified_facts: alter policy … to authenticated (4 policies; predicates unchanged)
-- notice: count of existing cross-project episode_facts rows
```

`delete` keeps today's verb parity (whoever may write may delete) rather than `shots`/`dialogue_lines`' owner/admin-only delete, because audio regeneration deletes cues as a member today (`audio-cue-actions.ts`). Mirrored into `schemas/`: none of the four tables has a schema file (checked; only `22-bulk-reset-rpc.sql` mentions `audio_cues`), so nothing to mirror. Types: no schema change → typegen should produce no diff (run to confirm).
Rollback: a reverse migration restoring the old predicates (kept in the PR description); no data changes to undo. Locking: `drop/create policy` takes a brief `AccessExclusiveLock` on four small tables.

## 15. Low-level design

- `episode-fact-actions.ts`: `.upsert(rows, { onConflict: 'episode_id,fact_id', ignoreDuplicates: true })`; a 42501 becomes `ActionRefusal` via `returnRefusals` (KB-6 pattern used by `canon-settings-actions.ts`). Same `ignoreDuplicates` in `actions.ts:345`.
- `season-outline.ts`: 
  ```ts
  const { projectType } = resolveProjectType(project?.metadata);
  if (getContentTypeConfig(projectType).requiresFacts) {
    select id, claim, source_citation, category
      .eq('project_id', id).eq('verification_status', 'verified')
      .order('created_at').order('id').limit(MAX_OUTLINE_FACTS = 100)
    + a head count for the truncation log
    lines = facts.map(f => `FACT [${f.id}]: ${sanitizeForPrompt(f.claim)}…`)
  }
  ```
  `resolveProjectType` and `getContentTypeConfig` come from `@kit/episodes/lib` (exported via `lib/canon/index.ts`, checked). `sanitizeForPrompt` is **not** exported there (checked); add one export line to `packages/features/episodes/src/lib/index.ts` rather than a deep import.
- `context-builder.ts:384`: `projectType: resolveProjectType(projectMetadata).projectType`.
- Canon: remove `contentType` from `CanonSettings`, `DEFAULT_CANON_SETTINGS`, both zod schemas, and the form's select (Q1 option A), and show `PROJECT_TYPE_LABELS[projectType]` as text with `data-test="canon-settings-project-type"`. The server action must also stop spreading a stale `canon.contentType` forward: build `canon` from the schema's fields only.

## 16. API/event design

Server actions only; signatures unchanged. `linkFactsToEpisodeAction` return `{ linkedCount }` now counts newly linked rows; refusals returned as values. SQS payload unchanged.

## 17. State/lifecycle

N/A — no stateful entity added; `verification_status` lifecycle is KB-18's and is only read here.

## 18. Failure handling

See §4. RLS refusals → refusal values with readable text (asserted in a production-build E2E only if O1 is taken; otherwise unit-tested mapping).

## 19. Security

- Tenant isolation: FR4 closes R7. What the fix newly **allows**: personal owners and project writers on the four tables — nobody outside `project_members` writers / account readers. Guarded by pgTAP strangers and viewers on every verb.
- The service role still bypasses; the worker can only follow links the app allowed. Pre-existing cross-project links are reported (Q3).
- Prompt injection: facts sanitised at the season-outline boundary (FR9).

## 20. Performance

Negligible; see §7.

## 21. Accessibility/client

Only the canon form changes (Q1). Read-only type is plain text with a label; no disabled select.

## 22. Observability

Worker log lines: `[Season Outline] projectType=<t> requiresFacts=<b> loaded=<n> skippedUnverified=<m> truncatedFrom=<N>`. Operators distinguish "no facts because not a factual type" from "factual but none verified".

## 23. Configuration

N/A — no flags or env.

## 24. Compatibility

- Old clients calling the canon action with `contentType` — zod strips it; no error.
- Deploy order: migration and app code are independent; either order is safe (the migration only widens personal-owner access and narrows cross-project/off-project writes, which the app never needed).

## 25. Rollout

Migration via normal pipeline; no backfill. Rollback: reverse migration (in PR body) + revert.

## 26. Testing strategy

| Layer | Test | Red first |
|---|---|---|
| pgTAP | new `tests/database/studio-owner-access.test.sql`: for each of the 4 tables × {personal owner, team writer (member), project viewer, account member off project, stranger} × {select, insert, update, delete}; plus R7 (cross-tenant and same-account cross-project link), R8 (re-link `do nothing` ok), R9 (season-less cue) | yes — run against `main`'s migrations, expect R2–R9 failures, then apply |
| pgTAP | `policy-shape.test.sql` allowlist → empty | yes (fails until policies carry TO) |
| vitest | `apps/web/lambda/llm-worker/__tests__/season-outline-facts.test.ts`: documentary → `verifiedFacts` contains the verified fact, not the disputed one, claim sanitised; series → undefined; invalid type → series; query builder receives `eq('verification_status','verified')` | yes (fails on main: `verifiedFacts` undefined for documentary) |
| vitest | fact actions pass `ignoreDuplicates: true` and map 42501 to a refusal | yes |
| Playwright | canon settings: Content Type select gone, project type shown, save still works on the **second** save (Q1). If O1: link two facts as a **seeded personal owner**, see both, re-link one plus a new one, unlink one — screenshots | yes for the form (select present on main) |
| Existing | `canon-memory-horizon*.spec.ts`, `canon-settings.po.ts` still pass | — |

## 27. Production-build verification

Playwright against `next build && next start` on port 3105 for the canon form (and O1 if taken), so refusal texts are the production ones (KB-6). The worker change has no build-specific behaviour; verified by vitest and `pnpm typecheck` over `apps/web` (lambda is in the web tsconfig — confirm in Phase 2 step 1).

## 28. Traceability

| Outcome | Flow | Req | Component | Data | Test | Prod check |
|---|---|---|---|---|---|---|
| Personal owner uses own facts/audio | J1, J2 | FR1–3 | migration | 4 tables | pgTAP | prod-build E2E (O1) |
| No foreign facts in my episode | J1 | FR4 | migration | episode_facts | pgTAP R7 | — |
| Re-link works | J1 | FR6 | actions | episode_facts | pgTAP + vitest | E2E (O1) |
| Season-less cues visible | J2 | FR5 | migration | audio_cues | pgTAP R9 | — |
| Documentary outline gets verified facts | J3 | FR8–9 | season-outline.ts | verified_facts | vitest | log line |
| One type field | J4 | FR10–11 | canon form/actions, context-builder | projects.metadata | Playwright + typecheck + grep | prod-build E2E |
| Class guard | — | FR7 | migration | pg_policies | policy-shape | CI |

## 29. Alternatives

- **Reads via `has_account_access` vs `project_members`**: account-scoped reads match `episodes_read`/`shots_read`/`verified_facts` select; project-scoped reads would hide cues from account members who can see the episode. Chose account-scoped.
- **Writes via `can_write_project` vs `has_account_access`**: `has_account_access` would let a project viewer write; KB-27/28 owner decision picks `can_write_project`. Chosen.
- **Same-project check in the policy vs a trigger**: policy is testable with pgTAP as the user and costs nothing; a trigger would also cover the service role. Policy chosen; worker never writes links.
- **Upsert fix: add an UPDATE policy vs `ignoreDuplicates`**: nothing updates a link; an UPDATE policy would add a verb with no use. `ignoreDuplicates` chosen.
- **KB-71 type: map canon.contentType → projectType vs remove**: vocabularies differ (`factual` = documentary *or* educational); mapping guesses. See Q1.

## 30. Risks

| Risk | Impact | Detection | Mitigation |
|---|---|---|---|
| A project with `created_by` null has no owner row → personal owner still can't write | owner locked out of writes on those projects | pgTAP can't see prod data | same dependency already exists on `episodes_create`/`shots_create`; note in KB; count locally |
| Team account member off project loses write on audio/links | workflow regression for teams using account-wide access | pgTAP documents it | owner-decided rule (KB-27); called out in PR |
| Unverified-only documentaries now get **no** facts where the broken code would have given all (if it had worked) | outlines without facts | log line `skippedUnverified` | Q2 |
| Overlap with teammates `canon-rls` (policies near canon) and `uploads`/audio | merge conflicts on `policy-shape.test.sql` | rebase | small, surgical edit to one line |
| Existing cross-project links | leaked facts keep flowing to generation | migration notice count | Q3 |

## 31. Open questions

**Resolved 2026-09-24.** Owner: **Q1 = A** (remove the select, show the type read-only); **Q2 = verified only**. Lead: **O1 included** (FILM-1142 panel fix, record updated); **O2 left to FILM-1143** (noted there); **Q3 = report only** (the migration counts cross-project links and deletes none). The questions are kept below as asked.

- **Q1 (owner decision)** — *"The canon settings 'Content Type' select (Series / Movie / Factual-Documentary / News) saves to a field nothing reads. A project's type is otherwise fixed at creation. Should we (A) remove the select and show the project's type read-only, or (B) turn it into a real control that changes the project's type (7 types: short film, series, movie, documentary, educational, ad, news), which also changes memory horizon and whether facts are used?"* **Recommendation: A** — smallest change, nothing newly permitted; B is a feature with its own consequences (existing canon history judged under a new horizon).
- **Q2 (owner decision)** — *"Should a season outline use only `verified` facts, or also `unverified`/`pending_review` ones (never `disputed`/`retracted`)?"* **Recommendation: verified only** — matches season analysis (`external-context-actions.ts:401`) and `runFactCheck`, and the prompt calls them verified. Consequence: a documentary whose facts are all unverified gets none; the log says so.
- **Q3** — existing cross-project `episode_facts` rows: report only (recommended; I have no production access) or delete in the migration?
- **O1 (scope, lead)** — FILM-1142's panel regression (`episode-facts-panel.tsx:61`: expects an array, action returns `{ facts, totalCount }`; unlink reads `fact.fact_id`). ~15 lines. Without it, J1 cannot be observed in the UI and no screenshot can show KB-48 working for facts. **Recommend including** (closes FILM-1142 "Shows linked facts", "Unlink button", "Facts count in tab badge"); `scene_reference` stays open.
- **O2 (scope, lead)** — FILM-1143's dead `contentType` state in the season dialog could be derived from `projectType` (prop from the page). It would un-hide the news status block and the factual gating, which then need their own verification. **Recommend leaving to FILM-1143**; this PR records that the authoritative field it needs now exists and is read by the worker.

## 32. Implementation plan (dependency order)

1. Verify surface: worker tests run in `pnpm --filter web test`; lambda typechecked.
2. pgTAP file (all cases) → run under the lock on `main` migrations → record the red (R2–R9, policy-shape).
3. Migration → `db reset` under lock → pgTAP green; typegen (expect no diff).
4. `ignoreDuplicates` + refusal mapping; vitest red → green.
5. Season outline test red → handler fix → green; context-builder `resolveProjectType`.
6. Canon `contentType` removal per Q1; Playwright red (select visible) → green; prod-build run; screenshots.
7. (O1 if approved) panel fix + Playwright as seeded personal owner; screenshots.
8. Sibling sweep: `git grep` for `accounts_memberships where user_id = auth.uid()` and bare `has_role_on_account(p.account_id)` in **current** policies (live `pg_policies`), list what remains (not fixed here unless on the four tables) as a KB lead.
9. Records: KB-48, KB-71 → Fixed (+ Fixed table rows); new entries or notes for R7/R8/R9 inside KB-48's Fixed section; FILM-1120 (TO clause; cross-project pgTAP for `episode_facts` does **not** close its `verified_facts` isolation criterion unless I add those asserts — I will add 3 asserts for `verified_facts` stranger/cross-tenant select, which closes "RLS policies protect project-level access" with the note that reads are account-scoped); FILM-1142 (O1 criteria); FILM-1143 (record only); INDEX rows.
10. typecheck, lint:fix, format:fix; PR; follow-up commit with PR number.

## 33. Definition of done

pgTAP file green and seen red for every guard; policy-shape allowlist empty; worker vitest red→green; canon Playwright + screenshots (prod build); typecheck/lint/format clean; KB-48/71 moved to Fixed with evidence; FILM-1120/1142/1143 + INDEX updated.

## 34. Consistency pass

Forward: personal owner can't use own facts/audio → policies test memberships → replace with sibling read rule + project write rule → pgTAP per role/verb → migration → owner sees data. Documentary gets no facts → dead field → read authoritative field → vitest → outline includes verified facts.
Reverse: the migration lets exactly personal owners (via their project owner row) and project writers write, account readers read, and refuses cross-project links; the worker reads the type everyone else reads. That yields J1–J4 as defined, conditional on Q1/Q2 answers and on O1 for J1's visibility.
