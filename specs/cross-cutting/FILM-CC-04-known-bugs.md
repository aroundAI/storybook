---
spec_id: FILM-CC-04
title: Known Bugs — Found, Not Yet Fixed
status: OPEN
effort: M
dependencies: -
---

# Known Bugs — Found, Not Yet Fixed

Bugs found while reviewing other work, recorded so they are not lost and
not rediscovered. **None is blocking today**; each says who it affects and
how it was confirmed. When one is fixed, move it to *Fixed* with the PR.

Every entry here was **reproduced**, not inferred. Where an earlier
statement turned out wrong on testing, the entry says so.

---

## KB-1 — Deleting a user who has created anything fails

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

- [ ] pgTAP: a user who created a project, a membership, a verified fact
      and a social post can be deleted; each row stays with a null author
- [ ] E2E: "delete user flow" runs with a user who has created a project
      and fails if the delete is refused
- [ ] The query above returns no rows for authorship columns

---

## KB-2 — `scripts/deploy.sh` deploys even when migrations fail

**Severity:** Low — deploys work today (`pnpm deploy:production`), and the
risk is only on a failed migration. **Found:** FILM-1610 review, round 3.

Step 5 applies migrations before the build, which is the right order, but
it **fails open** at three points (`scripts/deploy.sh`, from the
"Apply Supabase Migrations" section):

- the `supabase` CLI is not installed → prints "Skipping migrations" and
  continues;
- `supabase link` fails → prints debug info and continues;
- `supabase db push` fails → prints "You may need to apply migrations
  manually" and continues.

In each case the app is built and deployed against the old schema. For a
change like FILM-1610, whose code reads columns only its migrations
create, that means every read touching them fails in production.

**Proposed fix:** exit non-zero at each of the three points, as the GitHub
deploy workflows now do (#264).

---

## KB-3 — Flaky E2E tests under parallel load

**Severity:** Low. **Found:** FILM-1610 reviews. Each passed 3–5 times out
of 3–5 on its own; each failed once when run alongside the rest of the
suite on one dev or production server.

| Test | Failure seen |
|---|---|
| `deep-dive.spec.ts` › YPP renders one card per active YouTube channel | assertion timeout |
| `read-failures.spec.ts` › a failed refetch keeps the channel filter | assertion timeout |
| `admin.spec.ts` › delete user flow | 10s visibility timeout (production build) |

Also observed: the first E2E run after a database reset and a fresh dev
server had 11 flaky tests while routes compiled; the same run warm had 1.
Not a code defect, but a local-run pitfall worth knowing.

**Proposed fix:** look for a fixed wait or an unscoped locator in each;
none were investigated.

---

## KB-4 — `config.toml` still points `db diff` at `schemas/`

**Severity:** Low. **Found:** the `db diff` removal (#265).

`apps/web/supabase/config.toml` sets `schema_paths = ["./schemas/*.sql"]`.
`schemas/` is incomplete, so a stray `supabase db diff` proposes dropping
live tables. #265 removed every script and doc that suggested running it;
this setting is what makes running it harmful.

**Proposed fix:** remove `schema_paths` (it is read only by `db diff`), or
keep it once `schemas/` is reconciled. Needs a decision; nothing else
reads it.

---

## KB-5 — README gives the wrong local Supabase ports

**Severity:** Low. **Found:** the `db diff` removal (#265).

`README.md` ("Database Management" section) says Supabase is on
`http://localhost:54321` and email on `:54325`; this repo's
`config.toml` runs them on `55321` and `55324`.

---

## Fixed

| ID | Bug | Fixed in |
|---|---|---|
| — | `analytics_experiments`, `content_tags`, `hook_tests` authors blocked user deletion | #264 |
| — | GitHub deploy workflows never applied migrations; tests could not stop a deploy | #264 |
| — | CI tested `@kit/mailers-core`, which does not exist; `@kit/mailers` never ran | #264 |
