# KB-18 — Verifying or disputing a fact is always refused: Engineering Design Document

| | |
|---|---|
| Ticket | KB-18 (`specs/cross-cutting/FILM-CC-04-known-bugs.md`, `## KB-18`) |
| Related | FILM-1121 (Fact Management UI), FILM-1123 (Fact-Checker role), FILM-1122, FILM-1140, FILM-1143 (partial on this entry); FILM-1120 (queued after this) |
| Branch / base | `fix/kb-18-fact-verify-dispute` / `origin/main` (49b851d6) |
| Size | S–M: one migration (one function, no policy change), three actions, two components, one page |
| Author | teammate `kb-18`, 2026-09-23 |

---

## 1. Start With the User

**Who.** The owner or an admin of a documentary project: the person who decides
which claims the film may rely on. Today that is the owner themself (sole first
end-to-end user).

**Problem.** They keep a Fact Library of claims with citations. Each claim is
`Unverified` until someone who is allowed to vouch for it either **verifies**
it (it can be used by generation and by the fact-checker) or **disputes** it
(it is kept, marked as wrong, with the reason).

**Before (measured, §8).** Clicking *Verify → Confirm Verified* or *Mark
Disputed* shows the toast "Failed to verify fact" / "Failed to dispute fact",
closes the dialog, throws away the notes the user typed, and changes nothing.
This happens to everyone, the project owner included. No fact in any project can
ever be verified, so season analysis never receives facts and the fact-checker
always exits with "cannot fact-check".

**After.**

- An owner or admin of the project opens an unverified fact, optionally writes a
  note, and clicks **Confirm Verified**. They see "Fact verified", the dialog
  closes, and the card now shows **Verified**. The fact's detail page says
  **Verified by *their display name*** and the date.
- The same people can write a reason and click **Mark Disputed**. They see
  "Fact marked as disputed" and the card shows **Disputed**; the detail page
  shows the reason.
- Both states **persist**: they survive reload, sign-out and another user
  viewing the page. The verifier's name stays even if their account is later
  deleted (KB-1 snapshot, already in place).
- A project member or viewer is **not offered** Verify (the button is absent),
  and if they reach the action anyway, it is refused with a sentence they can
  read.
- If the fact changed under them (someone else verified or disputed it in
  another tab, or it was deleted), they get a sentence saying so, the dialog
  **stays open with their notes intact**, and nothing is overwritten.

**Success** = the status the user chose is stored, attributed to them (verify),
and shown after reload. **Failure** = a readable refusal, no change, and no lost
typing. **What does not persist**: an unsent note in a dialog that the user
cancels.

## 2. Define the Complete User Journey

| # | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| J1 | Opens *Project → Settings → Fact Library* (`/home/[account]/studio/[projectSlug]/settings/facts`) | RSC loads facts (first 50, RLS-scoped) and the caller's project role | List of fact cards with status badges; **Verify** on unverified cards only if the caller is project owner/admin | J2, J6, leave |
| J2 | Clicks **Verify** on a card | Opens `FactVerificationDialog` for that fact | Dialog with claim, citation, source link, Notes box, *Confirm Verified*, *Mark Disputed* (disabled until notes non-empty), *Cancel* | J3, J4, J5 |
| J3 | Clicks **Confirm Verified** | `verifyFactAction` → `set_fact_verification(verified)` | Buttons disabled while pending; on success toast "Fact verified", dialog closes, list refreshes with **Verified** badge | J2 on another fact, J6 |
| J4 | Types a reason, clicks **Mark Disputed** | `disputeFactAction` → `set_fact_verification(disputed)` | Toast "Fact marked as disputed", dialog closes, badge **Disputed** | J2, J6 |
| J5 | Clicks **Cancel** / Esc / outside | Dialog closes; nothing sent | Unchanged list; typed notes discarded | J2 |
| J6 | Opens **Details** | RSC reads the fact | Status badge; Verification Notes; for verified: "Verified by *name* · *date*" | back to J1 |
| J7 | Reloads / returns later | Fresh RSC read | Same statuses as stored | — |
| J8 | Session expired, then J3/J4 | `enhanceAction` auth redirects to sign-in (#264 behaviour) | Sign-in page; nothing changed | sign in, J1 |

Entry points: Settings → Fact Library link (visible to project owner/admin,
`settings/page.tsx:389`), direct URL, Research Hub facts card (FILM-1140).
Preconditions: signed in, member of the team account (page's SELECT), fact
exists in this project.

## 3. Explicitly Define the Happy Path

1. **User** (project owner) opens the Fact Library. **System** reads the
   project by slug, `getProjectFactsAction` (RLS), and `getProjectPermissions`
   (`project_members` role). **Returns** facts + `canReview = true`. **User
   sees** cards, *Verify* on each unverified one.
2. **User** clicks *Verify* on fact A, types "Checked against the 2020
   edition", clicks *Confirm Verified*.
3. **System** receives `{ factId, projectId, basePath, verificationNotes }`,
   validates with Zod, requires a session, calls
   `rpc('set_fact_verification', { target_fact_id, outcome: 'verified', notes })`
   with the **user's** client.
4. **DB** (security definer): locks the row, confirms the caller is owner/admin
   on that fact's project via `public.can_edit_project`, confirms the current
   status is `unverified`/`pending_review`, and updates
   `verification_status='verified', verified_by=auth.uid(), verified_at=now(),
   verification_notes=notes`. Existing BEFORE triggers stamp
   `updated_by=auth.uid()`, `updated_at`, and `verified_by_name` from the
   verifier's personal account name.
5. **Action** returns `{ ok: true, data: { status: 'verified' } }` and
   revalidates the page. **Client** toasts "Fact verified", closes the dialog,
   `router.refresh()`.
6. **User sees** fact A with **Verified**. On *Details*: "Verified by Owner Name
   · 23/09/2026" and the note.

Success because the row now says `verified`, by the caller, and every
downstream reader that filters on `verified` (season analysis, researcher,
fact-checker) now receives it.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| Caller is project **member/viewer** or account member not on the project, calls the action (button hidden, so only via crafted request or stale tab after demotion) | RPC raises `42501` | Toast: "Only the project's owner or admins can verify or dispute facts." Dialog stays open | Ask an owner/admin | Unchanged |
| Caller has no access to the account at all (stranger) | RPC raises `P0002` (same as missing — no existence oracle) | "This fact no longer exists. Reload the page." | Reload | Unchanged |
| Fact **deleted** in another tab | Row missing → `P0002` | Same sentence as above | Reload | Unchanged |
| Fact **already verified / disputed / retracted** (another tab, another user) | Row locked, status check fails → `55000` | "This fact is already *verified*. Reload the page to see its current state." Dialog stays open, notes kept | Reload | Whatever the other writer set |
| Two reviewers click at the same time | `select … for update` serialises; the second sees the first's status → `55000` | First: success. Second: "already …" | Reload | First writer wins; no interleaving |
| **Dispute with blank reason** | Button disabled client-side; Zod `min(1)` server-side; RPC also refuses blank (`22023`) | Button stays disabled; if forced: "A reason is required to dispute a fact." | Type a reason | Unchanged |
| Outcome other than verified/disputed sent to the RPC directly | `22023` | n/a (not reachable from UI) | — | Unchanged |
| Double-click Confirm | Buttons disabled while pending; a second request that lands anyway gets `55000` | One success toast; possibly one "already verified" | none needed | Verified once |
| Session expired | Auth redirect before the handler | Sign-in page | Sign in | Unchanged |
| Network failure / server crash / DB down | Action throws (not a refusal; stays thrown per KB-6 `returnRefusals`) → monitored | Toast fallback "Could not verify the fact. Try again." Dialog stays open, notes kept | Retry | Unchanged |
| Invalid UUID in input | Zod rejects before handler | Fallback toast (not reachable from UI) | — | Unchanged |
| Back navigation / refresh mid-request | Request completes server-side or not at all (single statement) | On return, the list shows the stored truth | — | Atomic |
| Edit claim/source of a verified fact later (existing trigger) | `enforce_verified_facts_update_rules` resets to unverified, drops verifier & name | Badge back to Unverified | Re-verify | Unverified |
| Verifier's account deleted later | FK sets `verified_by` NULL; name snapshot kept (KB-1) | "Verified by *name*" still shown | — | Verified |
| **Delete** (sibling, §8 finding 3) by account admin not on the project | Today: silent no-op reported as success. After: refused | "Only the project's owner or admins can delete facts." | — | Unchanged |

## 5. Establish the User-Facing Contract

- **Inputs**: fact id (from card), optional notes (verify), required reason
  (dispute).
- **UI states**: idle; pending (all three dialog buttons disabled); success
  (toast + dialog closes + list refresh); refusal (error toast, dialog **open**,
  notes **kept**); unexpected failure (fallback error toast, dialog open).
- **Messages (exact text, asserted in tests)**:
  - success: "Fact verified", "Fact marked as disputed" (existing strings)
  - `FORBIDDEN`: "Only the project's owner or admins can verify or dispute facts."
  - `NOT_FOUND`: "This fact no longer exists. Reload the page."
  - `ALREADY_REVIEWED`: "This fact is already {verified|disputed|retracted}. Reload the page to see its current state."
  - `REASON_REQUIRED`: "A reason is required to dispute a fact."
  - fallback: "Could not verify the fact. Try again." / "Could not dispute the fact. Try again."
  - delete `FORBIDDEN`: "Only the project's owner or admins can delete facts."; delete `NOT_FOUND`: reuse NOT_FOUND.
- **Permissions/visibility**: *Verify* button rendered only when the caller is
  project owner/admin **and** the fact is `unverified` or `pending_review`
  (`isReviewable` in `fact-constants.ts`, the function's own rule — the card
  used to check `unverified` only). Delete menu item only for owner/admin
  (Decision 4).
- **Data displayed**: status badge (list and detail); detail page adds
  "Verified by {verified_by_name ?? 'a deleted user'} · {date}" when
  `verified_at` is set.
- **Editable by user**: notes/reason only; `verified_by` is never user input.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Trigger / precondition | Processing & state change | Success | Failure | Verification |
|---|---|---|---|---|---|---|
| FR-1 | A project owner/admin can verify an `unverified`/`pending_review` fact | Confirm Verified | status→verified, verified_by=caller, verified_at=now, notes=input, name snapshot | Row verified, attributed | Refusal as value | pgTAP T1–T2, E2E E1 |
| FR-2 | A project owner/admin can dispute such a fact with a non-blank reason | Mark Disputed | status→disputed, notes=reason, verified_by/at NULL | Row disputed | Refusal as value | pgTAP T3–T4, E2E E1 (second action) |
| FR-3 | `verified_by` is always the caller; no input can name another user | any | RPC has no verifier parameter; sets `auth.uid()` | — | — | pgTAP T9–T10 |
| FR-4 | Project members, viewers, account-only members and strangers cannot verify/dispute by any path | RPC or direct UPDATE | refused | — | 42501 / P0002 | pgTAP T5–T8, T11 |
| FR-5 | The member UPDATE policy is not loosened | — | no policy change | direct UPDATE to `verified` still refused for everyone incl. owner | — | pgTAP T11 |
| FR-6 | Only the allowed transitions happen; a stale review is refused, not applied | status ≠ unverified/pending_review | 55000 | — | readable refusal | pgTAP T12–T14, E2E E2 |
| FR-7 | Every refusal reaches the user as written in a **production build** | refusal | `ActionRefusal` → `returnRefusals` → `{ok:false,error}` → `refusalMessage` | exact text on screen, never the generic sentence | — | E2E E2 on `test:prod`, unit U1 |
| FR-8 | A refused or failed review keeps the dialog open with the typed notes | refusal/failure | client | notes still in textarea | — | E2E E2 |
| FR-9 | The verified fact shows who verified it after reload | detail page | reads `verified_by_name` | name visible | — | E2E E1 |
| FR-10 | Verify is offered only to callers who may verify | page load | `getProjectPermissions(projectId).canEdit` | button absent for member | — | E2E E3 |
| FR-11 | Delete uses the same project rule and reports a no-op honestly (Decision 3) | delete | `can_edit_project` pre-check, `.delete().select('id')`, 0 rows → NOT_FOUND | — | refusal as value | unit U2, pgTAP T15 |

## 7. Define Non-Functional Requirements

- **Latency**: one RPC round trip (was one UPDATE + two SELECTs for the role
  check); p95 < 150 ms locally for the action. Not load-sensitive.
- **Consistency**: single statement per review inside one function call; row
  lock serialises concurrent reviewers.
- **Security**: definer function with `search_path = ''`, explicit role check,
  `execute` revoked from `public`/`anon`, granted to `authenticated` only.
- **Observability**: refusals are expected outcomes, not logged as errors;
  unexpected failures stay thrown to `onRequestError` / monitoring.
- **Accessibility**: see §21. **i18n**: the fact UI is English-only today
  (hard-coded strings); unchanged. **Compatibility**: additive migration; no
  column/policy change. **Cost**: nil.

## 8. Analyze the Existing System

**Components.**
- Actions: `packages/features/episodes/src/server/fact-actions.ts`
  — `requireProjectRole` (`:22-49`) checks `accounts_memberships` owner/admin;
  `verifyFactAction` (`:182-213`) and `disputeFactAction` (`:219-248`) then
  UPDATE with the user's client and **throw** on error; `deleteFactAction`
  (`:254-279`) same pattern.
- UI: `fact-library.tsx:81-119` wraps each action in its own `startTransition`
  and swallows every error into "Failed to verify/dispute fact";
  `fact-verification-dialog.tsx:45-69` awaits a handler that therefore never
  rejects, so it **always** clears notes and closes; `fact-card.tsx:111` shows
  *Verify* for every unverified fact regardless of role.
- Pages: `settings/facts/page.tsx` (list), `settings/facts/[factId]/page.tsx`
  (detail; shows `verified_at` date `:252-257`, not who).
- DB: `verified_facts` (`20260211100000`), status enum and UPDATE policy
  (`20260211100003_pr178_github_review_fixes.sql:95-111`):
  `USING` = `project_members` role in (owner, admin, member);
  `WITH CHECK` = new status in (unverified, pending_review) **and**
  `verified_by IS NULL and verified_at IS NULL`. DELETE policy = project
  owner/admin. SELECT/INSERT = account membership.
  Triggers (BEFORE UPDATE, name order): `enforce_verified_facts_update`
  (`20260921205124`: project move/created_by guard, content-edit reset, stamps
  `updated_by = auth.uid()`), `set_verified_facts_updated_at`,
  `verified_facts_snapshot_verifier_name` (`20260921211043`).
  No `schemas/` file exists for this table (only a mention in
  `38-revenue-tracking.sql:251`), so there is nothing to mirror.
- Project roles: `project_members` (owner auto-added by `add_project_owner`,
  `20251016143639_projects.sql:430-448`); `public.can_edit_project(uuid)`
  (`20251217180000`) = project owner/admin, security definer, granted to
  `authenticated`; `getProjectPermissions` (`packages/features/projects/src/lib/server/project.queries.ts:271`) restates it in TS for the settings page and Fact Library link.
- KB-6 helpers: `ActionRefusal`, `unwrap`, `refusalMessage`
  (`packages/next/src/refusals/action-result.ts`), `returnRefusals`
  (`with-refusals.ts:53`).

**Reproduced 2026-09-23 on this branch (= main), under the DB lock, after `supabase db reset`.**
pgTAP file run with `supabase test db` (kept out of the repo): 12/12 assertions
hold —

| # | As | Statement the app sends | Result |
|---|---|---|---|
| 1 | project owner (also account owner) | verify UPDATE | `42501 new row violates row-level security policy` |
| 2 | project owner | dispute UPDATE | `42501` |
| 3–4 | project admin | verify / dispute | `42501` |
| 5 | project member | verify | `42501` (correct for members) |
| 6 | project member | `set verification_notes = …` | succeeds (policy USING admits members) |
| 7 | account owner **not** on the project | verify UPDATE | **no error, 0 rows** |
| 8 | same | DELETE | **no error, 0 rows** |
| 9 | same | SELECT both facts | sees both (SELECT is account-scoped) |
| 10–11 | postgres | read back | still `unverified`, still present → the action would have reported **success** for a no-op |

Through the UI (dev server :3107, seeded team + project, signed in as the
project owner): *Confirm Verified* → toast **"Failed to verify fact"**; *Mark
Disputed* → toast **"Failed to dispute fact"**; the dialog closed both times
and the note was lost; both rows read back `unverified`. Server log:
`Error: Failed to verify fact: new row violates row-level security policy for table "verified_facts"` (`fact-actions.ts:202`), likewise `:237`.
On a production build the page shows the same fallback toasts (the client
ignores the thrown message), so KB-6's generic sentence is not what users saw
here — the fallback was — but the underlying refusal was still unreadable.

**Findings beyond the entry.**
1. **Two role models disagree.** The actions check *account* owner/admin; the
   UPDATE/DELETE policies check *project* role. So an account owner who is not on
   the project passes the action's check and then silently changes nothing (7, 8),
   and a project owner who is only an account *member* is refused by the action
   though RLS would admit them.
2. **Silent no-op reported as success** for verify and delete (7, 8, 10, 11).
3. **The dialog loses the user's notes on every failure** (handlers never reject).
4. **Detail page cannot show who verified**, though `verified_by_name` exists.

## 9. Define the Desired System Behavior

| User action | Application logic | Service interaction | Data operation | Response | Visible |
|---|---|---|---|---|---|
| Load library | page: parallel `getProjectFactsAction` + `getProjectPermissions` | Supabase (user client) | SELECTs (RLS) | facts, `canReview` | cards; Verify only if `canReview` |
| Confirm Verified | `verifyFactAction` (Zod, auth) | `rpc set_fact_verification(id,'verified',notes)` | 1 locked UPDATE + triggers | `{ok:true}` / `{ok:false,error}` | toast; close or stay open |
| Mark Disputed | `disputeFactAction` | same RPC, `'disputed'`, reason | same | same | same |
| Delete | `deleteFactAction` | `rpc can_edit_project` → `.delete().select('id')` | 1 DELETE (RLS) | same shape | toast |
| Details | RSC | `select('*')` | — | row incl. `verified_by_name` | "Verified by …" |

## 10. High-Level Architecture

No new services. The change moves the **authority for a review** from a
TypeScript pre-check plus an RLS-bound UPDATE (which could never agree) into one
database function that is the only path to `verified`/`disputed` for
end users.

- **Trust boundary**: the browser → server action (Zod, session) → Postgres
  function (role + transition rules) → table (triggers). The function is the
  guard; the action only translates outcomes into sentences. It is callable
  directly through PostgREST by any authenticated user, so it must be safe on
  its own — which is why the rule lives there and not in TS.
- **Why a definer function and not a role-scoped policy** — §29.
- **Why not the service-role/admin client** — the admin client bypasses all
  RLS for the whole statement; a bug in the TS check would let anyone verify
  anything. The function narrows privilege to one column set on one row.

## 11. Architecture and Flow Diagrams

```
Browser (FactVerificationDialog)
   │ onVerify(factId, notes)  ── awaits; rejects on refusal
   ▼
FactLibrary.handleVerify ── unwrap(await verifyFactAction(...))
   │
   ▼  server action (returnRefusals(enhanceAction(...)))
verifyFactAction ── Zod ── auth ── client.rpc('set_fact_verification', …)
   │                                    │
   │                                    ▼  SECURITY DEFINER, search_path=''
   │                     ┌──────────────────────────────────────────┐
   │                     │ select … from verified_facts where id=…  │
   │                     │   for update                    ─ none ──┼─► P0002
   │                     │ can_edit_project(project_id)?   ─ no  ───┼─► has_role_on_account? no → P0002
   │                     │                                          │                        yes → 42501
   │                     │ status in (unverified,pending_review)? no┼─► 55000
   │                     │ outcome/reason valid?           ─ no  ───┼─► 22023
   │                     │ UPDATE status, verified_by=auth.uid(), … │
   │                     └───────────────┬──────────────────────────┘
   │                                     ▼ BEFORE UPDATE triggers (unchanged)
   │                enforce_verified_facts_update → set_…_updated_at → …snapshot_verifier_name
   ▼
{ ok: true } → toast + close + router.refresh()
{ ok: false, error } → unwrap throws ActionRefusal → dialog catch → toast(refusalMessage) ; stays open
```

State transitions — §17.

## 12. End-to-End Data Flow

Source: the reviewer's click + typed notes → **Validation**: Zod (uuid, notes
optional string, reason `min(1)`), RPC re-validates reason/outcome →
**Processing**: role + transition checks under a row lock → **Persistence**:
`verified_facts` row (`verification_status`, `verified_by`, `verified_at`,
`verification_notes`, trigger-set `updated_by`, `updated_at`,
`verified_by_name`) → **Retrieval**: RSC list/detail, `getVerifiedFactsAction`
(`external-context-actions.ts:401`), researcher (`researcher.ts:80`),
fact-checker (`fact-checker.ts:81`), episode facts panel → **Consumer**: the
user, season analysis, story agent skills.

Loss/duplication points: none new. Concurrency handled by the row lock (no
lost update). Stale view: the list is RSC-rendered and refreshed after each
review; a stale tab is refused (55000), never applied. Reads are per-project
lists capped at 50 by the page (pre-existing FILM-1121 gap; not changed here).

## 13. Data Model

`verified_facts` (authoritative for fact status). Relevant invariants after
this change:
- **I1** `verification_status = 'verified'` ⇒ `verified_at` not null and
  `verified_by` was the reviewing user at write time (may later be NULL after
  account deletion, with `verified_by_name` kept).
- **I2** `verification_status = 'disputed'` ⇒ `verified_by`, `verified_at`
  NULL; `verification_notes` holds the reason.
- **I3** Only project owner/admin sessions (or service_role/postgres) can move a
  fact into `verified`/`disputed`.
- `verified_by_name` is derived (trigger), never input.
- `updated_by` records the last writer (the disputer, for a dispute) — trigger.

## 14. Database Design and Changes

**One new migration** `apps/web/supabase/migrations/20260923042421_kb18-fact-verification.sql`
(first written as `20260923024455_…`; renamed on rebase so it sorts after
main's `20260923025438_generation_jobs_refinement_job_types.sql`, since
`supabase db push` refuses a migration older than the newest applied):

```sql
create or replace function public.set_fact_verification(
  target_fact_id uuid,
  outcome public.verification_status_enum,
  notes text default null
) returns public.verification_status_enum
language plpgsql
security definer
set search_path = ''
as $$
declare
  fact record;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if outcome not in ('verified', 'disputed') then
    raise exception 'A review can only verify or dispute a fact' using errcode = '22023';
  end if;

  if outcome = 'disputed' and coalesce(btrim(notes), '') = '' then
    raise exception 'A reason is required to dispute a fact' using errcode = '22023';
  end if;

  select f.id, f.project_id, f.verification_status, p.account_id
    into fact
    from public.verified_facts f
    join public.projects p on p.id = f.project_id
   where f.id = target_fact_id
     for update of f;

  if not found then
    raise exception 'Fact not found' using errcode = 'P0002';
  end if;

  if not public.can_edit_project(fact.project_id) then
    if not public.has_role_on_account(fact.account_id) then
      raise exception 'Fact not found' using errcode = 'P0002';  -- no existence oracle
    end if;
    raise exception 'Only project owners and admins can review facts' using errcode = '42501';
  end if;

  if fact.verification_status not in ('unverified', 'pending_review') then
    raise exception 'Fact is already %', fact.verification_status using errcode = '55000',
      detail = fact.verification_status::text;
  end if;

  update public.verified_facts
     set verification_status = outcome,
         verified_by        = case when outcome = 'verified' then auth.uid() end,
         verified_at        = case when outcome = 'verified' then now() end,
         verification_notes = nullif(btrim(notes), '')
   where id = target_fact_id;

  return outcome;
end;
$$;

revoke all on function public.set_fact_verification(uuid, public.verification_status_enum, text)
  from public, anon;
grant execute on function public.set_fact_verification(uuid, public.verification_status_enum, text)
  to authenticated;

comment on function public.set_fact_verification(uuid, public.verification_status_enum, text) is
  'KB-18: the only end-user path to verified/disputed. Project owner/admin only; verified_by is always auth.uid().';
```

(Final SQL may differ in wording; the rules above are the design.)

- **No policy change.** The UPDATE policy stays as is (KB-18 "do not loosen";
  KB-1's tests rely on it). A comment on the policy is updated to name the
  function as the verification path.
- **No column / index / constraint change.** No backfill: every existing row
  is `unverified` or was written by a privileged path.
- **Personal-account projects**: `has_role_on_account` covers team membership;
  personal-account projects have their owner in `project_members` via
  `add_project_owner`, so `can_edit_project` admits them. (The facts routes
  exist only under `[account]` today.)
- **Locking**: one row lock for one statement. No table locks, migration is
  instantaneous. **Rollback**: `drop function public.set_fact_verification(...)`;
  the actions would then fail exactly as today.
- Types: `pnpm supabase:web:typegen` adds the function to both
  `database.types.ts` copies (generated, never hand-edited).
- No `schemas/` mirror: `verified_facts` has no schema file (§8).

## 15. Low-Level Design

**`packages/features/episodes/src/server/fact-actions.ts`**
- Delete `requireProjectRole` (the account-role check is the defect).
- New pure module `packages/features/episodes/src/server/fact-review-refusals.ts`
  (no `server-only` so it is unit-testable; no secrets):
  ```ts
  export function factReviewRefusal(
    error: { code?: string; details?: string | null },
    action: 'verify' | 'dispute' | 'delete',
  ): string | null   // user sentence for a known code, null otherwise
  ```
  Maps `42501`→FORBIDDEN (delete variant for delete), `P0002`→NOT_FOUND,
  `55000`→ALREADY_REVIEWED(details), `22023`→REASON_REQUIRED (dispute).
  One place owns the codes-to-words table.
- `verifyFactAction` = `returnRefusals(enhanceAction(async (data) => {
  const { data: status, error } = await client.rpc('set_fact_verification', {...});
  if (error) { const m = factReviewRefusal(error, 'verify'); if (m) throw new ActionRefusal(m); throw new Error(...) }
  revalidatePath(data.basePath); return { status }; }, { schema, auth: true }))`.
- `disputeFactAction` likewise with `'disputed'`.
- `deleteFactAction` (Decision 3): `rpc('can_edit_project')` → false ⇒
  `ActionRefusal(FORBIDDEN_DELETE)`; `.delete().eq(...).select('id')`; zero
  rows ⇒ `ActionRefusal(NOT_FOUND)`; wrapped in `returnRefusals`.
- `getFactByIdAction` / `getProjectFactsAction` unchanged (reads).

**`fact-library.tsx`**
- `handleVerify` / `handleDispute` become plain async functions (no inner
  `startTransition`, no catch): `await unwrap(verifyFactAction(...))`,
  `toast.success(...)`, `router.refresh()`. They **reject** on refusal so the
  dialog can react.
- `confirmDelete`: `unwrap` + `toast.error(refusalMessage(e, 'Could not delete the fact. Try again.'))`.
- New prop `canReview: boolean` → passes `onVerify` only when true; `onDelete`
  only when true.

**`fact-verification-dialog.tsx`**
- Catch shows `toast.error(refusalMessage(error, fallback))`; notes are
  cleared and the dialog closed **only on success**. `data-test` on textarea
  and the three buttons.

**`settings/facts/page.tsx`**: add `getProjectPermissions(project.id)` to the
existing `Promise.all`; pass `canReview={permissions.canEdit}`.

**`settings/facts/[factId]/page.tsx`**: render "Verified by {name} · {date}"
when `verified_at` is set (`verified_by_name ?? 'a deleted user'`);
`data-test="fact-verified-by"`.

**`fact-card.tsx`**: `data-test` on the card root (`fact-card`), status badge
(`fact-status`), Verify button (`fact-verify`).

Idempotency: a repeated request is refused (`55000`), never re-applied.
Transactions: PostgREST runs each RPC in its own transaction.

## 16. API and Event Design

**RPC** `POST /rest/v1/rpc/set_fact_verification` (PostgREST), authenticated
JWT required.
- Request: `{ target_fact_id: uuid, outcome: 'verified'|'disputed', notes?: text }`
- Response 200: `"verified"` | `"disputed"`.
- Errors (PostgREST maps SQLSTATE → HTTP): `42501`→403 (not project owner/admin
  or not signed in; `anon` gets permission denied), `P0002`→404, `55000`→400
  (`details` = current status), `22023`→400.
- Idempotency: non-idempotent by design (second call refused). No pagination,
  no versioning concerns (new function).

**Server actions** (return type changes from `{ success: true }` to
`ActionResult<{ status }>`): `verifyFactAction`, `disputeFactAction`,
`deleteFactAction`. Only consumer: `fact-library.tsx` (grep:
`packages/features/episodes/src/components/facts/fact-library.tsx` is the only
importer). No events.

## 17. State and Lifecycle Design

```
             verify (owner/admin)            
 unverified ─────────────────────► verified ──(content edit: trigger)──► unverified
     │   ▲                                                             
     │   └───────────(content edit: trigger)──────── disputed ◄───┐
     │ dispute (owner/admin, reason)                               │
     └─────────────────────────────────────────────────────────────┘
 pending_review ── same two transitions as unverified
 retracted: no end-user transition (terminal for this feature)
```

Valid via the RPC: {unverified, pending_review} → {verified, disputed}.
Refused (55000): from verified, disputed, retracted (Decision 2 may widen
verified↔disputed). Content edits resetting to `unverified` are the existing
trigger, unchanged. Side effects: `verified_by_name` snapshot on verify; nothing
else (no notifications, no events).

## 18. Failure and Error Handling

| Operation | Failure | System | User | Recovery |
|---|---|---|---|---|
| verify/dispute | not owner/admin | 42501 → ActionRefusal | FORBIDDEN sentence, dialog open | ask owner |
| verify/dispute | missing / invisible | P0002 | NOT_FOUND | reload |
| verify/dispute | stale status / concurrent | 55000 | ALREADY_REVIEWED | reload |
| dispute | blank reason | UI disabled; Zod; 22023 | REASON_REQUIRED | type reason |
| any | DB/network/unknown | thrown, logged by Next `onRequestError` | fallback sentence, dialog open | retry |
| delete | not owner/admin | pre-check | FORBIDDEN_DELETE | — |
| delete | 0 rows | refusal | NOT_FOUND | reload |

No retries server-side (a user action). No partial state: single UPDATE.

## 19. Security

- **Authorization rule** lives in Postgres (`can_edit_project` = project
  owner/admin), shared with the DELETE policy, `projects_update` and the
  settings page's `canEdit` — one rule, not a second copy.
- **What the fix newly permits**: project owners/admins can now set
  `verified`/`disputed` (intended). Nothing else: the function has no verifier
  parameter (no forging `verified_by`), cannot change any other column, cannot
  move a fact out of `verified`/`disputed`/`retracted`, cannot target a fact the
  caller can't see (P0002, same as missing, so no cross-tenant existence
  oracle), and `anon` cannot execute it.
- **Definer hygiene**: `search_path = ''`, all identifiers schema-qualified,
  `auth.uid()` null-check, `revoke … from public, anon`. The function runs as
  the table owner, so RLS is bypassed *inside* it — the explicit checks above
  replace it; pgTAP asserts each one.
- **Triggers still fire** (they are not RLS): `updated_by = auth.uid()` still
  stamps the real caller, `verified_by_name` still comes from the id. The KB-1
  `pg_trigger_depth() > 1` exception is not reachable (the RPC's UPDATE is at
  depth 1).
- **Policy unchanged**: members still cannot self-verify by direct UPDATE; the
  owner cannot either except through the function (asserted).
- Input: notes are stored as text and rendered by React (escaped). No secrets,
  no production credentials used anywhere.
- Audit: `verified_by` + `verified_by_name` + `updated_by`/`updated_at`.

## 20. Performance and Scale

A review is a human action: at most a few per minute per project. One indexed
PK lookup + join to `projects`, one `project_members` lookup (indexed
`ix_project_members_user_id`), one UPDATE. The facts page adds one cached
`project_members` read (`getProjectPermissions`), run in parallel with the
existing fetch. No bottleneck.

## 21. Accessibility and Client Behavior

- Dialog is Radix `Dialog`: focus trapped, Esc closes, focus returns to the
  *Verify* button. On refusal the dialog stays open, so focus stays in it and
  the typed text is preserved.
- Toasts: sonner live region announces success/refusal text.
- Buttons keep their text labels; `disabled` during pending; the dispute
  button's disabled state is conveyed natively.
- Hidden *Verify* for non-reviewers is removal, not a disabled-without-reason
  control.
- Responsive: no layout change. Localization: unchanged (English literals, as
  the rest of this UI).

## 22. Observability and Operations

- Refusals are expected and not logged as errors (KB-6 convention).
- Unexpected failures are thrown → Next `onRequestError` → monitoring, with the
  Postgres message in the server log (as today).
- **How an operator knows it works**: `select verification_status, count(*)
  from verified_facts group by 1` shows `verified`/`disputed` rows appearing;
  `verified_by_name` is set on every verified row whose verifier still exists.
  Before this fix the local DB held 0 non-unverified rows.
- No new metrics, dashboards or alerts: volume is too low to alert on.

## 23. Configuration and Feature Flags

None. No env vars, no flags: the change fixes a feature that never worked; there
is no working behaviour to protect behind a flag.

## 24. Compatibility

- Additive DB change; old app code keeps failing exactly as today until the new
  code deploys, so migration-before-code ordering is safe, and code-before-
  migration fails with "function not found" → fallback toast (no data harm).
  Deploy order: migration first (normal pipeline order).
- Server action return shape changes; the only caller changes in the same PR.
- Existing rows: untouched. Existing tests: `audit-author-snapshot.test.sql`
  and `authors-deletable.test.sql` write verification as `postgres`; unaffected.
- `@kit/episodes/server` exports keep the same names.

## 25. Migration and Rollout Strategy

1. Merge → CI applies migrations in the Supabase DB job (pgTAP runs there).
2. Deploy: migration, then app (standard). No flag.
3. Validate on the deployed app by the owner: verify one fact, dispute another,
   reload (the runbook is the E2E steps in §26).
4. Rollback triggers: any report of a wrong status or wrong verifier. Rollback:
   revert the PR (app) and `drop function public.set_fact_verification(...)`
   in a follow-up migration. Data rollback: statuses written in the meantime
   are genuine reviews; leave them.

## 26. Testing Strategy

**pgTAP** — new `apps/web/supabase/tests/database/verified-facts-review.test.sql`,
`select plan(N)` (not `no_plan`), each case on its **own fact row** (no chained
state), users: owner (project owner via `add_project_owner`), project admin,
project member, project viewer, account owner not on the project, stranger in
another account.

| T | Case | Expect |
|---|---|---|
| T1 | owner verifies | status verified, `verified_by` = owner, `verified_at` set, `verified_by_name` = owner's name, `updated_by` = owner |
| T2 | admin verifies | verified, by admin |
| T3 | owner disputes with reason | disputed, notes = reason, verifier NULL |
| T4 | admin disputes | disputed |
| T5 | member verify / dispute | `42501` ×2, row unchanged |
| T6 | viewer verify | `42501` |
| T7 | account owner not on project | `42501` |
| T8 | stranger with a real fact id; anyone with a random id | `P0002` both (indistinguishable) |
| T9 | direct UPDATE by member naming owner as `verified_by` | `42501` (policy intact) |
| T10 | owner verifies — `verified_by` is owner even when an attacker-controlled session called it (i.e. no parameter exists): assert function signature has no uuid besides fact id (`function_args`/`has_function`) | pass |
| T11 | direct UPDATE to `verified` by the **owner** | `42501` (policy not loosened) |
| T12 | verify an already verified fact | `55000` |
| T13 | dispute a disputed / verify a disputed fact | `55000` |
| T14 | verify a retracted fact | `55000` |
| T15 | dispute with blank / whitespace reason; outcome `retracted` | `22023` |
| T16 | `anon` calls it | permission denied |
| T17 | verify then edit claim as member (policy path) | back to unverified, name dropped (existing trigger still composes) |

**Red before green (pgTAP):** (a) run the file on `main` → every case fails
(function missing), which only proves the file runs; the meaningful reds are
mutations of the finished function, one at a time, each watched to fail for its
stated reason, then restored: drop the `can_edit_project` check → T5–T7 go
green-to-red; drop the status check → T12–T14 red; drop the visibility branch →
T8 returns 42501 not P0002; replace `auth.uid()` with a parameter → T10 red.

**Unit (vitest, `@kit/episodes`, runs in CI via `scripts/test-units.sh:38`)**
- U1 `fact-review-refusals.test.ts`: every code → exact sentence; unknown code → null.
- U2 `fact-actions.test.ts` (mocked Supabase client): verify/dispute call
  `rpc('set_fact_verification', {...})` with the right outcome and never
  `.update`; a 42501 error yields `{ ok:false, error: FORBIDDEN }`; an unknown
  error **throws**; delete with `can_edit_project=false` refuses, zero-row
  delete refuses NOT_FOUND. (Mocks cannot reject SQL — that is pgTAP's job.)

**E2E (Playwright)** — `apps/e2e/tests/facts/fact-verification.spec.ts` +
`facts.po.ts`, seeded through the API (`seedTeamAccount`, `seedProject` as
owner → project owner, facts via service role, a member via `seedUser` +
`seedMembership` + `project_members` row):
- **E1 happy path, second action asserted**: owner verifies fact A (toast,
  badge Verified) → **then, without reload,** disputes fact B with a reason
  (toast, badge Disputed; asserts the second dialog opened empty and for B) →
  reload → A Verified, B Disputed → A's details show "Verified by {owner name}"
  → rows read back via `readRows` (status, `verified_by` = owner id,
  `verified_by_name`).
- **E2 error state (stale)**: owner opens *Verify* on fact C, types a note; the
  test marks C `verified` via service role ("another tab"); owner clicks
  *Confirm Verified* → error toast contains exactly "This fact is already
  verified. Reload the page to see its current state." and **not**
  `PRODUCTION_SENTENCE`; dialog still open, note still in the textarea; row's
  `verified_by` unchanged (still the other writer).
- **E3 member**: signed in as a project member, the page shows no *Verify*
  button on an unverified fact.
- **Evidence** `fact-verification-evidence.spec.ts` (gated `CAPTURE_EVIDENCE=1`):
  library before; dialog with note; after verify; after dispute (second
  action); detail page with "Verified by"; stale refusal with dialog open;
  member view.

**Red before green (E2E):** run E1 against the unfixed code → fails at the
"Fact verified" toast ("Failed to verify fact" appears — already observed in
§8). Run E2 with the action reverted to *throwing* the refusal on a production
build → the toast shows the fallback instead of the sentence → red. Run E2 with
the dialog's old close-on-any-outcome → note-preserved assertion red.

## 27. Production-Build Verification

- `pnpm --filter web-e2e test:prod -- facts` (builds with `build:test`, serves
  with `start:test`, like CI's ⚫️ Test) — E1–E3 must pass there; E2 is the
  KB-6 assertion and only means something on this build.
- CI: Supabase DB job runs the pgTAP file; unit job runs `@kit/episodes`; ⚫️
  Test runs the facts spec on the production bundle; evidence job regenerates
  screenshots.
- Question answered by E1/E2 on `test:prod`: does the production build store
  the review, show who did it, and show refusals as written? Yes/no with output
  in the PR.

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Prod verification |
|---|---|---|---|---|---|---|---|
| Owner/admin can verify | J3 | FR-1 | §14 RPC, §15 action | `verifyFactAction`, dialog | `set_fact_verification` | T1–T2, U2, E1 | E1 on `test:prod` |
| …and dispute | J4 | FR-2 | same | `disputeFactAction` | same | T3–T4, E1 (2nd) | E1 |
| Verifier cannot be forged | — | FR-3 | no param, `auth.uid()` | RPC | — | T9–T10 | pgTAP in CI |
| Others cannot | J1 | FR-4, FR-10 | role check, hidden button | RPC, page | `can_edit_project` | T5–T8, T16, E3 | E3 |
| Member policy intact | — | FR-5 | no policy change | migration | — | T9, T11 | pgTAP in CI |
| Stale review refused | alt | FR-6, FR-8 | lock + status check, dialog | RPC, dialog | 55000 | T12–T14, E2 | E2 on `test:prod` |
| Readable refusals | alt | FR-7 | `ActionRefusal` + `returnRefusals` | actions, `fact-review-refusals` | ActionResult | U1–U2, E2 | E2 on `test:prod` |
| Shows who verified | J6 | FR-9 | detail page | `[factId]/page.tsx` | `verified_by_name` | E1 | E1 |
| Delete honest | alt | FR-11 | pre-check + select | `deleteFactAction` | `can_edit_project` | U2, (T: DELETE policy unchanged) | — (Decision 3) |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Why this one |
|---|---|---|
| Security-definer RPC | (a) role-scoped second UPDATE policy for owner/admin admitting `verified`/`disputed`; (b) admin/service-role client after the TS check | (a) policies are OR-ed and see only NEW: an owner/admin policy would let them set **any** `verified_by`/`verified_at` (forgery) and any transition, and can't express "only from unverified"; (b) bypasses all RLS on a TS check that is already wrong once (account vs project role) — the audit class this repo keeps finding. The RPC sets `verified_by` itself and encodes transitions |
| One function with `outcome` | two functions `verify_fact`/`dispute_fact` | one place for the role + transition rule (fix the class); outcome restricted to two values |
| Project role (`can_edit_project`) | account owner/admin (what the action checked) | matches DELETE policy, `projects_update`, the settings page and the Fact Library link; the account check is the source of the silent no-op. See Decision 1 |
| Refusal via SQLSTATE mapping in one TS table | message-string matching; RPC returning a status row | codes are stable; strings drift; raising keeps "no change" atomic |
| `returnRefusals` (not `withRefusals`) | `withRefusals` | unexpected failures stay thrown to monitoring (KB-6 part B convention) |
| Hide *Verify* for non-reviewers | show and refuse | don't offer an action that will be refused; DB still enforces. Decision 4 |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| Definer function bypasses RLS more widely than intended | cross-tenant writes | pgTAP T5–T8, T16 | explicit checks, `search_path=''`, revoke anon, single-row single-statement | drop function |
| Account owners off the project lose a path they "had" | complaint | owner review | it never worked (silent no-op, §8); Decision 1 | widen check in follow-up |
| Trigger order change by FILM-1120 breaks name snapshot | missing "Verified by" | `audit-author-snapshot.test.sql`, T1 | noted for FILM-1120 (§31) | — |
| Local E2E flake on dev server | false red | — | iterate on dev, gate on `test:prod` | CI judges |
| `database.types.ts` drift | red Supabase DB job | CI typegen diff | generate, pinned CLI | regenerate |
| Parallel teammate reset drops schema mid-test | false red | — | DB lock protocol | rerun under lock |

## 31. Open Questions and Assumptions

| Question | Why it matters | Current assumption | Decision needed |
|---|---|---|---|
| Q1 Who may verify/dispute: project owner/admin, or also account owner/admin? | defines FR-4 | project owner/admin (Decision 1) | owner |
| Q2 Allow re-review (verified→disputed, disputed→verified) through the dialog? | FR-6; FILM-1123 use case "a verified fact found wrong" | no; reopen by editing the fact (existing trigger resets to unverified) (Decision 2) | owner |
| Q3 Fix `deleteFactAction` in this PR? | same helper, same defect class | yes (Decision 3) | owner |
| Q4 Hide *Verify*/*Delete* for non-reviewers? | UX | yes (Decision 4) | owner |
| Q5 Show who **disputed**? | audit | not shown; `updated_by` records it; no name snapshot | later, if wanted |

**For FILM-1120 (queued next), what it will need from this work:**
- The pgTAP file `verified-facts-review.test.sql` and its fixture (owner/admin/
  member/viewer/off-project/stranger) to extend with SELECT/INSERT/DELETE
  cross-project isolation — its "RLS policies protect project-level access"
  criterion. This PR does **not** claim that criterion.
- `public.set_fact_verification` is the only end-user writer of
  `verified`/`disputed`; any new column FILM-1120 adds (e.g. a generated `fts`
  column for its full-text criterion) must not rename or reorder the BEFORE
  UPDATE triggers (`enforce_verified_facts_update` must sort before
  `verified_facts_snapshot_verifier_name`).
- Its migration timestamp must sort after `20260923042421_kb18-fact-verification.sql`
  (and after anything newer on main when it lands); regenerate types after.
- Known side effect it may hit: the unchanged UPDATE policy's `WITH CHECK`
  refuses **any** user-client edit of a verified fact that keeps it verified
  (e.g. editing tags) — content edits work only because the trigger first
  resets to unverified. No edit UI exists today, so nothing breaks; an edit
  feature would need the same RPC approach.

## 32. Implementation Plan

1. **Migration** `20260923042421_kb18-fact-verification.sql` (§14). Under DB lock:
   `db reset`, `typegen`. *Rollback*: drop function.
2. **pgTAP** `verified-facts-review.test.sql` (§26) → green; then the
   mutation reds one at a time, restore. Also rerun
   `audit-author-snapshot.test.sql` and `authors-deletable.test.sql`.
3. **`fact-review-refusals.ts`** + U1.
4. **Actions** (verify, dispute, delete) + U2. `pnpm typecheck`.
5. **UI**: dialog (stay open, `refusalMessage`), library (reject on refusal,
   `canReview`), card `data-test`, facts page permissions, detail "Verified by".
6. **E2E** `tests/facts/` (E1–E3) on dev :3107; red runs against reverted
   code; then `test:prod` for the suite subset; evidence spec → screenshots.
7. **Records**: KB-18 → Fixed (entry lines + one Fixed-table row); FILM-1121
   "FactVerificationDialog…" met with evidence; FILM-1123/1122/1140/1143 items
   `closed_by: "KB-18"` re-checked against the running feature — each either
   met with evidence or rewritten with its remaining non-KB-18 reason and
   `closed_by: "unassigned"` (FILM-1123 `runFactCheck` still has no caller and
   the wrong slug; FILM-1122 ID check still uncalled); `INDEX.md` rows only if
   a status changes.
8. `pnpm lint:fix`, `pnpm format:fix`, sibling grep, PR with screenshots.

**As built (deviations from the above, none changing behaviour or scope):**

- T16: `anon` has no `usage` on schema `public` here, so calling the function
  as anon is refused at the schema and proves nothing about its grant. The case
  asks `has_function_privilege` instead: anon and public may not execute,
  authenticated may.
- The refusal cases each use their own fact (f06, f11–f14). Sharing one made
  the role-check mutation fail the later cases for "already verified" instead
  of their own reason.
- The E2E card locator filters to visible cards: during a streamed render the
  server's copy of the list can sit hidden beside the hydrated one.
- The facts specs join the revenue specs in `playwright.config.ts`'s
  team-accounts `testIgnore`, since they seed through `create_team_account`.

## 33. Definition of Done

- [ ] Owner and admin verify and dispute through the UI; statuses persist over reload; detail shows "Verified by".
- [ ] Member/viewer/off-project/stranger refused in pgTAP; no forged verifier; policy untouched (T9, T11).
- [ ] Every new guard seen red for its stated reason, then green.
- [ ] Refusal text asserted on a production build (`test:prod`), never the generic sentence.
- [ ] Dialog keeps notes on refusal (E2).
- [ ] Typecheck, `@kit/episodes` + `@kit/next` unit tests, pgTAP suite, facts E2E green.
- [ ] Types generated, not edited.
- [ ] KB-18 marked Fixed; related spec criteria re-checked and corrected.
- [ ] Screenshots (before/after, second action, error state) in the PR.

## 34. Final Consistency Pass

**Forward.** Problem: nobody can verify or dispute (reproduced in DB and UI). →
Outcome: owner/admin can, with attribution, persisted. → User does J2–J4. →
Expects success toast + badge, or a readable refusal with notes kept. → System
must authorise on the project role, write status + verifier atomically, refuse
stale reviews. → Data: existing columns only. → Architecture: one definer RPC
behind the existing actions. → Tested by pgTAP (rules), unit (mapping), E2E on a
production build (flow, second action, error). → Deployed as an additive
migration + code. → Verified by E1/E2 on `test:prod` and the owner's runbook.

**Reverse.** Production will: call one RPC per review; write one row's status
columns with `verified_by = auth.uid()`; refuse everything else with a coded
error that becomes a sentence. Participants: dialog → library → action → RPC →
triggers. The user sees the badge change and "Verified by" after reload, or a
sentence and their notes still there. That satisfies J1–J8 and FR-1…FR-11,
which deliver the outcome in §1. The two paths converge.

One deliberate divergence from the KB-18 entry text: the entry says the fix
"checks the caller is an owner or admin" without saying of what. The code
checked the **account**; the policies check the **project**. This design uses
the project (Decision 1), because the account check is what produces the
silent no-op found in §8.
