# KB-27 — Engineering Design Document

**Ticket:** KB-27 — "Any signed-in user can write canon into any project"
(`specs/cross-cutting/FILM-CC-04-known-bugs.md`, `## KB-27`). Severity High,
cross-tenant write.
**Branch:** `fix/kb-27-commit-canon-membership`, base `origin/main` (`49b851d6`).
**Related:** KB-17 (`immutable_events` are not immutable; queued after this),
FILM-1002 (canon RLS; its `remaining:` names KB-27 and KB-17), FILM-1005
(canon actions; cites KB-27), KB-11 (the same shape in analytics, and the
source of the `has_account_access` precedent).
**Status:** plan, awaiting owner approval. Nothing below is implemented.

Evidence labels used throughout: **measured** = executed on the local stack
on 2026-09-23 with the output quoted; **by reading** = read from the code
and not executed.

---

## 1. Start With the User

**Who.** Two people. The *project owner or team member* who writes episodes
and saves canon (the permanent facts the continuity checker refuses to let
later episodes contradict). And the *other tenant*: anyone else with an
account on the platform.

**The problem today (measured).** Anyone who can sign in can write canon into
a project they cannot even see. They can add a permanent event ("the hero is
dead") that will make future generation for that project fail its continuity
check, and overwrite the episode's canon summary, which later episodes are
built from. The forged event carries no author, so the owner cannot tell who
did it. The same shape exists in `bulk_reset_episodes_to_stage`, which lets
anyone wipe another tenant's story, screenplay, shots, audio and canon.

**What the user gets after the fix.**

- The owner/team member: nothing changes in what they see or do. "Save to
  Canon" on the Publish page commits exactly as before, and each event it
  writes now records who saved it (`created_by`, and the name via KB-1's
  snapshot). No screen shows an event's author today, so this is recorded,
  not displayed.
- The other tenant: a direct call against someone else's project is refused
  with a permission error, and nothing is written. The same for bulk reset.

**Success:** a non-member's call writes nothing and is refused; every member
(team member *or* personal-account owner) still commits; events carry the
caller as author. **Failure:** any row written by a non-member, or any
member who could commit before and cannot now.

**What persists:** committed events and the merged `canonSummary` /
`sentimentScore`, as today. **What does not:** nothing from a refused call —
the function is one transaction and raises before its first write.

## 2. Define the Complete User Journey

The only product entry point is the Publish page
(`apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/publish`),
which mounts `EpisodeSummaryGenerator` (`publish-screen.tsx:1371`).

| Stage | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| Entry | Member opens Publish for an episode with story text >100 chars | `extractCanonChangesAction` runs (LLM, or a basic fallback on LLM failure) | "Episode Summary & Canon" card with summary, sentiment, detected events | Edit summary, remove events, Re-analyze, or Save |
| Save | Clicks **Save to Canon** | `commitCanonChangesAction` → `rpc('commit_canon_changes')` → thread updates under RLS | Toast "Canon updated: N events, M threads, summary saved" | Leave, or save again |
| Save again | Clicks Save a second time with the same events | Unique `(project_id, event_key)` violation; whole RPC rolls back | Toast "Failed to commit canon changes" (pre-existing; unchanged; see §4) | — |
| Refresh / leave | — | Nothing held client-side; extraction re-runs on mount | Card re-extracts | — |
| Attack (not a UI path) | Another tenant calls the RPC directly over PostgREST with their own JWT | **After fix:** access check fails, `42501` raised, nothing written | HTTP 403-class error body with a generic message | — |

A non-member cannot reach the Publish page for someone else's project at
all (`projects_read`, `episodes_read` return nothing — measured, steps 1–2
of the reproduction), so the refusal has no UI.

## 3. Explicitly Define the Happy Path

1. A member of team account *T* (any role) opens Publish for episode *E* of
   project *P* in *T*.
2. Extraction fills the card. The member clicks **Save to Canon**.
3. The server action calls `commit_canon_changes(P, E, season, number,
   events, summary, sentiment)` with the member's session.
4. The function resolves *P*'s account **through *E*** (the episode must
   belong to *P*), and checks `has_account_access(account)` for the caller.
   Passes.
5. It inserts the high-confidence events into `immutable_events` with
   `created_by = auth.uid()`; the KB-1 trigger fills `created_by_name`.
6. It merges `canonSummary` and `sentimentScore` into `episodes.metadata` in
   one `UPDATE`, keeping every other key.
7. Returns `{"eventsCreated": n, "summaryStored": true}`; the action then
   applies thread updates under RLS (unchanged) and returns the counts.
