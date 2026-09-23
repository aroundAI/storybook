# KB-41 — Engineering Design Document

**Ticket:** KB-41, "`get_project_members` has no access check and leaks the
project owner's email". Severity High: personal data, across tenants. KB-27's
class sweep found it on 2026-09-23. Its FILM-CC-04 entry is written in KB-27's
PR, which has not merged, so the entry is not on `main` yet.
**Branch:** `fix/kb-41-project-members-access`, based on `origin/main`. This is
a read, so it does not need KB-28's `can_write_project`.
**Related:** KB-27 (found it; adds the SECURITY DEFINER inventory pgTAP that
lists this function as "NONE … KB-41, open"), KB-11 (the same "public project
opens a side door" shape, in analytics), KB-26 (a cross-tenant read of research
sources), KB-40 and KB-42 (siblings from the same sweep).
**Status:** plan, awaiting the owner's approval.

Evidence labels used throughout: **measured** means it was run on the local
stack on 2026-09-23 and the output is quoted. **By reading** means it was read
from the code and not run.

---

## 1. Start With the User

**Who.** Three people:

- the **team member**, who opens a project's Settings page to see who is on
  the project;
- the **project's members**, whose name, email and picture that list shows;
- **everyone else**: any other signed-in user, i.e. anyone who can create an
  account. Anonymous callers are already refused: `anon` has no usage on
  schema `public` (measured, §8).

**The problem today (measured, §8).** Any signed-in user can ask for any
project's member list, public or private, and get every member's name, email
address and picture back. Public and unlisted project ids are listable by any
signed-in user, so for those the id is no barrier; a private project's id
has to be learnt some other way, and then it leaks the same. A creator who
shares a series publicly therefore publishes their own email address and every
collaborator's, without being told.
Nothing in public sharing (`specs/PRD-public-sharing.md`) offers to show
members or emails. The public pages show the company profile, the project and
its episodes, and "creator attribution" comes from the account's
`public_profile`, not from members.

**What the user gets after the fix.**

- **Team member:** nothing changes. Settings → Project Members lists the same
  people with the same names, emails, roles and order.
- **Project members:** their email is visible only to people in the project's
  account, who can already see it on the team's Members page.
- **Everyone else:** the list comes back empty. It carries no error and no
  hint about whether the project exists.

**Success:** a caller without access to the project's account gets zero rows.
Every account member (the personal owner, or any role on the team) gets the
full list, exactly as today.
**Failure:** any row returned to a non-member, or a legitimate member seeing
fewer members, or none.

**What persists:** nothing. This is a read, and no data changes.

## 2. Define the Complete User Journey

The only product entry point is the project Settings page,
`apps/web/app/home/[account]/studio/[projectSlug]/settings/page.tsx`. Its
"Project Members" card (`:465-516`) renders `getProjectMembers(project.id)`
(`:117`). That calls `packages/features/projects/src/lib/server/project.queries.ts:124`,
which calls `rpc('get_project_members')`.

| Stage | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| Entry | A team member opens Studio → a project → Settings | The layout checks the account and the project (`layout.tsx:30-47`). The page runs `get_project_members` together with the permissions and available-members reads | The Project Members card lists each member: initial, name (or email), email and role badge | Add a member (owner/admin), or leave |
| Add member | Owner/admin adds a teammate | Existing mutation, unchanged. It invalidates the members cache | The new member appears on the next render | — |
| Refresh or re-entry | — | The same read runs again | The same list | — |
| Removed from the team | The user's account membership is deleted | The layout's `loadTeamWorkspace` refuses first (by reading) | Not found. The members read is never reached | — |
| Attack (not a UI path) | Another tenant calls `POST /rest/v1/rpc/get_project_members` directly | **After the fix:** the access check fails and the function returns no rows | `[]` | — |

A non-member cannot reach the Settings page for another account's project. The
layout looks the project up by slug **and** account (`layout.tsx:40-45`) and
calls `notFound()` otherwise. So the refusal has no UI, and the only exposure
is the RPC (measured in §8).

## 3. Explicitly Define the Happy Path

1. A member of team *T* opens `/home/T/studio/<slug>/settings`.
2. The layout resolves *T* and project *P* in *T*. The page calls
   `getProjectMembers(P)` with the member's session.
