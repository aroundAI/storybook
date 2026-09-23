# KB-29 — Token refresh reads app credentials from a table connect stopped writing

Engineering Design Document. Follows `specs/PLAN_TEMPLATE.md`, all 34 sections.

| | |
|---|---|
| Ticket | KB-29 (`specs/cross-cutting/FILM-CC-04-known-bugs.md`, `## KB-29`) |
| Severity | High |
| Related | FILM-706 (TikTok OAuth), FILM-707 (Meta OAuth), FILM-CC-03 (OAuth Token Refresh), KB-15 (X refresh) |
| Branch / base | `fix/kb-29-refresh-global-credentials` / `origin/main` @ `49b851d6` |
| Author / date | kb-29 teammate, 2026-09-23 |
| Size | S–M: about 15 files, no migration, no UI |

### Reproduction (run, not inferred)

The KB entry said "Not run". It has now been run on the real local stack.
`origin/main` @ `49b851d6`, `supabase db reset` from this worktree, holding the
DB lock 02:10:21–02:11:03Z. The run used the real `token-refresh.ts`, the real
admin client and the real `@kit/shared/crypto`. It seeded
`oauth_app_credentials` rows for `youtube`, `meta` and `tiktok` exactly as
`/admin/platforms` writes them. A local HTTP listener stood in for every vendor
token endpoint through `VENDOR_SANDBOX=1` and `VENDOR_URL_*`. The only thing
faked was the vendor hosts. The scratch test is not committed.

| Case (account has global credentials, **no** `account_oauth_apps` row) | `ensureValidToken` result | Requests the vendor received | `is_active` afterwards |
|---|---|---|---|
| YouTube, token expired | `{ valid: false, error: 'REFRESH_FAILED', requiresReauth: true }` | **0** | **false** |
| TikTok (env keys set) | same | **0** | **false** |
| Instagram (Meta) | same | **0** | **false** |
| LinkedIn (env keys set) | same | **0** | **false** |

Logged cause, one per platform: `"YouTube OAuth credentials not configured for this account"`
(`token-refresh.ts:335`), and the same at `:380` (TikTok) and `:431` (Meta).

**Positive control.** The harness can succeed. An account holding a legacy
`account_oauth_apps` YouTube row refreshed: `{ valid: true }`, 1 vendor
request, `client_id=legacy-account-youtube-id`. Note the client: it used the
**per-account** client, not the global one. That matters for compatibility
(§24).

**LinkedIn cannot be fixed by data.** Inserting `account_oauth_apps (platform =
'linkedin')` fails with `23514 account_oauth_apps_platform_check`. No row can
exist, so no LinkedIn token can ever refresh.

### Diagnostic query for the owner (production, run by the owner, read-only)

This work read no production data and used no production credentials. The
owner can paste the query below into the production SQL editor. It returns one
row per connection with a verdict. It returns **no secrets**: client IDs are
public, because they appear in every authorize URL. It was validated locally
against a seeded scenario inside a rolled-back transaction. The output is in
§26 (E2).

```sql
-- KB-29 diagnostic. Read-only; returns no secrets. One row per platform connection.
select
  pc.platform,
  pc.platform_account_name,
  pc.is_active,
  pc.created_at::date                                   as first_connected,
  pc.token_expires_at,
  aoa.client_id                                         as account_row_client_id,
  g.client_id                                           as global_client_id,
  case
    when pc.platform = 'twitter'
      then 'KB-15: X is never refreshed (separate ticket)'
    when pc.platform = 'linkedin'
      then 'BROKEN today: LinkedIn can never refresh. Fixed by KB-29'
    when aoa.id is null
      then 'BROKEN today: dies at first expiry. Fixed by KB-29'
    when pc.platform = 'tiktok'
      then 'OK today via account row; after fix uses TIKTOK_CLIENT_KEY. Reconnect once if that differs from account_row_client_id'
    when g.id is null
      then 'OK today via account row; after fix NOT CONFIGURED: add it at /admin/platforms first'
    when aoa.client_id = g.client_id
      then 'OK today and after fix (same client)'
    else 'OK today via account row; after fix needs ONE reconnect (different client)'
  end                                                   as kb29_verdict
from public.platform_connections pc
left join public.account_oauth_apps aoa
  on aoa.account_id = pc.account_id
 and aoa.platform = case when pc.platform in ('instagram', 'facebook') then 'meta' else pc.platform end
left join public.oauth_app_credentials g
  on g.platform = case when pc.platform in ('instagram', 'facebook') then 'meta' else pc.platform end
order by pc.is_active desc, pc.platform, pc.created_at;
```

---

## 1. Start With the User

**Who.** The owner, who is the first and so far only end-to-end user. They
connect their own YouTube, TikTok, Instagram/Facebook and LinkedIn accounts
under **Settings → Platforms**, then publish to them and read analytics about
them.

**Problem.** A connection made through today's connect flow works for about as
long as its first access token lasts: about an hour for YouTube, 24 hours for
TikTok, and around 60 days for Meta and LinkedIn. At that point the background
refresh fails, the app marks the connection inactive, the card shows **Expired
/ Reconnect**, scheduled publishes to it fail, and the hourly analytics sync
records `scope_error` / `requires_reauth` for every publish on it.
Reconnecting only restarts the clock. That is a reconnect loop the user cannot
escape.

**After the fix.**
- A connection stays connected across token expiries with no user action,
  indefinitely, until the user revokes access at the platform or disconnects.
- Publishing and analytics sync keep working past the first hour or day.
- LinkedIn connections refresh at all. Today they never can.
- If the *operator* has not configured a platform's app credentials, the
  user's connections are **not** torn down. They stay connected. The failure
  is logged as an operator problem, and adding the credentials restores
  everything without asking the user to reconnect (Decision 2).

**Success.** A connection made after 2026-01-21 is still `active` hours or days
later, and its token has been rotated without user involvement.

**Failure, meaning an intended and visible one.** Only a genuine
authorization failure asks the user to reconnect: the user revoked access, or
the platform rejected the refresh token. The UI for that is unchanged:
**Expired → Reconnect**.

**Persistence.** The refreshed access token, rotated refresh token and expiry
are persisted on `platform_connections`, as today. Nothing new is persisted.

**What does not persist.** Nothing user-facing. In-flight deduplication stays
in memory, as today.

## 2. Define the Complete User Journey

