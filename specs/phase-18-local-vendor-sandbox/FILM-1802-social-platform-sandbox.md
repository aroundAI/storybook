---
spec_id: FILM-1802
title: Social Platform Sandbox
status: DRAFT
effort: XL
dependencies: FILM-1801, FILM-1721
---

# Social Platform Sandbox

## 1. Overview

A local stand-in for YouTube, TikTok, Meta (Facebook and Instagram), X and
LinkedIn that the app talks to exactly as it talks to the real vendors: OAuth
consent and token exchange, refresh and revoke, publishing, and analytics. It
holds state, returns randomized data, and that data grows while it runs, so the
app's own sync jobs visibly pick up change without anyone seeding a row.

It exists so that the flows seeding cannot reach — connect, publish, sync — can be
driven end to end on a laptop, and so that they are driven against the vendor as
documented, not as our code assumes. #278 (Instagram `media_type` is never
`REELS`) and #279 (TikTok's success envelope carries `error`) both passed unit
tests that mocked our assumptions. Both fail on the first sync against this
sandbox.

## 2. Process and ports

One Node process, `apps/vendor-sandbox`, listening on several ports so each vendor
is a distinct origin, as it is in production:

| Port | Serves | Resolver names (FILM-1801) |
|---|---|---|
| 4100 | Control API and ledger (§6); a small status page | — |
| 4101 | Meta: Graph API (all version paths), Facebook Login dialog, token exchange | `meta-graph`, `meta-oauth` |
| 4102 | TikTok: Display API, OAuth authorize and token | `tiktok`, `tiktok-oauth` |
| 4103 | Google: OAuth authorize, token and revoke; YouTube Data v3, Analytics v2, Reporting v1 (including report downloads) | `google-oauth`, `google-token`, `google-apis` |
| 4104 | X: API v2, media upload, OAuth 2.0 PKCE | `x-api`, `x-upload`, `x-oauth` |
| 4105 | LinkedIn: API v2, OAuth, userinfo | `linkedin-api`, `linkedin-oauth` |

**Lifecycle.** `./scripts/local-env.sh up` starts it beside Supabase and ClickHouse,
the way it already starts the ClickHouse container, and `status` / `down` include
it. `deployment/config/local.env` gains `VENDOR_SANDBOX=1` and one
`VENDOR_URL_*` line per resolver name. As with ClickHouse today, the app only uses
the sandbox when started with that file in its environment; a plain `pnpm dev`
still behaves like production.

`deployment/config` is a git submodule (`aroundAI/storybook-deployment-config`,
private), so the `local.env` lines land as a PR in that repository plus a
submodule bump here, not as part of this one. CI does not check the submodule out:
anything CI needs from these settings goes in the workflow's own `env:`, not in
`local.env`.

**OAuth app credentials** for local use are seeded, not entered: the sandbox
accepts one fixed client id and secret per platform, and the local seed writes
them where the app reads them — the `oauth_app_credentials` table for YouTube and
Meta, `TIKTOK_CLIENT_*` / `TWITTER_CLIENT_*` / `LINKEDIN_CLIENT_*` for the rest,
and `account_oauth_apps` for refresh. `ENCRYPTION_KEY` is added to `local.env`,
because tokens are stored encrypted.

## 3. Fidelity

The rule: **the sandbox may only serve a field that
`docs/platform-capability-reference.md`'s field index documents for that
endpoint.** A test parses the index — as `platform-field-names.test.ts` does, never
restating it — and fails if any response template names an undocumented field or
serves a documented field on the wrong endpoint.

Documented behaviour the sandbox must reproduce, each with a sandbox test:

| Vendor | Behaviour |
|---|---|
| TikTok | Every response carries `error`; success is `error.code: "ok"`. Max 20 IDs per `/v2/video/query/`. Data stops updating 365 days after publish. No retention curve, no saves, no watch time on the Display API |
| Instagram | `media_type` is `CAROUSEL_ALBUM`, `IMAGE` or `VIDEO` only; the surface is `media_product_type`. `profile_visits` and `follows` absent for Reels. Missing data is an empty data set, not `0`. Account `views` is `total_value`-only; time-series `profile_views` and `website_clicks` are rejected. Removed metrics (`plays`, `impressions`, …) return the vendor's error |
| Facebook | Four denominators kept distinct; `post_video_avg_time_watched` may exceed duration; Page tokens for insights |
| YouTube | Analytics metrics valid with `dimensions=day`; 48–72 hour processing delay; revenue metrics require `yt-analytics-monetary.readonly`; Reporting jobs only backfill 30 days from job creation; `creatorContentType` distinguishes Shorts |
| X | Non-public metrics only for posts under 30 days old, gated on creation date; the two quartile vocabularies on their own endpoints; Enterprise-only endpoints return the tier error |
| All | Expired Graph versions are served as the next oldest live version, as Meta documents, and the response says which version answered |

