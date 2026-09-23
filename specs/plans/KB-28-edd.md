# KB-28 — Engineering Design Document

**Ticket:** KB-28, "Any signed-in user can upload into any project's storage folder" (`specs/cross-cutting/FILM-CC-04-known-bugs.md`, `## KB-28`). Related: FILM-203 (RETIRED), FILM-CC-01, FILM-207.
**Branch:** `fix/kb-28-project-assets-insert-scope` off `origin/main` @ `49b851d6`.
**Size:** S–M. One migration, one route rewrite, orphan deletions, a pgTAP file, a Vitest file and a Playwright spec.
**Status:** Phase 1 (plan). Nothing is implemented yet.

---

## 0. What the reproduction showed (2026-09-23, local stack, two real GoTrue users)

The run used a `db reset` from this worktree under the shared DB lock. User **A** owns a private project `<priv>` (with an episode `<ep>`) and a public project `<pub>`. User **B** is a separate signed-in user with no role on either. B used only what an attacker has: the public anon key, B's own JWT, and the public Storage, PostgREST and app APIs. Scripts: `$SP/kb28/repro.mjs`, `$SP/kb28/repro-cover.mjs`. Raw output: `$SP/kb28/repro2.out`.

| # | Action | Result today |
|---|---|---|
| P1–P3 | B reads `<priv>` / reads `<pub>` / `has_role_on_project(<priv>)` | 0 rows / 1 row / `false` (the preconditions hold) |
| I1 | B `POST /storage/v1/object/project-assets/<priv>/audit-probe/planted.png` | **200, planted** |
| I2 | B → `projects/<priv>/assets/character/planted.png` (the shape the app writes) | **200, planted** |
| I3 | B → `episodes/<ep>/thumbnails/planted.png` | **200, planted** |
| I4 | B → `<pub>/audit-probe/planted.png` | **200, planted** |
| I5 | B signs an upload URL (`/object/upload/sign/…`) for `projects/<priv>/…`, then PUTs to it | **sign 200, put 200, planted** |
| I6 | B uploads `text/html` `<script>` into `projects/<priv>/…` | **200, planted** (public bucket, no MIME list) |
| S1 | B → app `POST /api/storage/presign` for **A's public project**, then PUT | **presign 200, put 200, planted** |
| S2 | B → presign for A's private project | 403 (the route checks read access, but I1–I5 bypass it) |
| U1–U2 | B overwrites A's objects (upsert) | refused (403) ✔ |
| D1 | B deletes A's objects | 0 removed, objects intact ✔ |
| **U3** | **A (owner) overwrites own `projects/<priv>/…` object** | **refused (403): a second bug** |
| **D2** | **A (owner) deletes own `projects/<priv>/…` object** | **200 with 0 removed, object still there. Fails silently** |
| D3 | A deletes own `<priv>/cover.png` (legacy shape) | deleted ✔ |
| R1–R2 | B, and anon, read a `project-assets` object | 200. The bucket is public by design |
| cover | B `rpc/update_project_cover_image(<priv>, 'https://attacker.example/x.png')` | **204; A's project metadata now holds the attacker URL** |

The bug is real and wider than written. Every write shape the app uses is open to any signed-in user, through the Storage API directly and through the app's own presign route. The same root cause also breaks owners: `project_assets_update` and `_delete` resolve the project from the first path segment, which is the literal `projects` or `episodes` for everything the app writes today. So owners cannot overwrite or delete their own files, and deletes fail silently.

---

## 1. Start With the User

**Who.** A creator (project owner, admin or member) who uploads images and video into their own project: covers, character and location references, shot frames and videos, episode thumbnails, and master assets. Second, every *other* creator on the platform, whose project folders are currently writable by strangers.

**Problem.** Any signed-in user can put files into another creator's project folder on a **public** bucket, with no size or type limit. That covers HTML/JS, huge files and look-alike assets. The files are served from the platform's storage domain under the victim's project path. Separately, any signed-in user can repoint any project's cover image to an arbitrary URL.

**After the fix:**
- A creator's project folder accepts files only from people with a working role on that project (owner, admin or member).
- A signed-in stranger who tries gets a refusal. The attempt changes no file and adds none.
- Owners can replace and delete their own files. Today they silently cannot, for every path the app writes.
- Only the image, video and audio types the product accepts, up to the product's size ceiling, are stored. The bucket itself enforces this, not only the browser.
- Only people who can edit a project can change its cover image.

**What they see.** For legitimate users nothing changes on the happy path: the upload runs, shows progress, and the image or video appears. A stranger calling the APIs directly gets an HTTP refusal. There is no UI for that case, because the UI never offers another project's upload control. A legitimate user who picks a type the bucket now refuses (e.g. an SVG or HEIC as a master asset) sees the component's existing upload-failed message instead of a stored file.

**Persists:** uploaded objects, and the cover URL in `projects.metadata`. **Does not persist:** refused uploads. No partial object is written, because the RLS check runs before the object row exists.

## 2. Define the Complete User Journey

