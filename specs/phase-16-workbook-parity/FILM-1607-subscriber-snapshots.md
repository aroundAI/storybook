---
spec_id: FILM-1607
title: Absolute Subscriber Snapshots
status: Draft
effort: M
dependencies: FILM-1602, FILM-1612
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
- **An exact anchor wins; a rounded anchor only constrains.** Where an
  **exact** snapshot (`rounding_step = 0`) disagrees with a delta-derived
  figure for the same date, the snapshot is authoritative and sets the
  level outright.

  A **rounded** anchor (`rounding_step > 0`) is not a point — it is the
  band `[count - step/2, count + step/2)` of true values that round to it. Treating it as a point is what an
  earlier draft of this bullet said, and it destroys the feature: §4
  establishes that YouTube rounds to three significant figures above 1,000,
  so a 1.23M-subscriber channel returns exactly `1230000` every day for
  weeks and then steps by 10,000. Re-levelling to that each day discards
  the exact `subscribersGained/Lost` deltas and renders a flat staircase —
  precisely the curve the anchor-plus-delta model exists to avoid.

  The rule for a rounded anchor is therefore: if the delta-derived level
  for that date already falls inside the band, keep the delta-derived value
  — it is the finer measurement. Only when it falls outside does the anchor
  bite, clamping to the nearest edge of the band, because the deltas have
  then drifted further than the platform's own figure permits.
- **An unavailable count is not a zero — skip the day, write no row.**
  Because the rule above makes an anchor authoritative, a spurious `0` does
  not merely add one bad point: it re-levels the whole reconstructed curve
  to zero from that date, overriding correct deltas on both sides, and §1
  means that day can never be recaptured. A missing anchor is recoverable
  by interpolation; a false one is permanent.

  **All three providers currently collapse absent into zero**, and none of
  them can be used as they stand:

  | Provider | Coercion |
  |---|---|
  | `youtube-provider.ts:170` | `parseInt(channel.statistics?.subscriberCount ?? '0', 10)` — YouTube omits the field entirely for a channel with `hiddenSubscriberCount`, and for any response where `statistics` did not come back |
  | `tiktok-analytics.ts:254` | `data.data?.user?.follower_count ?? 0` — the field is optional in the response type |
  | `instagram-insights.ts:359` | `accountData.followers_count ?? 0` — likewise |

  The two non-YouTube cases are the **more** dangerous, not the less:
  §5 stores them with `rounding_step = 0`, which the rule above treats as
  exact and lets set the level outright. A TikTok 200 carrying
  `{data:{user:{}}}` after a scope change would write an exact zero anchor
  and flatten the series from that day on. Absent must be distinguished
  from zero at each provider boundary; today none of the three does.
- **Deltas are the composed channel total, not `channel_daily`.**
  `channel_daily` carries `subscribers_gained`/`subscribers_lost` and is
  keyed by `connection_id`, which makes it the tempting single source — but
  it is the residual of videos that failed to match a publish (§3), so
  alone it sees only the unmatched slice of subscriber movement. The curve
  would then drift under every anchor gap, and drift *silently*: anchors
  re-level it at each snapshot, so it looks right everywhere except between
  anchors, which is the only region the reconstruction exists to fill. Per
  the phase README's composition rule, the delta series is
  `Σ video_metrics + channel_daily`, UNIONed and never joined per video.
  `video_metrics` has no `connection_id` — migration `007` put it on
  `video_dim` — so the per-connection figure needs `video_metrics` joined
  to `video_dim FINAL`, UNIONed with `channel_daily FINAL`.
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
  rounding_step UInt32,        -- 0 when exact; otherwise the platform's granularity
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
`querySubscriberAnchors` must do likewise.

`rounding_step` is a granularity, not a boolean, and it is stored rather
than inferred. An earlier draft stored `is_rounded UInt8`, which is enough
to *label* a number approximate but not enough to *use* it: §2's band rule
needs the width of the band, and a row carrying only "yes, rounded" leaves
the reader to rederive YouTube's three-significant-figure rule from the
magnitude — so two implementers reading identical rows produce different
curves, disagreeing on whether `1230000` admits ±500 or ±5,000.