**Scopes are enforced.** A token carries the scopes its connection was granted, and
an endpoint that needs a missing scope returns the vendor's authorisation error. A
TikTok connection without `video.list` therefore fails analytics locally exactly as
it does in production today (phase 17's FILM-1711). The sandbox does not paper over
gaps; it reproduces them.

## 4. Randomized objects that grow

**Truly random per run.** On start the sandbox draws a seed, logs it, and derives
everything from it; `SANDBOX_SEED=<n>` replays a run. Nothing is fixed across runs.

**Objects.** A channel/account, and each video or post published through the
sandbox, is created with a randomly drawn **performance profile**:

- an archetype — breakout, steady, slow-burn, flop, or decaying — which fixes the
  shape of the growth curve;
- a scale drawn from a long-tailed distribution, so most objects are small and a
  few are large, as on real platforms;
- per-metric ratios (like rate, share rate, completion, CTR) drawn around
  platform-plausible centres, so the metrics of one object are consistent with each
  other.

Objects that already exist in the local database — the seeded publishes — are
adopted on first request and given a profile the same way.

**Everything on screen looks real** (the phase README's "Looks real, is
fictional"). Channel names, handles, video titles, captions, comments and follower
names come from the shared corpus — never `Test channel`, `Seeded video 3` or a
counter suffix. Figures are long-tailed, non-round and consistent with each other.
Randomness picks *which* realistic name and number, not whether it looks real.

**Time.** The app server's clock is real and cannot be accelerated: its date
windows, 30-day walls and `snapshot_date` all use real dates. So
`SANDBOX_SPEED` (simulated seconds per real second; default `1440`, one simulated
day per real minute) accelerates each object's growth, not the calendar:

- cumulative totals at real time *t* are `curve(speed × (t − published))`;
- daily series are reported on real dates, each day holding the increase within
  it, so dailies always sum to totals and never go negative;
- vendor delays are expressed in simulated time and so shrink with speed;
- `SANDBOX_SPEED=0` freezes everything.

**The visible cost**, stated rather than hidden: an object an hour old at the
default speed has sixty simulated days of growth, all in today's daily row. This
is fit for exercising sync, snapshots, deltas and dashboards. It is not a
realistic shape for a single calendar day, and anything that shows it to a person
must present it as an example, never as a benchmark.

## 5. Publishing and state

Publishing endpoints accept the upload, return the vendor's ID and status
sequence (processing → published, with the vendor's real status vocabulary), and
create the object that analytics then reports on. Disconnect revokes the token;
later calls with it fail as they would in production.

State is in memory and clears on restart — "temporary", as asked. For a long
exploratory session, `SANDBOX_PERSIST=1` snapshots state to
`.sandbox/state.json` (gitignored) and restores it on start.

## 6. Control API and ledger (port 4100)

- `GET /__sandbox/state` — every account, token, object and profile.
- `GET /__sandbox/ledger` — every request the app made and exactly what was served,
  newest first, filterable by vendor and object. **This is what tests assert
  against**: with random data, "the page shows 4,512 views" cannot be written in
  advance, but "the page shows what the ledger says was served" can.
- `POST /__sandbox/reset` — empty state, new seed.
- `POST /__sandbox/fail` — make the next *n* calls to an endpoint fail with a
  named vendor error (rate limit, expired token, 5xx), for error-path tests.

The ledger endpoint is local-only; the process binds to `127.0.0.1`.

## 7. Background jobs

The app's sync jobs only run locally when started explicitly. With
`ENABLE_LOCAL_CRON=true` (`apps/web/instrumentation.ts:24`) the jobs cron
(`packages/features/jobs/src/cron/scheduler.ts`) runs analytics sync hourly and
token refresh every 30 minutes. For visible incremental feedback in a session, the
sandbox's status page also offers "sync now", which calls the app's own cron routes
with `CRON_SECRET` — the same path production takes, not a shortcut.

## 8. Out of scope

- AI generation vendors — FILM-1803.
- Whether the real vendor accepts a request — a real call, FILM-1725.
- TikTok's Business API and X Enterprise — no app, so no client to exercise;
  the sandbox serves their tier errors only.
- Webhooks from vendors — none are consumed today.

## 9. Acceptance criteria

- [ ] `local-env.sh up` starts the sandbox, and `local.env` points every social vendor at it
- [ ] A user can connect each of the five platforms through the real connect and callback routes, with no real credentials
- [ ] Token refresh and disconnect work through the real code paths
- [ ] Publishing through the app creates a sandbox object, and the next analytics sync reports on it
- [ ] Every response field is documented in the capability reference for that endpoint — enforced by a test that parses the index
- [ ] Every behaviour in §3's table has a sandbox test
- [ ] A missing scope returns the vendor's authorisation error, not data
- [ ] Two runs produce different data; the same `SANDBOX_SEED` reproduces a run
- [ ] Cumulative totals never decrease, and daily series sum to totals, at any `SANDBOX_SPEED`
- [ ] The ledger records every request and response
- [ ] The sandbox binds to loopback and is never part of a production build or deploy
- [ ] No generated name matches a placeholder pattern (`test`, `seed`, `example`, `sample`, `dummy`, `lorem`, `foo`, or a trailing counter) — enforced by a test over a large sample of runs
- [ ] No generated figure is a round sentinel, and each object's figures are mutually consistent

## 10. Verification

- Sandbox unit tests: fidelity against the field index, each §3 behaviour, the
  growth invariants under several speeds.
- Against the running app: connect → publish → sync → dashboard for each platform,
  with the ClickHouse rows read back and compared with the ledger — the harness
  shape used in the review of #277.
- `main` before #278 and #279 must fail those flows for Instagram and TikTok; with
  them, pass. A sandbox that cannot catch known defects is not faithful enough.

## 11. Risk

**Fidelity drift.** A sandbox trusted and wrong is worse than none — it certifies
code against a vendor that does not exist. The index-driven fidelity test and the
"must catch #278 and #279" check are the mitigation; re-verifying the capability
reference (its own review cadence) keeps the sandbox honest with it.

**Scope creep toward a vendor emulator.** The sandbox implements the endpoints the
app calls and nothing else. An endpoint is added when a call site is, not before.
