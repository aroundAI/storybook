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
| YouTube | Analytics API + Reporting API | authorised; **revenue requested since FILM-1711**, held only by connections made or re-consented after it, and Partner Program channels only | included | reporting: 30d from **job creation**, unrecoverable |
| TikTok (basic) | Display API `/v2/video/query/` | `video.list` + `user.info.stats` **requested since FILM-1711; TikTok app review outstanding** | included | unbounded backwards |
| TikTok (deep) | **Business API** `/business/video/list/` | not implemented; separate app | included | stops updating 365d after publish |
| Instagram | Graph `/{ig-media-id}/insights` | `instagram_manage_insights` **requested since FILM-1711; App Review + Business Verification outstanding** | included | media ~2y; account ~90d (*inferred*) |
| Facebook | Graph `/{video-id}/video_insights` | **permission missing** (`read_insights`) — not requested until a provider uses it, FILM-1720 | included | 2 years |
| X (degraded) | `media.non_public_metrics` via posts lookup | **held** — `tweet.read` + `users.read` are requested for publishing; no provider | metered | **30d from post creation** |
| X (full) | `/2/media/analytics` | **held** (same scopes) | **tier gated — Enterprise** (*inferred*) | **undocumented** |

What each surface needs is declared in code, in
`packages/features/publishing/src/oauth/analytics-scopes.ts`, and
`analytics-scope-binding.test.ts` fails a provider call whose scopes the OAuth config
does not request. Where each vendor review stands is in
[vendor-review-status.md](./vendor-review-status.md).

_Verified: 2026-09-22_

---

## YouTube