3. `get_project_members(P)` (SECURITY DEFINER) looks up *P*'s `account_id`
   and checks `public.has_account_access(account_id)`. That check passes for
   the account's primary owner or anyone with a role in
   `accounts_memberships`, so it passes here.
4. It returns every `project_members` row of *P*, joined to the member's
   `accounts` row (name, email, picture) and ordered by `created_at`,
   unchanged from today.
5. The page renders the card. This counts as success because the list is
   identical to today's for every account member.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| Anonymous caller (anon key only) | **Unchanged, measured:** refused before the function runs, `42501 permission denied for schema public`; `has_function_privilege('anon', …)` is false (§8). A pgTAP case pins it | Error body | — | No data returned |
| Signed-in caller with no access to *P*'s account, *P* public or unlisted | The guard fails and the function returns no rows | `[]` | — | No data returned |
| Same, *P* private | Same | `[]` | — | No data returned |
| *P* does not exist | The guard finds no project and returns no rows. This is indistinguishable from a refusal, on purpose | `[]` | — | — |
| `target_project_id` null | No project matches, so no rows | `[]` | — | — |
| Caller is on *P*'s `project_members` but no longer in its account (e.g. removed from the team) | Refused (no account access). This matches `project_members_read` RLS and "reads stay on account membership" | Would see `[]`, but the layout has already refused | Re-add them to the team | — |
| Caller in the account but not on *P*'s `project_members` | Allowed, as today and as RLS allows | Full list | — | — |
| Caller in two accounts | The check is on *P*'s own account, so an account they merely also belong to grants nothing | — | — | — |
| Super admin | No special case, as today. The admin panel does not call this function (by reading) | — | — | — |

## 5. Establish the User-Facing Contract

- **Input:** `target_project_id uuid`.
- **Output:** unchanged columns (`id, project_id, user_id, role, created_at,
  updated_at, user_name, user_email, user_picture_url`) and order.
- **Visibility rule (the change):** rows are returned only when the caller has
  access to the project's account (`has_account_access`). Anyone else,
  signed in or not, receives nothing. Project visibility (`public`,
  `unlisted`) grants nothing here.
- **Fields:** account members see all of them, email included (Decision 2).
- **UI states:** unchanged. The card has no empty or error state of its own.
  An RPC error already makes the page call `notFound()` (`page.tsx:120-123`);
  after the fix an empty result for a non-member cannot happen through the UI.
- **Messages:** none new.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Why | Verification |
|---|---|---|---|
| FR-1 | `get_project_members(P)` returns zero rows unless `has_account_access(P.account_id)` holds for `auth.uid()` | The leak | pgTAP (red first); PostgREST re-run of the reproduction |
| FR-2 | Project visibility `public` or `unlisted` grants no rows | The owner's rule; the reproduced case | pgTAP case on a public project |
| FR-3 | `anon` still cannot EXECUTE the function (already true; guarded so a future grant cannot reopen it) | Anon is refused today only by baseline revokes the function does not own | pgTAP `has_function_privilege`; PostgREST re-run as anon |
| FR-4 | Account members (primary owner; any `accounts_memberships` role, with or without a project row) get the same rows, columns and order as today | Must not break Settings | pgTAP; UI run of the Settings page |
| FR-5 | The refusal looks the same whether or not the project exists | No existence oracle | pgTAP compares non-member on a real project against a random uuid |
| FR-6 | Signature and return type unchanged | No TS or type churn; `database.types.ts` stays byte-identical | `pnpm supabase:web:typegen` then `git diff --exit-code` |

## 7. Define Non-Functional Requirements

- **Security and privacy:** the requirement is FR-1 to FR-3. Emails are
  personal data, and after the fix only people who already see them on the
  team Members page can read them.
- **Performance:** one extra indexed lookup (`projects` by primary key, then
  `accounts_memberships` by user and account) per call. Negligible: one call
  per Settings render.
- **Compatibility:** no change to callers or to generated types (FR-6).
- **Observability:** unchanged. The query already logs its count
  (`project.queries.ts:138`).
- Accessibility, i18n, cost: not affected, since there is no UI change.

## 8. Analyze the Existing System

**The function (by reading).** `apps/web/supabase/migrations/20251016143639_projects.sql:247-283`
defines it as SECURITY DEFINER with `search_path = ''`, and its body is a
single `select` with no caller check. It is granted to `authenticated` at
`:283`. `schemas/18-projects.sql:247-283` mirrors it. No later migration
redefines it: `git grep get_project_members` shows only these two files, the
generated types, the query and its unit test.