| Stage | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| Entry | Opens project settings, visual studio, publish screen or asset editor in *their* project | Page loads (RSC) | Upload controls visible | Pick a file |
| Pick | Chooses a file | Client checks it (existing per-component size/type checks) | Preview / progress | Upload proceeds |
| Presign | — | `POST /api/storage/presign {bucket, path, contentType}` → route checks bucket, path shape, type, **write role** → signed URL | Progress continues | — |
| Upload | — | Browser PUTs to the signed URL → storage checks bucket MIME/size limits (the signed URL carries the RLS decision made at signing) | Progress reaches 100% | — |
| Record | — | Component's server action saves the URL (e.g. `updateProjectCoverImage`, `uploadEpisodeThumbnailAction`) | Success toast; image shown | Leave or replace |
| Replace | Uploads again | New timestamped object (insert), or upsert on the same name (update policy) | New image shown | — |
| Refresh / re-entry | Reloads | URL read from DB | Same image | — |
| Session expired | Uploads | Presign returns 401 | Component's existing error text | Sign in again |
| Stranger | Calls presign / Storage API for someone else's project | 403 from the route; RLS 403 from storage | Refusal; nothing stored | — |
| Cancel / navigate away mid-PUT | — | Signed URL unused or PUT aborted; no object row | Nothing saved | — |

## 3. Explicitly Define the Happy Path

Canonical path: **owner uploads a project cover** (`project-cover-settings.tsx:43-88`). This is the path the Playwright spec drives.

1. The owner picks `cover.png` (image/png, under 5 MB). The component checks `image/*` and 5 MB (`:48-57`).
2. `uploadProjectCover` (`packages/features/storage/src/client/presigned-upload.ts:109-118`) posts `{bucket:'project-assets', path:'projects/<P>/assets/covers/cover-<ts>.png', contentType:'image/png'}` to `/api/storage/presign`.
3. The route authenticates, checks `bucket === 'project-assets'`, matches the path pattern, checks `contentType` against the shared allowlist, and calls `rpc('can_write_project_storage', {path})`. That resolves `P` and finds A in `project_members` as `owner` → `true`.
4. The Supabase adapter calls `createSignedUploadUrl` **with the user's client**. Storage evaluates `project_assets_insert` → `can_write_project_storage(name)` → `true` and signs.
5. The browser PUTs the bytes. Storage checks the bucket's `allowed_mime_types` and `file_size_limit`, then writes the `storage.objects` row and the file.
6. `updateProjectCoverImage(P, url)` → `update_project_cover_image`, which now checks `can_edit_project(P)` → `true` → metadata updated.
7. The toast says "Cover image updated successfully" and the `<img>` shows the storage URL. **Success:** the object exists at the path, the metadata holds its URL, and the page renders it.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| Non-member presigns for a public project (S1) | `can_write_project_storage` → false → **403** | Client error text | None needed | Nothing stored |
| Non-member uses the Storage API directly (I1–I6) | RLS `WITH CHECK` false → storage **403** | — | — | Nothing stored |
| Project `viewer` uploads | Same as non-member (viewer is excluded from write) | Error text | Owner upgrades the role | Nothing stored |
| Path whose project cannot be resolved (`foo/x.png`, `projects/not-uuid/x`, unknown episode) | Resolver → null → false → 403 | Error text | — | Nothing stored |
| `episodes/<E>/…` where E belongs to someone else's project | Resolves to E's project → caller not a member → 403 | — | — | Nothing stored |
| Bucket other than `project-assets` in the presign body | **400** "bucket not allowed" | Error text | — | — |
| Disallowed type (e.g. `text/html`, `image/svg+xml`) | Route **400**; storage also refuses (`allowed_mime_types`) if the route is bypassed | Error text | Pick a supported file | Nothing stored |
| File over 500 MB | Storage refuses at PUT (`file_size_limit`) | Component's upload-failed message | Smaller file | Nothing stored |
| Owner re-uploads the same name with upsert | Update policy now resolves the project → allowed (U3 flips from 403 to 200) | Works | — | Replaced |
| Owner deletes own `projects/…` object | Delete policy now resolves → object removed (D2 flips from a silent no-op to a real delete) | — | — | Deleted |
| Stranger calls `update_project_cover_image` | Function raises `42501` → action returns a refusal | "You can't change this project's cover." | — | Metadata unchanged |
| Session expired | 401 | Existing message | Re-auth | — |
| Storage unavailable | Presign 500 / PUT fails | Existing upload-failed message | Retry | Nothing stored |
| Membership revoked between presign and PUT | Signed URL remains valid until expiry (Supabase: 2 h; a storage property) | Upload succeeds once | Accepted; see Risk R5 | One object |

## 5. Establish the User-Facing Contract

