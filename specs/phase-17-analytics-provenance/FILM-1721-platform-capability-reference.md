---
spec_id: FILM-1721
title: Platform Capability Reference
status: ✅ DONE
effort: L
dependencies: none
---

# Platform Capability Reference

> **Shipped.** The reference itself lives at
> [docs/platform-capability-reference.md](../../docs/platform-capability-reference.md)
> and is the living copy — it carries a re-verification cadence and is parsed by
> `packages/features/content-analytics/__tests__/platform-field-names.test.ts`.
> This spec is the work item, kept for its rationale and acceptance criteria;
> **do not edit the tables below, edit the document.**

## 1. Why this exists

The first draft of this phase's signal specs took several platform claims from
**our own TypeScript type declarations** rather than from vendor documentation.
That was wrong in five places on TikTok alone, and the errors were the
expensive kind: they made a second API integration look like a one-line change
to a URL.

This spec is the researched truth table the capability matrix is built from.
Every row cites vendor documentation. Anything inferred is marked as inferred.

**Rule this establishes:** a metric name may not appear in a spec, a type, or a
request unless it appears in this document with a citation. Our own types are
not evidence — `TikTokVideoData` declared five fields that do not exist on the
endpoint it was used with.

Research date: **2026-09-14**. Every row carries the date it was verified,
because these APIs change — YouTube redefined `views` three weeks before this
was written.

## 2. Per-platform summary

| Platform | Analytics surface | Auth state today | Commercial | Data window |
|---|---|---|---|---|
| YouTube | Analytics API + Reporting API | authorised | included | reporting: 30d from **job creation**, unrecoverable |
| TikTok (basic) | Display API `/v2/video/query/` | **scope missing** (`video.list`) | included | unbounded backwards |
| TikTok (deep) | **Business API** `/business/video/list/` | not implemented; separate app | included | stops updating 365d after publish |
| Instagram | Graph `/{ig-media-id}/insights` | **permission missing** | included | media ~2y; account ~90d |
| Facebook | Graph `/{video-id}/video_insights` | **permission missing** | included | 2 years |
| X (degraded) | `media.non_public_metrics` via posts lookup | scope ordinary; not implemented | metered | **30d from post creation** |
| X (full) | `/2/media/analytics` | scope ordinary | **tier gated — Enterprise** | **undocumented** |

## 3. YouTube

Analytics API metric names, all confirmed valid on `dimensions=day` +
`filters=video==ID`:

`views`, `engagedViews`, `estimatedMinutesWatched`, `averageViewDuration`,
**`averageViewPercentage`**, `subscribersGained`, `subscribersLost`, `likes`,
`dislikes`, `comments`, `shares`, `cardClickRate`.

- `averageViewPercentage` **is** valid on the daily per-video query. The two
  YouTube calls can collapse into one. Only documented incompatibility: the
  `liveOrOnDemand` dimension.
- `annotationClickThroughRate` is valid but **effectively dead** — annotations
  were retired — so drop it.
- **`adImpressions` is not thumbnail impressions.** It is ad inventory, and it
  was "previously named `impressions`". A grep for "impressions" finds this
  trap first.

Reporting API (bulk) — the only source of thumbnail impressions and CTR:

- `channel_basic_a3`, `channel_reach_combined_a1` /
  `channel_reach_basic_a1`
- Columns: `video_thumbnail_impressions`, `video_thumbnail_impressions_ctr`,
  `engaged_views`
- **Reach reports with thumbnail impressions launched 2026-01-15** — eight
  months old at time of writing.
- **Backfill is 30 days from job creation**, permanently. Create jobs at
  channel onboarding, not at first sync.
- Generated reports downloadable 60 days; **historical backfill reports only
  30 days** from generation.
- Reports cover 12:00–23:59 **PST**. 48–72h processing delay.

Retention: `dimensions=elapsedVideoTimeRatio` (0.01–1.0, 100 points),
`filters=video==ID` required, metrics `audienceWatchRatio`,
`relativeRetentionPerformance`, `startedWatching`, `stoppedWatching`.
**YouTube is the only platform here with a real retention curve API.**

Shorts vs long-form: the `creatorContentType` dimension, values covering
shorts / video-on-demand / livestream / stories.

Not available at all: "viewed vs swiped away", Shorts feed impressions,
new-vs-returning viewers (Studio-only). **`audienceType` is a trap** — it looks
like new-vs-returning and is organic-vs-paid, filter-only. The closest real
segmentation is `subscribedStatus`, which is a different concept and must not
be relabelled.

