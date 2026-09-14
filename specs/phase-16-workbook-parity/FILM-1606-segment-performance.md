---
spec_id: FILM-1606
title: Segment Performance
status: ✅ DONE
effort: L
dependencies: FILM-1603, FILM-1605
---

# Segment Performance

## 1. Overview

The workbook's Segment Performance sheet asks one question — *which kinds
of video work?* — and the platform answers a narrower and quietly wrong
version of it.

`queryMedianByTag` (`queries-advanced.ts:749`) returns median and mean views
per taxonomy tag. Three things are wrong with it as the answer to that
question.

**It compares videos of different ages.** The inner aggregate is
`sum(views) ... GROUP BY video_id` over all of `video_daily_stats`, with no
age bound at all. A two-year-old video and a two-week-old one land in the
same median. Every other view in this phase was fixed to control for age —
FILM-1603 built `viewsAtAge`, FILM-1604 moved cohorts onto per-checkpoint
maturity — and this one was left as a lifetime sum. A tag applied mostly to
older uploads wins on nothing but time.

**It drops zero-view videos.** The join at `:773-778` is an `INNER JOIN`
from an aggregate of `video_daily_stats` to the tag list. A published video
with no ingested metric rows is absent from that aggregate, so it is absent
from the median. This is the same failure mode as FILM-1601's bug #7 and
FILM-1604's LEFT-JOIN fix, surviving in a third place: a tag whose videos
mostly flopped reports the median of its survivors.

**It only knows tags.** Language is not a `content_tags` dimension and must
not be forced into one. `video_dim.language` exists (migration 005) and
`buildDimConditions` already filters on it; so do `content_type` and, since
FILM-1602, `connection_id`. The sheet wants all four. Bolting six more
columns onto a tag-shaped query would leave language permanently
unanswerable.

This spec replaces it with one segment-shaped query covering tag, language,
content type and channel, bounded to a checkpoint age, joined from the
dimension side, and carrying the sample-size honesty the workbook's own
guidance asks for.

## 2. Conventions Fixed Here

- **A segment is measured at a checkpoint, not over a lifetime.** Default
  `checkpointDays = 30`. Only videos that have actually reached that age
  count, using `computeMaturity` from `lib/video-age.ts:58` — the same
  function FILM-1603 and FILM-1604 use, so the three views cannot disagree
  about what "@30d" means. **This changes every number the tag card shows
  today, and that is the point.**
- **Videos whose checkpoint window closed before their channel's ingest
  began are excluded from that checkpoint**, not counted as zero. A video
  with no data and a video with no views are different facts; FILM-1604 §2
  settled this and this spec must not re-litigate it. The count is returned
  as `predatesIngestCount`.

  Expressed **in SQL**, as `age_days >= N AND ingest_lag_days < N`, matching
  `queryCohortMedians` (`queries-advanced.ts:586`, `:594`). The TypeScript
  `checkpointPredatesIngest` (`video-age.ts:122`) is *not* called by any
  query — it has no production caller at all — and `computeMaturity` is
  called only by `queryVideoViewsAtAge` (`:1069`), which post-processes rows
  already fetched. An earlier draft of this spec implied both were shared
  call sites. Both forms must agree; nothing enforces that but review.
- **Videos with no metric rows but a live ingest window count as zero.**
  LEFT JOIN from `dimSubquery`, never INNER from the metrics side.
- **A video may belong to several segments of one kind.** Tags are
  `arrayJoin`ed, so a video with four topic tags contributes to four
  medians. Segment shares therefore do **not** sum to the video count, and
  nothing in the UI may present them as a partition. Language, content type
  and channel are single-valued and do partition — the difference is a
  property of the segment kind and must be surfaced as one.
- **Sample size is disclosed, not enforced.** `confidence` is
  `insufficient` (n < 5), `directional` (n < 15) or `reportable` (n ≥ 15),
  computed on `matureVideoCount`, not `videoCount`. A hard gate hides the
  only information a new channel has; an undisclosed number invites a
  decision on two videos' luck.
- **RPM is pooled** — Σrevenue / Σviews × 1000 — never a mean of per-video
  RPMs, which tiny-view videos dominate. Field `rpmCents`, labelled
  "RPM (pooled)".

## 3. Where Revenue Comes From, and What It Omits