- **Inputs:** `POST /api/storage/presign {bucket:'project-assets', path, contentType, expiresIn?}`.
- **Outputs:** `200 {uploadUrl, publicUrl, expiresIn}` · `400 {error}` (fields missing, bucket not allowed, path format invalid, content type not allowed) · `401` · `403 {error:'You do not have permission to upload to this project'}` · `500` / `501` unchanged.
- **Permissions:** write = `project_members.role ∈ {owner, admin, member}` on the resolved project. Read is unchanged (public bucket). Cover-URL change = `can_edit_project` (owner/admin), the same rule as `projects_update`.
- **UI states:** unchanged. Components already render a loading state, a success toast and an error toast/message.
- **Messages:** refusals are JSON from a route handler, so a production build does not redact them. The cover refusal travels through a server action and is **returned as a value** (KB-6), with the text "You can't change this project's cover."

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Trigger → processing → result | Verification |
|---|---|---|---|
| FR-1 | Insert into `project-assets` only if the caller has owner/admin/member on the resolved project | `storage.objects` INSERT → `can_write_project_storage(name)` | pgTAP (red first); repro I1–I6 refused |
| FR-2 | The project is resolved from all three live path shapes: `<uuid>/…`, `projects/<uuid>/…`, `episodes/<uuid>/…` (via `episodes.project_id`); anything else resolves to null and is denied | SQL resolver | pgTAP per shape, plus unresolvable cases |
| FR-3 | Update and delete use the same predicate, so owners can replace and delete their `projects/` and `episodes/` objects | UPDATE/DELETE policies | pgTAP (red first: U3/D2) |
| FR-4 | `viewer` cannot write, replace or delete | Predicate role set | pgTAP |
| FR-5 | The presign route authorises on the same predicate, not on project visibility | `rpc('can_write_project_storage')` | Vitest (red first) and E2E: S1 → 403 |
| FR-6 | The presign route pins `bucket` to `project-assets` | Allowlist | Vitest |
| FR-7 | Type is enforced server-side: the route checks `contentType` against `UPLOAD_CONSTRAINTS` (the one list FILM-CC-01 defines); the bucket's `allowed_mime_types` is the same list | Route and bucket | Vitest; E2E direct-storage upload of `text/html` refused |
| FR-8 | Size is enforced by the bucket: `file_size_limit` = the largest `UPLOAD_CONSTRAINTS.maxSize` (500 MB) | Bucket | pgTAP asserts the column; E2E notes the local 50 MiB global cap |
| FR-9 | The orphaned FILM-203 route is deleted, with its test | File removal | `ls`, typecheck, grep |
| FR-10 | `update_project_cover_image` refuses callers who cannot edit the project *(decision D2)* | SQL guard + action returns a refusal | pgTAP; repro-cover |
| FR-11 | Orphaned write paths with the same flaw are removed: `/api/publish/upload` (no project check at all, zero callers) and the `uploadProjectCoverImage` server action (zero callers) *(decision D3)* | File/function removal | grep positive control, typecheck |
| FR-12 | A legitimate owner, and a project member, can still upload through the real UI and route | — | Playwright spec; repro L1–L4 and S3 still 200 |

## 7. Define Non-Functional Requirements

- **Security:** tenant isolation on every write verb of every bucket (see §8.3). There is one predicate for the route and the policy, so they cannot diverge.
- **Performance:** one indexed `project_members` lookup per object write (`ix_project_members_project_id`, plus the unique `(project_id, user_id)`), and one PK lookup on `episodes` for episode paths. Microseconds, and uploads are rare (at most tens per user-hour).
- **Compatibility:** existing objects are untouched. MIME and size limits apply only to new uploads.
- **Observability:** the route logs refusals at `warn` with `{userId, projectId?, reason}`.
- **Maintainability:** the MIME list has one source (`UPLOAD_CONSTRAINTS`). The migration's SQL array is bound to it by a unit test (FR-7).
- Availability, i18n, a11y and cost are unchanged. No new dependencies; the lockfile is untouched.

## 8. Analyze the Existing System

### 8.1 Components

- **Buckets:** created only by migrations (`config.toml` has no `[storage.buckets]`). Live: `account_image` (public), `project-assets` (public), `reports` (private). All three have `file_size_limit` and `allowed_mime_types` **null** (read from `storage.buckets`).
- **Path helper:** `kit.get_project_id_from_path` (`migrations/20251207162036_project-assets-bucket.sql:18-41`) casts the **first** segment to uuid.
- **Write predicate helpers:** `has_role_on_project(pid, role default null)` (`20251016143639_projects.sql:96-110`) matches **any** role, including `viewer` (enum `:9-14`). Content tables (`assets`, `episodes`, `shots`, `episode_thumbnails`) write-gate on `role in ('owner','admin','member')`.
- **Upload route:** `apps/web/app/api/storage/presign/route.ts`. It takes the bucket from the client unchecked (`:37`, `:147`), authorises by *reading* `projects` (`:111-122`; public/unlisted projects are readable by anyone signed in, `20260108120000_public_sharing_rls.sql:28-34`), and checks type only by prefix (`video/ audio/ image/ application/`, `:125-135`).
- **Adapter:** `SupabaseStorageAdapter.getSignedUploadUrl` signs with the **user's** client (`packages/features/storage/src/adapters/supabase.ts:54-76`), so storage RLS is checked at signing time (I5).
- **Provider selection:** `getStorageProvider()` (`packages/features/storage/src/factory.ts:31-45`) maps anything other than `local | r2 | b2` to `supabase`. `sst.config.ts:1068` defaults `STORAGE_PROVIDER` to `'s3'`, which therefore means the Supabase adapter. I have **not** read, and will not read, production's actual value (see D6).
- **Clients writing to `project-assets`:**

