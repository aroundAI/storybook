---
spec_id: FILM-1723
title: API Version Consolidation
status: DRAFT
effort: M
dependencies: none
---

# API Version Consolidation

## 1. Four Meta Graph versions, and the oldest is on the critical path

| Pin | Where |
|---|---|
| **v18.0** | `publishing/src/lib/token-refresh.ts:432,475` — **the OAuth refresh** |
| v18.0 | `oauth/meta/config.ts`, `providers/facebook/types.ts`, `providers/instagram/instagram-provider.ts` |
| v19.0 | `apps/web/lambda/publish-worker/handlers/{facebook,instagram}.ts` |
| v23.0 | `content-analytics/src/providers/instagram/instagram-insights.ts` |

Current is **v26.0** (released 2026-07-29).

`ensureValidToken` — which calls `graph.facebook.com/v18.0/oauth/access_token`
— is imported by the token-refresh cron, connection actions, scheduled
publishes, **the analytics sync cron**, the YouTube backfill and subscriber
snapshots. A dead Graph version there breaks publishing *and* analytics at
once.

## 2. v18.0 is very likely already dead

Meta deprecates a Graph version roughly two years after release. v18.0 shipped
in **September 2023**, putting its end-of-life around **September 2025 — a year
ago**.

If that holds, Meta token refresh has been failing silently for some time and
every Instagram and Facebook connection has been expiring without renewal. That
would be a **second, independent explanation** for why no Meta analytics data
exists, alongside the missing scopes in FILM-1711 — and the two would mask each
other, since both produce the same symptom of no data.

**This is not proven.** Meta sometimes serves retired versions past their
nominal date, and there is no Meta connection in the local fixture to test
against. It is one HTTP call to settle, and it must be the **first** action of
this spec: if true, it is a live production incident and not spec work.

## 3. X is on legacy hosts and a retired endpoint

`providers/twitter/twitter-provider.ts:12-13`:

```
const TWITTER_API_V2   = 'https://api.twitter.com/2';
const TWITTER_UPLOAD_API = 'https://upload.twitter.com/1.1/media/upload.json';
```

and `oauth/twitter/config.ts` uses `api.twitter.com` for token, revoke and
userinfo.

The current host is **`api.x.com`**, and **v1.1 media upload was retired** in
favour of `/2/media/upload`. So the publishing path may already be broken for
the same class of reason as Meta's.

## 4. What consolidation means

**One pinned version per vendor, declared once.**

- A single `META_GRAPH_VERSION` constant, imported everywhere. Not four
  literals in four files.
- The same for the X host and API version.
- A test that fails when a version literal appears anywhere but the constant —
  the same shape as FILM-1703's writer-binding test, and for the same reason:
  the guarantee has to be mechanical or it decays.

**Pin deliberately, and record why.** A pinned version is a decision with an
expiry date, so the constant carries a doc-comment naming the version, its
release date and its expected end-of-life. Meta's two-year cadence makes that
computable; upgrading becomes a scheduled task rather than an outage.

## 5. Upgrading is not only a version bump

Moving from v18 to v26 crosses several breaking changes already documented in
FILM-1721 — `plays`, `impressions`, `clips_replays_count` and
`ig_reels_aggregated_all_plays_count` were all removed for **all versions** on
2025-04-21, and `views` replaced them.

So the upgrade and the metric work in FILM-1712 touch the same code and should
be sequenced together rather than colliding.

The Instagram analytics provider is already on v23.0 and already uses `views`,
so it is closest to correct. The *publishing* providers are the stale ones.

## 6. Out of scope

- Adding any scope or permission — FILM-1711.
- Adding any metric — FILM-1712.
- The TikTok Business API, which is a new integration rather than a version
  bump — FILM-1712.

## 7. Acceptance criteria

- [ ] Whether Graph v18.0 still responds is established **first**, and recorded
- [ ] If it does not, the token-refresh failure is treated as an incident, not as part of this spec's normal flow
- [ ] Exactly one Meta Graph version constant exists, with a doc-comment naming its release date and expected end-of-life
- [ ] Exactly one X host/version constant exists
- [ ] A version literal outside those constants fails a test
- [ ] X uses `api.x.com` and `/2/media/upload`
- [ ] The Meta upgrade accounts for the 2025-04-21 metric removals rather than only changing the number
- [ ] Token refresh is verified against a live Meta connection after the change, not only typechecked
- [ ] The next expected deprecation date is recorded somewhere a person will see it

## 8. Verification

```bash
pnpm --filter @kit/publishing test
pnpm --filter @kit/content-analytics test
pnpm turbo typecheck --force && pnpm lint
```

Unit tests cannot prove a remote API version still exists, so the decisive
checks are live:

1. One call to `graph.facebook.com/v18.0/...` — does it respond, or return a
   deprecation error?
2. One token refresh against a real Meta connection after the bump.
3. One X media upload against `/2/media/upload`.

A green suite here proves the constant is used consistently. It does not prove
the version works, and the acceptance criteria say so.

## 9. Risk

**The token refresh path is the highest-risk code in this spec.** Getting it
wrong takes publishing down along with analytics, and it is exercised by six
callers. It deserves to be changed on its own, verified against a live
connection, and not bundled with the metric work even though they touch
adjacent files.

**The v18 question may turn this into an incident mid-spec.** That is the right
outcome — better to find it here than to discover it when a creator asks why
their Instagram stopped publishing — but it means this spec should not be
scheduled as routine work without someone available to act on the answer.
