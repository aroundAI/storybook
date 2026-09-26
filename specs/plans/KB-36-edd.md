# KB-36 — TikTok credentials saved at /admin/platforms are ignored

**Engineering Design Document** · ticket `specs/known-bugs/KB-36.md` · related:
KB-29/#310 (the credential resolver) · branch `fix/kb-36-tiktok-saved-credentials` ·
author: teammate `platform-admin`, 2026-09-25 · size: **S**

**Status: APPROVED (2026-09-25), implemented as below.** Q2 (the saved key
wins over env) was assumed yes by the lead and put to the owner. No schema,
RLS or grant change. This is the KB-36 part of the combined Phase 1 plan for
KB-36, KB-37 and KB-59; KB-37 and KB-59 are planned separately.

Implementation notes beyond the plan: the source status has four values, not
three. `unreadable` ("Saved, but cannot be read. Save it again") is shown for a
row that exists but cannot be decrypted, because "Saved here" would be false
for it. `tooling/mutation-guards/kb-29.json`'s two find texts in the resolver
moved with the code (same mutations, new text).

# Part 1 — KB-36: TikTok credentials saved at /admin/platforms are ignored

## 1. Start with the user

**Who.** The super admin (the owner) configures the product's OAuth apps at
`/admin/platforms`. Creators then connect their TikTok accounts from a
project's publishing settings, and the platform refreshes their tokens in the
background.

**Problem.** `/admin/platforms` shows a TikTok card: "Configure OAuth
credentials for YouTube, TikTok, and Meta integrations. These settings apply
globally to all users." Saving it shows "TikTok credentials saved!" and the
card shows the saved client key. **Nothing reads it.** TikTok connect, the
callback, token refresh and revoke all read `TIKTOK_CLIENT_KEY` /
`TIKTOK_CLIENT_SECRET` from the environment. So:
- With env unset, the admin sees "saved", but connect answers
  `500 TikTok OAuth not configured`, and refresh returns `APP_NOT_CONFIGURED`.
- With env set, the admin's saved key is silently not the one in use. Rotating
  the key on the page does nothing.

**After the fix.**
- A TikTok key saved at `/admin/platforms` is the one connect, callback,
  refresh and revoke use.
- A deployment that only sets env keeps working unchanged (env is the
  fallback).
- Each card on `/admin/platforms` says which source is in effect: **Saved
  here**, **From environment variables** (TikTok only), or **Not configured**.
  A saved value can never again be shown as saved while something else is in
  use.

**Persists.** The saved row (`oauth_app_credentials`, secret encrypted), as
today. **Does not persist.** Nothing new.

## 2–3. Journey and happy path

| # | User action | System | User sees |
|---|---|---|---|
| 1 | Super admin opens `/admin/platforms` (aal2 session) | `getGlobalOAuthApps()` reads rows; new: `getOAuthAppSourceStatus()` says, per app, `saved` / `env` / `none` without reading any secret | Three cards. The TikTok card reads "From environment variables" if env is set and no row exists |
| 2 | Enters TikTok client key and secret, Save | `saveGlobalOAuthAppAction` upserts (RLS: super admin); unchanged | Toast "TikTok credentials saved!"; badge becomes **Saved here** |
| 3 | A creator clicks Connect TikTok | `connect/tiktok` → `getOAuthAppCredentials('tiktok')` → **the saved row** | Redirect to TikTok with `client_key=<saved key>` |
| 4 | TikTok redirects back | `callback/tiktok` exchanges the code with the saved key and secret | Connected |
| 5 | Token nears expiry (cron, or `ensureValidToken`) | `refreshTokenForPlatform` → the same resolver → saved key | Connection stays active |

## 4. Alternate paths

