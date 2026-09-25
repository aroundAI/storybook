# KB-37 — Research sources belong to a team

**Engineering Design Document** · ticket `specs/known-bugs/KB-37.md` · related:
KB-26 (#318, project-owned uploads), KB-28 (`can_write_project`) · branch
`fix/kb-37-team-owned-research-sources` · author: teammate `platform-admin`,
2026-09-25 · size: **M** · **touches schema and RLS**

**Status: APPROVED (owner, 2026-09-25), implemented as below.** Owner
decisions: Q1 = "C, project focused. Research sources would be different for
every different team"; the RLS write backstop is in; Q-a yes, Q-b and Q-c no
(filed in `specs/known-bugs/leads/2026-09-25-kb-37.md`); `updateExternalSourceAction`
deleted; `paper1.pdf` deleted by a post-deploy runbook, not by the migration.

## Changes from the plan below, and why

| # | Plan | Built | Why |
|---|---|---|---|
| 1 | Built-in = a row with no team and no project | An explicit `is_builtin` column, set for the 12 seeded slugs only | Production has one other shared row, `paper1.pdf`: a user upload. With the plan's rule it would have become a read-only built-in, readable by everyone, which is KB-26's leak again. Now any other ownerless row is an **orphan**, readable by nobody |
| 2 | Read policy requires `is_active` for every row | Only built-ins require `is_active`; a team's and a project's own inactive rows stay readable to it | PostgREST writes with `update … returning`, and PostgreSQL checks the new row against the SELECT policy. Hiding inactive rows made deactivating your own source fail with 42501 (seen red in pgTAP) |
| 3 | Unique `(account_id, project_id, slug)` | Same, and the upload's upsert target moves to it | KB-26's upload upserted `on conflict (project_id, slug)`, a constraint this replaces. The trigger sets `account_id` before the conflict check |
| 4 | Aggregator unchanged | It loads `is_builtin` rows, not `project_id is null` | Otherwise team sources and orphans would enter the process-wide instance |
| 5 | R-T5 "migration test" | `tmp` sequence script (not committed): production's state at `20260831113625`, production-shaped rows, then every later migration, then checks and the runbook | There is no migration-sequence harness in the repo. The committed pgTAP file covers the row shapes (orphan included) |
| 6 | Move a team row to another team: a with-check guard | Held by both WITH CHECK and the SELECT policy on the new row | A mutation that drops only the WITH CHECK stays green, so it has no mutation guard. Recorded, not hidden |

# Part 2R — KB-37, REVISED (2026-09-25) on the owner's answer to Q1

> **Owner, Q1:** "C, project focused. Research sources would be different for
> every different team." **Coordinator's reading:** sources belong to a team
> (or its projects), not to one global list every team sees and edits.
> **RLS backstop:** plan it as included. This section **supersedes** the
> original Part 2 below, which is kept for the record (its §8.2 reproduction
> still stands).

## R1. What the existing "shared" rows are

| Where | Count | What |
|---|---|---|
| Migrations (`20260211200003_seed_news_sources.sql`) | **12** rows, all `provider_type = 'newsapi'`: reuters, ap-news, afp, bbc-news, nytimes, guardian, wsj, aljazeera, cnn, npr, fox-news, daily-telegraph | Built-in catalogue |
| Local DB, read-only count (2026-09-25) | `project_id is null`: **12**, all `newsapi`, all active. Any other shared row: **0**. Project-owned: 0. `external_content`: 0 rows | Same 12 |

**What the aggregator searches** (`context-aggregator.ts:95-139`): one
process-wide singleton, built from active rows with `project_id is null`. It
creates one provider per row by `provider_type` (`newsapi` /
`semantic_scholar` / `archive_org`). A `NewsAPIProvider` takes only the row's
id and tier and calls NewsAPI with the **platform's** `NEWSAPI_KEY`
(`newsapi-provider.ts:45-48`); the row's `config.source_id` is not used.
So the 12 rows are **platform integration config, not team data**: every
one of them spends the platform's API key, and copying them per team would
multiply the platform's NewsAPI calls by the number of teams with no gain.
(Lead, not reproduced: 12 NewsAPI rows mean 12 identical NewsAPI queries per
live search. It goes in `leads/`, not here.)

**Therefore:** the 12 stay **built-in, read-only in the app** (changed only by
migration), and every source a **user** creates belongs to a team.

## R2. Ownership model

| Kind | `account_id` | `project_id` | Who reads | Who writes (app and RLS) |
|---|---|---|---|---|
| **Built-in** (the 12) | null | null | every signed-in user | **nobody** (migration only) |
| **Team source** | team | null | members of the team (`has_role_on_account(account_id)`) | the team's **owners** (`has_role_on_account(account_id, 'owner')`) |
| **Project source** (hub add, KB-26 uploads) | the project's team | project | project writers (`can_write_project`, as KB-26) | project writers (`can_write_project`) |

- No personal-account branch (teams only).
- "Nobody can change another team's sources" holds by construction: every
  writable row carries its team, and every write rule tests the caller
  against that row's own team or project.

## R3. Database (a migration; schema + RLS — **touches schema/RLS: yes**)

1. `alter table external_sources add column account_id uuid references
   accounts(id) on delete cascade`.
2. Backfill: `update … set account_id = p.account_id from projects p where
   p.id = external_sources.project_id` (KB-26's project rows; 0 locally).
3. A project row's team must be its project's team:
   `check (project_id is null or account_id is not null)` plus a trigger
   (`before insert or update of project_id, account_id`) that sets
   `account_id` from `projects`, or rejects a mismatch. A trigger rather than
   a composite FK: the FK would need a new unique `(id, account_id)` on
   `projects`, which is a wider change for the same guarantee.
4. Slug uniqueness becomes per owner: drop `external_sources_project_slug_key`,
   add `unique nulls not distinct (account_id, project_id, slug)`. So two
   teams can each have "Notes", and a team can have a "Reuters" beside the
   built-in one without touching it.
5. RLS:
   - **read** `external_sources_read` (replaces KB-26's): `is_active and (
     (account_id is null and project_id is null)
     or (project_id is null and has_role_on_account(account_id))
     or (project_id is not null and can_write_project(project_id)))`.
   - **insert/update (backstop, included)** for `authenticated`:
     `account_id is not null and ((project_id is null and
     has_role_on_account(account_id, 'owner')) or (project_id is not null and
     can_write_project(project_id)))`, in both `using` and `with check` (so a
     row cannot be moved to another team or into the built-ins). **No delete
     policy**: deactivation is an update. Built-ins match no write policy.
   - `service_role` policy unchanged (uploads' queued jobs, seeds).
6. `external_content` is unchanged (KB-26 already ties uploads to a project).
7. Mirror into `schemas/` if that table has a schema file; typegen.

## R4. Actions and UI

- `addExternalSourceAction({ scope: 'project', projectId } | { scope: 'team',
  accountId }, …)` writes through the **user client**, so RLS decides. The
  action checks first only to return a clear refusal value: "You can only add
  sources to a project you work on." / "Only team owners can add team-wide
  sources." A `23505` → "A source with that name already exists here."
- `deleteExternalSourceAction({ sourceId })` → user-client update
  `is_active = false` where `id = sourceId` … `.select('id')`. 0 rows (built-in,
  another team's, not allowed) → refusal "You can't remove this source." No
  id-only admin write remains.
- `updateExternalSourceAction`: **deleted** (no caller; your decision).
- `requireAccountOwner`: **deleted**.
- The list action returns built-ins + the team's sources + this project's.
- Hub: the Add Source dialog gets a "Who can use it" choice, **This project**
  (default) or **Whole team** (shown only to team owners). Each row carries a
  badge: Built-in / Team / Project. The delete button is shown only on rows
  the caller may deactivate, as computed by the server.
- Aggregator: **unchanged**. It keeps searching built-ins only (see R6 Q-b).

## R5. Existing production rows: a read-only query for the owner

Only rows added through the hub before this fix are ambiguous: they are
shared today, belong to no team, and have **no `created_by`** column, so the
migration cannot know whose they are. The owner runs:

```sql
-- 1. Shared rows that are not the 12 seeded built-ins (added via the hub)
select id, name, slug, provider_type, is_active, created_at, updated_at
from public.external_sources
where project_id is null
  and slug not in ('reuters','ap-news','afp','bbc-news','nytimes','guardian',
                   'wsj','aljazeera','cnn','npr','fox-news','daily-telegraph')
order by created_at;

-- 2. Built-ins someone deactivated or edited through the hub (affects every team)
select slug, is_active, created_at, updated_at
from public.external_sources
where project_id is null
  and slug in ('reuters','ap-news','afp','bbc-news','nytimes','guardian',
               'wsj','aljazeera','cnn','npr','fox-news','daily-telegraph')
  and (not is_active or updated_at > created_at + interval '1 minute');
```

- (1) returns 0 rows → the migration needs no data step.
- (1) returns rows → by default the migration **leaves them as built-ins**
  (read-only, visible to all). With one team today, the owner can instead
  assign them to that team with a one-line runbook `update … set account_id =
  '<team id>' where id in (…)`. That goes in the PR, and is run by the owner.
- (2) returns rows → the owner decides whether to re-activate them (a
  one-line runbook). The migration does not guess.

## R6. What the owner still needs to answer (non-blocking; defaults shown)

- **Q-a:** Should team owners be able to add **team-wide** sources from a
  project's hub? **Default: yes**, as R4. If no, only project sources exist,
  and R2's team row is used only by the runbook in R5.
- **Q-b:** Should a team's own API sources (`newsapi`, `semantic_scholar`, …)
  be **searched** by the aggregator for that team? **Default: no, a
  follow-up.** Today only built-ins are searched. Searching per team needs a
  per-team aggregator, not the process-wide singleton, plus a rule for whose
  API key pays.
- **Q-c:** Can a team hide a built-in for itself? **Default: no, a
  follow-up** (it needs a per-team preference table). Today's
  deactivate-for-everyone disappears either way.

## R7. What the fix newly allows / narrows

- **Newly allowed:** a project writer can add a source to their own project
  from the hub. A team owner can add a team-wide source.
- **Narrowed:** nobody can add, edit or deactivate a built-in through the
  app, or touch another team's or project's source, even with a guessed id.
  The one-RPC path ("create a team, become an owner, edit the global list")
  is closed. RLS enforces the same rule as the action (the backstop).

## R8. Tests (replace T37-*)

| ID | Layer | Case | Red on main? |
|---|---|---|---|
| R-T1 | pgTAP `external-sources-ownership-rls.test.sql` | As `authenticated`: owner of team A inserts a team source for A (ok) and for B (denied); member (not owner) of A cannot insert a team source; project writer inserts/deactivates a project source (ok); viewer, non-member and owner of a throwaway team cannot; nobody updates a built-in (0 rows); a project row cannot be pointed at another team (trigger); reads: A's team rows are invisible to B | yes (no write policies today; the reads leak team rows once `account_id` exists → written against the new column, so its red is the missing policies) |
| R-T2 | unit | The actions return the refusal values, and no admin-client write remains in them | yes |
| R-T3 | structural unit | No `external_sources` write in `episodes/src/server` goes through `getSupabaseServerAdminClient` except `source-upload-actions.ts` (the queued-job path) | yes |
| R-T4 | E2E on a production build | Team A adds a project source and a team source (visible in A's hub, not in B's); B's owner calling delete with A's id gets the refusal text, and the row stays; no delete button on built-ins; screenshots | yes |
| R-T5 | migration | `db reset` from main's migrations with KB-26 project rows seeded, then this migration: `account_id` is backfilled; the 12 built-ins are untouched | — |
| M | mutation guards | drop the owner test from the team-insert policy → R-T1 red; restore the admin client in delete → R-T3/R-T4 red; drop the trigger → R-T1 red | — |

Everything that needs the DB is **(P2): runs first under the lock**.

---