Storing the step fixes the band arithmetic in one place, at capture, where
the platform and the magnitude are both known: the band is
`[count - step/2, count + step/2)`, and `step = 0` means exact. It also
subsumes the boolean — `rounding_step > 0` is `is_rounded` — so there is
one column and one definition rather than two that can disagree.

## 4. Platform Reality

| Platform | Source | Exact? |
|----------|--------|--------|
| YouTube | Data API `channels.list` → `statistics.subscriberCount`, already implemented at `youtube-provider.ts:170` | **No.** Rounded to three significant figures above 1,000 since the 2019 public-count change. Applies to the channel owner too; the Analytics API exposes no absolute metric to work around it. |
| TikTok | `user/info/?fields=follower_count`, already implemented at `tiktok-analytics.ts:232` | Yes |
| Instagram | `?fields=followers_count`, already implemented at `instagram-insights.ts:313` | Yes |

All three requests already exist, and this spec adds no new API *surface* —
but only two are callable as they stand. YouTube's `getChannel()` and
TikTok's `getAccountAnalytics()` return the figure directly. Instagram's
does not: line 313 is one leg of a `Promise.all` inside
`getAccountInsights`, whose `/insights` request is checked first and throws
before the follower count is read — and non-business accounts cannot call
`/insights` at all. A standalone accessor has to be extracted (§5). No new
endpoint, but a refactor.

The YouTube rounding is the reason `rounding_step` exists and the reason the
anchor-plus-delta model is worth building rather than storing the snapshot
alone. Between two anchors the exact `subscribersGained/Lost` series is
available, so a daily curve can be reconstructed at full resolution and
corrected against each anchor under the band rule in §2. A channel under
1,000 subscribers gets exact anchors and needs no reconstruction.

## 5. Implementation Map

