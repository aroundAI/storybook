---
spec_id: FILM-1607
title: Absolute Subscriber Snapshots
status: Draft
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

Two absolute figures exist, both in `platform_connections.metadata`, both
captured once at connect time and never refreshed:

```
apps/web/app/api/platforms/youtube/save-channel/route.ts:108   subscriber_count
apps/web/app/api/platforms/callback/youtube/route.ts:230       subscriber_count
apps/web/app/api/platforms/callback/meta/route.ts:253          followers_count
```

`subscriber_count` is read nowhere at all — a grep across `packages/` and
`apps/web/` returns those two writes and no reads.

`followers_count` is worse than unread: it is read under **the wrong
name**. `connection-actions.ts:89` and `:320` both look up
`metadata.follower_count` — *singular* — and surface it as `followerCount`,
which flows through `publish-hub.tsx:75` to the badge at
`platform-selector.tsx:249-251`. Nothing in the repo writes the singular
form outside test fixtures, so that badge resolves `undefined` for every
real connection and its `!= null && > 0` guard silently hides it. This is a
live pre-existing defect, not something this spec introduces; see §7 for
how it is handled.

Both fields are values captured once, at a date nobody records, then left
to rot.

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
- **The snapshot date is the UTC date of the run.** No platform returns a
  reporting date alongside a current follower count — §4's three sources
  are all undated present-tense values — so there is no reporting date to
  prefer and the date can only come from the run clock. Take it in UTC, and
  schedule the job well clear of midnight (02:00 UTC) so an ordinary retry
  cannot straddle the boundary and land two rows on two dates for what is
  one reading. An earlier draft of this spec required "the platform's
  reporting date, not the run date", which no source in §4 can satisfy.

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
one-per-day idempotence above **at read time, via `FINAL`** — not for free.
ClickHouse collapses duplicates only when it merges parts, on its own
schedule, so a `SELECT` issued straight after a second insert for the same
day returns two rows. Every reader of a `ReplacingMergeTree` in this
package already compensates the same way — `video_reach_daily FINAL`
(`queries-detail.ts:260`), `video_traffic_sources FINAL` (`:359`,
`queries-advanced.ts:422`), `channel_daily FINAL` (`:726`), and
`video_metrics FINAL` in the `video_daily_stats` view — and
`querySubscriberSeries` must do likewise.

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
| `packages/clickhouse/src/migrations/008_channel_subscribers.ts` **and `run.ts`** | New table per §3. `run.ts` does not scan the directory — it carries a hand-maintained import list and `MIGRATIONS` array — so add `import { migration as m008 } from './008_channel_subscribers'` and append `m008`. A file added without both edits is silently never applied: `migrate` reports success and the table does not exist. Slot `008` is free. Additive; no backfill, and none is possible. |
| `packages/clickhouse/src/queries-advanced.ts` | `querySubscriberSeries({ scope, from, to })` → one row per connection per day, `subscriberCount`, `isRounded`, and `source: 'snapshot' \| 'interpolated'`. Reads `FROM channel_subscribers FINAL` per §3. |
| `packages/clickhouse/src/lib/subscriber-series.ts` | Pure: `reconstructSeries(anchors, deltas, range)` applies gained/lost between anchors and re-levels at each one. No I/O, so it is unit-tested without an instance — the same split as `video-age.ts` in FILM-1603. |
| `packages/features/content-analytics/src/server/subscriber-snapshot.ts` | `captureSubscriberSnapshots()`: for each active connection, fetch current count via the existing provider method, insert one row. Per-connection failures are logged and skipped, never fatal to the batch. |
| `apps/web/app/api/cron/subscriber-snapshot/route.ts` | `enhanceRouteHandler` with **`{ auth: false }` plus an explicit `authHeader !== \`Bearer ${process.env.CRON_SECRET}\`` check returning 401**, matching `api/cron/refresh-tokens`. `enhanceRouteHandler` defaults to `auth: true` (`packages/next/src/routes/index.ts:98`), which would make `requireUser` fail for a session-less cron caller and return a redirect — the capture would silently never run, and §1 explains why a missed day is unrecoverable. `{ auth: false }` alone would leave the endpoint anonymously callable. |
| `apps/web/lambda/subscriber-snapshot/index.ts` | Thin EventBridge handler mirroring `apps/web/lambda/token-refresh/index.ts`: reads `API_URL` and `CRON_SECRET`, calls `GET /api/cron/subscriber-snapshot` with `Authorization: Bearer ${CRON_SECRET}`, returns the JSON result. Every `sst.aws.Cron` in this repo points `job.handler` at a file under `apps/web/lambda/`, so the Cron entry below cannot be written without it. |
| `sst.config.ts` | `sst.aws.Cron` with `job.handler: 'apps/web/lambda/subscriber-snapshot/index.handler'`, a daily `schedule`, and the `API_URL` / `CRON_SECRET` environment — the shape of `analyticsSyncCron` (`sst.config.ts:1276`). FILM-1503 records that a route without a Cron entry never runs in deployed infra; this spec does not repeat that mistake. |
| `apps/web/app/api/platforms/youtube/**/route.ts` | Stop writing `metadata.subscriber_count` at connect (two routes), so the series in §3 is the single definition of the YouTube level. **`metadata.followers_count` stays** — see §7; retiring it here would re-break the badge §7 asks to repair. |

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
- **Repairing the Publish Hub follower badge**, which reads
  `metadata.follower_count` while the only writer sets `followers_count`
  (§1). It is tempting to fold this in, since re-pointing that badge at the
  new series is what "one definition of the level" means. It is excluded
  deliberately: the series does not exist until ClickHouse is provisioned
  and this cron has run for a day, so making a broken badge depend on it
  keeps it broken for longer than fixing the field name does. Fix the name
  in its own change now; re-point it at `querySubscriberSeries` in
  FILM-1611 when there is a series to point at.

  **`metadata.followers_count` therefore keeps being written at connect
  until FILM-1611 lands.** Unlike `subscriber_count`, which has no reader at
  all, `followers_count` is one character away from being live — retiring it
  as part of this spec would restore the exact defect this bullet asks you
  to fix, and leave the badge dark from that change until FILM-1611, which
  is itself unspecified.