| Caller | Path shape | Via |
|---|---|---|
| `project-cover-settings.tsx:69`, `create-film-project-form.tsx:242` (`uploadProjectCover`) | `projects/<P>/assets/covers/…` | presign |
| `use-image-upload.ts:127-139` (FILM-207) | `projects/<P>/assets/<type>/…` | presign |
| `master-asset-manager.tsx:203,434` | `projects/<P>/assets/<type>/…` | presign |
| `frame-uploader.tsx:59` | `projects/<P>/shots/<S>/frames/…` | presign |
| `use-video-upload.ts:317-318` | `projects/<P>/shots/<S>/{video,thumbnail}/…` | presign |
| `episode-thumbnail-settings.tsx:442`, `publish-screen.tsx:277` | `episodes/<E>/thumbnails/…` | presign |
| `publish-screen.tsx:717` (`uploadPublishVideo`) | `episodes/<E>/videos/…` | presign |
| `edit-suite/export-dialog.tsx:90-92` | `projects/<P>/assets/master_video/…`, bucket `NEXT_PUBLIC_R2_BUCKET_NAME ?? 'storybook-assets'` | presign |
| `project-intro-settings.tsx:385` | `projects/<P>/intros/…` | presign. **Already refused 400** by the route's path regex (S4); see §31 |
| `create-film-project.action.ts:116-150` `uploadProjectCoverImage` | `<P>/cover.<ext>` | server action, user client. **Zero callers** |
| `api/publish/upload/route.ts` | `episodes/<E>/videos/…`, `upsert:true`, **no project check at all** | route. **Zero callers** |
| `api/projects/[projectId]/assets/upload/route.ts` (FILM-203) | `<P>/<asset>/…` | route. Read-access check `:51-60`. **Orphaned**; FILM-203 is RETIRED |

### 8.2 Where the change enters