| File | Change |
|------|--------|
| `packages/clickhouse/src/migrations/008_channel_subscribers.ts` **and `run.ts`** | New table per §3. `run.ts` does not scan the directory — it carries a hand-maintained import list and `MIGRATIONS` array — so add `import { migration as m008 } from './008_channel_subscribers'` and append `m008`. A file added without both edits is silently never applied: `migrate` reports success and the table does not exist. Slot `008` is free. Additive; no backfill, and none is possible. |
| `packages/clickhouse/src/queries-advanced.ts` | `querySubscriberAnchors({ connectionIds, from, to })` → the stored rows: one per connection per day, `subscriberCount`, `roundingStep`. Reads `FROM channel_subscribers FINAL` per §3. **Not a `DimScope`**: `assertDimScope` (`queries-advanced.ts:118`) requires `projectId` or `accountId` and `buildDimConditions` emits `project_id`/`account_id` predicates, but `channel_subscribers` has only `connection_id`. Passing a scope would either throw or, worse, filter on nothing and return every tenant's rows. The repo's precedent for a connection-keyed table is `queryChannelWatchWindow` (`:714`), which takes `connectionIds: string[]` resolved in Postgres; follow it. |
| `packages/clickhouse/src/lib/subscriber-series.ts` | Pure: `reconstructSeries(anchors, deltas, range)` applies gained/lost between anchors and corrects against each one under §2's band rule. Each returned day carries `source`, which needs **four** states, not two: `snapshot` (an exact anchor set it), `interpolated` (no anchor; deltas alone), `constrained` (a rounded anchor existed and the delta-derived value already sat inside its band, so the deltas stand), and `clamped` (a rounded anchor existed and the value was pinned to the nearer band edge). A two-state enum cannot describe a band-satisfied day without either misreporting it as the snapshot's value or denying an anchor was present. No I/O, so it is unit-tested without an instance — the same split as `video-age.ts` in FILM-1603. |
| `packages/features/content-analytics/src/server/subscriber-snapshot.ts` | `captureSubscriberSnapshots()`: for each active connection **whose platform appears in §4** — `youtube`, `tiktok`, `instagram` — fetch the current count and insert one row, setting `rounding_step` at capture: `0` for TikTok and Instagram, `0` for a YouTube channel under 1,000 (§4 — the API is exact below that), and otherwise YouTube's three-significant-figure granularity for the returned magnitude (`1,000` at six digits, `10,000` at seven, and so on). `platform_connections.platform` also permits `facebook`, `twitter` and `linkedin` (`schemas/32-platform-connections.sql:23`), all three created by callback routes today and none with a subscriber source; scoping the query excludes them rather than throwing on each one daily and forever, which would be indistinguishable in the logs from a real outage. A connection whose count cannot be read is skipped without writing a row, per §2. Per-connection failures are logged and skipped, never fatal to the batch. Tokens come from `access_token_encrypted` via the same decrypt path the analytics sync uses; a connection whose token has expired is refreshed if `refresh-tokens` has not already done so, and skipped if refresh fails — an expired token must not become an indefinite silent gap. **The batch returns its attempted and written counts, and a run that writes zero rows, or materially fewer than the active-connection count, is an alert rather than a log line** — see §2's note on permanence and the failure modes in §7. |
| `packages/features/content-analytics/src/providers/instagram/instagram-insights.ts` | Extract `getFollowerCount()` — the `?fields=followers_count` request at line 313 on its own. It is currently one leg of a `Promise.all` inside `getAccountInsights`, whose `impressions,reach,profile_views,website_clicks` request is checked first and throws before the follower count is read, so an account that cannot call `/insights` at all loses a snapshot it could have had. `getAccountInsights` calls the new method so the request is not duplicated. |
| `packages/clickhouse/src/queries-advanced.ts` | `querySubscriberDeltas({ connectionIds, from, to })` → per-connection daily `subscribers_gained`/`subscribers_lost`. See §2 for why this cannot be `channel_daily` alone. Also `connectionIds`, not a scope, and for a sharper reason: its `video_metrics × video_dim` leg *could* be account-scoped while its `channel_daily` leg cannot, so a `DimScope` would silently scope one side of the UNION and not the other. |
| `packages/features/content-analytics/src/server/subscriber-series-actions.ts` | `getSubscriberSeriesAction({ accountSlug, from, to })`: resolves the account's connection ids in Postgres, calls `querySubscriberAnchors` and `querySubscriberDeltas` with them, and composes both through `reconstructSeries` into the filled daily series. **This is the only thing that returns a complete curve** — the two queries return raw anchors and raw deltas, and `reconstructSeries` is pure. Without this row nothing in the map joins the three, and FILM-1611 would go looking for a filled series and find none. |
| `apps/web/app/api/cron/subscriber-snapshot/route.ts` | `enhanceRouteHandler` with **`{ auth: false }` plus an explicit `authHeader !== \`Bearer ${process.env.CRON_SECRET}\`` check returning 401**, matching `api/cron/refresh-tokens`. `enhanceRouteHandler` defaults to `auth: true` (`packages/next/src/routes/index.ts:98`), which would make `requireUser` fail for a session-less cron caller and return a redirect — the capture would silently never run, and §1 explains why a missed day is unrecoverable. `{ auth: false }` alone would leave the endpoint anonymously callable. |
| `apps/web/lambda/subscriber-snapshot/index.ts` | Thin EventBridge handler mirroring `apps/web/lambda/token-refresh/index.ts`: reads `API_URL` and `CRON_SECRET`, calls `GET /api/cron/subscriber-snapshot` with `Authorization: Bearer ${CRON_SECRET}`, returns the JSON result. Every `sst.aws.Cron` in this repo points `job.handler` at a file under `apps/web/lambda/`, so the Cron entry below cannot be written without it. |
| `sst.config.ts` | `sst.aws.Cron` with `job.handler: 'apps/web/lambda/subscriber-snapshot/index.handler'` and the `API_URL` / `CRON_SECRET` environment — the shape of `analyticsSyncCron` (`sst.config.ts:1276`). **`schedule: 'cron(0 2 * * ? *)'`, not `rate(1 day)`.** Every existing cron in this file uses `rate(…)`, which fires relative to deploy time and shifts on every redeploy; a copied `rate(1 day)` can settle minutes from midnight UTC and reintroduce the split §2 sets 02:00 to avoid. FILM-1503 records that a route without a Cron entry never runs in deployed infra; this spec does not repeat that mistake. |
| `apps/web/app/api/platforms/youtube/save-channel/route.ts:108` **and** `apps/web/app/api/platforms/callback/youtube/route.ts:230` | Stop writing `metadata.subscriber_count` at connect, so the series in §3 is the single definition of the YouTube level. Both paths are named because they do not share a parent: the callback route sits under `platforms/callback/youtube/`, not `platforms/youtube/`, and a glob written for the latter silently misses it. **`metadata.followers_count` stays** — see §7; retiring it here would re-break the badge §7 asks to repair. |
| `packages/features/publishing/src/providers/youtube/youtube-provider.ts:170` and `types.ts:48` | Distinguish absent from zero, per §2. `parseInt(channel.statistics?.subscriberCount ?? '0', 10)` collapses a hidden or missing count into `0`; the field must become nullable (`subscriberCount: number \| null` on `YouTubeChannel`) so the capture can skip the day instead of anchoring the curve to zero forever. |
| `packages/features/content-analytics/src/providers/tiktok/tiktok-analytics.ts:254` and `.../instagram/instagram-insights.ts:359` | The same `?? 0` collapse, and per §2 the more dangerous one, since these anchors are stored exact. Both must return `null` for an absent count. Existing callers that want a number keep their own `?? 0` at the call site, where a zero is a display default rather than an authoritative anchor. |

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
  in its own change now; re-point it at `getSubscriberSeriesAction` in
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
- [ ] `querySubscriberAnchors` reads `FROM channel_subscribers FINAL`
- [ ] The cron route returns 401 without a valid `Bearer ${CRON_SECRET}` header, and succeeds with one
- [ ] `apps/web/lambda/subscriber-snapshot/index.ts` exists and the `sst.aws.Cron` entry resolves to its handler
- [ ] `rounding_step` is 0 for TikTok, Instagram, and YouTube channels under 1,000, and the three-significant-figure granularity for larger YouTube channels
- [ ] A TikTok or Instagram response with the follower field absent is skipped, not written as an exact `0` anchor
- [ ] The cron schedule is a fixed `cron(0 2 * * ? *)`, not a drifting `rate()`
- [ ] A run that writes zero rows, or materially fewer than the active-connection count, raises an alert
- [ ] A connection with an expired token is refreshed or skipped, and never silently omitted on every subsequent run
- [ ] `captureSubscriberSnapshots` skips a failing connection and still records the others
- [ ] A YouTube channel with a hidden subscriber count is skipped, not recorded as `0`
- [ ] Connections on platforms with no §4 source (`facebook`, `twitter`, `linkedin`) are excluded by the query, not attempted and failed
- [ ] An Instagram snapshot succeeds for an account whose `/insights` call would fail
- [ ] `reconstructSeries` is fed deltas composed from `video_metrics` joined to `video_dim` plus `channel_daily`, not `channel_daily` alone
- [ ] The connection list is paged, not read unbounded
- [ ] `reconstructSeries` re-levels outright at an exact anchor and interpolates with exact deltas between anchors
- [ ] A rounded anchor leaves the delta-derived level untouched when it already falls inside the rounding band, and clamps to the nearest edge only when it falls outside
- [ ] A channel whose rounded anchor is unchanged for many consecutive days still produces a daily-varying curve, not a staircase
- [ ] `reconstructSeries` marks each returned day `snapshot` or `interpolated`
- [ ] A day with an exact anchor reports `snapshot`; a day with a rounded anchor reports `constrained` or `clamped`, never `interpolated`
- [ ] `querySubscriberAnchors` returns per-connection rows and never sums across channels
- [ ] `metadata.subscriber_count` is no longer written at connect
- [ ] `metadata.followers_count` is still written at connect, unchanged by this spec

## 9. Verification

```bash
pnpm --filter @kit/clickhouse test          # pure helpers
pnpm --filter @kit/clickhouse verify        # real ClickHouse, via the CI job
pnpm --filter @kit/content-analytics test -- --run   # its "test" is bare vitest, i.e. watch
pnpm typecheck && pnpm lint
```

`verify-queries.ts` gains a case for `querySubscriberAnchors` and an
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
