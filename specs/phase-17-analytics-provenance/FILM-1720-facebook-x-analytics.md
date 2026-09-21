---
spec_id: FILM-1720
title: Facebook and X Analytics
status: DRAFT
effort: XL
dependencies: FILM-1711, FILM-1714, FILM-1721, FILM-1723
---

# Facebook and X Analytics

> **Rewritten 2026-09-14.** The first draft said X's API tier "may make video
> analytics commercially non-viable" and left it there. Research showed the
> capability plainly exists, that there are **two tiers** of it, and that the
> decisive unknown is not the price but the historical window.

> **The Facebook inventory here is a floor.** Re-checked 2026-09-21 against the
> live `video_insights` reference: the edge exposes **57 video metrics, 11 Reels
> metrics and 4 ad-break metrics**. What the short list omitted includes
> organic/paid splits, `total_video_views_autoplayed` vs
> `..._clicked_to_play`, sound-on views, 10s/30s/60s thresholds,
> `total_video_view_time_by_age_bucket_and_gender` (demographics weighted by
> watch time), and a **revenue** surface —
> `total_video_ad_break_earnings`, `..._ad_cpm`, `..._ad_impressions`,
> `creator_monetization_qualified_views`, queryable by Page admins only.
>
> Two consequences. Facebook's half of this spec is larger and more valuable
> than it was scoped as. And **FILM-1714's "no Monetisation stage" decision
> should be revisited** — it rests on `video_metrics.revenue_cents` being
> literal zero on all four write paths, which is a fact about our writers, not
> about the platforms.
>
> **§4 below is right and this note was briefly wrong**: `post_video_retention_graph`
> names no segment count. The 40 intervals belong to `total_video_retention_graph`.
> That open question stays open.
>
> The Monetisation decision lives in the phase `README.md:215`, not in FILM-1714
> — corrected here, since this spec is where it is challenged. It is re-argued
> in **FILM-1726**.
>
> See [docs/platform-capability-reference.md](../../docs/platform-capability-reference.md).

## 1. Where the two platforms actually stand

| Layer | Facebook | X |
|---|---|---|
| Publishing provider | exists (FILM-704) | exists (FILM-714) |
| Analytics provider | **none** | **none** |
| Analytics API | `/{video-id}/video_insights` | `/2/media/analytics` (Enterprise) or `media.non_public_metrics` (pay-per-use) |
| OAuth | `read_insights` + ANALYZE task — **not requested** | `tweet.read` — ordinary, not requested |
| Commercial | included | **Enterprise-gated** for the full path |
| `AnalyticsPlatform` | **no** | **no** |
| ClickHouse enum | **no** | **no** |

A Facebook or X connection can be created, can publish, and can carry revenue
rows in Postgres — and can never produce an analytics row.

Worse: `dim-sync.ts` has no platform filter and `video_dim.platform` is an
unconstrained `LowCardinality(String)`, so Facebook publishes **do** get
dimension rows that can never have metrics, appearing as zero-view videos in
any dim-driven denominator.

## 2. X has two capability tiers, and we ship the lower one

This is the decision this spec exists to record.

### Enterprise — `GET /2/media/analytics`

`video_views`, `playback_start`, `playback25`, `playback50`, `playback75`,
`playback_complete`, **`watch_time_ms`**, `cta_url_clicks`, `cta_watch_clicks`,
`play_from_tap`, `timestamped_metrics`. Up to 100 media keys,
`hourly | daily | total`.

`GET /2/tweets/analytics` adds `bookmarks`, `user_profile_clicks`,
`url_clicks`, `shares`, `quote_tweets`, `impressions`, and — uniquely among
these five platforms — **`follows` and `unfollows` attributed to a post**.

Gated to Enterprise per an explicit comparison table on X's Enterprise
introduction. **Pricing is unpublished.**

### Pay-per-use — `media.non_public_metrics`

Via the ordinary posts lookup: `playback_0_count`, `playback_25_count`,
`playback_50_count`, `playback_75_count`, `playback_100_count`, `view_count`.

**Note the two quartile vocabularies differ** — `playback25` versus
`playback_25_count`. Mixing them is a silent bug.

No watch time, no CTA clicks, no time series, and a hard 30-day wall.

### What ships

**The degraded path, with the Enterprise fields declared and dark.** Quartiles
plus views give X a real Attention stage — enough to be useful — and the
capability matrix records exactly what Enterprise would add, so the gap is
visible rather than forgotten.