- **Alerting on subscriber movement.** Revenue alerts exist (FILM-1613);
  extending that machinery is a separate decision.

## 8. Acceptance Criteria

- [ ] `channel_subscribers` is created by a migration, registered in `run.ts`'s `MIGRATIONS` array, and applied cleanly from scratch
- [ ] A second capture on the same day collapses to one row when read with `FINAL`
- [ ] `querySubscriberSeries` reads `FROM channel_subscribers FINAL`
- [ ] The cron route returns 401 without a valid `Bearer ${CRON_SECRET}` header, and succeeds with one
- [ ] `apps/web/lambda/subscriber-snapshot/index.ts` exists and the `sst.aws.Cron` entry resolves to its handler
- [ ] `is_rounded` is 1 for YouTube channels above 1,000 subscribers and 0 for TikTok and Instagram
- [ ] `captureSubscriberSnapshots` skips a failing connection and still records the others
- [ ] The connection list is paged, not read unbounded
- [ ] `reconstructSeries` re-levels at every anchor and interpolates with exact deltas between them
- [ ] `reconstructSeries` marks each returned day `snapshot` or `interpolated`
- [ ] A day with an anchor never reports an interpolated value
- [ ] `querySubscriberSeries` returns per-connection rows and never sums across channels
- [ ] `metadata.subscriber_count` is no longer written at connect
- [ ] `metadata.followers_count` is still written at connect, and the badge that reads it still resolves

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

That assertion must read with `FINAL`, or issue `OPTIMIZE TABLE
channel_subscribers FINAL` before asserting. Merges happen on ClickHouse's
schedule, so an assertion that simply counts rows after a second insert
passes or fails according to timing — a flaky test dressed as a
correctness proof, which is the opposite of what this job is for.

Note that a green suite does **not** demonstrate the series is being
collected — nothing is collected until ClickHouse is provisioned and the
cron is deployed. The first real check is that a snapshot row exists for
each active connection the day after cutover.