8. The member sees the success toast. Success because the rows exist,
   carry the member as author, and nothing outside *P*/*E* changed.

A personal-account owner on their own project follows the same path: step 4
passes on the owner branch of `has_account_access`.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| Caller not signed in (`anon`) | No `EXECUTE` grant; PostgREST refuses (unchanged; measured `anon|f`) | Error body | — | Nothing written |
| Caller signed in, no access to *P*'s account | `raise … using errcode = '42501'` before any write | Error body; in the app the generic toast | — | Nothing written |
| *E* belongs to a different project than *P* | Same refusal, same message (not distinguishable from "no access") | Same | — | Nothing written in either project |
| *P* or *E* does not exist | Same refusal, same message | Same | — | Nothing written. (Today the FK error message reveals existence; the fix removes that oracle.) |
| Membership revoked between page load and Save | Refused at call time | Generic failure toast | Re-load; page no longer visible | Nothing written |
| Duplicate `event_key` (Save twice) | `23505` unique violation; the transaction rolls back, summary included | Generic failure toast | Remove the event, save again | Unchanged from first save. **Pre-existing**, not changed here; noted in §31 |
| Invalid event type from the client | `23514` check violation; rollback | Generic failure toast | — | Nothing written (pre-existing) |
| `p_events` not a JSON array | `jsonb_array_length` error; rollback | Generic failure toast | — | Pre-existing |
| Database/network failure | Error returned to action; action throws; UI catch shows toast | Generic failure toast | Retry | Nothing partially written (one transaction) |
| Called with the service-role key (no `auth.uid()`) | Refused | — | — | No such caller exists (`git grep` finds one caller, the user-session action). Deliberate: the function writes `created_by = auth.uid()` and has nobody to name |

Bulk reset alternate paths are in §18.

## 5. Establish the User-Facing Contract

- **Inputs, outputs, UI states:** unchanged. Same RPC signature, same
  `{"eventsCreated", "summaryStored"}` result, same toasts.
- **New refusal:** SQLSTATE `42501`, message `No access to this project's
  canon`, one message for every refusal reason so the call is not an
  existence oracle.
- **Permissions:** a caller may commit canon for project *P* iff they are
  the primary owner of *P*'s account or hold any role on it
  (`has_account_access`), and the episode is *P*'s.
- **Data now visible to the user:** events saved from the Publish page will
  show an author (`created_by`, `created_by_name`) where they showed none.
  No screen currently renders the author of an event (by reading:
  `mapImmutableEvent` maps `created_by`, and no component displays it), so
  nothing visible changes today.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Why | Verification |
|---|---|---|---|
| FR-1 | `commit_canon_changes` refuses a caller without `has_account_access` on the project's account, raising `42501` before any write | The defect | pgTAP T1, T2 (red first) + HTTP rerun of the reproduction |
| FR-2 | It refuses when the episode is not in the given project | Measured: mismatched ids wrote into the attacker's project *and* the victim's episode | pgTAP T3 (red first) |
| FR-3 | Events it writes carry `created_by = auth.uid()` | AC 2; authorship; KB-17 compatibility | pgTAP T4, T5 (red first: today NULL, measured) |
| FR-4 | A team member (any role, with or without a `project_members` row) and a personal-account owner still commit | Do not break the product | pgTAP T4, T5; UI check (§26) |
| FR-5 | Function runs with `search_path = ''` and schema-qualified names | Definer-hygiene; the ticket asks for it | pgTAP inventory I2 |
| FR-6 | A refused or failed call writes nothing (atomic) | The function's reason to exist | pgTAP T1–T3 row counts; T8 duplicate-key rollback |
| FR-7 | `bulk_reset_episodes_to_stage` refuses a caller without `has_account_access` on `p_account_id` | Measured cross-tenant wipe (§8) | pgTAP B1 (red first) — **if approved (Decision 2)** |
| FR-8 | `bulk_reset_episodes_to_stage` refuses unless **every** id is an episode (deleted or not) of a project in `p_account_id` | Measured: a soft-deleted episode of another tenant passes today's check even when the caller names their own account | pgTAP B2 (red first) — **if approved** |
| FR-9 | Every `SECURITY DEFINER` function executable by `authenticated` is listed with its access check, and a test fails if that set changes without the list changing | AC 3; fix the class, durably | Inventory table (§8, and in the KB entry) + pgTAP I1 |

## 7. Define Non-Functional Requirements

- **Security:** tenant isolation for canon writes (FR-1/2/7/8); no
  existence oracle; `search_path` pinned.
- **Performance:** adds two primary-key lookups and one `has_account_access`
  call (two more PK lookups) per commit — sub-millisecond; commits are
  human-initiated, a few per episode.
- **Compatibility:** same signature and return; generated types unchanged
  (`check:types-current` must stay clean).
- **Observability:** refusals are visible as `42501` in PostgREST/Postgres
  logs; the action already logs `Failed to commit canon changes` with the
  error.
- **Accessibility, i18n:** no UI change.
- **Cost, DR, scale:** none.

## 8. Analyze the Existing System

**The call chain.** `EpisodeSummaryGenerator.handleCommit`
(`episode-summary-generator.tsx:141`) → `commitCanonChangesAction`
(`packages/features/episodes/src/server/canon-actions.ts:1175`), which passes
the client's `projectId`/`episodeId` straight to `client.rpc(
'commit_canon_changes', …)` (`:1201`) with the user's session, then updates
`narrative_threads` under RLS. It is the function's only caller
(`git grep commit_canon_changes`, excluding migrations and generated types).

**The function** (`apps/web/supabase/migrations/20260130004332_add_commit_canon_changes_function.sql`):
`SECURITY DEFINER` (`:16`), no `search_path`, no membership check, inserts
events for any `p_project_id` (`:26`) without `created_by`, reads then
rewrites any `p_episode_id`'s metadata (`:50`, `:60`), wraps every error as
`P0001` (`:70`), granted to `authenticated` (`:77`). No schema file mirrors it
(FILM-1002's note names `schemas/31-canon-management.sql`, which does not
exist).

**Access rules around it (by reading, and measured where stated).**

| Table / path | Rule |
|---|---|
| `immutable_events` (all ops) | `has_role_on_account(p.account_id)` — one `FOR ALL` policy (`20260128225704_canon_management.sql:230`) |
| `episodes` update | personal-account owner, **or** a `project_members` row with owner/admin/member (`20260201100000_fix_episodes_rls.sql:7`) |
| `projects`/`episodes` read | personal owner or `has_role_on_account`; **plus** anyone for `public`/`unlisted` (`20260108120000_public_sharing_rls.sql:28,43`) |
| `has_account_access(a)` | primary owner of *a* or any role on *a* (`20251210201500_fix-account-rls-helpers.sql:83`) |

**Measured on the local stack (2026-09-23), which decides the design:**
personal accounts with a membership row: **0 of 7**. A personal-account owner
direct-inserting an event into **their own** project through RLS:
`42501 new row violates row-level security policy`. The same owner through
`commit_canon_changes`: `{"eventsCreated": 1, "summaryStored": true}`. So the
canon table's own rule (`has_role_on_account`) excludes personal-account
owners, and only the definer bypass lets them commit today.
`project_members` gets one row per project, the creator
(`add_project_creator_as_owner`, `20251016143639_projects.sql:430`), so most
team members have no `project_members` row.

### Reproduction (measured, two real GoTrue users, over PostgREST)

Fresh `supabase db reset` from this branch, under the DB lock. `owner` owns
team account *T* with private project *P* and episode *E* (metadata
`{"canonSummary":"The real summary","keep":"me"}`). `stranger` is a second
real user with only their personal account and a project *S* on it. All
calls below are `curl` against `/rest/v1` with the stranger's own access
token (script: scratchpad `kb27/repro.sh`).

| # | Stranger's request | Result |
|---|---|---|
| 1 | `GET projects?id=eq.P` | `[]` |
| 2 | `GET episodes?id=eq.E` | `[]` |
| 3 | `POST immutable_events` into *P* (direct) | `42501 new row violates row-level security policy` |
| 4 | `POST rpc/commit_canon_changes` (*P*, *E*, a `death` event, "FORGED canon summary") | `{"eventsCreated": 1, "summaryStored": true}` |
| 5 | `POST rpc/commit_canon_changes` (**own** *S*, **victim** *E*) | `{"eventsCreated": 1, "summaryStored": true}` |
| 6 | as postgres afterwards | event `character:hero:dead` in *P*, `created_by` **NULL**; event `mismatch:1` in *S* with `established_in` = *E*; *E*'s metadata `{"keep": "me", "canonSummary": "FORGED via mismatched ids", "sentimentScore": 0.20}` |
| 9a | owner's own legitimate commit | succeeds, `created_by` **NULL** |
| 9b | stranger's commit on own personal project | succeeds, `created_by` **NULL** |

Rows 9a/9b: **every event this function has ever written has
`created_by` NULL**, legitimate or not. Function privileges: `anon` false,
`authenticated` true, `service_role` true; `prosecdef` true, `proconfig` null.
Test users and rows were deleted afterwards (`left|0`).

### Class sweep: every SECURITY DEFINER function `authenticated` can execute

Catalogue query over `pg_proc` (`prosecdef` and
`has_function_privilege('authenticated', oid, 'EXECUTE')`), non-Supabase
schemas. Control: the Makerkit helpers I expected (`has_permission`,
`accept_invitation`, …) are absent because they are `SECURITY INVOKER` here
(`prosecdef = f`, measured), and the two I knew to be definer
(`has_role_on_account`, `commit_canon_changes`) are present. `public` has 37
definer functions, 22 executable by `authenticated`; `kit` has 5, none
executable.

Each suspected hole below was then executed as the stranger over PostgREST
against a **public** victim project (script `kb27/repro2.sh`, `repro3.sh`).
Step 0 of that run shows the ids are not secrets: the stranger listed the
public project's `id`/`account_id` and its episode ids, while the direct
canon read returned `[]`.

| Function | Access check | Verdict |
|---|---|---|
| `commit_canon_changes` | **none** | **KB-27** — measured |
| `bulk_reset_episodes_to_stage` | checks the episodes belong to `p_account_id`, never that the caller may act for `p_account_id`; the check skips soft-deleted episodes, the deletes do not | **Hole ×2, measured.** (a) naming the victim's account: `{"errors": [], "reset_count": 1}`, victim's `story_data` NULL, its canon event gone. (b) naming **own** account with a victim's soft-deleted episode: `{"errors": [], "reset_count": 0}` — looks harmless — and the victim's canon event is deleted. Canon-deleting. Its migration header says it "uses SECURITY DEFINER … with explicit authorization checks" (`20260608014516_bulk-reset-episodes-rpc.sql:6`) |
| `batch_assemble_edit_project` | membership of the **caller-supplied** `p_user_id`, not `auth.uid()`; `search_path=public` | **Hole, measured**: passing the owner's id replaced the victim episode's edit project; passing own id refused |
| `get_project_members` | **none** | **Hole, measured**: returned the victim owner's email |
| `update_project_cover_image` | **none** | **Hole, measured**: victim's `coverImageUrl` set to `https://attacker.example/x.png` (HTTP 204) |
| `check_account_budget` | **none** | **Low, measured**: returned `true` for the victim account; raises "Account not found" otherwise (existence oracle) |
| `batch_create_shots` | `project_members` owner/admin/member via `auth.uid()` | OK (by reading) |
| `create_character_with_details` | `project_members` owner/admin/member | OK (by reading) |
| `get_account_projects` | personal owner or `has_role_on_account` | OK (by reading) |
| `get_project_generation_costs` | `project_members`, any role | OK (by reading) |
| `increment_template_usage` | system template, or owner/role on its account | OK (by reading) |
| `is_team_member` | requires the caller's own membership | OK (by reading) |
| `soft_delete_episode` | `project_members` owner/admin | OK (by reading) |
| `update_episode_with_lock` | `project_members` owner/admin/member | OK (by reading) |
| `can_edit_project`, `is_project_owner`, `has_role_on_account`, `has_account_access`, `user_owns_account`, `get_current_account_id`, `is_mfa_compliant` | predicates about `auth.uid()` itself | Needs none: each answers a question about the caller |
| `verify_nonce` | the token is the credential (`crypt` compare); `p_user_id` only narrows user-bound tokens | Needs none beyond the token (Makerkit upstream) |

Definer functions **not** executable by `authenticated`, recorded because
they are canon-adjacent: `remove_episode_from_threads_touched` (no check, no
`search_path`; called from bulk reset in definer context — and also over
RPC by the single-episode `resetToStageHandler`
(`packages/features/episodes/src/server/actions.ts:1900`), where it can only
fail with a permission error that is logged as "non-fatal"; by reading plus
the measured privilege). **It must not be granted to `authenticated` as a
"fix" for that warning without adding a check** — it would become a
cross-tenant write. Triggers `immutable_events_snapshot_creator_name`,
`verified_facts_snapshot_verifier_name`, `enforce_verified_facts_update_rules`
are not callable (the last two are KB-18's area; untouched).

## 9. Define the Desired System Behavior

**Save to Canon.** User action → `commitCanonChangesAction` (unchanged) →
`rpc('commit_canon_changes')` as the user → function: resolve account via
`projects ⋈ episodes` on (*P*, *E*) → `has_account_access` → insert events
with `created_by = auth.uid()` → single-statement metadata merge → result →
action applies thread updates under RLS → toast.

**Direct call by a non-member.** PostgREST → function → access check fails →
`42501` → PostgREST error body → nothing written.

**Bulk reset (if approved).** `bulkResetToStageAction` (unchanged) →
`rpc('bulk_reset_episodes_to_stage')` → function: stage validation → access
check on `p_account_id` → every id must be an episode of that account
(soft-deleted included) → unchanged cleanup → result. A refusal is returned
in the existing `errors` array (the function's own convention, already
surfaced by the action as a value, which is KB-6-compatible).

## 10. High-Level Architecture

No new components. The trust boundary is the Postgres function: PostgREST
exposes every function `authenticated` can execute as `POST /rest/v1/rpc/…`,
so a check in the server action protects nothing (measured: the attack never
touches the action). The fix therefore lives in the database, next to the
bypass it guards. Components: browser → Next server action (user session) →
PostgREST → `commit_canon_changes` (definer) → `immutable_events`,
`episodes`. Access derives from one existing helper, `has_account_access`,
so the rule is not re-derived by hand (the KB-11 lesson).

## 11. Architecture and Flow Diagrams

```
Browser (member)                        Browser/curl (other tenant)
   | Save to Canon                          | POST /rest/v1/rpc/commit_canon_changes
   v                                        |   (own JWT, victim ids)
commitCanonChangesAction  --rpc-->  PostgREST  <--+
   (user session)                      |
                                       v
                     commit_canon_changes  [SECURITY DEFINER, search_path='']
                       1. account := projects p JOIN episodes e
                                     WHERE p.id=P AND e.id=E AND e.project_id=p.id
                       2. auth.uid() null OR account null
                          OR NOT has_account_access(account)
                              --> RAISE 42501 'No access to this project''s canon'
                       3. INSERT immutable_events (..., created_by = auth.uid())
                              --> trigger: created_by_name snapshot (KB-1)
                       4. UPDATE episodes SET metadata = metadata || {...} WHERE id=E
                       5. RETURN {eventsCreated, summaryStored}
```

## 12. End-to-End Data Flow

Source: the LLM extraction (or fallback), edited by the user in the card →
client state → server action input (Zod-validated: uuids, enum event types,
confidence) → filtered to high-confidence events → RPC params → function →
`immutable_events` rows and `episodes.metadata` keys → read later by the
continuity validator and memory-context builder for this project.

Points of corruption today: **any tenant** can inject rows/keys (fixed);
the metadata merge is read-then-write in two statements, so a concurrent
metadata write between them is lost (fixed incidentally by the single
`UPDATE … metadata || …`; nothing newly permitted). Duplication: the unique
`(project_id, event_key)` refuses a second identical event (unchanged).
Retention/deletion: unchanged (cascade on project/episode delete; KB-1 FK
set-null on user delete).

## 13. Data Model

No entity changes. `immutable_events.created_by` (FK `auth.users`,
`on delete set null` since KB-1) becomes populated on this path; the KB-1
trigger derives `created_by_name` from it. `episodes.metadata.canonSummary`
and `.sentimentScore` are authoritative for episode canon summaries. The
account that owns a project is authoritative for canon access.

## 14. Database Design and Changes

One hand-written migration, `apps/web/supabase/migrations/<UTC timestamp>_kb27-definer-canon-access.sql`:

1. `create or replace function public.commit_canon_changes(...)` — same
   signature and return type; `security definer`, `set search_path = ''`,
   qualified names; body per §15. `revoke execute … from public, anon`;
   `grant execute … to authenticated, service_role` (restating today's ACL,
   measured).
2. *(Decision 2)* `create or replace function public.bulk_reset_episodes_to_stage(...)`
   — same signature; adds the access check and the all-ids ownership check
   (§15). Mirrored into `apps/web/supabase/schemas/22-bulk-reset-rpc.sql`.
3. *(Decision 2)* `alter function public.remove_episode_from_threads_touched(uuid, uuid) set search_path = ''`
   — its body already qualifies `public.narrative_threads`; no grant change.

No tables, columns, indexes or data change. No backfill (Decision 7). Locking:
`CREATE OR REPLACE FUNCTION` takes a brief lock on the function only. Rollback:
a forward migration restoring the previous body (reintroduces the hole; last
resort). Types: signature unchanged, so `pnpm supabase:web:typegen` must
produce no diff — checked in CI by `check:types-current`.

## 15. Low-Level Design

```sql
create or replace function public.commit_canon_changes(
  p_project_id uuid, p_episode_id uuid, p_season integer, p_episode_number integer,
  p_events jsonb, p_episode_summary text, p_sentiment_score numeric(3,2))
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_account_id uuid;
  v_events_created integer := 0;
begin
  -- The episode must be this project's; the account is read through both.
  select p.account_id into v_account_id
    from public.projects p
    join public.episodes e on e.project_id = p.id
   where p.id = p_project_id and e.id = p_episode_id;

  if v_uid is null or v_account_id is null
     or not public.has_account_access(v_account_id) then
    raise exception 'No access to this project''s canon' using errcode = '42501';
  end if;

  if jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 0 then
    insert into public.immutable_events (project_id, event_type, event_key, description,
                                         established_in, season, episode_number, created_by)
    select p_project_id, ev->>'type', ev->>'eventKey', ev->>'description',
           p_episode_id, p_season, p_episode_number, v_uid
      from jsonb_array_elements(p_events) ev;
    get diagnostics v_events_created = row_count;
  end if;

  update public.episodes
     set metadata = coalesce(metadata, '{}'::jsonb)
                    || jsonb_build_object('canonSummary', p_episode_summary,
                                          'sentimentScore', p_sentiment_score)
   where id = p_episode_id;

  return jsonb_build_object('eventsCreated', v_events_created, 'summaryStored', true);
end $$;
```

Choices, each with its reason:

- **`has_account_access`, not `has_role_on_account`** — measured: 0/7
  personal accounts have a membership row, and personal owners commit today;
  `has_role_on_account` would lock them out (Decision 1).
- **Account-level, not `project_members`** — the canon tables' own rule is
  account-level; most team members have no `project_members` row, so the
  stricter rule would stop members who commit today (Decision 1).
- **The `EXCEPTION WHEN OTHERS` wrapper is removed.** It re-raised every
  error as `P0001`, which would hide `42501` and `23505`. A plpgsql error
  already aborts the statement's transaction, so the wrapper bought nothing
  but a prefix (only caller: the action, which prepends its own).
- **Soft-deleted episodes** are not filtered — today's behaviour; the Publish
  page cannot show one. Left as is (§31).
- **What the fix newly permits:** nothing. It removes callers; the single
  `UPDATE` merge is the same result without the lost-update window. The only
  newly refused legitimate-looking caller is the service role, which has no
  caller.

Bulk reset (Decision 2), inserted after the empty-input short-circuit,
replacing the current ownership count:

```sql
if auth.uid() is null or not public.has_account_access(p_account_id) then
  return jsonb_build_object('reset_count', 0, 'errors', jsonb_build_array(
    jsonb_build_object('episode_id', null, 'error', 'You do not have access to these episodes')));
end if;

select count(*) into v_unauthorized_count
  from unnest(p_episode_ids) as ids(id)
 where not exists (select 1 from public.episodes e
                     join public.projects p on p.id = e.project_id
                    where e.id = ids.id and p.account_id = p_account_id);
-- (no deleted_at filter: the deletes below do not filter it either)
```

The refusal is returned, not raised, matching the function's existing
convention (its `EXCEPTION` block turns errors into the `errors` array, and
the action already hands that array back as a value). Newly refused: ids that
do not exist (previously ignored silently; harmless to refuse).

## 16. API and Event Design

`POST /rest/v1/rpc/commit_canon_changes` — request and success response
unchanged. New error: `42501`, `{"code":"42501","message":"No access to this
project's canon"}`. Other errors now keep their own SQLSTATE (`23505`,
`23514`) instead of `P0001` with a prefix. Authentication: JWT required
(unchanged). Authorization: FR-1/FR-2. Idempotency: not idempotent for events
(unique key refuses a repeat), idempotent for the summary. No events/queues.

`POST /rest/v1/rpc/bulk_reset_episodes_to_stage` (Decision 2) — unchanged
shape; new refusal entries in `errors`.

## 17. State and Lifecycle Design

No lifecycle changes. Events remain write-once from this path (KB-17 owns
the table-level immutability). Episode status is not touched by commit.

## 18. Failure and Error Handling

| Operation | Failure | System | User | Recovery |
|---|---|---|---|---|
| commit | no access / mismatch / missing | `42501` before writes | generic toast (action throws; prod-redacted message is fine because no legitimate user can reach it) | none needed |
| commit | duplicate key, bad type | rollback, native SQLSTATE | generic toast | edit and retry (pre-existing) |
| commit | thread updates fail | logged, counts lower (unchanged) | toast shows thread count | — |
| bulk reset | no access to `p_account_id` | `errors[0]` "You do not have access to these episodes", `reset_count 0`, nothing deleted | the existing error display in `episode-list-wrapper` / `season-header` | — |
| bulk reset | an id not in the account | existing "N episode(s) do not belong…" error, nothing deleted | same | deselect |

The action is **not** wrapped with `returnRefusals` (Decision 4): its refusal
is unreachable from the UI, and wrapping changes the client's return shape.

## 19. Security

- **Tenant isolation:** FR-1/2 close the reproduced write; FR-7/8 close the
  reproduced wipe. `has_account_access` is itself `SECURITY DEFINER` with
  `search_path = ''` and returns false for a null `auth.uid()`.
- **Trust boundary:** the database function, because PostgREST exposes it
  directly; action-level checks cannot guard an RPC.
- **Existence oracle:** removed (one message for all refusals).
- **search_path:** pinned to `''`; all names qualified.
- **Authorship:** `created_by` is the caller, never a parameter.
- **Least privilege:** `EXECUTE` only for `authenticated` and `service_role`;
  `anon` stays without it (measured).
- **IDs are not secrets:** public/unlisted projects expose project, account
  and episode ids to every signed-in user (measured, step 0), so "they would
  need the UUID" is not a mitigation for any function in §8.
- **Audit:** no audit-log row for canon commits today; unchanged.
- **Remaining holes found by this sweep, not fixed here unless Decision 2 says
  so:** `batch_assemble_edit_project`, `get_project_members`,
  `update_project_cover_image` (High/Medium, measured), `check_account_budget`
  (Low, measured). Proposed as new KB entries for the lead to number.

### What KB-17 will need (and why this design does not make it harder)

1. **The function stays `SECURITY DEFINER`, so KB-17's new `immutable_events`
   policies will not apply inside it.** It already enforces what KB-17's
   INSERT `WITH CHECK (created_by = auth.uid())` will require — it writes
   `auth.uid()` itself — and pgTAP T4 asserts it. KB-17's suite should call
   `commit_canon_changes` once and assert the same, so the two paths cannot
   drift.
2. **KB-17's DELETE rule will not bind `bulk_reset_episodes_to_stage`**, which
   deletes `immutable_events` in definer context. After this PR any account
   member (via `has_account_access`) can bulk-reset and so delete canon.
   KB-17 must decide whether bulk reset obeys the same role rule it picks for
   deleting events, and if so add that role check inside the function.
3. **Predicate alignment.** `immutable_events`' policy uses
   `has_role_on_account`, which excludes personal-account owners (measured:
   refused on insert into their own project; reads use the same predicate, so
   `getImmutableEventsAction` returns nothing for them — inferred, not run).
   If KB-17 splits the policy, `has_account_access` is the predicate that
   matches this function and KB-11's precedent. Only once the table's
   policies and the `episodes` update policy agree with this function can it
   be converted to `SECURITY INVOKER` without refusing members who commit
   today.
4. **No UPDATE conflict.** Neither function updates `immutable_events`, so
   KB-17's refuse-every-update trigger (with KB-1's nested set-null
   exception) is unaffected.

## 20. Performance and Scale

Traffic: a handful of commits per episode, human-initiated. Added cost: ≤4
primary-key lookups. Bulk reset adds one `unnest` anti-join over the selected
ids (tens at most). No measurable change.

## 21. Accessibility and Client Behavior

No client change. Not applicable beyond confirming the existing toast still
appears (§26 UI check).

## 22. Observability and Operations

A refused call appears as a PostgREST `42501` on `rpc/commit_canon_changes`
in the API logs, and (via the product path) as the action's existing
`Failed to commit canon changes` error log. An operator distinguishes the
two: a legitimate user never produces a `42501` here, so any `42501` on this
RPC is a probe or a revoked membership. No new metrics or alerts; none
exist for canon today.

## 23. Configuration and Feature Flags

None. A security fix behind a flag would leave the hole open wherever the flag
is off. No environment values; no production credentials used or needed.

## 24. Compatibility

Same function signatures and return shapes; generated types unchanged; the
only caller passes the same parameters. Old and new app builds work with the
new function, so deploy order does not matter. Existing rows untouched.
Callers relying on the `commit_canon_changes failed:` message prefix: none
(`git grep`).

## 25. Migration and Rollout Strategy

The migration ships through the normal migration step. Preconditions: none.
Validation gates: CI Supabase DB job (migrations from scratch, pgTAP including
the new files, mutation guards, `check:types-current`). After deploy, the
owner can confirm with the reproduction's step 4 against a non-production
project of their own — I will not run anything against production. Rollback
trigger: a member reports "Save to Canon" failing with a permission error;
first response is to check that member's `accounts_memberships` row, not to
revert. Data rollback: none needed (no data changes).

## 26. Testing Strategy

All new pgTAP files use `select plan(N)`, reset any shared row per case, and
are **run red against `main`'s function first**, each failing for its stated
reason, before the migration is written.

**`apps/web/supabase/tests/database/canon-commit-access.test.sql`**
(fixtures: owner of team *T* with project *P*/episode *E*; a team member of
*T* with no `project_members` row; a member of another team *U*; a stranger;
a personal-account owner with project *S*/episode *F*):

