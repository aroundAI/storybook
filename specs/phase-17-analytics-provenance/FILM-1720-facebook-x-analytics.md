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
(`post_video_retention_graph`, 40 equal intervals), an explicit **replay count**
(`fb_reels_replay_count`), and **follows attributed to a reel**
(`post_video_followers`).

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
change twice, and a rename afterwards is a second eight-table migration.

## 6. The enum migration

`platform` is `Enum8('youtube'=1,'tiktok'=2,'instagram'=3)` in **all eight**
analytics tables. No migration has ever extended it.

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
- [ ] All eight tables, `AnalyticsPlatform`, `SyncPlatform` and `QueryFilters` accept the new platforms
- [ ] `dim-sync` no longer creates dimension rows for platforms that cannot have metrics
- [ ] X ships on the pay-per-use path, with Enterprise-only fields declared and dark
- [ ] The two X quartile vocabularies are never mixed
- [ ] X's 30-day wall is expressed as a `DataWindow` anchored on publish date
- [ ] The `/2/media/analytics` window is recorded as `unknown` with a named owner until X answers in writing
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