| Stage | User action | System response | User sees | Next |
|---|---|---|---|---|
| Entry | Opens Settings → Platforms and clicks **Connect YouTube** | `connect/youtube` reads the app credentials through the **one** lookup and redirects to Google | Google consent | Approves |
| Callback | Approves | `callback/youtube` exchanges the code with the **same** credentials and stores the encrypted tokens | Card: **Active** | Leaves |
| Background (every 30 min) | none | The cron job finds connections that expire within 1 hour and runs `ensureValidToken`, which calls `refreshTokenForPlatform` with the **same** credentials; new tokens are stored | Nothing. The card stays **Active** | none |
| Use | Publishes, or the analytics sync runs | `ensureValidToken` returns a valid token, refreshing just in time if the cron missed it | Publish succeeds; analytics fill in | none |
| Manual refresh | Clicks the refresh icon on an active card | `refreshConnectionAction` forces a refresh through the same path | Success, or a toast "Failed to refresh token. Please try reconnecting." | none |
| Revocation (alternate) | Revokes the app at Google | The next refresh gets `invalid_grant`, the connection is marked inactive, and a re-auth notification is logged (the notification is a stub: FILM-CC-03) | Card: **Expired → Reconnect** | Reconnects |
| Operator misconfiguration (alternate) | none | The credentials are missing, so refresh returns `APP_NOT_CONFIGURED`; the connection is **not** deactivated and an error is logged | Once the token lapses the card shows **Expired** (derived from `token_expires_at`); **Reconnect** fails with "not configured, contact your administrator", as today | The operator adds the credentials; the next cron run heals every connection |
| Refresh / navigation | Reloads the page | Status is derived from the DB (`determineStatus`, `connection-actions.ts:225`) | Same state | none |

There is no cancellation or session concern. Refresh runs server-side with no
user session.

## 3. Explicitly Define the Happy Path

A YouTube connection, made after 2026-01-21, whose access token nears expiry:

1. **Cron.** EventBridge invokes the `token-refresh` lambda. The lambda calls
   `GET {API_URL}/api/cron/token-refresh` with `CRON_SECRET`
   (`apps/web/lambda/token-refresh/index.ts`). The refresh therefore runs **in
   the web app**, with the web app's environment, the same process and
   environment as the connect routes.
2. `refreshExpiringTokens` selects active connections where `token_expires_at
   < now + 1h` (`jobs/refresh-expiring-tokens.ts:75`).
3. For each connection, `ensureValidToken(id)` reads it, takes the optimistic
   lock (`metadata.is_refreshing`) and decrypts the refresh token.
4. **The fixed part.** `refreshTokenForPlatform('youtube', …)` maps the
   platform to its app with `PLATFORM_APP.youtube`, which is `'youtube'`. It
   calls `getOAuthAppCredentials('youtube')`, which reads the
   `oauth_app_credentials` row through the service role and decrypts the
   secret. That is the same function `connect/youtube` and `callback/youtube`
   call.
5. `refreshYouTubeToken(refreshToken, credentials)` POSTs to
   `vendorUrl('google-token')/token` with `grant_type=refresh_token` and the
   global client ID and secret.
6. Google returns `access_token` and `expires_in`. The encrypted token, the
   expiry and the cleaned metadata (lock released) are stored.
7. The call returns `{ valid: true, accessToken }`. The job counts it as
   `refreshed`.
8. **User.** Sees nothing. The card is still **Active** the next day. That
   absence of change is the success.

The same holds for every platform, with the app and credential source in this
table:

