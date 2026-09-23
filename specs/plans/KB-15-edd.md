# KB-15 — X connections are never refreshed

Engineering Design Document. Follows `specs/PLAN_TEMPLATE.md`, all 34 sections.

| | |
|---|---|
| Ticket | KB-15 (`specs/cross-cutting/FILM-CC-04-known-bugs.md`, `## KB-15`) |
| Severity | Medium |
| Related | KB-29 (#310, the base), FILM-CC-03 (OAuth Token Refresh), FILM-1723 (X API v2), FILM-1725 Check E, FILM-1729 (X `media.write`) |
| Branch / base | `fix/kb-15-x-token-refresh` / `main` (planned stacked on #310 @ `b8a3a4b9`; rebased onto `main` @ `ef44ffce` after #310 merged) |
| Author / date | kb-15 teammate, 2026-09-23 |
| Size | S: about 12 files, no migration, no UI |

### Reproduction (run, not inferred)

The KB entry says "Confirmed by reading, not by running against X". Both
halves it said *could* be run locally have now been run, on the KB-29 branch
(`b8a3a4b9`), because that is the code this change lands on. No request left
the machine: a local HTTP listener stood in for every vendor host through
`NODE_ENV=test`, `VENDOR_SANDBOX=1` and `VENDOR_URL_*`, and `fetch` was
wrapped to throw on any other origin. The X client id and secret were
invented strings. The scratch tests are not committed.

**R1 — unit, the KB-29 harness plus one X case** (`fakeDb`, real
`@kit/shared/crypto`, local listener, `VENDOR_URL_X_API` set):

| Case | `ensureValidToken` result | Requests X received | `is_active` after | Logged cause |
|---|---|---|---|---|
| X connection, token expired | `{ valid: false, error: 'REFRESH_FAILED', requiresReauth: true }` | **0** | **false** | `Failed to refresh twitter` — `Error: Unknown platform: twitter`, then `Re-auth required for account account-1, platform twitter` |

**R2 — real local DB, the real cron job.** The DB lock was held
04:11:09–04:11:39Z, and the run started with a `supabase db reset` from this
worktree. It seeded one account, two X connections and a YouTube control, then
ran the real `refreshExpiringTokens()` with the real admin client. That is the
function `/api/cron/token-refresh` runs every 30 minutes
(`sst.config.ts:1366-1389`).

Job result: `{ checked: 3, refreshed: 2, failed: 1 }`. The listener received
**one** request in total: `POST /token` (Google), `client_id=global-youtube-id`.

| Row | Selected by the job | Requests for it | Counted as | `is_active` after | Logged |
|---|---|---|---|---|---|
| X, token expired (connected 2h+ ago) | yes | **0** | failed | **false** | `Failed to refresh twitter`: `Unknown platform: twitter` at `token-refresh.ts:367` |
| X, 50 min left (connected 70 min ago) | yes | **0** | **refreshed** | true | nothing |
| YouTube control, expired | yes | 1 | refreshed | true | nothing |

**What R2 adds to the KB entry.** Two things, and the second is broader than X.
1. **When an X connection dies.** The "two hours" in the KB entry is right.
   Before the token is within 5 minutes of expiry, nothing tries to refresh
   it. The first `ensureValidToken` call after that point deactivates the
   connection: the first cron run after T+1h55m (so by T+2h25m), or a publish
   or an analytics sync if one comes first.
2. **The cron job does not refresh what it selects.** It selects
   connections expiring within 1 hour (`refresh-expiring-tokens.ts:41,75-81`),
   but calls `ensureValidToken(conn.id)` without `force`
   (`:105`). That call refreshes only inside the 5-minute buffer
   (`token-refresh.ts:166-169`). So the 50-minute row was **counted as
   refreshed with no request made**. Across 30-minute runs, a token is
   refreshed only at the first run *after* it is within 5 minutes of
   expiry. It is therefore routinely **expired for up to 25 minutes** before
   the cron renews it, for **every** platform: every hour for YouTube's
   1-hour tokens, every two hours for X. The web paths hide this because they
   refresh just in time. The publish worker does not refresh (below), so a
   scheduled publish that lands in that gap is refused. This is FILM-CC-03's
   criterion "Background job refreshes tokens expiring within 1 hour", which
   FILM-CC-03 already assigns to KB-15 (`closed_by: "KB-15"`). Until now it
   was believed false only for X.

**The publish lambda (read, and cited).** `lambda/publish-worker/index.ts:128-132`
says *"Token refresh is handled by a cron job (every 30 min). This just
decrypts and returns the token."* Its check (`:170-181`) refuses only a token
already past `token_expires_at`, and says *"Token expired - please reconnect
your account or wait for refresh"*. For X the "refresh" is R2: the cron
deactivates the connection instead, so the lambda then answers
`Platform connection is inactive` (`:160-162`). Scheduled publishes reach X
only through this lambda: the `scheduled-publish` lambda enqueues without any
token check (`lambda/scheduled-publish/index.ts:186-255`).

---

## 1. Start With the User

**Who.** The owner — the first and only end-to-end user — who connects an X
account under **Settings → Platforms** and publishes to it, now or on a
schedule.

**Problem.** An X connection works for about two hours. X access tokens last
two hours (`oauth/twitter/config.ts:20-21`, and X's own docs, §8). The first
token check after T+1h55m fails with `Unknown platform: twitter` and marks
the connection inactive (R1, R2). That check is the cron run, by T+2h25m at
the latest, or a publish or a sync. From then on:
- the card shows **Expired → Reconnect**;
- a scheduled post to X fails with "Platform connection is inactive";
- reconnecting restarts the same clock.

**A second problem, found while reproducing (R2), which affects every
platform.** The "refresh within an hour" cron job refreshes nothing until a
token is within 5 minutes of expiry. So on its 30-minute cadence, tokens are
regularly **expired for up to 25 minutes** before it renews them. The web app
hides this by refreshing just in time. The publish worker does not refresh,
so a **scheduled** post (to YouTube today, and to X after this fix) that
lands in that gap is refused. This is the FILM-CC-03 criterion that FILM-CC-03
itself assigns to KB-15, and without it the worker cannot agree with the app
(AC 3). Its fix is one argument (FR-9, Decision 1).

Today this is masked: X *video* publishing fails for a separate reason
(FILM-1729, the missing `media.write` scope, deferred on credentials). So the
user-visible symptom is a connection that keeps expiring. Once FILM-1729
lands, it would be every scheduled X post more than two hours after connecting.

**After the fix.**
- An X connection stays **Active** across token expiries with no user action,
  until the user revokes the app at X or disconnects.
- The cron job really refreshes every token that expires within the hour, so
  no connection's token is ever left expired between runs (FR-9).
- The refresh token X returns is stored, so the *next* refresh works too.
- The publish lambda accepts exactly the tokens the app would accept, and
  refuses (for a retry) exactly the ones the app would refresh first.
- Adding a seventh platform without teaching refresh about it is a compile
  error, not a connection that silently dies.

**Success.** A connection made at T is still **Active** at T+3h, and its
`token_expires_at` has moved forward at least once with no user involvement.

**Failure, meaning an intended and visible one.** Only a genuine
authorization failure — the user revoked the app, or X refused the refresh
token — asks the user to reconnect: **Expired → Reconnect**, unchanged.

**Persistence.** The refreshed access token, the rotated refresh token and the
new expiry are written to `platform_connections`, as for every other
platform. Nothing new is persisted.

## 2. Define the Complete User Journey

| Stage | User action | System response | User sees | Next |
|---|---|---|---|---|
| Entry | Clicks **Connect X** | `connect/twitter` → X consent (unchanged) | X consent screen | Approves |
| Callback | Approves | `callback/twitter` exchanges the code (Basic auth), stores the encrypted access token (2h), refresh token and expiry (unchanged) | Card **Active** | Leaves |
| Background, every 30 min | none | Once < 60 min remain, `refreshExpiringTokens` → `ensureValidToken(id, false, { refreshWithinMs: CRON_REFRESH_WINDOW_MS })` (**FR-9**; today it waits for the 5-min buffer) → **`refreshXToken`** → X returns a new access token and a new refresh token → both stored | Nothing; the card stays **Active** | none |
| Publish now | Publishes to X | `publish-actions` → `getAccessToken` → `ensureValidToken`, which refreshes just in time if the token is within 5 minutes of expiry | The publish proceeds (and, until FILM-1729, fails on the missing scope as today) | none |
| Scheduled publish | none (scheduled earlier) | `scheduled-publish` lambda enqueues; the publish worker checks the token with **the same expiry rule** as the app | Published, or a retry if the token is inside the 5-minute window | none |
| Manual refresh | Clicks refresh on the X card | `refreshConnectionAction` → `ensureValidToken(id, true)` → `refreshXToken` | Success toast | none |
| Revocation (alternate) | Revokes the app at X | Next refresh gets 400 from X → connection marked inactive, re-auth stub logged (unchanged path) | **Expired → Reconnect** | Reconnects |
| Operator misconfiguration (alternate) | none | `TWITTER_CLIENT_ID`/`_SECRET` unset → `APP_NOT_CONFIGURED`, connection **kept** (KB-29's rule, now reached by X) | **Expired** once the token lapses | Operator sets the env; the next cron run heals it |
| Reload | Reloads the page | Status derived from the DB (`determineStatus`) | Same state | none |

No cancellation or session concern: refresh runs server-side with no user
session.

## 3. Explicitly Define the Happy Path

An X connection made at 10:00 (access token until 12:00):

1. **Cron, first run after 11:00.** EventBridge → `token-refresh` lambda →
   `GET {API_URL}/api/cron/token-refresh` → `refreshExpiringTokens` selects
   active connections with `token_expires_at < now + 1h`
   (`jobs/refresh-expiring-tokens.ts:75-81`). The X row qualifies.
2. **New (FR-9).** The job calls `ensureValidToken(id, false, {
   refreshWithinMs: CRON_REFRESH_WINDOW_MS })`, the same one-hour constant its
   select uses. The token has under an hour left, so it needs a refresh now,
   not at the 5-minute buffer. `ensureValidToken` reads the row, takes the
   optimistic lock (`metadata.is_refreshing` + `updated_at`) and decrypts the
   refresh token.
3. **New.** The row's `platform` string is *parsed* to `Platform`
   (`isPlatform`), not cast. `'twitter'` is a member.
4. `refreshTokenForPlatform('twitter', …)` → `PLATFORM_APP.twitter` is
   `'twitter'` → `getOAuthAppCredentials('twitter')` reads
   `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` — the same lookup
   `connect/twitter` and `callback/twitter` use since KB-29.
5. **New.** `refreshXToken(refreshToken, credentials)`:
   `POST {vendorUrl('x-api')}/2/oauth2/token`,
   `Authorization: Basic base64(client_id:client_secret)`,
   `Content-Type: application/x-www-form-urlencoded`, body
   `grant_type=refresh_token&refresh_token=<token>`. This is the shape X
   documents for a confidential client (§8) and the shape the callback already
   uses for the code exchange (`callback/twitter/route.ts:109-126`), built by
   the same helper.
6. X answers `{ token_type, access_token, refresh_token, expires_in: 7200, scope }`.
7. The existing persist step (`token-refresh.ts:220-243`) stores the encrypted
   access token, `token_expires_at = now + expires_in`, and — because a
   `refresh_token` was returned — the encrypted **new** refresh token. The
   lock is released.
8. `{ valid: true, accessToken }`; the job counts it `refreshed`.
9. **User** sees nothing; at 13:00 the card is still **Active**. At the next
   cycle, step 5 sends the refresh token stored in step 7.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| X returns **no** `refresh_token` on refresh | The access token and expiry are stored; the existing refresh token is **kept** (persist only overwrites when one is returned, `:233-238`) | none | none | Active |
| X returns a new `refresh_token` (expected; §8) | Stored, replacing the old one | none | none | Active |
| X refuses the refresh token (400 `invalid_request` / `invalid_grant`: revoked, already used, expired) | Throws `X refresh failed: <error_description>`; connection marked inactive; re-auth stub logged — the unchanged KB-29 path | **Expired → Reconnect** | Reconnect | Inactive until reconnected |
| X refuses the client (401 `unauthorized_client`, wrong secret) | Same as above; the log names the credential source (`TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET`, KB-29 FR-7) | **Expired → Reconnect** | Operator fixes the env, user reconnects | as above |
| `TWITTER_CLIENT_ID` or `_SECRET` unset | `AppNotConfiguredError` → `APP_NOT_CONFIGURED`, **not** deactivated, lock released (KB-29) | **Expired** after lapse | Operator sets env; next cron run refreshes | Active, healed |
| X answers 200 without `access_token` or a numeric `expires_in` | Throws `X refresh failed: malformed token response`; deactivated (as any refresh failure) | **Reconnect** | Reconnect | Inactive |
| Network error / X 5xx | Throws; deactivated — **unchanged** for every platform; retry and backoff are FILM-CC-03's | **Reconnect** | Reconnect | Inactive |
| The persist update fails after X rotated the token | **New:** the update's error is checked and logged at error level, naming the connection and that a rotated refresh token was not stored (Decision 4). The caller still gets the valid access token | none now; the next refresh will fail with `invalid_request` and ask for a reconnect | Reconnect | Active until next refresh |
| Two refreshes of one X connection at once | In-process dedupe (`inFlightRefreshes`) and the cross-process optimistic lock (`.eq('updated_at', …)`, `:191-205`) — unchanged. This matters more for X than for YouTube: a second concurrent refresh would send an already-rotated token and get deactivated | none | none | Active |
| Publish worker gets an X job whose token has < 5 min left | **New:** refused with the existing "Token expired…" text, thrown so SQS redelivers after 300 s (existing mechanism). By then the cron has usually refreshed it. This only happens when the cron is behind or failing, because the cron keeps tokens at least 30 min from expiry | The publish screen shows the error, then success if the redelivery works (existing behaviour, §5) | Automatic redelivery, up to 3 receives | Published on redelivery, or failed and in the DLQ |
| A `platform` value outside `Platform` (impossible under the DB CHECK) | `isPlatform` fails → throws `Unknown platform: <value>` inside the refresh `try` → same path as today (deactivate). No cast | **Reconnect** | none needed in practice | unchanged behaviour |

## 5. Establish the User-Facing Contract

- **No UI change.** No component, message, i18n key or screenshot. The card's
  states (`Active` / `Expired` / `Error`) are unchanged.
- **Internal contract.** `TokenValidationResult` is unchanged. `Platform`
  gains `'twitter'`, which widens the argument type of `formatPlatformName`
  (already `Platform | string`) and of nothing else exported.
- **Publish worker.** Its refusal text is **unchanged**: *"Token expired -
  please reconnect your account or wait for refresh"*. That text is
  user-visible. On any failure the worker marks the publish `failed`, stores
  the text in its metadata and pushes it over WebSocket
  (`publish-worker/index.ts:586-618`), and the publish screen shows it as the
  platform's error (`publish-screen.tsx:602-613`). Keeping it avoids a UI
  change, and after this fix "wait for refresh" is true for X. What changes is
  *when* it is sent: also for a token inside the app's 5-minute refresh
  window, not only one already past expiry. SQS then redelivers after the
  queue's 300 s visibility timeout, up to 3 receives (`sst.config.ts:395-404`).
  A successful redelivery sends `publish-success`, which replaces the error on
  the screen. All of this is existing worker behaviour.
- `formatPlatformName('twitter')` returns `'X'` (today it returns
  `'twitter'`). Its only caller is a commented-out notification.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Why | Trigger / processing | Success | Failure | Verification |
|---|---|---|---|---|---|---|
| FR-1 | An expired or near-expiry X connection is refreshed | The defect | `refreshTokenForPlatform('twitter')` → `refreshXToken` | `{ valid: true }`; X got one POST to `/2/oauth2/token` with Basic auth from the env client and `grant_type=refresh_token` | 0 requests, `Unknown platform: twitter` | T1, T6 red first; E1 |
| FR-2 | The refresh token X returns is stored, and the next refresh sends it | X is understood to rotate; without this the *second* refresh fails | Existing persist step | Stored refresh token decrypts to X's new value; a second refresh sends it | Old token sent | T2 red first; E1 |
| FR-3 | A refresh response without `refresh_token` keeps the existing one | Correct whether or not X rotates (rotation is undocumented, §8) | Existing persist rule | Stored refresh token unchanged | Overwritten or cleared | T3 |
| FR-4 | `Platform` is derived from one list bound to the `platform_connections.platform` CHECK; no `as Platform` cast remains in `token-refresh.ts`; the dispatch is exhaustive under `tsc` | The class: the cast is how a sixth value reached the switch unseen | `PLATFORMS` const + `isPlatform` guard; `default` assigns to `never` | `tsc` fails if a member is unmapped; a test fails if the list and the CHECK differ | A new platform compiles unmapped | T7, T8; `pnpm typecheck`; mutation guard |
| FR-5 | The publish worker's token check uses the app's expiry rule | KB-15 AC 3 | One pure `isWithinRefreshWindow` used by both | For X: a token the app would use, the worker uses; a token the app would refresh first, the worker refuses for retry | They disagree | L1–L3, L2 red first |
| FR-6 | A failed write of a rotated refresh token is logged, not silent | With rotation, a lost write is a future forced reconnect | Check the persist update's `error` | Error log naming the connection and "rotated refresh token not stored" | Silent | T9 (Decision 4) |
| FR-7 | X's Basic-auth header is built in one place for the code exchange and the refresh | Fix the class: the same credential encoding written twice would drift | `xClientAuthorization(credentials)` in `oauth/twitter/config.ts` | Callback and refresh import it | Two encodings | T1 asserts the header; grep |
| FR-8 | Missing X credentials keep the connection (KB-29's rule reaches X) | Operator fault ≠ user reconnect | Inherited | `APP_NOT_CONFIGURED`, `is_active` true | Deactivated | T5 |
| FR-9 | The cron job refreshes every connection it selects, rather than waiting for the 5-minute buffer (Decision 1) | R2: tokens lapse for up to 25 min between runs, and the non-refreshing worker refuses scheduled publishes in that gap. FILM-CC-03 assigns this criterion to KB-15 | `ensureValidToken(id, false, { refreshWithinMs: CRON_REFRESH_WINDOW_MS })`; the select and the refresh share one constant | A connection with 50 min left gets one refresh request per run; after any run, every active token has ≥ 30 min left | 0 requests, counted "refreshed" (R2) | T10, red first; E1 |

## 7. Define Non-Functional Requirements

- **Performance.** One outbound POST per X connection every 60–90 minutes.
  FR-9 also makes YouTube refresh on every cron run (§24). No new DB reads.
- **Reliability.** X connections survive indefinitely. Rotation is handled in
  both cases (returned or not). The worker no longer starts an upload with a
  token about to lapse.
- **Security.** The client secret is read only by the KB-29 resolver and only
  sent to `vendorUrl('x-api')` in the `Authorization` header — never in a URL,
  never logged. Tokens stay encrypted at rest.
- **Observability.** X refresh failures log with `app: 'twitter'` and the
  credential source, via KB-29's catch. The new persist-failure log (FR-6).
- **Compatibility.** No schema change. Existing X connections — all currently
  inactive or about to be — need one reconnect after deploy (§24).
- **Maintainability.** One platform list; one expiry rule; one X auth helper.
- **Accessibility, i18n.** Not applicable: no UI.
- **Cost.** X's refresh endpoint is part of OAuth, not a metered API call on
  the pay-per-use plan as far as X documents; it is not listed in the
  billing schedule the capability reference cites. Recorded as inferred (§31).

## 8. Analyze the Existing System

**Components (on the KB-29 base).**
- `packages/features/publishing/src/lib/token-refresh.ts`:
  - `type Platform` restates five of the six values and omits `'twitter'`
    (`:49-54`).
  - `PLATFORM_APP: Record<Platform, OAuthApp>` (`:60-66`) — exhaustive over
    that five-member union, so X is simply absent.
  - `connection.platform as Platform` (`:211`, `:271`, `:293`) — the DB value
    is a `string` (`database-types.ts:9`), cast without a check.
  - `refreshTokenForPlatform` (`:359-389`): `PLATFORM_APP['twitter']` is
    `undefined`, so `if (!app) throw new Error('Unknown platform: …')`
    (`:366-368`) — the KB-29 form of the old `default: throw`. The `default`
    at `:386-387` is not exhaustive (no `never`).
  - The persist update (`:240-243`) ignores its `error`.
  - `formatPlatformName` has no `twitter` (`:587-596`).
- `packages/features/publishing/src/server/oauth-app-credentials.ts` (KB-29):
  already maps `twitter` to `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET`
  (`:45-49`); X connect and callback already use it.
- `apps/web/app/api/platforms/callback/twitter/route.ts:109-126`: builds
  `Basic base64(id:secret)` inline for the code exchange.
- `apps/web/lambda/publish-worker/index.ts:133-200`: its own
  `ensureValidToken`, non-refreshing, `expiresAt <= now` with no buffer, and a
  message promising a refresh. Called for publish, delete and social text
  posts (`:312`, `:364`, `:433`).
- The web app's rule: refresh when `force || !expiresAt || expiresAt - now <
  EXPIRY_BUFFER_MS` (5 min) (`token-refresh.ts:162-169`).
- `jobs/refresh-expiring-tokens.ts` selects `token_expires_at < now + 1h`
  (`:41,75-81`) and then calls `ensureValidToken(conn.id)` (`:105`), which
  applies the 5-minute rule above. So a selected row with 6–60 minutes left is
  returned untouched and still counted `refreshed` (`:107-108`). R2 measured
  this. The file has not changed since 2025-12-14 (`c36665be`), so this is
  how the cron has always behaved.

**Every caller of the web `ensureValidToken`** runs in the web app
(listed in KB-29 EDD §8): the cron job, publish-now, manual refresh, the
analytics syncs. All reach X through `refreshTokenForPlatform`, so one fix
covers them.

**The platform list is restated five times** (all six values, except
token-refresh's five):
`lib/types.ts:6-12` (`Platform`), `types.ts:6-12` (`PlatformType`),
`lib/job-types.ts:10-16` and `:28-34` (inline unions), `token-refresh.ts:49-54`.
The only authority is the DB CHECK
(`20251205125737_film-studio-tables.sql:226`), a `varchar(50)` check, so the
generated types say `string` and cannot be derived from.

**X's documentation (docs.x.com, read 2026-09-23).**
- *Documented:* the refresh request — `POST https://api.x.com/2/oauth2/token`,
  `application/x-www-form-urlencoded`, `grant_type=refresh_token`,
  `refresh_token`; for a confidential client "You don't need client id for
  confidential clients with a valid Authorization Header" (Basic)
  (`/fundamentals/authentication/oauth-2-0/authorization-code`,
  `/…/user-access-token`). A refresh token is issued only with
  `offline.access`, which we request. The access token lasts two hours.
- *Not documented:* whether the refresh token **rotates** (a new one per use,
  the old one invalidated) or its lifetime. The two OAuth pages, the OAuth
  FAQ and the OAuth API reference were read; none says. The KB entry asked for
  this to be confirmed before relying on it. It cannot be confirmed without an
  X credential, so the design does **not** rely on it (FR-2 + FR-3 are correct
  either way) and the capability reference records it as *inferred* (§31).

**Tests today.** `__tests__/token-refresh.test.ts` (KB-29's harness: `fakeDb`,
local listener, real crypto) has no X case. `lambda/publish-worker/__tests__/`
has only `twitter.test.ts` (the upload protocol). CI runs both packages
(`scripts/test-units.sh:15,45`).

## 9. Define the Desired System Behavior

**Cron.** Select rows expiring within `CRON_REFRESH_WINDOW_MS` → for each,
`ensureValidToken(id, false, { refreshWithinMs: CRON_REFRESH_WINDOW_MS })` →
refreshed now. After a run, every active connection it could refresh has
≥ 30 minutes left (window 60 min − cadence 30 min), so neither the worker nor
anything else meets an expired token while the cron is healthy.

**Refresh.** cron / publish-now / manual → `ensureValidToken(id)` → parse
`platform` (`isPlatform`) → lock → `refreshTokenForPlatform('twitter', rt)` →
`getOAuthAppCredentials('twitter')` → `refreshXToken` → `POST
/2/oauth2/token` (Basic) → persist access token, expiry and returned refresh
token (error checked) → `{ valid: true }`.

**Worker.** job → `checkConnectionToken(id, client)` → inactive / missing →
refuse (unchanged); `isWithinRefreshWindow(expiresAt, now)` → refuse with
the existing "Token expired…" text (SQS redelivers); otherwise decrypt and use.

**Adding a platform.** Add it to `PLATFORMS` → `PLATFORM_APP` and
`FORMATTED_NAMES` fail to compile until mapped, the `never` default fails
until a refresh case exists, and T7 fails until the DB CHECK allows it.

## 10. High-Level Architecture

- **New pure module** `packages/features/publishing/src/lib/platforms.ts`
  (`@kit/publishing/lib/platforms`): `PLATFORMS`, `Platform`, `isPlatform`. No
  `server-only`, no imports — the lambda imports it through `job-types`.
- **New pure module** `packages/features/publishing/src/lib/token-expiry.ts`
  (`@kit/publishing/lib/token-expiry`): `EXPIRY_BUFFER_MS`,
  `isWithinRefreshWindow(expiresAt, now)`. Used by the web refresh and the
  worker.
- **`lib/token-refresh.ts`**: `twitter` in `PLATFORM_APP`, `refreshXToken`,
  parse instead of cast, exhaustive switch, checked persist, optional
  `refreshWithinMs`.
- **`jobs/refresh-expiring-tokens.ts`**: selects and refreshes with the same
  `CRON_REFRESH_WINDOW_MS` (FR-9). Both cron routes (`/api/cron/token-refresh`,
  which the lambda calls, and the duplicate `/api/cron/refresh-tokens`) call
  this one function, so both are covered.
- **`oauth/twitter/config.ts`**: `xClientAuthorization(credentials)`, used by
  the callback and by refresh.
- **Publish worker**: its token check moves from `index.ts` to
  `publish-worker/token.ts` (so it is testable without the module's AWS and
  Supabase side effects) and uses `isWithinRefreshWindow`.
- **Trust boundary** unchanged: secrets go from env to X's token endpoint,
  server-side only.
- **Why the worker does not refresh** (§29): X refresh tokens are understood to
  be single-use. A second refresher (the worker) racing the web app's would
  send an already-used token and get the connection deactivated. It would also
  need the X client secret in the worker's environment. One refresher — the
  web app, behind its lock — is the design.

## 11. Architecture and Flow Diagrams

```
              lib/platforms.ts  PLATFORMS ─▶ Platform, isPlatform
                    │                   ▲
                    │ derives           │ bound by test T7
                    ▼                   │
 token-refresh.ts ◀─┤        migrations: platform_connections CHECK
 lib/types.ts ◀─────┤
 types.ts ◀─────────┤
 lib/job-types.ts ◀─┘──▶ lambda/publish-worker

              lib/token-expiry.ts  isWithinRefreshWindow
                 ▲                         ▲
     token-refresh.ts (refresh first)   publish-worker/token.ts (refuse, retry)
```

Refresh sequence (new parts marked `*`):

```
cron ─▶ refreshExpiringTokens ─▶ ensureValidToken(id)
   read row ─▶ * isPlatform(row.platform) ─▶ lock
   refreshTokenForPlatform('twitter')
      creds = getOAuthAppCredentials(PLATFORM_APP.twitter)       (env)
    * refreshXToken: POST /2/oauth2/token  Authorization: Basic …
                     grant_type=refresh_token&refresh_token=…
   ◀─ { access_token, refresh_token', expires_in }
   persist(access, expiry, refresh_token')  * error checked ─▶ {valid:true}
```

## 12. End-to-End Data Flow

**Source.** X, at the callback: access token (2h), refresh token, `expires_in`,
`scope`. Encrypted and stored (`callback/twitter/route.ts:196-220`).

**Refresh.** The stored refresh token is decrypted in memory, sent once to X,
and replaced by the one X returns. The access token and
`token_expires_at` are replaced.

**Use.** Publish-now and the syncs read through `ensureValidToken`; the worker
reads and decrypts directly (`publish-worker/crypto.ts`, the same AES-GCM
format as `@kit/shared/crypto`).

**Loss points.**
1. A rotated refresh token that X issued but we failed to store — FR-6 logs
   it; the connection needs one reconnect at the next refresh.
2. A concurrent second refresh — prevented by the existing lock.
3. `metadata.refresh_expires_at` (written by the callback as now + 180 days,
   `:192-194,219`) is never updated by refresh and **never read** anywhere
   (grep, with the callback as positive control). It is left as is and noted;
   it is not a loss point for behaviour.

**Retention.** Unchanged.

## 13. Data Model

| Entity | Authoritative for | Change |
|---|---|---|
| `platform_connections` | tokens, expiry, `is_active`, lock metadata | none (X rows now refreshed like the others) |
| `PLATFORMS` (code) | the set of values `platform` may hold, mirrored from the CHECK | **new**; bound to the CHECK by T7 |
| Deployment env `TWITTER_CLIENT_ID/SECRET` | X app credentials | none (KB-29 made refresh read it) |

**Invariant introduced.** Every value `platform_connections.platform` may hold
has a refresh path, or the build fails.

## 14. Database Design and Changes

**None.** No migration, no typegen, no RLS change, so no pgTAP. The CHECK
already allows `'twitter'`; T7 reads it, it does not change it.

## 15. Low-Level Design

**`src/lib/platforms.ts`** (new):

```ts
/**
 * The values `platform_connections.platform` may hold: its CHECK constraint
 * (20251205125737_film-studio-tables.sql). `platforms.test.ts` fails if the
 * two differ.
 */
export const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'linkedin'] as const;
export type Platform = (typeof PLATFORMS)[number];
export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}
```

**`src/lib/token-expiry.ts`** (new):

```ts
/** Refresh just in time: a token this close to expiry is not handed out. */
export const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
/** The cron job's window: what it selects and what it refreshes (FR-9). */
export const CRON_REFRESH_WINDOW_MS = 60 * 60 * 1000;

/** True when a token expiring at `expiresAt` should be refreshed before use. */
export function isWithinRefreshWindow(
  expiresAt: Date,
  now: Date,
  windowMs: number = EXPIRY_BUFFER_MS,
): boolean {
  return expiresAt.getTime() - now.getTime() < windowMs;
}
```

**`src/jobs/refresh-expiring-tokens.ts`** (FR-9): `oneHourFromNow` becomes
`now + CRON_REFRESH_WINDOW_MS`, and the loop calls `ensureValidToken(conn.id,
false, { refreshWithinMs: CRON_REFRESH_WINDOW_MS })`. The select and the
refresh then cannot disagree about the window again.
A null expiry keeps each side's current policy (the app refreshes, the worker
uses it): every callback writes an expiry, so only hand-made rows have none,
and changing the worker's null handling would strand them (the cron job skips
null expiries, `refresh-expiring-tokens.ts:79`).

**`src/lib/token-refresh.ts`:**
- `import { type Platform, isPlatform } from './platforms'`;
  `export type { Platform }` so existing importers are unaffected. The local
  union is deleted.
- `PLATFORM_APP` gains `twitter: 'twitter'` (compile error until it does).
- `ensureValidToken(connectionId, force = false, { refreshWithinMs =
  EXPIRY_BUFFER_MS } = {})`. The third argument is optional, so every existing
  caller is unchanged, including `connection-actions.ts` (KB-22's file). It
  is threaded to `doEnsureValidToken`.
- `needsRefresh = force || !expiresAt || isWithinRefreshWindow(expiresAt, now,
  refreshWithinMs)`. `getExpiryBuffer()` keeps returning `EXPIRY_BUFFER_MS`,
  now imported from `token-expiry`.
- The in-flight dedupe stays keyed by connection id. A cron call that joins an
  in-flight just-in-time call gets that call's result. That is harmless: the
  next run, 30 minutes later, still has ≥ 30 minutes of margin to act in.
- In the `try`: `if (!isPlatform(connection.platform)) throw new
  Error(\`Unknown platform: ${connection.platform}\`)`; then pass the narrowed
  value. The `catch` computes `app` with the same guard. `sendReauthNotification`
  takes `platform: string` (it only logs). No `as Platform` remains.
- `refreshTokenForPlatform`: `const app = PLATFORM_APP[platform]` (no `if
  (!app)` — the Record makes it total); `case 'twitter': return
  refreshXToken(refreshToken, credentials)`; `default: { const unhandled:
  never = platform; throw new Error(\`Unknown platform: ${unhandled}\`) }`.
- `refreshXToken(refreshToken, oauthApp)`:
  ```ts
  const response = await fetch(TWITTER_OAUTH_CONFIG.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: xClientAuthorization(oauthApp),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`X refresh failed (${response.status}): ${error.error_description ?? error.error ?? 'Unknown error'}`);
  }
  const data = await response.json();
  if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
    throw new Error('X refresh failed: malformed token response');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // X is understood to rotate it; stored when present
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
  ```
  `TWITTER_OAUTH_CONFIG.tokenUrl` is `${X_API_BASE}/oauth2/token`, i.e.
  `vendorUrl('x-api')/2/oauth2/token` — the host comes from
  `@kit/shared/vendors`, as the KB asks.
- Persist: `const { error: persistError } = await client…update(…)`; on error,
  `logger.error({ name: 'token-refresh', platform, connectionId,
  refreshTokenRotated: Boolean(refreshed.refreshToken), error: persistError },
  'Refreshed tokens were not stored')` and still return the valid access
  token (Decision 4).
- `formatPlatformName`: names become `Record<Platform, string>` with
  `twitter: 'X'`; the signature stays `(platform: Platform | string)`.

**`src/oauth/twitter/config.ts`:**
`export function xClientAuthorization({ clientId, clientSecret }:
OAuthAppCredentials): string` → `` `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` ``
(type-only import of `OAuthAppCredentials`, so the config stays free of
`server-only`). `callback/twitter/route.ts:109-118` switches to it; the
encoding is byte-identical to today's, so connect is unaffected.

**Type restatements** (Decision 3): `lib/types.ts` →
`export type { Platform } from './platforms'`; `types.ts` →
`export type PlatformType = Platform`; `lib/job-types.ts` → `platform:
Platform` in both messages. All are type-only and equal to today's unions.

**Publish worker:**
- New `apps/web/lambda/publish-worker/token.ts` exporting
  `checkConnectionToken(connectionId, client, now = new Date())` — the body of
  today's `ensureValidToken` (`index.ts:133-200`) with the expiry test replaced
  by `expiresAt && isWithinRefreshWindow(expiresAt, now)`. The returned `error`
  text is byte-identical to today's (§5). A `console.warn` records the
  minutes remaining. `index.ts` imports it, and the three call sites are
  unchanged apart from the name.

Idempotency, transactions and locking are unchanged.

## 16. API and Event Design

No HTTP API or event change. TypeScript surface:
- `@kit/publishing/lib/platforms` (new): `PLATFORMS`, `Platform`, `isPlatform`.
- `@kit/publishing/lib/token-expiry` (new): `EXPIRY_BUFFER_MS`,
  `isWithinRefreshWindow`.
- `@kit/publishing/token-refresh`: `Platform` now includes `'twitter'`
  (re-exported from `platforms`); `getExpiryBuffer`, `formatPlatformName`,
  `ensureValidToken` unchanged in signature.
- `@kit/publishing/oauth/twitter`: + `xClientAuthorization`.
- The SQS message types are unchanged in shape (`platform` is the same union,
  now named).

## 17. State and Lifecycle Design

`platform_connections`, for X:

| From | Event | To | Change |
|---|---|---|---|
| active | cron/just-in-time refresh OK | active | **was → inactive** (`Unknown platform`) |
| active | X refuses the refresh token | inactive | none (same path) |
| active | X credentials unset | active (lock released) | **was → inactive** (KB-29 rule now reached) |
| inactive | user reconnects (callback upsert `is_active: true`) | active | none |

Terminal: none. Disconnect deletes the row (KB-22's area, untouched).

## 18. Failure and Error Handling

| Failure | Behaviour | User | Recovery |
|---|---|---|---|
| X 400 (`invalid_request`/`invalid_grant`) | Deactivate, re-auth stub, log `X refresh failed (400): <description>` with credential source | **Reconnect** | User reconnects |
| X 401 (client rejected) | Same, the log naming `TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET` | **Reconnect** | Operator fixes env |
| X 429 / 5xx / network | Deactivate — unchanged for all platforms (FILM-CC-03 owns retry/backoff) | **Reconnect** | Reconnect |
| Malformed 200 | Throw, deactivate | **Reconnect** | Reconnect |
| Env unset | `APP_NOT_CONFIGURED`, kept | **Expired** after lapse | Operator |
| Persist failed after a rotation | Error log (FR-6); valid access token returned | none until next refresh | Reconnect at next refresh |
| Worker: token inside the refresh window | Throw the existing "Token expired…" refusal; SQS redelivers (existing mechanism) | Error on the publish screen, then success if a redelivery works | Automatic |

A 429 deactivating the connection is a real risk for X, whose rate limits are
tight; it is recorded for FILM-CC-03 (§31) rather than fixed here, because the
same rule governs every platform.

## 19. Security

- The X client secret is read only via `getOAuthAppCredentials` (KB-29) and
  sent only in the `Authorization` header to `vendorUrl('x-api')`. It is never
  logged; T1's log assertions include "no secret in any log line".
- `vendorUrl` honours overrides only under `NODE_ENV` development/test,
  `VENDOR_SANDBOX=1`, outside Lambda, to a local host (FILM-1801), so the
  refresh cannot be redirected in production.
- Refresh tokens stay encrypted at rest; the rotated token is encrypted before
  storage by the existing persist step.
- Single refresher (web app, locked) — no worker refresh, so no secret in the
  worker env and no rotation race (§10).
- No RLS or tenant-boundary change.

## 20. Performance and Scale

One POST per X connection per 60–90 minutes, sequential in the cron loop with
its existing 100 ms spacing. FR-9 adds about 24 YouTube refreshes a day per
connection. The owner has one account per platform. No hot path change.
The unpaged cron read (`refresh-expiring-tokens.ts:75-81`) is KB-29's noted
FILM-CC-03 item; X adds rows to it only at ~1,000 connections.

## 21. Accessibility and Client Behavior

Not applicable: no client change.

## 22. Observability and Operations

- **Works:** the cron log `Complete: N/M refreshed, 0 failed` includes X
  connections, and after FR-9 `refreshed` means a real refresh.
  `token_expires_at` on the X row moves forward every cycle, and after any
  run no active token has less than about 30 minutes left.
- **Fails:** `Failed to refresh twitter` with `app: 'twitter'`,
  `credentialSource`, and `X refresh failed (<status>): <description>`.
  `APP_NOT_CONFIGURED` means the operator must set env.
- **New log:** `Refreshed tokens were not stored` (FR-6).
- **Worker:** the refusal text is unchanged (it is user-visible, §5). The
  worker's `console.error` line gains the token's remaining minutes, so an
  operator can tell "cron is behind or failing" (a few minutes left) from
  "expired long ago" in CloudWatch without a UI change.
- No new metrics or alerts.

## 23. Configuration and Feature Flags

| Config | Used for | Absent |
|---|---|---|
| `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` (web app env) | X connect, callback and now refresh | `APP_NOT_CONFIGURED`; connection kept |
| `VENDOR_URL_X_API` (tests, sandbox only) | Points `x-api` at the local listener | Ignored outside the sandbox |

No feature flag: a correction, rolled back by revert. **No production values
are read or needed.** Tests use invented client strings and a local listener.
The worker needs no new env.

## 24. Compatibility

- **Existing X connections** made before deploy: each has already been
  deactivated at its first cron run after connecting (R2), or will be before
  deploy. `ensureValidToken` returns `CONNECTION_INACTIVE` for them, so they
  need **one reconnect** after deploy. There is no way to revive them without
  one; X's refresh token might still be valid, but reactivating rows
  automatically is not something this change should do silently (Decision 5).
- **Other platforms.** Two changes, both intended:
  - FR-9 makes the cron refresh them earlier. YouTube's 1-hour tokens are
    refreshed on every run: 48 a day per connection, up from about 16–24
    today, where a token is renewed only at the first run after it lapses.
    X's are refreshed once every 60–90 minutes instead of about every
    2–2.5 hours. Meta's and LinkedIn's 60-day tokens are refreshed once, in
    their last hour. Google's documented limit is on the number of live
    refresh tokens per client and user, not on refresh calls. Google does not
    normally issue a new refresh token on refresh, so the rate is not expected
    to matter; the owner can see it in the Google Cloud console. For rotating
    vendors (TikTok, X), every refresh rotates, behind the existing lock.
  - The worker's 5-minute window applies to them too. With FR-9, after every
    healthy run each token has ≥ 30 minutes left, so the window only bites
    when the cron is failing, which is when it should.
- **Before this change** the worker was refusing scheduled publishes on
  every platform whenever one landed in the ≤ 25-minute gap (R2). FR-9 removes
  that gap. This is a behaviour improvement the PR must state.
- **Types:** `Platform` widens by one member; all switches over it in the
  package are checked by `tsc` (Phase 2 runs `pnpm typecheck`, including the
  lambdas once KB-14 lands).
- **Deployment order:** none; code only. The worker and the web app may deploy
  in either order: each alone is correct.

## 25. Migration and Rollout Strategy

1. Merge after #310 (stacked). Deploy through the normal pipeline — web app
   and lambdas together (SST).
2. **Owner, once:** reconnect the X account (existing rows are inactive, §24).
3. **Validation gate (owner, real X):** after reconnecting, wait past two
   hours; confirm the X card is still **Active** and `token_expires_at` has
   moved. This is also the first real answer to the rotation question, and
   the "one live refresh" AC — deferred with FILM-1729 / FILM-1725 Check E,
   because we hold no X credentials now.
4. **Rollback trigger:** refresh failures rising for platforms that worked
   before, or worker refusals for non-X platforms. **Procedure:** revert; no
   data to undo.

## 26. Testing Strategy

All in CI's unit job (`scripts/test-units.sh`): the publishing package and
`pnpm --filter web test` (which includes `lambda/**/__tests__`).

Publishing, on KB-29's harness (`fakeDb` + local listener + real crypto), with
`VENDOR_URL_X_API` and invented `TWITTER_CLIENT_ID/SECRET` added to the
`beforeEach`, and the listener answering `/2/oauth2/token` with a *fresh*
rotated token per call:

| ID | Test | Red on the base because | Covers |
|---|---|---|---|
| T1 | Expired X connection → `{ valid: true }`; exactly one request, `POST /2/oauth2/token`; `authorization` = `Basic base64(env-x-client-id:env-x-client-secret)`; form exactly `{ grant_type: 'refresh_token', refresh_token: 'old-refresh-token' }` (no secret in the body); stored access token and expiry updated; `is_active` true; no log line contains the secret | `Unknown platform: twitter`, 0 requests, deactivated (R1) | FR-1, FR-7 |
| T2 | Rotation: two forced refreshes in a row; the second request carries the refresh token the first response returned; the stored refresh token is the second response's | same | FR-2 |
| T3 | X's response omits `refresh_token` → stored refresh token unchanged | same | FR-3 |
| T4 | X answers 400 `invalid_request` → `REFRESH_FAILED`, deactivated, error names X and the status | same (0 requests) | §18 |
| T5 | `TWITTER_CLIENT_SECRET` empty → `APP_NOT_CONFIGURED`, active, 0 requests | today deactivates via `Unknown platform` | FR-8 |
| T6 | X connection with 4 minutes left (not expired) is refreshed | same | FR-1, FILM-CC-03 "near-expiry" unit item |
| T7 | `platforms.test.ts`: `PLATFORMS` equals, as a set, the values in the **last** migration statement that defines the `platform_connections` platform CHECK. Positive control: at least one such statement is found, or the test fails | new | FR-4 |
| T8 | `formatPlatformName('twitter')` is `'X'` | returns `'twitter'` | §5 |
| T9 | Persist update returns an error → `{ valid: true }` and an error log `Refreshed tokens were not stored` with `refreshTokenRotated: true` | silent today | FR-6 |
| T10 | `refreshExpiringTokens()` over a YouTube connection with 50 min left and an X one with 50 min left: **one refresh request each**, both rows' `token_expires_at` moved forward, and the job's `refreshed` count equals the number of requests. The harness's `fakeDb` gains `.not`, `.lt` and `.order`, which the job's select uses | R2: 0 requests, yet counted `refreshed` | FR-9 |

Publish worker, new `lambda/publish-worker/__tests__/token.test.ts` (fake
client; tokens encrypted with **`@kit/shared/crypto`** and decrypted by the
worker's own `crypto.ts`, so it also proves the two formats agree).
*Phase 2 deviation:* the plan said to pin the `node` environment. That breaks
`apps/web`'s setup file (`window.matchMedia`), and the default happy-dom
environment has WebCrypto, so the test runs as is. `apps/web/vitest.config.ts`
gains two aliases, `@kit/shared/crypto` and `@kit/publishing/lib/token-expiry`.
A catch-all `'@kit'` alias maps any unlisted `@kit/*` subpath onto
`packages/`, so it misresolves; KB-29 aliased `@kit/publishing/oauth/apps` for
the same reason:

| ID | Test | Red on the base because | Covers |
|---|---|---|---|
| L1 | X connection, 2h left → valid, token decrypted | green on base too (pins the happy path) | FR-5 |
| L2 | X connection, 4 min left → refused with exactly today's "Token expired - please reconnect your account or wait for refresh" | the worker accepts it | FR-5 |
| L3 | Inactive → "Platform connection is inactive"; expired → the same text as L2 (both pinned byte-for-byte, so the user-visible text cannot drift) | green on the base (pins unchanged text) | §5 |

The `as Platform` absence and the `never` default are enforced by `tsc` and by
mutation guards, not by a source-grep test.

**Red before green.** T1–T6, T8–T10 and L2 are written first and run on
the unchanged base; each must fail for the reason in the table. Then the fix;
then each fix reverted in turn must turn its test red. Recorded as
`tooling/mutation-guards/kb-15.json`:
- remove `case 'twitter'` (and its map entry) → T1 red (and `tsc` red);
- drop the `Authorization` header → T1 red;
- return `refreshToken: undefined` from `refreshXToken` → T2 red;
- worker back to `expiresAt <= now` → L2 red;
- drop `'twitter'` from `PLATFORMS` → T7 red;
- ignore the persist error → T9 red;
- the cron back to `ensureValidToken(conn.id)` → T10 red.

**Real-DB check (E1, PR evidence).** Re-run R2's scratch on the fix branch
under the DB lock, adding a YouTube row with 50 minutes left. Expected:
- every row is refreshed with **one request each** (including both
  50-minute rows, FR-9);
- `is_active` stays true;
- the X requests carry Basic auth with the env client;
- the stored X refresh token decrypts to the listener's rotated value;
- the job's `refreshed` count equals the number of requests.

**Not applicable.** Playwright (no form or interactive UI; the card's states
are unchanged), pgTAP (no policy change), load tests.

## 27. Production-Build Verification

**Run 2026-09-23, 04:51:10–04:51:42Z** (DB lock taken first, then a heavy
slot). Pre-flight 1 was the real resolver under the run's environment:
`PREFLIGHT OK: all 29 vendors resolve to http://127.0.0.1:3195`. It was shown
to fail without `VENDOR_SANDBOX` and with `NODE_ENV=production`. Pre-flight 2
found no `vendor-overrides` line in the server log. With no secret the cron
route returned 401; with it, 200 and `{ checked: 2, refreshed: 2, failed: 0 }`.
The listener received two `POST /2/oauth2/token`, each with the expected Basic
header and a form of only `grant_type` and `refresh_token`. Both X rows were
active afterwards with 120 minutes left and the rotated refresh token stored.
E1 in the same hold (the real DB, vitest) gave `{ checked: 4, refreshed: 4,
failed: 0 }`: one request per row, the two 50-minute rows included, and every
row active with its rotated token stored.

Applies, because the change runs in the web app's server bundle through a
cron route, and the host resolution (`vendorUrl` at module load in
`vendors/x.ts`) behaves differently in a built bundle than under vitest.

- `pnpm --filter web build:test`, then `NODE_ENV=test next start -p 3114`
  with `VENDOR_SANDBOX=1` and `VENDOR_URL_*` for **every** vendor the refresh
  path can reach (`GOOGLE_TOKEN TIKTOK META_GRAPH LINKEDIN_OAUTH X_API
  X_OAUTH`) pointed at a local listener, invented `TWITTER_CLIENT_*`, a local
  `CRON_SECRET`.
- **Pre-flight, abort on failure.** This is KB-29's `prod-check.sh` pattern,
  extended with `X_API` and `X_OAUTH`:
  - the script refuses to start unless `NODE_ENV=test` and `VENDOR_SANDBOX=1`
    are exported;
  - after `next start`, the server log must contain no `vendor-overrides`
    line. `apps/web/instrumentation.ts` logs every ignored `VENDOR_URL_*`
    (`ignoredVendorOverrides`), which is all of them when the sandbox is off.
    So the absence of that line is what shows `x-api` resolves to the
    listener;
  - no connection is seeded until both checks pass.
- Seed an expired X connection and one with 50 minutes left, then call `GET
  /api/cron/token-refresh` with the local secret. Expect `{ refreshed: 2,
  failed: 0 }`, two Basic-auth POSTs to `/2/oauth2/token` at the listener,
  and both rows active with rotated refresh tokens.
- Held under the DB lock (taken first) and one heavy slot.
- **Only production can show:** that X accepts our real client for a real
  refresh, and whether it rotates — the owner's gate (§25), FILM-1725 Check E.

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Prod verification |
|---|---|---|---|---|---|---|---|
| X stays connected | Background refresh | FR-1 | §15 `refreshXToken` | token-refresh | `/2/oauth2/token` | T1, T6, E1, §27 | Owner's 2h gate |
| …and keeps working next cycle | same | FR-2, FR-3 | persist rule | token-refresh | `refresh_token_encrypted` | T2, T3, E1 | Gate (second cycle) |
| A new platform can't silently die | none | FR-4 | `PLATFORMS`, `never` | platforms, token-refresh | CHECK | T7, `tsc`, guards | CI |
| Scheduled X posts use the same rule | Scheduled publish | FR-5 | `isWithinRefreshWindow` | worker, token-expiry | none | L1–L3 | Worker logs |
| Rotation loss is visible | Persist failure | FR-6 | checked update | token-refresh | none | T9 | Logs |
| One X auth encoding | Connect, refresh | FR-7 | `xClientAuthorization` | twitter config, callback | none | T1 | §27 |
| Operator fault keeps X | Misconfiguration | FR-8 | KB-29 rule | token-refresh | none | T5 | Logs |
| No token left expired between cron runs (all platforms) | Background refresh, scheduled publish | FR-9 | `CRON_REFRESH_WINDOW_MS` shared by select and refresh | refresh-expiring-tokens, token-refresh | none | T10, E1, §27 | Cron log `refreshed` = requests; `token_expires_at` ≥ 30 min ahead after each run |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Chosen because |
|---|---|---|
| Worker behaviour (KB AC 3) | (a) worker refreshes itself; (b) worker asks the web app to refresh via a new secret-protected route; (c) **worker keeps not refreshing but shares the app's expiry rule** | (a) duplicates the refresh, needs the X secret in the worker, and with single-use refresh tokens a second refresher racing the web app's lock-protected one deactivates the connection. (b) adds an endpoint and a network hop for a case the 30-minute cron covers once FR-9 makes it refresh what it selects (every token ≥ 30 min from expiry after each run). (c) makes the two checks agree by construction with no new moving part; revisit (b) if cron lag is ever observed. **(c) depends on FR-9**: without it the cron leaves tokens expired for up to 25 min (R2), and the worker refuses in that gap |
| Cron refresh window (FR-9) | (a) leave for FILM-CC-03; (b) `force: true` for every selected row; (c) **an explicit `refreshWithinMs` equal to the select's window** | (a) leaves the worker disagreeing and scheduled publishes failing in the gap, and FILM-CC-03 already assigns the criterion to KB-15. (b) re-refreshes a row that another process renewed between the select and the call, which for rotating vendors is an extra rotation for nothing. (c) refreshes exactly what is still inside the window when the lock is taken |
| Cron window length | 35 min (cadence + buffer, fewer refreshes); **60 min (the select's existing window, FILM-CC-03's wording)** | 60 min changes one thing, not two, and leaves ≥ 30 min of margin instead of ≥ 5 min. The cost is YouTube refreshing every run (§24) |
| `Platform` source | restate in token-refresh (today); derive from generated DB types (impossible: `varchar` CHECK → `string`); **one const bound to the CHECK by a test** | Only option that is both derived and checked |
| How far to fix the list class | token-refresh only; **all five restatements** (Decision 3) | The other four are type-only aliases equal to today's unions — no behaviour change — and leaving them is how this bug happened |
| Rotation | rely on it (always store); **store when returned, keep otherwise** | Correct under both answers to an undocumented question |
| Worker test seam | export from `index.ts` (module side effects: Supabase client, env throw); **extract to `token.ts`** | Testable without AWS/Supabase env |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| FR-9 raises refresh volume (YouTube every run) | More vendor calls; any per-call limit | Google Cloud console; cron `failed` count | Google limits live tokens, not refresh calls (§24) | Shorten the window to 35 min (§29) |
| X does not accept the refresh shape in production | X still dies at ~2h | Owner's gate; cron `failed` count | Shape is documented and identical to the working callback's code exchange | Adjust with a real credential (FILM-1725 Check E) |
| X rotates and a persist write fails | One forced reconnect | FR-6 log | Log; FILM-CC-03 retry | Reconnect |
| X 429 on refresh deactivates | Spurious reconnect | Log status 429 | none here (all-platform rule) | FILM-CC-03 backoff |
| The worker's 5-min window refuses tokens when cron lags | Delayed scheduled posts | Worker refusal log | SQS retries | Revisit alternative (b) |
| #310 changes before merge | Rebase | Git | Stacked; small diff on its files | Rebase |
| KB-14 (#309) edits `publish-worker/index.ts` (the `ws` cast at `:58`) | Merge conflict | Git | This change edits `:128-200` only and adds a new file | Rebase |
| KB-22 edits the X callback or `connection-actions.ts` | Conflict | Git | This touches the callback's `:109-118` only, and not `connection-actions.ts` or `oauth/twitter/disconnect.ts` | Rebase |
| Existing X rows stay inactive | Owner must reconnect once | §24 | Stated in the PR and runbook | none |

## 31. Open Questions and Assumptions

| # | Question | Why it matters | Current assumption | Needed | Decision |
|---|---|---|---|---|---|
| Q1 | Does X rotate refresh tokens (single-use)? | Whether FR-2 is load-bearing | Yes (widely reported; undocumented) — design correct either way | One live refresh (FILM-1725 Check E / FILM-1729) | Recorded as *inferred* in the capability reference |
| Q2 | X refresh-token lifetime | `refresh_expires_at` metadata | Unknown; nothing reads it | Live | none |
| Q3 | Is the refresh endpoint billed on pay-per-use? | Cost | No (OAuth, not a listed endpoint) | Owner's billing view | Inferred |
| Q4 | Revive inactive X rows automatically? | Saves one reconnect | No | Owner | Decision 5 |

**Decisions for the owner (recommended default first).**
1. **Fix the cron window here (FR-9), for every platform.** The cron would
   refresh what it selects: `refreshWithinMs` equal to its 1-hour select
   window. The reason: R2 found tokens left expired for up to 25 minutes
   between runs, on every platform. The worker refuses scheduled publishes in
   that gap, and FILM-CC-03 assigns this criterion to KB-15. It is outside
   X, but it is what makes AC 3 true. Alternatives: leave it to FILM-CC-03
   (AC 3 then holds only partly), or a 35-minute window (fewer YouTube
   refreshes, less margin).
2. **The worker shares the app's expiry rule and does not refresh** (§29 c),
   with its user-visible text unchanged. Alternative: a secret-protected
   refresh route the worker calls.
3. **Fix the platform-list class in all five places** (type-only aliases of
   one `PLATFORMS`). Alternative: only `token-refresh.ts`, and file the rest.
4. **Check the persist update and log a lost rotated token**; retry left to
   FILM-CC-03. Alternative: leave the persist unchecked (FILM-CC-03).
5. **Existing X connections need one manual reconnect**; no automatic
   reactivation. Alternative: a one-off "retry inactive X rows once" in the
   cron — riskier, and there is one X account.
6. **Record Q1 in `docs/platform-capability-reference.md`** (the X section and
   the documented-vs-inferred ledger), as the KB asks. Alternative: note it in
   the KB entry only.

**What FILM-CC-03 needs from this change.**
- Every platform, X included, now reaches a real refresh; FILM-CC-03's three
  criteria marked `closed_by: KB-15` ("proactively refreshed", "expired tokens
  trigger refresh before API call", "background job refreshes within 1 hour")
  are updated in this PR with evidence (T1, T6, T10, L1–L3, E1). The third
  was false for every platform, not only X (R2). With Decision 1 it is closed
  here; without it, it goes back to FILM-CC-03 with R2 as its evidence.
- It inherits: the X harness case, `fakeDb` support for the cron's select
  (T10: the first test of the cron job, one of FILM-CC-03's open test items),
  `isWithinRefreshWindow` and `CRON_REFRESH_WINDOW_MS` (one expiry rule), and
  the exhaustive `Platform`.
- The cron's `refreshed` counter was counting untouched rows (R2). With FR-9
  it counts real refreshes, apart from a row renewed by another process
  between the select and the call. FILM-CC-03's "All refresh attempts are
  logged" should log per-connection outcomes, not rely on that count.
- Still open for it, now sharper for X:
  1. **Retry/backoff before deactivating** on 429/5xx/network — X's tight
     rate limits make a spurious deactivation likelier.
  2. **Retry the persist write** after a rotating refresh (X, TikTok); KB-15
     only logs it.
  3. **Its open question "per-connection refresh token rotation"** is answered
     in code for X and TikTok (store when returned); the live proof is
     FILM-1725 Check E.
  4. Notification (`sendReauthNotification` stub), success logging, cron/
     concurrency tests, paging the cron read, the duplicate cron route — as
     listed in KB-29 EDD §31, unchanged.
  5. Whether the worker should ever trigger a refresh (§29 b) if cron lag is
     observed.
- The "Test near-expiry token triggers refresh" unit item is met by T6.

**Other instances of the cast class, reported not fixed** (outside
token-refresh; they cast a DB `string` to the complete six-value union, so
they cannot hit a missing case): `jobs/process-scheduled-publishes.ts:363`,
`server/publish-actions.ts:377,439,529,553,868`,
`server/connection-actions.ts:325` (KB-22's file). With `isPlatform` in place
they become one-line parses in a follow-up.

## 32. Implementation Plan

1. **Tests first (red).** Extend the harness (`X_API`, `TWITTER_CLIENT_*`, a
   rotating listener, `.not`/`.lt`/`.order` on `fakeDb`). Write T1–T6,
   T8–T10; `platforms.test.ts` (T7, which
   needs `platforms.ts` — written with the module in step 2); the worker
   test L1–L3 against an extracted-but-unchanged `token.ts`. Run on the base;
   record each failure and reason.
2. **Platforms.** `lib/platforms.ts`, the four type aliases, package export.
3. **Expiry rule.** `lib/token-expiry.ts`, package export; token-refresh uses
   it; `ensureValidToken`'s optional `refreshWithinMs`; the cron job passes
   `CRON_REFRESH_WINDOW_MS` and selects with it (FR-9). T10 green.
4. **Refresh.** `xClientAuthorization`; `refreshXToken`; `PLATFORM_APP.twitter`;
   parse, not cast; `never` default; checked persist; `formatPlatformName`.
   Callback uses the helper. T1–T9 green.
5. **Worker.** `token.ts` uses `isWithinRefreshWindow`; refusal text
   unchanged; minutes-left in the log line. L1–L3 green.
6. **Guards.** `tooling/mutation-guards/kb-15.json`; run them.
7. **Evidence.** DB lock → E1; then heavy slot → §27 on port 3114.
8. **Records.** KB-15 → **Fixed (#PR)**, AC 1–3 ticked with evidence, AC 4
   left deferred; one row in the FILM-CC-04 *Fixed* table. FILM-CC-03's three
   `closed_by: KB-15` criteria and the near-expiry test item → met with
   evidence. FILM-1729 AC "X token refresh exists…" → reason updated to "code
   and unit evidence in KB-15; live half deferred" (stays `met: false`).
   Capability reference: X refresh shape (documented) and rotation (inferred).
   `specs/INDEX.md` rows only if a status changes.
9. `pnpm typecheck`, `pnpm lint:fix`, `pnpm format:fix`; commit; push; PR with
   "Stacked on #310 — retarget to main after #310 merges."

Rollback at any stage is a revert.

## 33. Definition of Done

- [ ] T1–T6, T8–T10, L2 seen red on the base for the stated reason, then green; T7, L1, L3 green
- [ ] Each fix reverted in turn turns its test red; `kb-15.json` guards pass
- [ ] E1: real DB — every row (both X, both YouTube) refreshed with one request each, X with Basic auth and rotated token stored, all active; `refreshed` equals requests
- [ ] §27: production build's cron route refreshes the expired and the 50-minute X connections against the local listener; pre-flight proved no override ignored
- [ ] No `as Platform` in `token-refresh.ts`; `never` default; `pnpm typecheck` clean (lambdas included once KB-14 lands)
- [ ] `pnpm lint:fix`, `pnpm format:fix`
- [ ] KB-15, FILM-CC-03, FILM-1729 records and the capability reference updated; the one-reconnect step and the owner's 2h gate in the PR body

## 34. Final Consistency Pass

**Forward.** X connections die about two hours after connecting, and the
cron leaves every platform's tokens expired for up to 25 minutes between
runs → the user needs
them to stay connected → the user does nothing and expects **Active** and
working publishes → the system must refresh X with the app's credentials and
keep the rotated refresh token → data: the same `platform_connections` columns
→ architecture: one more case behind KB-29's resolver, one platform list, one
expiry rule, a cron that refreshes what it selects → implementation §15 →
tests T1–T10, L1–L3 red→green, E1, §27 →
deploy code-only, one reconnect → the owner's two-hour check in production.

**Reverse.** In production the cron route will refresh every connection
with under an hour left, POSTing each X connection's refresh token to `api.x.com/2/oauth2/token` with Basic auth from
`TWITTER_CLIENT_*`, store the new access token, expiry and any new refresh
token, and leave the row active; the worker will use those tokens under the
same 5-minute rule. The user sees an X card that stays **Active** and
scheduled posts that are not refused for an expired token — the §2 flow and
the §1 outcome.

The two converge. The one unverifiable link — X's real response to a real
refresh — is named (Q1), handled either way (FR-2/FR-3), and assigned to the
owner's gate and FILM-1725 Check E.