| Case | Asserts | Red on `main` because |
|---|---|---|
| T1 | stranger → `throws_ok(…, '42501')`; 0 events in *P*; *E* metadata unchanged | call succeeds today |
| T2 | member of *U* → refused; nothing written | succeeds today |
| T3 | member of *U* with own project + *E* → refused; nothing in either project; *E* metadata unchanged | succeeds today (measured row 5) |
| T4 | member of *T* (no `project_members`) → commits; `created_by` = member; `created_by_name` = member's name; other metadata keys kept | `created_by` NULL today |
| T5 | personal owner on *S*/*F* → commits; `created_by` = owner | `created_by` NULL today |
| T6 | `anon` → no execute | stays green (regression guard) |
| T7 | owner of *T* commits to *P*/*E* (positive control) | green on `main` too; kept so a later over-tightening shows up |
| T8 | duplicate `event_key` → `23505`, summary not stored | today raises `P0001` |

**`bulk-reset-access.test.sql`** (Decision 2): B1 stranger with the victim's
account id → refused, story and canon intact; B2 caller naming own account
with a victim's soft-deleted episode → refused, canon intact; B3 member
resets own → `reset_count 1`, canon removed; B4 personal owner resets own →
works.

**`definer-functions-inventory.test.sql`** (Decision 5): I1 `results_eq`
of every `SECURITY DEFINER` function executable by `authenticated` against
the reviewed list (each line commented with its access check, from §8);
I2 none of them lacks a `search_path` (`commit_canon_changes` fails I2 today).