Quota: Analytics API cost is evaluated per query with no published number —
read the project's own Cloud Console. **Reporting API has no meaningful quota**
("data is retrieved once"). For nightly multi-channel sync, Reporting is the
spine and Analytics the gap-filler.

## 4. TikTok

### Display API `/v2/video/query/` — the shallow one

Complete documented `fields` list:

```
id, create_time, cover_image_url, share_url, video_description, duration,
height, width, title, embed_html, embed_link, like_count, comment_count,
share_count, view_count, is_aigc
```

**`duration` is here** — the published asset's duration, which FILM-1710 needs.

Scope: **`video.list`**. There is **no `video.query` scope**. Max 20 video IDs
per request. Rate limit 600 req/min per endpoint. Pagination cursor is a UTC
Unix timestamp **in milliseconds**, a documented bug source.

### Business API `/business/video/list/` — the real one

Host `business-api.tiktok.com/open_api/v1.3/`. **Separate developer portal,
separate app registration**, and the creator must be on a **TikTok Business
account**.

Fields: `video_views`, `reach`, `likes`, `comments`, `shares`,
`full_video_watched_rate`, `total_time_watched`, `average_time_watched`,
`impression_sources`, `audience_countries`.

Documented constraints:

- `video_views` **mixes organic and paid** and cannot be separated.
- `reach`, `full_video_watched_rate`, `total_time_watched`,
  `average_time_watched`, `impression_sources`, `audience_countries` return
  **empty if the video has been inactive >7 days**.
- **Post data stops updating 365 days after publish.**
- General rule: if TikTok Studio does not show it, the API will not return it.

### Names that do not exist

Recorded because our own types declared them:

| We declared | Reality |
|---|---|
| `save_count` | **Does not exist** for own videos on any creator-auth surface. `favorites_count` is Research API only |
| `average_watch_time` | `average_time_watched`, Business API |
| `total_play_time` | `total_time_watched`, Business API |
| `full_video_watched_rate` | Correct name, **wrong API** |
| `traffic_source_types` | `impression_sources`, Business API |

**`research.creator_insights` does not exist.** The documented research scopes
are `research.adlib.basic`, `research.data.basic`, `research.data.u18eu`,
`research.data.vra`, and eligibility is "independent and academic researchers
who conduct research on a non-for-profit basis" — **not available to commercial
apps**, and with no demographics endpoints at all.

Hard ceilings: **no retention curve, no replay count, no 2s/6s holds**, no
per-video follows or profile views, on any API. `full_video_watched_rate` is
one scalar.

App review is mandatory for production on every scope including `video.list`;
new apps default to sandbox.

## 5. Instagram

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
creators publish. Instagram's Audience stage therefore has no per-media signal.

Also absent: **no replay metric** (`clips_replays_count` removed 2025-04-21,
no replacement), **no retention graph**, **no completion rate**, **no per-media
follower/non-follower split** (that breakdown is account-level only — so our
`video_audience.follower_status` rows for Instagram are account-level data
attributed per media).

`reels_skip_rate` — "percentage of views from people who skipped during the
first 3 seconds" — is the entire retention surface.

Deprecated and enforced across **all versions** on 2025-04-21: `plays`,
`impressions`, `clips_replays_count`, `ig_reels_aggregated_all_plays_count`.
Use `views`.

**Units on `ig_reels_avg_watch_time` and `ig_reels_video_view_total_time` are
undocumented.** Community consensus is milliseconds. *Inferred* — validate
empirically before shipping; misreading ms as seconds is a known failure mode.

Permissions:

| Path | Host | Permissions |
|---|---|---|
| Instagram Login | `graph.instagram.com` | `instagram_business_basic` + `instagram_business_manage_insights` |
| Facebook Login | `graph.facebook.com` | `instagram_basic` + `instagram_manage_insights` + `pages_read_engagement` |

On the Facebook Login path, a Page role granted **via Business Manager** also
needs `ads_management` + `ads_read` — a common silent-403.

Other documented behaviour: missing data returns an **empty data set, not 0**;
Story metric values under 5 return error code `10`; data may be delayed up to
48 hours; **albums/carousels have no insights at all**.

Retention: media insights ~**2 years**; account-level ~**90 days**. (Meta's own
two pages disagree; this is the best reading and is partly inferred.) Stories
are 24 hours with no backfill.

**Rate limit: `4800 × impressions` per 24h, per app-and-user pair.** The quota
scales with the creator's reach, so a new or dormant creator has a near-zero
budget and the long tail throttles first. **There is no documented way to raise
it.**

## 6. Facebook

