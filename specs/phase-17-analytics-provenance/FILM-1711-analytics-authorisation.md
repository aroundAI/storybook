---
spec_id: FILM-1711
title: Analytics Authorisation
status: DRAFT
effort: L
dependencies: FILM-1721
---

# Analytics Authorisation

## 1. Two of three platforms have never been authorised

The reason `video_metrics` holds YouTube rows and nothing else is not the sync
schedule, not the fixture, and not an API limitation. **TikTok and Instagram
analytics cannot authenticate.**

| Platform | Scopes requested | Analytics scope |
|---|---|---|
| YouTube (`oauth/youtube/config.ts:10`) | `youtube.upload`, `youtube.readonly`, `youtube.force-ssl`, `yt-analytics.readonly` | **present** — but see the monetary scope below |
| TikTok (`oauth/tiktok/config.ts:11`) | `user.info.basic`, `video.upload` | **absent** |
| Instagram (`oauth/meta/config.ts:10`) | `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management` | **absent** |

`tiktok-analytics.ts:121` calls `/video/query/`, which requires **`video.list`**.
**There is no `video.query` scope** — the first draft of this spec invented it.
`video.upload`, which we do request, is a *write* scope for drafts and grants
nothing on the read side. `instagram-insights.ts` calls the media
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
| YouTube (revenue) | **`yt-analytics-monetary.readonly`** | **missing** |
| TikTok (basic) | `video.list` | **missing** |
| TikTok (deep) | Business API app **+ creator on a Business account** | not implemented |
| Instagram | `instagram_manage_insights` | **missing** |
| Facebook | `read_insights` (plus a provider — FILM-1720) | missing |
| X | `tweet.read` + `users.read` | **held** — already requested for publishing (`oauth/twitter/config.ts:13-15`). The blocker is the missing provider, FILM-1727, not authorisation |

### The monetary scope — added 2026-09-21

`fetchTotals` (`youtube-analytics.ts:151-165`) requests `estimatedRevenue`,
`estimatedAdRevenue` and `estimatedRedPartnerRevenue` **in the same query** as
the non-monetary metrics, on a token that does not carry
`yt-analytics-monetary.readonly`. The reference is explicit that
`yt-analytics.readonly` covers "user activity metrics" while the monetary scope
covers those "**and** estimated revenue and ad performance metrics".

This is the first live instance of this spec's own criterion — *"a test fails if
a provider calls an endpoint whose scope the OAuth config does not request"*.
It was written as a guard against future drift; it is already violated.

**One thing to establish before designing the fix**, because it changes how much
is broken: does YouTube reject the *whole* query for want of the scope, or
return the non-monetary metrics and omit the rest? If the former, `fetchTotals`
has been failing outright on every sync while `fetchDailyMetrics` — which
requests no revenue — keeps working, which would explain YouTube daily rows
sitting beside zero revenue. **This is a hypothesis.** One authorised call
settles it, and this spec is the one that will hold a token.

Two further consequences:

- **Splitting the query** is the safer shape regardless of the answer, so a
  monetary failure degrades revenue rather than all totals.
- **YPP membership is an access state, not an absence.** Since 2026-09-09 the
  monetary metrics are documented as YouTube Partner Program members only. That
  is the same creator-resolved shape as TikTok's Business-account gate —
  `account_type_gated` in FILM-1703 — and the audit should return it as such
  rather than as "no revenue".

Facebook and X are recorded here and built in FILM-1720 and FILM-1727; their rows exist so
that the audit is complete rather than silently three-platform.

## 3. The three costs, which are not the same

**A scope addition is a consent change.** Existing tokens do not gain scopes
retroactively — every connected account must go through OAuth again. That needs
a user-facing migration, not a deploy.

**Meta needs App Review *and* Business Verification — both, not either** —
plus an annual Data Use Checkup to keep it. And there are two permission
vocabularies depending on the login path:

| Path | Permissions for media insights |
|---|---|
| Instagram Login (`graph.instagram.com`) | `instagram_business_basic` + `instagram_business_manage_insights` |
| Facebook Login (`graph.facebook.com`) | `instagram_basic` + `instagram_manage_insights` + `pages_read_engagement` |

On the Facebook Login path, a Page role granted via Business Manager also needs
`ads_management` + `ads_read` — a documented and common silent-403.