**Mutation guards** — `tooling/mutation-guards/kb-27.json`, `kind: pgtap`:
access check removed; episode-in-project join loosened; `created_by` not
written; bulk-reset access check removed; bulk-reset soft-deleted gap
restored; a new definer function granted to `authenticated` (inventory).
Each must report `RED`.

**HTTP evidence** — rerun `kb27/repro.sh` and `repro2.sh` step E after the
migration: steps 4, 5, E refused, nothing written; 9a/9b succeed with
`created_by` set. Before/after table in the PR.

**Product path (Decision 6)** — one run of the Publish page on a dev server
(port 3102) as a seeded team member, with LLM keys unset in that server's
environment so extraction takes its basic fallback (no paid calls); click
**Save to Canon**; screenshot the success toast; read the episode's
`canonSummary` back from the database. Not committed as a spec.

No unit tests: no TypeScript changes. Typecheck/lint/format run anyway.

## 27. Production-Build Verification

The shipped artifact that changes is the migration; the Next.js bundle is
byte-for-byte unaffected (no TS/TSX diff). So the production-relevant checks
are: the migration applied from scratch in CI; the function's catalogue entry
after reset (`prosecdef`, `proconfig = {search_path=""}`, ACL); the real
PostgREST path (the same one production's `supabase-js` uses) refusing the
stranger and serving the member, measured with real JWTs; and
`check:types-current` clean. A `next build` would prove nothing about this
change and is not planned.

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Verification |
|---|---|---|---|---|---|---|---|
| Other tenants cannot write my canon | attack row §2 | FR-1 | §15 check | `commit_canon_changes` | RPC `42501` | T1, T2, guard | HTTP rerun steps 4 |
| …nor via mismatched ids | attack | FR-2 | §15 join | same | same | T3, guard | step 5 |
| Events say who saved them | happy path 5 | FR-3 | §15 `v_uid` | same + KB-1 trigger | `created_by(_name)` | T4, T5, guard | 9a/9b rows |
| Members still save canon | happy path | FR-4 | §15 predicate | same | — | T4, T5 | UI run + screenshot |
| No path hijack | — | FR-5 | `search_path=''` | same | — | I2 | catalogue |
| All-or-nothing | alt paths | FR-6 | no catch-all | same | — | T1–T3, T8 | — |
| Other tenants cannot wipe my episodes | — | FR-7, FR-8 | §15 bulk | `bulk_reset_episodes_to_stage` | `errors[]` | B1, B2, guards | HTTP rerun step E |
| Class stays closed | — | FR-9 | inventory | pgTAP | catalogue | I1, guard | KB entry table |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Why chosen |
|---|---|---|
| Keep `SECURITY DEFINER` + explicit check | `SECURITY INVOKER`, letting RLS decide | Invoker, measured today, refuses personal-account owners on the event insert (`42501`), and `episodes_update` would silently update 0 rows for team members without a `project_members` row. It is right only after KB-17/FILM-1002 align the predicates (§19). |
| `has_account_access` | `has_role_on_account`; `project_members` roles | Measured regressions for both (0/7 personal membership rows; creator-only `project_members`). Matches KB-11's rule. |
| One generic refusal message | Distinct messages | No existence oracle; no UI shows it. |
| Raise in commit, return in bulk reset | Uniform | Each keeps its function's existing error convention and its caller's handling. |
| No action/UI change | `returnRefusals` wrap + client change | Unreachable refusal; avoids a UI diff (and its E2E/screenshot obligations) for no user benefit. |
| Inventory as a pgTAP allowlist | Doc-only list | A list in a doc drifts; a test fails the PR that adds an unreviewed definer function. Cost: every future definer function needs one line added — intended. |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| A legitimate member is refused | Cannot save canon | Toast; `42501` on this RPC | T4/T5 cover team member without `project_members` and personal owner; UI run | Check membership row; forward-fix predicate |
| Inventory test goes red for a parallel PR that adds a definer function | That PR's CI fails after rebase | CI | Documented in the test header; one-line fix | Add the function with its check |
| Someone "fixes" the single reset's warning by granting `remove_episode_from_threads_touched` | New cross-tenant write | Inventory I1 would fail (it becomes callable) | Recorded in §8 and the KB entry | — |
| Forged canon already in production | Wrong continuity constraints | Not detectable (every row from this path has NULL author) | Owner decision 7 | Owner reviews canon per project if concerned |
| Bulk-reset change refuses stale ids | User sees an error on a batch with a vanished episode | error text | Refresh list | — |

## 31. Open Questions and Assumptions

- **Q1 (Decision 1)** Access predicate — assumed `has_account_access`.
- **Q2 (Decision 2)** Scope of sibling fixes — assumed bulk reset in, four
  others to new KB entries.
- **Q3 (Decision 7)** Existing data — assumed no backfill or audit: forged
  and genuine rows are indistinguishable (all `created_by` NULL, measured).
- **Assumption:** no production caller uses the service role for this RPC
  (only caller found is the user-session action).
- **Not addressed, recorded:** saving twice fails on the unique event key and
  discards the summary too; `p_season`/`p_episode_number` are taken from the
  client rather than the episode; commit to a soft-deleted episode is allowed.
  All pre-existing, within-tenant, outside KB-27.

## 32. Implementation Plan

1. **Tests first** (DB lock): write `canon-commit-access.test.sql`, and if
   approved `bulk-reset-access.test.sql` and
   `definer-functions-inventory.test.sql`; reset from this branch; run them
   against `main`'s functions; record each red case and its reason.
2. **Migration**: write `<ts>_kb27-definer-canon-access.sql`; `migration up`
   (or reset); rerun pgTAP → green. Mirror bulk reset into
   `schemas/22-bulk-reset-rpc.sql`.
3. **Types**: `pnpm supabase:web:typegen` → expect no diff.
4. **Mutation guards**: `tooling/mutation-guards/kb-27.json`; `run.py --only
   "KB-27"` → all `RED`.
5. **HTTP evidence**: rerun the reproduction scripts; before/after table.
6. **UI run** (heavy slot, port 3102): Save to Canon as a member; screenshot.
7. **Full pgTAP suite** once (catch interactions, e.g. KB-1 author tests).
8. `pnpm typecheck`, `pnpm lint:fix`, `pnpm format:fix`.
9. **Records**: KB-27 marked Fixed + inventory table in its entry + one
   Fixed-table row; FILM-1002 `remaining` drops the KB-27 item (criterion stays
   unmet for KB-17); FILM-1005's KB-27 mention updated. New sibling KB entries
   only as the lead assigns them.
10. Commit, push, PR.

Rollback at any stage: the branch touches only the migration, tests, guards,
schema mirror and spec records.

## 33. Definition of Done

- T1–T8 (and B1–B4, I1–I2 if approved) green, each seen red on `main` for its
  stated reason; mutation guards all `RED`.
- Reproduction rerun as the stranger: every attack refused, nothing written;
  owner and personal-owner controls succeed with `created_by` set.
- UI: a member's Save to Canon still succeeds (screenshot).
- `check:types-current` clean; typecheck, lint, format clean.
- KB-27 entry Fixed with the inventory table; FILM-1002/1005 updated;
  siblings reported to the lead.

## 34. Final Consistency Pass

**Forward.** Problem: other tenants can write canon (measured). Outcome:
they cannot; members can, with their name on it. Flow: Save to Canon
unchanged; direct calls refused. System: an access check inside the function
the attack uses, since PostgREST exposes it directly. Data: no schema change;
`created_by` populated. Tests: pgTAP red-first on the exact attack and on
both kinds of legitimate member; HTTP rerun; one UI run. Deploy: a migration,
no ordering constraint.

**Reverse.** Production after deploy: `commit_canon_changes` raises `42501`
for anyone without owner-or-role access to the episode's project's account,
else writes events authored by the caller and merges the summary. That
produces: members (team or personal) see no change; others get an error and
leave no trace. That satisfies the flow and ACs 1–2. AC 3 is met by the
inventory table and the test that pins it. The two paths converge; the one
assumption that could split them — which members count — is Decision 1,
decided by measurement rather than by reading the policies.