**The rules around it (by reading).**
- `project_members_read` RLS (`…projects.sql:357-378`) lets you read your own
  row, or any row of a project whose account you can access (personal primary
  owner, or `has_role_on_account`). The function bypasses this rule; the fix
  restores it.
- `projects_read` requires the same account access. The public-sharing
  migration (`20260108120000_public_sharing_rls.sql:28-34`) adds a *second*
  SELECT policy on `projects` for `anon, authenticated` when
  `visibility in ('public','unlisted')`. That policy is why project ids are
  discoverable. It does not touch `project_members`.
- `public.has_account_access(uuid)` (SECURITY DEFINER, STABLE) returns false
  for `auth.uid() is null`, and otherwise checks whether the caller is the
  account's primary owner or has a role on it. That is exactly the "account
  membership" read rule.
- `can_perform_project_action(..., 'project.members.view')` exists (owner,
  admin or member; not viewer). No policy or page uses it for this read.

**Callers (by reading, positive control: the function's own migration line
matches the same grep).**

| Caller | Where | Used by |
|---|---|---|
| `getProjectMembers` | `packages/features/projects/src/lib/server/project.queries.ts:115-157` | Settings page (`…/[projectSlug]/settings/page.tsx:117`), which renders `:496-513` |
| `ProjectMembersList` | `packages/features/projects/src/components/project-members-list.tsx:14` | Exported (`package.json:17`), **mounted nowhere** |
| Unit test | `packages/features/projects/__tests__/project-queries.test.ts:249` | Mocked RPC; unaffected |

**Reproduction (measured, local stack, 2026-09-23, real users over
PostgREST).** Script: `$SP/kb41/repro.sh`; output: `$SP/kb41/repro.out`.

The fixture: team *T* owned by `kb41-owner`; `kb41-teammate` is an
account member with no project row; `kb41-projmember` is an account member
with a `member` row on both projects. There is a public project *P1* and a
private project *P2*. `kb41-stranger` has only their personal account. The
database was reset from this branch first; the rows were cleaned up after
(`left|0`).

| # | Caller → request | Result |
|---|---|---|
| 0 | stranger → `projects?id=in.(P1,P2)` | `[{"id":"…0001","visibility":"public"}]` (the public id is discoverable; the private one is not) |
| C1 | stranger → `project_members?project_id=eq.P1` (control) | `[]`: RLS refuses |
| C2 | stranger → `accounts?select=email&id=eq.<owner>` (control) | `[]`: RLS refuses |
| **A1** | **stranger → `rpc/get_project_members` P1 (public)** | **`[{"role":"owner","user_email":"kb41-owner@storybook.dev"},{"role":"member","user_email":"kb41-projmember@storybook.dev"}]`** |
| **A2** | **stranger → `rpc/get_project_members` P2 (private)** | **the same two emails** |
| A3 | anon → `rpc/get_project_members` P1 / P2 | `{"code":"42501","message":"permission denied for schema public"}` |
| L1 | owner → rpc P1 | both rows |
| L2 | teammate (account member, no project row) → rpc P1 | both rows |
| L3 | projmember → rpc P2 | both rows |
| L4 | teammate → `project_members?project_id=eq.P1` (RLS) | `[{"role":"owner"},{"role":"member"}]`: RLS agrees account members may see them |

The function hands a stranger what RLS refuses them (A1 against C1 and C2),
and the project's visibility is irrelevant (A2). The legitimate readers the
fix must keep are L1 to L3.

`has_function_privilege('anon', get_project_members, 'EXECUTE')` is `false`
(sweep A), and `anon` has no usage on schema `public`. MakerKit's baseline
(`20221215192558_schema.sql:21-72`) revokes both.

**Class sweep (measured: `$SP/kb41/sweep.sql` → `sweep.out`; by reading for
the migrations).**