**Meta publishes no timeline for either review.** Any number is inferred;
budget generously and treat each rejection as restarting the clock.

**Standard vs Advanced Access is the decisive distinction.** Standard covers
professional accounts we own and have added to the app — no review. Advanced is
required the moment we serve a creator we do not own, which is the entire
product. So Advanced is not optional.

**TikTok app review is mandatory for production on every scope**, including
`video.list`. New apps default to sandbox, and unaudited apps have posted
content forced to private regardless of the user's choice.

**And TikTok has a gate neither we nor the platform controls.** The deep
metrics — completion rate, watch time, impression sources — live on the
separate TikTok API for Business and require the **creator to be on a Business
account**. A creator on a personal account cannot grant them at all. That is
why FILM-1703's access axis has `account_type_gated`: it is the creator's
decision, not ours, and the UI must say so rather than showing an empty chart.

## 4. Degrading honestly while unauthorised

This spec's second job is making the failure legible. Today an unauthorised
connection produces a thrown `*ScopeError` in a cron job and an empty tab.

**The detection machinery is half-built and should be finished here.**
`platform_connections.scopes TEXT[]` exists and is *read*
(`connection-actions.ts:77,321`) — and **nothing writes it**, so it is empty on
every row. Writing the granted scopes at OAuth callback makes a missing scope
detectable immediately, instead of only after a sync fails. Separately, the
provider `*ScopeError`s *are* already caught and mapped
(`analytics-sync-cron.ts:443-470`) to `last_sync_status: 'scope_error'` and
`requires_reauth` — but onto **publish** metadata jsonb, not the connection,
and nothing surfaces it.

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
- Facebook and X providers and their enum values — FILM-1720 (Facebook) and FILM-1727 (X).
- Any signal, stage or benchmark.

## 6. Acceptance criteria

- [ ] Every platform's analytics scope requirement is declared in code, beside the config that requests it, not only in documentation
- [ ] A test fails if a provider calls an endpoint whose scope the OAuth config does not request
- [ ] TikTok requests `video.list`; no spec or config references a `video.query` scope, which does not exist
- [ ] Instagram requests the correct permission pair **for the login path in use**
- [ ] Meta App Review **and** Business Verification are both submitted, and both statuses are tracked where a reader can find them
- [ ] `platform_connections.scopes` is written at OAuth callback, so a gap is detectable before a sync fails
- [ ] `account_type_gated` is distinguishable from `scope_missing`, because the creator resolves one and we resolve the other
- [ ] Graph v18.0's liveness is checked before this spec concludes scopes were the cause
- [ ] An existing connection missing a scope is detectable without waiting for a sync to fail
- [ ] `not_authorised` is distinguishable from `no_data_in_window` everywhere both can appear
- [ ] The reconnect prompt names what that specific platform's analytics will add
- [ ] An unauthorised connection is not retried indefinitely by the sync cron
- [ ] The audit covers all five platforms, including the two with no provider yet
- [ ] `yt-analytics-monetary.readonly` is requested, and existing YouTube connections are prompted to re-consent. The only permitted non-collection is a creator outside the Partner Program, recorded as `account_type_gated`
- [ ] Monetary metrics are fetched in a call separate from `fetchTotals`' non-monetary ones, so a monetary 403 degrades revenue only and never the totals
- [ ] After the scope is granted, a real Partner Program channel's `revenue_records` holds non-zero `source = 'api'` rows — the end-to-end proof that the pipeline FILM-1726 describes actually delivers
- [ ] Whether YouTube rejects a mixed monetary/non-monetary query is established by a real call, not assumed
- [ ] YPP membership is modelled as `account_type_gated`, distinguishable from a missing scope

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

## 8. A second cause that would mask this one

`ensureValidToken` calls `graph.facebook.com/**v18.0**/oauth/access_token`
(`publishing/src/lib/token-refresh.ts:432`). Meta deprecates a Graph version
about two years after release; v18.0 shipped in September 2023. If it is past
end-of-life, **Meta token refresh has been failing independently of the missing
scopes** — and both produce the same symptom of no data, so each would hide the
other.

FILM-1723 owns the fix. This spec must not conclude "scopes were the problem"
without ruling it out first.

## 9. Risk

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
