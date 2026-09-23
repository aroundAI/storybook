# KB-26 — Uploaded research sources are readable by every signed-in user

**Engineering Design Document** · ticket: `KB-26` in
`specs/cross-cutting/FILM-CC-04-known-bugs.md` · related: FILM-1135 (closes its
"RLS policies protect data access" gap), FILM-1141 (upload), FILM-1140 (hub),
KB-28 (`can_write_project`), KB-37 (registry writes, split out) ·
branch `fix/kb-26-research-sources-tenant-scope` · author: teammate `kb-26`,
2026-09-23 · size: **M**

**Status: APPROVED WITH CHANGES (2026-09-23), implemented as below.**

### Changes from the Phase 1 plan (owner/lead decisions)

The Phase 1 draft is in git at `c750f5ad`. This document describes the
approved design and the code in the PR.

| # | Phase 1 proposal | Approved |
|---|---|---|
| D1 | Uploads belong to the project | **Approved** |
| D2 | Hide ownerless legacy uploads + reattach runbook | **Approved** |
| D3 | Super-admin-only shared registry; hide hub controls | **Split out as KB-37.** `is_super_admin()` needs an aal2 session, MFA is not enforced, and the owner could be locked out. `requireAccountOwner` and the hub's controls are **unchanged** here |
| D4 | Access = "can read the project" (`projects_read`) | **Revised.** Public and unlisted projects are readable by every signed-in user (`20260108120000_public_sharing_rls.sql:28`), so reading a project proves nothing. Read **and** upload need an owner/admin/member row in `project_members`, via KB-28's `public.can_write_project(uuid)`. Visibility never grants access |
| — | `/api/research/upload` | **In scope** (same read-means-write flaw; found by KB-28) |
| — | `extractFactsFromContentAction` | **In scope** (same class, same file, same dialog) |
| Q1 | Check production Postgres version | **Answered: 17.6** (owner). The migration still **raises** on Postgres < 15, as a cheap guard |
| D5 | New KB for "first membership as account" | **No new KB.** KB-31 already covers it (acceptance 3) |

---

## 1. Start With the User

**Who.** A creator working in a studio project (`/home/<team>/studio/<project>/research`).
They open **Upload Source**, paste text (or a file or URL), name it, and the
platform stores the text and extracts facts into the project's Facts Library.
Uploads are often unpublished: interview notes, drafts, paid research.

**The problem.** The text was stored in a table every signed-in user of every
account could read through the Data API (`/rest/v1/external_content`). Upload
names and URLs appeared in every account's Research Hub. Two accounts
uploading the same name shared one record, and the second overwrote the
first's URL. An upload named "Reuters" rewrote the built-in Reuters source for
everyone. Anyone who could *read* a project (including anyone, for a public
project) could also add research and facts to it.

**What the user gets.**

- An upload is visible only to people with an owner, admin or member role on
  the project it was uploaded into. A public or unlisted project does not open
  its research to anyone else. Project viewers do not see it.
- The Research Hub shows the shared built-in sources plus **this project's**
  uploads, not other projects' or other accounts'.
- Two projects can each have a source called "Notes" independently. An upload
  called "Reuters" creates a project-local entry and leaves the built-in one
  alone.
- Someone without such a role who tries to upload (for example, to a public
  project) sees "You need to be a member of this project to add research to
  it." Nothing is written or queued.
- The sidebar's research badge starts counting the project's uploads. That half
  of the count used to fail: it queried a column that did not exist.

**Success:** the dialog, steps and toasts are unchanged for a project member,
and a user of another account can read none of it. **What persists:** the
upload and its source, tied to the project, until the project is deleted
(cascade) or the source is removed (soft delete, unchanged).

**Existing uploads** (made before the fix) record no owner. They are kept but
hidden from everyone until the owner reattaches them (§25).

## 2. Define the Complete User Journey

| # | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| 1 | Opens `/research` in project P | Client lists active sources where `project_id is null or = P`, filtered again by RLS | Shared sources + P's uploads | Upload / Add / Remove / Refresh |
| 2 | Clicks **Upload Source** | Dialog opens | Paste / URL / File tabs | Fill in |
| 2a | File tab, PDF/DOCX | `POST /api/research/upload` checks `can_write_project(P)` before extracting | Extracted text, or a 403 toast with the refusal sentence | Submit |
| 3 | Submits | `uploadSourceContentAction`: `can_write_project(P)` → upsert source `(P, slug)` → insert content `(P, is_upload)` | "Uploading…" | — |
| 4 | — | `extractFactsFromContentAction`: same check, then facts inserted or queued | "Extracting…" → "Complete" | Dialog closes; hub reloads |
| 5 | Uploads again, same name, in P | Upsert hits `(P, slug)`: one source, second content row | Still one list row | — |
| 6 | No project role (e.g. a stranger on a public project) submits | Refusal returned as a value; nothing written | Toast: refusal sentence | — |
| 7 | Refresh / leave / return | Server state re-read | Same list | — |
| 8 | Session expires | `enhanceAction({auth:true})` redirect (unchanged) | Sign-in | — |

## 3. Explicitly Define the Happy Path

Alice owns team **Alice Co** and created project **Doc**, so she holds its
`project_members` owner row.

1. She opens Doc → Research. `listExternalSourcesAction({ activeOnly, projectId: Doc })`
   returns the shared sources.
2. She uploads "Interview notes". The action calls
   `rpc('can_write_project', { target_project_id: Doc })` with her client, which
   returns `true`. It upserts `external_sources(project_id=Doc, slug='interview-notes')`
   on conflict `(project_id, slug)` and inserts
   `external_content(project_id=Doc, is_upload=true, …)`. Result: `{ ok: true }`.
3. Extraction passes the same check and runs. The dialog closes and the hub
   lists "Interview notes".
4. Bob (another team) queries `/rest/v1/external_content?project_id=eq.<Doc>`
   with his JWT and gets `[]`. That stays `[]` after Doc is made public.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User sees | Final state |
|---|---|---|---|
| No owner/admin/member row on P (stranger, viewer, account member not on the project, public-project reader) | `ActionRefusal(PROJECT_WRITE_REFUSAL)` returned as a value; route returns 403 with the same text | Toast with the sentence | unchanged |
| `can_write_project` RPC errors | thrown (unexpected; KB-6: stays thrown) | existing fallback toast | unchanged |
| Same name twice in P | one source (URL/category updated), two contents | success | 1 source, 2 contents |
| Same name in another project/account | separate source | success | independent |
| Name equals a shared slug ("Reuters") | project-local row; shared row untouched | two "Reuters" rows in P's hub | — |
| Source/content write fails | thrown, as before | fallback toast | a source may exist without content (pre-existing) |
| Project deleted | FK cascade removes P's sources and content | — | gone |
| Legacy upload | `is_upload`, no project → invisible | — | kept; runbook |
| Deploy window (migration ran, old code) | old `onConflict: 'slug'` has no matching unique key → error before the content insert | fallback toast | fails closed |

## 5. Establish the User-Facing Contract

- `uploadSourceContentAction` and `extractFactsFromContentAction` take unchanged
  input and now return `ActionResult<…>` (`returnRefusals`). The dialog calls
  `unwrap` and shows `refusalMessage(error, 'Failed to upload and extract facts')`.
- `POST /api/research/upload` returns 403 `{ error: PROJECT_WRITE_REFUSAL }`
  when the caller has no project role. The other responses are unchanged.
- Refusal text: **"You need to be a member of this project to add research to it."**
- **Visibility rule:** an upload and its source are readable exactly by users
  for whom `can_write_project(project_id)` is true. Shared rows are readable by
  every signed-in user.