In FILM-1703's axes: capability `native`, access `authorised` once the ordinary
scope is added, availability **`metered`** for the degraded path and
**`tier_gated`** for the full one.

## 3. The decisive unknown is the window, not the price

`media.non_public_metrics` is documented: *non-public, organic and promoted
metrics are only available for posts created within the last 30 days*, gated on
the post's **creation date**.

**The historical window on `/2/media/analytics` is undocumented.** Not on the
endpoint reference, the media introduction, or the metrics page. The legacy
enterprise Engagement API allowed 365 days with 4-week spans — a prior, not a
fact.

This decides whether X can ever be benchmarked past 30 days (FILM-1715 §5), and
it matters more than the price because no amount of money fixes a 30-day
ceiling. **Ask X sales in writing before any X work is scheduled.** Until
answered it is `availability: 'unknown'` with a named owner, per FILM-1703.

One cheap empirical check first: the endpoints live in the standard
`docs.x.com/x-api/` namespace and their own pages state no tier requirement, so
the docs are internally inconsistent. **One call with a pay-per-use token
settles the gate.**

Also constraining: **user context is required** — no app-only path — so X data
is only ever available for accounts that authorised us.

## 4. Facebook's metrics are real, and its denominators are not ours

`GET /{video-id}/video_insights`, Pages only, 2 years of retention, requiring a
Page token from someone with the **`ANALYZE`** task. Meta's own two doc pages
disagree on the permission (`pages_manage_engagement` + `read_insights` versus
`pages_read_engagement`); request all three.

Facebook has things no other platform here offers: a real **retention graph**
(`post_video_retention_graph` — note its segment count is **undocumented**; the
40-equal-intervals figure belongs to `total_video_retention_graph`, the video
metric, per FILM-1721 §8), an explicit **replay count**
(`fb_reels_replay_count`), and **follows attributed to a reel**
(`post_video_followers`).

**And four more things, added 2026-09-21 after re-reading the live reference.**
The list above was drawn from an eight-metric summary; the edge carries 57 video
metrics, 11 Reels metrics and 4 ad-break metrics. What that omitted is not
filler:

- **Organic/paid splits on most view metrics.** No other platform here offers
  this — TikTok's `video_views` explicitly *cannot* be separated. It is the only
  place in the product where "did this do well, or was it boosted" is answerable
  from the platform rather than inferred.
- **`total_video_views_autoplayed` vs `total_video_views_clicked_to_play`.** An
  intent distinction, and a better Hook signal than anything YouTube exposes —
  particularly now that YouTube's own `views` folds autoplay in and stops
  distinguishing them.
- **`total_video_view_time_by_age_bucket_and_gender`** — demographics weighted
  by watch time rather than by view count. FILM-1703 models the `demographics`
  family as counts; this does not fit that shape and needs a decision.
- **A revenue surface**: `total_video_ad_break_earnings`,
  `total_video_ad_break_ad_cpm`, `total_video_ad_break_ad_impressions`,
  `creator_monetization_qualified_views`. Page admins only. This is what puts
  the "no Monetisation stage" decision back in play — **FILM-1726**.

**Effort.** This spec is `XL` for reasons that predate the correction (an enum
widening across eight tables, two providers that do not exist). The Facebook
half is now larger still, and the sensible response is to **split it**: a
Facebook leg that can ship, and an X leg blocked behind FILM-1725 Check A.

### Four denominators, none of them a YouTube view

1. **Impression** — entered the screen, no playback, **estimated**
2. **Play** (`blue_reels_play_count`) — **≥1 millisecond**, replays excluded
3. **3-second view** (`total_video_views`) — ≥3s **or** nearly full length if
   shorter
4. **ThruPlay** — **an Ads metric.** Not on `video_insights` at all

`total_video_15s_views` is **not** ThruPlay. ThruPlay is "completed or ≥15s,
whichever first"; the organic metric has no completion clause, so a short video
that completes under 15s counts for one and not the other. **Do not label it
ThruPlay.**

### The non-equivalence that will bite

**`post_video_avg_time_watched` can exceed the video's own duration.** Replay
time is in the numerator (documented); the denominator is initial plays, which
exclude replays (per Meta's Business Help Center — the API reference does not
state it, so this half is inferred).

YouTube's average view duration cannot do this. Compute our own average
explicitly and label the denominator rather than shipping Meta's precomputed
figure as comparable.

Not available: **follower vs non-follower reach** for video or Reels. Only the
page-level `page_media_view` carries `is_from_followers`.

