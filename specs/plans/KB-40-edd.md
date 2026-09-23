# KB-40 — Engineering Design Document

**Ticket:** KB-40, "`batch_assemble_edit_project` trusts a caller-supplied `p_user_id`" (severity High, a cross-tenant destructive write). KB-27's class sweep found it on 2026-09-23. Its FILM-CC-04 entry is written in KB-27's PR, which has not merged, so it is not on `main` yet.
**Branch:** `fix/kb-40-edit-project-write-scope`, stacked on `fix/kb-28-project-assets-insert-scope` (#313) @ `f9943881`. It needs `public.can_write_project`, which that PR creates.
**Size:** S. One migration, one server action, a two-line client change, a pgTAP file, a Playwright spec and mutation guards.
**Status:** Implemented (Phase 2). Approved by the owner on 2026-09-23 with every recommended default (D1–D6). The sibling RPCs are KB-62; `remove_episode_from_threads_touched` is KB-63.

**Deviations from the approved design** (none changes user-visible behaviour or scope):
- **A unit test and a unit guard were added** (§26 said none). The refusal mapping became a shared helper (`write-refusal.ts`), and the mutation-guard README says a server-module line is guarded by a unit entry, not an e2e one. So `packages/features/edit-suite/__tests__/write-refusal.test.ts` tests it, and `@kit/edit-suite` joins `scripts/test-units.sh`. That needed a `vitest.config.ts` and a `server-only` mock in the package.
- **The E2E red check reverts the rule at the database** (to account membership, as before KB-40) with the app unchanged. It does not revert the whole branch: the pre-fix toolbar has no `data-test` hooks, so a full revert would fail at the locator, not for the stated reason.
- **The refusal span carries `role="alert"`**, so a screen reader announces it.

---

## 0. What the reproduction showed (2026-09-23, local stack, real GoTrue users)

**Setup.** I ran a `db reset` from this worktree, at the KB-28 tip, while holding the DB lock. Each caller used only the anon key and their **own** JWT, over PostgREST.
- Script: `$SP/kb40/repro.sh`.
- Output: `$SP/kb40/repro.out`.

**Fixture.**
- A team account owned by **O**, with a **public** project `P` and a **private** project `P2`.
- `P`'s episode `E` already has a hand-built edit project, with tracks "Victim video" and "Victim dialogue".
- **M** is an account member and a `project_members` *member* of `P`.
- **V** is an account member and a `project_members` *viewer*.
- **AO** is an account member with no `project_members` row.
- **S** is a stranger who has only a personal account and a personal project of their own.

| # | Caller → call | Today |
|---|---|---|
| 0a | S reads `projects` | Sees `P` (public), **including `created_by` = O's user id**. Does not see `P2` |
| 0b | S `DELETE /edit_projects?id=eq.<victim>` directly | HTTP 204 with 0 rows deleted. RLS holds, and the timeline is untouched |
| 0c | `rpc/can_write_project(P)` for O / M / V / AO / S | `true / true / false / false / false` |
| **A1** | S → `batch_assemble_edit_project(E, p_user_id = O)` | **Succeeds.** Victim timeline deleted (tracks cascade), replaced by the stranger's single "FORGED" track, new id `ef24a96f…` |
| **A2** | S → the same on the **private** project's episode `E2`, `p_user_id = O` | **Succeeds.** Visibility plays no part; only the ids are needed |
| A3 | S → `(E, p_user_id = S)` | `P0001 Access denied: user is not a member of the project account` |
| A4 | anon, no JWT | `42501 permission denied for schema public` |
| L1 | O (owner), names self | succeeds |
| L2 | M (project member), names self | succeeds |
| **L3** | **V (project *viewer*)**, names self | **succeeds**. The owner's rule says a viewer may not write |
| **L4** | **AO (account member, no project row)**, names self | **succeeds**. The owner's rule says no |
| **L5** | **S, personal-account owner, on their own project** | **refused** (`P0001`). Personal accounts have no `accounts_memberships` row (0 of 7 locally), so a legitimate owner is locked out |

**The same class in sibling functions** (as postgres, `pg_proc` / `has_function_privilege`; then the RPC called as O):

| Function | SECURITY DEFINER | `search_path` | EXECUTE to `authenticated` | Access check in body | O calls it |
|---|---|---|---|---|---|
| `batch_assemble_edit_project` | yes | `public` | **yes** | membership of **caller-supplied** `p_user_id` | works |
| `batch_save_edit_project` | yes | `public` | **no** | **none** | `42501 permission denied for function` |
| `create_edit_project_with_tracks` | yes | `public` | **no** | **none** | `42501 permission denied` |
| `split_edit_clip` | yes | `public` | **no** | **none** | `42501 permission denied` |
| `remove_episode_from_threads_touched` | yes | none | **no** | **none** | `42501 permission denied` |

**The real UI, baseline.** A throwaway Playwright spec (`$SP/kb40/kb40-baseline.spec.ts`, not committed) ran against `next dev -p 3111` under the DB lock and a heavy slot. It clicked **⚡ Auto-Assemble** in the Edit Suite as four users, and every one loaded a timeline:

| User | Outcome | `edit_projects` for the episode |
|---|---|---|
| owner | timeline loaded | 1 |
| member | timeline loaded | 1 |
| viewer | timeline loaded | 1 |
| account-only member | timeline loaded | 1 |

Screenshots: `$SP/kb40/evidence/kb40-baseline-*.png`.

**Conclusions.**
- The bug is as reported, and wider in two ways. First, a private project is just as exposed as a public one: an attacker needs only the ids. Second, even the product's own check (account membership) is wider than the owner's rule, because viewers and account-only members can replace timelines.
- The same check also locks personal-account owners out, at the RPC level. Personal accounts have no studio route, so this is not reachable in the UI today.

---

## 1. Start With the User

**Who.**
- Creators who edit an episode's timeline in the Edit Suite: owners, admins and members of the project.
- Every other creator on the platform, whose timelines any signed-in stranger can currently wipe.

**Problem.** Auto-assemble *replaces* an episode's edit project. It deletes every track, clip, keyframe, transition and sync group, then writes new ones. Today anyone signed in can do this to any episode whose id they know. The database function believes whatever user id the caller says they are. Project and episode ids are readable for every public project, along with the owner's user id, which is exactly what the function asks for. There is no undo: a hand-cut timeline is gone.

**After the fix:**
- Only the project's **owner, admin or member** (in `project_members`) can assemble or re-assemble an episode's timeline. The server decides who the caller is from their session and never from a parameter.
- A signed-in stranger who calls the function directly gets a refusal, and nothing is deleted or written.
- A project **viewer** or a team member with **no role on the project** can still open the Edit Suite and see the timeline. When they press Auto-Assemble, they see a plain sentence saying they need to be the project's owner, an admin or a member, instead of a timeline. Today they succeed.
- A personal-account owner can assemble on their own project at the database level. Today they cannot.

**Persists:** an assembled edit project and its children. **Does not persist:** anything from a refused call. The check runs before the delete, inside one transaction.

## 2. Define the Complete User Journey

| Stage | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| Entry | Opens `/home/<team>/studio/<project>/episodes/<episode>/edit-suite` | Provider looks for an existing edit project | Existing timeline, or empty editor with **⚡ Auto-Assemble** | Click Auto-Assemble |
| Assemble (writer) | Clicks Auto-Assemble | `getMediaBinDataAction` → `buildAssemblyPayload` → `batchAssembleAction` → RPC checks `can_write_project` for `auth.uid()` → replace → `getEditProjectAction` | Button shows "⚡ Assembling…", then the timeline appears and the button disappears | Edit |
| Assemble (viewer / no project role) | Clicks Auto-Assemble | RPC raises `42501` → action returns a refusal value | Button returns; red text: *"Only the project's owner, admins and members can assemble its timeline."* | Nothing to do but ask for a role |
| Click again after refusal | Clicks again | Same refusal (no state carried over) | Same text | — |
| Refresh | Reloads | Reads existing edit project | Same timeline, or the empty editor | — |
| Session expired | Clicks | `enhanceAction` auth → redirect to sign-in | Sign-in page | Sign in, return |
| Stranger via API | `POST /rest/v1/rpc/batch_assemble_edit_project` | `42501` | HTTP 403, and nothing changes | — |
| Navigate away mid-assembly | — | The RPC is one transaction: it either commits whole or not at all | On return: the new timeline, or the old one | — |

## 3. Explicitly Define the Happy Path

A project **member** M auto-assembles an episode that has shots.

1. M opens the Edit Suite. There is no edit project, so the toolbar shows **⚡ Auto-Assemble** (`toolbar.tsx:208-222`).
2. The click runs `runAutoAssembly` (`edit-suite-provider.tsx:521`), then `autoAssemble` (`lib/auto-assemble.ts:411`). It fetches the media bin through `getMediaBinDataAction` (an RLS read) and builds `{episodeId, width, height, fps, activeLanguage, tracks, clips, keyframes, syncGroups}`.
3. `batchAssembleAction` validates with `BatchAssembleSchema` and calls `rpc('batch_assemble_edit_project', {p_episode_id, p_width, …})`. The call carries **no user id**.
4. The function reads `auth.uid()` = M. It resolves the episode's project, which must not be soft-deleted, and evaluates `public.can_write_project(project)`, which is `true` for a `member`. It then deletes any existing edit project for the episode and inserts the new one, tracks, sync groups, clips and keyframes. It returns counts and the new id.
5. The action reads the new `edit_projects` row and returns `{ok: true, data: {success: true, result}}`.
6. The client unwraps the result, loads the project through `getEditProjectAction`, and dispatches `LOAD_PROJECT`. The timeline renders its tracks.

**Success:** exactly one `edit_projects` row exists for the episode, with the payload's tracks, and the timeline shows them.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| Caller is not owner/admin/member (viewer, account-only member, stranger) | RPC raises `42501` before any write | UI: the refusal sentence beside the button. API: 403 | Get a project role | Unchanged |
| Episode id does not exist, or is soft-deleted | **Same** `42501` and same message (no existence oracle) | Same refusal sentence | — | Unchanged |
| No session (`auth.uid()` null) at the RPC | `42501` | UI never reaches this (the action requires a user); API: 403 | Sign in | Unchanged |
| anon role | No EXECUTE privilege | 401/403 from PostgREST | — | Unchanged |
| A caller still sends `p_user_id` (old client, script) | PostgREST finds no function with that argument (`PGRST202`) | Old app during the deploy window: "Assembly failed" | Deploy the app (see §24–25) | Unchanged |
| Malformed payload (bad JSON text, unknown track type) | Cast or check error, and the whole transaction rolls back | "Assembly failed" (unchanged behaviour) | Fix the input | Old timeline intact |
| Two writers assemble at once | Two transactions; the second one's delete removes the first's project. Last writer wins (unchanged) | Both see a timeline; after refresh, the last one | — | One edit project |
| DB unavailable / timeout | Error thrown (not a refusal); logged | "Assembly failed" | Retry | Unchanged |

## 5. Establish the User-Facing Contract

- **Who may assemble:** exactly the set `can_write_project(<episode's project>)` returns true for, meaning `project_members.role in (owner, admin, member)` for the **session** user.
- **Refusal text** (returned as a value, so it survives a production build): *"Only the project's owner, admins and members can assemble its timeline."* It is shown inline where "Assembly failed" shows today (`toolbar.tsx:224-226`), with `data-test="edit-suite-assembly-error"`.
- **Other failures:** unchanged, the fixed text "Assembly failed".
- **Loading:** unchanged ("⚡ Assembling…", button disabled).
- **Who may see the Edit Suite:** unchanged. Reads stay on account membership.
- **RPC contract:** `batch_assemble_edit_project(p_episode_id uuid, p_width int = 1920, p_height int = 1080, p_fps int = 30, p_active_language varchar = 'en', p_tracks text = '[]', p_clips text = '[]', p_keyframes text = '[]', p_sync_groups text = '[]') → jsonb`, with **no `p_user_id`**. Refusal: SQLSTATE `42501`, message `No write access to this episode's timeline`.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Verification |
|---|---|---|
| FR-1 | The RPC authorises on `auth.uid()` via `public.can_write_project(<episode's project>)` and accepts no caller-supplied identity | pgTAP T1–T6, T9; repro A1/A2 re-run |
| FR-2 | A refused call deletes and writes nothing (the check precedes the delete) | pgTAP T1–T3: the victim project id and tracks are unchanged |
| FR-3 | Not found, soft-deleted, not signed in and not a writer all give the same `42501` and the same message | pgTAP T7 |
| FR-4 | Owner, admin and member still assemble; personal-account owners can too | pgTAP T4–T6; Playwright P1–P2 |
| FR-5 | `search_path = ''`; EXECUTE for `authenticated` and `service_role` only | pgTAP T8, T10 |
| FR-6 | The action has no second copy of the rule: its hand-written membership check is removed, and the RPC is the one gate | Code review; Playwright P3/P4 show the RPC's refusal reaching the page |
| FR-7 | A refusal reaches the page as written on a production build | Playwright P3/P4 on `next build && next start` (§27) |

## 7. Define Non-Functional Requirements

- **Security:** tenant isolation, since the whole point is a write rule. No new existence oracle (FR-3).
- **Performance:** the check adds one primary-key lookup on `episodes` and one indexed `project_members` lookup (`ix_project_members_project_id`, unique `(project_id,user_id)`). Well under 1 ms, against an assemble that inserts dozens of rows.
- **Compatibility:** the signature changes (see §24).
- **Observability:** refusals are logged at `warn` by the action, with `episodeId`; other RPC errors stay at `error`.
- **Accessibility:** the refusal is visible text next to the button that caused it (§21).

## 8. Analyze the Existing System

- **Function:** `apps/web/supabase/migrations/20260226170054_fix-batch-assemble-replace-existing.sql:16-200`.
  - `security definer`, `set search_path = public`.
  - Authorisation (`:55-68`) requires only that `p_user_id` be in `accounts_memberships` of the episode's account. `p_user_id` is never compared with `auth.uid()`.
  - Step 0 (`:78`) deletes the existing edit project, and the children go by `on delete cascade`.
  - Granted to `authenticated` and `service_role` (`:195-201`).
  - First created in `20260219100138_edit-suite-v2-rpc-functions.sql:50` (old jsonb signature, dropped by the fix migration).
- **The only caller:** `packages/features/edit-suite/src/server/batch-actions.ts:23-138` (`batchAssembleAction`). It is re-exported from `server/actions.ts:37` and imported only by `lib/auto-assemble.ts:418`. That is called only by `edit-suite-provider.tsx:529` (`runAutoAssembly`), which only the toolbar's Auto-Assemble button calls (`toolbar.tsx:213`). The page is `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/edit-suite/page.tsx`.
  - Found with `git grep -n batch_assemble_edit_project -- apps packages`, which gives the two migrations, `batch-actions.ts:68` and the generated types.
  - Positive control: the same grep finds the migration's own definition line.
  - There are no Lambda, worker or service-role callers.
- **The action's own check:** `batch-actions.ts:39-64` reads the episode, then `accounts_memberships` for the session user. It is the same wide rule, and it excludes personal-account owners. It throws plain `Error`s, which a production build replaces with a generic sentence (KB-6).
- **Table RLS** (`20260219083555_edit-suite-v2.sql:310-360`): `edit_projects` insert/update allow `project_members` owner/admin/member; delete allows owner/admin only; read uses account role or personal owner. The SECURITY DEFINER function bypasses all of these.
- **Rule function:** `public.can_write_project(uuid)` (KB-28, `20260923042517_kb28-project-write-scope.sql:23-39`), `security definer`, `search_path = ''`, using `auth.uid()`.
- **Schema file:** `apps/web/supabase/schemas/36-edit-suite.sql` holds the tables but **not** the RPCs, so there is nothing to mirror.
- **Generated types:** `apps/web/lib/database.types.ts:5467` and `packages/supabase/src/database.types.ts:5467` list `p_user_id`. The edit-suite client is typed `any` (`server/db-client.ts`), so the TypeScript is unaffected. The types must still be regenerated.

## 9. Define the Desired System Behavior

**Click Auto-Assemble** → `batchAssembleAction` (`enhanceAction` auth + schema) → `rpc(batch_assemble_edit_project, {…no user id})` → the function takes `auth.uid()`, resolves the live episode's project, checks `can_write_project` → either:
- **false/null:** `raise … using errcode = '42501'`. The action maps `error.code === '42501'` to `ActionRefusal(<sentence>)`, `returnRefusals` returns `{ok:false, error}`, the client's `unwrap` throws `ActionRefusal`, and the provider stores `refusalMessage(error, 'Assembly failed')`. The toolbar shows it.
- **true:** replace as today → counts → the action fetches the row → `{ok:true}` → the timeline loads.

## 10. High-Level Architecture

There are no new components. The trust boundary moves: today the *database* trusts the *caller* about identity. After the fix, the database derives identity from the JWT (`auth.uid()`), and the one project-write rule (`can_write_project`) decides. The server action becomes a thin caller that translates the rule's refusal for the page. The reason is that the RPC is reachable directly over PostgREST with any user's JWT, so the check has to live where the write happens (KB-27's conclusion for `commit_canon_changes`, same shape).

## 11. Architecture and Flow Diagrams

```
Browser (Edit Suite)                 Next server action                 Postgres (PostgREST role=authenticated, JWT sub=U)
  Auto-Assemble ──► autoAssemble ──► batchAssembleAction ──rpc──► batch_assemble_edit_project(p_episode_id, …)
                                        (no user id sent)          v_uid := auth.uid()                 -- U, from JWT
                                                                   v_project := episodes[id, not deleted].project_id
                                                                   if v_uid null or v_project null
                                                                      or not can_write_project(v_project)
                                                                      → raise 42501  ─────────────┐
                                                                   delete edit_projects(episode)   │
                                                                   insert project/tracks/…         │
                                     ◄── {ok:true,data} ◄───────── return counts                   │
                                     ◄── {ok:false,error:<sentence>} ◄── map 42501 → ActionRefusal ◄┘
  toolbar: timeline | refusal text

Attacker (PostgREST, own JWT) ──rpc──► same function → 42501 (403); p_user_id → PGRST202 (no such function)
```

## 12. End-to-End Data Flow

- **Source:** the episode's media bin (shots, dialogue lines, audio), read under RLS, then the client-built arrays. These are validated by `BatchAssembleSchema` (unchanged) and serialised as JSON text (unchanged, `JSON.stringify` per the 2026-02-26 double-encoding fix).
- **Persistence:** `edit_projects` → `edit_tracks` → `dialogue_sync_groups` → `edit_clips` → `edit_keyframes`, in one transaction.
- **Loss point today:** the step-0 delete, which any caller can trigger. After the fix it is reachable only by writers.
- **Nothing is cached.** Retention and deletion are unchanged.

## 13. Data Model

No change. `edit_projects.episode_id → episodes.project_id → project_members(project_id, user_id, role)` is the authority for who may write. `accounts_memberships` stays the authority for reads.

## 14. Database Design and Changes

One hand-written migration: `apps/web/supabase/migrations/<UTC ts>_kb40-batch-assemble-write-scope.sql`.

1. `drop function if exists public.batch_assemble_edit_project(uuid, uuid, integer, integer, integer, varchar, text, text, text, text);`
2. `create function public.batch_assemble_edit_project(p_episode_id uuid, p_width integer default 1920, …, p_sync_groups text default '[]') returns jsonb language plpgsql security definer set search_path = ''`. The body:
   - `v_uid := auth.uid()`.
   - `select e.project_id into v_project from public.episodes e where e.id = p_episode_id and e.deleted_at is null`.
   - `if v_uid is null or v_project is null or not public.can_write_project(v_project) then raise exception 'No write access to this episode''s timeline' using errcode = '42501'; end if;`
   - Then steps 0–6 and the return, **verbatim** from the current body. Every relation is already `public.`-qualified, and `jsonb_array_elements`, `array_append` and the casts resolve through `pg_catalog` under an empty path.
3. `revoke all on function public.batch_assemble_edit_project(uuid, integer, integer, integer, varchar, text, text, text, text) from public, anon;` then `grant execute … to authenticated, service_role;`
4. A `comment on function` that states the rule.

**Other steps.**
- **Mirror:** none needed, because `schemas/36-edit-suite.sql` holds no RPCs.
- **Types:** `pnpm supabase:web:typegen`, generated and never hand-edited.

**Production implications.**
- No data change, no table lock, and it runs in milliseconds.
- **Rollback:** a forward migration re-creating the old signature (not recommended; it reopens the hole). A safer rollback is to revert the app action only, which is not needed because the new function is strictly narrower.

## 15. Low-Level Design

**`batch-actions.ts`:**
- Delete the episode and `accounts_memberships` pre-check (`:39-64`). The RPC is the one rule. Keeping a second, different rule is how the viewer case got through.
- Call the RPC without `p_user_id`.
- Refusal mapping goes through a small shared helper, so KB-62's three sibling actions use the same rule and wording.
  - The helper is `packages/features/edit-suite/src/server/write-refusal.ts` (`server-only`), exporting `throwIfWriteRefused(error, what)`.
  - When `error?.code === '42501'`, it throws `new ActionRefusal(\`Only the project's owner, admins and members can ${what}.\`)`. Otherwise it returns, and the caller throws its existing error.
  - The action calls `throwIfWriteRefused(rpcError, 'assemble its timeline')` and logs a `warn` first. Other errors are thrown as today.
- `export const batchAssembleAction = returnRefusals(enhanceAction(…))`. The inner return shape is unchanged.

**`lib/auto-assemble.ts`:**
- `const result = await unwrap(batchAssembleAction(payload));`. The `if (!result.success)` guard stays.

**`edit-suite-provider.tsx`:**
- Replace `useState<AssemblyStatus>` with one state object, `{ status: AssemblyStatus; message: string | null }`.
- The catch sets `{status: 'error', message: refusalMessage(error, 'Assembly failed')}`.
- Expose `assemblyMessage` on the context next to `assemblyStatus`.

**`toolbar.tsx`:**
- Render `assemblyMessage` in place of the fixed "Assembly failed", with `data-test="edit-suite-assembly-error"`.
- Add a `data-test` prop to `ToolbarButton` and set `data-test="edit-suite-auto-assemble"` on the Auto-Assemble button.

There are no retries. The RPC is one transaction, and its idempotency is "replace", as today.

## 16. API and Event Design

- **RPC `public.batch_assemble_edit_project`:** the signature is in §5.
  - Auth: an authenticated JWT.
  - Authorisation: `can_write_project`.
  - Errors: `42501` (refused, not found, or deleted); cast and check errors (`22P02`, `23514`) as today.
  - The old 10-argument signature is removed.
- **Server action `batchAssembleAction`:**
  - Input: unchanged.
  - Output changes from `{success, result}` to `ActionResult<{success, result}>`.
  - Its one caller (`autoAssemble`) is updated in the same PR.
- No events or queues.

## 17. State and Lifecycle Design

The Edit Suite's `assemblyStatus` machine is unchanged: `idle → assembling → done | error`. The only difference is that `error` now carries a message. `edit_projects` has no lifecycle states.

## 18. Failure and Error Handling

| Failure | Behaviour | User sees | Recovery |
|---|---|---|---|
| Not a writer / not found / deleted / no uid | `42501` → `ActionRefusal` → value | The refusal sentence | Get a role |
| Old client sends `p_user_id` | `PGRST202` → thrown → logged `error` | "Assembly failed" | App deploy |
| Payload cast/check error | Rollback; thrown; logged | "Assembly failed" | — |
| `can_write_project` missing (KB-28 not deployed) | The migration still applies, because plpgsql resolves the call at run time. Each call then fails with `42883` | "Assembly failed" | Deploy KB-28 first. This branch is stacked on it, so merge order enforces the deploy order |
| Lost EXECUTE grant | `42501` "permission denied for function", mapped to the same refusal text | Refusal sentence, which is misleading. The log carries the real message | Operator reads the `warn` log. Accepted: it matches KB-27's choice of 42501 for refusals |

## 19. Security

- **Authentication:** the Supabase JWT, via `auth.uid()`.
- **Authorisation:** `can_write_project`: owner, admin or member in `project_members`. Visibility (public/unlisted) never grants a write (owner decision, 2026-09-23).
- **What the fix allows that it did not before:** personal-account owners can assemble on their own projects. That is intended, since they are the `project_members` owner.
- **What the fix newly refuses:** viewers, and account members without a project row. Both were measured succeeding today (L3, L4, and the UI baseline). This follows the owner's rule.
- **Tenant isolation:** the stranger cases A1 and A2 become 403.
- **No existence oracle:** one error for every refusal. The old function distinguished "Episode not found or has been deleted" from "Access denied".
- **`search_path = ''`:** closes the SECURITY DEFINER path-hijack class.
- **Least privilege:** `revoke … from public, anon`.
- **Remaining asymmetry:** `edit_projects_delete` RLS is owner/admin only, but this function lets a *member* replace, which deletes an existing timeline. This was true before for members and is unchanged. See Decision 2.
- **`service_role`:** keeps EXECUTE, but `auth.uid()` is null there, so it is refused. There are no service-role callers (§8 grep).
- **Audit:** refused calls are logged at `warn` by the action. Direct PostgREST calls are not logged by the app (unchanged).

## 20. Performance and Scale

Assemble is a manual, rare action: at most a few per episode per session. The added cost is two indexed lookups. There is no scale concern.

## 21. Accessibility and Client Behavior

- The refusal text replaces the existing "Assembly failed" span in the same place, with the same red, small style.
- It stays visible until the next attempt.
- The button stays focusable and enabled after a refusal.
- No new interactive elements.
- There is no i18n for this toolbar today: its strings are English literals. That is unchanged.

## 22. Observability and Operations

- `editSuite.batchAssemble` logs `warn` with `{episodeId, error.code}` on a refusal and `error` on anything else (existing).
- **How an operator knows it works:** a real writer's assemble logs "Edit project assembled (atomic)". Refusals appear as `warn` with code `42501`. A spike in `PGRST202` right after deploy means an old client or a script is still sending `p_user_id`.

## 23. Configuration and Feature Flags

None. A flag would leave the hole open while it was off, and the change is a strict narrowing with no tunable.

## 24. Compatibility

- **DB ↔ app:** dropping `p_user_id` changes the signature.
  - The old app plus the new DB gives `PGRST202`, so assemble fails until the app deploys.
  - The new app plus the old DB also fails: `p_user_id` is required there, and PostgREST cannot match.
  - The migration and the app must ship **together**. The window is one deploy (single owner, dogfooding).
  - The alternative with no window, a keep-and-ignore parameter, is weighed in §29 and Decision 1.
- **Generated types:** regenerated. No typed caller reads `Args` for this function (the client is `any`).
- **KB-27's `definer-functions-inventory.test.sql`** (not yet on `main`) pins the **schema and name** of every definer function granted to `authenticated`, not its arguments (`schema.proname`, test line 24). The name does not change, so the test stays green. Only the row's "KB-40, open" note in KB-27's FILM-CC-04 table needs updating, by whichever PR merges second. (Corrected after KB-62 pointed it out and I checked KB-27's worktree.)
- **Existing data:** no effect.

## 25. Migration and Rollout Strategy

**Order:**
1. KB-28 (#313) merges.
2. This PR is retargeted to `main` and merges.
3. The migration and app deploy together.

**Validation gates:** pgTAP in the Supabase DB job; the Playwright spec; the repro script re-run locally against the fixed DB (A1/A2 → 403).

**After deploy:** the owner assembles once on a real episode, and a direct `rpc` call as a second account returns 403.

**Rollback trigger:** writers refused. The action logs `warn` 42501 for a known writer.

**Rollback:** investigate `project_members` for that user first, since that is the rule working as designed. A code rollback would reopen a High.

## 26. Testing Strategy

**1. pgTAP** `apps/web/supabase/tests/database/edit-project-assemble-access.test.sql`, red first against the current function.

Fixture:
- A team with a project and an episode that has an existing edit project with two tracks.
- A member, a viewer and an account-only member.
- A stranger with a personal project and episode.
- A soft-deleted episode.

Cases:
- **T1** stranger → throws `42501`, and the victim project id and both tracks are unchanged.
- **T2** viewer → `42501`, and nothing changes.
- **T3** account-only member → `42501`, and nothing changes.
- **T4** owner → returns, and there is exactly one edit project with the payload's track.
- **T5** project member → returns.
- **T6** personal-account owner on own project → returns. This is red today.
- **T7** soft-deleted and nonexistent episode (as owner) → the same `42501` and message.
- **T8** `has_function_privilege`: anon false, authenticated true, service_role true.
- **T9** `hasnt_function` for the old signature with `p_user_id`.
- **T10** `proconfig` = `search_path=""`.

Today T1 would *not* throw when it names the owner, so the red run proves the test sees the bug.

**2. Mutation guards** in `tooling/mutation-guards/kb-40.json` (`kind: pgtap`), each seen `RED`:
- (a) the check removed;
- (b) the check using `accounts_memberships` again, which T2/T3 catch;
- (c) `search_path` reset.

**3. Playwright** `apps/e2e/tests/edit-suite/auto-assemble-access.spec.ts`. It seeds through the API with `seedTeamAccount`/`seedProject`/`seedEpisodeWithShot`/`seedMembership` and `project_members` rows.
- P1: the owner assembles and the timeline shows.
- P2: a project member assembles.
- P3: a viewer sees the refusal **sentence**, the edit project count is unchanged, and a **second click** shows it again.
- P4: an account-only member sees the refusal.
- There are screenshots of every state after the action, taken behind `CAPTURE_EVIDENCE=1`.
- Red first: before the fix, P3 and P4 load a timeline (measured in the baseline).
- One `e2e` mutation-guard entry: the action's 42501 mapping removed, which P3 catches because the text becomes "Assembly failed".

**4. Direct-attack re-run:** `$SP/kb40/repro.sh` against the fixed DB. The expected results go in the PR as a before/after table.

**5. Unit:** `packages/features/edit-suite/__tests__/write-refusal.test.ts` covers the shared mapping: `42501` becomes the `ActionRefusal` sentence, and every other code or no error is left to the caller. A unit mutation guard (the code match changed) goes RED. The action itself is not unit-tested: mocking Supabase would test the mock, and P3/P4 drive it for real.

**6. KB-6 guard:** `packages/next/__tests__/kb6-caught-action-message.test.ts` must stay green. The client reads the message only through `refusalMessage`.

## 27. Production-Build Verification

**Applies:** the refusal must survive a production build (KB-6).
- Run P3 and P4 against `next build && next start -p 3111`, sandboxed per the wave-1 rule: `NODE_ENV=test`, `VENDOR_SANDBOX=1`, the `VENDOR_URL_*` overrides, and a pre-flight that aborts if an override is ignored. The Edit Suite's assemble path reaches no vendor, but the server boots with every route.
- Assert the exact sentence and assert it is **not** the production generic sentence (`PRODUCTION_SENTENCE` from `tests/refusals/refusals.po.ts`).
- Red check: with the mapping removed on the production build, the page shows "Assembly failed".

## 28. Requirement Traceability

| User Outcome | User Flow | Requirement | Design | Component | Data/API | Test | Production Verification |
|---|---|---|---|---|---|---|---|
| Strangers cannot wipe a timeline | API attack | FR-1, FR-2 | §14 check before delete | migration | RPC | T1, repro A1/A2 | Post-deploy direct `rpc` → 403 |
| Viewers / non-project members cannot replace | Assemble (viewer) | FR-1, FR-6 | §15 one rule | migration + action | RPC 42501 | T2, T3, P3, P4 | P3/P4 on prod build |
| Writers keep assembling | Happy path | FR-4 | §14 | migration | RPC | T4, T5, P1, P2 | Owner assembles after deploy |
| Personal owners can assemble | (RPC) | FR-4 | §14 | migration | RPC | T6 | — (no studio route) |
| No oracle | API | FR-3 | §14 single raise | migration | 42501 | T7 | — |
| Hardened definer | — | FR-5 | §14 | migration | grants | T8, T10 | — |
| Refusal readable | Assemble (viewer) | FR-7 | §15 returnRefusals | action, provider, toolbar | ActionResult | P3 | §27 |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Chosen, and why |
|---|---|---|
| Where the check lives | (a) only in the action; (b) only in the RPC; (c) both | **(b).** The RPC is reachable directly, so (a) cannot be enough. (c) keeps two rules that drift, and the drift is what let viewers through |
| `p_user_id` | (a) drop it; (b) keep it with `default null`, refuse if non-null and ≠ `auth.uid()`, remove later; (c) keep and ignore | **(a)**, recommended. A parameter that means nothing invites being trusted again, and the deploy window is one deploy. (b) has no window but needs a follow-up migration (Decision 1) |
| Rule | (a) `can_write_project`; (b) `can_edit_project` (owner/admin, matching `edit_projects_delete`) | **(a)**, the owner's rule for project content. (b) would refuse members who can edit clips today (Decision 2) |
| Refusal SQLSTATE | `42501` vs a custom `P0001` with a message match | **`42501`**, as KB-27 did for canon. Code-based mapping, not string matching |
| UI for non-writers | (a) show the refusal after the click; (b) hide or disable the button for non-writers | **(a)** now: small, and it covers every caller. (b) needs the role on the client and is a separate UX change (Decision 3) |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| Team members relied on assembling without a project row | They are refused after deploy | `warn` 42501 logs; the user reports it | Owner decision; the refusal says what role is needed | Add them to `project_members` (project settings → members) |
| Deploy window: `PGRST202` | Assemble fails for minutes | `error` logs | Ship together | Decision 1(b) |
| KB-27's inventory test conflicts | Red CI on the second merge | CI | Called out in both PRs | Update the one line |
| KB-28 reverted after this merges | Runtime `42883`, assemble broken | `error` logs | Stacked PR enforces the order | Revert this too |
| `search_path=''` breaks an unqualified name in the copied body | Runtime error | pgTAP T4/T5 run the full body with tracks, clips, keyframes and sync groups | Full-payload fixture in T4 | — |

## 31. Open Questions and Assumptions

- **Q1 (Decision 1):** drop `p_user_id` now, or keep it for one release? *Assume: drop.*
- **Q2 (Decision 2):** should *replacing* an existing timeline need owner/admin, to match `edit_projects_delete`? *Assume: no, use `can_write_project` for both create and replace.*
- **Q3 (Decision 3):** hide the button for non-writers? *Assume: no, show the refusal (this PR).*
- **Q4 (Decision 4):** the three sibling edit-suite RPCs (`batch_save_edit_project`, `create_edit_project_with_tracks`, `split_edit_clip`). **Now tracked as KB-62,** which has its own teammate and the same pattern. KB-62 stacks on this branch, and the file ownership split is: `batchAssembleAction`, `runAutoAssembly` + assembly state, and the Auto-Assemble button/error span are KB-40's; `batchSaveAction`, `performSave` and the save-status span are KB-62's.
  - They are SECURITY DEFINER with **no** check, `search_path=public`, and **not** granted to `authenticated`. That means auto-save, split and "create project" in the Edit Suite fail today for everyone with `permission denied` (measured at the RPC as the owner; the UI path for these was not driven).
  - *Assume: out of KB-40's scope.* The lead should assign a new KB. The obvious "fix" of granting them would open three more cross-tenant writes, so it must add `can_write_project` first. `batch_save_edit_project` also takes `jsonb` parameters while the action sends `JSON.stringify` output, the double-encoding bug fixed for assemble on 2026-02-26 (read, not run).
- **Q5 (Decision 5):** `remove_episode_from_threads_touched`. *Assume: out of KB-40's scope.*
  - **What it is.** It has no check, no `search_path` (KB-27 pins it to `''`), and no grant to `authenticated`.
  - **What breaks today.** The single-episode reset calls it over RPC in three places (`packages/features/episodes/src/server/actions.ts:1269`, `:1901`, `:2044`), so each of those calls fails with `42501` and a "non-fatal" warning. Stale episode ids stay in other threads' `episodes_touched`. Measured: `permission denied for function`.
  - **Why not here.** It is canon and reset code, which KB-27 is changing in the same function, not the edit suite.
  - **Recommendation.** A new KB, taken after KB-27 merges. Add `v_uid := auth.uid()`, require the episode to belong to `p_project_id` and `public.can_write_project(p_project_id)`, raise `42501` otherwise, and only then grant it to `authenticated`.
  - **Bulk reset still works.** The check inside it still passes when `bulk_reset_episodes_to_stage` calls it: `auth.uid()` is the caller's even inside a definer function, and bulk reset has already required `can_write_project` for every episode (KB-27).
  - **Never grant it without the check.**
- **Q6 (Decision 6):** the KB-40 FILM-CC-04 entry does not exist on this branch's base. *Assume:* if KB-27 has merged before this PR opens, rebase and flip its entry to Fixed plus one Fixed-table row. Otherwise add only the Fixed-table row and a note, and KB-27 or the lead reconciles on merge.
- **Assumption:** no service-role or worker path calls this function. Checked by grep across `apps` and `packages`, with the positive control in §8.

## 32. Implementation Plan

1. **Migration** (§14). Then, under the DB lock: `db reset`, typegen, and the pgTAP file written and run **against the pre-fix function first**. The migration file is temporarily moved aside, and the red T1–T3, T6, T9 and T10 are recorded. Then with the migration applied: all green. Then the mutation guards in `kb-40.json`, each run `RED`.
2. **Action and client** (§15): `batch-actions.ts`, `auto-assemble.ts`, `edit-suite-provider.tsx`, `toolbar.tsx`. Then `pnpm typecheck` and the KB-6 guard test.
3. **Playwright** spec on dev (P1–P4). Red first: the fix is reverted in the action and migration and P3/P4 are watched go red. Then restored. Then the production build (§27), sandboxed, with P3/P4 and the red check. Then evidence screenshots.
4. **Direct-attack re-run** of `repro.sh`, with the before/after table.
5. **Class sweep** written into the PR: the Q4/Q5 findings for the lead's new KB numbers.
6. **KB record** (Decision 6), `pnpm lint:fix`, `pnpm format:fix`, commit, and a PR stacked on #313.

## 33. Definition of Done

- A1 and A2 return 403 as a second real user, and the victim timeline survives.
- Owner and member assemble through the real UI. Viewer and account-only member see the sentence on a production build.
- pgTAP T1–T10 are green, with the red run recorded. Mutation guards are `RED`.
- Types are regenerated. Typecheck, lint and format are clean. The KB-6 guard is green.
- Screenshots of P1–P4 after the action are in the PR.
- The FILM-CC-04 record is updated (Decision 6), and the sibling findings are handed to the lead.

## 34. Final Consistency Pass

**Forward.** A stranger can wipe any timeline, so writes must follow the owner's rule. Writers click Auto-Assemble and get a timeline; others get a sentence. The RPC derives the caller from the JWT and checks `can_write_project` before deleting. There is one migration and a thin action. pgTAP proves the rule, Playwright proves the page, and the repro proves the attack is closed. Ship with #313 first, then this, with app and DB together.

**Reverse.** In production, the function refuses everyone but project owners, admins and members, before any delete. The only UI caller maps that refusal to a sentence. Writers see no change, apart from personal-account owners who were wrongly refused and now succeed. Viewers and account-only members lose a capability the owner's rule says they should not have had, and they are told why. This matches §1.
