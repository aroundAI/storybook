# KB-17 — `immutable_events` are not immutable: Engineering Design Document

| | |
|---|---|
| Ticket | FILM-CC-04 **KB-17** (Medium — integrity hole inside an account) |
| Closes | FILM-1002 `remaining:` rows "Appropriate GRANT statements" and "All attack vectors mitigated"; FILM-1005 `remaining:` row "Authorization checks on all actions via RLS" |
| Branch | `fix/kb-17-canon-events-immutable` |
| Base | `fix/kb-27-commit-canon-membership` (#316, stacked on #313 KB-28) |
| Status | Plan — awaiting owner approval |
| Date | 2026-09-23 |

Everything marked **measured** was run on the local stack (reset to this
branch's migrations, i.e. KB-28 + KB-27), as real signed-in users over
PostgREST, under the DB lock. Scripts: `$SP/kb-17/repro.sh` and
`$SP/kb-17/measure.sql`. Anything not run is marked **inferred**.

---

## 1. Start With the User

**Who.** Writers and readers of a series' canon: the owner of a personal
account, and the owner, admins, members and viewers of a team project.

**The problem.** An *immutable event* is a canon fact the continuity
validator treats as fixed ("Mara dies in S1E3", "magic does not exist"). The
validator refuses generated content that contradicts one. Today any member
of the account can quietly edit that fact, or re-attribute it to a
colleague, or delete it. Nothing records that it happened. The record that
is meant to be fixed is the easiest one to change without trace. And the
owner of a *personal* account cannot see or add canon in their own project
at all.

**After this change.**

- An event, once written, is **never edited**, by anyone, through any path:
  not the description, not the type, not the author, not the project. A
  wrong event is corrected by deleting it and adding a new one, and the
  new one names whoever added it.
- Whoever adds an event is recorded as its author. Nobody can add one in a
  colleague's name.
- Only people who may **write** the project (owner, admin or member in the
  project's member list, the owner's rule from KB-28) can add or delete canon.
  A project **viewer**, and a team member who is not on the project, can read
  the project's canon but not change it.
- The owner of a personal account can read and add canon in their own
  projects. Today they can do neither (measured, §8).
- When a user is deleted, the events they wrote stay, with their name kept
  (KB-1's behaviour, unchanged).

**What the user sees.**

- A writer opens *Story → Canon → Events → Add Event*, fills it in and saves.
  The event appears in the list, as today.
- A viewer who tries the same gets a toast: "You can't change this project's
  canon." Nothing is saved. Today the save goes through (measured).
- Nobody sees an "edit event" control. None exists today, and none is added.

**Success.** No request made with an end-user token, and no
privileged path, can alter an existing event's content or authorship.
Deletes are limited to the role the owner picks (§31 D1). The canon UI still
creates events.

**Failure.** An UPDATE reaches a row. An event is inserted naming someone
other than the caller. A viewer can delete. Or deleting a user fails because
of the new guard.

**What persists.** Events, with author id and author name snapshot, until
they are deleted by an allowed writer, their episode is reset or hard-deleted,
or their project is deleted. **What does not persist:** a refused write leaves
nothing behind. No audit row is written for canon changes, today or after
this change (§22, §31 Q3).

## 2. Define the Complete User Journey

| # | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| J1 | Writer opens an episode's Story page with canon enabled, then the **Canon** tab | `getImmutableEventsAction` reads the project's events under RLS | Event list (or empty state) | Add, or leave |
| J2 | Writer clicks **Add Event**, fills type, key, description, submits | `addImmutableEventAction` inserts with `created_by = user.id`; RLS checks writer, author and episode | Toast "Immutable event added successfully"; dialog closes; list reloads with the event | Add another / leave |
| J3 | Viewer or non-project team member does J2 | Insert refused by RLS (42501); action returns a refusal value | Toast "You can't change this project's canon." Dialog stays open with their input | Cancel |
| J4 | Personal-account owner does J1 and J2 in their own project | Read and insert now allowed | Their events listed; add works | — |
| J5 | Anyone attempts to edit an event (only possible by calling PostgREST directly; the UI has no edit) | UPDATE privilege revoked → 42501; any privileged UPDATE raises in a trigger | The API returns an error; the row is unchanged | Delete + re-add, if allowed |
| J6 | Writer resets an episode (single or bulk) or regenerates its story | Canon established in that episode is deleted as today (paths in §8.3) | Unchanged from today | Regenerate |
| J7 | An author's user account is deleted | FK clears `created_by`; the trigger lets exactly that through | Event stays; the name is kept | — |

Refresh or re-entry re-reads under the same RLS, so a refused write never
appears. Session expiry: `enhanceAction` requires a user. The action fails
as it does today, before any database call. No new client state exists to
interrupt.

## 3. Explicitly Define the Happy Path

1. **Member M** of team project P (`project_members.role = 'member'`) opens
   episode E's Story page → Canon → Events.
2. The client calls `getImmutableEventsAction({ projectId: P })`. PostgREST
   runs `select … from immutable_events where project_id = P` as M. The new
   `immutable_events_read` policy passes because
   `has_account_access(P.account_id)` is true for a team member. Rows are
   returned. **Success:** M sees every event of P.
3. M clicks **Add Event** and submits `{ eventType: 'death', eventKey:
   'character:mara:dead', description: 'Mara dies defending the gate' }`.
4. `addImmutableEvent` checks for a duplicate key. None exists. It inserts
   `{ project_id: P, established_in: E, created_by: M, … }`.
5. `immutable_events_insert` WITH CHECK passes:
   `created_by = auth.uid()` (M), `can_write_project(P)` (member), and E
   is an episode of P.
   BEFORE INSERT `immutable_events_snapshot_creator_name` (KB-1) sets
   `created_by_name` to M's display name.
6. The action returns the event. The dialog closes with a success toast.
   The list reloads and shows it. **Success:** the row exists, authored by M
   under M's name.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| Viewer / non-project team member submits Add Event | RLS WITH CHECK fails → PostgREST 42501 → action maps it to `ActionRefusal` | Toast "You can't change this project's canon." | None needed | No row |
| Member sends `created_by` = a colleague (direct PostgREST) | WITH CHECK `created_by = auth.uid()` fails → 42501 | API error | — | No row |
| Member sends `established_in` = an episode of another project (direct PostgREST) | WITH CHECK episode-in-project fails → 42501 | API error | — | No row |
| Anyone PATCHes an event through PostgREST | `UPDATE` privilege revoked → 42501 "permission denied for table immutable_events" | API error | Delete + re-add (if allowed) | Row unchanged |
| A privileged caller (service role, SQL, a future definer function) UPDATEs | BEFORE UPDATE trigger raises `immutable_events rows cannot be changed` | Error to that caller | Delete + re-add | Row unchanged |
| An author is deleted (GoTrue, admin) | FK `ON DELETE SET NULL` issues a nested UPDATE (depth 2) that only clears `created_by` → trigger allows it; KB-1 keeps the name | None | — | Row kept, `created_by` null, name kept |
| Delete by a role the D1 rule refuses | RLS USING filters the row → **0 rows, no error** (PostgREST semantics) | `deleteImmutableEventAction` now detects 0 rows and returns a refusal (it has no caller today) | — | Row kept |
| Duplicate event key | Existing pre-check → refusal "Event key … already exists"; the unique constraint backs it | Toast | Change key | No new row |
| Two writers add the same key concurrently | Unique `(project_id, event_key)` → 23505 for the second → today a thrown `Error` (generic in production) | Generic failure toast for the loser | Retry shows the duplicate refusal | One row |
| Personal-account owner adds canon | Allowed (was refused) | Success | — | Row |
| Network / action failure | Unchanged: `unwrap` throws, toast "Failed to add event" | Toast | Retry | Unchanged |

Large inputs: the description is capped at 500 characters in the dialog and
unbounded in the action schema (unchanged, out of scope). Cancellation or
back navigation: the dialog holds no server state.

## 5. Establish the User-Facing Contract

- **Inputs** (unchanged): the Add Event form (type, key, description).
  The server supplies the project, episode, season and number.
- **Outputs:** the event list with description, key, date and episode badge
  (unchanged).
- **States:** loading, empty ("No immutable events") and list, all unchanged.
  One new failure state: a refusal toast for users who may not write canon.
- **Error messages:**
  - New refusal: **"You can't change this project's canon."** Returned as
    a value (KB-6 `returnRefusals`), so it survives the production build.
  - Existing duplicate-key refusal: unchanged.
- **Permissions:**

  | Role on the project | Read | Add | Delete | Edit |
  |---|---|---|---|---|
  | Personal-account owner (own project) | ✅ (was ❌) | ✅ (was ❌) | per D1 | ❌ |
  | Project owner / admin | ✅ | ✅ | ✅ | ❌ (was ✅) |
  | Project member | ✅ | ✅ | per D1 (default ✅) | ❌ (was ✅) |
  | Project viewer (team member) | ✅ | ❌ (was ✅) | ❌ (was ✅) | ❌ (was ✅) |
  | Team member, not on the project | ✅ | ❌ (was ✅) | ❌ (was ✅) | ❌ (was ✅) |
  | Anyone outside the account | ❌ | ❌ | ❌ | ❌ |
  | Service role / definer functions | bypass RLS | bypass RLS | bypass RLS | ❌ (trigger) |

  "Was" is measured (§8.2) except where marked.
- **Authorship:** always the caller (direct insert), the caller of
  `commit_canon_changes`, or the job's user (lambda). The name is always
  taken from the id (KB-1).

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Trigger / precondition | Success | Failure | Verification |
|---|---|---|---|---|---|
| FR-1 | No UPDATE of an `immutable_events` row succeeds for `authenticated` or `anon` | Any PATCH | 42501, row unchanged | Any column changes | pgTAP I3 (red: measured success today) |
| FR-2 | No UPDATE succeeds for any role, except the FK clearing a deleted author and changing nothing else | Service role / postgres UPDATE | Raises; row unchanged | Row changes | pgTAP I4, I5 |
| FR-3 | User deletion still succeeds, the event stays, and the name snapshot is intact | `delete from auth.users` | `created_by` null, `created_by_name` kept | Delete refused, or name lost | pgTAP I6 + existing `authors-deletable`, `audit-author-snapshot` |
| FR-4 | A direct insert must name the caller as author | INSERT with `created_by ≠ auth.uid()` or null | 42501 | Row written | pgTAP I2 (red: forged insert is allowed today — measured §8.2) |
| FR-5 | A direct insert requires `can_write_project(project_id)` | Viewer / non-project member / outsider INSERT | 42501 | Row written | pgTAP I2 (red for viewer and team-only) |
| FR-6 | A direct insert's `established_in` must be an episode of `project_id` | Foreign episode id | 42501 | Row written | pgTAP I2 |
| FR-7 | Delete is limited to the D1 role (default: `can_write_project`) | DELETE | Allowed role: 1 row; others 0 rows | A viewer deletes | pgTAP I7 (red for viewer and team-only) |
| FR-8 | Reads use account membership, including personal owners (`has_account_access`) | SELECT | Personal owner sees own canon; outsider sees none | Personal owner sees 0 | pgTAP I1 (red for personal owner) |
| FR-9 | `commit_canon_changes` (definer) still authors events as the caller and is unaffected | RPC as member | Event `created_by` = caller, name snapshotted | Drift | pgTAP I8 (KB-27 §19 item i) |
| FR-10 | `addImmutableEventAction` returns a refusal *value* when RLS refuses | Viewer submits | `{ refusal }` with the §5 message | Thrown error (generic in prod) | Playwright C2 + unit U1 |
| FR-11 | `deleteImmutableEventAction` returns a refusal when nothing was deleted, and its doc comment states the real rule | Refused / missing id | Refusal value | `{ success: true }` on 0 rows (today) | Unit U2 |
| FR-12 | The canon UI still creates events, twice in a row | Member uses Add Event | Both events listed; DB rows authored by the member | Second submit broken | Playwright C1 |
| FR-13 | Every `FOR ALL` policy lacking `WITH CHECK` is listed with a decision | — | Table in §19.1 and in the PR | Missing row | Review; pgTAP `policies_are` pins `immutable_events`' set |
| FR-14 | Bulk reset follows the D1 rule | `bulk_reset_episodes_to_stage` | Default D1: already `can_write_project` (KB-27), no change | Diverges | Existing `bulk-reset-access.test.sql` + D2 |

## 7. Define Non-Functional Requirements

- **Performance:** the new policies call `can_write_project` and
  `has_account_access`. Both are `STABLE SECURITY DEFINER` point lookups on
  indexed keys, the same cost as today's `has_role_on_account`. The trigger is
  O(1) per row and fires only on UPDATE, which no production path issues.
  Target: no measurable change to canon list or insert latency.
- **Security:** §19. **Consistency:** the invariants live in the database,
  not the app (the owner's standing rule: "invariants in types, not docs").
- **Backward compatibility:** no column or API shape changes. The behaviour
  changes are the intended ones in §5.
- **Observability / accessibility / i18n:** §21, §22. The new toast string
  follows the existing hard-coded English in this dialog.
- **Cost / resources:** none.

## 8. Analyze the Existing System

### 8.1 Schema and policies on this branch (KB-28 + KB-27)

- Table `public.immutable_events`
  (`20260128225704_canon_management.sql:10-43`). `established_in` →
  episodes `ON DELETE CASCADE` (`20260324095502`). `created_by` →
  `auth.users ON DELETE SET NULL` (`20260921205124:221-224`, KB-1).
  `created_by_name` is set by the BEFORE INSERT/UPDATE trigger
  `immutable_events_snapshot_creator_name`
  (`20260921211043_audit-author-name-snapshot.sql:60-82`, SECURITY DEFINER).
- One policy, `immutable_events_project_access`: `FOR ALL TO authenticated
  USING (exists … has_role_on_account(p.account_id))`, with no `WITH CHECK`
  (`20260128225704_canon_management.sql:230-237`). Grant: `select, insert,
  update, delete … to authenticated` (line 228).
- **Precision about the KB text.** A `FOR ALL` policy with no `WITH CHECK`
  *reuses its USING expression as the check*. So "nothing constrains what a
  row is changed to" is true of the columns (description, author) but not of
  the tenant: moving a row into another account's project is refused. Measured
  in R9.
- `has_role_on_account` covers `accounts_memberships` only, so it
  **excludes personal-account owners** (who have no membership row) and
  **includes every team member regardless of project role**, viewers
  included.

### 8.2 Reproduction (measured)

2026-09-23 05:15 UTC. `supabase db reset` from this worktree (HEAD
`8e7314dc`, which is KB-27 + KB-28). Six real users were created through
GoTrue's admin API and signed in with passwords. Each request is a PostgREST
call with that user's own JWT.

- Team account "KB17 Team": owner **Olga**, and account members **Mia**,
  **Vic** and **Tom**.
- Project P: `project_members` has Olga as owner, Mia as member and Vic as
  viewer. Tom has no project row.
- **Sol** owns a personal account with his own project. **Xan** is outside
  both.
- Seven events in P were written by Olga as `postgres`. Positive control R0:
  Mia reads all 7.

| # | Request (as) | HTTP / rows | Row afterwards |
|---|---|---|---|
| R1 | PATCH `description='REWRITTEN canon', created_by=Vic` (Mia, member) | **200, 1 row** | `REWRITTEN canon`, `created_by` = Vic, `created_by_name` = **"Vic Viewer"**. The name follows the forged id |
| R2 | DELETE Olga's event (Mia) | **200, 1 row** | gone |
| R3a | PATCH description (Vic, **viewer**) | **200, 1 row** | `viewer rewrote` |
| R3b | DELETE (Vic, viewer) | **200, 1 row** | gone |
| R3c | POST new event (Vic, viewer) | **201** | written |
| R4a | DELETE (Tom, team member, **no project row**) | **200, 1 row** | gone |
| R4b | POST (Tom) | **201** | written |
| R5 | POST with `created_by` = Olga and `created_by_name` = "Anyone" (Mia) | **201** | `forged canon`, `created_by` = Olga, `created_by_name` = **"Olga Owner"** |
| R6 | POST with `established_in` = an episode of **Xan's** project (Mia) | **201** | written |
| R7a | GET own project's canon (Sol, **personal owner**) | 200, **0 rows** (1 exists) | — |
| R7b | POST into own project (Sol) | **403 42501** | not written |
| R8 | GET / PATCH / DELETE P's canon (Xan, outsider). Control | 200, 0 / 0 / 0 rows | unchanged |
| R9 | PATCH `project_id` → Xan's project (Mia) | **403 42501** | unchanged: the USING clause doubles as WITH CHECK |

Schema measurements (`measure.sql`):

| # | What | Result |
|---|---|---|
| M1 | Table privileges | `anon`, `authenticated` and `service_role` **all** have DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |
| M2 | Policies | one: `immutable_events_project_access`, ALL, `{authenticated}`, USING yes, WITH CHECK **no** |
| M3 | Triggers | one: `immutable_events_snapshot_creator_name` (BEFORE INSERT OR UPDATE) |
| M5 | A probe BEFORE UPDATE trigger during `delete from auth.users` (rolled back) | fired once per authored row: **`pg_trigger_depth() = 2`**, `current_user = postgres`, `new.created_by` NULL, author row already gone, **every other column unchanged** |
| M6 | Rows with NULL author | 0 of 9 |

**The KB is confirmed and wider than written.** Rewrite, delete and
forged-author insert are open not just to members (R1, R2, R5) but to
project **viewers** and to team members who are **not on the project** (R3,
R4). Personal-account owners are locked out of their own canon (R7). One
claim in the KB is narrower in practice: a row cannot be moved to another
tenant's project (R9).

### 8.3 Every path that writes or deletes `immutable_events`

| Path | Runs as | Verb | Access check today | Affected by KB-17 policies? |
|---|---|---|---|---|
| `addImmutableEventAction` (`packages/features/episodes/src/server/canon-actions.ts:189-239`), called by `add-event-dialog.tsx:125` | user JWT | INSERT, `created_by: user.id` | RLS | **Yes**: FR-4/5/6, FR-10 |
| `commit_canon_changes` RPC (`20260923031953_kb27-canon-write-scope.sql:33-93`), called by `commitCanonChangesAction` ← `episode-summary-generator.tsx:141` | SECURITY DEFINER | INSERT, `created_by = auth.uid()` | episode ∈ project, `can_write_project` (KB-27) | No (definer). Already matches FR-4/5/6; I8 pins it |
| Lambda story generation `commitStoryCanon` (`apps/web/lambda/llm-worker/utils/commit-story-canon.ts:104-162`) | service role | DELETE all events `established_in` the episode, then INSERT auto events with `created_by = job user` | job authorisation (KB-31 in flight) | No (service role bypasses RLS). Never UPDATEs, so the trigger is unaffected |
| `deleteImmutableEventAction` (`canon-actions.ts:272-306`) | user JWT | DELETE by id | RLS only; doc comment says "admin only" | **Yes**: FR-7, FR-11. **No caller** in the app |
| `resetEpisodeAction`, `resetToStoryboardAction` / `resetToStageHandler` (`packages/features/episodes/src/server/actions.ts:1212, 1848, 1991`) | user JWT | DELETE `established_in = episode`, errors non-fatal | RLS | **Yes**: with D1 default (writers) no change; with D1 = owner/admin a member's reset would silently keep the canon |
| `bulk_reset_episodes_to_stage` (`20260923031953…:107-283`) | SECURITY DEFINER | DELETE for stages draft/story | every episode in `p_account_id` and `can_write_project` (KB-27) | No (definer), D2 |
| Episode hard delete (cascade) | `episodes_delete` policy: personal owner or project owner/admin (`20260201100000_fix_episodes_rls.sql:34`) | CASCADE | owner/admin | No |
| Project delete (cascade) | project owner | CASCADE | — | No |
| User delete (FK SET NULL) | GoTrue / admin | nested UPDATE of `created_by` | — | **Yes**: the trigger exception (FR-2/3) |
| KB-1 backfill (`20260921211043…:133-139`) | migration | UPDATE with `disable trigger user` | — | Historical. A future backfill must do the same (§24) |

No application or SQL code UPDATEs `immutable_events`, apart from the FK
action and KB-1's historical backfill. Checked with `git grep -n
"immutable_events"` over `*.ts`/`*.tsx` (positive control: the 13 sites
above were all found) and over `migrations/`.

### 8.4 Readers

`getImmutableEventsAction`, `getCanonStatsAction`
(`canon-actions.ts:686`), the continuity validator (`canon-actions.ts:862`),
`memory-context-builder.ts:92` and `sequel-system.ts:216` all read with the
user's client under RLS. Because the read predicate is `has_role_on_account`,
**the continuity validator sees no canon for a personal-account owner**
(inferred from R7a: the same SELECT returns 0 rows). Their stories are
validated against an empty canon. FR-8 fixes that as a side effect.

## 9. Define the Desired System Behavior

| User action | App logic | Data operation | Response | Result |
|---|---|---|---|---|
| Open Canon tab | `getImmutableEventsAction` | SELECT under `immutable_events_read` (`has_account_access`) | rows | list |
| Add Event (writer) | `addImmutableEvent`, `created_by: user.id` | INSERT, WITH CHECK (author = caller, `can_write_project`, episode ∈ project) → KB-1 name trigger | event | success toast |
| Add Event (non-writer) | same | INSERT refused 42501 | action maps `42501` → `ActionRefusal` | refusal toast |
| Delete (API only) | `deleteImmutableEventAction` | DELETE under `immutable_events_delete` (D1), `.select('id')` | 0 rows → refusal; 1 → success | — |
| Any UPDATE | — | no privilege (authenticated/anon); trigger raises (everyone else) | error | none |
| Commit canon (publish flow) | `commit_canon_changes` | definer INSERT as caller | unchanged | unchanged |

## 10. High-Level Architecture

No new components. The change sits entirely at the trust boundary that
PostgREST exposes, which is the table itself:

- **Row-level security** decides *who* may read, insert and delete, and which
  author an insert may claim. Three policies replace the one `FOR ALL`
  policy, one per verb, so each carries its own predicate.
- **A grant** removes UPDATE from end-user roles, so the API refuses loudly
  (42501) instead of silently matching zero rows.
- **A BEFORE UPDATE trigger** makes immutability hold for *every* role,
  including service role and definer functions, where RLS does not apply.
  That is what makes it an invariant rather than a policy.
- **Two server actions** turn the database's refusals into user-facing
  refusal values.

Why not keep everything in RLS: RLS does not bind the service role or
SECURITY DEFINER functions (`commit_canon_changes`,
`bulk_reset_episodes_to_stage`, lambda), and a policy cannot see `OLD`.
`revenue_records_freeze_created_by` is the precedent
(`20260916010318_revenue-records-source-and-authorship.sql`).

## 11. Architecture and Flow Diagrams

```
                 ┌───────────────────────── immutable_events ─────────────────────────┐
 user JWT ──────►│ SELECT  immutable_events_read    has_account_access(account)        │
 (PostgREST,     │ INSERT  immutable_events_insert  created_by = auth.uid()            │
  server actions)│                                  ∧ can_write_project(project)       │
                 │                                  ∧ established_in ∈ project         │
                 │ DELETE  immutable_events_delete  D1 (default can_write_project)     │
                 │ UPDATE  — no grant, no policy → 42501                               │
                 │                                                                     │
 service role ──►│ (RLS bypassed)                                                      │
 definer fns  ──►│ BEFORE UPDATE immutable_events_refuse_update  (all roles):          │
 FK SET NULL  ──►│   allow iff depth>1 ∧ created_by: X→NULL ∧ nothing else changes     │
                 │ BEFORE INSERT/UPDATE immutable_events_snapshot_creator_name (KB-1)  │
                 └─────────────────────────────────────────────────────────────────────┘
```

Trigger order: BEFORE triggers fire in name order, so `…_refuse_update`
runs before `…_snapshot_creator_name`. The refusal sees the row as the caller
wrote it, before the name is recomputed.

## 12. End-to-End Data Flow

**Source:** the Add Event form, the publish-flow canon commit, or story
generation. **Validation:** Zod in the action or dialog, then RLS WITH CHECK
(author, writer, episode ∈ project), then the unique `(project_id,
event_key)`. **Enrichment:** `created_by_name` from `kit.author_display_name`
(KB-1). **Persistence:** a single row. It is never updated afterwards.
**Retrieval:** SELECT under `has_account_access`. **Consumers:** canon
dashboard, stats, continuity validator, memory context, sequel system.
**Deletion:** D1 role, episode reset/regeneration, cascades.

Loss or duplication points: none added. The only loss path is a
legitimate delete. Stale data: none, since reads are live.

## 13. Data Model

`immutable_events` is unchanged in shape. The invariants it gains:

1. **Write-once content.** No column changes after insert, except
2. **Author erasure.** `created_by` may go from a user id to NULL, and only
   through the FK action when that user is deleted. `created_by_name` then
   keeps the name (KB-1).
3. **Author is the writer.** On a direct insert, `created_by = auth.uid()`.
   Definer and service-role inserts set it themselves: the caller (RPC) or
   the job's user (lambda).
4. **Provenance is inside the project.** `established_in` is an episode of
   `project_id` for direct inserts. The RPC checks the same. The lambda
   derives both from one job.

Authoritative source: the database row. `created_by_name` is a derived
snapshot, authoritative after the author is deleted.

## 14. Database Design and Changes

One hand-written migration, `apps/web/supabase/migrations/<UTC
timestamp>_kb17-immutable-events-immutable.sql`, timestamped after
KB-27's `20260923031953`. No new tables, columns, indexes or constraints.

```sql
-- policies: one per verb (replaces immutable_events_project_access)
drop policy if exists "immutable_events_project_access" on public.immutable_events;

create policy "immutable_events_read" on public.immutable_events
  for select to authenticated using (
    exists (select 1 from public.projects p
             where p.id = immutable_events.project_id
               and public.has_account_access(p.account_id)));

create policy "immutable_events_insert" on public.immutable_events
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and public.can_write_project(project_id)
    and exists (select 1 from public.episodes e
                 where e.id = immutable_events.established_in
                   and e.project_id = immutable_events.project_id));

create policy "immutable_events_delete" on public.immutable_events
  for delete to authenticated using (
    public.can_write_project(project_id));          -- D1 default; see §31

-- grants: no UPDATE for end users (a PATCH gets 42501, not a silent 0 rows)
revoke update, truncate, references, trigger on public.immutable_events from authenticated;
revoke all on public.immutable_events from anon;     -- M1: anon holds all seven today

-- write-once, for every role
create or replace function public.immutable_events_refuse_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- The auth.users FK clearing a deleted author (KB-1): nested, and nothing
  -- but created_by changes.
  if pg_trigger_depth() > 1
     and old.created_by is not null and new.created_by is null
     and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;
  raise exception 'immutable_events rows cannot be changed'
    using errcode = '42501',
          hint = 'Delete the event and add a corrected one; the new one is authored by whoever adds it.';
end $$;

create trigger immutable_events_refuse_update
  before update on public.immutable_events
  for each row execute function public.immutable_events_refuse_update();
```

- **Trigger function is SECURITY INVOKER.** It reads no table, so it adds
  nothing to `definer-functions-inventory.test.sql`. I will run that test to
  confirm, not assume.
- **Existing data:** no backfill. Existing rows keep their current values,
  including any forged before this migration. Rows cannot be told apart
  after the fact (§31 Q2).
- **Locking:** `drop/create policy`, `revoke` and `create trigger` take a
  brief `ACCESS EXCLUSIVE` or `SHARE ROW EXCLUSIVE` lock on a small table.
  Milliseconds.
- **Rollback:** a reverse migration restores the `FOR ALL` policy and grant
  and drops the trigger and function. No data is involved.
- **Schema file:** none exists for this table. FILM-1002's reference to
  `schemas/31-canon-management.sql` is stale, so there is nothing to mirror.
  `schemas/22-bulk-reset-rpc.sql` changes only if D2 changes bulk reset.
- **Types:** no shape change. `pnpm supabase:web:typegen` is still run, and
  must produce no diff.

## 15. Low-Level Design

**Migration:** §14.

**`addImmutableEvent`** (`canon-actions.ts:189-237`):
- Keep `created_by: user.id`. It already satisfies FR-4.
- On insert error with `code === '42501'`, throw
  `new ActionRefusal("You can't change this project's canon.")`. It is already
  wrapped by `returnRefusals`, so it reaches the client as a value. Other
  errors keep today's thrown `Error`.

**`deleteImmutableEventAction`** (`canon-actions.ts:272-306`):
- `.delete().eq('id', …).select('id')`. If no row comes back, throw
  `ActionRefusal("You can't change this project's canon.")`: one message for
  "not found" and "not allowed", so it reveals nothing.
- Wrap it with `returnRefusals`, like `addImmutableEventAction`.
- Replace the doc comment "(admin only, with confirmation)" with the rule
  D1 actually enforces.

**No change** to `commit_canon_changes`, `bulk_reset_episodes_to_stage`
(under D2 default), the reset actions, the lambda, or the KB-1 snapshot
trigger. The snapshot trigger's UPDATE branches become reachable only by the
FK clearing. They stay as defence in depth if the refusal is ever relaxed.

**`data-test` attributes** for the E2E, with no visual change: the Canon tab
button in `story-screen.tsx`; in `canon-dashboard.tsx` the events list and
each event row; in `add-event-dialog.tsx` the trigger button, the key and
description inputs, and submit.

## 16. API and Event Design

- **PostgREST `/rest/v1/immutable_events`:**
  - `GET`: rows per `immutable_events_read`.
  - `POST`: 201, or 403/42501 when WITH CHECK fails.
  - `PATCH`: always 403/42501 "permission denied for table immutable_events"
    (was 200).
  - `DELETE`: 200 with the rows the D1 predicate allows (0 otherwise).
- **Server actions:** signatures unchanged. `addImmutableEventAction` gains
  the refusal value (§5). `deleteImmutableEventAction` becomes
  `returnRefusals`-wrapped, so its result type gains `{ refusal }`. It has no
  caller, so there is no compatibility impact.
- **RPC `commit_canon_changes`:** unchanged.
- No events or queues.

## 17. State and Lifecycle Design

```
 (none) ──insert by writer / RPC / lambda──► ACTIVE ──delete (D1 role, reset, regen, cascade)──► (gone)
                                              │
                                              └─ author deleted ─► ACTIVE, created_by NULL, name kept
 ACTIVE ──any other UPDATE──► refused (terminal for the statement; row unchanged)
```

No other states. "Correct an event" = delete + insert (a new row with a new
id, new author and new `created_at`).

## 18. Failure and Error Handling

| Failure | Behaviour | User sees | Recovery |
|---|---|---|---|
| RLS insert refusal | 42501 → `ActionRefusal` | refusal toast | none needed |
| Unique violation (race) | 23505 → thrown `Error` (unchanged) | generic toast | retry → duplicate refusal |
| UPDATE by anyone | 42501 privilege / trigger exception | API error | delete + re-add |
| Trigger wrongly blocks user deletion | user delete fails 42501 | admin sees the failure | **guarded by pgTAP I6** and the two KB-1 suites; rollback = drop trigger |
| Migration fails midway | transactional (Supabase runs each file in a transaction) | — | fix and re-run |
| Delete refused | 0 rows → refusal value | (no UI caller) | — |

## 19. Security

- **Authentication:** unchanged (`authenticated` role via JWT).
- **Authorization:** the owner's rule. Writes use `can_write_project` (KB-28).
  Reads use `has_account_access`. Destructive or editorial actions are
  owner/admin where the owner chooses (D1).
- **Authorship integrity:** FR-4 for direct inserts. The RPC and lambda set
  it themselves, and no path can change it afterwards.
- **Tenant isolation:** kept. The USING clause on SELECT and DELETE scopes
  to the account or project. WITH CHECK on INSERT scopes project and episode.
  Cross-account writes were already refused (R8, R9). FR-6 additionally stops
  a row in project A claiming provenance in account B's episode.
- **Least privilege:** UPDATE, TRUNCATE, REFERENCES and TRIGGER are revoked
  from `authenticated`, and everything from `anon` (anon has no policy
  either way).
- **Definer functions:** none added. The trigger is invoker. The two definer
  writers (KB-27) already enforce the insert rule. §8.3 records which
  deletes they perform and why.
- **Audit:** none exists for canon mutations (FILM-1005 `remaining:` row
  "Audit logging", unassigned). KB-17 does not add it; §31 Q3.
- **Abuse:** a writer can still delete canon (by D1 default, and through any
  reset). A deletion leaves no trace (no audit row) but cannot put words in
  someone else's mouth, which was the reported harm.

### 19.1 Class sweep: every `FOR ALL` policy without `WITH CHECK` (AC-3)

Measured from the live schema (`pg_policies where cmd = 'ALL' and
with_check is null`, M4), not by grep, because later migrations drop and
recreate policies. 17 policies:

| Table | Policy | Author/immutability claim? | Decision |
|---|---|---|---|
| `public.immutable_events` | `immutable_events_project_access` | **yes**: canon "cannot be contradicted"; `created_by` + KB-1 name | **Fixed by KB-17** |
| `public.narrative_threads` | `narrative_threads_project_access` | no author column; mutable by design (status, payoffs) | Not KB-17. Its **write predicate** is `has_role_on_account`, so viewers and non-project members can write, against the owner's canon write rule. Follow-up KB (number from the lead) |
| `public.world_states` | `world_states_project_access` | no; mutable by design (`updated_at`) | same follow-up |
| `public.episode_summaries` | `episode_summaries_access` | no; a regenerated cache | same follow-up |
| `public.act_context_bridges` | `act_context_bridges_project_access` | no; a derived cache | same follow-up |
| `public.sequel_parent_contexts` | `sequel_parent_contexts_project_access` | no; a derived cache of the parent's canon | same follow-up |
| `public.accounts`, `accounts_memberships`, `invitations`, `notifications`, `order_items`, `orders`, `role_permissions`, `subscription_items`, `subscriptions` | `restrict_mfa_*` (9) | n/a | **Correct as is.** These are Makerkit's `AS RESTRICTIVE` MFA gates (`20250302043537_mfa-rls-super-admin.sql`, 9 of 9 restrictive). A restrictive USING also constrains the new row, and they grant nothing |
| `cron.job`, `cron.job_run_details` | `cron_*_policy` | n/a | Extension-owned (pg_cron). Out of scope |

Same class, different shape (not `FOR ALL`, so not in M4, but the same
authorship hole): **`character_states`**. Its INSERT policy
(`20260128225704_canon_management.sql:253-261`) does not pin `created_by`, so
a member can insert a state change in a colleague's name. It also still uses
`has_role_on_account`. **`state_deltas`** ("immutable log") has DELETE
granted (`20260607183439`) and relies on the absence of a DELETE policy
(FILM-1002 `remaining:`, unassigned). Both belong in the follow-up KB, and
D4 applies.

## 20. Performance and Scale

Canon tables are small: tens to hundreds of rows per project, and
`getImmutableEventsAction` caps at 500. The predicates are the same order of
cost as today's. The insert check adds one indexed episode lookup (episodes
PK). No production path issues UPDATE, so the trigger never runs in steady
state. No load test is warranted.

## 21. Accessibility and Client Behavior

No layout change. The refusal uses the existing `toast.error` (sonner, an
ARIA live region). The dialog stays open on refusal, so focus stays in the
dialog. `data-test` attributes are invisible. English strings, like the rest
of the dialog.

## 22. Observability and Operations

- **Operator signal that it works:** a PATCH to `/rest/v1/immutable_events`
  returns 403 and PostgREST logs 42501. Trigger refusals appear in Postgres
  logs as `immutable_events rows cannot be changed`. A user deletion that
  involves an author succeeds (the GoTrue admin log shows no error).
- **Distinguishing expected from failure:** a trigger refusal from a service-role or
  lambda path would be a **bug** (no code updates this table). From an end-user token
  it is expected.
- `addImmutableEvent` already logs `console.error('Error adding immutable
  event', …)` on failure. Refusals are expected and are not logged as errors.
- No metrics or dashboards added. There is no audit trail of canon deletions
  (§31 Q3).

## 23. Configuration and Feature Flags

None. Canon visibility is still controlled by project metadata
`canon.enabled` (unchanged). No flag: the change is a correctness fix at the
database, and a flagged RLS policy would be a second policy to keep in step.

## 24. Compatibility

- **Clients:** no request or response shape change. PATCH was never used by
  the app.
- **Behaviour changes (intended):** viewers and non-project team members
  lose add, delete and edit. Personal owners gain read and add. Writers lose
  edit (they never had a UI for it).
- **Service role:** the lambda (insert and delete only) is unaffected. Any
  *future* backfill that UPDATEs events must
  `alter table … disable trigger immutable_events_refuse_update` inside its
  migration, as KB-1's backfill disabled user triggers. That friction is
  deliberate. Stated in the migration comment.
- **Tests:** `audit-author-snapshot.test.sql` (KB-1) performs three UPDATEs
  of `immutable_events` (lines 123, 150, 233) and one member insert naming
  another user (line 56). After this change those statements raise instead of
  being silently neutralised. They are rewritten as `throws_ok` with the same
  follow-up assertions. The rows end up unchanged, which is strictly stronger
  than "the name did not change". Its assertion "The name is the id's, even
  when the writer cannot read that user's account" can no longer be staged by
  a member, because FR-4 forbids the insert. It becomes the FR-4 refusal
  assertion, and the reason goes in the file's comment. Plan counts adjust.
- **Deployment order:** DB migration first (standard). The app changes are
  additive (a refusal mapping), so old app + new DB behaves correctly apart
  from a generic error for viewers until the app deploys.

## 25. Migration and Rollout Strategy

1. Merge after #316 (and #313). Retarget to `main` per the team's rebase
   rule, and re-timestamp the migration if needed.
2. Deploy runs `supabase db push`, which applies the single migration.
3. Verify in production with read-only checks only. **No production
   credentials are used by me.** The owner can run
   `select policyname, cmd from pg_policies where tablename =
   'immutable_events'` and see three rows. Adding a canon event in the UI as
   themselves works.
4. **Rollback trigger:** user deletion failing on `immutable_events`, or
   the canon UI failing for writers. **Procedure:** a reverse migration
   (restore the policy and grant, drop the trigger). No data rollback is
   needed.

## 26. Testing Strategy

**pgTAP, new `apps/web/supabase/tests/database/immutable-events-immutable.test.sql`**
(`select plan(N)`, never `no_plan()`; one fixture row per case, so cases
cannot chain). Users: team owner O, project member M, project viewer V,
team member without a project row T, personal-account owner S, outsider X.

| Case | Assertion | Red today? |
|---|---|---|
| I1 read | O, M, V, T see P's events. S sees their own. X sees none | **S red** (0 rows today, R7a) |
| I2 insert | M as self ✓. M naming O → 42501. V, T → 42501. S in own project ✓. X → 42501. M with a foreign `established_in` → 42501 | **red**: M naming O succeeds (R5), V/T succeed (R3c, R4b), S is refused (R7b), foreign episode succeeds (R6) |
| I3 update, end users | M and O PATCH description → 42501 privilege error; M sets `created_by` → 42501; row unchanged | **red** (member rewrite succeeds today) |
| I4 update, privileged | as `postgres` and `service_role`: description change → trigger exception; row unchanged | **red** |
| I5 nested non-clearing update | a test-local trigger on a temp table updates an event's description at depth 2 → exception | red |
| I6 user deletion | delete the author from `auth.users` → lives; `created_by` null; `created_by_name` kept | green before and after (the guard) |
| I7 delete | M ✓ (1 row). O ✓. V, T → 0 rows. X → 0 rows | **V/T red** (R3b, R4a) |
| I8 RPC | M calls `commit_canon_changes` → event `created_by` = M, `created_by_name` = M's name | green (pins KB-27 §19 i) |
| I9 shape | `policies_are(...)` = the three policies. `table_privs_are` for `authenticated` = SELECT, INSERT, DELETE and for `anon` = none. `trigger_is` for the refusal | red |

**Red before green:** run the new file on the base branch first (expect the
cases marked red to fail, each for its stated reason), then with the
migration. Then revert only the trigger and watch I4/I5 fail, and revert only
the policy split and watch I2/I3/I7 fail. Restore.

**Existing pgTAP that must stay green:** `audit-author-snapshot` (amended,
§24), `authors-deletable`, `canon-commit-access`, `bulk-reset-access`,
`definer-functions-inventory`, and the whole `supabase test db` suite.

**Unit (vitest, `packages/features/episodes`):**
- U1: `addImmutableEventAction` returns the refusal value when the insert
  returns 42501.
- U2: `deleteImmutableEventAction` returns the refusal on 0 rows and
  `{ success: true }` on 1.

Both mock the Supabase client, following
`src/lib/server/mutations/__tests__/season-generation-actions.test.ts`.

**Playwright, new `apps/e2e/tests/canon/canon-events.spec.ts`** (AC-4;
seeded through the API, not the UI; helpers local to the spec so it does not
collide with `seed.ts` edits in #313/#317):
- Fixture: team + project via `seedProject` (as owner), project metadata
  `canon.enabled = true`, an episode with `story_data.fullStory`, member M and
  viewer V via `seedMembership` and `seedProjectMember`.
- C1: M adds event A, then (the **second submission**) event B. Both appear
  in the list. DB rows (service-role read) have `created_by = M` and
  `created_by_name` = M's name.
- C2: V submits Add Event → refusal toast text. No row.
- `CAPTURE_EVIDENCE=1` variant: screenshots after C1's second save and of
  C2's refusal, for the PR.

**Red before green for C2:** before the migration V's insert succeeds, so
C2 fails.

## 27. Production-Build Verification

The refusal must survive the production build (KB-6: thrown messages are
redacted there). Run C2 against `next build && next start` on port 3121,
sandboxed per the team brief:

- `NODE_ENV=test` and `VENDOR_SANDBOX=1`.
- `VENDOR_URL_*` overrides for every vendor reachable from the story page.
- A pre-flight that aborts if any override is ignored.

Assert the exact refusal string, not merely an error toast. The canon add
path makes no vendor call, but the page loads others, so the sandbox still
applies.

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Prod verification |
|---|---|---|---|---|---|---|---|
| Canon cannot be edited | J5 | FR-1 | §14 revoke | grant | PATCH → 42501 | I3 | owner PATCH check (optional) |
| …by any path | J5 | FR-2 | §14 trigger | trigger | — | I4, I5 | — |
| Deleting a user still works | J7 | FR-3 | trigger exception | trigger | FK | I6, KB-1 suites | admin user delete |
| Author is the writer | J2 | FR-4 | insert WITH CHECK | policy | POST | I2 | — |
| Only writers add | J2/J3 | FR-5, FR-10 | insert WITH CHECK + refusal | policy, action | POST, action | I2, U1, C2 | owner adds an event |
| Provenance in project | — | FR-6 | insert WITH CHECK | policy | POST | I2 | — |
| Only D1 role deletes | — | FR-7, FR-11 | delete policy + action | policy, action | DELETE | I7, U2 | — |
| Personal owners see canon | J4 | FR-8 | read policy | policy | GET | I1 | — |
| RPC unaffected | — | FR-9 | none | RPC | rpc | I8 | publish flow |
| UI still creates | J2 | FR-12 | data-test | UI | action | C1 | owner adds an event |
| Class listed | — | FR-13 | §19.1 | — | — | `policies_are` | — |
| Bulk reset consistent | J6 | FR-14 | D2 | RPC | rpc | bulk-reset-access | — |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Why this one |
|---|---|---|
| Split per-verb policies + revoke UPDATE + trigger | (a) Policy only: does not bind service role or definer. (b) Trigger only: a PATCH by a member would raise from the trigger (works), but RLS would still let viewers insert and delete and forge authors. (c) `FOR ALL` with WITH CHECK: one predicate for all verbs cannot express "read on account, write on project" | Each layer covers what the others cannot, the same shape as `revenue_records` |
| Trigger exception by `pg_trigger_depth() > 1` + "only created_by → NULL" | Look up `auth.users` to confirm the author is gone (needs SECURITY DEFINER, which adds to the inventory) | Repo precedent (`authors-deletable` for three triggers), narrowed further by requiring nothing else to change. No definer needed |
| Insert predicate `can_write_project` | `has_role_on_account` (today), `has_account_access` | The owner's rule for canon writes; matches `commit_canon_changes` (KB-27 §19 iii) |
| Read predicate `has_account_access` | `has_role_on_account` (today; excludes personal owners); project visibility | The owner's rule: reads stay on account membership |
| Episode-in-project in the policy | composite FK `(established_in, project_id) → episodes(id, project_id)` (needs a new unique index on episodes and a validated FK over production rows) | Covers the only path that doesn't check it already. The FK is a stronger invariant; noted as a follow-up option, not needed for KB-17 |
| Keep `commit_canon_changes` SECURITY DEFINER | make it INVOKER now that policies agree (KB-27 §19 iii) | It also writes `episodes.metadata` and the KB-27 suite pins its current shape. Converting it is a separate change with its own risk; listed in §31 Q4 |
| Refusal as `ActionRefusal` value | thrown `Error` | KB-6: production redacts thrown messages |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| Trigger blocks user deletion | Users cannot be deleted (KB-1 regression) | pgTAP I6 + `authors-deletable` + `audit-author-snapshot`. M5 measured the nested depth (§8.2) | Exception written to the measured shape | Drop trigger (reverse migration) |
| A hidden UPDATE path exists | That path starts failing | Grep (§8.3) found none. Trigger errors are loud | — | Fix the path to delete + insert, or disable the trigger in a migration |
| Viewers relied on adding canon | Workflow change for viewers | Owner review of §5 | Intended per the owner's rule | — |
| D1 = owner/admin chosen without gating resets | Members still delete canon via reset or regeneration, and a member's single reset silently keeps canon (0-row delete, non-fatal) | §8.3 table | D1 default avoids it; if owner/admin is chosen, D2 scope applies | — |
| Insert check depends on episodes RLS | A project writer who cannot read the episode is refused | I2 positive cases (M, S) | Writers can read their project's episodes (`episodes_read`) | Definer helper |
| Amended KB-1 test loses coverage | KB-1 regression unguarded | Review the diff of that file | Each changed assertion keeps its follow-up `is(...)` | — |
| Stacked-branch drift (#316/#313 change) | Rebase conflicts | CI | Team rebase rule; re-timestamp the migration | — |

## 31. Open Questions and Assumptions

**Decisions for the owner:**

- **D1: who may delete canon events?** It matters because deletion is the
  one mutation left.
  - **Default: project writers (`can_write_project`: owner, admin, member).**
    Every existing delete path is already open to writers: both single-episode
    resets, bulk reset (KB-27, owner-approved rule) and story regeneration
    (lambda). A narrower direct-delete rule would bind only a path with no UI
    caller, and would make a member's single-episode reset silently keep the
    canon (0-row delete, non-fatal). The reported harm was *silent rewriting and
    forged authorship*, which FR-1–FR-4 remove regardless of D1.
  - *Alternative A: owner/admin (`can_edit_project`)*, "destructive is
    editorial". To be real it must also gate the single resets, bulk reset
    (stages draft/story) and story regeneration of episodes that have canon.
    That touches `episodes/src/server/actions.ts` (overlaps KB-31, #315), the
    bulk-reset RPC and the lambda. It is roughly twice the scope, and a
    product change for members.
  - *Alternative B: the event's author, or owner/admin.* Same gating problem,
    plus lambda-authored events belong to whoever ran generation.
- **D2: does bulk reset follow D1?** Default: **yes, and with D1's default it
  already does**. `bulk_reset_episodes_to_stage` requires `can_write_project`
  for every episode (KB-27), so no change. If D1 = owner/admin, add
  `can_edit_project(p.id)` to its step-1 check for stages `draft`/`story` (the
  ones that delete canon), and mirror it into `schemas/22-bulk-reset-rpc.sql`.
- **D3: may anyone amend an event?** Default: **no one, ever.** Correction is
  delete + re-add, which re-attributes it honestly. *Alternative:* owner/admin
  may edit `description` only. That needs an UPDATE policy, a narrower trigger
  and a way to record who edited, and the table has no column for it.
- **D4: the class sweep's findings.** Default: **list them in the PR and
  FILM-CC-04, fix only `immutable_events` here**, and ask the lead for KB
  numbers for the rest (§19.1). Alternative: widen KB-17 to the other canon
  tables.

**Assumptions / questions:**

- **Q1:** personal-account owners reach the studio canon tab. The DB half is
  measured (R7). Whether the personal-account studio route renders the canon
  dashboard is not checked, and C1 uses a team project.
- **Q2:** forged rows written before this migration cannot be detected (no
  history). Accepted.
- **Q3:** there is no audit trail of canon deletions (FILM-1005,
  unassigned). Out of scope.
- **Q4:** `commit_canon_changes` could become SECURITY INVOKER once these
  policies land (KB-27 §19 iii). Proposed as a follow-up, not done here.
- **Q5:** story regeneration deletes *manually added* canon established in
  that episode, not only its own auto-generated events
  (`commit-story-canon.ts:109` filters on `established_in` only). Likely
  unintended. Reported, not fixed here (needs a lead-assigned KB number).

## 32. Implementation Plan

1. **pgTAP first (red).** Write `immutable-events-immutable.test.sql`. Run it
   on the base schema under the DB lock and record which cases fail and why
   (for the PR).
2. **Migration.** Write it, run `supabase migration up` (or reset), run the new
   suite green. Then run the reverse checks: trigger removed, then policy split
   removed. Restore.
3. **Amend `audit-author-snapshot.test.sql`** (§24). Run it together with
   `authors-deletable`, `canon-commit-access`, `bulk-reset-access` and
   `definer-functions-inventory`, then the full `supabase test db`.
4. **Typegen:** run it and confirm no diff.
5. **Actions:** make the `addImmutableEvent` refusal mapping and the
   `deleteImmutableEventAction` 0-row refusal and doc comment. Unit tests U1
   and U2, red first (revert the mapping and watch them fail).
6. **`data-test` attributes + Playwright C1/C2**, dev server on port 3121.
   Red: C2 against the pre-migration DB. Evidence screenshots.
7. **Production build C2**, sandboxed (§27).
8. **Records:** KB-17 entry → Fixed with the PR number, plus one row in the
   Fixed table. FILM-1002 and FILM-1005: flip the criteria KB-17 closes and
   clear the matching `remaining:` rows. FILM-1002's criterion "Policies use
   existing `has_role_on_account` function" stops being true for
   `immutable_events` (it moves to the owner's predicates), so reword that
   criterion's evidence rather than leave it false. Add the §19.1 list to
   KB-17's entry.
9. `pnpm typecheck`, `pnpm lint:fix`, `pnpm format:fix`. Push, then open the PR
   against `fix/kb-27-commit-canon-membership` with the first line "Stacked on
   #316 — retarget to main after #316 merges."

If D1/D2 pick owner/admin, insert between 2 and 3: gate the reset actions,
bulk reset and regeneration (§31 D1-A), with pgTAP/E2E for each. That is a
material scope change, so re-plan it.

## 33. Definition of Done

- Every FR has a passing test, and each guard was seen red for its stated reason.
- KB-1 behaviour intact: user deletion with authored events succeeds, name kept.
- Canon UI adds events (C1, including the second submission). The viewer
  refusal renders in the production build (§27).
- `policies_are` pins the three policies. The inventory test is unchanged and green.
- Typegen produces no diff. typecheck, lint and format are clean.
- KB-17 is marked Fixed. FILM-1002/1005 are updated. The §19.1 list is in the PR and FILM-CC-04.
- Screenshots are in the PR (C1 after the second save, C2 refusal).
- The owner decisions D1–D4 are recorded in this EDD as decided.

## 34. Final Consistency Pass

**Forward.**

- Problem: canon is silently editable and forgeable, and personal owners
  can't use it.
- Outcome: write-once canon, honest authorship, writers-only changes, and
  personal owners included.
- Flows J1–J7 map to FR-1…FR-14.
- The system behaviour (§9) needs only policies, a grant, one trigger and two
  action tweaks (§14–15).
- Tests I1–I9, U1–U2 and C1–C2 cover every FR (§28).
- Rollout is one migration with a reverse migration, and the production
  check needs no credentials.

**Reverse.** In production:

- The only new behaviours are refusals (PATCH, forged author, non-writer
  insert or delete, privileged UPDATE) and one widening (personal owners
  read and add their own canon).
- No path the app uses issues UPDATE (§8.3). So the only user-visible
  changes are the viewer refusal and personal-owner access, exactly §5's
  table.
- Deletes stay available to exactly the roles D1 names. Under the default,
  that matches every reset path, so no user sees a reset that "succeeds"
  while keeping canon.

Both directions converge on §1. The open item that could change this is
D1. If the owner picks owner/admin, the reverse pass changes (resets must be
gated), and §32 marks that as a re-plan rather than an in-flight tweak.