| Trigger | Behaviour | User-visible | Final state |
|---|---|---|---|
| No row, env set | Resolver falls back to env (today's behaviour) | Badge "From environment variables"; connect works | unchanged |
| No row, no env | `null` → connect 500 / refresh `APP_NOT_CONFIGURED`, connection left active (KB-29) | Badge **Not configured** | Saving a row heals it with no reconnect |
| Row saved, secret cannot be decrypted (key rotated) | Resolver logs and returns `null`. **It does not fall back to env**: a broken saved row is an operator error to surface, not to hide behind a different app | Badge **Saved here** plus the logged error; connect refuses | Re-save fixes it |
| Row read fails (DB error) | `null`, logged (as today for YouTube/Meta). No env fallback, for the same reason | connect refuses | transient |
| Admin deletes the TikTok row | Next resolution uses env if set | Badge flips to "From environment variables" | — |
| Row key ≠ env key, existing connections minted with env key | Refresh sends the row key; TikTok answers `invalid_client`/`invalid_grant` → `REFRESH_FAILED`, connection deactivated (existing KB-29 behaviour) | Creator must reconnect once | This is the Q2 cost; §25 has the pre-deploy check |
| Non-admin calls the save action | RLS `is_super_admin()` rejects the upsert (unchanged) | Error toast | unchanged |

## 5. User-facing contract

- `/admin/platforms` cards: add one status line per card with
  `data-test="oauth-app-source-<app>"`, text exactly one of `Saved here`,
  `From environment variables`, `Not configured`. The page's description stays
  true.
- API routes: unchanged status codes and bodies.
- `refreshTokenForPlatform`: unchanged result shape. `APP_NOT_CONFIGURED`'s
  message names both sources for TikTok (`oauth_app_credentials['tiktok'] or
  TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET`), never a value.

## 6. Functional requirements

| ID | Requirement | Verification |
|---|---|---|
| FR36-1 | A saved TikTok row is used by connect, callback, refresh and revoke | Unit (red today: `APP_NOT_CONFIGURED`, 0 vendor requests); E2E connect redirect carries the saved key |
| FR36-2 | With no row, TikTok uses env exactly as today | Unit (green before and after, as a compatibility pin) |
| FR36-3 | Row and env both present → row wins | Unit (red today: vendor gets `env-tiktok-client-key`) |
| FR36-4 | A saved row that cannot be decrypted or read does **not** fall back to env | Unit |
| FR36-5 | Every app the admin page and the save action accept is an app whose resolver reads the saved row (the class fix) | Type-level (one constant drives the UI list, the zod enum and the resolver) plus a unit test that iterates the constant |
| FR36-6 | The admin page shows the effective source per app, and never a secret | E2E with a screenshot (seed row → "Saved here"; delete → "From environment variables" / "Not configured") |

## 7. Non-functional

One extra `select` per resolution for TikTok (already the case for
YouTube/Meta). No secrets reach the client: the status function returns only
the enum. No production values are read.

## 8. Existing system

### 8.1 KB-36, reproduced (2026-09-25, on origin/main `ddc5568a`)

A throwaway copy of `token-refresh.test.ts`'s harness (real resolver, real
`ensureValidToken`, fake DB answering per table, a local vendor listener), not
committed:

| Case | Result |
|---|---|
| TikTok row in `oauth_app_credentials` (as the admin page writes it), env keys empty | `ensureValidToken` → `{"valid":false,"error":"APP_NOT_CONFIGURED"}`, **0 vendor requests**, `getOAuthAppCredentials('tiktok')` → `null`, connection left active |
| Row **and** env keys set | Vendor received `client_key = env-tiktok-client-key`, not the saved `admin-tiktok-key` |

Connect (`connect/tiktok/route.ts:80`) and callback (`callback/tiktok/route.ts:108`)
call the same `getOAuthAppCredentials('tiktok')`, so they fail the same way.

### 8.2 What KB-29 (#310) already did, and what that changes in the ticket

The lead's brief asks to "make connect and refresh read the same source for
every platform". **That is already true on main.** #310 put every reader
(connect ×5, callback ×5, refresh, TikTok and X revoke) behind one resolver,
`packages/features/publishing/src/server/oauth-app-credentials.ts`, with a
`SOURCES` map: `youtube`, `meta` → table; `tiktok`, `linkedin`, `twitter` →
env. KB-29's EDD recorded the TikTok row as "saved and ignored" (Decision 3)
and left it for this ticket. **What is left is not connect vs refresh; it is
the admin page vs the resolver.** Two lists disagree:

| List | Where | Apps |
|---|---|---|
| Admin page cards | `components/global-oauth-app-config.tsx:41,51` | youtube, tiktok, meta |
| Save/delete action enum | `server/global-oauth-actions.ts:15,23,62` | youtube, tiktok, meta |
| DB CHECK | `20260121114721_global_oauth_app_credentials.sql:7` | youtube, tiktok, meta |
| Resolver reads the table for | `oauth-app-credentials.ts:30` | youtube, meta |

LinkedIn and X are env-only and absent from the page, so nothing is shown
that is not used. They are not changed (see §29).

## 9–10. System behaviour and architecture

One resolver, one rule for every app, stated once:

> **An app's credentials are its saved `/admin/platforms` row if the app can
> be saved there, otherwise (or if no row exists) its env pair if it has one.
> A saved row that exists but cannot be read or decrypted is "not configured".**

| App | Saved row? | Env fallback | Change |
|---|---|---|---|
| youtube | yes | none | none |
| meta | yes | none | none |
| tiktok | **yes** | `TIKTOK_CLIENT_KEY`/`SECRET` | **new: row first** |
| linkedin | no | env | none |
| twitter | no | env | none |

```
/admin/platforms ──save──▶ oauth_app_credentials ◀──┐
      │ status (saved|env|none, no secrets)          │ row first
      ▼                                              │
getOAuthAppSourceStatus ─────── getOAuthAppCredentials(app) ── env fallback (tiktok, linkedin, twitter)
                                      ▲   ▲   ▲   ▲
                         connect/* callback/* refresh  revoke
```

