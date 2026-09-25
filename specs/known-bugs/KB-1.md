---
id: KB-1
title: "Deleting a user who has created anything fails"
status: fixed
fixed_in: ["#290"]
fixed_summary: "Deleting a user who had created anything failed: seventeen authorship keys to `auth.users` had no ON DELETE action, and three triggers refused or undid the key's own set-null"
severity: Medium
found: 2026-09-19
---

## KB-1 — Deleting a user who has created anything fails

> **Fixed (2026-09-21), #290.** All seventeen keys are `ON DELETE SET NULL`
> (`20260921205124_authors-deletable.sql`). The keys were not the whole bug:
> three BEFORE UPDATE triggers undid or refused the key's own `SET NULL`
> (`trigger_set_user_tracking`, `kit.prevent_memberships_update`,
> `enforce_verified_facts_update_rules`), so each now lets through a
> foreign-key action that clears an author, and nothing else. Kept here as
> the record of what was found.
>
> **Owner decision (2026-09-22):** the two audit columns "keep a snapshot of
> the author's name". `immutable_events.created_by_name` and
> `verified_facts.verified_by_name` (`20260921211043_audit-author-name-snapshot.sql`)
> hold the author's display name — their personal account's `accounts.name`,
> not their email — written by trigger when the author is, never taken from
> the client, backfilled for existing rows, and kept when the key goes to
> NULL. A fact's name lasts as long as its verification does.
>
> Still open, for the owner: `accounts` / `accounts_memberships` now diverge
> from the upstream kit, which a future upstream sync must not undo.

**Severity:** Medium — affects account deletion for every user who has
ever created a project, and super-admin "delete user". Few users today.
**Found:** FILM-1610 review, round 3.

### What happens

Users are **hard-deleted**. Both paths call Supabase's
`auth.admin.deleteUser(userId)` without the soft-delete flag:

- `packages/features/accounts/src/server/services/delete-personal-account.service.ts:49`
  (a user deleting their own account)
- `packages/features/admin/src/lib/server/services/admin-auth-user.service.ts:35`
  (super-admin "delete user")

Content is soft-deleted (`deleted_at` on episodes, assets, seasons, project
templates), but users and accounts have no such column. The delete reaches
Postgres, and every foreign key to `auth.users` with **no ON DELETE action**
refuses it while any row still points at the user.

### Reproduced (local API, 2026-09-19)

| Setup | `DELETE /auth/v1/admin/users/:id` |
|---|---|
| User owns a team, created nothing | **200** — succeeds |
| User owns a team and created one project | **500** — `23503 ... violates foreign key constraint "projects_created_by_fkey"` |

The existing E2E "delete user flow" (`apps/e2e/tests/admin/admin.spec.ts`)
passes only because its user never creates anything.

*Correction:* an earlier note said "deleting a user referenced by any of
these keys fails" as though it always did. It fails only when a row
actually references the user — `accounts.created_by`, for instance, is not
written by `create_team_account`, so owning a team alone does not block a
delete.

### The keys (17, measured on the live local schema)

`NO ACTION` foreign keys to `auth.users` in `public`, with how often each
was set in the local database when measured. A non-zero count means the
column is written, so it blocks deletes in practice.

| Column | Set locally |
|---|---|
| `projects.created_by`, `projects.updated_by` | 2 |
| `project_members.created_by`, `.updated_by` | 1 |
| `accounts_memberships.created_by`, `.updated_by` | 1 |
| `accounts.created_by`, `.updated_by` | 1 (seed data) |
| `verified_facts.created_by`, `.updated_by`, `.verified_by` | 0 |
| `episode_facts.linked_by` | 0 |
| `character_states.created_by` | 0 |
| `immutable_events.created_by` | 0 |
| `fact_extraction_jobs.created_by` | 0 |
| `project_intros.created_by` | 0 |
| `social_posts.created_by` | 0 |

Measure again rather than trust this table:

```sql
select conrelid::regclass, conname from pg_constraint
 where confrelid = 'auth.users'::regclass and confdeltype = 'a'
   and connamespace = 'public'::regnamespace;
```

FILM-1610 (#264) already fixed the same defect on
`analytics_experiments.created_by`, `content_tags.created_by` and
`hook_tests.created_by` — see `analytics-authors-deletable.test.sql`.

### Proposed fix

- Every **authorship** column (`created_by`, `updated_by`, `linked_by`,
  `verified_by`) becomes `ON DELETE SET NULL`: the row belongs to the
  account, not to whoever typed it. One migration, dropping and re-adding
  each constraint.
- **Decide before changing:** `immutable_events.created_by` and
  `verified_facts.verified_by` may be audit records where losing the
  author matters. Nulling is still better than blocking deletion, but an
  audit table might instead want a snapshot of the author's name.
- Makerkit core tables (`accounts`, `accounts_memberships`) come from the
  upstream kit; check upstream's current definition before diverging.

### Acceptance criteria

- [x] pgTAP: a user who created a project, a membership, a verified fact
      and a social post can be deleted; each row stays with a null author
      (`authors-deletable.test.sql`, one row per key — all seventeen)
- [x] E2E: "delete user flow" runs with a user who has created a project
      and fails if the delete is refused (`admin.spec.ts`; the same for a
      user deleting their own account, in `account.spec.ts`)
- [x] The query above returns no rows for authorship columns (no rows at
      all; asserted by the pgTAP file, so a new key without an action fails
      the suite)
- [x] Added by the owner's decision: after the author is deleted, the event
      and the verified fact survive with a NULL key and the author's name
      intact; a forged name loses to the id (`audit-author-snapshot.test.sql`)