`GET /{video-id}/video_insights` — Pages only, not groups or user profiles.
Data retained 2 years. Requires a Page token from someone with the **`ANALYZE`**
task; Meta's own two doc pages disagree on whether the permission is
`pages_manage_engagement` + `read_insights` or `pages_read_engagement`.
Request all three.

Video metrics: `total_video_views` (≥3s), `total_video_views_unique`,
`total_video_15s_views`, `total_video_avg_time_watched` (**ms**),
`total_video_view_total_time` (**ms**), `total_video_retention_graph` (**40
equal intervals**), `total_video_impressions_unique`,
`total_video_complete_views` (≥97%).

Reels metrics: `blue_reels_play_count` (≥1ms, **excludes replays**),
**`fb_reels_replay_count`**, `fb_reels_total_plays` (includes replays),
`post_impressions_unique` (reach, **estimated**), `post_video_avg_time_watched`,
`post_video_view_time`, `post_video_retention_graph`,
**`post_video_followers`** (follows attributed to the reel).

### The four denominators

These must never be conflated, and none maps onto a YouTube view:

1. **Impression** — entered the screen, no playback required, **estimated**.
2. **Play** — ≥1 millisecond, replays excluded.
3. **3-second view** — ≥3s **or** nearly full length if shorter than 3s.
4. **ThruPlay** — **an Ads metric.** Not on `video_insights` at all.
   `total_video_15s_views` is **not** equivalent: ThruPlay is "completed or
   ≥15s, whichever first", so a short video that completes under 15s counts for
   ThruPlay and not for the organic metric. **Do not label it ThruPlay.**

### The most important non-equivalence found

**`post_video_avg_time_watched` can exceed the video's own duration.** Replay
time is in the numerator (documented); the denominator is initial plays, which
exclude replays (per Meta's Business Help Center — the API reference does not
state the denominator, so this half is *inferred*). YouTube's average view
duration cannot do this.

Safest approach: compute our own average explicitly and label which denominator
was used, rather than shipping Meta's precomputed figure as comparable.

Not available: **follower vs non-follower reach for video or Reels.** Only the
page-level `page_media_view` carries `is_from_followers`.

Rate limits: Page tokens use BUC `4800 × engaged users` per 24h; app/user
tokens use `200 × users` per hour. Page throttle error code **80001**.

## 7. X

### Enterprise — `GET /2/media/analytics`

`video_views`, `playback_start`, `playback25`, `playback50`, `playback75`,
`playback_complete`, `watch_time_ms`, `cta_url_clicks`, `cta_watch_clicks`,
`play_from_tap`, `timestamped_metrics`. Up to 100 media keys,
`hourly|daily|total`, `start_time` and `end_time` both required.

`GET /2/tweets/analytics` adds `bookmarks`, `user_profile_clicks`,
`url_clicks`, `shares`, `quote_tweets`, `impressions`, and — uniquely among
these five platforms — **`follows` and `unfollows` attributed to a post**.

**Both are Enterprise-only.** Evidence: an explicit comparison table on X's
Enterprise introduction lists engagement metrics as Enterprise-only; neither
endpoint appears as a billable line item on the pay-per-use schedule; and
`/2/media/analytics` is absent from the published rate-limit table.

*Documented inconsistency worth knowing:* both endpoints live in the standard
`docs.x.com/x-api/` namespace and their own reference pages state no tier
requirement. **One call with a pay-per-use token settles it** — do that before
architecting around the assumption.

**Enterprise pricing is unpublished.** The widely-cited ~$42k/month figure is
third-party, not X. X closed Free/Basic/Pro to new signups on **2026-02-06**;
only pay-per-use credits and Enterprise remain.

### Pay-per-use — the degraded path

`media.non_public_metrics` via the ordinary posts lookup:
`playback_0_count`, `playback_25_count`, `playback_50_count`,
`playback_75_count`, `playback_100_count`, `view_count`.

**Note the two quartile vocabularies are different** — `playback25` (analytics)
vs `playback_25_count` (non-public metrics). Do not mix them.

No watch time, no CTA clicks, no time series.

### The 30-day wall

Documented verbatim: *"Non-public, organic, and promoted metrics are only
available for posts created within the last 30 days."* The gate is on the
post's **creation date**, not the requested range — an older post returns
nothing regardless of window.

**The historical window on `/2/media/analytics` is undocumented.** Not on the
endpoint reference, the media introduction, or the metrics page. The legacy
enterprise Engagement API allowed 365 days with 4-week spans, which is a prior
and not a fact. **This is the single most important open question in the
phase**, because it decides whether X can be benchmarked past 30 days.

