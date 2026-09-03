---
spec_id: FILM-1607
title: Absolute Subscriber Snapshots
status: 📝 SPEC
effort: M
dependencies: FILM-1602
---

# Absolute Subscriber Snapshots

## 1. Overview

The workbook tracks subscribers as a **level** — "how many do we have, and
how is that curve shaped" — and every subscriber number this codebase holds
is a **delta**. `video_metrics` and `channel_daily` carry
`subscribers_gained` and `subscribers_lost` (FILM-1506, split gross in
migration `006`), which describe movement and nothing else. Deltas give the
shape of a curve but never its height: without an anchor the series can be
drawn only relative to an unknown starting point.

There is exactly one absolute figure in the system, and it is inert:

```
apps/web/app/api/platforms/youtube/save-channel/route.ts:108
apps/web/app/api/platforms/callback/youtube/route.ts:230
  metadata: { subscriber_count: … }
```

Both write `subscriber_count` into `platform_connections.metadata` at
connect time. Nothing anywhere reads it, and nothing ever refreshes it — a
grep for the field across `packages/` and `apps/web/` returns those two
writes and no reads. It is a value captured once, at a date nobody records,
and then left to rot.

This spec makes the level a first-class, dated series.

**This one is time-sensitive in a way the rest of Phase 16 is not.** Every
other outstanding item computes from data already being collected, so
building it later costs only time. Subscriber history cannot be
back-obtained from any API on any platform: the Data API returns *current*
only, and the Analytics API returns *gained/lost* only. The series
therefore begins on the day snapshots first run, and every day before that
is permanently absent. It should ship **before** the ClickHouse cutover
(FILM-1503), not after, so the series starts the moment there is somewhere
to write it.

## 2. Conventions Fixed Here

- **A snapshot is per connection, not per project.** A project spans
  channels (phase README, locked decisions), and subscribers are a property
  of a channel. Summing channels into a project total is a presentation
  choice made at read time, never a stored figure.
- **One snapshot per connection per day, last write wins.** The capture is
  idempotent so a retried or double-scheduled run cannot create two
  conflicting levels for a day.
- **Anchor plus deltas, and the anchor wins.** Where a stored snapshot and
  a delta-derived figure disagree for the same date, the snapshot is
  authoritative. Deltas interpolate *between* anchors; they never override
  one.
- **The snapshot date is the platform's reporting date, not the run date.**
  A job that runs at 02:00 UTC records the figure for the day it describes,
  so a shifted or retried schedule does not shift the series.

## 3. Schema

A new ClickHouse table, not a column on `channel_daily`. `channel_daily` is
the **residual** of videos that failed to match a publish (phase README) —
rows exist only where there was unmatched activity, so a channel with every
video matched would have no row to carry its subscriber level. The two
tables answer different questions and must not share a row.

```sql
CREATE TABLE IF NOT EXISTS channel_subscribers (
  connection_id UUID,
  snapshot_date Date,
  subscriber_count UInt64,
  is_rounded UInt8,            -- 1 when the platform returned a rounded figure
  inserted_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (connection_id, snapshot_date)
```

`ReplacingMergeTree` ordered by `(connection_id, snapshot_date)` gives the
one-per-day idempotence above for free, and matches `channel_daily` and
`video_metrics` so the table needs no special handling in the migration
runner.

`is_rounded` is stored rather than inferred, because whether a figure is
rounded is a property of the platform and tier at capture time, and a
consumer must be able to label a number as approximate without knowing the
rules of five APIs.

## 4. Platform Reality

| Platform | Source | Exact? |
|----------|--------|--------|
| YouTube | Data API `channels.list` → `statistics.subscriberCount`, already implemented at `youtube-provider.ts:170` | **No.** Rounded to three significant figures above 1,000 since the 2019 public-count change. Applies to the channel owner too; the Analytics API exposes no absolute metric to work around it. |
| TikTok | `user/info/?fields=follower_count`, already implemented at `tiktok-analytics.ts:232` | Yes |
| Instagram | `?fields=followers_count`, already implemented at `instagram-insights.ts:313` | Yes |

All three fetches already exist. This spec schedules them and persists the
result; it adds no new API surface.