The fix enters at the bucket policies (the real gate for every client), the presign route (the app's gate, and the only one if production signs with R2/B2), `update_project_cover_image`, and the removal of three orphaned write paths.

### 8.3 Audit: every `storage.objects` policy, side by side (live `pg_policies`, 2026-09-23)

| Bucket (public?) | SELECT | INSERT | UPDATE | DELETE | Verdict |
|---|---|---|---|---|---|
| `project-assets` (public) | `bucket_id` only (public bucket anyway) | **`bucket_id` only** | `has_role_on_project(get_project_id_from_path(name))` | same as update | **KB-28:** insert looser than delete (I1–I6). Update/delete resolve `projects`/`episodes` → null, so they **deny owners on every live path** (U3, D2). All three admit `viewer`. **Fixed here.** |
| `account_image` (public) | one `FOR ALL` policy: `USING` filename-uuid = `auth.uid()` or `has_role_on_account(filename-uuid)` | `WITH CHECK` filename-uuid = `auth.uid()` or `has_permission(…,'settings.manage')` | same | same `USING` | No cross-tenant write (A1, A4, A5 refused). Insert is *stricter* than delete. B can create `<A uid>/<B uid>.png` (A2), but the policy is keyed on the file name, so that object is B's by the policy's own rule, not A's. Side finding: `uploadAvatar()` writes `<id>/avatar-<ts>.png`, which fails the uuid cast (A6, 400) **and** the presign regex (S5, 400). Avatar upload is broken today. **Not fixed here** (§31). |
| `reports` (private) | `has_role_on_account(get_account_id_from_report_path(name))` | same | *(no policy → denied)* | same | Symmetric; no hole (Q1, Q3 refused). Side finding: a **personal** account owner is refused too (Q2), since `has_role_on_account` has no membership row for personal accounts, and `report-actions.ts:341-348` uploads with the user client. **Not fixed here** (§31). |
| `audio`, `videos` | — | — | — | — | Written by code (`audio-generation/**` via the adapter; `shorts/generate-short-action.ts:252` with the admin client) but **created by no migration**. No bucket, no policies; uploads fail on the Supabase provider. **Not fixed here** (§31). |

An insert looser than its delete occurs only in `project-assets`.

## 9. Define the Desired System Behavior

| User action | App logic | Service | Data | Response | Visible |
|---|---|---|---|---|---|
| Member uploads | presign: bucket ✓, path ✓, type ✓, `rpc can_write_project_storage` ✓ | Storage signs (RLS ✓) | — | 200 signed URL | Progress |
| Browser PUT | — | Storage: MIME ✓, size ✓, RLS decided at signing | `storage.objects` row + file | 200 | Done |
| Non-member presign | `rpc` → false | — | — | 403 | Error |
| Non-member direct Storage API | — | RLS insert check false | — | 403 | — |
| Owner upsert / delete own | — | RLS update/delete check true | Row replaced/removed | 200 | Works (it did not before) |
| Save cover URL | action → `rpc update_project_cover_image` | Guard `can_edit_project` | `projects.metadata` | ok / refusal value | Toast |

## 10. High-Level Architecture

No new components. Trust boundary: **browser ↔ (presign route, Storage API)**. The Storage API is reachable directly with the public anon key and the user's JWT, so **RLS is the authoritative gate** and the route is defence-in-depth plus the only gate for non-Supabase providers. Both call one SQL predicate, `public.can_write_project_storage(path)`, so they cannot disagree (fix the class: one rule in one place). Type and size are enforced at the bucket, the only layer that sees the bytes on a direct-to-storage upload.

## 11. Architecture and Flow Diagrams

```
Browser ──POST /api/storage/presign──▶ Next route
   │                                    ├─ bucket == 'project-assets'?      ──no──▶ 400
   │                                    ├─ path matches shape?              ──no──▶ 400
   │                                    ├─ contentType ∈ UPLOAD_CONSTRAINTS? ─no──▶ 400
   │                                    ├─ rpc can_write_project_storage(path) ─no─▶ 403
   │                                    └─ adapter.getSignedUploadUrl (user client)
   │                                                 │
   │                                   Storage API ──┤ RLS: project_assets_insert
   │                                                 │   WITH CHECK can_write_project_storage(name)
   │◀──────────── 200 {uploadUrl} ───────────────────┘
   │
   └──PUT uploadUrl──▶ Storage API ── bucket allowed_mime_types / file_size_limit ──▶ object row + file

Attacker ──POST /storage/v1/object/project-assets/<victim path> (anon key + own JWT)
                    └──▶ RLS WITH CHECK can_write_project_storage(name) = false ──▶ 403

can_write_project_storage(path)            [SECURITY DEFINER, STABLE, search_path='']
   pid := kit.get_project_id_from_path(path)
          '<uuid>/…'           → uuid
          'projects/<uuid>/…'  → uuid
          'episodes/<uuid>/…'  → episodes.project_id
          otherwise            → null
   return exists(project_members where project_id = pid and user_id = auth.uid()
                 and role in ('owner','admin','member'))
```

## 12. End-to-End Data Flow

Source: a browser `File` → presign request (metadata only) → validation (route) → signed URL → PUT bytes → validation (bucket limits, RLS already decided) → persisted in `storage.objects` and the object store → public URL → saved in a DB column by the component's action → rendered. **Loss points:** a PUT that succeeds followed by a record-save that fails leaves an orphan object (pre-existing, unchanged). **Stale:** none introduced. **Deletion:** owners' deletes on `projects/`/`episodes/` paths now actually delete (they silently did nothing before). The app's own best-effort deletes in `intro-actions.ts:134,266` and `thumbnail-actions.ts:183,320` compute the wrong key (`slice(-2)` drops the `episodes/<E>/` / `projects/<P>/` prefix), so they still delete nothing. See §31.

## 13. Data Model

`storage.objects(bucket_id, name, owner_id, …)`: `name` carries the tenant key in its path. Authoritative for "which project owns an object" = the resolver over `name` (plus `episodes.project_id` for episode paths). Authoritative for "who may write" = `project_members`. No new entities.

## 14. Database Design and Changes

One hand-written migration, `apps/web/supabase/migrations/<UTC ts>_kb28-project-assets-write-scope.sql`:

1. `create or replace function kit.get_project_id_from_path(path text) returns uuid`: resolves the three shapes and returns null otherwise. It becomes `security definer stable set search_path = ''`, so the `episodes` lookup does not depend on the caller's episode-read RLS. It returns only an id. Existing grants are kept.
2. `create function public.can_write_project_storage(path text) returns boolean`, `security definer stable set search_path = ''`: `exists(select 1 from public.project_members where project_id = kit.get_project_id_from_path(path) and user_id = auth.uid() and role in ('owner','admin','member'))`. `revoke all … from public, anon; grant execute … to authenticated, service_role`. It lives in `public` so the route can call it with `.rpc()`.
3. `drop policy project_assets_insert|_update|_delete` and recreate each with `bucket_id = 'project-assets' and public.can_write_project_storage(name)` (update: both `USING` and `WITH CHECK`, which also covers a `move` to another project's path). `project_assets_select` is unchanged.
4. `update storage.buckets set file_size_limit = 524288000, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/wav','audio/ogg','audio/mp4'] where id = 'project-assets'`.
5. *(D2)* `create or replace function public.update_project_cover_image(…)`: add `if not public.can_edit_project(p_project_id) then raise exception 'not allowed to change this project''s cover' using errcode = '42501'; end if;` before the UPDATE.

Mirror: `apps/web/supabase/schemas/33-project-assets-storage.sql` is rewritten to match. Today it claims a scoped insert the database never had (failure mode 4). Types: `pnpm supabase:web:typegen` (new rpc) — generated, never hand-edited.

**Existing data:** no rows change. **Locking:** policy DDL takes a brief `ACCESS EXCLUSIVE` on `storage.objects` for the drop/create; the `buckets` update touches one row. **Rollback:** a down-migration restoring the three old policies, the old function bodies and null limits. Not recommended, because it reopens the hole.

## 15. Low-Level Design

**Presign route** (`apps/web/app/api/storage/presign/route.ts`), in order:
1. `requireUser` → 401.
2. Parse the body with a zod schema `{bucket: z.literal('project-assets'), path: z.string(), contentType: z.string(), expiresIn: z.number().optional()}` → 400 with a specific message.
3. Keep the path regex (path-traversal guard).
4. `contentType` must be in `ALLOWED_PROJECT_ASSET_TYPES`, derived from `UPLOAD_CONSTRAINTS` (`@kit/assets/upload-validation`) → 400.
5. `const { data: allowed, error } = await client.rpc('can_write_project_storage', { path })`. On error → 500; on `!allowed` → 403 (logged at warn). This replaces the episode lookup and the `projects` read (`:84-122`).
6. Sign as today.

`ALLOWED_PROJECT_ASSET_TYPES` is exported from `@kit/assets` next to `UPLOAD_CONSTRAINTS`. A Vitest test asserts that the migration's `allowed_mime_types` array (read from the SQL file) equals it, so the two lists cannot drift.

**Edit-suite export** *(D5)*: `export-dialog.tsx:91` uses `PROJECT_ASSETS_BUCKET` instead of `NEXT_PUBLIC_R2_BUCKET_NAME ?? 'storybook-assets'`. On the Supabase provider that value names a bucket that does not exist; on R2 the "bucket" is only a key prefix.

**Cover action** *(D2)*: `updateProjectCoverImage` returns `ActionResult<void>`. When the rpc's error code is `42501` it returns `{ok:false, error:"You can't change this project's cover."}`, and other errors still throw (KB-6 `returnRefusals` semantics). Callers (`project-cover-settings.tsx:72,95`, `create-film-project-form.tsx:245`) wrap the call in `unwrap(…)`, and their existing `refusalMessage` catch shows it.

**Deletions** *(D3)*: `apps/web/app/api/projects/[projectId]/assets/upload/` (route and `__tests__`), `apps/web/app/api/publish/upload/route.ts`, and `uploadProjectCoverImage` in `create-film-project.action.ts:112-150`. `@kit/assets/upload` stays; other code imports it.

No retries, flags or caching. Idempotency is unchanged (timestamped names; upsert where the caller asked for it).

## 16. API and Event Design

`POST /api/storage/presign`: request, response and status codes as in §5. Auth: a session cookie. Authorisation: `can_write_project_storage`. Compatible with every live caller, since all send `project-assets` and a matching path, with one exception: the edit-suite export, changed in the same PR (D5). The deleted endpoints have no callers (grep, with the positive control `api/storage/presign` → 8 hits). There are no events.

## 17. State and Lifecycle Design

An object is either absent or present. Transitions: insert (writer only), replace (writer only), delete (writer only). No other states. Not applicable beyond this.

## 18. Failure and Error Handling

| Failure | Behaviour | Visible | Recovery |
|---|---|---|---|
| `rpc` errors (DB down) | 500, logged at error | Existing upload-failed text | Retry |
| Storage refuses on MIME/size at PUT | Component catches the non-2xx | Existing upload-failed text | Choose another file |
| Signing refused by RLS (route bypass impossible, but belt and braces) | Adapter throws → 500 | Upload-failed text | — |
| Cover refusal | Returned value | "You can't change this project's cover." | — |

## 19. Security

- **Tenant isolation:** every write verb on `project-assets` is keyed to project membership through a single predicate. `viewer` is excluded. Unresolvable paths are denied, including the `<uuid>/…` prefix for a uuid that is not a project.
- **`SECURITY DEFINER` functions:** `search_path = ''`, fully qualified names. They return only a boolean or an id, and the boolean is about the caller themself (it leaks nothing about other users). `revoke … from anon`.
- **Stored XSS:** `text/html` and `image/svg+xml` are no longer storable in a public bucket (I6).
- **Resource abuse:** there is now a size ceiling. There is still no per-user quota or rate limit (outside this ticket).
- **Provider caveat:** if production signs with R2/B2, RLS is not in the path. The route's check is then the gate, and size is not bounded unless ContentLength is signed (D6).
- **Cover defacement:** closed by the `can_edit_project` guard (D2).
- **Secrets:** none. Local demo keys only; no production values were read.

## 20. Performance and Scale

One predicate per object write: two index lookups. Upload volume is small. No measurable change is expected.

## 21. Accessibility and Client Behavior

No new UI. Existing error surfaces are reused. The cover refusal text appears in the component's existing error region, which is unchanged. Not otherwise applicable.

## 22. Observability and Operations

The route logs `warn` `{userId, path, reason:'not-a-writer'|'bucket'|'type'}` on refusal. An operator can tell an expected refusal (403 plus a warn line with a reason) from a failure (500 plus an error log). Existing planted objects can be found by the owner with this read-only query, run in production by the owner and not by me:

```sql
select o.bucket_id, o.name, o.owner_id, o.created_at
from storage.objects o
where o.bucket_id = 'project-assets'
  and not exists (
    select 1 from public.project_members pm
    where pm.project_id = kit.get_project_id_from_path(o.name)   -- new resolver
      and pm.user_id = o.owner_id
      and pm.role in ('owner','admin','member'));
```

## 23. Configuration and Feature Flags

No flags; the fix is not optional. The bucket limits are data set by the migration. `STORAGE_PROVIDER` behaviour is unchanged. `NEXT_PUBLIC_R2_BUCKET_NAME` is no longer read by the export dialog (D5).

## 24. Compatibility

Existing objects and URLs are unaffected. All live presign callers keep working, which the E2E and a re-run of the repro show. Clients that upload types outside the list (SVG, HEIC, MKV, etc.) now fail. They were never in `UPLOAD_CONSTRAINTS`, but the route's `image/*`/`video/*` prefix check let them through. Deploy order: the migration and the app ship together. The migration alone already closes the hole and does not break the old route, because the old route still signs with the user client and RLS now decides.

## 25. Migration and Rollout Strategy

Standard deploy: migrations first (`scripts/deploy.sh`), then the app. There is nothing to backfill. Validation gate: after deploy, the owner runs the §22 query and, if they choose, a one-request probe as a second account. Rollback: revert the app. Reverting the migration reopens the hole, so it happens only if owners are blocked, in which case the policy can be widened to include `viewer` instead.

## 26. Testing Strategy

| Layer | File | Cases | Red first? |
|---|---|---|---|
| pgTAP | `apps/web/supabase/tests/database/project-assets-storage-rls.test.sql`, `select plan(N)` with a fixed N | Fixtures: owner A, member M, viewer V, stranger B, private project P with episode E, public project Q, and a project R of B's with episode ER. **Insert:** B refused on `<P>/…`, `projects/<P>/…`, `episodes/<E>/…`, `<Q>/…`; V refused; M allowed; A allowed on all three shapes; `foo/x.png`, `projects/not-a-uuid/x.png` and `<random uuid>/x.png` refused for A; A refused on `episodes/<ER>/…`. **Update:** A renames/updates own `projects/<P>/…` object (lives_ok and the row changed); B's update touches 0 rows; A cannot move an object to `projects/<R>/…`. **Delete:** A deletes own `projects/<P>/…` (1 row); B deletes 0 rows. **Select:** B reads (public, unchanged). **Bucket:** `file_size_limit` and `allowed_mime_types` equal the expected values. **Cover:** B and M `throws_ok 42501`; A `lives_ok`. Each case resets its row. | Yes. On current code the insert cases for B/V and the owner update/delete cases must fail; each is recorded |
| Vitest | `apps/web/app/api/storage/presign/__tests__/route.test.ts` | rpc false plus a readable project → 403 (red on current code, which returns 200); bucket `reports` → 400; `text/html` / `image/svg+xml` → 400; rpc true → 200 and the adapter called with `project-assets`; unauthenticated → 401 | Yes |
| Vitest | `packages/features/assets/__tests__/allowed-types.test.ts` | The migration's MIME array equals `ALLOWED_PROJECT_ASSET_TYPES` | Yes (fails until the migration exists) |
| Playwright | `apps/e2e/tests/storage/project-assets-upload.spec.ts` | Seed team + project (`seedTeamAccount`, `seedProject`) and a second user C; **owner drives project settings → cover input → success toast; the image URL fetches 200; then uploads a second cover (the second submission)**; a project **member** (seeded row) presigns and PUTs → 200; C (who can read the project once it is set `public`) presigns → 403 and uploads directly to the Storage API with C's token → 403; the owner uploading `text/html` directly → refused by the bucket. Evidence screenshots behind `CAPTURE_EVIDENCE=1`. | The C cases are run against unfixed code first and fail |
| Repro | `$SP/kb28/repro.mjs` re-run | I1–I6, S1 → refused; L1–L4, S3 → 200; U3 → 200; D2 → deleted; cover → refused | Before/after table in the PR |

Red-before-green: each guard is reverted in isolation (policy, route check, cover guard) and its test watched failing for the stated reason, then restored.

## 27. Production-Build Verification

`pnpm --filter web-e2e test:prod -- storage/project-assets-upload` builds and serves the production bundle and runs the spec. That proves the route's JSON refusals and the cover action's returned refusal survive a production build (KB-6), and that the real upload works in the artifact that ships. It does **not** prove production's provider or bucket state; that is D6 and the §22 query.

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Prod verification |
|---|---|---|---|---|---|---|---|
| Strangers can't plant files | Stranger | FR-1, FR-2 | §14.1–3 | RLS | `storage.objects` | pgTAP, repro I1–I6 | Probe as a 2nd account; §22 query |
| Owners can replace/delete | Replace | FR-3 | §14.3 | RLS | `storage.objects` | pgTAP U/D, repro U3/D2 | — |
| Viewers read only | — | FR-4 | §14.2 | RLS | `project_members` | pgTAP | — |
| App route doesn't admit readers | Presign | FR-5, FR-6 | §15 | route | `/api/storage/presign` | Vitest, E2E C | test:prod |
| Only real media stored | Upload | FR-7, FR-8 | §14.4 | bucket | `storage.buckets` | pgTAP bucket, Vitest list, E2E html | Owner checks the bucket row |
| No orphaned write doors | — | FR-9, FR-11 | §15 | routes | — | grep + typecheck | — |
| Cover can't be defaced | Cover | FR-10 | §14.5 | SQL fn + action | rpc | pgTAP, repro-cover | test:prod |
| Legit uploads still work | Happy | FR-12 | — | UI | — | E2E owner + member | test:prod |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Why this one |
|---|---|---|
| One SQL predicate used by RLS and the route | Duplicate the check in TS (query `project_members`) | Two copies drift (failure mode 1). The rpc costs one round trip |
| Teach the resolver all three path shapes | Migrate every client and every existing object to `<uuid>/…` | That rewrites stored URLs in many tables; far larger and riskier |
| Role set owner/admin/member | `has_role_on_project(pid)` as the KB proposed | That admits `viewer`, which is inconsistent with every content table |
| Bucket MIME/size limits | Route-only checks; post-upload magic-byte verification job | Only the bucket sees direct uploads. A verification job is a separate feature (magic bytes stay client-side; §31) |
| Delete the orphaned routes | Fix their authorisation | Zero callers; FILM-203 is RETIRED. Deleting removes attack surface |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| R1: a live caller writes a path shape the resolver doesn't know | That upload is refused | E2E + a caller inventory (§8.1) that covers every presign caller | Inventory done; unknown shapes deny, which is the safe side | Add the shape to the resolver |
| R2: legit users on excluded types (SVG/HEIC/MKV) | Upload fails | User report | These types were never in `UPLOAD_CONSTRAINTS` | Extend the one list (Vitest keeps route and bucket together) |
| R3: production uses R2/B2 | RLS not in the path; size unbounded | D6 | The route check covers authorisation | Follow-up: sign ContentLength with the client-sent size |
| R4: production's global storage limit is below 500 MB | Large videos refused before the bucket limit | Existing behaviour | None needed; min(global, bucket) applies | — |
| R5: a signed URL outlives a revoked membership (≤ 2 h, Supabase) | One late upload | — | Accepted: storage semantics | — |
| R6: files already planted in production | Content under victims' paths | §22 query | Owner runs it; deletion is the owner's call | — |
| R7: the viewer exclusion blocks someone who relied on it | Their uploads fail | User report | Consistent with all content tables | D1 |

## 31. Open Questions and Assumptions

**Decisions for the owner:** see D1–D6 in the PLAN READY report.

**Assumptions.** Production signs uploads with the Supabase adapter. `sst.config.ts:1068` defaults to `s3`, which the factory maps to `supabase`. I have not read production config.

**Out of scope, found during the audit, to be filed or folded into other tickets:**
- `project-intro-settings.tsx:385` writes `projects/<P>/intros/…`, which the presign regex refuses (S4, 400). **Project intro upload is broken today.** Fixing it is a one-line regex change in the same file this PR edits. I propose **not** doing it here unless D7 says otherwise.
- `uploadAvatar()` (`packages/features/storage/src/client/presigned-upload.ts:90-99`) is refused by the presign regex (S5) and by `account_image`'s uuid cast (A6). **Avatar upload is broken today.**
- Best-effort deletes compute the wrong key: `intro-actions.ts:134,266`, `thumbnail-actions.ts:183,320` (`slice(-2)`).
- `audio` and `videos` buckets are written by code but created by no migration.
- `reports` refuses personal-account owners (Q2).
- `/api/research/upload/route.ts:53-65` authorises on **read** access (a public project admits anyone) and then queues LLM fact-extraction jobs into that project. Same class, no storage involved. Belongs to KB-26/KB-18.
- Magic-byte verification remains client-side only for presigned uploads.

## 32. Implementation Plan

1. **Tests first:** the pgTAP file, run on current `main` under the DB lock (record which cases fail); the Vitest route test and the MIME-list test (red).
2. **Migration** (§14) → `migration up` → typegen → mirror `schemas/33-…` → pgTAP green → red-before-green by reverting each policy and the cover guard in turn.
3. **Route** (§15) + `ALLOWED_PROJECT_ASSET_TYPES` export → Vitest green → red-before-green.
4. **Cover action** returns refusals; update its 3 callers *(D2)*.
5. **Edit-suite bucket** *(D5)*; **delete orphans** *(D3)*; grep with a positive control; `pnpm typecheck`.
6. **Playwright** spec on a `-p 3105` dev server, then `test:prod`; capture evidence screenshots.
7. Re-run `repro.mjs` and `repro-cover.mjs` → before/after table.
8. `pnpm lint:fix`, `pnpm format:fix`; mark KB-28 **Fixed** with the PR number and add its row to the Fixed table; update `FILM-203`'s record only if it references the deleted route file's state (it is RETIRED already).

Each step's rollback is to revert its commit. Only step 2 touches the DB.

## 33. Definition of Done

- The KB-28 acceptance criteria all hold: pgTAP red→green (non-member refused, member allowed); the presign route refuses a public-project reader (red→green); size and type are enforced by the bucket; the orphaned route is gone.
- The owner update/delete regression (U3/D2) is fixed and tested.
- Legit owner and member uploads pass through the real UI (E2E, dev and prod build).
- The repro before/after table is in the PR, and the planted-object query is documented for the owner.
- Typecheck, lint and format are clean; types are generated; the schema mirror is updated.

## 34. Final Consistency Pass

**Forward.** Problem: strangers write into project folders, and owners can't manage their own. Outcome: only project writers write, and they can replace and delete. Flow: unchanged for legit users; refusals for others. System: one predicate at RLS and the route; bucket limits. Data: policies, function and bucket row. Tests: pgTAP, Vitest, E2E and repro. Production: test:prod plus the owner's query and probe.

**Reverse.** Production after deploy: storage evaluates `can_write_project_storage(name)` on every insert, update and delete in `project-assets`, and the route calls the same function before signing. A writer's upload succeeds, and anyone else's is refused before any byte is stored. This matches §1–§3. The one user-visible difference for legitimate users is that previously accepted off-list types (SVG/HEIC/MKV) are now refused. That is recorded in R2 and D4, and it is what FILM-CC-01 always specified. The two directions converge.