The obvious implementation joins `video_metrics.revenue_cents` inside the
segment query and is worth stating explicitly so nobody tries it: **that
column is written as literal `0` by every ingest path** —
`report-ingest.ts:387`, `ingest.ts:135`, `analytics-sync-cron.ts:687`. A
ClickHouse-only RPM would be exactly zero for every segment, forever, with
no error.

Real revenue lives only in Postgres `revenue_records`. That forces a
cross-store composition, and it forces a disclosure:

- **Publish-attributed revenue only.** Rows are joined by `publish_id`.
- **Channel-level rows are excluded.** `revenue_records` permits
  `publish_id is null` with an `account_id` instead
  (`revenue_records_scope_check`, `schemas/38-revenue-tracking.sql`) — the
  channel-level sponsorship and product feature FILM-1508 added and
  FILM-1601 rescued. Such a row belongs to a channel, not to any video, so
  it cannot be attributed to a tag or a language. Silently dropping it
  would understate every segment's RPM against a total the user can see
  elsewhere.
- Every result therefore carries `attributedRevenueOnly: true`,
  `channelLevelRevenueCents` and `unattributedRevenueCents`, so the UI can
  state the gap rather than let the user find it. **Every cent streamed in
  lands in exactly one of the three buckets** — a segment, channel-level,
  or unattributed — and an earlier implementation silently dropped the
  third, so revenue from another project under the same account, or from a
  video excluded as immature, vanished from every total.

### The revenue window is per video, and is derived rather than asked for

An earlier draft left the window unspecified and the first implementation
took `revenueFrom`/`revenueTo` from the caller. **That produced an RPM
wrong by an arbitrary factor**, and the defect is worth stating because it
looks right: the denominator, `totalViews`, is each video's views in its
*first `checkpointDays` of life*, summed over every eligible video ever
published — while the numerator was revenue over a calendar window. A
channel with three years of uploads asking for last month's revenue got
last month's earnings over three years of first-30-day views.

**`rpmCents` therefore means: cents earned per thousand views, both
measured over each video's own first `checkpointDays`.** Each revenue row
is admitted only when its `record_date` falls in `[published_at,
published_at + checkpointDays)` — the same half-open `< N` convention the
phase uses everywhere. Revenue outside that span is real but unattributable
to this figure, and is counted in `unattributedRevenueCents`.

The fetch window is computed from the membership (earliest window start to
latest window end) rather than supplied, so the two halves of the rate
cannot be given different spans by a caller.

### A partial membership suppresses the rate entirely

Membership paging is bounded. If the bound is hit, `rpmCents` is omitted
from every row rather than computed from what was read: a rate understated
by an unknown amount reads as a finding about the content. The distribution
figures are unaffected and still render.

Reads use `forEachAccountRevenueRow` (`server/revenue-queries.ts:41`),
already paged and already split across the two PostgREST query shapes
because the API cannot `OR` across an embedded resource (`:36-40`). Do not
add a third query shape here; do not collect the stream into an array on a
yearly window — the doc comment at `:145-150` says why.

## 4. Implementation Map