The YouTube rounding is the reason `is_rounded` exists and the reason the
anchor-plus-delta model is worth building rather than storing the snapshot
alone. Between two anchors the exact `subscribersGained/Lost` series is
available, so a daily curve can be reconstructed at full resolution and
re-levelled whenever an anchor moves. A channel under 1,000 subscribers
gets exact anchors and needs no reconstruction.

## 5. Implementation Map

| File | Change |
|------|--------|
| `packages/clickhouse/src/migrations/008_channel_subscribers.ts` | New table per §3. Additive; no backfill, and none is possible. |
| `packages/clickhouse/src/queries-advanced.ts` | `querySubscriberSeries({ scope, from, to })` → one row per connection per day, `subscriberCount`, `isRounded`, and `source: 'snapshot' \| 'interpolated'`. |
| `packages/clickhouse/src/lib/subscriber-series.ts` | Pure: `reconstructSeries(anchors, deltas, range)` applies gained/lost between anchors and re-levels at each one. No I/O, so it is unit-tested without an instance — the same split as `video-age.ts` in FILM-1603. |
| `packages/features/content-analytics/src/server/subscriber-snapshot.ts` | `captureSubscriberSnapshots()`: for each active connection, fetch current count via the existing provider method, insert one row. Per-connection failures are logged and skipped, never fatal to the batch. |
| `apps/web/app/api/cron/subscriber-snapshot/route.ts` | `enhanceRouteHandler`, invoked daily. |
| `sst.config.ts` | `sst.aws.Cron` entry. FILM-1503 records that a route without one never runs in deployed infra; this spec does not repeat that mistake. |
| `apps/web/app/api/platforms/**/route.ts` | Stop writing the dead `metadata.subscriber_count` at connect, or write it through the same path so there is one definition of the level. |

## 6. Bounding

One row per connection per day: an account with 20 channels and three years
of history reaches ~22,000 rows, which is nothing. The read is bounded by
`from`/`to` and by scope; no pagination is required.

The capture loop is bounded by the connection count, and each connection
costs a single API call — well inside every quota in play. It must page the
connection list through `fetchAllRows` (FILM-1612) rather than assume it
fits in one PostgREST response.

## 7. Out of Scope

- **Backfilling history.** Impossible; see §1 and the phase README.
- **Subscriber attribution per video.** `video_metrics.subscribers_gained`
  already carries that and is unaffected.
- **Presenting the series.** The card and its wiring belong with the other
  UI work in FILM-1611.
- **Alerting on subscriber movement.** Revenue alerts exist (FILM-1613);
  extending that machinery is a separate decision.

## 8. Acceptance Criteria

- [ ] `channel_subscribers` is created by a migration and the runner applies it cleanly from scratch
- [ ] A second capture on the same day replaces the first rather than adding a row
- [ ] `is_rounded` is 1 for YouTube channels above 1,000 subscribers and 0 for TikTok and Instagram
- [ ] `captureSubscriberSnapshots` skips a failing connection and still records the others
- [ ] The connection list is paged, not read unbounded
- [ ] `reconstructSeries` re-levels at every anchor and interpolates with exact deltas between them
- [ ] `reconstructSeries` marks each returned day `snapshot` or `interpolated`
- [ ] A day with an anchor never reports an interpolated value
- [ ] `querySubscriberSeries` returns per-connection rows and never sums across channels
- [ ] The cron has an `sst.aws.Cron` entry, verified in the synthesised stack
- [ ] `metadata.subscriber_count` is no longer written as a dead field

## 9. Verification

```bash
pnpm --filter @kit/clickhouse test          # pure helpers
pnpm --filter @kit/clickhouse verify        # real ClickHouse, via the CI job
pnpm --filter @kit/content-analytics test
pnpm typecheck && pnpm lint
```

`verify-queries.ts` gains a case for `querySubscriberSeries` and an
assertion that a same-day re-insert collapses to one row, so the
`ReplacingMergeTree` behaviour this spec depends on is proven against a
real server rather than assumed. That job (`🗄️ ClickHouse SQL`) exists as
of PR #237.

Note that a green suite does **not** demonstrate the series is being
collected — nothing is collected until ClickHouse is provisioned and the
cron is deployed. The first real check is that a snapshot row exists for
each active connection the day after cutover.
