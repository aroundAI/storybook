---
spec_id: FILM-1712
title: Metric Recovery
status: DRAFT
effort: M
dependencies: FILM-1711
---

# Metric Recovery

## 1. Overview

Most of what the growth research asks us to measure is not missing because the
platforms withhold it. It is missing because we do not ask for it, or because
we ask for it and throw it away.

Three kinds of gap, with very different costs:

| Kind | Fix |
|---|---|
| **Not requested**, though declared available in our own types | add to a field list |
| **Requested but dropped** at ingest | a column and a mapping |
| **Genuinely unavailable** | record as a limit; do not promise |

This spec closes the first two. The third is recorded in FILM-1703's capability
matrix as `unsupported`, with a sentence a creator can read.

## 2. Not requested

**TikTok** (`providers/tiktok/tiktok-analytics.ts:121`) asks for exactly:

```
?fields=id,like_count,comment_count,share_count,view_count
```

`TikTokVideoData` (`providers/tiktok/types.ts:126-137`) declares five more:
`save_count`, `average_watch_time`, `total_play_time`,
**`full_video_watched_rate`** and `traffic_source_types`.

`full_video_watched_rate` is TikTok's completion rate. Every one of these is
typed, mapped through ingest, and structurally `0` because it was never
requested — which is worse than absent, because `saves: 0` and
`watch_time_seconds: 0` look like measurements.

**Instagram** (`providers/instagram/instagram-insights.ts:105-123`) requests
`views, reach, total_interactions, likes, comments, saved, shares`. The
declared union (`providers/instagram/types.ts:20-29`) also has `profile_visits`
and `follows`. `follows` is mapped to `subscribers_gained`
(`analytics-sync-cron.ts:780`) and is always `0` for the same reason.

Note `input.metrics` is accepted by the provider's type and **ignored** — only
`mediaId` is destructured at `:77`. Either honour it or remove it.

**YouTube** requests `annotationClickThroughRate` and `cardClickRate` nowhere,
though both sit in `YouTubeMetric` (`providers/youtube/types.ts:32-33`).

## 3. Requested but dropped

**Instagram `reach` is already being returned and discarded.** It is in the
request at `:107`, read at `instagram-insights.ts:139`, and there is no column
for it anywhere in ClickHouse — so it is swept into `extra_metrics` and never
read again. `reach` is the denominator the research recommends for nearly every
Instagram ratio.

**YouTube's totals block is dropped except revenue.** The totals call
(`youtube-analytics.ts:151-165`) *does* request `averageViewPercentage`,
`subscribersLost` and `dislikes`. But `buildYouTubeDailyRows`
(`ingest.ts:115-141`) builds rows from the separate **daily** query
(`:225`), which asks for only:

```
views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,subscribersGained
```

So three columns that exist — `avg_view_percentage`, `subscribers_lost`,
`dislikes` — are filled only by the bulk-report path, which lags one to three
days. Adding them to the daily query gives YouTube completion on the fast path.

## 4. The changes

| Platform | Add to the request | Unlocks |
|---|---|---|
| YouTube | `averageViewPercentage`, `subscribersLost`, `dislikes` on the **daily** query | completion, net subscribers and dislikes without the report lag |
| TikTok | `full_video_watched_rate`, `average_watch_time`, `total_play_time`, `save_count` | completion rate, watch time, saves — TikTok's entire Attention stage |
| Instagram | `follows`, `profile_visits` | follower conversion, profile intent |

Plus new columns for what is returned and has nowhere to land:

| Column | Table | Why |
|---|---|---|
| `reach` | `video_metrics` | Instagram returns it today; it is the denominator for that platform's ratios |
| `completion_rate` | `video_metrics` | TikTok's `full_video_watched_rate`; do not overload `avg_view_percentage`, which means something subtly different |
| `profile_visits` | `video_metrics` | Instagram, and TikTok when it ever returns a non-zero |

`traffic_source_types` is deliberately **not** ingested here. TikTok's traffic
sources are percentage-only with labels (`'For You'`, `'Following'`) that are
structurally incompatible with `VideoTrafficSource`, which requires `views` and
`watch_time_minutes`. It stays `not_ingested` in the matrix with a ticket.

## 5. Stop writing zeros that look like measurements

The rule this spec establishes: **a field we do not have is null or absent, not
zero.** Today `saves: 0` for TikTok, `watch_time_seconds: 0` for Instagram and
`revenue_cents: 0` everywhere are indistinguishable from genuine zeros.

Where a column cannot be made nullable without a migration cost that outweighs
the benefit, the capability matrix carries the fact instead and the UI reads it
from there — but the default must be to represent absence.

## 6. `extra_metrics` is write-only

Worth recording because it changes what "recovery" can mean.
`video_metrics.extra_metrics` holds `JSON.stringify` of the entire provider
response, written at `ingest.ts:139` (YouTube, latest date's row only) and
`analytics-sync-cron.ts:689` (TikTok/Instagram, every snapshot row). **Nothing
reads it** — no `JSONExtract` anywhere in the repo, and the `video_daily_stats`
view enumerates columns and omits it.

So the dropped fields are physically present for rows where it was written.
Since nothing has been published yet there is nothing worth recovering, but the
blob should either gain a reader or stop being written — an unread payload on
every row is storage with no purpose.

## 7. Out of scope

- OAuth scopes — FILM-1711, which gates this spec entirely for TikTok and
  Instagram.
- Facebook and X — FILM-1720.
- Any ratio, signal or benchmark computed from these fields — FILM-1713 onward.
- Ingesting TikTok traffic sources.

## 8. Acceptance criteria

- [ ] Every field declared in a provider's own types is either requested or documented as deliberately not requested
- [ ] A test fails when a type declares a field the request does not ask for
- [ ] TikTok returns and persists completion rate, average watch time and saves
- [ ] Instagram's `reach` reaches a column instead of `extra_metrics`
- [ ] YouTube's daily query returns average view percentage, so completion does not wait on the bulk report
- [ ] No provider maps a never-requested field to a column as zero
- [ ] A metric we do not have is distinguishable from one that is genuinely zero
- [ ] `input.metrics` on the Instagram provider is honoured or removed
- [ ] `extra_metrics` gains a reader or stops being written
- [ ] The capability matrix is updated in the same PR as each newly-ingested field, per FILM-1703's writer-binding test

## 9. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm --filter @kit/clickhouse test
./scripts/local-env.sh verify
pnpm turbo typecheck --force && pnpm lint
```

The declared-vs-requested test in §8 is the one that stops this recurring;
see it fail first by adding a field to a provider type without requesting it.

Everything else needs live connections and therefore FILM-1711. Against a real
account per platform, assert that each newly-requested field returns a non-zero
for a video known to have one — a zero proves nothing, because a zero is what
the bug produced.

## 10. Risk

**The estimate depends on FILM-1711's findings.** If TikTok's analytics scopes
need a higher app tier, or Meta declines `instagram_manage_insights`, this spec
cannot be verified on those platforms regardless of how small the diff is.
Adding a field to a URL is easy; proving it returns data is not.

**A new column that only one writer fills is the failure mode to avoid** — the
same shape as `revenue_cents` being literal zero in all four writers. Each new
column gets one writer and a named absent state, or it becomes another silent
zero.
