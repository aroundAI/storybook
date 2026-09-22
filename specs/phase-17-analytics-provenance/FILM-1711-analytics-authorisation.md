---
spec_id: FILM-1711
title: Analytics Authorisation
status: 🟡 PARTIAL
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
every row.

> **Corrected 2026-09-22, during implementation.** Every callback *did* write the
> column — since 2025-12-07 — but three of the five wrote **the scopes we asked
> for**, not the scopes that were granted (`[...YOUTUBE_OAUTH_CONFIG.scopes]`, the
> same for Meta, and a hard-coded pair for Instagram), and TikTok and X fell back
> to the requested list when the vendor sent none. That is worse than empty: the
> moment this spec added the analytics scopes to the configs, every new row would
> have *claimed* them. The callbacks now record the grant — Google's and TikTok's
> `scope`, Meta's `/me/permissions` — and nothing when the vendor says nothing.
> Existing rows are still usable for detection, because none of them can name a
> scope that was never requested. Writing the granted scopes at OAuth callback makes a missing scope
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

- [x] Every platform's analytics scope requirement is declared in code, beside the config that requests it, not only in documentation — `publishing/src/oauth/analytics-scopes.ts`
- [x] A test fails if a provider calls an endpoint whose scope the OAuth config does not request — `content-analytics/__tests__/analytics-scope-binding.test.ts`. Seen red on the unchanged configs for all four gaps, and it found a fifth this spec had not: `follower_count` needs `user.info.stats`
- [x] TikTok requests `video.list`; no spec or config references a `video.query` scope, which does not exist
- [x] Instagram requests the correct permission pair **for the login path in use** — Facebook Login, so the triple: `instagram_basic` + `instagram_manage_insights` + `pages_read_engagement`
- [ ] Meta App Review **and** Business Verification are both submitted, and both statuses are tracked where a reader can find them — **tracked** in `docs/vendor-review-status.md`, bound to the `review` field in code by a test; **not submitted**. Submitting needs a person with access to the Meta developer console
- [x] `platform_connections.scopes` is written at OAuth callback, so a gap is detectable before a sync fails — it was already written, with the wrong thing; see the correction in §4
- [x] `account_type_gated` is distinguishable from `scope_missing`, because the creator resolves one and we resolve the other
- [x] Graph v18.0's liveness is checked before this spec concludes scopes were the cause — probed 2026-09-21T20:28Z: `/v18.0/oauth/access_token` and `/v23.0/oauth/access_token` return the same `OAuthException` code 101, `/v99.0/` returns code 1. v18.0 is still routed, so token refresh is not being rejected for its version. That rules out a hard failure, not a semantic difference; FILM-1723 still owns the pin
- [x] An existing connection missing a scope is detectable without waiting for a sync to fail — `resolveAnalyticsAccess`, read by the Platform Connections page and by the sync job
- [ ] `not_authorised` is distinguishable from `no_data_in_window` everywhere both can appear — `AnalyticsAccess.summary` carries `not_authorised` and the Platform Connections page renders it. **`no_data_in_window` does not exist in code yet**: it arrives with FILM-1704's coverage query and FILM-1705's strip, which is where the two first share a surface. Open until then
- [x] The reconnect prompt names what that specific platform's analytics will add
- [x] An unauthorised connection is not retried indefinitely by the sync cron — it is not tried at all, and takes no slot in the batch. The inverse is fixed too: a publish flagged `requires_reauth` used to stay skipped forever *after* the creator reconnected
- [x] The audit covers all five platforms, including the two with no provider yet
- [x] `yt-analytics-monetary.readonly` is requested, and existing YouTube connections are prompted to re-consent. The only permitted non-collection is a creator outside the Partner Program, recorded as `account_type_gated` — the recording is built and tested; **what YouTube actually returns to a non-partner channel is a hypothesis** (a non-quota 403), FILM-1725 Check G
- [x] Monetary metrics are fetched in a call separate from `fetchTotals`' non-monetary ones, so a monetary 403 degrades revenue only and never the totals
- [ ] After the scope is granted, a real Partner Program channel's `revenue_records` holds non-zero `source = 'api'` rows — the end-to-end proof that the pipeline FILM-1726 describes actually delivers — **deferred: FILM-1725 Check G**. Needs a monetised channel's token
- [ ] Whether YouTube rejects a mixed monetary/non-monetary query is established by a real call, not assumed — **deferred: FILM-1725 Check G**. The query is split either way, so the answer no longer changes what we ship; it changes what we believe about the last nine months of totals
- [x] YPP membership is modelled as `account_type_gated`, distinguishable from a missing scope

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

## 10. What shipped, and what is still open (2026-09-22)

**Scopes added to the OAuth configs:** YouTube `yt-analytics-monetary.readonly`;
TikTok `video.list` and `user.info.stats`; Meta `instagram_manage_insights`.
**Removed:** none. **Deliberately not added:** Facebook `read_insights` — a
permission no code uses has nothing to show a reviewer or a creator, so it is declared as
planned in FILM-1720 and requested when that provider lands; and X `media.write`,
a publishing scope, owned by FILM-1729.

**`PARTIAL`, not `DONE`, for three reasons:**

1. Meta App Review, Business Verification and TikTok app review are **not
   submitted**. They need a person with each vendor's console. Until they pass,
   `review: 'required'` keeps the reconnect prompt off for TikTok and Instagram —
   a creator cannot grant a scope the vendor has not approved, and asking them to
   is a loop.
2. **Nothing here has touched a live vendor.** §7's verification — real TikTok
   and Instagram accounts returning data — is FILM-1725 Check H; the YouTube
   revenue questions are Check G.
3. **Whether requesting an unapproved scope breaks the consent screen is
   unknown** (Check F). If TikTok rejects the authorise request outright, this
   change breaks *connecting TikTok at all* until review passes. It must be
   settled on staging before production — `docs/vendor-review-status.md`.

**Decision, 2026-09-22 (owner).** The PR merges as it is, with no per-platform
switch. Before it is deployed, the owner checks each vendor console and tries one
staging connect per platform; if an authorise request naming an unapproved scope is
rejected outright on a platform, the deploy waits for that platform's review. The
human actions in (1)–(3) above are the owner's: they are the product's first user,
and will submit the reviews themselves.
[docs/vendor-review-runbook.md](../../docs/vendor-review-runbook.md) is the runbook
for both — the pre-deploy check (which is how Check F gets run) and a submission
checklist per vendor. Writing it turned up four things the owner needs before
submitting:

- Meta's Standard Access already lets the owner, who has a role on the app, grant
  `instagram_manage_insights` for their own accounts. App Review gates *other*
  users, not the first one.
- **The app has no data-deletion endpoint or instructions page**, which Meta
  requires of any app that accesses user data. A blocker for the Meta submission.
- **The privacy policy lacks the three items YouTube's developer policies require**
  (YouTube ToS link, Google Privacy Policy link, the Google security-settings
  revocation sentence). A blocker for Google verification.
- A failed authorise redirects to `/settings/platforms?error=…`, a route that does
  not exist, so it lands on a 404 and logs nothing. Older than this spec and not
  fixed by it; unowned.

**What an existing connection experiences.** Nothing changes until its owner
opens Settings → Platforms. There, a YouTube connection shows what reconnecting
would add (revenue) and a button; TikTok and Instagram connections say their
analytics are waiting on the vendor, with no button. Publishing is untouched:
old tokens keep their old scopes and keep working. The sync job stops calling
TikTok and Instagram for connections it knows lack the scope.