Analytics API metric names, all confirmed against
[Google's metrics reference](https://developers.google.com/youtube/analytics/metrics)
and valid on `dimensions=day` + `filters=video==ID`.

- `averageViewPercentage` **is** valid on the daily per-video query. The two YouTube
  calls can collapse into one. The only documented incompatibility is the
  `liveOrOnDemand` dimension.
- **No unique-viewer metric.** The metrics reference (re-read 2026-09-28) lists
  `views`, `engagedViews` and other counts of views, and nothing counting
  different people. So YouTube has no `accounts_reached`, for a video or a
  channel: the capability matrix calls both `unsupported`.
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

  Until FILM-1711, `YOUTUBE_OAUTH_CONFIG` did not request the monetary scope while
  `YouTubeAnalyticsProvider.fetchTotals` asked for all three revenue metrics in the
  same query as the non-monetary ones. The scope is now requested, and revenue
  travels in its own query (`fetchRevenue`), made only for a connection whose
  recorded grant carries the scope. **Still not established:** whether YouTube
  rejected the old mixed query outright or returned it without the revenue columns,
  and what a non-Partner channel gets back with the scope held — FILM-1725 Check G.
  The Reporting API's job methods accept either scope
  ([jobs.list](https://developers.google.com/youtube/reporting/v1/reference/rest/v1/jobs/list),
  read 2026-09-22).

- **The Data API call (`videos.list`, for titles and durations) rides on
  `youtube.readonly`** — "View your YouTube account" in Google's
  [Data API scope table](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps),
  read 2026-09-22. It is requested, and has been since the first YouTube connection.

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
**YouTube has the finest retention curve here** (100 points, per video). Facebook has one too — `total_video_retention_graph` (40 equal intervals) and `post_video_retention_graph` (segment count undocumented) — but not yet an integration (FILM-1720). TikTok, Instagram and X have none.

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

**The Shorts change reached the API later than it reached Studio.** The
[revision history](https://developers.google.com/youtube/analytics/revision_history)
(re-read 2026-09-22) dates `engagedViews` — "will reflect the previous
view-counting methodology" — to **2025-04-24**, when targeted queries switched, and
the bulk reports' `engaged_views` column to **2025-06-24**; the 2025-03-26 entry
says "until then, views will be based on the old methodology". So a stored Shorts
view between 2025-03-31 and 2025-06-24 is one definition or the other and nothing
says which. The 2026-08-27 entry defines an engaged view as "playback continues
past the first frame, or the user clicks/taps to play", and leaves it unchanged.
FILM-1722's registry (`packages/clickhouse/src/lib/view-definitions.ts`) encodes
these dates, and `view-definition-sources.test.ts` fails if one it uses is not
stated in this section.

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

**`/v2/user/info/` splits its fields across three scopes**, and `follower_count` is
not in the basic one. TikTok's
[User Info API scope migration](https://developers.tiktok.com/bulletin/user-info-scope-migration)
bulletin: from 2024-02-29 `user.info.basic` returns only `open_id`, `union_id`, the
avatar URLs and `display_name`; `follower_count`, `following_count`, `likes_count`
and `video_count` need **`user.info.stats`**. Our follower snapshot asks for
`follower_count`, so it needs that scope — added to the OAuth config by FILM-1711,
which found it only because the scope-binding test refused the call. *Read through a
search index on 2026-09-22; the page itself was unreachable from this network, as
above.*

**Every response carries `error`, success included.** A successful call returns
`{ "data": { … }, "error": { "code": "ok", "message": "", "log_id": "…" } }`; only a
code other than `ok` is a failure, and the human-readable `message` does not contain
the code (e.g. `access_token_invalid` arrives with "The access token is invalid or
not found in the request."). *Source, stated precisely because this section is not
re-verified:* TikTok's own `/v2/video/query/` example, seen through a search index on
2026-09-21 while the page itself was unreachable from here, and this repo's
publishing provider, which already relies on it (`tiktok-provider.ts` checks
`error?.code !== 'ok'`). The analytics provider did not, until #279. FILM-1725 Check B
confirms it live.

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

**`reach` is estimated, and `views` is still "in development".** The
[media insights reference](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/)
(re-read 2026-09-22) describes `reach` as "number of unique Instagram users that
have seen the reel at least once … different from impressions, which can include
multiple views of a reel by the same account" and tags it *"Metric is estimated"*;
`views` is "total number of times IG Media has been played" and tagged *"Metric in
development"*. It does not say whether `views` counts replays or paid plays.

**`profile_visits` and `follows` are not available for REELS** — which is what
creators publish. Instagram's Audience stage therefore has no per-media signal, and
a `follows` value read for a Reel is a structural zero, not a measurement.

Also absent: **no replay metric** (`clips_replays_count` removed 2025-04-21, no
replacement), **no retention graph**, **no completion rate**, and **no per-media
follower/non-follower split** — `follow_type` is an account-level breakdown only,
so Instagram writes no `video_audience.follower_status` rows. The provider used to
request `reach` with `breakdown=follow_type` per Reel; that call was undocumented
and has been removed.

`reels_skip_rate` — "percentage of views from people who skipped during the first 3
seconds" — is the only curve-like surface, but **not** the whole attention story:
`ig_reels_avg_watch_time` ("the average amount of time spent playing the reel") and
`ig_reels_video_view_total_time` ("the total amount of time the reel was played")
are both documented for REELS.

⚠️ **We request neither.** `instagram-insights.ts` asks for `views, reach,
total_interactions, likes, comments, saved` (and `shares` only on a branch that never
runs — see below), so Instagram watch time is documented and discarded. FILM-1712
owns requesting it.

⚠️ **Our provider branches on the wrong field.** It reads `media_type` and tests for
`REELS`, but `media_type` is only ever `CAROUSEL_ALBUM`, `IMAGE` or `VIDEO`; `REELS`
is a value of `media_product_type`. The Reels branch therefore never runs, so
`shares` is never requested. Fixed in its own PR (`fix/instagram-reels-branch`),
because it changes stored data. That branch also gated the per-Reel reach breakdown
above; fixing the branch would have switched on an undocumented call, so the call is
gone rather than fixed.

### Added 2026-04-22

Per Meta's [Instagram changelog](https://developers.facebook.com/docs/instagram-platform/changelog),
all **Facebook Login only** and "applies to all versions":

| Name | Where | What it is |
|---|---|---|
| `reposts_count` | Media node field, FEED + REELS | "Number of times the media has been reposted" |
| `saved_count` | Media node field, FEED + REELS | saves; owner or accepted collaborator only |
| `shares_count` | Media node field, FEED + REELS | shares |
| `total_views_count` / `total_views` | Media node field / insights metric | views across **all surfaces, including boosted media and replays**; video only |
| `total_like_count` / `total_likes` | Media node field / insights metric | likes across all surfaces, including boosted |
| `total_comments_count` / `total_comments` | Media node field / insights metric | comments across all surfaces, including boosted |
| `facebook_views` | media insights metric | now Feed, Reels and Story (was Reels only) |

The two names for each aggregate are one number reached two ways: the `*_count`
spelling is a field on the media object, the short spelling an insights metric. An
earlier revision recorded them as an unsettled either-or and `facebook_views` as
existing "on neither reference page"; the changelog settles both.

**The aggregates are a different denominator from `views`** — they fold in boosted
and crossposted placements, and `total_views_count` includes replays — so they must
never be substituted for it. `reposts_count` is the first media-level
pass-it-on signal Instagram has offered.

We use `graph.facebook.com`, so we qualify for the Facebook-Login-only fields; the
Instagram Login path would not.

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
the current `video_insights` reference names `pages_manage_engagement` +
`read_insights`. An older Meta page names `pages_read_engagement`; request all three
until one authorised call settles it (FILM-1720 §8).

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
FILM-1720 is, and in which direction:

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

**Pinned: `v23.0`, upgrade before 2027-10-08.** One constant,
`META_GRAPH_VERSION` in `packages/shared/src/vendors/meta.ts`, read by every Meta
call in the repository (FILM-1723). `vendor-api-versions.test.ts` fails if this
line, the table row below and the constant disagree, or if a version literal is
written anywhere else. Meta's cadence makes the next bump a scheduled task: by
**2027-10-08**, move to a version with at least a year left, reading the
changelog of every version crossed.

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

**The `facebook-api-version` response header does say which version was served**,
and settles it. Run 2026-09-21T20:00Z for FILM-1723, unauthenticated, against
`/{version}/me`:

| Requested | `facebook-api-version` returned |
|---|---|
| `v18.0` | **`v20.0`** |
| `v19.0` | **`v20.0`** |
| `v23.0` | `v23.0` |
| `v26.0` | `v26.0` |

So token refresh was not failing: it was running on v20.0, three days from its own
expiry, after which the same requests would have been served as v21.0.

⚠️ **This is worse than a hard failure, and it was live in our code until
FILM-1723.** Three versions were pinned at once, two of them expired:

| Version | Where it was |
|---|---|
| `v18.0` (expired) | **`packages/features/publishing/src/oauth/meta/config.ts:7-9` — the OAuth dialog, token exchange and Graph base for every Meta connection**, `providers/facebook/types.ts:90-91`, `providers/instagram/instagram-provider.ts:10`, and **`lib/token-refresh.ts:432,475`** |
| `v19.0` (expired) | `apps/web/lambda/publish-worker/handlers/{facebook,instagram}.ts` |
| `v23.0` (current) | `packages/features/content-analytics/src/providers/instagram/instagram-insights.ts:15` |

Token refresh running on a silently-substituted version is the specific risk
FILM-1723 was written for. That spec listed "Graph v18.0 is past end-of-life" as
*inferred*; it is now documented with a date, and the case is stronger than the spec
assumed, because the failure mode is substitution rather than rejection.

All of those now read the single pin. v23.0 was chosen over v26.0 because it is the
only version this repository had already run deliberately, so Instagram insights
requests did not change, and v21-v23 alter nothing on the OAuth, Page, publishing or
container endpoints called here. **Not yet verified against a live Meta connection** -
no fixture has one; see FILM-1723's acceptance criteria.

_Verified: 2026-09-21_

---

## X

### Enterprise — `GET /2/media/analytics`

`video_views`, `playback_start`, `playback25`, `playback50`, `playback75`,
`playback_complete`, `watch_time_ms`, `cta_url_clicks`, `cta_watch_clicks`,
`play_from_tap`, `timestamped_metrics`. Up to 100 media keys,
`hourly|daily|total`, with `start_time` and `end_time` both required.

`GET /2/tweets/analytics` adds `bookmarks`, `user_profile_clicks`, `url_clicks`,
`shares`, `quote_tweets`, `impressions`, and **`follows` and `unfollows` attributed to
a post**. Facebook has the follows half for Reels (`post_video_followers`); only X has
unfollows.

**Both are Enterprise-only** — *inferred*, see the [ledger](#documented-vs-inferred-ledger). Evidence: an explicit comparison table on X's
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

Via the ordinary posts lookup: `media.non_public_metrics` carries `playback_0_count`,
`playback_25_count`, `playback_50_count`, `playback_75_count` and `playback_100_count`.
`view_count` is **not** one of them — it is in `public_metrics` and
`organic_metrics` (per the [data dictionary](https://docs.x.com/x-api/fundamentals/data-dictionary)).

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
no app-only path (*inferred* from "owned posts only"; see the ledger), so only authorised accounts, never competitors'.

_Verified: 2026-09-14_

### Token refresh (KB-15)

**Documented** ([authorization code flow](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code),
[user access token](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token)):
- An access token lasts **two hours**.
- A refresh token is issued only when `offline.access` is granted. We request it.
- A refresh is `POST https://api.x.com/2/oauth2/token`, form-encoded, with
  `grant_type=refresh_token` and `refresh_token`.
- A confidential client authenticates by `Authorization: Basic` and needs no
  `client_id` in the body: *"You don't need client id for confidential clients
  with a valid Authorization Header."*
- `refreshXToken` (`packages/features/publishing/src/lib/token-refresh.ts`)
  sends exactly that.

**Not documented:** whether the refresh token **rotates** (a new one per use,
with the old one invalidated) and how long it lives. It is widely reported to
rotate, so the code stores whatever refresh token X returns and keeps the
stored one when X returns none. That is correct either way; rotation is
*inferred*, see the [ledger](#documented-vs-inferred-ledger). One live refresh
settles it (FILM-1729, FILM-1725 Check E).

_Verified: 2026-09-23_

---

## Field index

The machine-readable half of this document. **Each block is one endpoint, and its
`source:` is the page that documents that endpoint.** Our code may request a name
only through a request site that the guard allows to use that block, so a TikTok
Display API request cannot ask for a Business API field, and an X request cannot
mix the two quartile vocabularies. Comments after `#` are ignored by the parser.

A name being listed here means the **vendor** documents it. It does **not** mean we
are authorised to request it, or that the surface is implemented — see the
per-platform sections above for that.

**Every block carries a `source:` URL, and the guard fails without one.** That is a
weak check on purpose: it proves someone had a reference page open, not that a
name is real. It exists because a name once got in here from an announcement blog
post, and nothing noticed — an unrequested wrong name can sit in the index
indefinitely, waiting to be trusted. Every URL below was fetched on 2026-09-21
except the three TikTok ones, which say so.

<!-- fields: youtube/analytics-metrics source: https://developers.google.com/youtube/analytics/metrics -->
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

<!-- fields: youtube/analytics-dimensions source: https://developers.google.com/youtube/analytics/dimensions -->
```text
day
elapsedVideoTimeRatio      # 0.01-1.0, 100 points; filters=video==ID required
ageGroup                   # includes estimated under-18 viewers since 2026-03-09
gender
insightTrafficSourceType
country
city
deviceType
operatingSystem
subscribedStatus           # NOT new-vs-returning; do not relabel
creatorContentType         # SHORTS / VIDEO_ON_DEMAND / LIVE_STREAM / STORY / UNSPECIFIED
liveOrOnDemand             # incompatible with averageViewPercentage
audienceType               # ORGANIC / AD_INSTREAM / AD_INDISPLAY, filter-only
```

<!-- fields: youtube/data-api source: https://developers.google.com/youtube/v3/docs/videos -->
```text
# videos.list `part` names we request, and the fields we read from them
snippet
contentDetails
statistics
duration                   # contentDetails.duration, ISO 8601 - FILM-1710
```

<!-- fields: youtube/reporting source: https://developers.google.com/youtube/reporting/v1/reports/channel_reports -->
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

<!-- fields: youtube/reporting-columns source: https://developers.google.com/youtube/reporting/v1/reports/channel_reports -->
```text
# CSV columns of the report types above, fetched 2026-09-25 (FILM-1802 PR B).
# Dimensions, then metrics, per the channel reports reference.
date                       # YYYYMMDD
channel_id
video_id
live_or_on_demand          # live | onDemand
subscribed_status          # subscribed | unsubscribed
country_code
playback_location_type     # numeric code (dimensions reference)
traffic_source_type        # numeric code (dimensions reference)
traffic_source_detail
device_type                # numeric code (dimensions reference)
operating_system           # numeric code (dimensions reference)
engaged_views
views
comments
likes
dislikes
shares
watch_time_minutes
average_view_duration_seconds
average_view_duration_percentage
subscribers_gained
subscribers_lost
red_views
red_watch_time_minutes
video_thumbnail_impressions
video_thumbnail_impressions_ctr
```

<!-- fields: youtube/reporting-resources source: https://developers.google.com/youtube/reporting/v1/reference/rest/v1/jobs -->
```text
# jobs.list / jobs.create / reportTypes.list / jobs.reports.list, fetched 2026-09-25.
jobs
reportTypes
reports
nextPageToken
id
reportTypeId
name
createTime
expireTime
systemManaged
jobId
startTime
endTime
downloadUrl                # the Report resource (reference/rest/v1/jobs.reports)
```

<!-- fields: youtube/analytics-result source: https://developers.google.com/youtube/analytics/reference/reports/query -->
```text
# reports.query's response, fetched 2026-09-25. "If no data is available for the
# given query, the rows element will be omitted from the response."
kind                       # youtubeAnalytics#resultTable
columnHeaders
name
columnType                 # DIMENSION | METRIC
dataType                   # STRING | INTEGER | FLOAT | …
rows
```

<!-- fields: youtube/channels source: https://developers.google.com/youtube/v3/docs/channels -->
```text
# The channel resource, fetched 2026-09-25. subscriberCount is "rounded down to
# three significant figures"; counts are unsigned longs, serialised as strings.
kind
etag
id
snippet
title
description
customUrl
publishedAt
thumbnails
default
medium
high
url
width
height
statistics
viewCount
subscriberCount
hiddenSubscriberCount
videoCount
items                      # the list response (channels.list)
pageInfo
totalResults
resultsPerPage
nextPageToken
```

<!-- fields: youtube/videos source: https://developers.google.com/youtube/v3/docs/videos -->
```text
# The video resource, fetched 2026-09-25. uploadStatus: deleted | failed |
# processed | rejected | uploaded.
kind
etag
id
snippet
publishedAt
channelId
title
description
thumbnails
default
medium
high
url
width
height
channelTitle
tags
categoryId
contentDetails
duration                   # ISO 8601
dimension
definition
caption
status
uploadStatus
privacyStatus
madeForKids
selfDeclaredMadeForKids
statistics
viewCount
likeCount
dislikeCount
favoriteCount
commentCount
items                      # the list response (videos.list)
pageInfo
totalResults
resultsPerPage
```

<!-- fields: youtube/thumbnails-set source: https://developers.google.com/youtube/v3/docs/thumbnails/set -->
```text
# Response: {kind: "youtube#thumbnailSetResponse", etag, items: [thumbnail]}.
kind
etag
items
default
medium
high
url
width
height
```

<!-- fields: youtube/playlist-items source: https://developers.google.com/youtube/v3/docs/playlistItems -->
```text
# The playlistItem resource, fetched 2026-09-25.
kind
etag
id
snippet
playlistId
title
position
resourceId
videoId
```

<!-- fields: google/oauth-token source: https://developers.google.com/identity/protocols/oauth2/web-server -->
```text
# The token endpoint's response, fetched 2026-09-25. A refresh grant returns a
# new access token; it is not documented to return a new refresh token.
access_token
expires_in
refresh_token
refresh_token_expires_in
scope
token_type                 # always Bearer
error                      # invalid_grant, invalid_client, redirect_uri_mismatch, …
error_description
```

<!-- fields: google/api-error source: https://developers.google.com/youtube/v3/docs/errors -->
```text
error
code
message
errors
domain
reason                     # insufficientPermissions, authError, quotaExceeded, …
location
locationType
status
```

<!-- fields: tiktok/display-video source: https://developers.tiktok.com/doc/tiktok-api-v2-video-query -->
```text
# source not fetched 2026-09-21: developers.tiktok.com refused connections from
# this network. Names rest on the 2026-09-14 research; FILM-1725 Check B.
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
```

<!-- fields: tiktok/display-user source: https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info -->
```text
# source not fetched 2026-09-21, as above.
open_id
union_id
avatar_url
display_name
follower_count
```

<!-- fields: tiktok/business source: https://business-api.tiktok.com/portal/docs -->
```text
# source not fetched 2026-09-21, as above - and it is the portal root, not the
# /business/video/list/ reference. No request site may use this block.
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

<!-- fields: instagram/media-fields source: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/ -->
```text
media_type                 # CAROUSEL_ALBUM / IMAGE / VIDEO - never REELS
media_product_type         # AD / FEED / STORY / REELS - branch on this
permalink                  # "Permanent URL to the media" (re-read 2026-09-29)
reposts_count              # FEED + REELS, Facebook Login, added 2026-04-22
saved_count                # FEED + REELS, owner or accepted collaborator
shares_count               # FEED + REELS
total_views_count          # all surfaces incl. boosted and replays, video only
total_like_count           # all surfaces incl. boosted
total_comments_count       # all surfaces incl. boosted
```

<!-- fields: instagram/container-fields source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container -->
```text
status_code                # EXPIRED, ERROR, FINISHED, IN_PROGRESS, PUBLISHED; expires unpublished after 24 hours
status                     # an error subcode when status_code is ERROR
```

<!-- fields: instagram/media-insights source: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ -->
```text
views                      # replaces plays and impressions since 2025-04-21
reach
total_interactions
likes
comments
saved
shares
profile_visits             # FEED + STORY only, NOT REELS
follows                    # FEED + STORY only, NOT REELS
reels_skip_rate
ig_reels_avg_watch_time    # milliseconds, observed (see note); NOT total_time / views
ig_reels_video_view_total_time
```

**Reels watch time is in milliseconds — observed, not inferred (owner's own
account, 2026-09-28 and -29).** Meta's response titles say so ("Reels Average
Watch Time (milliseconds)", "Video View Total Time (milliseconds)"), and the
values agree: a Reel with 221 views had `ig_reels_avg_watch_time` 6,194 (6.2
seconds; as seconds it would be 1.7 hours) and `ig_reels_video_view_total_time`
749,526 (12.5 minutes). **The average is not total ÷ views:** 749,526 ÷ 221 is
3,391, while 749,526 ÷ 6,194 is 121.0 exactly — Meta divides by a count of 121,
not by views (which count every play and display, replays included). Whether
121 is the Reel's accounts reached or its first plays is not yet confirmed.
Store both figures as reported; never derive one from the other.

<!-- fields: instagram/media-insights-2026 source: https://developers.facebook.com/docs/instagram-platform/changelog -->
```text
# Added 2026-04-22, "applies to all versions", Facebook Login only.
total_views                # insights-metric name of total_views_count
total_likes                # insights-metric name of total_like_count
total_comments             # insights-metric name of total_comments_count
facebook_views             # Feed, Reels and Story since 2026-04-22
```

<!-- fields: instagram/media-insights-breakdowns source: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ -->
```text
# The only two. `reach` takes no breakdown here: a per-media follower /
# non-follower split does not exist, whatever the account endpoint offers.
action_type                    # profile_activity only
story_navigation_action_type   # navigation only
```

<!-- fields: instagram/user-fields source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user -->
```text
id                         # app-scoped; Page-backed accounts
username
name
profile_picture_url
followers_count
```

<!-- fields: instagram/user-insights source: https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/ -->
```text
views                      # total_value only
reach                      # total_value or time_series
accounts_engaged           # total_value only
total_interactions         # total_value only
profile_links_taps         # total_value only
follower_demographics      # lifetime, total_value, timeframe REQUIRED - see below
# profile_views and website_clicks are NOT here: their time series ended
# January 2025 and they are absent from the current metrics table.
```

<!-- fields: instagram/user-insights-breakdowns source: https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/ -->
```text
follow_type                # follows_and_unfollows, reach - account level only
media_product_type         # comments, likes, saves, shares, total_interactions, views
contact_button_type        # profile_links_taps
age                        # follower_demographics, engaged_audience_demographics
city                       # same
country                    # same
gender                     # same
```

**Our audience request is the documented one (FILM-1712, 2026-09-27).** `fetchAccountAudience`
asks for `follower_demographics` once per breakdown (`country`, `city`, `age`, `gender`) with
`timeframe=this_month`; from v20.0 only `this_month` and `this_week` are accepted. Before, it
sent all four breakdowns in one call with no `timeframe`. That call was not rejected in
production (owner, 2026-09-27), but its parsers looked for items named after each breakdown,
while Meta answers with one item named `follower_demographics`, so no audience row was ever
written.

<!-- fields: meta/oauth-token source: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/ -->
```text
access_token               # code exchange and fb_exchange_token alike
token_type                 # "bearer"; fb_exchange_token response
expires_in                 # seconds; about 60 days for a long-lived user token
```

<!-- fields: facebook/user-accounts source: https://developers.facebook.com/docs/graph-api/reference/page/ -->
```text
# Page nodes as GET /me/accounts lists them (the edge documents only `tasks`;
# the fields are the Page node's own). Re-read 2026-09-28.
id
name
access_token               # only for a user with a role on the Page
category
picture
instagram_business_account # the linked Instagram account ({id})
```

<!-- fields: facebook/user-permissions source: https://developers.facebook.com/docs/graph-api/reference/user/permissions/ -->
```text
permission
status                     # granted, declined, expired
```

<!-- fields: facebook/reels-publishing source: https://developers.facebook.com/docs/video-api/guides/reels-publishing/ -->
```text
video_id                   # upload_phase=start
upload_url                 # upload_phase=start; the rupload host
success                    # the upload, and upload_phase=finish
video_status               # GET /{video-id}?fields=status: uploading, processing, ready, error, expired
```

<!-- fields: facebook/video-insights source: https://developers.facebook.com/docs/graph-api/reference/video/video_insights/ -->
```text
total_video_views
total_video_views_unique
total_video_15s_views
total_video_avg_time_watched
total_video_view_total_time
total_video_retention_graph
total_video_impressions
total_video_impressions_unique
total_video_complete_views
total_video_views_autoplayed
total_video_views_clicked_to_play
total_video_views_sound_on
total_video_10s_views
total_video_30s_views
total_video_60s_excludes_shorter_views
total_video_view_time_by_age_bucket_and_gender
total_video_reactions_by_type_total
blue_reels_play_count
fb_reels_replay_count
fb_reels_total_plays
post_impressions_unique
post_video_avg_time_watched
post_video_view_time
post_video_retention_graph
post_video_followers
post_video_likes_by_reaction_type
post_video_social_actions
total_video_ad_break_earnings
total_video_ad_break_ad_cpm
total_video_ad_break_ad_impressions
creator_monetization_qualified_views
```

<!-- fields: facebook/page-insights source: https://developers.facebook.com/docs/graph-api/reference/insights/ -->
```text
page_media_view            # the only follower/non-follower split: is_from_followers
```

<!-- fields: x/media-analytics source: https://docs.x.com/x-api/media/get-media-analytics -->
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
```

<!-- fields: x/post-analytics source: https://docs.x.com/x-api/posts/get-post-analytics -->
```text
bookmarks
user_profile_clicks
url_clicks
shares
quote_tweets
impressions
follows
unfollows
```

<!-- fields: x/media-object source: https://docs.x.com/x-api/fundamentals/data-dictionary -->
```text
playback_0_count           # non_public_metrics and organic_metrics
playback_25_count
playback_50_count
playback_75_count
playback_100_count
view_count                 # public_metrics and organic_metrics - NOT non_public_metrics
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
instagram               video_views                         -> views                 removed from IG media insights in Graph v21.0; FILM-1723 pinned every Meta call past it
instagram|meta|facebook video_duration                      -> (none)                IG Media has no duration field (checked 2026-09-21); record the uploaded file's duration instead
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
| X rotates the refresh token on every refresh | Widely reported; the OAuth 2.0 pages, the OAuth FAQ and the OAuth API reference say nothing either way (read 2026-09-23). `refreshXToken` is correct whether or not it holds | inferred |
| ~~The Instagram aggregate-metric names~~ | **Resolved 2026-09-21.** The changelog documents both: `*_count` fields on the Media node, short names as insights metrics | **documented** |
| ~~`facebook_views` exists at all~~ | **Resolved 2026-09-21.** A media insights metric, Feed/Reels/Story, per the changelog | **documented** |
| A token missing a scope gets 403 `insufficientPermissions`, "Request had insufficient authentication scopes." from the Analytics and Reporting APIs | Google's auth layer's usual wording; the YouTube Data errors page words its `insufficientPermissions` message differently. `isScopeMissingError` matches either. The sandbox (FILM-1802) serves this wording | inferred |
| A revenue metric asked without `yt-analytics-monetary.readonly` gets 403 `Forbidden` | Documented that revenue needs the scope; the error's exact shape is not. The sandbox serves 403 `forbidden` | inferred |
| Account insights accept `since`/`until` with `metric_type=total_value` | The reference neither states nor forbids it; `getAccountInsights` relies on it | inferred |
| Instagram watch-time fields are in milliseconds | Community consensus; the reference states no unit | inferred |
| Facebook `post_video_avg_time_watched` denominator is initial plays | Business Help Center; the API reference does not state it | inferred |
| Instagram media insights ≈ 2 years, account ≈ 90 days | Two Meta pages disagree; this reconciles them | inferred |
| TikTok app review takes 1–2 weeks | Third-party integrator reports, not TikTok | inferred |
| Meta App Review takes 4–8 weeks | Community reports; **Meta publishes no SLA** | inferred |
| ~~Graph v18.0 is past end-of-life~~ | **Resolved 2026-09-21.** Meta's changelog gives the expiry as 2026-01-26, and the versioning guide documents silent substitution. See [Graph API versions](#graph-api-versions) | **documented** |

_Verified: 2026-09-21_

---

## Open questions

Genuinely undocumented. **No one may fill these with a guess.** Each names the spec
that owns it. **None yet names a person** — assigning people is a staffing decision
this document cannot make.

| Question | How to settle it | Owner |
|---|---|---|
| Whether X rotates refresh tokens, and their lifetime | One refresh of a real X connection, reading whether `refresh_token` in the response differs from the one sent | **FILM-1725** Check E (with FILM-1729) |
| The `/2/media/analytics` historical window and rate limit | One call with a pay-per-use token, `start_time` beyond 30 days | **FILM-1725** (deferred; gates FILM-1727's Enterprise tier) |
| Whether `/2/media/analytics` is callable below Enterprise | The same call. A 403 settles it; a 200 falsifies the comparison table | **FILM-1725** (deferred; gates FILM-1727's Enterprise tier) |
| X Enterprise pricing, and any per-call analytics price | Ask X sales, in writing, for the Enterprise price and any per-call analytics price | FILM-1727 |
| Meta App Review and Business Verification timelines | Submit the app and record the elapsed time | FILM-1711 |
| How Meta's `total_cputime` is computed | Ask Meta developer support how the BUC `total_cputime` figure is derived | FILM-1720 |
| Any path to raising Instagram BUC quotas | Ask Meta developer support whether the `4800 × impressions` budget can be raised | FILM-1712 |
| The denominator of Facebook's `total_video_avg_time_watched` | Ask Meta developer support whether replays count in the denominator | FILM-1720 |
| Facebook's `post_video_retention_graph` segment count | One authorised call against a real Reel, counting the returned segments | FILM-1720 |
| Whether our pinned Graph version returns the 2026-04-22 Instagram fields in practice | The changelog says "applies to all versions"; one call once insights permission is held confirms it | **FILM-1725** Check C |
| The TikTok Display API field list, confirmed live | A sandbox app with `video.list` granted to a test user — see below | **FILM-1725** (deferred; fold into FILM-1711) |

### Reproducible checks

Two of the three checks FILM-1721 §11 named can be run without production
credentials. The third cannot: X has no sandbox, Free/Basic/Pro closed to new
signups on 2026-02-06, and the question *is* whether a non-Enterprise token works.

The two that have not run are tracked in
[FILM-1725](../specs/phase-17-analytics-provenance/FILM-1725-deferred-vendor-verifications.yaml),
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
  a platform announces a deprecation. A section's date records its last **verification**, not its last edit; an edit that does not re-verify says so inline (as TikTok's does) and leaves the date. Update the date in the same commit as
  the re-verification, never separately.

_Verified: 2026-09-21_