- No controls are added or removed in the hub (D3 is split out).

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Verification |
|---|---|---|
| FR-1 | Upload content is readable iff `can_write_project(project_id)` | pgTAP T1–T9; E2E Bob JWT |
| FR-2 | Project visibility grants nothing | pgTAP (public project); E2E (public project) |
| FR-3 | Shared cache rows (`not is_upload`) stay readable by any signed-in user | pgTAP |
| FR-4 | An upload with no project is readable by nobody | pgTAP ×2 |
| FR-5 | `project_id is not null ⇒ is_upload` (CHECK) | pgTAP |
| FR-6 | Source slug unique per `project_id`; shared rows unique among themselves | pgTAP ×4 |
| FR-7 | Project-owned `external_sources` rows readable iff `can_write_project` | pgTAP ×2 |
| FR-8 | Upload action refuses before any write when `can_write_project` is false | Vitest (red/green) |
| FR-9 | Upload writes `project_id` on both rows, `is_upload = true`, conflict key `(project_id, slug)` | Vitest; E2E `readRows` |
| FR-10 | `extractFactsFromContentAction` refuses before inserting or queuing | Vitest ×2 (red/green) |
| FR-11 | `/api/research/upload` refuses (403) before extracting or queuing | Vitest (red/green); E2E |
| FR-12 | Aggregator singleton loads shared sources only | Vitest (red/green) |
| FR-13 | Hub list and counts: shared + current project only | E2E |
| FR-14 | Every `using (true)` policy to `authenticated` listed with a decision | FILM-CC-04 table |
| FR-15 | Migration refuses to run on Postgres < 15 | guard `DO` block |

## 7. Define Non-Functional Requirements

- **Security:** isolation lives in RLS. The two service-role writers (the
  upload action and the Lambda fed by extraction jobs) are gated by the same
  function RLS uses, so there is one rule for reading and writing.
- **Performance:** shared rows short-circuit on `not is_upload`. Only upload
  rows call `can_write_project` (one indexed `project_members` lookup).
  Uploads are never returned by cache search (`cache_expires_at` is null).
- **Durability:** the migration deletes nothing.
- **Observability:** refusals are expected outcomes and are not logged.
  Unexpected errors keep throwing.
- **Compatibility:** one action pair and one route change shape or status;
  all callers change in the same PR.

## 8. Analyze the Existing System

**Tables** (`20260211200000_create_external_context_tables.sql`):
`external_sources` (`slug UNIQUE`), `external_content` (no owner). Read
policies: sources `is_active = true` (`:137-140`), content `using (true)`
(`:150-153`). Neither table has a `schemas/` file.

**Writers:**
- `uploadSourceContentAction` (`source-upload-actions.ts:44-123`): gated on
  "owner of **any** account" (`:56-64`) and never used `projectId`. Wrote via
  the admin client, upserting `onConflict: 'slug'`.
- `extractFactsFromContentAction` (`:228-323`) and `/api/research/upload`
  (`route.ts:53-65`): gated on "can read the project", which every signed-in
  user passes for a public or unlisted project. They insert `verified_facts` or
  queue `fact-extraction` jobs that write with the service role.
- `cacheContent` (`context-aggregator.ts:302-350`) writes provider rows with ids
  `newsapi:`, `ss:`, `archive:`. Only the upload action writes `manual-…` ids.
- `add/update/deleteExternalSourceAction` gated on `requireAccountOwner`
  (`external-context-actions.ts:215-236`): **KB-37, unchanged here.**

**Readers:** `listExternalSourcesAction`, `getResearchCountsAction` (no project
filter); `searchCache` (uploads never match: `cache_expires_at` is null);
`getExternalContentByIdAction` (no caller); the studio layout count
(`layout.tsx:81-84`, queried a missing `project_id` column → HTTP 400); the
aggregator's process-wide singleton (`initialize`, built from one caller's
RLS view). No Lambda or websocket code reads these tables (grep, with a
positive control on `verified_facts`).

**Access primitives:** `projects_read` includes public/unlisted projects for
every signed-in user (`20260108120000_public_sharing_rls.sql:28-35`), so it is
**not** usable here. `project_members` has an owner row for every project's
creator (`add_project_creator_as_owner`, `20251016143639_projects.sql:430-448`).
That covers personal-account projects too, whose accounts have no membership
rows. `project_role` is `owner | admin | member | viewer`.

**Reproduced 2026-09-23T02:13Z** on a fresh reset of `origin/main`, under the
DB lock. Two real GoTrue users each created their own team and read through
PostgREST with their own JWTs. Writes were made exactly as the action makes
them.