Scopes: `tweet.read` for media analytics, `users.read` + `tweet.read` for post
analytics. **There is no `media.read` scope.** **User context is required** —
no app-only path, so only authorised accounts, never competitors'.

## 8. The documented-vs-inferred ledger

Everything above is documented except these, which are **inferred and must be
labelled as such wherever they are used**:

| Claim | Basis |
|---|---|
| X analytics endpoints are uncallable on pay-per-use | Comparison table + absence from the billing schedule. Endpoint pages say nothing |
| X app-only auth fails | "Owned posts only" semantics |
| Instagram watch-time fields are in milliseconds | Community consensus; the reference states no unit |
| Facebook `post_video_avg_time_watched` denominator is initial plays | Business Help Center; the API reference does not state it |
| Instagram media insights ≈ 2 years, account ≈ 90 days | Two Meta pages disagree; this reconciles them |
| Graph v18.0 is past end-of-life | Meta's ~2-year deprecation policy + v18's Sept 2023 release |
| TikTok app review takes 1–2 weeks | Third-party integrator reports, not TikTok |
| Meta App Review takes 4–8 weeks | Community reports; **Meta publishes no SLA** |

And these are **genuinely undocumented** — no one may fill them with a guess:

- The `/2/media/analytics` historical window and rate limit
- X Enterprise pricing, and any per-call analytics price
- Meta App Review and Business Verification timelines
- How Meta's `total_cputime` is computed
- Any path to raising Instagram BUC quotas
- The denominator of Facebook's `total_video_avg_time_watched`
- Facebook's `post_video_retention_graph` segment count

## 9. Out of scope

- Implementing anything. This is a reference.
- The capability matrix itself — FILM-1703, which is *built from* this.
- Deciding whether to buy X Enterprise or pursue Meta Advanced Access.

## 10. Acceptance criteria

- [x] Every metric named in any Phase 17 spec appears here with a citation
- [x] Every row records the API surface, exact field name, scope, access level and data window
- [x] Every inferred claim is in the ledger, and nothing inferred is stated as fact elsewhere
- [x] Every genuinely undocumented item has a named owner and the question to ask
- [x] Each row carries the date it was verified
- [x] A spec, type or request naming a field absent from this document fails review —
      **automated**, not left to review: the guard parses the field index out of
      the document and fails on an undocumented request or a retired name
- [x] Our own type declarations are nowhere cited as evidence of a platform's capability
- [x] The five field names TikTok does not have are recorded, so they are not re-added —
      and removed from the code that declared them
- [x] The two X quartile vocabularies are distinguished
- [x] Facebook's four denominators are distinguished, and ThruPlay is marked ads-only

## 11. Verification

This spec is verified by **use**: the capability matrix in FILM-1703 is built
from it, and its structural test requires every entry to trace to a row here.

Three empirical checks, each cheap and each able to falsify a row:

1. `/2/media/analytics` with a pay-per-use token — settles the Enterprise gate.
   **Not run.** X has no sandbox and closed Free/Basic/Pro to new signups on
   2026-02-06, so the question cannot be settled without a paid token. Recorded
   as an open question with FILM-1720 as owner.
2. `/v2/video/query/` with `video.list` granted — settles the field list.
   **Not run**; a sandbox app is enough and the command is recorded in the
   document. Owner FILM-1711.
3. A Graph call on v18.0 — settles whether token refresh is already broken.
   **Run 2026-09-21, and it resolved more than expected.** Meta's changelog
   gives v18.0's expiry as **2026-01-26** and v19.0's as **2026-05-21**, both
   past; the versioning guide documents that calls to an expired version are
   *"defaulted to the next oldest, usable version"* rather than rejected. An
   unauthenticated probe confirms v18.0 still routes, which proves the version
   string is recognised and nothing about which semantics were served. We pin
   v18.0 in `token-refresh.ts` and v19.0 in the lambda handlers. This moves
   "Graph v18.0 is past end-of-life" out of the inferred ledger and strengthens
   FILM-1723, whose failure mode is substitution rather than rejection.

Re-verification is not optional maintenance. YouTube redefined `views` three
weeks before this was written, and Instagram removed four metrics in April
2025. **Set a review cadence and record the last-verified date per section.**

## 12. Risk

The obvious risk is staleness: a reference that is trusted and wrong is worse
than none. The per-row verification date and the review cadence in §11 are the
mitigation, and the §8 ledger is what keeps inference from hardening into
assumed fact.

The subtler risk is that this document becomes the only place the knowledge
lives, and the code drifts from it. FILM-1703's writer-binding test is the
existing guard for that on the ingest side; the acceptance criterion "a field
absent from this document fails review" is the guard on the spec side.
