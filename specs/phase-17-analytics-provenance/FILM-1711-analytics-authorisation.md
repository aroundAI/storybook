---
spec_id: FILM-1711
title: Analytics Authorisation
status: DRAFT
effort: L
dependencies: none
---

# Analytics Authorisation

## 1. Two of three platforms have never been authorised

The reason `video_metrics` holds YouTube rows and nothing else is not the sync
schedule, not the fixture, and not an API limitation. **TikTok and Instagram
analytics cannot authenticate.**

| Platform | Scopes requested | Analytics scope |
|---|---|---|
| YouTube (`oauth/youtube/config.ts:10`) | `youtube.upload`, `youtube.readonly`, `youtube.force-ssl`, `yt-analytics.readonly` | **present** |
| TikTok (`oauth/tiktok/config.ts:11`) | `user.info.basic`, `video.upload` | **absent** |
| Instagram (`oauth/meta/config.ts:10`) | `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management` | **absent** |

`tiktok-analytics.ts:121` calls `/video/query/`, which requires `video.query`
(and `video.list` to enumerate). `instagram-insights.ts` calls the media
insights edge, which requires `instagram_manage_insights`.

The package's own documentation already says so —
`content-analytics/CLAUDE.md:113-116` lists TikTok's required scopes and `:209`
states Instagram needs `instagram_basic` **and** `instagram_manage_insights`.
Both providers ship a dedicated error for this failure
(`TikTokAnalyticsScopeError` at `tiktok-analytics.ts:21`,
`InstagramInsightsScopeError` at `instagram-insights.ts:22`), documented as
"user must reconnect".

So the code anticipates the exact error the OAuth config guarantees, and the
docs describe scopes the config does not request.

## 2. Audit all five, not only the two that are broken

The point of this spec is not to patch two configs. It is to make "which scopes
does each platform's analytics need, and do we hold them" a checked fact rather
than a comment.

| Platform | Needs | Status |
|---|---|---|
| YouTube | `yt-analytics.readonly` | held |
| TikTok | `video.list`, `video.query` | **missing** |
| Instagram | `instagram_manage_insights` | **missing** |
| Facebook | `read_insights` (plus a provider — FILM-1720) | missing |
| X | TBD (plus a provider — FILM-1720) | missing |

Facebook and X are recorded here and built in FILM-1720; their rows exist so
that the audit is complete rather than silently three-platform.

## 3. The three costs, which are not the same

**A scope addition is a consent change.** Existing tokens do not gain scopes
retroactively — every connected account must go through OAuth again. That needs
a user-facing migration, not a deploy.

**`instagram_manage_insights` needs Meta App Review.** An external dependency
measured in weeks, with a submission that must demonstrate the use case. Start
it first; it is the long pole of this spec and probably of the phase.

**TikTok's `video.list` / `video.query` may need its own approval** depending on
the app's tier. Verify against the live app rather than assuming, because the
whole estimate for FILM-1712 rests on it.

## 4. Degrading honestly while unauthorised

This spec's second job is making the failure legible. Today an unauthorised
connection produces a thrown `*ScopeError` in a cron job and an empty tab.

- A connection missing its analytics scope is **a distinct state** from one
  that is connected and simply has no data yet. It surfaces as
  `not_authorised`, and it feeds FILM-1703's capability model and FILM-1704's
  coverage strip — both of which already have somewhere to put it.
- The reconnect prompt names what will be gained, per platform, rather than
  saying "reconnect for analytics".
- The sync job must not retry an unauthorised connection on a schedule
  forever. It is a permanent failure until the user acts, and treating it as
  transient is how a log fills with noise nobody reads.

## 5. Out of scope

- Requesting the additional *fields* those scopes unlock — FILM-1712. This spec
  gets permission; that one uses it.
- Facebook and X providers and the ClickHouse enum — FILM-1720.
- Any signal, stage or benchmark.

## 6. Acceptance criteria

- [ ] Every platform's analytics scope requirement is declared in code, beside the config that requests it, not only in documentation
- [ ] A test fails if a provider calls an endpoint whose scope the OAuth config does not request
- [ ] TikTok requests `video.list` and `video.query`
- [ ] Instagram requests `instagram_manage_insights`
- [ ] Meta App Review is submitted, and its status is tracked somewhere a reader can find
- [ ] An existing connection missing a scope is detectable without waiting for a sync to fail
- [ ] `not_authorised` is distinguishable from `no_data_in_window` everywhere both can appear
- [ ] The reconnect prompt names what that specific platform's analytics will add
- [ ] An unauthorised connection is not retried indefinitely by the sync cron
- [ ] The audit covers all five platforms, including the two with no provider yet

## 7. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm turbo typecheck --force && pnpm lint
```

The load-bearing test is the scope/endpoint binding in §6 — it is what stops
this recurring, and it should be seen failing before it passes: add a call to
an endpoint whose scope is not requested, and the suite must catch it.

Everything else needs a live connection. Verify against a real TikTok and a
real Instagram account that `getVideoAnalytics` and `getMediaInsights` return
data rather than a `*ScopeError`, and record the date — because until that
happens, no claim about those platforms' numbers is verified.

## 8. Risk

**Reconnection is a user-visible migration with drop-off.** Some users will not
reconnect, and their analytics will stay empty. That is a product problem, not
only an engineering one, and the coverage strip is what keeps it honest rather
than mysterious.

**App Review can be rejected.** The plan assumes `instagram_manage_insights` is
grantable for this use case; if it is not, Instagram's signal map loses most of
its stages and that has to be recorded as a limit rather than worked around.

**The estimate for FILM-1712 depends on this spec's findings.** If TikTok's
analytics scopes turn out to need a higher app tier, "add four fields to a URL"
becomes a much longer piece of work. Verify before committing to that estimate.