## 5. Settle the vocabulary before touching the enum

Postgres stores `'twitter'`. The product says X. `oauth_states` also permits
`'meta'`.

Pick one vocabulary **first**. The ClickHouse enum is the expensive thing to
change twice, and a rename afterwards is a second seven-table migration.

## 6. The enum migration

`platform` is `Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3)` in **seven**
analytics tables — `001_create_tables.ts:17`, `002_metrics_v2.ts:27` and `:48`,
`003_reach_and_traffic.ts:22` and `:35`, `004_extended_metrics.ts:27` and
`:37`. No migration has ever extended it.

The other three tables need different treatment, not the same migration:
`video_dim.platform` is an unconstrained `LowCardinality(String)` (§1), and
`channel_daily` and `channel_subscribers` carry **no platform column at all**.

Widening means an `ALTER TABLE … MODIFY COLUMN` on each, plus
`AnalyticsPlatform` (`clickhouse/src/types.ts:11`) and `SyncPlatform`. **Values
must be appended** — renumbering rewrites every row. `QueryFilters.platforms` is
typed as `Array(Enum(...))` at the parameter level, so a widened enum must be
reflected there or a valid selection errors at the server.

## 7. This is the test of FILM-1714's expandability

X binds its stages to conversation metrics where TikTok binds them to watch
behaviour — X is not primarily a video recommender, and `follows` per post is a
better Audience signal than anything the others expose. Facebook binds to its
own four denominators.

If adding these two platforms requires changing anything **other than** the
enum, the type unions, the capability matrix and the signal map, then
FILM-1714's design did not work. That is the finding, and it is verified by the
diff rather than by a test.

## 8. Out of scope

- Snap, Threads, LinkedIn. The framework should make them additive; this spec
  does not add them.
- Buying X Enterprise or pursuing Meta Advanced Access — commercial decisions
  this spec surfaces.
- Changing how the existing three platforms are analysed.

## 9. Acceptance criteria

- [ ] The platform vocabulary is settled and consistent before the migration runs
- [ ] The enum is widened by appending values, never renumbering
- [ ] All seven enum-bearing tables, `AnalyticsPlatform`, `SyncPlatform` and `QueryFilters` accept the new platforms, and the three without the enum are handled explicitly rather than assumed
- [ ] `dim-sync` no longer creates dimension rows for platforms that cannot have metrics
- [ ] X ships on the pay-per-use path, with Enterprise-only fields declared and dark
- [ ] The two X quartile vocabularies are never mixed
- [ ] X's 30-day wall is expressed as a `DataWindow` anchored on publish date
- [ ] The `/2/media/analytics` window is recorded as `unknown` with a named owner until X answers in writing
- [ ] Facebook's organic/paid split is preserved, not summed away
- [ ] `total_video_views_autoplayed` and `total_video_views_clicked_to_play` are distinguishable, and neither is labelled simply "views"
- [ ] Facebook's ad-break revenue metrics are either ingested or recorded as deliberately out of scope with a reason
- [ ] Facebook's four denominators are distinguishable, and `total_video_15s_views` is never labelled ThruPlay
- [ ] `post_video_avg_time_watched` is not presented as comparable to YouTube's average view duration
- [ ] Facebook's absence of follower/non-follower reach is recorded, not worked around
- [ ] Adding both platforms required **no change to any signal-map consumer**
- [ ] Both fail the structural tests until their capability entries and stage bindings are written

## 10. Verification

```bash
pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
./scripts/local-env.sh verify
pnpm turbo typecheck --force && pnpm lint
```

The enum migration must be verified against a table **with rows**, not an empty
one: insert under the old enum, migrate, assert existing rows still read and
new values are accepted.

Two live checks that can falsify this spec cheaply, both before implementation:

1. `/2/media/analytics` with a pay-per-use token — settles the Enterprise gate
2. A Facebook `video_insights` call with `read_insights` — settles the
   permission ambiguity between Meta's two doc pages

And one that must be answered by a human: X sales, in writing, on the media
analytics historical window.

## 11. Risk

**The enum migration touches every analytics table.** Metadata-only if values
are appended, a full rewrite if anything is renumbered. §5's vocabulary
decision determines which.

**X's window may make benchmarking impossible there**, regardless of spend. If
the answer is 30 days, X supports exactly one checkpoint and its signal map
should say so rather than implying a comparison it cannot make.

**Facebook publishes already pollute `video_dim`** as zero-view rows. That
distorts denominators today and is arguably worth pulling forward if the enum
work is deferred.