## 13–14. Data model / database

No schema change. The CHECK already allows `tiktok`. No backfill.

## 15. Low-level design (KB-36)

1. `src/oauth/apps.ts` (pure, client-safe): add
   `export const SAVED_CREDENTIAL_APPS = ['youtube', 'tiktok', 'meta'] as const`
   and its type. It mirrors the DB CHECK; a comment says so.
2. `oauth-app-credentials.ts`: replace the `kind: 'table' | 'env'` union with
   `{ saved: boolean; env?: { clientId; clientSecret } }` derived from
   `SAVED_CREDENTIAL_APPS` and the env map. `getOAuthAppCredentials`: if
   `saved`, read the row. Row found → decrypt, or `null` + log on failure
   (FR36-4). Read error → `null` + log. No row → fall through to env, if any.
   `describeCredentialSource` names both for TikTok.
   Keep the existing `find` strings of `tooling/mutation-guards/kb-29.json`
   intact, or update that file in the same PR (it references
   `  youtube: { kind: 'table' },` and the env `return` line).
3. New `getOAuthAppSourceStatus(): Promise<Record<SavedCredentialApp,
   'saved' | 'env' | 'none'>>`, server-only, in the same module. It selects
   `platform` only (never the secret) and checks env **presence** only.
4. `global-oauth-actions.ts`: the zod enums use `z.enum(SAVED_CREDENTIAL_APPS)`.
   `GlobalOAuthApp['platform']` uses the type.
5. `global-oauth-app-config.tsx`: `PlatformOAuthConfig.id` typed by the
   constant; `PLATFORMS` typed `Record<SavedCredentialApp, …>` so a missing
   or extra app fails typecheck. New `sourceStatus` prop; one status line per
   card.
6. `apps/web/app/admin/platforms/page.tsx`: fetch the status beside
   `getGlobalOAuthApps()` and pass it.

## 18. Failure handling

As §4. The resolver never throws for configuration; refresh keeps the KB-29
contract (`APP_NOT_CONFIGURED`, connection left active).

## 19. Security

- **What the fix newly allows:** a super admin's saved TikTok key is used.
  Before, only whoever set the deployment env chose it. Both are the owner
  today. The save path is RLS-guarded by `is_super_admin()` (aal2), unchanged.
- The status function exposes only `saved|env|none` to an admin page already
  behind `AdminGuard`.
- `getOAuthAppCredentials` stays out of any `'use server'` module
  (`use-server-audit.ts:72` already pins that).

## 23. Configuration

| Config | Before | After |
|---|---|---|
| `oauth_app_credentials['tiktok']` | ignored | **used, first** |
| `TIKTOK_CLIENT_KEY`/`SECRET` | used | used when no row |

## 24–25. Compatibility and rollout

- Env-only deployments: no change.
- **The owner runs one query in production before deploy** (we read no
  production values): `select platform, client_id, updated_at from
  oauth_app_credentials where platform = 'tiktok';`
  - no row → nothing changes on deploy;
  - a row whose `client_id` equals the deployed `TIKTOK_CLIENT_KEY` → nothing
    changes;
  - a row with a different key → either delete it at `/admin/platforms`
    before deploying (keeps today's behaviour) or accept one reconnect per
    TikTok connection.
- Rollback: revert (code only).

## 26. Tests (KB-36)

| ID | Layer | Case | Red on main? |
|---|---|---|---|
| T36-1 | unit (`token-refresh.test.ts`) | TikTok row, no env → refresh sends the saved key | **yes** (seen: `APP_NOT_CONFIGURED`, 0 requests) |
| T36-2 | unit | Row and env → saved key wins | **yes** (seen: env key sent) |
| T36-3 | unit | No row, env → env key (compat) | no, pin |
| T36-4 | unit | Undecryptable TikTok row with env set → `APP_NOT_CONFIGURED`, 0 requests, env not used | yes |
| T36-5 | unit | For each app in `SAVED_CREDENTIAL_APPS`, a row alone configures it (the class guard) | yes, for tiktok |
| T36-6 | E2E, admin `storageState` (`apps/e2e/tests/admin/`) | Save TikTok creds on `/admin/platforms` → badge "Saved here"; as a seeded team user `GET /api/platforms/connect/tiktok?…` (`maxRedirects: 0`) → `Location` has `client_key=<saved>`; delete → badge changes. Evidence spec for screenshots behind `CAPTURE_EVIDENCE=1` | yes |
| M36-* | mutation guards `tooling/mutation-guards/kb-36-37.json` | (a) TikTok removed from the saved list in the resolver → T36-1/T36-5 red; (b) env tried before the row → T36-2 red; (c) fall back to env on a decrypt failure → T36-4 red | — |

Local only: generated keys, the vendor sandbox, my own server on port 3140.

---
