# KB-26 — Uploaded research sources are readable by every signed-in user

**Engineering Design Document** · ticket: `KB-26` in
`specs/cross-cutting/FILM-CC-04-known-bugs.md` · related: FILM-1135 (closes its
"RLS policies protect data access" gap), FILM-1141 (upload), FILM-1140 (hub) ·
branch `fix/kb-26-research-sources-tenant-scope` · base `origin/main` @ `49b851d6`
· author: teammate `kb-26`, 2026-09-23 · size: **M** (one migration, three
server files, two UI files, pgTAP, one Playwright spec)

**Status: PLAN. Awaiting owner approval. Decisions D1–D5 in §31 are open.**

---

## 1. Start With the User

**Who.** A creator working in a studio project (`/home/<team>/studio/<project>/research`).
They open **Upload Source**, paste text (or a file or URL), give it a name, and
the platform stores the text and extracts facts into the project's Facts Library.
What they upload is often unpublished: interview notes, drafts, paid research.

**The problem today.** The text is stored in a table that every signed-in user
of every account can read. Anyone with a login can list every upload, with its
full content, through the public Data API (`/rest/v1/external_content`). The
upload's name and URL also show up in *every* account's Research Hub. If two
accounts upload a source with the same name, they share one record, and the
second upload overwrites the first one's URL. An upload named like a built-in
source ("Reuters") rewrites that built-in source for everybody.

**What the user gets after the fix.**

- Upload text is visible only to people who can open the project it was
  uploaded into: members of that team account, or the owner of the personal
  account. Nobody else can see it through the app or the Data API.
- The Research Hub for a project lists the shared built-in sources plus **this
  project's** uploads. It no longer shows other accounts' or other projects' uploads.
- Two projects, in the same or different accounts, can each have a source called
  "Notes" without touching each other's. An upload called "Reuters" creates a
  project-local "Reuters" and leaves the built-in one alone.
- The sidebar's Research badge starts counting the project's uploads. Today that
  half of the count errors silently (§8).
- If D3 is accepted, only a super admin can add, edit or remove the shared
  built-in sources. A project member can remove their project's own uploads.
  Controls the viewer cannot use are not shown.