| File | Change |
|------|--------|
| `packages/clickhouse/src/queries-advanced.ts` | New `querySegmentPerformance({scope, segment: {kind: 'tag' \| 'language' \| 'content_type' \| 'connection', dimension?}, minVideos, checkpointDays})` → `SegmentPerformanceRow[]`. One SQL body, one `GROUP BY` expression selected by `kind` from a closed lookup — `arrayJoin(tags)` for `tag`, the bare `d.language` / `d.content_type` / `d.connection_id` otherwise. That single difference is the whole reason to generalise rather than extend `queryMedianByTag`. |
| ↑ | Returns `segment, videoCount, matureVideoCount, predatesIngestCount, medianViews, meanViews, p25Views, p75Views, minViews, maxViews, spread, medianWatchTimeSeconds, meanCtr, totalViews`. `spread = maxViews / medianViews`, guarded so a zero median yields `null` rather than `Infinity` — the same suppression discipline `computeCohortGrowth` applies to a zero baseline. |
| ↑ | `meanCtr` is **impression-weighted** — `sum(impressions_ctr * impressions) / sum(impressions)` — from a `video_reach_daily FINAL` leg keyed the same way `queryQualityMetricsForVideos` (`queries-detail.ts:297-301`) does it. An unweighted `avg(impressions_ctr)` lets a 12-impression day outvote a 100,000-impression one. **An earlier draft of this line said view-weighted**, contradicting both its own rationale (which is an argument about impressions) and the precedent it cited (which divides `ctr_weighted` by `impressions`, and weights only AVD by views). Impressions are CTR's denominator; views arrive from surfaces that never produced an impression at all. Absent rather than zero where a segment has no impressions, matching `rpmCents`. |
| `packages/clickhouse/src/queries-advanced.ts` | New `querySegmentMembership({scope, segment, checkpointDays, limit, offset})` → `{segment, videoId, views}`. Needed only because revenue lives in the other store; returning `groupArray(video_id)` from the main query instead would put an unbounded array in one cell and blow memory on a large segment. Paged, with the same whitelisted-ordering treatment as `VIDEO_AGE_ORDER_COLUMNS` (`:854`). |
| `packages/clickhouse/src/queries-advanced.ts` | `queryMedianByTag` kept as a **deprecated wrapper** over `querySegmentPerformance({kind: 'tag'})`, so nothing fails to compile mid-change — then its one caller is migrated in the same PR and the wrapper deleted. Leaving the wrapper behind is how two definitions of "tag median" end up shipped. |
| `packages/clickhouse/src/lib/segment-stats.ts` | New, pure. `resolveConfidence(matureVideoCount)`, `pooledRpmCents(revenueCents, views)`, `interpretSpread(spread)` (< 2.0 consistent, > 4.0 one video carrying it — the workbook's own thresholds). No I/O, so it is fully testable while ClickHouse is disabled. |
| `packages/features/content-analytics/src/server/taxonomy-actions.ts` | `getMedianByTagAction` (`:267`) re-pointed at the new query. Keeps its existing gates: the `count_tagged_publishes` RPC against `TAGGED_LIBRARY_THRESHOLD = 30` (counting **publishes**, not assignments — FILM-1601's bug #8) and `analytics_settings.tag_min_sample ?? 5` (`:276`). |
| `packages/features/content-analytics/src/server/segment-actions.ts` | New `getSegmentPerformanceAction`. `assertScopeAccess(scope)` first. Composes: the aggregate query, then — only when `includeRevenue` — `querySegmentMembership` plus `forEachAccountRevenueRow`, pooling per segment and returning `excludedRevenueCents`. The membership pass is skipped entirely when revenue is not requested, so the common render costs one query. |
| `packages/features/content-analytics/src/components/taxonomy/tag-medians-card.tsx` | `TagMedianEntry` (`:9-14`) gains `matureVideoCount`, `confidence`, `spread` and optional `rpmCents`. A `directional` row renders dimmed rather than hidden; an `insufficient` row renders with its n. Mounting the card is FILM-1611. |
| `packages/clickhouse/scripts/verify-queries.ts` | Add both new queries — the only check that ClickHouse accepts the `arrayJoin` + LEFT JOIN + reach-leg shape at all. |

## 5. Why Not a Pure-TypeScript Fold Over `queryVideoViewsAtAge`

FILM-1603 already returns per-video rows carrying `connectionId`,
`contentType`, `language`, `viewsAtAge`, `matureAt` and `ingestLagDays`, so
three of the four segment kinds could be folded in TypeScript with no new
SQL, and would be trivially unit-testable. It is the tempting design and it
is rejected for two reasons:

1. **`VideoAgeRow` carries no `tags`** (`queries-advanced.ts:820-837`).
   Tags are the primary segment kind, so the fold would cover three kinds
   and need SQL for the fourth — two implementations of one concept, which
   is the situation this spec exists to end.
2. **It is bounded by the Video Log's page size**, `limit` 1–500
   (`video-log-actions.ts`). A median over the first 500 videos of an
   account is not the median, and nothing in the result would say so.

The pure module is therefore the *statistics* (`lib/segment-stats.ts`), not
the aggregation — the same line FILM-1604 drew between `queryCohortMedians`
and `lib/cohort-growth.ts`.

## 6. Bounding

The aggregate result is bounded by segment cardinality: tags and languages
are small, and `connection` is bounded by the account's channels. No
pagination needed, and `HAVING video_count >= minVideos` trims the tail.

The **scan** is bounded by `dimSubquery` plus the checkpoint predicate. The
membership query is the one unbounded-by-nature result and is explicitly
paged.

`kind` and `bucket` reach SQL by lookup from closed unions, never by
interpolating caller text; `dimension` is a bound parameter used as a
`LIKE` prefix exactly as `queryMedianByTag` does at `:764`.

## 7. Out of Scope

- **Mounting `TagMediansCard` and the dimension switcher** — FILM-1611.
- **Segment revenue including channel-level rows** — impossible by
  construction; see §3.
- **A `segment` filter on other deep-dive views** — `ScopeSchema` already
  carries `contentType` and `language`; exposing them in the UI is
  FILM-1611.
- **Per-video RPM** — dominated by tiny-view videos; the pooled figure is
  the locked decision.

## 8. Acceptance Criteria

- [x] `querySegmentPerformance` supports all four segment kinds through one SQL body
- [x] Language segments are grouped by `video_dim.language`, not by a taxonomy tag
- [x] Figures are bounded to `checkpointDays`, not lifetime
- [x] Only videos that have reached the checkpoint are counted
- [x] Videos whose checkpoint predates their channel's ingest are excluded and reported as `predatesIngestCount`
- [x] Videos with no metric rows count as zero rather than vanishing
- [x] `spread` is `null`, not `Infinity`, when the median is zero
- [x] `meanCtr` is impression-weighted
- [x] `confidence` is derived from `matureVideoCount`, not `videoCount`
- [x] A `directional` segment renders dimmed with its n, and is not hidden
- [x] `rpmCents` is pooled, and is absent rather than zero when revenue was not requested
- [x] Channel-level revenue is excluded from `rpmCents` and reported as `channelLevelRevenueCents`
- [x] Revenue is bounded to each video's own checkpoint window, so the rate's numerator and denominator cover the same span
- [x] Every streamed cent lands in a segment, `channelLevelRevenueCents` or `unattributedRevenueCents` — none is dropped
- [x] A truncated membership suppresses `rpmCents` rather than understating it
- [x] `minVideos` gates on `matureVideoCount`, so a segment with nothing measurable is trimmed rather than rendered as zero
- [x] A `tag` segment with no `dimension` returns every tag rather than silently none
- [x] One `asOf` is resolved per request and passed to every query
- [x] `attributedRevenueOnly` is surfaced wherever `rpmCents` renders
- [x] Revenue is read through `forEachAccountRevenueRow` and is never collected whole for a long window
- [x] `getMedianByTagAction` returns the new shape and keeps both existing sample gates
- [x] `queryMedianByTag` is deleted, not left as a permanent wrapper — with `TagMedianRow`, which had no other producer
- [x] `kind` and `dimension` cannot inject SQL
- [x] `getSegmentPerformanceAction` calls `assertScopeAccess` before either query
- [x] `getMedianByTagAction` calls `assertScopeAccess`, which it never did — ClickHouse is outside Postgres RLS and that path took `accountId`/`projectId` as unverified user input

## 9. Verification

```bash
pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
pnpm typecheck && pnpm lint
```

The confidence tiers, spread interpretation, pooled-RPM arithmetic and the
generated SQL text are testable now. The figures are not:
`CLICKHOUSE_ENABLED=false`, so the card renders as no segments. A green
suite proves the shape, not a number.

`pnpm --filter @kit/clickhouse verify` against a live instance is the only
proof ClickHouse accepts the query — and this spec's SQL is the most
complex in the phase, combining `arrayJoin`, a LEFT JOIN from the dim side
and a `video_reach_daily` leg.

Note this **changes numbers already on screen** once the card is mounted:
lifetime becomes @30d, flops re-enter the median, and pre-ingest videos
leave it. Figures are not comparable to anything recorded earlier.

## 10. Known limitation

`dimSubquery` groups by `video_id` alone, so a video present in two
projects within one account collapses to a single row with `argMax`-picked
attributes — FILM-1604 §7 recorded this and it applies identically here,
with one addition: for `kind: 'connection'` the arbitrarily-picked
`connection_id` becomes the grouping key itself. If cross-project or
cross-channel duplicates are real for this product, the dim grouping key
needs revisiting as its own ticket, and this spec's channel segments are
the view most exposed to it.