| # | What | Result | Verdict |
|---|---|---|---|
| A | SECURITY DEFINER, non-trigger functions in any non-system schema whose body mentions `email`, `auth.users`, `picture_url`, `phone` or `raw_user_meta_data` | **Only `public.get_project_members`** (the positive control), `anon=false auth=true` | This ticket |
| B | Functions granted to `anon` or `authenticated` whose *result type* has an email column | `get_account_invitations` (invoker), `get_account_members` (invoker), `get_project_members` (definer) | The two MakerKit ones are SECURITY INVOKER, so RLS on `accounts_memberships`, `accounts` and `invitations` limits them to the account's own members. Not a door |
| B2 | Definer functions callable by `authenticated` returning an `accounts`, `invitations` or `users` row type | none | — |
| C | Views in `public` | `user_account_workspace`, `user_accounts`: both `security_invoker=true`, neither exposes email | Not a door |
| **D** | **RLS policy `"Allow public read of public accounts"`** (`20260108120000_public_sharing_rls.sql:15-21`) is `TO anon, authenticated`, and `authenticated` has column SELECT on `accounts.email` | **Measured (`$SP/kb41/probe2.out`), as a signed-in stranger:** a public team account row gives `email: null` plus `primary_owner_user_id`. A *personal* account whose owner set `public_profile.is_public = true` gives its **email** (`kb41p-owner@storybook.dev`), and `accounts?select=email&email=not.is.null&public_profile->>is_public=eq.true` lists every such email | **Sibling S-1, not fixed here.** Low today: team accounts are created with `email` null (`create_team_account`), and no UI makes a *personal* account public (the public-profile form is team-only). Only a direct API PATCH by the owner does, which the API accepts (`204`). But the policy exposes every column of a public account, not the fields public sharing needs. The public pages select only `id, name, slug, picture_url, public_profile` (`packages/features/public-sharing/src/server/public-queries.ts:48`), so narrowing the exposure would not break them. Reported to the lead for a KB number |
| E | App code reading emails via the admin client | Only `packages/features/admin` (super-admin gated) and the invitations webhook (server-side mail) | Not a door |

Also found while reading, not PII and not this ticket: the Settings page
loads the project by slug alone (`settings/page.tsx:87-99`), with no account
filter. This is the KB-10 H-5 shape. The layout's account-scoped lookup
(`layout.tsx:40-45`) stops it from reaching another account's project, so it
cannot be used to reach this leak through the UI.

## 9. Define the Desired System Behavior

**The Settings page loads members:** RSC → `getProjectMembers(P)` →
`rpc('get_project_members')` with the user's JWT. The function resolves *P*'s
account and checks `has_account_access`. On pass, it returns the rows; on
fail, zero rows. The page renders the card.

**A direct RPC from a non-member:** PostgREST calls the function as
`authenticated` → the guard fails → `[]`. As `anon`, PostgREST refuses before
the function runs, today and after (no schema usage, no EXECUTE).

## 10. High-Level Architecture

No new components. The trust boundary is PostgREST → SECURITY DEFINER
function: RLS does not apply inside the function, so its own check is the only
guard. The fix puts the account-membership rule (the one `project_members_read`
already states) inside the function. The anonymous entry point is already
closed by MakerKit's baseline revokes (`20221215192558_schema.sql:21-72`).

SECURITY DEFINER is kept, because the function joins `accounts` for
*teammates'* personal rows. Under SECURITY INVOKER those rows are visible only
through MakerKit's `accounts_read` team-member branch. That rule works today
but would make this read depend on a second policy it does not own (§29).

## 11. Architecture and Flow Diagrams

```
Settings page (RSC, user JWT)
   │ rpc get_project_members(P)
   ▼
PostgREST ── anon? ──► 42501 permission denied (already so; pinned: FR-3)
   │ authenticated
   ▼
get_project_members (SECURITY DEFINER, search_path='')
   │ select account_id from projects where id = P
   │ has_account_access(account_id)?
   ├── no  ─► return (0 rows)                   (FR-1, FR-2, FR-5)
   └── yes ─► project_members ⋈ accounts ─► rows (FR-4, unchanged)
```

## 12. End-to-End Data Flow

Source: `project_members` (who and which role) plus `accounts` (name, email,
picture of each member's personal account; `accounts.email` is kept in sync
with `auth.users` by `kit.handle_update_user_email`). The data passes through
the function, then PostgREST JSON, then `getProjectMembers`, which reshapes it
into `ProjectMemberWithUser` and wraps it in React `cache()` for the request.
The card renders it. Nothing is persisted, cached across requests or written.
There is no loss, duplication or reordering risk: order is `created_at asc`
as today, and a project has only a handful of rows, so the 1000-row cap does
not apply.