| # | Probe | Result |
|---|---|---|
| 1 | Bob (`bob-co:owner` only) reads Alice's upload | **1 row**, full text `CONFIDENTIAL draft text by Alice` |
| 1b | Bob reads Alice's upload source | **1 row**, name and URL |
| 2 | Bob uploads the same name | one shared source row; its URL now Bob's; 2 content rows |
| 3 | Upload named "Reuters" | seeded row `newsapi/tier_1/reuters.com` → **`manual/tier_3/attacker.example`** |
| 4 | Sidebar count as Alice | **HTTP 400** `42703 column external_content.project_id does not exist` |
| 5 | `using (true)` to `authenticated` | `config`, `external_content`, `role_permissions`, `roles` |

## 9. Define the Desired System Behavior

| User action | Logic | Data operation | Result |
|---|---|---|---|
| Open hub | list/counts with `or(project_id.is.null, project_id.eq.P)` + RLS | select | shared + P's |
| Upload | `can_write_project(P)` else refuse | admin upsert `(P, slug)`; insert content `is_upload` | `ActionResult` |
| Extract facts | `can_write_project(P)` else refuse | insert `verified_facts` / queue jobs | `ActionResult` |
| PDF/DOCX extraction | `can_write_project(P)` else 403 | extract; optionally queue | JSON |
| Data API read | RLS | §14 policies | permitted rows only |

## 10. High-Level Architecture

No new components. The trust boundary is RLS on both tables. The service-role
paths (the upload action, and the Lambda behind extraction jobs) bypass RLS,
so their entry points call the **same** `can_write_project` before writing.
Ownership is the project. Access is "has an owner/admin/member row on it",
defined once by KB-28's function. KB-28 needs the same rule for project assets.

## 11. Architecture and Flow Diagrams

```
Upload
browser ──uploadSourceContentAction(P)──▶ action
   │                                     │ user client: rpc can_write_project(P)
   │                                     ├─ false → {ok:false, error}   (no writes)
   │                                     │ admin: upsert external_sources(project_id=P, slug) on conflict (project_id, slug)
   │                                     │ admin: insert external_content(project_id=P, is_upload=true)
   ◀────────────── {ok:true, data} ──────┘

Read (action, Data API, sidebar count)
authenticated ──select──▶ external_content
   RLS: not is_upload                                     → shared cache row
     or (project_id is not null and can_write_project(project_id))
   else                                                   → invisible (incl. legacy uploads)
```

## 12. End-to-End Data Flow

User text → zod → `can_write_project` → slug (unchanged function) → source
`(P, slug)` + content `(P, is_upload)` → read by the hub (sources), the sidebar
count (content), and `getExternalContentByIdAction` (no caller); never by
search. Duplicates: same-name re-upload gives 1 source and N contents
(intended). Loss: none. Partial: source without content on an insert failure
(pre-existing, not widened). Deletion: project cascade, source soft delete.

## 13. Data Model