| Connection `platform` | App | Credential source (same for connect, callback and refresh) |
|---|---|---|
| youtube | youtube | `oauth_app_credentials` row `youtube` |
| instagram, facebook | meta | `oauth_app_credentials` row `meta` |
| tiktok | tiktok | env `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` |
| linkedin | linkedin | env `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` |
| twitter | twitter | env `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` (resolver entry only; the refresh itself is KB-15) |

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| The app credentials are missing: no global row, or the env var is unset | Throws `AppNotConfiguredError(app, source)`; lock released; **not** deactivated; no notification; logged at error with `app` and the source name | Card shows **Expired** once the token lapses; publishing and sync fail with `APP_NOT_CONFIGURED` | The operator configures the credentials, and the next cron run refreshes | Active, healed |
| The stored global secret does not decrypt (wrong `ENCRYPTION_KEY`) | The resolver returns `null` (today's `getGlobalOAuthCredentials` behaviour), so this is treated as not configured, above | Same as above | The operator re-saves the credentials | Active, healed |
| The vendor rejects the refresh token (`invalid_grant`, revoked) | Throws the vendor error; the connection is marked inactive; the re-auth stub is logged, **as today** | **Expired → Reconnect** | The user reconnects | Inactive until reconnected |
| The vendor rejects the client (`invalid_client` / `unauthorized_client`): the connection was minted by a different client (legacy per-account app, or a rotated global app) | Same as revocation: deactivate. The log now names the credential source, so an operator can tell the two apart | **Expired → Reconnect** | One reconnect mints the connection with the current client | Active after reconnect |
| Network error or timeout to the vendor | Throws, so the connection is deactivated, **as today** (unchanged: retry and backoff are FILM-CC-03's open question) | **Expired** | Reconnect | unchanged behaviour |
| Concurrent refresh of the same connection | In-memory dedupe plus the `metadata.is_refreshing` lock, as today | none | none | unchanged |
| Unknown platform (`twitter`) | `default: throw` → deactivated, **as today** (KB-15) | **Expired** | KB-15 | unchanged |
| LinkedIn with env keys | **Now** calls `LINKEDIN_OAUTH_CONFIG.tokenUrl` with the env credentials | Stays Active | none | Active |
| Meta connection with no page id | As today: the user token is returned and a warning logged | none | none | unchanged |

## 5. Establish the User-Facing Contract

- **No UI changes**: no new component, message, i18n key or state.
- **Status.** `determineStatus` is unchanged. A connection shows **Active**
  while it holds a valid token or refreshes successfully. It shows **Expired**
  when the token has lapsed or `is_active = false`, and **Error** when
  `metadata.last_error` is set.
- **Server contract change**, which is internal and not rendered:
  `TokenValidationResult.error` gains the value `'APP_NOT_CONFIGURED'`, with
  `requiresReauth: false`. Every consumer types `error` as `string` or
  switches on the specific values `REFRESH_FAILED` and `NO_REFRESH_TOKEN`.
  Checked: `analytics-sync-cron.ts:78-83,464`, `asset-duration-sync.ts:88`,
  `process-scheduled-publishes.ts:225`, `connection-actions.ts:165,385`.
- **Connect-route errors.** These are unchanged for YouTube and Meta. For
  TikTok, LinkedIn and X, the connect route now also refuses when the
  **secret** is missing, not only the client ID, with its existing
  "not configured" response. Before, it redirected to the vendor and failed
  at callback with `not_configured`. The user reaches the same terminal
  message one step earlier.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Why | Trigger / processing | Success | Failure | Verification |
|---|---|---|---|---|---|---|
| FR-1 | Refresh reads the app credentials from the source connect uses, for YouTube, Meta and TikTok | The KB-29 root cause | `refreshTokenForPlatform` → `getOAuthAppCredentials(PLATFORM_APP[platform])` | An account with global or env credentials and **no** `account_oauth_apps` row refreshes; the vendor receives the **global/env** `client_id` | The vendor receives no request, or the wrong `client_id` | Unit, red first (T1–T3); real-DB rerun (E1) |
| FR-2 | LinkedIn refresh uses env credentials; the `@ts-expect-error` is removed | LinkedIn could never refresh | Same path, `PLATFORM_APP.linkedin` | The vendor receives `LINKEDIN_CLIENT_ID`; `tsc` passes with no directive | Directive present, or the request is not sent | Unit T4; `pnpm typecheck`; grep |
| FR-3 | Connect, callback and refresh import **one** credential lookup | Fix the class: the rule was written in 2 places for YouTube/Meta and 3 for TikTok (including the dead `oauth/tiktok/refresh.ts`) | `getOAuthAppCredentials` in `src/server/oauth-app-credentials.ts` | No credential env read and no `oauth_app_credentials` secret read outside the resolver, except named, pending files | Any other reader | Structural test T6, red first |
| FR-4 | Missing app credentials do not deactivate connections (Decision 2) | An operator fault should not cost N user reconnects; had this existed, KB-29 would have been one config fix | `AppNotConfiguredError` → `{ valid: false, error: 'APP_NOT_CONFIGURED', requiresReauth: false }`, lock cleared, `is_active` untouched | Connection still `is_active = true`; `metadata.is_refreshing` cleared | Deactivated, or lock left set | Unit T5, red first |
| FR-5 | No refresh test asserts a `fetch` it made itself | The self-fulfilling tests are why nobody saw this | Replace `token-refresh.test.ts:199-266` | Every refresh case drives `ensureValidToken` against a local listener | A test calls `fetch` directly | Review, plus a mutation guard |
| FR-6 | `PLATFORM_APP` is an exhaustive `Record<Platform, OAuthApp>` | The foundation for KB-15: a new platform must be mapped, or it does not compile | Type | `tsc` forces a mapping per `Platform` member | none | `pnpm typecheck` |
| FR-7 | Failure logs name the app and the credential **source**, never the secret | Operators must tell "not configured" from "revoked" | The logger context gets `app` and `credentialSource` | Log line present, no secret | Secret logged | Unit asserts on the log call; review |

## 7. Define Non-Functional Requirements

- **Performance.** One `oauth_app_credentials` select by unique `platform` per
  refresh, or none for env apps. This replaces one `account_oauth_apps`
  select, so the query count is unchanged and there is no added latency. No
  caching is added, so a rotated secret takes effect on the next refresh.
- **Reliability.** Refresh success no longer depends on legacy per-account
  data. An operator configuration fault is recoverable without user action
  (FR-4).
- **Security.** Secrets are read only in a plain `server-only` module that
  never becomes a server action (§19). Secrets are never logged.
- **Observability.** Failure logs carry `app` and `credentialSource` (FR-7).
- **Compatibility.** No schema change. `TokenValidationResult.error` gains one
  value, which all consumers accept (§5).
- **Maintainability.** Each credential rule appears once. KB-15 adds a
  platform with one map entry plus one refresh function.
- **Accessibility, i18n.** Not applicable: no UI.
- **Cost.** None.

## 8. Analyze the Existing System

**Components.**
- `packages/features/publishing/src/lib/token-refresh.ts`:
  `ensureValidToken` → `doEnsureValidToken` → `refreshTokenForPlatform` → the
  per-platform `refresh*Token`.
- Callers of `ensureValidToken`: the cron job `jobs/refresh-expiring-tokens.ts:105`
  (via `/api/cron/token-refresh`, which the lambda calls; the duplicate route
  `/api/cron/refresh-tokens` does the same); `jobs/process-scheduled-publishes.ts:222`;
  `server/connection-actions.ts:165,372,385`; and in content-analytics,
  `analytics-sync-cron.ts:460`, `asset-duration-sync.ts:198`,
  `subscriber-snapshot.ts:145`, `reporting/report-ingest.ts:116` and
  `backfill/youtube-backfill.ts:127`. **Every one runs in the web app.** Each
  lambda (`analytics-sync`, `report-ingest`, `subscriber-snapshot`,
  `token-refresh`) only calls `API_URL`. The publish-worker lambda has its own
  non-refreshing `ensureValidToken` (`lambda/publish-worker/index.ts:133`),
  which is KB-15's third bullet and is untouched here.

**Credential sources today, with evidence.**

| Platform | connect | callback | refresh (today) | disconnect |
|---|---|---|---|---|
| YouTube | `getGlobalOAuthCredentials('youtube')` `connect/youtube/route.ts:61` | same `callback/youtube/route.ts:98` | `getAccountOAuthAppAdmin(accountId,'youtube')` `token-refresh.ts:332` ✗ | n/a (revoke needs no secret) |
| Meta | global `connect/meta/route.ts:64` | global `callback/meta/route.ts:108` | per-account `token-refresh.ts:428` ✗ | n/a |
| TikTok | env `connect/tiktok/route.ts:87` | env `callback/tiktok/route.ts:105-106` | per-account `token-refresh.ts:377` ✗; also a second, **uncalled** env-based refresh `oauth/tiktok/refresh.ts:18,47-48` | env `oauth/tiktok/disconnect.ts:47-48` |
| LinkedIn | env `connect/linkedin/route.ts:68` | env `callback/linkedin/route.ts:90-91` | per-account `'linkedin'` under `@ts-expect-error` `token-refresh.ts:519-520`, impossible by CHECK `20260102221811_add_account_oauth_apps.sql:8` ✗ | none |
| X | env `connect/twitter/route.ts:67` | env `callback/twitter/route.ts:102-103` | none: `default: throw` `token-refresh.ts:316-317` (KB-15) | env `oauth/twitter/disconnect.ts:47-48` |

**Tables.** `account_oauth_apps` is per-account. It was created 2026-01-02 and
has had no writer rendered since `3238dd61`. `OAuthAppConfig`
(`components/oauth-app-config.tsx`) is exported (`components/index.ts:14`) and
mounted nowhere. `oauth_app_credentials` is global and super-admin RLS, with a
`service_role` select policy (`20260121114721_global_oauth_app_credentials.sql:41`).
Its CHECK allows `youtube`, `tiktok` and `meta`.

**History that matters.** `115faddb` (2026-01-03) moved refresh onto the
per-account table. `3238dd61` (2026-01-21) moved connect and callback for
YouTube and Meta to the global table and left refresh behind. Between
2026-01-02 and 2026-01-21, YouTube and Meta **connect** used the per-account
row (`git show 3238dd61 -- apps/web/app/api/platforms/connect/youtube/route.ts`).
Connections minted in that window hold refresh tokens bound to the
per-account client.

**Where the fix enters.** Only the credential lookup changes: in refresh, and
the source rule in the connect and callback routes. The refresh control flow
(locks, dedupe, persistence) is unchanged except for the FR-4 branch.

**Tests today.** `__tests__/token-refresh.test.ts:55` mocks
`getAccountOAuthAppAdmin` to always return credentials. `:199-232` and
`:235-266` call `fetch` themselves and assert it was called. The Meta block
(`:274-365`) is the right pattern: it drives `ensureValidToken`. CI runs this
package (`scripts/test-units.sh:45`).

## 9. Define the Desired System Behavior

**Background refresh.** Cron → `/api/cron/token-refresh` →
`refreshExpiringTokens` → `ensureValidToken(id)` → `refreshTokenForPlatform(platform, rt, ctx)`
→ `getOAuthAppCredentials(PLATFORM_APP[platform])` (a DB read for
youtube/meta, env for the rest) → vendor token endpoint → persist → nothing
visible to the user.

**Connect.** `GET /api/platforms/connect/<p>` → `getOAuthAppCredentials(<app>)`
→ redirect with `clientId`. The callback repeats the lookup for the secret.
The same function is called, so the credentials are identical by
construction.

**Missing credentials.** `getOAuthAppCredentials` → `null` → `AppNotConfiguredError`
→ `doEnsureValidToken` catch → clear the lock and log, **without**
`markConnectionInactive` or `sendReauthNotification` → `{ valid:false, error:'APP_NOT_CONFIGURED', requiresReauth:false }`.

## 10. High-Level Architecture

- **New module** `packages/features/publishing/src/server/oauth-app-credentials.ts`,
  marked `server-only` and **without** `'use server'`. It owns the list of
  OAuth apps, the platform → app map and the credential source rule, and is
  the only place that reads secrets.
- **Consumers.** `lib/token-refresh.ts`, and the 10 connect/callback route
  handlers in `apps/web/app/api/platforms/{connect,callback}/*`.
- **`global-oauth-actions.ts`** keeps only the admin-UI actions: list without
  secrets, save and delete. Its secret-returning `getGlobalOAuthCredentials`
  moves into the new module, so no `'use server'` file returns a decrypted
  secret.
- **Trust boundary.** Secrets cross only from the DB or env to the vendor
  token endpoint, server-side. The service-role read of
  `oauth_app_credentials` is allowed by its `service_role` policy.
- **Failure boundary.** A configuration fault (no credentials) is separated
  from an authorization fault (the vendor rejected the grant). Only the
  second deactivates a connection.
- There are no queues, events or caches.

Why a module and not a DB column: the credential source is a property of the
**app**, not the connection, and a map in code makes a new platform a compile
error (FR-6) rather than a row someone has to remember to add.

## 11. Architecture and Flow Diagrams

```
                    ┌───────────────────────────────────────────────┐
                    │ server/oauth-app-credentials.ts  (server-only)│
                    │  OAUTH_APPS, PLATFORM_APP, SOURCES            │
                    │  getOAuthAppCredentials(app)                  │
                    └──────┬───────────────────────┬────────────────┘
      youtube, meta        │                       │  tiktok, linkedin, twitter
   oauth_app_credentials ◀─┘                       └─▶ process.env.*_CLIENT_*
                           ▲                       ▲
        ┌──────────────────┼───────────┬───────────┼──────────────────┐
        │                  │           │           │                  │
 connect/<p>/route   callback/<p>/route   lib/token-refresh.ts → refreshTokenForPlatform
   (clientId)          (id + secret)          (id + secret)
```

Refresh sequence, with the new branch marked `*`:

```
cron ─▶ refreshExpiringTokens ─▶ ensureValidToken(id)
          read connection ─▶ lock(metadata.is_refreshing)
          refreshTokenForPlatform
             creds = getOAuthAppCredentials(PLATFORM_APP[platform])
           * creds null ─▶ throw AppNotConfiguredError
             POST vendor token endpoint (client_id, client_secret, refresh_token)
          ok      ─▶ store tokens, clear lock ─▶ {valid:true}
        * AppNotConfiguredError ─▶ clear lock, log ─▶ {valid:false, APP_NOT_CONFIGURED}
          other error ─▶ markConnectionInactive, reauth stub ─▶ {valid:false, REFRESH_FAILED}
```

## 12. End-to-End Data Flow

**Source.** Super admin → `/admin/platforms` → `saveGlobalOAuthAppAction` →
`oauth_app_credentials` (secret AES-GCM encrypted). Or the deployment env for
the env-backed apps.

**Retrieval.** `getOAuthAppCredentials` selects `client_id,
client_secret_encrypted` for the platform, then `decrypt` →
`{ clientId, clientSecret }`. The secret lives in memory for one request only.

**Use.** It is form-encoded (Google, TikTok, LinkedIn) or put in query params
(Meta `fb_exchange_token`) to the vendor token endpoint. Tokens are persisted
encrypted.

**Loss or staleness points.**
1. Rotating a global secret takes effect at the next read, because there is no
   cache.
2. Rotating the global **client** (a new client ID) orphans every connection
   minted by the old client. Their next refresh gets `invalid_client` and they
   are deactivated, which surfaces as **Reconnect**. This is inherent to OAuth
   and not introduced here. It is documented in §30.
3. A legacy connection minted by a per-account client is orphaned the same
   way, once (§24).

**Retention.** Unchanged. `account_oauth_apps` rows are left in place, unread
(Decision 5).

## 13. Data Model

| Entity | Authoritative for | Change |
|---|---|---|
| `oauth_app_credentials` | YouTube and Meta app credentials | none (becomes the refresh source too) |
| Deployment env | TikTok, LinkedIn and X app credentials | none (becomes the refresh source too) |
| `account_oauth_apps` | nothing, from now on | no longer read by any code path (Decision 5) |
| `platform_connections` | tokens, expiry, `is_active`, lock metadata | none |

**Invariant introduced.** A connection is refreshed with the credentials of
the app that connect uses today. The code enforces it: one function (FR-3).

## 14. Database Design and Changes

**None.** No migration, no typegen, no RLS change, so no pgTAP is required.
`account_oauth_apps` is **not** dropped here, because the owner's diagnostic
query reads it (Decision 5). Dropping it, with `OAuthAppConfig` and its
actions, is a separate cleanup ticket after the owner has run the query.

## 15. Low-Level Design

**`src/server/oauth-app-credentials.ts`** (new):

```ts
import 'server-only';

export const OAUTH_APPS = ['youtube', 'meta', 'tiktok', 'linkedin', 'twitter'] as const;
export type OAuthApp = (typeof OAUTH_APPS)[number];
export interface OAuthAppCredentials { clientId: string; clientSecret: string }

type Source =
  | { kind: 'table' }                                  // oauth_app_credentials row = app
  | { kind: 'env'; clientId: string; clientSecret: string }; // env var NAMES

const SOURCES: Record<OAuthApp, Source> = {
  youtube:  { kind: 'table' },
  meta:     { kind: 'table' },
  tiktok:   { kind: 'env', clientId: 'TIKTOK_CLIENT_KEY',  clientSecret: 'TIKTOK_CLIENT_SECRET' },
  linkedin: { kind: 'env', clientId: 'LINKEDIN_CLIENT_ID', clientSecret: 'LINKEDIN_CLIENT_SECRET' },
  twitter:  { kind: 'env', clientId: 'TWITTER_CLIENT_ID',  clientSecret: 'TWITTER_CLIENT_SECRET' },
};

export function describeCredentialSource(app: OAuthApp): string;   // "oauth_app_credentials['youtube']" | "TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET"
export async function getOAuthAppCredentials(app: OAuthApp): Promise<OAuthAppCredentials | null>;
//  table: admin client select by platform, .maybeSingle(); decrypt; null on no row / error / decrypt failure (logged, no secret)
//  env:   both vars non-empty → value, else null
export class AppNotConfiguredError extends Error { constructor(readonly app: OAuthApp) }
```

**`lib/token-refresh.ts`**:
- `PLATFORM_APP: Record<Platform, OAuthApp> = { youtube:'youtube', tiktok:'tiktok', instagram:'meta', facebook:'meta', linkedin:'linkedin' }`.
  KB-15 adding `'twitter'` to `Platform` makes this fail to compile until it
  is mapped.
- `refreshTokenForPlatform(platform, refreshToken, context)` resolves the
  credentials once, throws `AppNotConfiguredError` on `null`, then dispatches.
  The per-platform functions become `refreshYouTubeToken(refreshToken, creds)`,
  `refreshTikTokToken(refreshToken, creds)`, `refreshMetaToken(userToken,
  platform, creds, context)` and `refreshLinkedInToken(refreshToken, creds)`.
  There are no dynamic imports of `account-oauth-actions` and no
  `@ts-expect-error`. `accountId` stays in the logging context only.
- In the `doEnsureValidToken` catch, an `instanceof AppNotConfiguredError`
  branch runs **before** `markConnectionInactive`. It clears `is_refreshing`
  and `refresh_started_at` (a small `releaseRefreshLock(connectionId, metadata)`,
  sharing the cleanup that `markConnectionInactive` already does), logs at
  error with `{ app, credentialSource }`, and returns `APP_NOT_CONFIGURED`.
  The existing path is unchanged for every other error.
- `TokenValidationResult.error` gains `'APP_NOT_CONFIGURED'`.

**Routes** (10 files; each edit is a few lines):
- `connect/{youtube,meta}` and `callback/{youtube,meta}`: switch the import
  and call from `getGlobalOAuthCredentials(x)` to `getOAuthAppCredentials(x)`.
- `connect/{tiktok,linkedin,twitter}`: replace `process.env.X_CLIENT_ID` with
  `(await getOAuthAppCredentials(app))?.clientId`, keeping the existing
  error response.
- `callback/{tiktok,linkedin,twitter}`: replace the two env reads with the
  lookup, keeping `fail({ code: 'not_configured', branch: 'credentials_missing' })`.

**Removed**, with zero callers after the change (verified with a grep plus a
positive control in Phase 2):
- `getGlobalOAuthCredentials` (moved into the new module).
- `getAccountOAuthApp` and `getAccountOAuthAppAdmin` in `account-oauth-actions.ts`.
- `oauth/tiktok/refresh.ts`, the second TikTok refresh, uncalled, which uses a
  cookie client that would fail in cron, plus its export at
  `oauth/tiktok/index.ts:8`.
- The exports in `server/index.ts` are updated to match.

Nothing else changes: idempotency, transactions, concurrency and locking all
behave as today.

## 16. API and Event Design

No HTTP API change. Internal TypeScript interfaces:
- `getOAuthAppCredentials(app: OAuthApp): Promise<OAuthAppCredentials | null>`,
  exported from `@kit/publishing/server`.
- `TokenValidationResult.error`: `+ 'APP_NOT_CONFIGURED'`, additive.
- `@kit/publishing/server` **no longer exports** `getGlobalOAuthCredentials` or
  `getAccountOAuthApp`. Their only importers are the routes this PR updates;
  `pnpm typecheck` proves it.
- `@kit/publishing/oauth/tiktok` no longer exports `refreshTikTokToken`, which
  had no importer.

There are no events and no async delivery.

## 17. State and Lifecycle Design

`platform_connections` has these states: `active`, `refreshing` (the
`metadata.is_refreshing` lock) and `inactive`.

| From | Event | To | Change |
|---|---|---|---|
| active | refresh OK | active | none |
| active | vendor rejects | inactive | none |
| active | **credentials missing** | **active** (lock cleared) | **was → inactive** |
| inactive | user reconnects (callback upsert sets `is_active: true`) | active | none |

Terminal state: none. A disconnect deletes the row, which is KB-22's
territory and untouched here.

## 18. Failure and Error Handling

| Failure | Behaviour | User | Recovery |
|---|---|---|---|
| No global row, or env unset | `APP_NOT_CONFIGURED`; connection kept; error log with the source name | **Expired** after the token lapses; publish/sync fail | The operator configures the credentials |
| Decrypt of the global secret fails | Treated as missing (above), logged | same | The operator re-saves |
| Vendor 4xx (`invalid_grant`, `invalid_client`) | Deactivate and log with the credential source, as today | **Reconnect** | The user reconnects |
| Vendor 5xx or network | Deactivate, as today | **Reconnect** | Unchanged; retry is FILM-CC-03 |
| Lock update race | Retry after 1s, as today | none | none |
| Admin-client read error on `oauth_app_credentials` | Treated as missing (logged), so the connection is **not** deactivated | none | Transient; the next cron run retries |

The last row is a deliberate improvement. A transient DB error no longer costs
the user a reconnect.

## 19. Security

- **Secrets stay in a non-action module.** `global-oauth-actions.ts` and
  `account-oauth-actions.ts` are `'use server'` files. Every export of such a
  file is a server-action candidate, and two of them return **decrypted client
  secrets**: `getGlobalOAuthCredentials`, and `getAccountOAuthAppAdmin`,
  which does no auth check at all. Whether Next 15 actually exposes them
  (it drops action IDs that no client imports, and client components do import
  those two modules) is **unverified**. Phase 2 checks
  `.next/server/server-reference-manifest.json` for both names before and
  after, and reports the result. Either way, the fix moves the secret reader
  into a plain `server-only` module and deletes the other, so the question
  stops mattering.
- **Least privilege.** The service role reads `oauth_app_credentials` through
  its explicit `service_role` SELECT policy. No RLS changes.
- **Logging.** Only the app name and the credential **source name** (a table
  or env-var name) are logged, never a value. A unit test asserts that the
  logged context contains no secret string.
- **Tenant isolation.** Unchanged, and slightly improved: refresh no longer
  reads per-account data it does not need.
- **Abuse.** The cron routes remain behind `CRON_SECRET` (unchanged).

## 20. Performance and Scale

The traffic is a handful of connections for one owner, refreshed every 30
minutes. Each refresh does one indexed `oauth_app_credentials` read (unique
`platform`) or no read (env), replacing one `account_oauth_apps` read. The net
DB load is zero. No hot path changes.

Sibling noted, not fixed: `refreshExpiringTokens` selects expiring
connections **without paging** (`refresh-expiring-tokens.ts:75-81`). Beyond
1,000 expiring connections it would silently skip the rest (PostgREST cap).
That is left for FILM-CC-03 (§31).

## 21. Accessibility and Client Behavior

Not applicable. There is no client change, and the connection card and its
states are untouched.

## 22. Observability and Operations

- **Logs.** `token-refresh` error logs gain `app` and `credentialSource`.
  `APP_NOT_CONFIGURED` has its own message: `"<app> app credentials not
  configured (<source>); connection left active"`.
- **How an operator knows it works.** The cron job's log line `Complete: N/M
  refreshed, F failed` (`refresh-expiring-tokens.ts:142`) shows `F = 0` for
  YouTube over a day. In the DB, `token_expires_at` keeps moving forward
  while `is_active` stays true.
- **How to tell expected from failure.** `APP_NOT_CONFIGURED` means the
  operator must act. `REFRESH_FAILED` means the user or vendor revoked
  access.
- **No new metrics or alerts.** Logging successful refreshes is FILM-CC-03's
  "All refresh attempts are logged" criterion, so it is not duplicated here.

## 23. Configuration and Feature Flags

| Config | Used for | Absent |
|---|---|---|
| `oauth_app_credentials['youtube' / 'meta']` | YouTube and Meta connect, callback and refresh | Connect refuses, as today. Refresh returns `APP_NOT_CONFIGURED` and keeps connections |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok, the same three uses | same |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn | same |
| `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` | X connect and callback (refresh: KB-15) | same |

There is no feature flag. The change is a correction, and rollback is a revert
(§25). **No production values are read or needed.** Tests use generated keys
and a local listener.

**Pre-existing trap, recorded and not changed.** `/admin/platforms` lets a
super admin save **TikTok** credentials into `oauth_app_credentials`, but
TikTok connect has always used env, and after this fix so does refresh. So
that row is saved and ignored (Decision 3).

## 24. Compatibility

- **Connections minted after 2026-01-21** (global or env): broken today,
  fixed by this change.
- **Connections minted between 2026-01-02 and 2026-01-21 by a per-account
  client** that differs from today's global client: refresh today via the
  legacy row. After the fix they use the global client, get `invalid_client`,
  and need **one reconnect**. If the legacy `client_id` equals the global one,
  which is likely for a single owner with one Google or Meta project, nothing
  changes. The diagnostic query tells the owner which case they are in
  **before** deploying.
- **TikTok with a legacy row**: same reasoning, compared against
  `TIKTOK_CLIENT_KEY`.
- **API and type consumers**: `error` gains one value; all consumers accept
  it (§5).
- **Deployment order**: none. This is code only.

## 25. Migration and Rollout Strategy

1. **Before merge, the owner runs the diagnostic query** (above) in production.
   - Any `after fix NOT CONFIGURED` row: add the credentials at
     `/admin/platforms` **before** deploying.
   - Any `needs ONE reconnect` row: plan one reconnect after deploying.
   - Rows marked `BROKEN today` are what this fixes.
2. Merge and deploy through the normal pipeline. There is no migration.
3. **Validation gate.** The owner connects (or reconnects) YouTube once,
   waits past one hour, and confirms the card is still **Active** and
   `token_expires_at` moved forward. This is the only real-vendor check, and
   it needs the owner's session and credentials, which is why it is theirs.
4. **Rollback trigger**: refresh failures rise in the cron logs for platforms
   that worked before. **Procedure**: revert the PR. Nothing else to undo,
   because no data changed.

## 26. Testing Strategy

All unit tests live in `packages/features/publishing/__tests__/`, which CI
runs through `scripts/test-units.sh:45`. The harness has two parts:
- A **local HTTP listener** on `127.0.0.1:0`, reached through `NODE_ENV=test`,
  `VENDOR_SANDBOX=1`, `VENDOR_URL_{GOOGLE_TOKEN,TIKTOK,META_GRAPH,LINKEDIN_OAUTH}`,
  and `HTTPS_PROXY` pointed at the listener so an escape fails offline. This is
  the `youtube-root-url.test.ts` pattern.
- A **table-aware fake admin client**. `from('platform_connections')` returns
  the seeded connection. `from('oauth_app_credentials')` returns the seeded
  global row. Any other table, including `account_oauth_apps`, returns
  "no row". Real `@kit/shared/crypto` with a generated `ENCRYPTION_KEY`.

| ID | Test | Red on `origin/main` because | Covers |
|---|---|---|---|
| T1 | An expired YouTube connection with a global row and no account row: `ensureValidToken` → `{ valid:true }`; the listener got `client_id=global-youtube-id`, `grant_type=refresh_token`; the update stores the new token | 0 requests, `REFRESH_FAILED` (as reproduced) | FR-1 |
| T2 | Same for Instagram (Meta): `fb_exchange_token` carries the global `client_id`, then `/me/accounts` | same | FR-1 |
| T3 | TikTok with env keys: `client_key=<env>` and the rotated refresh token stored | same | FR-1 |
| T4 | LinkedIn with env keys: request sent with `LINKEDIN_CLIENT_ID` | always fails today | FR-2 |
| T5 | Global row absent: `{ valid:false, error:'APP_NOT_CONFIGURED', requiresReauth:false }`; `is_active` **not** set false; lock cleared; log context names the source and contains no secret | today it deactivates | FR-4, FR-7 |
| T6 | Structural: scan `apps/web/app` and `packages/features/publishing/src` for `process.env.(TIKTOK\|LINKEDIN\|TWITTER)_CLIENT_` and for any `oauth_app_credentials` / `account_oauth_apps` select of `client_secret_encrypted`. Only the resolver may match, plus an explicit allowlist: `oauth/{tiktok,twitter}/disconnect.ts` (Decision 4) and the admin-UI actions (no secret read). **Positive control**: the scan must find the resolver itself, or the test fails, so a broken glob cannot pass vacuously | env reads in 6 routes and `oauth/tiktok/refresh.ts` | FR-3 |
| T7 | Vendor rejects (`400 invalid_grant`): deactivated, `REFRESH_FAILED` (pins the unchanged path) | green before and after; it guards FR-4 from over-reaching | §18 |
| T8 | `apps/web/lib/__tests__`: `CONNECT_PLATFORMS` (`connect-failure.ts:10`) equals `OAUTH_APPS` as a set, so the two lists of OAuth apps cannot drift | new | FR-6 |

The self-fulfilling cases at `token-refresh.test.ts:199-266` and the
`getAccountOAuthAppAdmin` mock at `:55` are **deleted**. The existing Meta
block is kept and moved onto the new harness (FR-5).

**Red before green.** T1–T6 are written first and run on unchanged code,
which must fail for the stated reason (0 requests or `REFRESH_FAILED`; T6
listing the offending files). Then the fix goes in and they turn green. Then
each fix is reverted in turn: the resolver call replaced by `null`, the
`AppNotConfiguredError` branch removed, a route env read restored. Each must
turn its test red. These are recorded permanently as
`tooling/mutation-guards/kb-29.json` (the repo's CI mechanism).

**Real-DB check (E1, PR evidence, not a CI guard).** Re-run the scratch
reproduction on this branch under the DB lock. Expect every row of the §0
table to flip to `{ valid:true }`, 1 request with the global or env
`client_id`, and `is_active = true`. The run also proves the service role can
read `oauth_app_credentials` through RLS, which the mocked tests cannot see.

**Diagnostic query check (E2), already run.** The run held the DB lock at
02:16:37Z. It seeded 3 accounts and 7 connections inside `begin … rollback`
on the local DB and ran the query exactly as printed above. The output below
is verbatim, less the empty `first_connected` and `token_expires_at` columns:

| platform | name | active | account_row_client_id | global_client_id | kb29_verdict |
|---|---|---|---|---|---|
| instagram | A instagram | t | | global-meta | BROKEN today: dies at first expiry. Fixed by KB-29 |
| linkedin | A linkedin | t | | | BROKEN today: LinkedIn can never refresh. Fixed by KB-29 |
| twitter | A x | t | | | KB-15: X is never refreshed (separate ticket) |
| youtube | A youtube | t | | global-yt | BROKEN today: dies at first expiry. Fixed by KB-29 |
| youtube | C youtube | t | legacy-yt | global-yt | OK today via account row; after fix needs ONE reconnect (different client) |
| youtube | B youtube | t | global-yt | global-yt | OK today and after fix (same client) |
| tiktok | C tiktok | f | legacy-tt | | OK today via account row; after fix uses TIKTOK_CLIENT_KEY. Reconnect once if … |

That exercises 6 of the 7 verdict branches. The one not seeded, *legacy row
but no global row → NOT CONFIGURED*, is added to the Phase 2 rerun.

**Not applicable.** E2E/Playwright, because there is no form or interactive
UI. pgTAP, because there is no policy change. Load tests, because volume is
trivial.

## 27. Production-Build Verification

- Run `pnpm --filter web build` (a heavy slot). It must compile the 10 routes
  and the cron route, which dynamically imports `@kit/publishing/jobs`, and
  pull `oauth-app-credentials.ts` into the server bundle only.
- Grep `.next/server/server-reference-manifest.json` for
  `getGlobalOAuthCredentials`, `getAccountOAuthAppAdmin` and
  `getOAuthAppCredentials`: before (on `main`) and after. After, none may
  appear (§19).
- Runtime: start the production build (`start:test`, `NODE_ENV=test`,
  `VENDOR_SANDBOX=1`, with the listener as the vendor), seed an expired
  YouTube connection plus a global row, and call
  `GET /api/cron/token-refresh` with a local `CRON_SECRET`. Expect `{ refreshed: 1, failed: 0 }` and the connection still active. This is
  the real artefact, the real route, and a local DB with a local vendor.
- **What only production can show**: that Google accepts the owner's real
  global client for a real refresh token. The owner covers this with the §25
  validation gate. No production credentials are used here.

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Prod verification |
|---|---|---|---|---|---|---|---|
| YouTube stays connected | Background refresh | FR-1 | §15 resolver | token-refresh, resolver | `oauth_app_credentials` | T1, E1 | §25 gate (1h) |
| Instagram/Facebook stay connected | same | FR-1 | same | same | same | T2, E1 | cron log `failed=0` |
| TikTok stays connected | same | FR-1 | same | same | env | T3, E1 | cron log |
| LinkedIn can refresh at all | same | FR-2 | same | same | env | T4, E1, typecheck | cron log |
| Connect and refresh can't diverge again | Connect, callback | FR-3 | one function | 10 routes, resolver | none | T6, T8 | build (§27) |
| Operator fault doesn't cost reconnects | Misconfiguration | FR-4 | §15 catch branch | token-refresh | `TokenValidationResult` | T5, T7 | logs show `APP_NOT_CONFIGURED` |
| Tests can see this class | none | FR-5 | §26 harness | tests | none | mutation guards | CI |
| X can be added safely (KB-15) | none | FR-6 | `PLATFORM_APP` Record | token-refresh | none | typecheck | none |
| Diagnosable failures | none | FR-7 | log context | token-refresh | none | T5 | logs |

Every requirement has a test. There is no DB change needing a migration plan,
and the API change is additive (§5).

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Chosen because |
|---|---|---|
| Where credentials come from on refresh | (a) the app source connect uses, one function; (b) per-account row first, then global; (c) record the minting `client_id` on the connection at callback and match it at refresh, with try-then-fallback for legacy connections | (a) is the only option that guarantees refresh matches connect **by construction**. (b) keeps two sources, which is the bug class: an account with a legacy row that reconnected after 01-21 refreshes with the wrong client. (c) handles every legacy case automatically but adds callback writes in 5 routes, fallback logic and vendor-specific error parsing. Its benefit (one avoided reconnect for 01-02–01-21 connections, if any exist) is measurable in advance with the diagnostic query. Revisit (c) only if the query shows `different client` rows the owner cannot reconnect |
| Missing credentials | deactivate, as today; keep active and log (chosen) | Deactivation turns one operator fault into N user reconnects and hides the cause, which is exactly how KB-29 went unnoticed |
| Scope of routes converted | refresh plus YouTube/Meta only; all 10 connect/callback routes (chosen) | The acceptance criterion "connect and refresh import one lookup" is about the rule, and TikTok, LinkedIn and X also state it separately in connect, callback and refresh |
| TikTok source | env (chosen); global table | Connect has always used env, so moving TikTok to the table would change connect for existing users. The map makes a later switch one line |
| Tests | mocked lookup (today); fake DB plus local listener (chosen); the real local DB in CI | A mocked lookup is what hid this. The unit CI job has no Supabase. The real-DB run is kept as PR evidence (E1) |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| A legacy connection minted by a different client | One reconnect for that connection | Diagnostic query, before deploy | Owner decides; the query shows it in advance | Alternative (c) in §29 |
| Global credentials are not configured in production for a platform in use | Refresh returns `APP_NOT_CONFIGURED` (connections kept) | Diagnostic verdict `NOT CONFIGURED`; error logs | Configure before deploy (§25) | none needed, self-heals |
| Env credentials (TikTok, LinkedIn) are not set in the web deployment | Same as above | Logs | Same | Same |
| KB-22 edits the same connect/callback or disconnect lines | Merge conflict | Git | This PR does not touch disconnect; route edits are a few lines | Rebase |
| FILM-1504 edits `connect/youtube` or `callback/youtube` | Merge conflict | Git | 2-line edits | Rebase |
| Removing `getGlobalOAuthCredentials` or `getAccountOAuthApp` breaks an importer outside the scan | Build failure | `pnpm typecheck`, `next build` | Grep with a positive control first | Re-export alias |
| Rotating the global client later orphans all connections | Mass reconnect | `invalid_client` in logs, now with the source named | Documented (§12) | Alternative (c) |

## 31. Open Questions and Assumptions

| # | Question | Why it matters | Current assumption | Needed | Decision |
|---|---|---|---|---|---|
| Q1 | Is per-account app configuration still a product feature? | It decides whether `account_oauth_apps` has any future | No: `3238dd61` moved app credentials to super admin on purpose | Owner confirmation | Decision 1 |
| Q2 | Do any production connections depend on a legacy per-account client? | One reconnect, or none | Unknown by design (no prod reads) | The owner runs the diagnostic query | Decision 1 gate |
| Q3 | Are the TikTok and LinkedIn env keys set where the web app runs? | Refresh uses the web app's env | Yes where connect works, since it is the same process | The owner's config (not read here) | none |
| Q4 | The TikTok row in `/admin/platforms` is saved and ignored | An operator trap | Out of scope here | none | Decision 3 |

**Decisions for the owner. The recommended default is listed first.**
1. **One credential source per app, with no per-account override.**
   `account_oauth_apps` is no longer read. The alternative is per-account row
   first, then global. Gate: the diagnostic query. A `needs ONE reconnect`
   row means one reconnect after deploy.
2. **Missing app credentials do not deactivate connections.** The result is
   `APP_NOT_CONFIGURED`, the connection is kept and the failure is logged.
   The alternative is to deactivate, as today.
3. **Leave the ignored TikTok row in `/admin/platforms` as is and file it as
   a new known bug.** The alternative is to hide it here, which is a UI change
   and needs screenshots.
4. **Do not touch `oauth/{tiktok,twitter}/disconnect.ts`** (KB-22's area).
   They stay on T6's allowlist and move to the resolver after KB-22 merges.
5. **Delete the dead secret readers** (`getAccountOAuthApp(Admin)`,
   `oauth/tiktok/refresh.ts`). Keep the `account_oauth_apps` table,
   `OAuthAppConfig` and its save/delete actions until a cleanup ticket that
   follows the owner running the query.

**What each follow-up ticket needs from this design.**
- **KB-15 (X refresh).**
  - Add `'twitter'` to `Platform`, ideally derived as KB-15 proposes. The
    `PLATFORM_APP` Record then **fails to compile** until it gets
    `twitter: 'twitter'`, which is the intended forcing function.
  - The resolver already has the X source (`TWITTER_CLIENT_ID` and
    `TWITTER_CLIENT_SECRET`), and X connect and callback already use it.
  - Write `refreshXToken(refreshToken, creds)`: `POST vendorUrl('x-api')/2/oauth2/token`
    with Basic auth built from `creds` and `grant_type=refresh_token`. Return
    the **rotated** refresh token; the generic persist step already stores it.
  - Add one harness case with `VENDOR_URL_X_API`.
  - Converting `oauth/twitter/disconnect.ts` to the resolver can ride along
    once KB-22 lands (it is on T6's allowlist).
- **FILM-CC-03 (remaining gaps).** It inherits the harness (fake admin
  client plus local listener) and the credential/authorization failure split.
  Still open for it:
  1. `sendReauthNotification` is a stub (`token-refresh.ts:578`). The
     notification should fire only on `REFRESH_FAILED`, never on
     `APP_NOT_CONFIGURED`.
  2. Log successful refreshes.
  3. Tests for the cron job and for concurrency.
  4. **Page `refreshExpiringTokens`'s read** (`refresh-expiring-tokens.ts:75-81`),
     which is unpaged against the 1,000-row cap.
  5. Two duplicate cron routes, `/api/cron/token-refresh` and
     `/api/cron/refresh-tokens`, of which the lambda calls the first.
  6. Retry and backoff before deactivating on 5xx or network errors.
  7. `refreshConnectionAction` throws its refusal
     (`connection-actions.ts:167`), which is the KB-6 class. The UI shows a
     fixed toast, so nothing is lost today, but it should return a value.

  T5 also verifies FILM-CC-03's "Failed refresh marks connection inactive —
  unverified" criterion through T7. The FILM-CC-03 owner can cite it.

## 32. Implementation Plan

1. **Tests first (red).**
   - Build the harness.
   - Write T1–T8.
   - Delete the self-fulfilling cases.
   - Run on unchanged code and record each failure and its reason.
   - Depends on nothing. No DB impact.
2. **Resolver.**
   - Add `server/oauth-app-credentials.ts` and export it from `server/index.ts`.
   - Move the body of `getGlobalOAuthCredentials` into it.
3. **Refresh.**
   - Rewire `token-refresh.ts`: `PLATFORM_APP`, credentials resolved once,
     the new per-platform signatures, the `AppNotConfiguredError` branch.
   - Remove `@ts-expect-error`.
   - T1–T5 and T7 go green.
4. **Routes.**
   - Convert the 10 connect/callback routes.
   - T6 and T8 go green.
5. **Remove dead readers.**
   - Delete `getGlobalOAuthCredentials` from `global-oauth-actions.ts`, and
     `getAccountOAuthApp(Admin)`.
   - Delete `oauth/tiktok/refresh.ts` and its export.
   - `pnpm typecheck`.
6. **Guards.**
   - Add `tooling/mutation-guards/kb-29.json`.
   - Run `python3 tooling/mutation-guards/run.py --kind unit` for kb-29.
7. **Evidence** (DB lock, heavy slot).
   - E1: real-DB rerun.
   - E2: diagnostic query check.
   - §27: build, manifest grep and cron-route run on port 3104.
8. **Records.**
   - KB-29 → **Fixed (#PR)** plus one row in the FILM-CC-04 *Fixed* table.
   - FILM-706 "Refresh token rotation is handled correctly" and "Test token
     refresh with rotation": met, with evidence.
   - FILM-707 "Token refresh works for both platforms": met, with evidence.
   - Empty their `remaining` entries closed by KB-29.
   - Update the `specs/INDEX.md` rows if their status changes.
   - Leave FILM-CC-03 untouched (its own ticket).
9. `pnpm lint:fix`, `pnpm format:fix`, commit, push, PR.

Rollback at any stage is a revert. No data changes.

## 33. Definition of Done

- [ ] T1–T6 seen red on `origin/main` for the stated reason, then green; T7
      and T8 green
- [ ] Each fix reverted in turn turns its test red; `kb-29.json` mutation
      guards pass in CI
- [ ] E1: the real-DB rerun shows YouTube, TikTok, Instagram and LinkedIn
      refreshed with the global or env `client_id`, still active
- [ ] E2: the diagnostic query runs locally, every verdict branch is
      exercised, and the output is in the PR
- [ ] No `@ts-expect-error` in `token-refresh.ts`; `pnpm typecheck` clean
- [ ] No credential read outside the resolver except the allowlisted, named
      files (T6)
- [ ] Production build: the cron route refreshes against a local vendor; the
      manifest has no secret-returning action
- [ ] `pnpm lint:fix`, `pnpm format:fix`
- [ ] KB-29, FILM-706 and FILM-707 records updated; the diagnostic query and
      the §25 rollout steps are in the PR body for the owner

## 34. Final Consistency Pass

**Forward.**
- The problem: connections die at their first expiry.
- The user needs connections that stay alive.
- The user does nothing, and expects the card to stay Active and publishing
  and sync to work.
- So the system must refresh with the credentials that minted the token.
- The data: the global table or env, which is exactly what connect reads.
- The architecture: one resolver used by connect, callback and refresh.
- The implementation: §15.
- The tests: T1–T8 red→green, E1 on the real DB.
- The deployment: code only, gated on the owner's query.
- Production verification: the owner's one-hour check.

**Reverse.**
- In production, refresh reads `oauth_app_credentials` (YouTube, Meta) or env
  (TikTok, LinkedIn), the same as connect, and POSTs to the vendor.
- It writes new tokens and never deactivates on a missing configuration.
- Participants: the cron lambda, then the web cron route, `token-refresh.ts`,
  the resolver, and the vendor.
- The user-visible behaviour: the card stays Active, and publishing and sync
  keep working.
- That matches the §2 flow, satisfies FR-1 to FR-7, and delivers the §1
  outcome.

The paths converge. The one place they could diverge is a legacy connection
minted by a different client, which §24 names, the diagnostic query detects,
and Decision 1 resolves.