## 13. Data Model

Unchanged. `project_members (project_id, user_id, role)` is authoritative for
project roles, and `accounts_memberships` for account roles. `accounts.email`
of a personal account is authoritative for display, mirrored from
`auth.users`.

## 14. Database Design and Changes

One hand-written migration,
`apps/web/supabase/migrations/<UTC ts>_kb41-project-members-read-scope.sql`:

```sql
-- KB-41: get_project_members returned any project's members, with emails,
-- to any signed-in caller, for any project. Reads follow account membership,
-- the rule project_members_read already states; project visibility grants
-- nothing.
create or replace function public.get_project_members(target_project_id uuid)
returns table ( … unchanged … )
language plpgsql
security definer
set search_path = '' as $$
begin
  if not exists (
    select 1 from public.projects p
     where p.id = target_project_id
       and public.has_account_access(p.account_id)
  ) then
    return;   -- same result for "no such project" and "not yours"
  end if;

  return query
  select … unchanged … ;
end;
$$;
```

- `create or replace` with an identical signature and return type, so the
  existing grants (`authenticated`; measured `anon=false`) survive unchanged
  and types do not change. No grant or revoke statement is needed.
- Mirror the same body into `schemas/18-projects.sql:245-283`.
- No table change, no backfill, no locking beyond a catalog update.
- **Rollback:** re-run the old definition, i.e. restore the 2025-10-16 body
  and grant. The data is untouched either way.

## 15. Low-Level Design

- The guard runs once, up front, rather than as a per-row `where` predicate.
  That way the rule reads as a rule, and it runs once.
- `has_account_access` is reused rather than re-derived, so the read rule
  lives in one function ("fix the class": KB-11 was a re-derived rule).
- `return;` with no rows, not `raise`. See Decision 3.
- No TypeScript change. `getProjectMembers` already maps `[]` to `[]`
  (`:133-135` handles `null`; `[]` maps to `[]`).

## 16. API and Event Design

`POST /rest/v1/rpc/get_project_members {target_project_id}`:
- `authenticated` with account access: `200`, rows as today.
- `authenticated` without access: `200 []`.
- `anon`: `42501 permission denied for schema public`, as today.
- There are no events, no pagination (a small set) and no versioning concern.

## 17. State and Lifecycle Design

No lifecycle: this is a stateless read.

## 18. Failure and Error Handling

| Failure | Behaviour | User-visible | Recovery |
|---|---|---|---|
| Guard refuses | 0 rows | Nothing via the UI (unreachable); `[]` via the API | — |
| DB error | Unchanged: `getProjectMembers` throws and the page calls `notFound()` | Not found | Retry |
| `has_account_access` missing (a migration-order mistake) | `create or replace` fails at migration time | Deploy stops | It already exists on `main` (measured in the catalogue, §8) |

## 19. Security

- **Tenant isolation:** the fix itself (FR-1/FR-2).
- **Least privilege:** `anon` is already refused (measured) and a pgTAP case
  pins it (FR-3). Anonymous public pages never call this (by reading
  `apps/web/app/(public)` and `packages/features/public-sharing`: no
  `project_members` or member reads).
- **Search path:** stays `''`, and every reference stays schema-qualified.
- **Existence oracle:** removed for this function (FR-5). Public project ids
  remain listable by design (public sharing).
- **Residual, accepted:** a user added to `project_members` who is not (or
  no longer) in the account still has their email shown to account members.
  `project_members_create` does not check account membership (by reading,
  `…projects.sql:381-389`), and the Add dialog offers only account members.
  This is recorded in §31, not fixed here.

## 20. Performance and Scale

One PK lookup plus one indexed `accounts_memberships` probe per call, on top
of today's query. At most a few calls per page view. No measurable change.

## 21. Accessibility and Client Behavior

No UI change, so nothing to design.

## 22. Observability and Operations

Unchanged. An operator can confirm the fix in production with one `curl`
against the RPC as a signed-in non-member (`[]` where it used to return
members). Section 27 lists both.

## 23. Configuration and Feature Flags

None. The change is security-only and must not be switchable.

## 24. Compatibility

- Callers: `getProjectMembers` only, and its contract is unchanged for account
  members.
