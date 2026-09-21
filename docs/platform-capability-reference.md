# Platform Capability Reference

> **FILM-1721 Deliverable**: the researched, vendor-cited truth table for what each
> publishing platform can and cannot report. Everything Phase 17 builds on top of
> traces back to a row here.

**The rule this document establishes:** a metric name may not appear in a spec, a
TypeScript type, or an API request unless it appears in the [Field index](#field-index)
below. Our own type declarations are **not** evidence of a platform's capability —
`TikTokVideoData` once declared five fields that do not exist on the endpoint it was
used with, and the errors made a second API integration look like a one-line change
to a URL.

The rule is enforced, not merely stated:
`packages/features/content-analytics/__tests__/platform-field-names.test.ts` parses
the field index out of this file and fails the build when a request asks for a name
that is not here, or when a retired name reappears in code.

Anything not directly documented by the vendor is marked *inferred* and listed in
the [ledger](#documented-vs-inferred-ledger). Anything nobody can answer is in
[open questions](#open-questions) with the person who owns asking.

---

## Per-platform summary

| Platform | Analytics surface | Auth state today | Commercial | Data window |
|---|---|---|---|---|
| YouTube | Analytics API + Reporting API | authorised | included | reporting: 30d from **job creation**, unrecoverable |
| TikTok (basic) | Display API `/v2/video/query/` | **scope missing** (`video.list`) | included | unbounded backwards |
| TikTok (deep) | **Business API** `/business/video/list/` | not implemented; separate app | included | stops updating 365d after publish |
| Instagram | Graph `/{ig-media-id}/insights` | **permission missing** | included | media ~2y; account ~90d |
| Facebook | Graph `/{video-id}/video_insights` | **permission missing** | included | 2 years |
| X (degraded) | `media.non_public_metrics` via posts lookup | scope ordinary; not implemented | metered | **30d from post creation** |
| X (full) | `/2/media/analytics` | scope ordinary | **tier gated — Enterprise** | **undocumented** |

_Verified: 2026-09-14_

---

## YouTube

Analytics API metric names, all confirmed against
[Google's metrics reference](https://developers.google.com/youtube/analytics/metrics)
and valid on `dimensions=day` + `filters=video==ID`.

- `averageViewPercentage` **is** valid on the daily per-video query. The two YouTube
  calls can collapse into one. The only documented incompatibility is the
  `liveOrOnDemand` dimension.
- `annotationClickThroughRate` is documented but **effectively dead** — annotations
  were retired — so it must not be requested.
- **`adImpressions` is not thumbnail impressions.** It is ad inventory, and it was
  "previously named `impressions`". A grep for "impressions" finds this trap first.
- **`estimatedRevenue`, `estimatedAdRevenue` and `estimatedRedPartnerRevenue`
  require the monetary scope** (`yt-analytics-monetary.readonly`). Google groups
  them under "Revenue Metrics (special access required)".

  Confirmed 2026-09-21 on the
  [reports.query reference](https://developers.google.com/youtube/analytics/reference/reports/query):
  `yt-analytics.readonly` "provides access to user activity metrics", while
  `yt-analytics-monetary.readonly` "provides access to user activity metrics
  **and to estimated revenue and ad performance metrics**". Since 2026-09-09 the
  docs also state monetary metrics are supported for **YouTube Partner Program
  members only**.

  ⚠️ `YOUTUBE_OAUTH_CONFIG` (`packages/features/publishing/src/oauth/youtube/config.ts:11-14`)
  requests `youtube.upload`, `youtube.readonly`, `youtube.force-ssl` and
  `yt-analytics.readonly` — **not** the monetary scope, while
  `YouTubeAnalyticsProvider.fetchTotals` asks for all three revenue metrics in the
  same query as the non-monetary ones. FILM-1711 owns the scope audit; recorded here
  because it is the kind of claim this document exists to stop being guessed at.

Reporting API (bulk) — the only source of thumbnail impressions and CTR:

- `channel_basic_a3`, `channel_reach_combined_a1` / `channel_reach_basic_a1`
- Columns: `video_thumbnail_impressions`, `video_thumbnail_impressions_ctr`,
  `engaged_views`
- **Reach reports with thumbnail impressions launched 2026-01-15.**
- **Backfill is 30 days from job creation**, permanently. Create jobs at channel
  onboarding, not at first sync.
- Generated reports are downloadable for 60 days; **historical backfill reports only
  30 days** from generation.
- Reports cover 12:00–23:59 **PST**. 48–72h processing delay.

Retention: `dimensions=elapsedVideoTimeRatio` (0.01–1.0, 100 points),
`filters=video==ID` required, metrics `audienceWatchRatio`,
`relativeRetentionPerformance`, `startedWatching`, `stoppedWatching`.
**YouTube is the only platform here with a real retention curve API.**

Shorts vs long-form: the `creatorContentType` dimension. Confirmed 2026-09-21:
values are `SHORTS`, `VIDEO_ON_DEMAND`, `LIVE_STREAM`, `STORY`, `UNSPECIFIED`,
with data from 2019-01-01.

**`views` was redefined again on 2026-08-27** — it now counts from "the moment a
video begins to play", including autoplay, while `engagedViews` carries the
older "past the first frame" methodology. The 2025-03-31 change (announced
2025-03-26) had already redefined Shorts views as "a Short starts to play or
replay". Anything comparing
view counts across that boundary is comparing two different measures; the same
argument FILM-1722 makes per platform applies to YouTube against its own past.

**`ageGroup` expanded on 2026-03-09** to include viewers YouTube estimates to be
under 18. Our audience buckets predate that and should be checked against it.

**The city report was removed for content owners on 2026-06-25.** We query
`ids=channel==MINE`, not a content owner, so `fetchCityGeography` is unaffected —
recorded so nobody re-derives it.

Not available at all: "viewed vs swiped away", Shorts feed impressions, and
new-vs-returning viewers (Studio-only). **`audienceType` is a trap** — it looks like
new-vs-returning and is organic-vs-paid, filter-only. The closest real segmentation
is `subscribedStatus`, which is a different concept and must not be relabelled.

Quota: Analytics API cost is evaluated per query with no published number — read the
project's own Cloud Console. **The Reporting API has no meaningful quota** ("data is
retrieved once"). For nightly multi-channel sync, Reporting is the spine and
Analytics the gap-filler.

_Verified: 2026-09-21_

---

## TikTok

### Display API `/v2/video/query/` — the shallow one

The complete documented `fields` list is in the
[field index](#field-index). **`duration` is there** — the published asset's
duration, which FILM-1710 needs.

Scope: **`video.list`**. There is **no `video.query` scope**. Maximum 20 video IDs
per request. Rate limit 600 req/min per endpoint. The pagination cursor is a UTC
Unix timestamp **in milliseconds**, a documented bug source.

### Business API `/business/video/list/` — the real one

Host `business-api.tiktok.com/open_api/v1.3/`. **Separate developer portal, separate
app registration**, and the creator must be on a **TikTok Business account**. We do
not have this app, so no name from this surface may appear in a request today.

Documented constraints:

- `video_views` **mixes organic and paid** and cannot be separated.
- `reach`, `full_video_watched_rate`, `total_time_watched`, `average_time_watched`,
  `impression_sources` and `audience_countries` return **empty if the video has been
  inactive for more than 7 days**.
- **Post data stops updating 365 days after publish.**
- General rule: if TikTok Studio does not show it, the API will not return it.

### The Research API is not available to us

**`research.creator_insights` is not a real scope.** The documented research scopes
are `research.adlib.basic`, `research.data.basic`, `research.data.u18eu` and
`research.data.vra`, and eligibility is "independent and academic researchers who
conduct research on a non-for-profit basis" — **not available to commercial apps**,
and with no demographics endpoints at all.

### Hard ceilings

**No retention curve, no replay count, no 2s/6s holds**, no per-video follows or
profile views, on any API. `full_video_watched_rate` is one scalar.

App review is mandatory for production on every scope including `video.list`; new
apps default to sandbox.

**Not re-verified 2026-09-21.** `developers.tiktok.com` refused connections from
this network, so this section still rests on the 2026-09-14 research. One data
point did come through a search index and is consistent with it: the **Research
API's** Query Videos now returns `favorites_count` — Research API, not Display,
exactly as recorded above. Treat this section as the oldest in the document and
re-verify it first; FILM-1725's Check B is the live test.

_Verified: 2026-09-14_

---

## Instagram

Organised by **`media_product_type`** (`FEED` / `REELS` / `STORY`), **not** by
`media_type`. Since the 2022 unification, standalone feed videos are Reels.

| Metric | Field | FEED | REELS | STORY |
|---|---|---|---|---|
| reach | `reach` | yes | yes | yes |
| views | `views` | yes | yes | yes |
| total watch time | `ig_reels_video_view_total_time` | — | yes | — |
| average watch time | `ig_reels_avg_watch_time` | — | yes | — |
| saves | `saved` | yes | yes | — |
| shares | `shares` | yes | yes | yes |
| comments / likes | `comments`, `likes` | yes | yes | — |
| skip rate | `reels_skip_rate` | — | yes | — |
| **profile visits** | `profile_visits` | yes | **NO** | yes |
| **follows** | `follows` | yes | **NO** | yes |

**`profile_visits` and `follows` are not available for REELS** — which is what
creators publish. Instagram's Audience stage therefore has no per-media signal, and
a `follows` value read for a Reel is a structural zero, not a measurement.

Also absent: **no replay metric** (`clips_replays_count` removed 2025-04-21, no
replacement), **no retention graph**, **no completion rate**, and **no per-media
follower/non-follower split** — that breakdown is account-level only, so our
`video_audience.follower_status` rows for Instagram are account-level data
attributed per media.

`reels_skip_rate` — "percentage of views from people who skipped during the first 3
seconds" — is the entire retention surface.

**Deprecated and enforced across all versions on 2025-04-21:** `plays`,
`impressions`, `clips_replays_count`, `ig_reels_aggregated_all_plays_count`. Use
`views`. This applies to account-level insights too, not only media.

**Units on `ig_reels_avg_watch_time` and `ig_reels_video_view_total_time` are
undocumented.** Community consensus is milliseconds. *Inferred* — validate
empirically before shipping; misreading ms as seconds is a known failure mode.

Permissions:

| Path | Host | Permissions |
|---|---|---|
| Instagram Login | `graph.instagram.com` | `instagram_business_basic` + `instagram_business_manage_insights` |
| Facebook Login | `graph.facebook.com` | `instagram_basic` + `instagram_manage_insights` + `pages_read_engagement` |

On the Facebook Login path, a Page role granted **via Business Manager** also needs
`ads_management` + `ads_read` — a common silent 403.

Other documented behaviour: missing data returns an **empty data set, not 0**; Story
metric values under 5 return error code `10`; data may be delayed up to 48 hours;
**albums/carousels have no insights at all**.

Retention: media insights ~**2 years**; account-level ~**90 days**. (Meta's own two
pages disagree; this is the best reading and is partly inferred.) Stories are 24
hours with no backfill.

**Rate limit: `4800 × impressions` per 24h, per app-and-user pair.** The quota scales
with the creator's reach, so a new or dormant creator has a near-zero budget and the
long tail throttles first. **There is no documented way to raise it.**

_Verified: 2026-09-21_

---

## Facebook

`GET /{video-id}/video_insights` — Pages only, not groups or user profiles. Data is
retained 2 years. Requires a Page token from someone with the **`ANALYZE`** task;
Meta's own two doc pages disagree on whether the permission is
`pages_manage_engagement` + `read_insights` or `pages_read_engagement`. Request all
three.

Video metrics: `total_video_views` (≥3s), `total_video_views_unique`,
`total_video_15s_views`, `total_video_avg_time_watched` (**ms**),
`total_video_view_total_time` (**ms**), `total_video_retention_graph` (**40 equal
intervals**), `total_video_impressions_unique`, `total_video_complete_views` (≥97%).

Reels metrics: `blue_reels_play_count` (≥1ms, **excludes replays**),
`fb_reels_replay_count`, `fb_reels_total_plays` (includes replays),
`post_impressions_unique` (reach, **estimated**), `post_video_avg_time_watched`,
`post_video_view_time`, `post_video_retention_graph`, `post_video_followers`
(follows attributed to the reel).

### The inventory above is a floor, not the surface

Re-checked 2026-09-21 against the
[video_insights reference](https://developers.facebook.com/docs/graph-api/reference/video/video_insights/):
the edge exposes **57 video metrics, 11 Reels metrics and 4 ad-break metrics**,
not the ~16 first recorded here. What the short list omits changes how big
FILM-1720's Facebook half is, and in which direction:

- **Organic/paid splits on most view metrics**, which no other platform here
  gives us. TikTok explicitly *cannot* separate them.
- **`total_video_views_autoplayed` vs `total_video_views_clicked_to_play`** — an
  intent distinction that maps onto the Hook stage better than anything YouTube
  offers.
- **`total_video_views_sound_on`**, and time thresholds at 10s/15s/30s/60s.
- **`total_video_view_time_by_age_bucket_and_gender`** — demographics *weighted
  by watch time*, not by view count.
- **`total_video_ad_break_earnings`, `total_video_ad_break_ad_cpm`,
  `total_video_ad_break_ad_impressions`, `creator_monetization_qualified_views`**
  — Facebook has a **revenue** surface. FILM-1714's "no Monetisation stage"
  decision was made on the basis that `video_metrics.revenue_cents` is literal
  zero on all four write paths, which is true of our *writers*; it is not
  evidence that the platforms have nothing. Revisit that decision against this
  row, and against YouTube's monetary scope, before treating it as settled.
  Note "only Page admins can query earnings insights by using the API".

**Still open: `post_video_retention_graph`'s segment count.** A first pass here
recorded it as resolved at 40 intervals. That was wrong, and it is worth saying
why, because it is the exact failure this document exists to prevent: the 40
belongs to `total_video_retention_graph` — *"Videos are divided into 40 equal
intervals"* — and was carried across to the Reels metric by assumption.
`post_video_retention_graph`'s own text is *"the percentage of times your reel
was played at various timestamp segments out of the total number of plays"*, and
names **no count**. It stays in open questions.

The required permission is `pages_manage_engagement` + `read_insights` with the
**ANALYZE** task — the reference now states both, so the earlier "Meta's two doc
pages disagree" hedge is narrower than it was.

### The four denominators

These must never be conflated, and none maps onto a YouTube view:

1. **Impression** — entered the screen, no playback required, **estimated**.
2. **Play** — ≥1 millisecond, replays excluded.
3. **3-second view** — ≥3s **or** nearly full length if shorter than 3s.
4. **ThruPlay** — **an Ads metric.** Not on `video_insights` at all.
   `total_video_15s_views` is **not** equivalent: ThruPlay is "completed or ≥15s,
   whichever comes first", so a short video that completes under 15s counts for
   ThruPlay and not for the organic metric. **Do not label it ThruPlay.**

### The most important non-equivalence found

**`post_video_avg_time_watched` can exceed the video's own duration.** Replay time is
in the numerator (documented); the denominator is initial plays, which exclude
replays (per Meta's Business Help Center — the API reference does not state the
denominator, so this half is *inferred*). YouTube's average view duration cannot do
this.

Safest approach: compute our own average explicitly and label which denominator was
used, rather than shipping Meta's precomputed figure as comparable.

Not available: **follower vs non-follower reach for video or Reels.** Only the
page-level `page_media_view` carries `is_from_followers`.

Rate limits: Page tokens use BUC `4800 × engaged users` per 24h; app/user tokens use
`200 × users` per hour. The Page throttle error code is **80001**.

_Verified: 2026-09-21_

---

## Graph API versions

Measured 2026-09-21 against
[Meta's changelog](https://developers.facebook.com/docs/graph-api/changelog/):

| Version | Released | Expires | Status today (2026-09-21) |
|---|---|---|---|
| v18.0 | 2023-09-12 | **2026-01-26** | **expired ~8 months ago** |
| v19.0 | 2024-01-23 | **2026-05-21** | **expired ~4 months ago** |
| v20.0 | 2024-05-21 | 2026-09-24 | **expires in 3 days** |
| v23.0 | 2025-05-29 | 2027-10-08 | current |
| v26.0 | 2026-07-29 | TBD | latest |

**An expired version does not fail. It is silently upgraded.** Meta's
[versioning guide](https://developers.facebook.com/docs/graph-api/guides/versioning)
states it verbatim: *"For APIs, once a version is no longer usable, any calls made to
it will be defaulted to the next oldest, usable version."* A version is usable for
"at least two years from release".

This was confirmed empirically — an unauthenticated probe of `/{version}/me` returns
the ordinary `OAuthException` code 2500 for `v18.0`, `v19.0` and `v23.0` alike, while
an unrecognised `v99.0` returns `Unknown path components: /me`. So routing success
proves the version string is *recognised*, and proves nothing about which version's
semantics were served.

⚠️ **This is worse than a hard failure, and it is live in our code.** Three versions
are pinned at once, two of them expired:

| Version | Where |
|---|---|
| `v18.0` (expired) | `packages/features/publishing/src/providers/facebook/types.ts:90-91`, `providers/instagram/instagram-provider.ts:10`, and **`lib/token-refresh.ts:432,475`** |
| `v19.0` (expired) | `apps/web/lambda/publish-worker/handlers/{facebook,instagram}.ts` |
| `v23.0` (current) | `packages/features/content-analytics/src/providers/instagram/instagram-insights.ts:15` |

Token refresh running on a silently-substituted version is the specific risk
FILM-1723 was written for. That spec listed "Graph v18.0 is past end-of-life" as
*inferred*; it is now documented with a date, and the case is stronger than the spec
assumed, because the failure mode is substitution rather than rejection.

_Verified: 2026-09-21_

---

## X

### Enterprise — `GET /2/media/analytics`

`video_views`, `playback_start`, `playback25`, `playback50`, `playback75`,
`playback_complete`, `watch_time_ms`, `cta_url_clicks`, `cta_watch_clicks`,
`play_from_tap`, `timestamped_metrics`. Up to 100 media keys,
`hourly|daily|total`, with `start_time` and `end_time` both required.

`GET /2/tweets/analytics` adds `bookmarks`, `user_profile_clicks`, `url_clicks`,
`shares`, `quote_tweets`, `impressions`, and — uniquely among these five platforms —
**`follows` and `unfollows` attributed to a post**.

**Both are Enterprise-only.** Evidence: an explicit comparison table on X's
Enterprise introduction lists engagement metrics as Enterprise-only; neither endpoint
appears as a billable line item on the pay-per-use schedule; and `/2/media/analytics`
is absent from the published rate-limit table.

*Documented inconsistency worth knowing:* both endpoints live in the standard
`docs.x.com/x-api/` namespace and their own reference pages state no tier
requirement. **One call with a pay-per-use token settles it** — see
[open questions](#open-questions).

**Enterprise pricing is unpublished.** The widely-cited ~$42k/month figure is
third-party, not X. X closed Free/Basic/Pro to new signups on **2026-02-06**; only
pay-per-use credits and Enterprise remain.

### Pay-per-use — the degraded path

`media.non_public_metrics` via the ordinary posts lookup: `playback_0_count`,
`playback_25_count`, `playback_50_count`, `playback_75_count`, `playback_100_count`,
`view_count`.

**The two quartile vocabularies are different** — `playback25` (analytics) versus
`playback_25_count` (non-public metrics). Do not mix them. Both are listed
separately in the field index for exactly this reason.

No watch time, no CTA clicks, no time series.

### The 30-day wall

Documented verbatim: *"Non-public, organic, and promoted metrics are only available
for posts created within the last 30 days."* The gate is on the post's **creation
date**, not the requested range — an older post returns nothing regardless of window.

**The historical window on `/2/media/analytics` is undocumented.** It is not on the
endpoint reference, the media introduction, or the metrics page. The legacy
enterprise Engagement API allowed 365 days with 4-week spans, which is a prior and
not a fact. **This is the single most important open question in the phase**, because
it decides whether X can be benchmarked past 30 days.

Scopes: `tweet.read` for media analytics, `users.read` + `tweet.read` for post
analytics. **There is no `media.read` scope.** **User context is required** — there is
no app-only path, so only authorised accounts, never competitors'.

_Verified: 2026-09-14_

---

## Field index

The machine-readable half of this document. Each block is one platform and one API
surface. A name may be requested by our code only if it appears in a block for that
platform. Comments after `#` are ignored by the parser.

A name being listed here means the **vendor** documents it. It does **not** mean we
are authorised to request it, or that the surface is implemented — see the
per-platform sections above for that.

**Every block carries a `source:` URL, and the guard fails without one.** That is
a weak check on purpose: it cannot tell whether a name is real, only whether
someone had a reference page open when they added it. It exists because a name
once got in here from an announcement blog post, and nothing noticed — the
coverage rule only checks names we *request*, so an unrequested wrong name sits
in the index indefinitely, waiting to be trusted.

<!-- fields: youtube/analytics-api-metrics source: https://developers.google.com/youtube/analytics/metrics -->
```text
views
engagedViews
likes
dislikes
comments
shares
estimatedMinutesWatched
averageViewDuration
averageViewPercentage      # valid on dimensions=day + filters=video==ID
subscribersGained
subscribersLost
viewerPercentage           # percentage of viewers logged in; used with ageGroup/gender
cardClickRate
adImpressions              # ad inventory, NOT thumbnail impressions
estimatedRevenue           # requires yt-analytics-monetary.readonly
estimatedAdRevenue         # requires yt-analytics-monetary.readonly
estimatedRedPartnerRevenue # requires yt-analytics-monetary.readonly
audienceWatchRatio         # retention only, with elapsedVideoTimeRatio
relativeRetentionPerformance
startedWatching
stoppedWatching
```

<!-- fields: youtube/analytics-api-dimensions source: https://developers.google.com/youtube/analytics/dimensions -->
```text
day
elapsedVideoTimeRatio      # 0.01-1.0, 100 points; filters=video==ID required
ageGroup
gender
insightTrafficSourceType
country
city
deviceType
operatingSystem
subscribedStatus           # NOT new-vs-returning; do not relabel
creatorContentType         # shorts / video-on-demand / livestream / stories
liveOrOnDemand             # incompatible with averageViewPercentage
```

<!-- fields: youtube/reporting-api source: https://developers.google.com/youtube/reporting/v1/reports/channel_reports -->
```text
channel_basic_a3
channel_combined_a3
channel_traffic_source_a3
channel_reach_combined_a1
channel_reach_basic_a1
video_thumbnail_impressions
video_thumbnail_impressions_ctr
engaged_views
```

<!-- fields: tiktok/display-api source: https://developers.tiktok.com/doc/display-api-specification-v2 -->
```text
id
create_time
cover_image_url
share_url
video_description
duration                   # the published asset's duration - FILM-1710
height
width
title
embed_html
embed_link
like_count
comment_count
share_count
view_count
is_aigc
open_id                    # /v2/user/info/
union_id                   # /v2/user/info/
avatar_url                 # /v2/user/info/
display_name               # /v2/user/info/
follower_count             # /v2/user/info/
```

<!-- fields: tiktok/business-api source: https://business-api.tiktok.com/portal/docs -->
```text
video_views                # mixes organic and paid; cannot be separated
reach
likes
comments
shares
full_video_watched_rate
total_time_watched
average_time_watched
impression_sources
audience_countries
```

<!-- fields: instagram/graph-media source: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ -->
```text
views                      # replaces plays and impressions since 2025-04-21
reach
total_interactions
likes
comments
saved
shares
profile_visits             # NOT available for REELS
follows                    # NOT available for REELS
reels_skip_rate
ig_reels_avg_watch_time    # units undocumented; ms inferred
ig_reels_video_view_total_time
media_type
media_product_type
followers_count
follower_demographics
reposts_count              # added 2026-04-22, Media node, FEED + REELS
saved_count                # added 2026-04-22, Media node, FEED + REELS
shares_count               # added 2026-04-22, Media node, FEED + REELS
# NOT indexed until the naming family is settled - FILM-1725 Check C:
#   total_views_count / total_views, total_like_count / total_likes,
#   total_comments_count / total_comments, and facebook_views
```

<!-- fields: instagram/graph-account source: https://developers.facebook.com/docs/instagram-platform/insights/ -->
```text
views
reach
profile_views
website_clicks
follower_demographics
followers_count
```

<!-- fields: facebook/video-insights source: https://developers.facebook.com/docs/graph-api/reference/video/video_insights/ -->
```text
total_video_views
total_video_views_unique
total_video_15s_views
total_video_avg_time_watched
total_video_view_total_time
total_video_retention_graph
total_video_impressions_unique
total_video_complete_views
blue_reels_play_count
fb_reels_replay_count
fb_reels_total_plays
post_impressions_unique
post_video_avg_time_watched
post_video_view_time
post_video_retention_graph
post_video_followers
page_media_view
total_video_views_autoplayed
total_video_views_clicked_to_play
total_video_views_sound_on
total_video_10s_views
total_video_30s_views
total_video_60s_excludes_shorter_views
total_video_view_time_by_age_bucket_and_gender
total_video_reactions_by_type_total
post_video_likes_by_reaction_type
post_video_social_actions
total_video_ad_break_earnings
total_video_ad_break_ad_cpm
total_video_ad_break_ad_impressions
creator_monetization_qualified_views
```

<!-- fields: x/enterprise-analytics source: https://docs.x.com/x-api/media/analytics -->
```text
video_views
playback_start
playback25
playback50
playback75
playback_complete
watch_time_ms
cta_url_clicks
cta_watch_clicks
play_from_tap
timestamped_metrics
bookmarks
user_profile_clicks
url_clicks
shares
quote_tweets
impressions
follows
unfollows
```

<!-- fields: x/non-public-metrics source: https://docs.x.com/x-api/posts/lookup -->
```text
playback_0_count
playback_25_count
playback_50_count
playback_75_count
playback_100_count
view_count
```

_Verified: 2026-09-21_

---

## Names that must not appear in our code

Not all of these are fictional. Some are real names on a surface we have no app for,
and one is a real name for a retired feature — but every one of them is wrong in
*our* code today, and the guard treats them alike.

The first column scopes the rule to the providers it belongs to, matched against the
file path. **A deprecation is a fact about one vendor, not about the word.**
LinkedIn genuinely reports `impressions`, so forbidding the token everywhere would
be a false positive that teaches people to disable the guard.

<!-- forbidden -->
```text
tiktok                  save_count                          -> favorites_count       Research API only; does not exist for own videos on any creator-auth surface
tiktok                  average_watch_time                  -> average_time_watched  TikTok Business API
tiktok                  total_play_time                     -> total_time_watched    TikTok Business API
tiktok                  traffic_source_types                -> impression_sources    TikTok Business API
tiktok                  full_video_watched_rate             -> (no-substitute)       correct name, Business API only - we have no Business API app
tiktok                  research/creator/insights           -> (none)                research.creator_insights is not a real scope; research scopes are academic-only
instagram|meta|facebook plays                               -> views                 removed 2025-04-21, enforced across all Graph versions
instagram|meta|facebook impressions                         -> views                 removed 2025-04-21, enforced across all Graph versions
instagram|meta|facebook clips_replays_count                 -> (none)                removed 2025-04-21, no replacement
instagram|meta|facebook ig_reels_aggregated_all_plays_count -> views                 removed 2025-04-21
youtube                 annotationClickThroughRate          -> (none)                annotations retired; documented but dead
```

The guard matches whole tokens, so `video_thumbnail_impressions`, `adImpressions`
and `fb_reels_total_plays` are unaffected by the `impressions` and `plays` entries.

_Verified: 2026-09-21_

---

## Documented-vs-inferred ledger

Everything in this document is vendor-documented **except** the rows below, which are
inferred and must be labelled as such wherever they are used.

| Claim | Basis | Status |
|---|---|---|
| X analytics endpoints are uncallable on pay-per-use | Comparison table + absence from the billing schedule. The endpoint pages say nothing | inferred |
| X app-only auth fails | "Owned posts only" semantics | inferred |
| The Instagram aggregate-metric names (`total_views_count` vs `total_views`) | Media node reference and the insights page disagree; the latter still lists metrics removed 2025-04-21 | inferred |
| `facebook_views` exists at all | Announcement blog only; on neither reference page | inferred |
| Instagram watch-time fields are in milliseconds | Community consensus; the reference states no unit | inferred |
| Facebook `post_video_avg_time_watched` denominator is initial plays | Business Help Center; the API reference does not state it | inferred |
| Instagram media insights ≈ 2 years, account ≈ 90 days | Two Meta pages disagree; this reconciles them | inferred |
| TikTok app review takes 1–2 weeks | Third-party integrator reports, not TikTok | inferred |
| Meta App Review takes 4–8 weeks | Community reports; **Meta publishes no SLA** | inferred |
| ~~Graph v18.0 is past end-of-life~~ | **Resolved 2026-09-21.** Meta's changelog gives the expiry as 2026-01-26, and the versioning guide documents silent substitution. See [Graph API versions](#graph-api-versions) | **documented** |

_Verified: 2026-09-21_

---

## Open questions

Genuinely undocumented. **No one may fill these with a guess.** Each needs an owner
and a question asked of the vendor.

| Question | How to settle it | Owner |
|---|---|---|
| The `/2/media/analytics` historical window and rate limit | One call with a pay-per-use token, `start_time` beyond 30 days | **FILM-1725** (deferred; gates FILM-1727's Enterprise tier) |
| Whether `/2/media/analytics` is callable below Enterprise | The same call. A 403 settles it; a 200 falsifies the comparison table | **FILM-1725** (deferred; gates FILM-1727's Enterprise tier) |
| X Enterprise pricing, and any per-call analytics price | Sales contact | *unassigned — FILM-1727* |
| Meta App Review and Business Verification timelines | Submit and measure | *unassigned — FILM-1711* |
| How Meta's `total_cputime` is computed | Developer support ticket | *unassigned* |
| Any path to raising Instagram BUC quotas | Developer support ticket | *unassigned* |
| The denominator of Facebook's `total_video_avg_time_watched` | Developer support ticket | *unassigned — FILM-1720* |
| Facebook's `post_video_retention_graph` segment count | One authorised call against a real Reel, counting the returned segments | *unassigned — FILM-1720* |
| The Instagram aggregate-metric naming family (`total_views` vs `total_views_count`), and whether `facebook_views` exists | One call once insights permission is held | **FILM-1725** Check C |
| The TikTok Display API field list, confirmed live | A sandbox app with `video.list` granted to a test user — see below | **FILM-1725** (deferred; fold into FILM-1711) |

### Reproducible checks

Two of the three checks FILM-1721 §11 named can be run without production
credentials. The third cannot: X has no sandbox, Free/Basic/Pro closed to new
signups on 2026-02-06, and the question *is* whether a non-Enterprise token works.

The two that have not run are tracked in
[FILM-1725](../specs/phase-17-analytics-provenance/FILM-1725-deferred-vendor-verifications.md),
with the trigger that should bring each back. They are deferred, not dropped —
nothing below may be restated as fact until its check has run.

```bash
# 1. Graph version routing. RUN 2026-09-21 - see "Graph API versions" above.
#    v18.0/v19.0/v23.0 -> OAuthException 2500 (recognised); v99.0 -> "Unknown path
#    components" (unrecognised). Routing proves recognition, not semantics.
for v in v18.0 v19.0 v23.0 v99.0; do
  echo "--- $v ---"; curl -s "https://graph.facebook.com/$v/me"; echo
done

# 2. TikTok Display API field list. NOT YET RUN - needs a sandbox app with
#    `video.list` granted to a test user. Registration is free; app review is
#    required only for production, not sandbox.
curl -s -X POST \
  "https://open.tiktokapis.com/v2/video/query/?fields=id,duration,view_count,like_count,comment_count,share_count" \
  -H "Authorization: Bearer $TIKTOK_SANDBOX_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"filters":{"video_ids":["<test-video-id>"]}}'
# Expected: 200 with exactly those fields. A field named in the request but absent
# from the response body is a field the vendor does not have - record it under
# "Names that must not appear in our code".

# 3. X /2/media/analytics tier gate. CANNOT BE RUN - no sandbox, needs a real
#    pay-per-use token. Left open deliberately; see the table above.
```

_Verified: 2026-09-21_

---

## Review cadence

**Re-verification is not optional maintenance.** YouTube redefined `views` three
weeks before the original research; Instagram removed four metrics in a single day in
April 2025; two Graph versions expired while this repository pointed at them.

- Every `##` section carries a `_Verified:_` date. The guard asserts the date is
  present, parseable and not in the future.
- The guard deliberately does **not** fail on a date older than *N* days. A check
  that reddens the build on a calendar is one nobody can fix at 3am, and it would be
  disabled within a month. Staleness is a review duty, not a build failure.
- **Re-verify at the start of any phase that reads from a new surface**, and whenever
  a platform announces a deprecation. Update the section's date in the same commit as
  the change, never separately.

_Verified: 2026-09-21_