**Success.** An upload succeeds with the same dialog, steps and toasts as today.
Afterwards a user of another account can read nothing of it: no rows, no names.
**Failure** (e.g. the project isn't visible to the caller) shows a readable
message in the dialog. Nothing is written.

**What persists.** The uploaded text and its source entry are kept, tied to the
project, until the project or account is deleted (cascade). They are also
removed when a member removes the source. The source is deactivated
(`is_active = false`) and its content stays tied to the project. That is today's
soft-delete behaviour, unchanged. **What does not persist:** nothing
user-visible changes on refresh; the dialog's in-progress state is local as today.

**Existing uploads** (made before the fix) have no recorded owner, so the system
cannot tell whose they are. Under the recommended D2 they are kept but hidden
from everyone, and the owner can reattach them to a project with a runbook step
(§25).

## 2. Define the Complete User Journey

| # | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| 1 | Opens `/research` in project P | RSC resolves P (RLS); client loads sources (global + P's) and counts | Hub with sources list and stats | Upload / Add / Remove / Refresh |
| 2 | Clicks **Upload Source** | Dialog opens (client state only) | Paste / URL / File tabs, name, category | Fill in |
| 3 | Submits | `uploadSourceContentAction({projectId: P, …})`: checks P is visible to caller; upserts source keyed `(P, slug)`; inserts content with `project_id = P, is_upload = true` | Progress "Uploading…" | automatic |
| 4 | — | `extractFactsFromContentAction` (unchanged) | "Extracting…", then "Complete" + toast | Dialog closes, hub reloads |
| 5 | Sees list | List shows the new upload under P | New source row, with a remove control | Remove / upload again |
| 6 | Uploads again with the same name in P | Upsert hits `(P, slug)`: same source row, URL/category updated; a second content row | One source row (not two), toast | — |
| 7 | Removes own upload | `deleteExternalSourceAction`: row belongs to P, caller can see P → deactivate | Row disappears, "Source removed" | — |
| 8 | Refresh / navigate away / return | Server state re-read | Same list; nothing lost | — |
| 9 | Closes dialog mid-way | Client state reset (existing `resetForm`) | Nothing written if step 3 not reached; if 3 done and 4 not, content is stored without facts (unchanged behaviour) | — |
| 10 | Session expires | `enhanceAction({auth:true})` redirects to sign-in (unchanged) | Sign-in page | Re-enter |
| 11 | User of another account opens their own hub | RLS hides P's rows | P's uploads absent | — |

Preconditions: signed in; can see P (`projects_read`). Entry: studio sidebar →
Research. Exit: any navigation.

## 3. Explicitly Define the Happy Path

Alice is a member of team **Alice Co**, which has project **Doc**.

1. Alice opens Doc → Research. The server reads `projects` with her client, so RLS
   decides whether Doc is visible. The client calls
   `listExternalSourcesAction({ projectId: Doc })`, which returns active rows
   where `project_id is null or project_id = Doc`, filtered again by RLS. She sees
   the seeded global sources.
2. She clicks Upload Source, pastes 2,000 characters, names it "Interview notes",
   category research, and submits.
3. The action reads `projects.id = Doc` with her client and gets one row. It
   upserts `external_sources (project_id=Doc, slug='interview-notes',
   provider_type='manual', tier_3)` on conflict `(project_id, slug)`. It inserts
   `external_content (project_id=Doc, is_upload=true, external_id='manual-…',
   content=…)` and returns `{ ok: true, data: { sourceId, contentId } }`.
4. Extraction queues as today (>500 chars). The dialog shows Complete and closes,
   and the hub reloads with "Interview notes" in the list. The sidebar badge
   rises by 1 (`external_content` count for Doc).
5. Bob, who owns **Bob Co** only, calls
   `GET /rest/v1/external_content?title=eq.Interview notes` with his own JWT
   and gets `[]`. He gets the same from `external_sources?slug=eq.interview-notes`.

Success because: Alice's flow is unchanged and Bob can reach nothing. Measured
before-state for step 5 is in §8.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User sees | Recovery | Final state |
|---|---|---|---|---|
| `projectId` not visible to caller (other tenant, deleted, forged) | `ActionRefusal('Project not found or you do not have access to it')` returned as a value; **no write** | Dialog toast with that sentence | none needed | unchanged |
| Missing name/content | Client guard (existing) + zod | "Name and content are required" | fix input | unchanged |
| Same name twice in same project | Upsert on `(project_id, slug)` updates URL/category; new content row | Success | — | 1 source, 2 contents |
| Same name in another project/account | Different key → new source | Success | — | independent rows |
| Name equal to a seeded slug ("Reuters") | Key `(P,'reuters')` ≠ `(NULL,'reuters')` → project-local row | Success; hub shows both "Reuters" rows (global + project) | — | global untouched |
| Source upsert/insert DB error | Thrown (KB-6 rule: unexpected failures stay thrown) and logged | Existing fallback toast "Failed to upload and extract facts" | retry | source may exist without content (unchanged) |
| Extraction fails after upload | Unchanged (not in scope) | Existing toast | retry | content stored |
| Concurrent same-name uploads in P | Unique `(project_id, slug)` + `ON CONFLICT` serialises; both succeed | Success ×2 | — | 1 source, 2 contents |
| Non-super-admin tries to add/edit/remove a **global** source (D3) | `ActionRefusal` returned | Button hidden; if called directly, toast with the refusal | — | unchanged |
| Member removes P's own upload | Allowed | "Source removed" | — | `is_active=false` |
| Project deleted | FK `on delete cascade` removes P's sources and content | — | — | gone |
| Legacy (pre-fix) upload | `is_upload = true, project_id null` → invisible to all `authenticated` | Not listed anywhere | Owner runbook (§25) | kept |
| Session expired | Existing `enhanceAction` redirect | Sign-in | sign in | unchanged |
| Large input | Unchanged: zod has no max on `content`; Next's body limit applies | as today | — | — |

## 5. Establish the User-Facing Contract

- **Inputs** (unchanged schema): `{ name 1..200, content ≥1, category, projectId uuid, sourceUrl? }`.
- **Output** changes from a bare object or a thrown error to
  `ActionResult<{ sourceId; contentId | null }>`, the `returnRefusals` shape
  (KB-6). The dialog calls `unwrap(...)` and shows
  `refusalMessage(error, 'Failed to upload and extract facts')`.
- **UI states:** unchanged (idle → uploading → extracting → complete). The hub
  shows only sources the viewer may see. The remove control shows only on rows
  the viewer may manage. **Add Source** shows only to super admins (D3).
- **Visibility rule (the contract this ticket exists for):** an uploaded source
  and its text are visible exactly to the users who can see its project under
  `projects_read`, and to nobody else, through any path (server action, Data
  API, sidebar count).
- **Error text:** refusal sentences above; unexpected errors keep today's toasts.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Why | Verification |
|---|---|---|---|
| FR-1 | An uploaded content row is readable (SELECT as `authenticated`) iff the caller can read its project | the leak | pgTAP T1–T3; E2E (Bob's JWT) |
| FR-2 | Shared cache rows (`is_upload = false`, no project) stay readable by every authenticated user | news/research search must keep working | pgTAP T4 |
| FR-3 | An upload row with no project (legacy, or a future bug) is readable by nobody as `authenticated` (fail closed) | legacy has no owner | pgTAP T5 |
| FR-4 | A row with `project_id` set must have `is_upload = true` (CHECK) | an owned row can never be mistaken for shared | pgTAP T6 |
| FR-5 | Upload sources are keyed `(project_id, slug)`; globals stay unique by slug among `project_id is null` | same-name overwrite; "Reuters" rewrite | pgTAP T7–T9; E2E |
| FR-6 | Project-scoped `external_sources` rows are visible iff the caller can read the project | names leak | pgTAP T10–T11 |
| FR-7 | `uploadSourceContentAction` refuses (as a value) when `projectId` is not visible to the caller, before any write | today it ignores `projectId` entirely (`source-upload-actions.ts:16-22` vs `:44-117`) | Vitest (no admin call on refusal); E2E |
| FR-8 | The upload writes `project_id` on both rows and `is_upload = true` | ownership | E2E reads rows back |
| FR-9 | The hub lists global + current project's sources only; counts likewise | project isolation within one user's accounts | E2E |
| FR-10 (D3) | Global registry rows: add/update/deactivate only by `is_super_admin()`; project rows: by anyone who can read the project | `requireAccountOwner` accepts an owner of *any* account (`external-context-actions.ts:215-236`) | Vitest + E2E refusal (prod build) |
| FR-11 | The context aggregator loads only global sources (`project_id is null`) | it is a process-wide singleton built from one caller's RLS view (`context-aggregator.ts:95-100`, `:376-381`) and must not carry one project's rows into another's request | Vitest on the query |
| FR-12 | Every `using (true)` policy granted to `authenticated` is listed with a decision | KB acceptance #3 | table in FILM-CC-04 (§19) |

## 7. Define Non-Functional Requirements

- **Security / privacy:** tenant isolation enforced in Postgres (RLS), not only in the action. The service-role paths are the only writers and are covered by FR-7/FR-10.
- **Performance:** cache search (`searchCache`) latency must not regress measurably. The new policy short-circuits on `not is_upload` for shared rows, so only upload rows pay one PK lookup on `projects`. That path is not searchable anyway (§12). Target: `EXPLAIN ANALYZE` of the search query within ±10% on a 10k-row local cache (§20).
- **Compatibility:** no API route changes; one server action's return shape changes (its only caller is updated in the same PR).
- **Durability:** no data deleted by the migration (D2 default).
- **Accessibility:** hidden controls are removed from the DOM, not just visually hidden. No new focusable elements.
- **Observability:** refusals are expected outcomes and are not logged (`returnRefusals` does not log). Unexpected errors keep today's throw → `onRequestError`.
- **Cost:** none.

## 8. Analyze the Existing System

**Tables** (`20260211200000_create_external_context_tables.sql`):
`external_sources` (global registry, `slug UNIQUE`, `:14`) and
`external_content` (cache, `external_id UNIQUE`, no owner column). Policies:
sources `SELECT to authenticated using (is_active = true)` (`:137-140`);
content `SELECT to authenticated using (true)` (`:150-153`); service role ALL.
No `schemas/` file exists for either table (checked), so there is nothing to mirror.

**Writers:**
- `uploadSourceContentAction` (`packages/features/episodes/src/server/source-upload-actions.ts:44-123`):
  auth check = "owner of **any** account" (`:56-64`). Its `projectId` input is
  validated but never used. It upserts the source `onConflict: 'slug'` (`:76-90`)
  and inserts content with no owner (`:100-111`), both via the admin client.
- `ExternalContextAggregator.cacheContent` (`context-aggregator.ts:302-350`):
  provider results, admin client, `external_id` prefixes `newsapi:`, `ss:`,
  `archive:`. **Only the upload action produces `manual-…` ids** (grep:
  one hit, `source-upload-actions.ts:99`).
- `add/update/deleteExternalSourceAction` (`external-context-actions.ts:243`, `:288`, `:326`):
  admin-client writes behind `requireAccountOwner` (`:215-236`). Its comment
  claims to follow "the same pattern as account_oauth_apps RLS policies". That
  is false: those policies bind the owner check to the **row's** `account_id`
  (`20260102221811_add_account_oauth_apps.sql:37-41`), and this function drops it.

**Readers:** `getExternalContentByIdAction` (user client; **no app caller**),
`searchCache` (user client; filters `cache_expires_at > now()`, and uploads have a
null `cache_expires_at`, so uploads never appear in search), `listExternalSourcesAction`
and `getResearchCountsAction` (user client, no project filter), the studio
layout count (`apps/web/app/home/[account]/studio/[projectSlug]/layout.tsx:81-84`,
which filters `project_id`, a column that does not exist), and the aggregator's
`initialize` (user client, cached process-wide). No Lambda or websocket code
reads either table. The grep returned nothing, and a positive control found
`verified_facts` in `apps/web/lambda`.

**Auth primitives:** `projects_read` (`20251016143639_projects.sql:303-315`) =
personal primary owner **or** `has_role_on_account`. Personal accounts have **no**
membership rows: `add_current_user_to_new_account` fires only `when
(new.is_personal_account = false)` (`20221215192558_schema.sql:534-536`). So
`has_role_on_account` alone would lock personal-account owners out of their
own uploads. The new policies therefore go through `projects`, not through
memberships. `is_super_admin()` requires an `aal2` session
(`20250302043537_mfa-rls-super-admin.sql:28-46`).

**Reproduced 2026-09-23T02:13Z** on a fresh `db reset` of this branch, under the
DB lock. Two real users created through GoTrue, each signed in for a JWT, each
creating their own team via `create_team_account`. Writes made exactly as the
action makes them: service role, same payloads, same `on_conflict=slug`. Script:
`$SP/kb26/repro.sh`, output: `$SP/kb26/repro.out`.

| # | Probe | Result |
|---|---|---|
| 1 | Bob (memberships: `bob-co:owner` only) `GET /rest/v1/external_content?external_id=eq.<alice's>&select=title,content,url` | **1 row**: `Alice Private Notes`, `CONFIDENTIAL draft text by Alice`, `https://alice.example/notes` |
| 1b | Bob `GET external_sources?slug=eq.alice-private-notes` | **1 row**, Alice's name and URL |
| 2 | Bob uploads the same name | one source row, `website_url` now `https://bob.example/other`, **2** content rows under it |
| 3 | Upload named "Reuters" | `reuters` row: `newsapi / tier_1 / https://reuters.com` → **`manual / tier_3 / https://attacker.example`** |
| 4 | Sidebar count query as Alice (`project_id=eq.<doc>`) | **HTTP 400** `42703 column external_content.project_id does not exist` |
| 5 | `pg_policies`, `authenticated`, qual or check literally `true` | `config`, `external_content`, `role_permissions`, `roles` (see §19) |

Test rows cleaned up afterwards. The Reuters row was restored, the lock held
30 s, then released.

## 9. Define the Desired System Behavior

| User action | Application logic | Data operation | Result |
|---|---|---|---|
| Open hub | `listExternalSourcesAction({projectId})` | `select … where is_active and (project_id is null or project_id = $P)` + RLS | global + P's uploads |
| Upload | refuse unless `projects` row visible to user client → admin writes with `project_id` | upsert `(project_id, slug)`; insert content `is_upload=true` | `{ok:true}` / `{ok:false,error}` |
| Remove source | load row with **user** client (RLS proves visibility); global → require `is_super_admin()`; project row → allowed | admin `update is_active=false where id=$id` | removed / refusal |
| Add source (D3) | require `is_super_admin()` | admin insert with `project_id null` | added / refusal |
| Any Data API read | RLS | policies in §14 | only permitted rows |

## 10. High-Level Architecture

No new components. The trust boundary is Postgres RLS on the two tables. The
server actions are a second line of defence, plus the only writers (service
role, which bypasses RLS, so the action checks must be right). Ownership is
the **project**, and access is delegated to `projects_read` through an
`exists (select 1 from public.projects …)` sub-select that runs under the
caller's own RLS. That gives one definition of "who can see a project" for
projects, uploads and upload-sources, including personal accounts.

Why project rather than account: the upload happens inside a project and its
facts land in that project's `verified_facts`. FILM-1140 asks for "all project
sources", and the sidebar already counts per project. That is Decision D1.

## 11. Architecture and Flow Diagrams

```
Upload (after)
browser ──uploadSourceContentAction(P)──▶ server action
   │                                         │ user client: select id from projects where id=P   (RLS: projects_read)
   │                                         ├─ none → return {ok:false, error}  (no writes)
   │                                         │ admin: upsert external_sources(project_id=P, slug) on conflict (project_id,slug)
   │                                         │ admin: insert external_content(project_id=P, is_upload=true, …)
   ◀────────────── {ok:true, data} ──────────┘

Read (any path: action, Data API, layout count)
authenticated ──select──▶ external_content
     RLS: (not is_upload)                                   → shared cache row: visible
       or (project_id is not null and exists(projects p where p.id = project_id))   ← projects_read applies
     else                                                   → invisible (incl. legacy uploads)
```

## 12. End-to-End Data Flow

Source: user paste/file/URL (URL fetched by `fetchUrlContentAction`, unchanged)
→ client trims → zod validates → the action checks project visibility → slug
derived from name (unchanged function) → **persist** source `(P, slug)` and
content `(P, is_upload)` → retrieval by hub list (sources), layout count
(content), `getExternalContentByIdAction` (no caller), **not** by search
(`cache_expires_at` null, `context-aggregator.ts:263`) → consumers: the same
project's members only.

- **Duplicated:** same-name re-upload in P → one source, N contents (intended; unchanged).
- **Lost:** none of the fix's steps delete data. Legacy uploads become hidden, not deleted (D2).
- **Partially processed:** source written, content insert fails → orphan source with no content (existing behaviour; not widened).
- **Retention/deletion:** cascades from `projects` (new FK). Soft-delete via `is_active`.

## 13. Data Model

- `external_sources`: a row is **global** (`project_id null`; registry, super-admin-managed under D3) or **project-owned** (an upload's source; lifecycle bound to the project).
- `external_content`: a row is a **shared cache entry** (`is_upload false`, `project_id null`) or an **upload** (`is_upload true`), either owned (`project_id` set) or legacy/orphaned (`project_id null` → invisible).
- Invariants: `project_id is not null ⇒ is_upload` (CHECK). Slug unique per `project_id`, with null treated as one scope (`NULLS NOT DISTINCT`).
- Authoritative: `projects` for who may see; `external_content.project_id` for which project owns it. No denormalized `account_id`, so there is nothing to drift.

## 14. Database Design and Changes

One hand-written migration, `apps/web/supabase/migrations/<UTC>_kb26_scope_research_uploads.sql`:

```sql
-- external_content: owner + upload marker
alter table public.external_content
  add column project_id uuid references public.projects(id) on delete cascade,
  add column is_upload boolean not null default false;

-- Legacy uploads: only uploadSourceContentAction writes 'manual-' ids
-- (providers use newsapi:/ss:/archive:). Marked, not deleted: unreadable until reattached.
update public.external_content set is_upload = true where external_id like 'manual-%';

alter table public.external_content
  add constraint external_content_owned_is_upload check (project_id is null or is_upload);
create index idx_external_content_project on public.external_content(project_id) where project_id is not null;

drop policy "Authenticated users can view content" on public.external_content;
create policy external_content_read on public.external_content for select to authenticated
  using (
    not is_upload
    or (project_id is not null
        and exists (select 1 from public.projects p where p.id = external_content.project_id))
  );

-- external_sources: project-owned upload sources
alter table public.external_sources
  add column project_id uuid references public.projects(id) on delete cascade;
alter table public.external_sources drop constraint external_sources_slug_key;
alter table public.external_sources
  add constraint external_sources_project_slug_key unique nulls not distinct (project_id, slug);

drop policy "Anyone can view active sources" on public.external_sources;
create policy external_sources_read on public.external_sources for select to authenticated
  using (
    is_active
    and (project_id is null
         or exists (select 1 from public.projects p where p.id = external_sources.project_id))
  );
```

- **Constraint name** `external_sources_slug_key` is Postgres's default for an inline `UNIQUE`. I will verify it against `pg_constraint` before writing it, not assume it.
- **`NULLS NOT DISTINCT`** needs PG15+. Local is PG 17 (`config.toml:22`). Production's major version must match. I will check the Supabase project setting, never its credentials, or ask the owner (§31 Q1).
- **Why no `NOT VALID`:** every existing row satisfies the CHECK (all have `project_id null`), so it validates immediately. ENGINEERING-WORKFLOW §3 warns that `not valid` defers the rule onto later UPDATEs.
- **Locking/duration:** `ADD COLUMN` with a constant default is metadata-only on PG11+. The `UPDATE` touches only `manual-%` rows. The CHECK scan and the partial index cover a small cache table. The unique-constraint swap takes a brief `ACCESS EXCLUSIVE` lock. Seconds at most.
- **Other writers of these columns** (ENGINEERING-WORKFLOW §3 "what else writes this column"): `cacheContent`'s upsert does not name `project_id`/`is_upload` → defaults (shared). The `updated_at` trigger does not touch them. FK cascades delete rather than update. The seed migration `20260211200003` uses `ON CONFLICT (slug)` (`:59`). It runs *before* this migration, so it is safe on reset and in production. Any **future** seed must use `ON CONFLICT (project_id, slug)`, and this migration's header comment will say so. No `seed.sql`/`seeds/*.sql` touches these tables (grep).
- **Types:** `pnpm supabase:web:typegen` (generated, never edited).
- **Rollback SQL** (kept in the PR description, not as a migration): recreate `using (true)` / `is_active = true`, restore `unique(slug)`, which fails if two project rows share a slug, the intended state after the fix. So rollback is a forward-fix in practice; see §25.

## 15. Low-Level Design

**`source-upload-actions.ts`**
```
uploadSourceContent(data):
  user client: select id from projects where id = data.projectId  (maybeSingle)
  if none → throw new ActionRefusal('Project not found or you do not have access to it')
  slug = slugify(name)                                    (unchanged)
  admin.upsert(external_sources {…, project_id: P}, onConflict 'project_id,slug')
  admin.insert(external_content {…, project_id: P, is_upload: true})
  errors → throw Error (unexpected: stays thrown, KB-6)
export uploadSourceContentAction = returnRefusals(enhanceAction(uploadSourceContent, {auth, schema}))
```
The "owner of any account" block (`:46-64`) is removed. Its replacement is the
project check, in the same function (ENGINEERING-WORKFLOW §3: name the
replacement in code).

**`external-context-actions.ts`** (D3)
- Delete `requireAccountOwner`. Add `requireSourceManager(client, source | 'new')`:
  - `'new'` or `source.project_id === null` → `rpc('is_super_admin')` must be `true`, else `ActionRefusal('Only a platform admin can change shared sources')`.
  - project row: it was loaded through the **user** client, so RLS already proved the caller can see the project → allowed.
- `update`/`delete`: load `{id, project_id}` with the user client (`maybeSingle`). A missing row → refusal "Source not found". Then the admin write keeps `.eq('id', id)`.
- `add`: `project_id` is always null (global); super admin only.
- `listExternalSourcesAction({ category?, activeOnly?, projectId? })`: when `projectId` is given, `.or('project_id.is.null,project_id.eq.<P>')`. It returns `project_id` so the client can tell owned rows from global ones. `getResearchCountsAction` gets the same filter.
- All three mutations are wrapped with `returnRefusals`. Their callers (`research-hub-page.tsx:123`, `add-source-dialog.tsx:76`) switch to `unwrap` + `refusalMessage`.

**`context-aggregator.ts`**: `initialize()` adds `.is('project_id', null)` (FR-11).

**UI**: `research/page.tsx` computes `canManageGlobalSources` with
`client.rpc('is_super_admin')` and passes it to `ResearchHubPage`. Add Source is
rendered only when it is true. The remove control renders when
`source.project_id !== null || canManageGlobalSources`. The upload dialog uses
`unwrap`. No new `useState`/`useEffect`. `data-test` attributes are added on the
list rows, remove buttons, Add/Upload buttons and the dialog submit.

## 16. API and Event Design

No routes or events. Server-action changes:

| Action | Input | Output before → after | Authz before → after |
|---|---|---|---|
| `uploadSourceContentAction` | unchanged | object / throw → `ActionResult` | owner of any account → can read `projectId` |
| `addExternalSourceAction` | unchanged | → `ActionResult` | owner of any account → super admin |
| `updateExternalSourceAction` | unchanged | → `ActionResult` | same → super admin (global) / project reader (owned) |
| `deleteExternalSourceAction` | unchanged | → `ActionResult` | same → as update |
| `listExternalSourcesAction` | `+ projectId?` | rows `+ project_id` | RLS (now scoped) |
| `getResearchCountsAction` | unchanged | unchanged shape | counts now scoped to global + P |

The Data API surface (`/rest/v1/external_content`, `external_sources`) changes
only in which rows RLS returns. `updateExternalSourceAction` has no caller
(FILM-1140). It is still guarded because it is exported.

## 17. State and Lifecycle Design

Source row: `active` → `inactive` (soft delete; terminal in the UI) → deleted
only by cascade. Content row: `shared` | `upload(owned)` | `upload(orphaned)`.
`orphaned → owned` only via the owner's runbook `UPDATE`. `owned → shared` is
impossible (CHECK). No other transitions.

## 18. Failure and Error Handling

| Operation | Failure | Behaviour | User sees | Recovery |
|---|---|---|---|---|
| upload | project not visible | refusal value, no write | refusal toast | — |
| upload | source upsert error | throw; logged by Next | fallback toast | retry |
| upload | content insert error | throw; source row may remain (existing) | fallback toast | retry (upsert reuses source) |
| remove/add/update | not permitted | refusal value | refusal toast | — |
| `is_super_admin` rpc error | treat as `false` (fail closed) | refusal | refusal toast | re-auth with MFA |
| migration | constraint name mismatch | migration aborts in its transaction; nothing applied | — | fix name, redeploy |
| deploy window (migration before code) | old code's `onConflict: 'slug'` has no matching constraint → 42P10 **before** its content insert | upload fails closed; no leaked row | fallback toast | resolves when code deploys |

## 19. Security

- **Tenant isolation:** enforced by RLS for all reads (FR-1, FR-6), including the Data API, which the app code cannot guard.
- **Service-role writers:** the upload and registry actions bypass RLS, so each verifies the caller's right with the **user** client before writing (FR-7, FR-10).
- **What the fix newly permits** (ENGINEERING-WORKFLOW "question 3"):
  1. A non-owner member of a team can now upload into that team's project. Today an owner of any account can upload anywhere, and a pure member cannot. This is guarded by project visibility, the same rule the paired `extractFactsFromContentAction` already uses (`source-upload-actions.ts:237-246`). See D4.
  2. A project member can deactivate that project's uploaded sources (new capability, scoped).
  3. Nothing is widened for global rows. They are narrowed to super admins.
- **Abuse:** slug squatting on seeded names is no longer possible (FR-5). The singleton aggregator cannot pick up project rows (FR-11).
- **`using (true)` inventory** (KB acceptance #3, measured in §8 probe 5; decisions go into FILM-CC-04 in the PR):

| Table | Policy | Holds account-scoped data? | Decision |
|---|---|---|---|
| `config` | public config can be read by authenticated users | no: one platform-wide billing/feature config row (makerkit) | keep, reason recorded |
| `roles` | roles_read | no: role names/hierarchy | keep |
| `role_permissions` | role_permissions_read | no: role→permission map | keep |
| `external_content` | Authenticated users can view content | **yes** (uploads) | replaced by this fix |

  Phase 2 extends the probe beyond the literal `true` to `TO public`/`anon`
  policies, to `storage.objects`, and to tautologies like `external_sources`'
  `is_active = true`, and records any hits beside the four above. Phase 1
  checked only the literal form. I will state that scope in the KB entry
  rather than imply more.
- **Recurrence of the `requireAccountOwner` shape** ("owner/member of *any* account", no row account):
  - `source-upload-actions.ts:56-64`: same shape inline. **Fixed here** (FR-7).
  - `external-context-actions.ts:215-236`: **fixed here if D3 is accepted**.
  - A related shape, "use the caller's *first* membership as the account", with no account in the input: `packages/features/episodes/src/server/story-actions.ts:74-95` (**KB-31's file**) and `packages/features/episodes/src/server/bulk-actions.ts:88-102`. Both attribute story-ideation jobs (and their cost tracking) to an arbitrary account of a multi-account user. That is attribution, not access. **Report only**, and I recommend a new KB (D5).
  - Every other `from('accounts_memberships')` in `apps/` and `packages/` (15 sites checked) filters by a specific `account_id`. In SQL, the `account_role = 'owner'` checks in `account_oauth_apps` are correlated with the row's `account_id`. The `WHERE user_id = auth.uid()` sub-selects I sampled are of the `account_id IN (…)` form. Correct.

## 20. Performance and Scale

Volume: the cache grows with provider searches (hundreds to thousands of rows).
Uploads number a few per project. Policy cost: `not is_upload` is true for
cache rows, so no sub-select runs. Upload rows run one PK probe on `projects`
plus `projects_read` (a `has_role_on_account` EXISTS on an indexed
membership). Search never returns uploads (`cache_expires_at` null). The layout
count uses the new partial index on `project_id`. Check: `EXPLAIN ANALYZE` of
`searchCache`'s query as `authenticated`, on ~10k seeded cache rows, before and
after, with numbers in the PR.

## 21. Accessibility and Client Behavior

No new UI. Controls the viewer cannot use are **not rendered** (no dead
buttons). Existing button labels and icons stay. The remove icon button gains an
`aria-label="Remove <name>"` as it is touched (today it is an unlabeled icon).
Refusal messages go through the existing sonner toasts, which are announced by
the toaster region. Responsive behaviour is unchanged.

## 22. Observability and Operations

Refusals are expected outcomes and are not logged, per KB-6 convention.
Unexpected errors keep throwing to `onRequestError`/monitoring. **Operator
checks** after deploy (owner, one-person runbook, own session, no production
credentials in any tool I run):
- `select count(*) from external_content where is_upload and project_id is null` gives legacy uploads awaiting reattachment. It should fall to 0 once the runbook is done, or stay if he chooses to leave them.
- As a second test user: `GET /rest/v1/external_content?is_upload=eq.true` returns `[]`.

## 23. Configuration and Feature Flags

None. A flag cannot gate an RLS policy meaningfully, and the fix must be
unconditional. There is no new env.

## 24. Compatibility

- Old clients calling the upload action get `ActionResult` instead of a bare object. The only caller changes in the same PR, and server and client deploy together (Next bundle).
- **Deploy ordering:** migration then code (the repo's normal order). Between the two, old code's upload fails closed (§18). Old code reading sources still works (`slug` still exists and the policy only narrows).
- Existing records: cache rows are unaffected. Legacy uploads are hidden (D2). Legacy upload-created **source** rows stay global (project null) and visible by name, because they cannot be attributed (they are indistinguishable from Add-Source rows). The runbook covers them.
- `database.types.ts` gains columns. Every consumer derives types (`types/external-context.ts:170-176`).

## 25. Migration and Rollout Strategy

1. Merge. CI's Supabase job applies all migrations and runs pgTAP.
2. Deploy: migration, then app.
3. **Owner runbook** (manual, in the owner's own Supabase SQL editor; I never touch production):
   - List hidden legacy uploads: `select id, title, url, fetched_at from external_content where is_upload and project_id is null order by fetched_at;`
   - Reattach the ones he wants: `update external_content set project_id = '<project uuid>' where id in (…);` and, for their sources, `update external_sources set project_id = '<project uuid>' where id in (…);`. If that project already has a source with the same slug, the unique key rejects it: rename first.
   - Check seeded sources rewritten by an upload: `select slug, provider_type, credibility_tier, website_url from external_sources where project_id is null and slug in ('reuters','ap-news',…) and provider_type = 'manual';`. Restore any hit from `20260211200003_seed_news_sources.sql`. The full slug list goes in the PR.
4. **Rollback trigger:** uploads or search broken for the owner. **Procedure:** revert the app. The migration stays (it only narrows reads). Reverting the migration would re-open the leak, so it is a last resort and the SQL is in the PR description.

## 26. Testing Strategy

| Layer | File | Covers | Red-before-green |
|---|---|---|---|
| pgTAP | `apps/web/supabase/tests/database/research-uploads-rls.test.sql` (fixed `plan(n)`) | T1 outsider cannot see upload content; T2 team member can; T3 personal-account owner can see an upload in their personal project; T4 shared cache row visible to outsider and member; T5 orphaned upload invisible to all; T6 CHECK rejects `project_id` with `is_upload=false`; T7 two projects, same slug, both insert; T8 same project, same slug conflicts; T9 two globals with the same slug conflict; T10/T11 project source invisible to outsider, visible to member | Apply the columns/constraints but keep the two old policies → T1 and T10 fail ("outsider sees 1 row"). Restore → green. Also T7 fails against the old `unique(slug)`. Foreign ids are stashed via `set_config` as `postgres` (trap noted in `revenue-records-rls.test.sql`). |
| Vitest | `packages/features/episodes/src/server/__tests__/source-upload-actions.test.ts` | FR-7: invisible project → `{ok:false}` and **zero** admin-client calls; FR-8 payload has `project_id`, `is_upload`; FR-10 refusal matrix; FR-11 aggregator query has `.is('project_id', null)` | revert each guard, watch it fail |
| Playwright | `apps/e2e/tests/research/research-sources.spec.ts` (seeded via `seedUser`/`seedTeamAccount`/`seedProject`, `signInAs`) | A uploads through the dialog, row listed; **second submission** same name → still one row; B's hub lacks it; B's JWT Data API read returns `[]`; B uploads same name → A's URL unchanged (`readRows`); non-super-admin sees no Add Source and no remove on global rows but does on own upload; remove own upload | run on unfixed code → fails at B's read (1 row) |
| Evidence | same spec behind `CAPTURE_EVIDENCE=1` | screenshots: A's hub after upload, B's hub, dialog after second submission | — |
| Typecheck/lint/format | `pnpm typecheck`, `lint:fix`, `format:fix` | — | — |

## 27. Production-Build Verification

The refusal text must survive a production build (KB-6). Run the Playwright spec
once against `next build && next start -p 3101` (heavy slot). Assert the refusal
toast text verbatim for the non-super-admin "remove global source" path, which
is driven by calling the action from the page context, since the button is
hidden. Confirm the upload happy path in the same build.

## 28. Requirement Traceability

| Outcome | Flow | Req | Design | Component | Data/API | Test | Prod verification |
|---|---|---|---|---|---|---|---|
| uploads private | §2.3, §2.11 | FR-1, FR-6 | §14 policies | RLS | `external_content`, `external_sources` | pgTAP T1–T3, T10–T11; E2E B-read | §22 second-user probe |
| shared cache intact | search | FR-2 | `not is_upload` branch | RLS | `external_content` | pgTAP T4 | owner runs a search |
| legacy fail closed | — | FR-3 | backfill + policy | migration | `is_upload` | pgTAP T5 | §22 count |
| owned ⇒ upload | — | FR-4 | CHECK | migration | — | pgTAP T6 | — |
| no name collisions | §2.6 | FR-5 | unique `(project_id, slug)` | migration + action | upsert | pgTAP T7–T9; E2E | runbook seeded-slug check |
| action refuses foreign project | §4 | FR-7 | §15 | upload action | `ActionResult` | Vitest; prod build | — |
| ownership written | §3 | FR-8 | §15 | upload action | columns | E2E `readRows` | — |
| hub per project | §2.1 | FR-9 | list filter | list/counts actions | `projectId` param | E2E | owner opens hub |
| registry protected | §4 | FR-10 | `requireSourceManager` | registry actions, page | `is_super_admin` | Vitest; E2E; prod build | — |
| singleton can't leak | — | FR-11 | filter | aggregator | query | Vitest | — |
| class listed | — | FR-12 | §19 table | FILM-CC-04 | — | probe query in PR | — |

## 29. Architectural Alternatives and Trade-offs

| Decision | Chosen | Alternative | Why not |
|---|---|---|---|
| Owner key | `project_id`, access via `projects_read` | `account_id` + `has_role_on_account` | misses personal accounts (no memberships, §8); needs a second column kept in sync; hub is per project |
| Owner key | same | denormalized `account_id` set by trigger | extra trigger and column; same visibility result |
| Where uploads live | columns on `external_content` | new `research_uploads` table | cleaner separation, but duplicates the FK to sources, moves the layout count, and doubles the migration for no security gain. Revisit if uploads gain their own features. |
| Private marker | `is_upload` boolean + CHECK | infer from `external_id like 'manual-%'` in the policy | a string convention in a security policy; fails silently if a writer changes its prefix |
| Legacy rows | hide (D2) | delete | the owner's retention stance is keep-until-asked (KB-20) |
| Legacy rows | hide | heuristic attribution via `verified_facts.source_citation` | guesses about production data inside a migration nobody can preview |
| Global-registry writes | super admin only (D3) | project-scoped "Add Source" for everyone | needs a per-caller aggregator, since today it is a process singleton; out of scope |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| Owner is not a super admin with MFA in prod | loses Add Source / removing global sources (D3) | owner answers Q2 | ask before merging | pick D3-alt (split to new KB) |
| Prod PG < 15 | `NULLS NOT DISTINCT` fails, migration aborts | Q1 | verify version | two partial unique indexes plus insert-or-select instead of upsert |
| Constraint name differs | migration aborts (transactional) | local `db reset` + CI | read `pg_constraint` first | — |
| Policy sub-select cost | slower search | §20 EXPLAIN | short-circuit branch | index / security-definer helper |
| Hidden legacy uploads confuse the owner | "my old sources vanished" | runbook step | note in PR body and runbook | reattach SQL |
| Merge conflicts in `database.types.ts` with KB-27/28/18 | red CI | rebase | regenerate, never hand-merge | — |
| Hub starts listing per-project uploads plus globals: two "Reuters" rows possible | mild confusion | E2E screenshot | owned rows get a small "Uploaded" badge (existing `Badge`) | — |

## 31. Open Questions and Assumptions

| # | Question | Why it matters | Default / assumption | Needed from |
|---|---|---|---|---|
| D1 | Scope uploads to the **project** or the **account**? | who sees what; hub contents | **project** (§10, §29) | owner |
| D2 | Legacy ownerless uploads: hide, delete, or leave readable? | data retention vs exposure | **hide + runbook to reattach** | owner |
| D3 | Fix the registry writes (`requireAccountOwner`) in this PR, as super-admin-only for global rows, project members for their uploads, and hidden controls? | same tables and same class; the KB lists it as effect 3 | **yes, include** | owner |
| D4 | Who may upload: anyone who can see the project, or only owners/admins of its account? | today: owner of *any* account | **anyone who can see the project** (matches the paired extract step) | owner |
| D5 | File the "first membership as account" shape (`story-actions.ts:74-95`, KB-31's file; `bulk-actions.ts:88-102`) as a new KB rather than fix it here? | cost attribution to the wrong account | **new KB, not fixed here** | owner/lead |
| Q1 | Production Postgres major version ≥ 15? | `NULLS NOT DISTINCT` | assumed 17 like local | owner (dashboard glance) |
| Q2 | Is the owner's production user a super admin (with MFA)? | D3 effect on him | unknown | owner |
| A1 | No Lambda/websocket reads these tables | policy change blast radius | verified by grep + positive control | — |
| A2 | `getExternalContentByIdAction` has no caller | no UI regresses | verified by grep | — |
| A3 | The FILM-1140 sidebar-count criterion starts working as a side effect | spec bookkeeping | **report only, not flipped here** (outside my ticket) | lead |

## 32. Implementation Plan

1. **pgTAP first** (DB lock): write `research-uploads-rls.test.sql`. Write the migration *without* the policy swap and watch T1/T10/T7 fail. Add the policy swap and watch them pass. Typegen.
2. **Upload action** + Vitest (refusal → no admin calls; payload). Red → green.
3. **Registry actions** (D3) + aggregator filter + list/count scoping + Vitest.
4. **UI:** `page.tsx` (`canManageGlobalSources`), hub (conditional controls, `unwrap`, `data-test`, aria-label, "Uploaded" badge), dialogs (`unwrap` + `refusalMessage`).
5. **Playwright spec** on port 3101 (DB lock + heavy slot): red on stashed-as-WIP-commit unfixed code, then green. Evidence screenshots.
6. **Production build** run of the spec (§27).
7. `EXPLAIN ANALYZE` numbers (§20). Extended `using(true)` probe (§19).
8. Records: KB-26 → **Fixed (#PR)** with the class table, plus one *Fixed* row. FILM-1135: flip the RLS criterion to met with evidence and drop that `remaining:` item. The spec stays PARTIAL because the other gap is not mine. Update `specs/INDEX.md` only if a status changes (it will not).
9. typecheck, lint:fix, format:fix, push, PR with the runbook (§25) and rollback SQL.

Rollback per stage: stages 2–4 revert cleanly. Stage 1's migration is forward-only in practice (§25).

## 33. Definition of Done

- [ ] pgTAP T1–T11 green, and seen red on the unfixed policy
- [ ] Two accounts uploading the same name get two sources (pgTAP T7 + E2E)
- [ ] A second real user reads `[]` for another account's upload via the Data API (E2E), and read 1 row before the fix
- [ ] Refusals are returned as values and their text is verified in a production build
- [ ] Every `using (true)` policy to `authenticated` is listed with a decision in FILM-CC-04
- [ ] Recurrences of the `requireAccountOwner` shape are reported (§19), and D5 is filed if approved
- [ ] Screenshots of the hub after upload (A), B's hub, and the dialog after a second submission are in the PR
- [ ] typecheck / lint / format clean; types generated
- [ ] Runbook and rollback SQL are in the PR body
- [ ] FILM-1135's RLS criterion is flipped with evidence

## 34. Final Consistency Pass

**Forward.** Creators need uploads private (§1). They upload in a project and
expect only that project's people to see the result (§2–3). So the system must
tie each upload to its project and let RLS decide visibility from
`projects_read` (FR-1, FR-6). That needs `project_id` on both tables, an
`is_upload` marker so ownerless uploads fail closed, and a per-project slug key
(§14). The action refuses before writing (§15). pgTAP, Vitest and Playwright
prove each part, including as a second real user (§26), and the owner verifies
in production with his own session (§22, §25).

**Reverse.** After deploy, production will: store uploads with `project_id` and
`is_upload = true`; return them only to project readers; return shared cache
rows to everyone; hide legacy uploads; and key upload sources per project. The
hub shows global plus own-project sources and hides controls the viewer cannot
use. So Alice's flow is unchanged, Bob sees nothing of hers, and same-name
uploads don't collide. That is the user outcome in §1. The paths converge.

**Residual gaps, stated rather than hidden:** legacy upload-created *source
names* stay globally visible until the owner reattaches them (§24). This
depends on D2/D3 and on Q1/Q2.