- Types: unchanged (FR-6).
- **KB-27's inventory test** (`definer-functions-inventory.test.sql`, not on
  `main`): it checks `authenticated`'s EXECUTE only. The function stays
  SECURITY DEFINER and executable by `authenticated`, so I1 passes in either
  merge order. Only its comment ("NONE … KB-41, open") goes stale. Whichever
  PR merges second updates that one line to "has_account_access of the
  project's account (KB-41)".

## 25. Migration and Rollout Strategy

A single migration, applied by the normal deploy (`supabase db push`), with no
ordering constraint against the app, since no code changes. Validate after
deploy with the §27 checks. Roll back by re-applying the old definition.

## 26. Testing Strategy

1. **pgTAP, `apps/web/supabase/tests/database/project-members-read.test.sql`**,
   written first and run **red on `main`** before the migration exists.
   Fixture: team *T* (owner O, account member M with no project row, account
   member PM with a `member` project row), public project *P1*, private
   project *P2*, and stranger S with only a personal account. Cases, with
   `plan(n)` fixed so a truncated run shows as a mismatch:
   - S on *P1* (public) → 0 rows. *Red today: 2 rows.*
   - S on *P2* (private) → 0 rows. *Red today.*
   - S on a random uuid → 0 rows. S on *P1* returns the same result (FR-5).
   - `has_function_privilege('anon', …, 'EXECUTE')` is false. *Green today
     (measured); it pins the baseline, and is not a red-first case.*
   - O on *P1* → both rows with the right emails and order (FR-4).
   - M (account member, no project row) → both rows.
   - PM on *P2* → rows.
   - After deleting M's `accounts_memberships` row, M gets 0 rows.
   - A user in a *different* team that S owns gets nothing on *P1* (the
     two-account case).
2. **Red before green:** run the file with the migration's body reverted to
   the old one. The stranger (public), stranger (private), random-uuid
   parity and removed-member cases must fail for the stated reason, then pass
   restored.
3. **PostgREST re-run** of `$SP/kb41/repro.sh` after the fix, as real users:
   the before and after table goes into the PR.
4. **UI:** one run of the real Settings page on a dev server (port 3112) as
   (a) the team owner and (b) an account member with no project row. Both
   see the members card with the owner's email. A screenshot of each goes in
   the PR. This is a throwaway Playwright run spec in the scratchpad, like
   KB-27's `kb27-ui-run.spec.ts`, since nothing in the UI changes (Decision 4).
5. **Unit:** `pnpm --filter @kit/projects test`, unchanged, still green.
6. `pnpm typecheck`, `pnpm lint:fix`, `pnpm format:fix`, and typegen with no
   diff.

## 27. Production-Build Verification

No application code changes, so the production bundle is unaffected. What has
to be verified is the database artifact:
- `supabase db reset` from this branch applies the migration cleanly (local).
- The CI Supabase DB job runs the pgTAP file and the typegen diff.
- After deploy, with a throwaway signed-in account (no production
  credentials): `rpc/get_project_members` on any public project gives `[]`.
  The owner runs this, per the standing no-production-credentials rule.

## 28. Requirement Traceability

| User Outcome | User Flow | Requirement | Design | Component | Data/API | Test | Production Verification |
|---|---|---|---|---|---|---|---|
| Strangers cannot read members or emails | Attack row, §2 | FR-1, FR-2, FR-5 | §14 guard | `get_project_members` | RPC → `[]` | pgTAP S cases; repro re-run | Signed-in non-member `curl` → `[]` |
| Anonymous visitors stay refused | §4 anon row | FR-3 | none (baseline) | grants | RPC → 42501 | pgTAP privilege case; repro as anon | — (unchanged) |
| Team sees members as before | Entry, §2 | FR-4, FR-6 | §14 unchanged select | Settings page | RPC → rows | pgTAP O, M, PM cases; UI run with screenshots | Owner opens Settings |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Chosen, because |
|---|---|---|
| Who may read | (a) account access (`has_account_access`); (b) project row with `project.members.view` (owner, admin, member; not viewer); (c) `can_write_project` | (a) is the owner's rule for reads, matches `project_members_read` and `projects_read`, and keeps Settings working for team members without a project row. (b) and (c) would empty the card for those members, a behaviour change nobody asked for |
| Mechanism | SECURITY INVOKER (let RLS decide); DEFINER plus guard | DEFINER plus guard. INVOKER would also need `accounts` RLS to expose teammates' personal rows (it does today via MakerKit's team-member branch), which couples this read to a policy it does not own. And a regression in either policy would silently blank emails rather than fail a test |
| Refusal shape | `raise 42501`; empty set | Empty set: the same shape as RLS, no existence oracle, and no path through the UI where the difference would show (Decision 3) |
| Emails | Everyone who can list; owner/admin only; nobody | Everyone who can list: account members already see each other's emails on the team Members page (`get_account_members`) (Decision 2) |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| A legitimate reader is refused (e.g. a personal-account owner) | Empty members card | pgTAP O case; UI run | `has_account_access` covers the primary owner explicitly | Roll back the function |
| KB-27's inventory comment goes stale | A misleading comment | Review | One-line update by whichever PR merges second | — |
| Other PII doors stay open (sweep, §8) | Continued exposure elsewhere | Sweep table | Filed for the lead to number; not widened here | — |