- `external_sources`: **shared** (`project_id null`) or **project-owned** (an upload's source).
- `external_content`: **shared cache** (`is_upload false`, no project) or **upload** (`is_upload true`), owned (`project_id` set) or legacy (`project_id null` → invisible).
- Invariants: `project_id is not null ⇒ is_upload`. `(project_id, slug)` is unique, with null as one scope.
- Authoritative for access: `project_members` via `can_write_project`.

## 14. Database Design and Changes

Migration `apps/web/supabase/migrations/20260923025501_kb26_scope_research_uploads.sql`
(runs after KB-28's `20260923024605_kb28-project-write-scope.sql`, which creates `can_write_project`):

- Guard: `DO` block raising if `server_version_num < 150000`.
- `external_content`: `+ project_id uuid references projects on delete cascade`,
  `+ is_upload boolean not null default false`. Backfill
  `is_upload = true where external_id like 'manual-%'`. Add CHECK
  `project_id is null or is_upload`, and a partial index on `project_id`.
  Replace the `using (true)` policy with
  `not is_upload or (project_id is not null and can_write_project(project_id))`.
- `external_sources`: `+ project_id` (same FK). Drop `external_sources_slug_key`
  and add `unique nulls not distinct (project_id, slug)` plus a partial index.
  Replace the `is_active` policy with
  `is_active and (project_id is null or can_write_project(project_id))`.

Notes:
- The CHECK holds for every existing row (all have `project_id null`), so no
  `NOT VALID` is needed (ENGINEERING-WORKFLOW §3).
- `drop constraint` has no `IF EXISTS`: a wrong name fails the migration rather
  than leaving a slug-only key behind.
- **Other writers** of the new columns: `cacheContent` names neither, so it
  gets the defaults (shared). The `updated_at` trigger doesn't touch them. FK
  actions delete.
- The seed migration's `ON CONFLICT (slug)` (`20260211200003:59`) runs earlier
  and is unaffected. Future seeds must use `(project_id, slug)`, and the
  migration header says so.
- Locking: metadata-only column adds, a small UPDATE, and a brief exclusive
  lock for the key swap.
- Types regenerated with `pnpm supabase:web:typegen`.
- **Rollback:** revert the app. Reverting the migration would reopen the leak,
  so it is forward-fix only (§25).

## 15. Low-Level Design

- `packages/features/episodes/src/lib/server/project-write-access.ts` (new,
  `server-only`): `canWriteProject(client, projectId)` wraps
  `rpc('can_write_project')` and throws on an RPC error.
  `PROJECT_WRITE_REFUSAL` is the one refusal sentence. It is exported as
  `@kit/episodes/lib/server/project-write-access` so the route shares it. It is
  not exported from a `'use server'` file, where every export would become a
  callable action.
- `source-upload-actions.ts`: the "owner of any account" block is removed and
  replaced by `canWriteProject`. The upsert carries `project_id` with
  `onConflict: 'project_id,slug'`, and the insert carries
  `project_id, is_upload: true`. `extractFactsFromContent`'s projects-read
  check is replaced by `canWriteProject`. Both actions are wrapped in
  `returnRefusals`.
- `route.ts`: the projects-read check is replaced by `canWriteProject` → 403.
- `context-aggregator.ts`: `initialize()` adds `.is('project_id', null)`.
- `external-context-actions.ts`: `ListSourcesSchema` gains optional
  `projectId`. `sharedOrProject()` builds the `.or()` filter used by the list
  and the sources count. `project_id` is added to the list's select.
  `requireAccountOwner` is untouched (KB-37).
- UI: the hub passes `projectId` to the list and adds `data-test` on rows. The
  dialog uses `unwrap`/`refusalMessage` and adds `data-test` on its inputs and
  submit button.

## 16. API and Event Design

| Interface | Change |
|---|---|
| `uploadSourceContentAction` | returns `ActionResult`; authz: owner-anywhere → `can_write_project` |
| `extractFactsFromContentAction` | returns `ActionResult`; authz: project readable → `can_write_project` |
| `POST /api/research/upload` | authz: project readable → `can_write_project`; 403 text changed |
| `listExternalSourcesAction` | `+ projectId?`; rows `+ project_id`; shared-only when absent |
| `getResearchCountsAction` | `sources` counts shared + project |
| Data API `external_content` / `external_sources` | fewer rows returned (RLS) |

## 17. State and Lifecycle Design

Source: `active → inactive` (soft delete) → removed only by cascade. Content:
`shared | upload(owned) | upload(legacy)`. `legacy → owned` only via the runbook
UPDATE. `owned → shared` is impossible (CHECK).

## 18. Failure and Error Handling

See §4. Every refusal is a value. RPC and database failures stay thrown (KB-6).
The migration aborts cleanly on Postgres < 15 or a wrong constraint name.

## 19. Security

- **Tenant isolation** in RLS for every read path, including the Data API.
- **One rule for read and write:** `can_write_project` gates the RLS read, the
  upload action, fact extraction and the route. Visibility (`public`/`unlisted`)
  grants nothing.
- **What the fix newly permits** (ENGINEERING-WORKFLOW question 3): a
  non-owner **project member** (owner/admin/member row) can now upload.
  Before, only an owner of *some* account could. This is scoped to projects
  where they hold the role. Everything else is narrowed: account-only members
  without a project row, project viewers, and public-project readers lose
  access they had.
- **Left open, by decision:** registry writes by an owner of any account
  (`requireAccountOwner`), **KB-37**. That includes deactivating another
  project's upload source by id, now much harder to learn because RLS hides
  the id.
- **Recurrences of the `requireAccountOwner` shape:** inline in
  `source-upload-actions.ts:56-64` (fixed here); `external-context-actions.ts:215-236`
  (KB-37). "First membership as account" in `story-actions.ts:74-95` and
  `bulk-actions.ts:88-102` is covered by KB-31 (acceptance 3). The other 13
  `from('accounts_memberships')` sites filter by a specific account. The SQL
  owner checks sampled are tied to the row's own account.
- **`using (true)` inventory** (KB acceptance 3, the full list goes into
  FILM-CC-04): `config`, `roles`, `role_permissions` hold nothing
  account-scoped (keep). `external_content` is replaced here. The PR also runs
  the wider probe (`TO public`/anon, `storage`, trivially-true expressions) and
  records what it finds.

## 20. Performance and Scale

The cache holds hundreds to thousands of rows. Uploads number a few per
project. Shared rows cost nothing extra. Upload rows cost one
`project_members` lookup (indexed `(project_id, user_id)` unique). Partial
indexes on `project_id` serve the sidebar count and the hub filter.

## 21. Accessibility and Client Behavior

No new controls. Refusals use the existing toasts. Only `data-test`
attributes are added.

## 22. Observability and Operations

Owner checks after deploy (his own session, never any production credentials
in tools I run):
`select count(*) from external_content where is_upload and project_id is null`
gives the legacy uploads awaiting reattachment.

## 23. Configuration and Feature Flags

None. An RLS fix must be unconditional.

## 24. Compatibility

- Deploy order: migration, then app. In between, old code's upload fails
  closed (§4).
- KB-28's migration must precede this one. The timestamp order guarantees it,
  and this PR is stacked on KB-28's.
- Legacy upload-created **source** rows stay shared (`project_id null`) and
  visible by name, because they cannot be told apart from Add-Source rows.
  The runbook covers them.

## 25. Migration and Rollout Strategy

**Before deploy:** nothing. Production is Postgres 17.6 (owner, 2026-09-23),
and the migration's guard would stop it with a clear message on anything below 15.

**After deploy (owner runbook, own SQL editor):**
1. `select id, title, url, fetched_at from external_content where is_upload and project_id is null order by fetched_at;`
2. For the uploads to keep: `update external_content set project_id = '<project>' where id in (…);`
   and for their sources: `update external_sources set project_id = '<project>' where id in (…);`
   (If that project already has the slug, rename first.)
3. Check whether an upload ever rewrote a seeded source:
   `select slug, provider_type, credibility_tier, website_url from external_sources where project_id is null and provider_type = 'manual' and slug in ('reuters','ap-news','afp','bbc-news','nytimes','guardian','wsj','aljazeera','cnn','npr', …);`
   Restore any hit from `20260211200003_seed_news_sources.sql`.

**Rollback:** revert the app. Keep the migration (it only narrows reads).

## 26. Testing Strategy

| Layer | File | Covers | Red first |
|---|---|---|---|
| pgTAP | `apps/web/supabase/tests/database/research-uploads-rls.test.sql` (plan 22) | owner/member read; viewer, account-only member, outsider, outsider-on-public-project denied; personal owner reads own; shared row readable; legacy hidden ×2; source names; CHECK; per-project slug ×4; Reuters untouched | old policies restored → cross-tenant cases fail |
| Vitest | `packages/features/episodes/__tests__/research-upload-access.test.ts` (8) | FR-8–FR-10, FR-12 | guards disabled → 5 fail |
| Vitest | `apps/web/app/api/research/upload/__tests__/route.test.ts` (2) | FR-11 | guard disabled → 200 instead of 403 |
| Playwright | `apps/e2e/tests/research/research-sources.spec.ts` | dialog upload twice (second submission), Bob's JWT reads `[]` (also on a public project), Bob's same-name upload gives two sources, route 403 text, evidence screenshots | run on unfixed code |

## 27. Production-Build Verification

Run the Playwright spec against `next build && next start -p 3101`. The route's
403 body text and the upload flow are asserted there. Action refusals go
through `returnRefusals`, which is pinned by `packages/next` tests.

## 28. Requirement Traceability

| Req | Design | Component | Test | Prod verification |
|---|---|---|---|---|
| FR-1/2/7 | §14 policies | RLS | pgTAP; E2E | owner: second test user reads `[]` |
| FR-3 | `not is_upload` branch | RLS | pgTAP | search still works |
| FR-4/5 | backfill + CHECK | migration | pgTAP | §22 count |
| FR-6 | unique `(project_id, slug)` | migration + action | pgTAP; E2E | runbook step 3 |
| FR-8/9/10 | `canWriteProject` | actions | Vitest; E2E | — |
| FR-11 | `canWriteProject` | route | Vitest; E2E (prod build) | — |
| FR-12 | filter | aggregator | Vitest | — |
| FR-13 | `sharedOrProject` | list/counts | E2E | owner opens hub |
| FR-14 | §19 | FILM-CC-04 | probe in PR | — |
| FR-15 | `DO` guard | migration | read | prod is 17.6 |

## 29. Architectural Alternatives and Trade-offs

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Access rule | `can_write_project` (project role) | `projects_read`; `has_role_on_account` | the first admits public-project readers; the second misses personal accounts and ignores project roles |
| Rule location | KB-28's shared function | own copy | one definition for assets and research |
| Owner key | `project_id` | `account_id` | upload happens in a project; facts are per project |
| Storage | columns on `external_content` | new table | no security gain; doubles the migration |
| Private marker | `is_upload` + CHECK | `external_id like 'manual-%'` in the policy | a string convention in a security rule |
| Legacy rows | hide | delete / guess owner | keep-until-asked (KB-20); no guessing about production data |
| Registry writes | unchanged (KB-37) | super admin only | MFA not enforced; could lock the owner out |

## 30. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Prod Postgres < 15 | migration aborts | answered 17.6; `DO` guard kept |
| KB-28 changes the function's signature | policies fail to compile | stacked PR; rebase and regenerate |
| Hidden legacy uploads surprise the owner | "sources vanished" | runbook in PR body |
| `database.types.ts` conflicts | red CI | regenerate on rebase |
| Team members without a project row lose access to research they could read before | surprise for a team | intended (approved rule); add them to the project |

## 31. Open Questions and Assumptions

| # | Item | Status |
|---|---|---|
| D1–D5 | see the changes table at the top | resolved |
| Q1 | Production Postgres version | **17.6** (owner, 2026-09-23); guard kept |
| A1 | No Lambda/websocket reads these tables | verified (grep + positive control) |
| A2 | `getExternalContentByIdAction` has no caller | verified |
| A3 | FILM-1140's sidebar-count criterion starts working as a side effect | reported to the lead, not flipped here |

## 32. Implementation Plan

1. Migration + pgTAP (DB lock), on top of KB-28's branch. Red with the old
   policies, then green. Typegen.
2. Shared helper, actions, route, aggregator, list/count scoping. Vitest red →
   green.
3. Dialog/hub edits. Playwright on port 3101, red on unfixed code, green, and
   evidence screenshots.
4. Production build run of the spec.
5. Wider `using (true)` probe. KB-26 entry → Fixed, with the class table and one
   Fixed row. FILM-1135 RLS criterion → met.
6. typecheck, lint:fix, format:fix. Push; open the PR stacked on KB-28.

## 33. Definition of Done

- [ ] pgTAP 22/22, seen red on the old policies
- [ ] Vitest guards seen red and then green
- [ ] E2E: second user reads `[]` (also on a public project); same name in two accounts gives two sources; route 403
- [ ] Production-build run
- [ ] `using (true)` inventory with decisions in FILM-CC-04
- [ ] Screenshots in the PR; runbook and before-deploy step in the PR body
- [ ] typecheck / lint / format clean; types generated
- [ ] FILM-1135 RLS criterion flipped with evidence

## 34. Final Consistency Pass

**Forward:** uploads must be private to the people working on the project
(§1). So RLS reads, and every service-role write entry point, use one
project-role rule that ignores visibility (§10, §14, §15). Each piece has a
test at the layer that can see it (§26), and the owner checks production with
his own session (§22, §25).

**Reverse:** production will store uploads owned by a project. It will return
them only to that project's owner, admin and member rows, keep shared rows
public to signed-in users, hide legacy uploads, key sources per project, and
refuse uploads and fact extraction from anyone else. The user sees an
unchanged flow for members and nothing for anyone else. That matches §1.

**Residual, stated:** registry writes (KB-37). Legacy upload source names stay
visible until reattached. Story-ideation billing attribution (KB-31).
