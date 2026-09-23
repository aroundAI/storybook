# KB-52 — Engineering Design Document

**Every signed-in user can read and delete every account's `llm_usage_analytics` rows**

| | |
|---|---|
| Ticket | KB-52 (FILM-CC-04; entry text lands with KB-26's PR) — severity **High**, cross-tenant read, write and delete |
| Branch | `fix/kb-52-llm-usage-analytics-rls`, from `origin/main` @ `49b851d6` |
| Size | S: one policy migration (plus 17 `alter policy … to authenticated`), one executor change, 8 one-line caller edits, two pgTAP files, one unit test |
| Author | teammate `kb-52`, 2026-09-23 |
| Status | **Plan — awaiting owner approval** |

---

## 1. Start With the User

**Who.** Two sets of users. (a) Every creator whose account runs an LLM
operation (story, screenplay, research, fact check, insights, translation):
each operation writes one row describing it, with the account, the user, the
template, the model, the tokens, the cost and, on failure, the provider's error
text. (b) The owner, who reads those rows to see what the LLM spend is and
what is failing.

**Problem today.** Any signed-in user, in any account, including one created a
minute ago with no memberships, can do all of the following to every other
account's usage rows through the public Data API (`/rest/v1/llm_usage_analytics`):

- read them, including `account_id`, `user_id`, `error_message` (raw provider
  errors, sometimes echoing prompt fragments), `request_config` and
  `response_metadata`;
- edit them, for example rewriting `total_cost` or `error_message`;
- delete them, erasing another tenant's cost history;
- insert forged rows attributed to another account, inflating its apparent spend.

Measured in §8.3, as a second real user.

**After the fix.**

- A creator can read the usage rows of accounts they own or belong to. That
  includes their personal account, which has no membership rows. They cannot
  read any other account's rows.
- Nobody signed in can insert, edit or delete a usage row. Only the server
  (service role) writes them.
- Every LLM operation that logs usage today still logs it, including the three
  that currently log through the user's own session and would otherwise start
  failing silently (§8.2).

**What persists.** Usage rows persist as today. Rows already in the table are
not modified. **What changes for a person:** nothing visible. No screen reads
this table (§8.1), so the change can only be seen through the Data API, SQL,
and the rows that keep arriving.

**Success.** The attacks in §8.3 return empty results or `42501`, while every
legitimate writer's row still lands. **Failure** would be either the attack
still working, or any LLM operation's usage row going missing. The second is
the likelier regression, because `logLLMUsage` swallows its errors (§18).

## 2. Define the Complete User Journey

There is no UI journey: the table has no screen. The journeys are the
programmatic ones.

| # | Actor action | System response | Visible result | Next |
|---|---|---|---|---|
| J1 | Creator runs any LLM operation (Next.js action or llm-worker Lambda) | `executeLLM` → `logLLMUsage` inserts one row **via the service-role client** | Nothing in the UI; row exists | — |
| J2 | Creator (or their tooling) `GET /rest/v1/llm_usage_analytics` | RLS returns rows where `has_account_access(account_id)` | Own accounts' rows only | — |
| J3 | Signed-in user `GET`s another account's rows | RLS filters them out | `200 []` | — |
| J4 | Signed-in user `POST`/`PATCH`/`DELETE`s | Table privilege revoked | `401`/`403`, `42501 permission denied` | — |
| J5 | Anonymous caller, any verb | Already refused at schema level | `401`, `42501` (unchanged) | — |
| J6 | Owner inspects spend in the SQL editor (`postgres`) | Bypasses RLS | All rows (unchanged) | — |

Refresh, re-entry, cancellation, back navigation, session interruption: not
applicable. There is no stateful UI, and every request is independent.

## 3. Explicitly Define the Happy Path

1. A creator opens a documentary project and runs **Fact check**
   (`packages/features/episodes/src/lib/documentary/fact-checker.ts`).
2. The action calls `executeLLM({ templateSlug, context: { accountId, userId, … } })`.
   **After the fix it no longer passes `supabaseClient`.**
3. The executor renders the prompt, calls the provider and parses the result.
4. The executor builds the service-role client (`createLambdaAdminClient()`)
   and calls `logLLMUsage(adminClient, event)`.
5. PostgREST receives an insert as `service_role`, which bypasses RLS and
   holds INSERT. The row lands with `account_id = project.account_id`.
6. The creator later queries `llm_usage_analytics` with their session. The
   read policy `has_account_access(account_id)` is true for their account, so
   the row is returned. A user from another account gets `[]`.

Success means the row exists with the right `account_id` (checked as `postgres`),
it is visible to the account's owner and members, and it is invisible and
immutable to everyone else.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| Service-role env vars missing (misconfigured Lambda/server) | `createLambdaAdminClient()` returns `null`, `logLLMUsage` throws inside the executor's `try` and logs `Failed to log LLM usage analytics` | Nothing: the LLM result is returned | Fix env; this is today's behaviour for 39 of 47 callers | Operation succeeds, row missing, error logged |
| Insert rejected (e.g. bad column) | `logLLMUsage` logs `[LLM Analytics] Failed to log usage` | Nothing | Log search | Same as above |
| `context.accountId` not a UUID (e.g. `'system'`) | `account_id` stored as `null` (existing `isValidUUID`) | Nothing | — | Row readable by no signed-in user, only `postgres`/service role. Intended. |
| A future caller passes a session client | **Type error**: the `supabaseClient` field no longer exists on `LLMExecutionConfig` (§15) | — | Compile fails | Cannot regress silently in typechecked code (lambdas: see §24, KB-14) |
| Signed-in user forges a row / edits / deletes | `42501 permission denied for table llm_usage_analytics` | Error to the caller | — | No change |
| Signed-in user reads a foreign account | Filtered | `[]` | — | — |
| Account deleted | `account_id` set null (existing FK `on delete set null`) | — | — | Orphan rows visible to no signed-in user |
| User deleted | `user_id` set null (existing FK) | — | — | Unchanged |
| Team member removed | `has_account_access` false on the next query | Former member stops seeing rows | — | — |
| Large result (> 1000 rows) | PostgREST cap applies to readers (no reader in code) | — | Future readers must page (CLAUDE.md) | — |

Timeouts, retries, concurrency and stale data don't apply: an insert is one
statement, and RLS is evaluated per query.

## 5. Establish the User-Facing Contract

The Data API contract for `public.llm_usage_analytics`:

| Role | SELECT | INSERT | UPDATE | DELETE | TRUNCATE |
|---|---|---|---|---|---|
| `anon` | ✗ (42501, unchanged) | ✗ | ✗ | ✗ | ✗ |
| `authenticated`, owner or member of `account_id` | ✓ own accounts' rows | ✗ 42501 | ✗ 42501 | ✗ 42501 | ✗ |
| `authenticated`, anyone else | `[]` | ✗ 42501 | ✗ 42501 | ✗ 42501 | ✗ |
| `authenticated`, super admin | same as above: no extra visibility (decision D1) | ✗ | ✗ | ✗ | ✗ |
| `service_role` | ✓ all | ✓ | ✓ | ✓ | ✓ |
| `postgres` (SQL editor) | ✓ all | ✓ | ✓ | ✓ | ✓ |

No UI states, messages or notifications: there is no screen.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Why | Verification |
|---|---|---|---|
| **R1** | A signed-in user can SELECT a row only if `has_account_access(row.account_id)` (primary owner **or** any membership role) | Owner's rule: reads on account membership; personal accounts have no membership rows | pgTAP: owner reads own personal-account row; team member reads team row; outsider reads 0 rows; PostgREST repro after |
| **R2** | `anon` and `authenticated` cannot INSERT, UPDATE, DELETE or TRUNCATE, whatever the policies say | Owner's rule: writes service-role only. Two layers (privilege and no policy) so that re-adding a permissive policy alone doesn't reopen the hole | pgTAP `throws_ok … '42501'` per verb; `table_privs_are` |
| **R3** | No policy on the table applies to `public` or has a constant-true expression | Removes the defect's shape | pgTAP `policies_are` + `policy_roles_are`; the class sweep query (§8.4) returns no row for this table |
| **R4** | Every LLM usage row is written with the service-role client, whoever calls `executeLLM` | Three callers write through the user's session today (§8.2); under R2 their rows would be dropped silently | Unit test: success and failure paths hand `logLLMUsage` the service-role client; node run against the local stack |
| **R5** | `LLMExecutionConfig` has no way to inject a client for logging | Fix the class: removes the only way to pass the wrong client | `pnpm typecheck` (typechecked code); `git grep supabaseClient:` in executeLLM callers returns 0 |
| **R6** | Rows with `account_id is null` are visible to no signed-in user | `has_account_access(null)` is false; stated so it isn't "fixed" into an open read later | pgTAP case |
| **R7** | Sweep siblings: every `public` policy that is `FOR ALL`/write with no `TO` clause, or `TO public`/`authenticated` with `using (true)`, is listed with a recommendation; those that hold account data are fixed here | Ticket: fix the class | §8.4 table; pgTAP for each fixed table |

## 7. Define Non-Functional Requirements

- **Security:** R1–R3. Tenant isolation is enforced in the database, not in
  application code.
- **Performance:** the read policy calls `has_account_access` per row, like
  every other analytics table. It is `stable security definer` over an indexed
  lookup. There is no reader today. Writes bypass RLS. No measurable change.
- **Reliability:** R4 must not reduce the number of usage rows written. The
  existing "analytics never breaks the LLM result" rule is kept (both
  `try`/`catch` blocks stay).
- **Backward compatibility:** the Data API contract narrows. That is the fix.
  No app code reads the table.
- **Observability:** unchanged. Failed logging is still logged at error.
- **Cost, accessibility, i18n, DR:** not affected.

## 8. Analyze the Existing System

### 8.1 Table, policies, readers

`public.llm_usage_analytics`, created by
`apps/web/supabase/migrations/20251212000000_create_llm_usage_analytics.sql`
and never altered since (`git grep` over `migrations/`: only this file).

```sql
-- :30-40
create policy "Admins can view all LLM analytics" on public.llm_usage_analytics
  for select to authenticated
  using (exists (select 1 from public.accounts where id = llm_usage_analytics.account_id));
-- :44-47
create policy "Service role can manage LLM analytics" on public.llm_usage_analytics
  using (true) with check (true);          -- no FOR ⇒ ALL; no TO ⇒ public
```

- The second policy is the defect. `service_role` has `BYPASSRLS` and never
  needed a policy, so this one only ever granted access to everyone else. It
  applies to every role, including `authenticated` and `readonly_viewer`
  (§19).
- The first delegates to `accounts`' RLS. It admits anyone who can see the
  account row, which is wider than membership: for example, a user who can see
  an account through a shared public project. It would still be too wide on its
  own.
- `apps/web/supabase/schemas/24-llm-usage-analytics.sql` describes a
  *different* table (an `executed_at` column, `account_id not null`,
  `on delete cascade`) with sensible policies that were never migrated. Per
  CLAUDE.md, `migrations/` is authoritative. The schema file's policy block
  is mirrored to the new policies (§14). Its column drift is out of scope and
  noted in §31.

**Readers.** None in application code. `git grep llm_usage_analytics` (with
`database.types.ts` and migrations excluded) finds only the writer
(`packages/llm/src/analytics.ts:95`), docs (`packages/features/prompt-engine/CLAUDE.md:275-290`,
`PRD.md`, `docs/ARCHITECTURE.md:814`, `wiki/prompts.html`) and the schema file.
Positive control: the same grep finds 9 lines in the creating migration. The
documented queries are SQL-editor queries (`postgres`, no RLS). No admin
screen reads the table: `git grep -i "llm_usage\|usage_analytics"` under
`apps/web/app` and `packages/features/admin` returns nothing. So no screen
needs super-admin visibility (D1).

### 8.2 Writers

One function writes the table: `logLLMUsage(client, event)`
(`packages/llm/src/analytics.ts:87-128`). It is called only from `executeLLM`
(`packages/features/prompt-engine/src/lib/server/llm-executor.ts:666` success,
`:737` failure). The executor uses `config.supabaseClient` when given,
otherwise `createLambdaAdminClient()` (service role, from env;
`packages/supabase/src/clients/lambda-admin-client.ts`).

`executeLLM` has 47 call sites in 42 files. 39 pass no client and log through
the service role already. Eight inject one:

| Caller | Client injected | Role at PostgREST | Works after R2 without R4? |
|---|---|---|---|
| `apps/web/lambda/llm-worker/handlers/analytics-insights.ts:135` | worker's `createClient(url, SERVICE_ROLE_KEY)` (`lambda/llm-worker/index.ts:71`) | service_role | yes |
| `…/handlers/batch-translate-metadata.ts:77` | same | service_role | yes |
| `…/handlers/fact-extraction.ts:64` | same | service_role | yes |
| `…/handlers/language-insights.ts:96` | same | service_role | yes |
| `…/handlers/screenplay-conversion.ts:306` | same | service_role | yes |
| `packages/features/episodes/src/lib/canon/act-context-bridge.ts:48` | `getSupabaseServerClient()` (**user session**) | authenticated | **no: silently dropped** |
| `packages/features/episodes/src/lib/documentary/fact-checker.ts:141` | `getProjectContext()` → `getSupabaseServerClient()` (**user session**, `helpers.ts:17-21` says so) | authenticated | **no: silently dropped** |
| `packages/features/episodes/src/lib/documentary/researcher.ts:116` | same (**user session**) | authenticated | **no: silently dropped** |

The config field's own doc comment (`packages/features/prompt-engine/src/lib/types.ts:119-125`)
says "pass the service_role client", and it is typed `any`, so nothing
enforced it. The three session callers write today only *because of* the
defective `FOR ALL … TO public` policy. Measured: the victim's session insert
succeeds before the fix (§8.3).

The lambda handlers' injected client is interchangeable with the fallback:
`createLambdaAdminClient` reads `NEXT_PUBLIC_SUPABASE_URL` (falling back to
`SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`, the same variables the worker
reads at `index.ts:35-36`, and the SST definition sets them for the worker
(`sst.config.ts:668`).

### 8.3 Reproduction (before the fix)

Run under the DB lock after `supabase db reset` from this branch (`origin/main`
schema), as two real users created through the Auth admin API. Everything is
driven through PostgREST with each user's own access token. Local demo keys
only. Script: `$SP/kb52/repro.sh`.

Run 2026-09-23T04:09Z. The victim is a fresh user with a personal account
only. The attacker is a fresh user with **no memberships** (the membership
query returned `[]` for both). One victim row was seeded as service role, the
way the real writer does it, with `error_message = 'victim-secret-…'` and
`request_config = {"k":"victim-config"}`.

| # | Request (own JWT, PostgREST) | HTTP | Result |
|---|---|---|---|
| 1 | attacker `GET ?id=eq.<victim row>&select=account_id,user_id,error_message,request_config` | **200** | victim's `account_id`, `user_id`, `error_message: "victim-secret-…"`, `request_config` returned |
| 2 | attacker `GET ?select=id` (whole table) | **200** | every row in the table |
| 3 | attacker `PATCH ?id=eq.<victim row>` `{"error_message":"tampered"}` | **200** | row updated; the victim's next read shows `"tampered"` |
| 4 | attacker `POST` `{account_id: <victim>, total_cost: 9999, …}` | **201** | forged row attributed to the victim's account |
| 5 | anon `GET` | 401 | `42501 permission denied for schema public` (schema-level, unchanged) |
| 6 | victim `GET` own row (personal-account owner) | 200 | own row. **Must still hold after the fix** |
| 7 | victim `POST` own row **with the session client** (what the 3 episodes callers do) | **201** | succeeds today *only* through the defective policy. **Refused after the fix → R4** |
| 8 | attacker `DELETE ?id=eq.<victim row>` | **200** (with `return=representation`; 204 without) | row deleted. Service-role read afterwards: `[]` |

Table privileges before the fix (`information_schema.role_table_grants`):
`anon` and `authenticated` both hold
`DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` (Supabase
default grants). `readonly_viewer` holds `SELECT`. So RLS was the only
barrier, and the `TO public` policy removed it.

### 8.4 Class sweep: sibling policies

Queried from `pg_policies` on the freshly reset database (every migration on
`origin/main`), rather than read from migration text. Later migrations
drop, rename and re-create policies, so the text is not reliable. Script:
`$SP/kb52/sweep.sql`. The shapes searched are (A) any policy whose roles are
`{public}` (no `TO` clause), and (B) any policy to `anon`/`authenticated`
whose `USING` or `WITH CHECK` is the literal `true`.

**Result: exactly one policy has the KB-52 shape of a no-`TO` or write
policy with a constant-true expression: `llm_usage_analytics` "Service role
can manage LLM analytics" (`ALL`, `{public}`, `true`/`true`).** Every other
hit is one of the harmless shapes below.

| # | Table (policies) | Shape | Holds account data | Behavioural exposure today | Recommendation | In this PR? |
|---|---|---|---|---|---|---|
| 1 | `llm_usage_analytics` (ALL) | `{public}`, `true` | yes (`account_id`, `user_id`, errors, config) | **cross-tenant read/write/delete: reproduced §8.3** | replace (§14) | **fix** |
| 2 | `social_posts` (S/I/U/D) | `{public}`, predicate = own personal account ∪ memberships | yes | none: `anon` lacks schema `USAGE`; for any other role `auth.uid()` is null, so the predicate is false | `alter policy … to authenticated` | **fix (hygiene, zero behaviour change)**, D2 |
| 3 | `batch_generation_jobs` (S/I/U) | `{public}`, memberships ∪ `account_id = auth.uid()` | yes | none (as above) | `to authenticated` | **fix (hygiene)**, D2 |
| 4 | `shot_transitions` (S/I/U/D) | `{public}`, predicate = `accounts_memberships` only | yes (via episode) | none cross-tenant. **Separate lead:** personal-account owners have no membership row, so they cannot read or write their own transitions | `to authenticated`; the personal-owner lead goes to the lead for a KB number | **fix (hygiene)**, D2; the personal-owner bug is **not** fixed here |
| 5 | `audio_assets` (S/I/U/D) | `{public}`, `has_role_on_account(p.account_id)` | yes (via project) | none cross-tenant. Same personal-owner exclusion (the KB-48 class) | `to authenticated` | **fix (hygiene)**, D2 |
| 6 | `nonces` (S) | `{public}`, `user_id = auth.uid()` | user-scoped (Makerkit OTP) | none | `to authenticated` | **fix (hygiene)**, D2 |
| 7 | `verified_facts` (S/I/U/D) | `{public}`, project-membership predicates | yes | none (as above) | `to authenticated` | **no: KB-18 (`fix/kb-18-fact-verify-dispute`) edits these policies**. Allowlisted in the guard until it lands |
| 8 | `audio_cues` (S/I/U/D) | `{public}`, `has_role_on_account` | yes | none cross-tenant (personal-owner exclusion is KB-48) | `to authenticated` | **no: KB-27 edits these policies and KB-48 owns the predicate**. Allowlisted |
| 9 | `config` (S) | `authenticated`, `using (true)` | no: Makerkit feature flags/billing provider, one row | readable config, by design | leave | no |
| 10 | `roles`, `role_permissions` (S) | `authenticated`, `using (true)` | no: the role catalogue | by design | leave | no |
| 11 | `external_content` (S) | `authenticated`, `using (true)` | yes | KB-26 | KB-26 | **no: KB-26** |
| — | `episode_facts`, `external_sources`, `fact_extraction_jobs`, `oauth_app_credentials` | `TO service_role`, `using (true)` | — | none: `service_role` bypasses RLS, so the policy is redundant | leave (optional tidy) | no |

**Why fix rows 2–6 when they expose nothing?** Their behaviour doesn't need
it. What they block is the **class guard**: a pgTAP test that fails CI when
any migration adds a policy with no `TO` clause, or a write policy with a
constant-true expression (§26). That test is what stops the next KB-52. It can
only be strict if the existing `{public}` policies are gone, or allowlisted
with a named owner. `alter policy … to authenticated` changes only the role
list, never a predicate, so it cannot collide with a predicate change on
those tables. The test measures zero behaviour change as a before/after
comparison of per-role row counts (§26).

**Related, noted and not fixed:** `anon` holds full DML privileges on every
table above (Supabase default grants; the KB-44 class). Only the schema-level
`USAGE` revoke (`20221215192558_schema.sql:27`) stops it. That is a single
layer, and it is KB-44's to widen. This PR revokes `anon`'s privileges only
on `llm_usage_analytics`.

**Out of scope, numbered by the lead:** KB-58 (`'use server'` exports in
`llm-executor.ts`/`analytics.ts`) and KB-59 (a committed login-role
credential). Both are listed here by number only.

## 9. Define the Desired System Behavior

| Action | Application logic | Service interaction | Data operation | Response |
|---|---|---|---|---|
| LLM operation completes/fails | `executeLLM` → `recordUsage(event)` (new private helper) | `createLambdaAdminClient()` | `insert` as service_role (RLS bypassed) | none to the user |
| Member reads usage | none (direct Data API) | PostgREST as `authenticated` | `select` filtered by `has_account_access(account_id)` | own rows |
| Anyone signed in writes | none | PostgREST as `authenticated` | refused at the privilege check before RLS | `42501` |

## 10. High-Level Architecture

The trust boundary moves from "any authenticated JWT" to "holder of the
service-role key" for writes, and to "owner/member of the row's account" for
reads. No new component. The decision to log **only** through the service-role
client lives in the executor, not in each caller, because the executor is the
single choke point (§8.2). R4 and R5 exist because the policy fix alone would
break three callers silently.

## 11. Architecture and Flow Diagrams

```
                 before                                   after
 ┌──────────────┐  session JWT   ┌───────────┐   ┌──────────────┐          ┌───────────┐
 │ fact-checker │───insert──────▶│ PostgREST │   │ fact-checker │          │ PostgREST │
 │ researcher   │  (authenticated│  RLS: ALL │   │ researcher   │──┐       │           │
 │ act-bridge   │   passes TO    │  TO public│   │ act-bridge   │  │       │ authn:    │
 └──────────────┘   public true) │  true ✓   │   └──────────────┘  │       │  SELECT   │
 ┌──────────────┐  service key   │           │   ┌──────────────┐  ▼       │  has_acct │
 │ llm-worker   │───insert──────▶│ bypass    │   │ llm-worker   │ executeLLM         │
 └──────────────┘                │           │   └──────────────┘  │ recordUsage()    │
 ┌──────────────┐  any JWT       │           │                     │ service key      │
 │ attacker     │─select/update/▶│  ✓ ✓ ✓    │   ┌──────────────┐  └─insert─▶ bypass │
 └──────────────┘  delete/insert └───────────┘   │ attacker     │─any write─▶ 42501 │
                                                 └──────────────┘─select───▶ []    │
                                                                          └───────────┘
```

## 12. End-to-End Data Flow

**Source:** provider response (tokens, cost, finish reason) or the caught
error → `executeLLM` → `LLMUsageEvent` → `logLLMUsage` (UUID validation:
invalid ids become `null`) → `insert` as service_role → `llm_usage_analytics`
→ read by owners/members via Data API, or by the owner via SQL.
**Loss points:** (1) client creation fails (env), (2) insert error, (3)
**today:** a session client with no write policy. That third point is what R4
removes. Errors are logged, never thrown, so each loss point shows up in the
logs and nowhere else (§22). No duplication, ordering or transformation
changes. **Retention:** unchanged, no deletion job (§31).

## 13. Data Model

Unchanged. `account_id` (nullable, FK `accounts`, `on delete set null`) is
the tenant key and the only column the read policy consults. `user_id` is
attribution only and grants nothing, so a member sees rows other members
generated in the same account. That follows from the owner's "reads on
account membership" rule. Which `account_id` a worker job attributes usage
to is KB-31's subject, not this ticket's.

## 14. Database Design and Changes

**One hand-written migration** `apps/web/supabase/migrations/<UTC>_kb52-llm-usage-analytics-rls.sql`
(timestamp taken at implementation; it sorts after anything already on `main`):

```sql
-- KB-52: reads on account access, writes service-role only.
drop policy "Service role can manage LLM analytics" on public.llm_usage_analytics;
drop policy "Admins can view all LLM analytics"     on public.llm_usage_analytics;

create policy llm_usage_analytics_read on public.llm_usage_analytics
  for select to authenticated
  using (public.has_account_access(account_id));

-- Privileges: the second layer. With no write policy RLS already refuses,
-- but a future permissive policy alone must not reopen writes.
revoke all on public.llm_usage_analytics from anon, authenticated;
grant select on public.llm_usage_analytics to authenticated;
grant all on public.llm_usage_analytics to service_role;   -- already held; explicit
```

- **No write policy at all.** `service_role` bypasses RLS, so a
  "service role" policy is never needed, and writing one `TO public` is exactly
  how this bug happened.
- **Sibling tables (§8.4 rows 2–6, D2):** in the same migration, one
  `alter policy "<name>" on public.<table> to authenticated;` per policy
  (17 statements: social_posts 4, batch_generation_jobs 3, shot_transitions 4,
  audio_assets 4, nonces 1). This changes only the role list, never a
  predicate or a grant. `verified_facts` and `audio_cues` are left to
  KB-18/KB-27 (allowlisted in the guard).
- **Schema file:** replace the policy/grant block of
  `apps/web/supabase/schemas/24-llm-usage-analytics.sql:47-79` with the
  migration's (its columns are left alone, §31). Do the same for any sibling
  table that has a schema file.
- **Types:** policies and grants don't change generated types. Typegen is still
  run and the committed `database.types.ts` must come out byte-identical (CI
  checks it).
- **Existing data:** untouched. **Locking:** `drop/create policy` and
  `grant/revoke` take a brief `ACCESS EXCLUSIVE` on a small table, measured in
  milliseconds. **Rollback:** re-create the two old policies and re-grant (not
  recommended; it reopens the hole). **Deploy ordering:** see §25.

## 15. Low-Level Design

1. **`packages/features/prompt-engine/src/lib/types.ts`**: delete the
   `supabaseClient?: any` field and its doc comment and eslint-disable
   (`:119-125`).
2. **`packages/features/prompt-engine/src/lib/server/llm-executor.ts`**:
   replace the two duplicated client-selection blocks (`:652-664`,
   `:726-735`) with one private helper:
   ```ts
   async function recordUsage(event: LLMUsageEvent) {
     const { createLambdaAdminClient } = await import('@kit/supabase/lambda-admin-client');
     const client = createLambdaAdminClient();
     if (!client) throw new Error('Service-role client unavailable: usage not logged');
     await logLLMUsage(client, event);
   }
   ```
   Both call sites keep their surrounding `try/catch` and log line. Throwing
   on a `null` client, instead of passing `undefined` into `logLLMUsage` as
   today, gives the missing-env case a log line that names the cause.
   `LLMUsageEvent` is already exported from `@kit/llm`.
3. **Eight callers**: delete `supabaseClient: supabase,` (one line each, §8.2
   table). In the episodes files `supabase` is still used for their own reads.
4. **Migration + schema file** as in §14, including the sibling `alter policy` block.
5. **Tests** as in §26 (`llm-usage-analytics-rls.test.sql`, `policy-shape.test.sql`, `llm-executor-usage-client.test.ts`); **mutation guards** in `tooling/mutation-guards/kb-52.json`.
6. **Docs:** `packages/features/prompt-engine/CLAUDE.md`/`AGENTS.md` §"analytics"
   gain one line: rows are written by the service role only, and readable by
   the account's owner and members. FILM-CC-04: mark KB-52 Fixed and add one
   *Fixed* row (§25 on the entry's location).

## 16. API and Event Design

No new API or event. The existing Data API endpoint's permissions narrow as
in §5. `LLMExecutionConfig` loses one optional field. That is a breaking type
change, deliberately: callers still passing it fail to compile (R5).

## 17. State and Lifecycle Design

No state machine. A usage row is insert-once. After the fix it is also
immutable to signed-in users.

## 18. Failure and Error Handling

- `logLLMUsage` swallows insert errors and logs them. That is why a silently
  dropped row is the main risk, and why R4 is proven by a test on the client
  the executor passes, not by waiting for an error to surface.
- The executor's two `try/catch` blocks stay. Analytics failure never fails
  the LLM operation (existing, intended).
- A refused write returns `42501` to a direct API caller. No app code does
  that, so no user-facing message is involved and KB-6's "refusals as values"
  rule has nothing to apply to.

## 19. Security

- **Threat closed:** cross-tenant read, tamper, delete and forged-cost
  insert by any authenticated user.
- **Least privilege:** `authenticated` keeps SELECT only, and anon nothing.
- **Why `has_account_access`, not `has_role_on_account`:** usage rows are
  mostly personal-account rows. A personal account's owner has no
  `accounts_memberships` row, so `has_role_on_account` would hide a creator's
  own usage. `has_account_access` (`20251210201500_fix-account-rls-helpers.sql:83-112`)
  is owner OR `has_role_on_account`. It is the convention of the analytics and
  revenue tables (`20260827101334_analytics-settings.sql:26`,
  `20251211141917_revenue-tracking.sql:184-228`).
- **What the fix newly permits:** nothing a signed-in user could not already
  do. Reads narrow from "anyone" to "owner/member", and writes go from "anyone"
  to "service role". The executor now always holds the service-role key when
  logging, which the 39 unchanged callers already did. It is used for this one
  insert only, with fields the executor builds.
- **Super admin:** no extra visibility (D1). The owner reads via SQL.
- **Out of scope, numbered by the lead and taken to the owner:** KB-58 and KB-59.
- **Effect on `readonly_viewer`:** it has no `auth.uid()` and the new
  policy is `TO authenticated`, so after this fix it sees **no rows** of this
  table, where today the `TO public using (true)` policy shows it all of them.
  That matches what it already sees on every other account-scoped table. The
  role itself is not altered here (KB-59).

## 20. Performance and Scale

The per-row `has_account_access` check matches the other analytics tables.
No reader exists. The index on `account_id` exists
(`idx_llm_analytics_account_id`). A future reader must page (> 1000 rows cap).

## 21. Accessibility and Client Behavior

Not applicable: no client surface reads or writes this table.

## 22. Observability and Operations

Unchanged log lines: `Failed to log LLM usage analytics`,
`Failed to log LLM failure analytics`, `[LLM Analytics] Failed to log usage`.
The new `Service-role client unavailable` message makes the env case
self-describing. Post-deploy, check that usage rows keep arriving for
fact-check/research/act-bridge templates (§25).

## 23. Configuration and Feature Flags

No flag: a security fix is not staged behind one. It relies on
`SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL`, which every web
and worker deployment already sets. No new variable and no production value
is needed.

## 24. Compatibility

- **Data API consumers:** none in code. Anything external that wrote through a
  user JWT stops working, as intended.
- **Type change:** typechecked callers fail to compile if they pass
  `supabaseClient`. `apps/web/lambda` is **not typechecked** (KB-14, in
  flight), so the five handler deletions are verified by
  `git grep -n "supabaseClient" apps/web/lambda packages/features` returning
  nothing, not by `tsc`. Once KB-14 lands, `tsc` covers them too.
- **Rolling deploy:** old app code with the new policy leaves the three
  session callers dropping rows (logged) until the new code is live. New code
  with the old policy works (service role). So **code first, or both
  together** (§25).

## 25. Migration and Rollout Strategy

1. Merge. The deploy workflow applies migrations and deploys code in the same
   run (fixed in #264). Either order within one deploy is safe apart from the
   short window in §24, which only loses usage rows (logged) for three
   templates and never an LLM result.
2. Post-deploy check (owner, SQL editor, one query): rows since deploy with
   `template_slug` from fact-check, research or act-bridge exist and have
   non-null `account_id`.
3. Rollback: revert the PR. The old policies come back and the executor code
   keeps working with them (the service role writes either way).
4. **FILM-CC-04:** KB-52's entry text is in KB-26's unmerged PR. Whichever
   PR merges second marks the entry **Fixed (#this PR)**. This PR adds only
   the *Fixed* table row (see Overlap).

## 26. Testing Strategy

| Layer | Test | Proves | Red before green |
|---|---|---|---|
| pgTAP (CI Supabase DB job) | new `apps/web/supabase/tests/database/llm-usage-analytics-rls.test.sql`, `plan(N)` | R1: personal owner reads own; team member reads team's; outsider reads 0; R6: null-account row invisible; R2: authenticated INSERT (own and foreign account), UPDATE, DELETE each `throws_ok '42501'`; anon SELECT `42501`; R3: `policies_are(['llm_usage_analytics_read'])`, `policy_roles_are(…, '{authenticated}')`, `table_privs_are` for anon/authenticated | Run the file against `origin/main`'s schema before writing the migration; it must fail on the outsider read and the writes. Mutation guards re-create the old policy / re-grant DELETE |
| pgTAP, class guard (CI) | new `apps/web/supabase/tests/database/policy-shape.test.sql`: (1) `is_empty`: no `public`-schema policy has roles `{public}`, except on the allowlisted tables `verified_facts` (KB-18) and `audio_cues` (KB-27/KB-48); (2) `is_empty`: no INSERT/UPDATE/DELETE/ALL policy to `public`/`anon`/`authenticated` has `USING` or `WITH CHECK` = `true`; (3) SELECT `using (true)` to those roles only on `config`, `roles`, `role_permissions`, `external_content` (KB-26) | R3, R7: the class cannot come back unnoticed | Seen red on `origin/main`'s schema (it lists row 1 and rows 2–6); mutation guard adds `create policy kb52_probe on public.social_posts using (true)` |
| pgTAP, zero behaviour change on rows 2–6 | in `policy-shape.test.sql`: as the owner, a member and an outsider, count visible rows in each of the 5 tables, with results compared against fixed expectations seeded in the file | the `to authenticated` edit changes no one's visibility | Same expectations must pass on `origin/main`'s schema (a *pass* before and after is the proof here, not red→green) |
| Unit (`@kit/prompt-engine`, in `scripts/test-units.sh`) | new `packages/features/prompt-engine/__tests__/llm-executor-usage-client.test.ts`: mocks `./prompt-loader`, `@kit/llm` (`createLLMClient`, `logLLMUsage`), logger, `@kit/supabase/lambda-admin-client`. **Success path** and **failure path** each assert `logLLMUsage` was called with the service-role client sentinel. A third case: `createLambdaAdminClient()` → `null` means the LLM result is still returned and the error is logged | R4 | Written first against current code with a test that injects a session sentinel as `supabaseClient` (cast); it fails on current code because the sentinel is used. Then the fix. Mutation guard: re-introduce `config.supabaseClient ??` in `recordUsage` |
| Type | `pnpm typecheck` | R5 | Temporarily re-add `supabaseClient: supabase` in `fact-checker.ts` → excess-property error |
| Execution (PR evidence, local) | `$SP/kb52/repro.sh` re-run after the migration: same two real users through PostgREST | the attack fails; victim still reads own row; victim's session insert refused | Before-run output in §8.3 |
| Execution (PR evidence, local) | node script: `executeLLM` with a `local`-provider stub template is not viable without a vendor. Instead call `logLLMUsage(createLambdaAdminClient(), …)` against the local stack and confirm the row lands, and the same call with a session client returns `42501`. This is the path the three callers move from → to | R4 at the DB layer | before/after |
| Mutation guards (CI) | `tooling/mutation-guards/kb-52.json`: `pgtap` entries: re-create the `FOR ALL using(true)` policy; `grant delete … to authenticated` plus a permissive delete policy; swap the read policy back to `exists(select 1 from accounts …)`. `unit` entry: in `recordUsage`, reintroduce an injected client | Guards stay guards | `run.py --only KB-52` all RED |

No Playwright: there is no form or UI. §27 explains why there is no production-build run.

## 27. Production-Build Verification

Not applicable. No UI changes and no thrown server-action message is
introduced. The executor change runs identically in dev and prod builds, and
its production-relevant behaviour (which client logs) is proven by the unit
test and the DB-level run. No `next build`/`next start` run is planned, so no
vendor sandboxing is needed.

## 28. Requirement Traceability

| Req | Design | Test |
|---|---|---|
| R1 | §14 read policy | pgTAP owner/member/outsider; repro after |
| R2 | §14 revoke + no write policy | pgTAP 42501 per verb; mutation guard |
| R3 | §14 drop policies | pgTAP `policies_are`/`policy_roles_are`; sweep query re-run |
| R4 | §15.2 `recordUsage` | unit (both paths); DB-level node run |
| R5 | §15.1, §15.3 | typecheck; `git grep` zero |
| R6 | `has_account_access(null)` = false | pgTAP |
| R7 | §8.4, §14 sibling block | `policy-shape.test.sql` (class guard + zero-change counts); sweep query re-run |

## 29. Architectural Alternatives and Trade-offs

| Alternative | Why not |
|---|---|
| Keep `supabaseClient`, have the 3 episodes callers pass `getSupabaseServerAdminClient()` | Fixes the instance, not the class: the field stays `any` and the next caller can pass a session client again. Rejected in favour of R5 |
| Keep a session-client write path via an `insert` policy `with check (has_account_access(account_id))` | Violates the owner's rule (writes service-role only). It also lets any member forge cost rows for their own account, which corrupts spend figures |
| `SECURITY DEFINER` RPC `log_llm_usage` callable by authenticated | Same objection; more surface |
| Leave callers alone; accept dropped rows for 3 templates | Silent data loss: fact-check and research usage would disappear from spend |
| `has_role_on_account` for reads | Hides personal-account owners' own usage (§19) |

## 30. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A caller not found keeps a session-client write | Low: `logLLMUsage` has one caller and the field is removed | Silent row loss | Type removal; grep; unit test at the choke point |
| Lambda handlers not typechecked (KB-14) keep passing the field | Low | None functionally (extra property ignored at runtime) | Deleted by hand; grep zero |
| Service-role env missing in some runtime | Low, already required by 39 callers | Row loss, logged | Clear error message |
| Conflict with KB-31 in 3 handler files | Certain, trivial | Rebase conflict | Agreed with KB-31: adjacent lines, second to rebase resolves |
| Sibling `to authenticated` edits change someone's visibility | Very low: role list only; `anon` has no schema `USAGE`, other roles have null `auth.uid()` | Feature regression | Zero-change row counts in `policy-shape.test.sql` pass before and after |
| The class guard fails another ticket's migration (e.g. KB-18 re-creating a `verified_facts` policy with no `TO`) | Medium | Red CI for them | Allowlist by table for `verified_facts`/`audio_cues`, noted in Overlap; the failure message names the policy and says to add `TO authenticated` |

## 31. Open Questions and Assumptions

- **D1 (owner):** super-admin read policy? **Default: none.** No screen reads
  the table, and the owner reads via SQL. If an admin cost screen is built, add
  `or public.is_super_admin()` then, with its pgTAP case.
- **D2 (owner):** sibling tables. Only `llm_usage_analytics` has the
  exploitable shape. **Default:** also `alter … to authenticated` the 17
  no-`TO` policies on the five uncontested tables that hold account or user
  data (§8.4 rows 2–6). There is zero behaviour change, and it lets the
  class-guard test be strict. `verified_facts`/`audio_cues` are allowlisted
  until KB-18/KB-27 land; `config`/`roles`/`role_permissions` are left as
  reference data; `external_content` is KB-26's. **Alternative:** policy fix +
  guard only for `llm_usage_analytics`, with the guard allowlisting all eight
  `{public}` tables.
- **D3 (owner):** remove the `supabaseClient` field outright (R5) rather than
  leaving it and fixing the 3 callers. **Default: remove.**
- **Assumption:** no external tool writes usage rows with a user JWT. Nothing in
  the repo does.
- **Not addressed (noted):** schema file 24's column drift from the migration
  (`executed_at` vs `created_at`, nullability); no retention policy for usage
  rows (KB-20's retention decisions do not mention this table).

## 32. Implementation Plan

1. (DB lock) Write both pgTAP files; run them on the `origin/main` schema and
   record the red failures.
2. Write the migration (this table + §8.4 rows 2–6); `migration up`;
   pgTAP (`llm-usage-analytics-rls`, `policy-shape`) green; typegen (expect no
   diff); release the lock.
3. Unit test red against current executor → change `types.ts`,
   `llm-executor.ts`, 8 callers → green.
4. Mutation guards `kb-52.json`; `run.py --only KB-52` (DB lock for pgtap).
5. (DB lock) Re-run `repro.sh` and the node write check. Record after-output.
6. Mirror schema files; docs lines; FILM-CC-04 Fixed row.
7. Heavy slot: `pnpm typecheck`, `pnpm --filter @kit/prompt-engine test`,
   `pnpm lint:fix`, `pnpm format:fix`.
8. Commit, push, PR with before/after tables.

## 33. Definition of Done

- [ ] `llm-usage-analytics-rls.test.sql` and `policy-shape.test.sql` green on the branch, seen red on `origin/main`'s schema (zero-change counts pass on both)
- [ ] Every `kb-52.json` mutation reports RED
- [ ] Unit test green, and seen red before the executor change
- [ ] `repro.sh` after: outsider SELECT `[]`, UPDATE/DELETE/INSERT `42501`; victim reads own row; row survives
- [ ] `git grep -n "supabaseClient" -- packages/features apps/web/lambda` shows no `executeLLM` caller
- [ ] Sweep query shows no remaining row for the tables fixed here
- [ ] Typegen byte-identical; `pnpm typecheck`, lint and format clean
- [ ] FILM-CC-04 Fixed row; schema files mirrored; PR body lists the sweep with recommendations

## 34. Final Consistency Pass

User need (tenant isolation of cost and error data) → R1–R3 (policy) plus
R4–R5 (keep every legitimate row) → §14/§15 → §26 tests, each seen red. The
one assumption that could propagate is that `executeLLM` is the only writer.
It is checked by grep with a positive control (§8.2) and made structural by
routing all logging through one helper. There is no UI, so §2/§5/§21/§27 are
deliberately thin.