## 31. Open Questions and Assumptions

"Decision N" elsewhere in this document means row N below.

| # | Question | Why it matters | Current assumption / recommended default |
|---|---|---|---|
| 1 | Who may list a project's members? | The fix itself | **Account members** (`has_account_access`). Alternatives: project row with `project.members.view` (owner, admin, member), or `can_write_project`; both would empty the card for team members with no project row (§29) |
| 2 | Do those readers see emails? | Personal data | **Yes**, all fields, as the team Members page already shows them. Alternative: only owner/admin see emails |
| 3 | Empty result or error for a non-member? | API shape, existence oracle | **Empty result** |
| 4 | Permanent E2E spec, or a one-off UI run with screenshots? | Regression cost vs value | **One-off run + screenshots.** The pgTAP file is the regression guard, and the page only renders what the function returns |
| 5 | Should `project_members` refuse users who are not in the account? (§19 residual) | An ex-teammate's email stays visible to the team | **Out of scope**; file it if wanted |
| 6 | The KB-41 entry lives in KB-27's unmerged PR | Updating "the ticket's own record" | If KB-27 merges first, rebase and flip its entry to Fixed plus the Fixed-table row. Otherwise add the Fixed-table row here and flip the entry in KB-27's PR (or a one-line follow-up) |
| 7 | Sibling S-1 (§8 sweep D): a signed-in user can read every column, email included, of any account with `public_profile.is_public = true` | A personal account made public through the API exposes its owner's email | Report only; the lead assigns a KB number. The likely fix is to narrow that policy's exposure to the public-profile columns (column grants, or a view), since the public pages read only five columns |

## 32. Implementation Plan

1. **pgTAP first** (§26.1). Run it red on this branch before the migration
   exists, under the DB lock.
2. **Migration** (§14). `db reset` and pgTAP green. Then revert the body, go
   red, and restore (§26.2).
3. **Mirror** into `schemas/18-projects.sql`.
4. **Typegen** and confirm no diff (FR-6).
5. **PostgREST re-run** of the reproduction and record before and after.
6. **UI run** of Settings as owner and as an account member, with
   screenshots.
7. `pnpm typecheck`, unit tests for `@kit/projects`, `lint:fix`,
   `format:fix`.
8. **Record:** KB-41 entry and Fixed-table row per Decision 6, then commit,
   push, and open the PR.

Rollback at any stage: drop the migration file; nothing else depends on it.

## 33. Definition of Done

- The stranger (public and private) and removed-member cases were seen red
  on `main`'s function and are green with the fix; the anon case stays green.
- Account members (owner, a team member with no project row, a project
  member) get the unchanged list in pgTAP and on the real Settings page, with
  screenshots.
- The reproduction re-run as real users shows `[]` and a permission error
  where it showed emails.
- Typegen produces no diff. Typecheck, lint, format and the unit tests pass.
- The sweep findings are reported to the lead. The KB entry is updated per
  Decision 6.

## 34. Final Consistency Pass

**Forward.** The problem is emails readable by any signed-in user. Team
members still need the card. The UI path already requires account membership,
so the only exposure is the RPC. The fix puts that same rule inside the RPC,
pgTAP proves it both ways, and the UI run proves the card still works.

**Reverse.** In production the function returns rows only to account members
and nothing to anyone else. It reads the same tables, and nothing is written.
The Settings page, reached only by account members, renders the same list.
That satisfies §2's flows and §1's outcome. The two directions agree.
