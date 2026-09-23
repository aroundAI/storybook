# FILM-1504 — YouTube Reporting API (Bulk Reports): completion EDD

| | |
|---|---|
| Ticket | FILM-1504, status PARTIAL, effort L |
| Spec | `specs/phase-15-deep-analytics/FILM-1504-youtube-reporting-api.yaml` |
| Scope | the spec's `remaining:` list (parser fixtures; channel residual never dropped), plus the unmet acceptance criteria those items imply, plus three defects found while reproducing them (§8.4) |
| Branch / base | `feat/film-1504-reporting-api-completion` from `origin/main` @ `49b851d6` |
| Author | teammate `film-1504`, 2026-09-23 |
| Status | **Plan: awaiting owner approval. No code has been changed.** |

Evidence notation: `file:line` refers to `origin/main` @ `49b851d6`.

---

## 1. Start With the User

**Who.** The owner, and later any creator running a YouTube channel through
Storybook. For now the owner is the only end-to-end user.

**Problem.** The analytics answer two channel-wide questions:

1. **Am I on track for the YouTube Partner Programme?** That means 4,000
   watch hours on the whole channel over a rolling window, not just on the
   videos Storybook published.
2. **Is my channel gaining or losing subscribers, day by day?**

Neither question can be answered from Storybook's own videos alone, because a
channel also holds videos uploaded outside Storybook. The Reporting API
delivers a daily per-video CSV for the whole channel. Storybook stores the
rows it can match to one of its publishes against that publish. It adds the
rest together into one **channel residual** row per channel per day. YPP
watch hours and daily subscriber movement are both *matched videos + residual*.

**What is broken today.** YouTube delivers two different reports that both
feed the residual row for the same channel and day: the core report (views,
watch time, subscribers) and the reach report (thumbnail impressions). Each
report writes a whole row and fills the other report's columns with zeros.
The table keeps only the later row. So whichever report lands second wipes
out the first one's figures. Reach reports usually land after the core
report, so in practice:

- **YPP progress under-reports watch hours** from every video not published
  through Storybook, and nothing on screen shows a gap.
- **Daily subscriber movement from those videos disappears.** This was fixed
  once already (FILM-1618), and this bug quietly undoes that fix whenever a
  reach report lands later.
- **Or the other way round:** impressions for the residual read as zero.

Reproduced on local ClickHouse 24.8 (§8.4, D1). A day with 1,200 residual
views, 36,000 s of watch time and +7/−2 subscribers read back as **0 s, net
0 and 0 views** once the reach report landed.

**What the user gets when this ships:**

- YPP watch-hour progress and daily subscriber movement count every video on
  the channel, whatever order YouTube delivers its reports in.
- Channel-wide thumbnail impressions for videos Storybook did not publish are
  stored in their own place and never overwrite anything else. Nothing
  displays them yet (FILM-1511 will).
- Once ClickHouse is switched on in production, the reports YouTube has
  generated in the meantime are still there to collect. Today they would
  already have been downloaded and thrown away (§8.4, D3).
- No figure that YouTube never reported is presented as a measured zero.
  Reach reports have no `engaged_views` column, but today they are stored as
  if they did, with a value of 0 (§8.4, D2).

**Success.** For any channel and day, the YPP and subscriber figures equal a
hand-computed sum over the fixture CSVs. This holds in both delivery orders
and after a re-delivery.

**Failure** (what the user must never see): a watch-hour or subscriber total
lower than the channel's true total with nothing to indicate it, or an
impressions/CTR figure 100× off.

**What persists:** ClickHouse rows (per video and residual) and the
`youtube_report_jobs` registry with its high-water mark. **What does not
persist:** the downloaded CSVs. They are parsed in memory and dropped.
YouTube keeps daily reports for 60 days and historical-backfill reports for
30 days
([docs](https://developers.google.com/youtube/reporting/v1/reports)).

## 2. Define the Complete User Journey

There is no interactive UI in this ticket. The "user" of the pipeline is the
owner as an operator, plus the dashboards that read what it writes.

| # | User action | System response | User-visible result | Next action |
|---|---|---|---|---|
| J1 | Connects a YouTube channel (existing flow, unchanged) | A `platform_connections` row is created with `is_active = true` | Channel listed | Wait for the cron |
| J2 | Nothing (the cron fires every 6 h, `sst.config.ts:1336`) | Per active YouTube connection: get a valid token, then make sure the four report jobs exist, both on YouTube and in `youtube_report_jobs` | Nothing yet (reports lag about 48 h) | Wait |
| J3 | Nothing (a later run) | List the reports created after the high-water mark, download them, parse them, split rows into matched and residual, write to ClickHouse, then advance the high-water mark | YPP card, subscriber curve and Deep Dive (with ClickHouse enabled) include the new days | Open analytics |
| J4 | Opens the YPP progress card | `getYppProgressAction` sums `video_metrics` (by connection) and `channel_daily` (residual) | Watch hours equal the whole channel's total, in either report order | — |
| J5 | Opens the subscriber curve | `querySubscriberDeltas` unions the per-video and residual legs | Daily net equals the whole channel's net | — |
| J6 | ClickHouse is off (production today) | Jobs are still ensured, so YouTube starts generating history. Nothing is downloaded and the high-water mark does not move | Analytics show their existing "no data" states | FILM-1503 cutover switches ClickHouse on. The next run collects every report still held by YouTube |
| J7 | Disconnects the channel (KB-22's territory) | The `youtube_report_jobs` rows cascade away. The YouTube-side jobs stay. On reconnect `listJobs` finds and reuses them (`report-ingest.ts:199-201`) | Unchanged | — |

Refresh, re-entry and navigating away do not apply: the pipeline is a batch
job. **Interruption:** a run killed partway has saved its high-water mark
after each report (§15). The next run carries on from the first report it did
not save.

## 3. Explicitly Define the Happy Path

Reference scenario, and the fixture used throughout §26. Connection `C`, day
`D`. Video `vidA` matches a publish `P` in project `J`. Video `vidX` matches
nothing.

1. **Cron → route.** EventBridge invokes the lambda. The lambda POSTs to
   `/api/analytics/reports-ingest` with `Authorization: Bearer $CRON_SECRET`
   (`apps/web/lambda/report-ingest/index.ts:38`). The route checks the secret
   and calls `runReportingIngestJob()`.
2. **Connections.** A paged read of active YouTube `platform_connections`
   (`report-ingest.ts:98`) returns `[C]`.
3. **Token.** `ensureValidToken(C)` returns an access token. It does not
   refresh when the token has not expired.
4. **Jobs.** `ensureReportJobs` reads `youtube_report_jobs` for `C`. For any
   missing type it calls `reportTypes.list` and `jobs.list`, reuses or
   creates the job, and upserts the registry row. Result: four rows.
5. **ClickHouse gate (new).** ClickHouse is enabled, so continue. If it were
   disabled, stop here for this connection (J6).
6. **Reports.** `listReports(job, createdAfter = watermark)` returns reports
   sorted by `createTime` ascending (`youtube-reporting.ts:174`).
7. **Download and parse.** `channel_basic_a3` for `D` contains:
   - `vidA`: 2 rows (US/GB), views 100 + 50, watch 10 + 5 min, subscribers
     +2/−0 and +1/−1.
   - `vidX`: 2 rows, views 300 + 100, watch 20.5 + 9.5 min, subscribers
     +3/−1 and +0/−0.

   The parser sums over the non-video dimensions, giving `vidA` = 150 views,
   900 s, +3/−1 and `vidX` = 400 views, 1,800 s, +3/−1.
8. **Match.** `resolvePublishRefs` (chunked and paged,
   `report-ingest.ts:474`) maps `vidA → (P, J)`. `vidX` is unmatched.
9. **Write (basic).** `video_metrics` gets `(J, P, D)`: 150 views, 900 s,
   `metric_source = 'reporting_api'`. `channel_daily` gets `(C, D)`: 400
   views, 1,800 s, +3/−1.
10. **Write (reach).** `channel_reach_combined_a1` for `D` contains:
    - `vidA`: 2 rows (two traffic sources), 2,000 impressions at 0.05 and
      2,000 at 0.03, giving 4,000 impressions at CTR 0.04.
    - `vidX`: 1,000 impressions at 0.04 and 3,000 at 0.06, giving 4,000
      impressions at CTR (40 + 180) / 4,000 = **0.055**.

    `video_reach_daily` gets `(J, P, D)` = 4,000 at 0.04. **New:**
    `channel_reach_daily` gets `(C, D)` = 4,000 at 0.055. `channel_daily` is
    **not touched**.
11. **High-water mark.** After each report, `last_report_created_after` =
    that report's `createTime` (subject to the equal-timestamp rule in §15).
12. **Read.** `queryChannelWatchWindow([C])` = **1,800 s** and the residual
    net subscribers for `D` = **+2**. Both hold whether step 10 ran before
    or after step 9. Today they read 0 when step 10 runs second.

Why this is success: every number above is fixed by the CSVs alone, and
every read-back equals it.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| Header-only CSV (YouTube's "no data that day", [docs](https://developers.google.com/youtube/reporting/v1/reports)) | The parser returns `[]`. No rows written. The high-water mark advances | Nothing for that day | None needed | That day has no rows. It is not written as zeros |
| Empty file (0 bytes) | Same as header-only | Same | Same | Same |
| CSV missing a required column (`date`, `video_id`, or `video_thumbnail_impressions` for reach) | The parser returns `[]` (existing behaviour, `csv-parsers.ts:133,217,267`). **New:** logged as a warning with the report type and the header seen | Nothing | An operator sees the warning. Google has changed the schema | High-water mark advances. Decision needed if this ever fires (§31 Q4) |
| Reach CTR value > 1 in a file (the unit is percent, not ratio; §31 Q1) | **New:** the report is refused and an error is logged. Nothing from that report is written, and the high-water mark stops before it | CTR never shows as 520 % | Owner confirms the unit. Parser is changed. The next run re-downloads | Job keeps retrying that report until fixed (loud, not silent) |
| Duplicate delivery (the same report downloaded twice) | ReplacingMergeTree on the same key. The later `inserted_at` wins | No change | — | Idempotent |
| YouTube regenerates a day (new report, same `startTime`/`endTime`, later `createTime`) | Rows replaced per key. **New:** the residual row is written for every date in the report, even when zero, so a video that became matched since leaves the residual (§15) | Totals reflect the correction | — | Idempotent |
| Reach and basic arrive in either order | Separate tables, so neither clobbers the other | Correct totals | — | — |
| Token refresh fails (KB-29 may make this common) | `ensureValidToken` returns invalid. The connection's error is recorded in `result.errors` and the other connections continue (`report-ingest.ts:138`) | Analytics go stale for that channel | Fixing KB-29 or reconnecting | High-water mark unchanged, so nothing is lost while YouTube keeps the reports (60 days) |
| Scope missing (`yt-analytics.readonly` not granted) | `YouTubeAnalyticsScopeError` is recorded per connection | Stale | Reconnect with the scope | Unchanged |
| Report type not offered to this channel (for example reach not rolled out) | Warn and skip that type (`report-ingest.ts:191`) | No impressions | Picked up automatically on a later run once offered | 3 of 4 jobs |
| Download fails partway through a job | The error propagates to the connection's catch. **New:** the high-water mark was already saved after every completed report | Partial day | The next run resumes after the last saved report | No re-download of completed reports |
| Many reports share one `createTime` (a burst of backfill) and the per-run cap of 20 falls inside that group | **New:** the high-water mark is only moved to a `createTime` once every report carrying it has been processed (§15) | — | The next run gets the rest | None skipped |
| ClickHouse disabled | **New:** jobs ensured, no download, high-water mark untouched, `result.clickhouseEnabled = false` | Analytics "no data" states (unchanged) | Enable ClickHouse | Reports are waiting at YouTube |
| High-water mark already advanced while ClickHouse was off (production, if the cron has run against a live channel) | Cannot be detected from code | — | Runbook: set `last_report_created_after = null` before the first run with ClickHouse on (§25) | Recovers up to 60 days (30 for backfill) |
| Unmatched rows in the traffic-source report | Counted in `rowsUnmatched` and logged per report. Not stored, because `channel_daily` has no `source` column (already documented at `queries-advanced.ts:539`) | Traffic share covers Storybook's own videos only (existing) | — | Unchanged |
| More than 1,000 video ids in a report | `fetchAllByIds` chunks and pages (`report-ingest.ts:484`) | — | — | Correct |
| Concurrent runs (a manual POST during the cron) | Both write the same keys. The later `inserted_at` wins, and the values are identical | — | — | Idempotent. See §15 on high-water-mark races |
| Unauthorised POST | 401 (`route.ts:34`) | — | — | — |

## 5. Establish the User-Facing Contract

- **UI: no change.** No component, page or copy is touched. The YPP card,
  subscriber curve and weekly diagnostics read through their existing
  queries. Only the correctness of what those queries return changes.
- **Route contract** (`POST /api/analytics/reports-ingest`): unchanged
  authentication and status codes. The JSON body gains two fields:
  - `clickhouseEnabled: boolean`
  - `reportsRefused: number`

  Existing fields keep their meaning. The lambda's result type is loose and
  ignores unknown fields, so the lambda needs no change (KB-14 is untouched).
- **Data contract for downstream readers:**
  - `channel_daily` columns carry **only** core-report (`channel_basic_a3`)
    figures. The `impressions` column is removed (Decision 2).
  - New `channel_reach_daily (connection_id, metric_date, impressions,
    impressions_ctr)` holds the reach residual. CTR is impression-weighted
    within the day.
  - `video_reach_daily.engaged_views` is removed (Decision 2). It was never
    reported by the reach reports, so every stored value was a fabricated 0.
    `VideoQualityMetrics.engagedViews` is removed with it. It has no reader
    (§8.4, D2).
  - Absence is not zero: a day with no residual row means "no report yet".
    A residual row of zeros means YouTube reported that day and every video
    matched a publish.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Why | Trigger / input | Processing / output | Success | Verification |
|---|---|---|---|---|---|---|
| FR-1 | Reach-report residual never writes `channel_daily` | D1: it zeroes the core figures | Reach CSV with unmatched rows | Aggregate the residual into `channel_reach_daily` | After basic → reach and reach → basic, `queryChannelWatchWindow` and the residual subscriber net equal the hand-computed values | T2-a (unit, red first), T3 (local stack, red first), T4 (CI verify) |
| FR-2 | The reach residual is kept, never dropped | Criterion 4: "never dropped silently" | Same | `channel_reach_daily` impressions and impression-weighted CTR | Read-back equals 4,000 / 0.055 | T3 |
| FR-3 | A residual row is written for every date present in a report, including all-matched dates (zeros) | Re-delivery after a video becomes matched must not double-count | Report whose rows all match on date D | A zero residual row for `(C, D)` | Re-delivery with `vidX` now matched: residual = 0, `video_metrics` has `vidX` | T2-b, T3 |
| FR-4 | Parsers are covered by fixtures for all five report shapes in the jobs set (`channel_basic_a3`, `channel_combined_a3`, `channel_traffic_source_a3`, `channel_reach_combined_a1`, plus `channel_reach_basic_a1`, which the ingest also accepts), each full, header-only and empty | Remaining item 1, criterion 2 | Fixture CSV files with Google's documented headers | Parsed rows | Each equals the hand-computed expectation | T1 |
| FR-5 | The reach parser does not produce `engagedViews` | D2: the column does not exist in either reach report | Reach CSV | `ReachReportRow` has no such field | Type plus test | T1 (red first: asserts no property) |
| FR-6 | With ClickHouse disabled, jobs are ensured but nothing is downloaded and the high-water mark is not moved | D3: silent loss of reports that cannot be recovered | `CLICKHOUSE_ENABLED != 'true'` | Early return per connection after `ensureReportJobs` | Provider `downloadReport` never called. High-water mark unchanged | T2-c (red first) |
| FR-7 | The high-water mark is saved after each report and never lands in the middle of a group of equal `createTime` values | Resumable runs. No report skipped by a strict `createdAfter` | Report list, per-run cap | `planReportBatch()` returns the batch and the safe high-water mark | 25 reports sharing one `createTime`, cap 20: the high-water mark stays at the previous value and all 25 are processed over two runs (the second run reprocesses the 20, which is idempotent) | T2-d (red first) |
| FR-8 | A reach report with any CTR > 1 is refused | Q1: the unit is not settled by Google's docs. A 100× error is silent otherwise | Reach CSV | Throw `ReachCtrUnitError`. Count in `reportsRefused`. High-water mark stops before it | No rows written | T2-e |
| FR-9 | Matched and unmatched counts are logged per report (report type, report id, dates, matched, unmatched, residual dates) | Criterion 4: "counted + logged" | Every report | One `info` line | Present in the log | T2 (logger spy) |
| FR-10 | Report jobs are registered for every active YouTube connection and not duplicated on the next run | Criterion 1 | Active connection, fake vendor | Four `youtube_report_jobs` rows. The second run creates none | Row count 4, then still 4 | T3 (real Postgres), T5 (production build) |
| FR-11 | New table and writer are registered with the provenance and verify guards | Existing CI guards require it (`data-provenance.test.ts:749-778`, `verify-coverage.test.ts`) | — | `TABLE_WRITERS`, `WRITER_CALL_SITES`, a verify step | Guards green | T6 |

## 7. Define Non-Functional Requirements

- **Correctness over completeness.** No figure is written that YouTube did
  not report (FR-5, FR-8), and absence is kept distinct from zero (§5).
- **Idempotency.** Any report can be ingested any number of times, in any
  order, with an identical final state (ReplacingMergeTree + FR-3).
- **Durability of the vendor window.** No code path advances the high-water
  mark past a report whose rows were not written (FR-6, FR-7, FR-8).
- **Performance.** Unchanged order of cost. One extra insert per reach report
  (into `channel_reach_daily`, at most one row per date). One extra Postgres
  `update` per report for the high-water mark, up to 20 per job per run, so
  at most 80 per connection per run.
- **Lambda budget.** The route runs inside the web function, and the lambda
  timeout is 10 minutes (`sst.config.ts:1339`). No change in network calls.
- **Security.** No new endpoint, secret or scope (§19).
- **Observability.** FR-9 plus the new result fields (§22).
- **Compatibility.** Additive for readers except the two dropped columns,
  each of which has no reader that uses its value (§24).
- **Accessibility / i18n.** Not applicable: no UI.
- **Cost.** Negligible: one small ClickHouse table.

## 8. Analyze the Existing System

### 8.1 Components

| Piece | Where | Notes |
|---|---|---|
| Cron | `sst.config.ts:1336-1358` (`StorybookReportIngestCron`, `rate(6 hours)`) → `apps/web/lambda/report-ingest/index.ts` | Deployed. The lambda only POSTs to the route |
| Route | `apps/web/app/api/analytics/reports-ingest/route.ts` | `CRON_SECRET` bearer. `enhanceRouteHandler({ auth: false })` |
| Job | `packages/features/content-analytics/src/server/reporting/report-ingest.ts` | `runReportingIngestJob`, `ensureReportJobs`, `ingestJobReports`, `ingestReportCsv`, `accumulateChannelDaily`, `resolvePublishRefs` |
| Parsers | `.../reporting/csv-parsers.ts` | Header-driven and pure. Tests at `__tests__/csv-parsers.test.ts` (no fixture files) |
| Provider | `.../providers/youtube/youtube-reporting.ts` | googleapis `youtubereporting v1`. `rootUrl` via `vendorUrl('youtube-reporting')`, which honours a local override only with `NODE_ENV` in {development, test}, `VENDOR_SANDBOX=1` and not running in a Lambda (`packages/shared/src/vendors/resolver.ts:84-89`) |
| Token | `@kit/publishing/token-refresh` `ensureValidToken` | Refreshes only when the token is within the expiry buffer (`token-refresh.ts:141-152`). **KB-29**: the refresh path reads credentials that are no longer written |
| Registry | Postgres `youtube_report_jobs` (`20260827095855_youtube-report-jobs.sql`) | RLS read via the account chain. Service role writes. **No pgTAP test** (not in this ticket's scope; flagged §30) |
| ClickHouse | `003_reach_and_traffic.ts` (`video_reach_daily`, `video_traffic_sources`, `channel_daily`), `006` (+ subscriber columns on `channel_daily`) | All ReplacingMergeTree on `inserted_at DateTime` (second resolution) |
| Writers | `packages/clickhouse/src/queries.ts` `insert*` | Each returns silently when `!isClickHouseEnabled()` (`queries.ts:113`, `client.ts:98-99`) |
| Readers of `channel_daily` | `queryChannelWatchWindow` (`queries-advanced.ts:828-857`) → `getYppProgressAction` (`deep-dive-actions.ts:241`). `querySubscriberDeltas` (`queries-advanced.ts:1824-1905`) | Both use `FINAL` |
| Readers of `video_reach_daily` | `queryQualityMetricsForVideos` (`queries-detail.ts:386-475`, reads `engaged_views` at `:420,:429`), segment query (`queries-advanced.ts:958`), `queries-detail.ts:580` | `engagedViews` is returned but no caller reads it (grep, §8.4 D2) |
| Guards | `packages/clickhouse/__tests__/data-provenance.test.ts` (writer call sites), `verify-coverage.test.ts` (every `insert*`/`query*` has a verify step), CI `verify` job running `scripts/verify-queries.ts` against real ClickHouse | These force the new writer to be registered |

### 8.2 Current flow

This is J2–J3 above. Rows split into matched and residual. The residual from
**both** the basic branch (`report-ingest.ts:403`) and the reach branch
(`:349`) goes through `accumulateChannelDaily`, which seeds every column with
0 (`:438-447`). Both are inserted into `channel_daily` (`:357`, `:417`).

### 8.3 Where the change enters

- `ingestReportCsv`'s reach branch: the residual target changes.
- `ingestJobReports`: high-water-mark planning and saving.
- `runReportingIngestJob`: ClickHouse gate.
- `parseReachReport`: stop reading `engaged_views`.
- `@kit/clickhouse`: new migration, type, writer and verify step. Two columns
  dropped.

### 8.4 Defects reproduced or read while planning

**D1 — residual clobber (remaining item 2). Reproduced.** Scratch database
`film1504_scratch` on the shared local ClickHouse 24.8.14. It is isolated
from the shared schema, so no DB lock was needed, and it was dropped
afterwards. The DDL was copied from `SHOW CREATE TABLE channel_daily`. Two
rows were inserted in the order the code writes them:

1. A basic-shaped row (views 1,200, watch 36,000 s, subscribers +7/−2,
   impressions 0).
2. A reach-shaped row one minute later (impressions 50,000, everything else
   0).

Read through `FINAL` with the readers' predicates:

| figure | expected | read |
|---|---|---|
| `sum(watch_time_seconds)` (YPP leg) | 36,000 | **0** |
| net subscribers | +5 | **0** |
| views | 1,200 | **0** |
| impressions | 50,000 | 50,000 |
| raw rows | 2 | 2 |

**D2 — fabricated `engaged_views` on reach rows. Read, confirmed against
Google's docs.** Google documents these columns:

- `channel_reach_basic_a1`: `date, channel_id, video_id,
  video_thumbnail_impressions, video_thumbnail_impressions_ctr`
- `channel_reach_combined_a1`: the same plus `traffic_source_type,
  traffic_source_detail, operating_system, device_type`

Neither has `engaged_views`
([channel reports](https://developers.google.com/youtube/reporting/v1/reports/channel_reports)).
`parseReachReport` reads `engaged_views` anyway (`csv-parsers.ts:270`), and
`numberAt` returns 0 for a missing column (`:104`). So every
`video_reach_daily.engaged_views` value is a default stored as a measurement,
and `queryQualityMetricsForVideos` returns it as `engagedViews`. No caller
reads that field today (grep over `apps/web` and `packages`, with the parser
and ingest excluded). It is latent, and it is also listed as a reach field in
`data-provenance.ts:545`.

**D3 — reports discarded while ClickHouse is off. Read.** Every `insert*`
returns without writing when `CLICKHOUSE_ENABLED != 'true'` (`queries.ts:113`,
`client.ts:99`). `ingestJobReports` still counts the report as ingested and
advances `last_report_created_after` (`report-ingest.ts:263-273`). Production
runs with ClickHouse disabled (root `CLAUDE.md`) and the cron is deployed
(`sst.config.ts:1336`). Any live connection is therefore having its reports
downloaded and discarded every 6 hours. Once the high-water mark passes them,
YouTube's retention (60 days daily, 30 days backfill) makes them
unrecoverable. The job-creation backfill is the only source of the 30 days
before the job existed. Whether this has already happened in production
cannot be read from here (no production access, by rule). The owner can
check it (§31 Q3).

**D4 — high-water mark inside a group of equal `createTime` values. Read;
vendor behaviour unconfirmed.** The run processes at most 20 reports per job
(`report-ingest.ts:36,250`), then sets the high-water mark to the 20th
report's `createTime`. The next call sends `createdAfter` = that value.
Google describes it as returning reports "created after" the timestamp. If
report 21 shares that `createTime` (plausible for the 30-report backfill
YouTube generates at job creation), it is never listed. Guarding against
this costs about 10 lines (FR-7) and needs no vendor confirmation to be safe.

**D5 — high-water mark not saved on a partial failure. Read.** A download
error on report *k* throws before the single `update` at `:266`. Reports
1…k−1 are re-downloaded next run. Only wasteful (writes are idempotent), and
fixed as a side effect of FR-7.

## 9. Define the Desired System Behavior

| Trigger | Application logic | Service interaction | Data operation | Result |
|---|---|---|---|---|
| Cron POST | `runReportingIngestJob()` | Supabase (admin), token refresh, YouTube Reporting | — | JSON result |
| Per connection | `ensureValidToken` → `ensureReportJobs` | `reportTypes.list`, `jobs.list`, `jobs.create` only when a type is missing | Upsert `youtube_report_jobs` | Four jobs |
| ClickHouse off | Return early after jobs are ensured | — | None | `clickhouseEnabled: false`, `reportsIngested: 0` |
| Per job | `planReportBatch(reports, cap)` → for each report: download → `ingestReportCsv` → save the high-water mark if the plan allows it | `media.download` | Insert into ClickHouse. Update `youtube_report_jobs` | Counts |
| Basic report | Parse → match → `video_metrics` + `channel_daily` (a residual row per date, including zero rows) | — | 2 inserts | — |
| Reach report | Parse → CTR check → match → `video_reach_daily` + `channel_reach_daily` (a residual row per date) | — | 2 inserts | — |
| Traffic report | Parse → match → `video_traffic_sources`. Unmatched rows counted | — | 1 insert | — |
| Combined report | Parsed and counted. Nothing written (unchanged: a cross-check source) | — | None | — |
| YPP / subscriber read | Unchanged queries | ClickHouse | `channel_daily FINAL` now contains core-report figures only | Correct totals |

## 10. High-Level Architecture

The architecture is unchanged: cron → lambda → route → job → {Postgres
registry, YouTube, ClickHouse}. The one structural change is **one
ReplacingMergeTree table per report family at every grain**:

| grain \ family | core (`channel_basic_a3`) | reach (`channel_reach_*_a1`) | traffic |
|---|---|---|---|
| per video | `video_metrics` | `video_reach_daily` | `video_traffic_sources` |
| channel residual | `channel_daily` | **`channel_reach_daily` (new)** | (not stored; no `source` column) |

Why: a ReplacingMergeTree replaces **whole rows** per sort key. Two
independently delivered reports can therefore share a table only if they
never share a key. Migration 003 already made this argument for the
per-video grain (`003_reach_and_traffic.ts:4-8`: *"a partial row would
clobber the full metrics row"*) and then put both families in one residual
table anyway. This change applies 003's own rule at the grain where it was
missed. The alternative (a family column in the sort key) is in §29.

Trust boundaries are unchanged: Vendor → our server, via an OAuth token held
in Postgres. Cron → route, via `CRON_SECRET`. ClickHouse sits outside
Postgres RLS, and every reader already scopes by connection or project.

## 11. Architecture and Flow Diagrams

**Before and after, one channel, one day, reach report landing second:**

```
BEFORE                                   AFTER
basic CSV ──► channel_daily(C,D)          basic CSV ──► channel_daily(C,D)
             {views 400, watch 1800,                   {views 400, watch 1800,
              subs +3/−1, impr 0}                        subs +3/−1}
reach CSV ──► channel_daily(C,D)          reach CSV ──► channel_reach_daily(C,D)
             {views 0, watch 0,                        {impr 4000, ctr 0.055}
              subs 0/0, impr 4000}
FINAL keeps the later row → watch 0 ✗     FINAL: two keys, two tables → watch 1800 ✓
```

**Per-job sequence (new parts marked \*):**

```
listReports(job, createdAfter=hwm)  ─► reports sorted by createTime asc
planReportBatch(reports, 20)*       ─► { batch, safeHwmAfter[i] }
for i, report in batch:
    csv   = downloadReport(report)
    rows  = parse(csv)             ── reach: CTR>1 ⇒ throw ReachCtrUnitError*
    write matched + residual (residual row for every date in the report)*
    if safeHwmAfter[i]: update youtube_report_jobs.hwm = report.createTime*
```

**Per-connection state, ClickHouse gate:**

```
token ok ─► ensureReportJobs ─► [ClickHouse on?] ─no─► stop (hwm untouched)*
                                   │yes
                                   ▼
                              ingest jobs
```

## 12. End-to-End Data Flow

**Source → input:** a YouTube bulk CSV, plain comma-separated with no
quoting, dates as `YYYYMMDD` (`csv-parsers.ts:92,114`).

**Validation:**

- Required columns are checked per type. If one is missing, the parser
  returns `[]` and (new) a warning is logged.
- CTR range check (new, FR-8).

**Transformation:**

- Sum over the non-video dimensions to one row per video and date (per
  video, date and source for traffic).
- Minutes → seconds.
- AVD/AVP view-weighted, CTR impression-weighted.
- Traffic codes → names.

**Enrichment:** YouTube video id → `(publish_id, project_id)`, restricted to
this connection's publishes (`report-ingest.ts:493-496`).

**Filtering / deduplication:**

- In memory, by the parser's key.
- In storage, by the ReplacingMergeTree key and `inserted_at`.

**Ordering:**

- Reports are processed in ascending `createTime`, so a regenerated report
  is written after the report it replaces. Its rows get a later
  `inserted_at` and win. Within one second the versions are equal. On a
  single node the last insert wins (checked on local 24.8 with two inserts
  at an identical version: the second survived `FINAL` and `OPTIMIZE`).
  Accepted (§30 R5).

**Persistence:** ClickHouse (figures) and Postgres (job registry, high-water
mark).

**Consumers:** YPP (`channel_daily.watch_time_seconds`), subscriber curve
(`channel_daily.subscribers_*`), quality metrics and segments
(`video_reach_daily`), and later FILM-1511 (`channel_reach_daily`).

**Retention and deletion:** there is no ClickHouse TTL (existing). Removal
on disconnect is KB-22/KB-20's subject and is not changed here.

**Where data could go wrong, and the guard for each:**

| Risk | Where | Guard |
|---|---|---|
| Lost | High-water mark advanced without a write (D3) | FR-6 |
| Lost | Equal-`createTime` skip (D4) | FR-7 |
| Lost | Residual clobber (D1) | FR-1 |
| Duplicated | Re-delivery | ReplacingMergeTree |
| Duplicated | A video that became matched is still counted in the residual | FR-3 |
| Duplicated | `channel_combined_a3` is also aggregated | Unchanged: combined writes nothing (`report-ingest.ts:413-421`) |
| Wrongly transformed | CTR unit | FR-8 |
| Wrongly transformed | `engaged_views` fabricated | FR-5 |
| Stale | Token refresh broken (KB-29) | Per-connection error. High-water mark held |
| Partially processed | Crash partway through a job | High-water mark saved per report (FR-7) |

## 13. Data Model

| Entity | Authority | Key | Lifecycle |
|---|---|---|---|
| Report job | YouTube (the job), mirrored in `youtube_report_jobs` | `(platform_connection_id, report_type_id)` unique | Created on the first run. Cascades on disconnect. Status `active` (nothing sets `error`/`disabled` today) |
| High-water mark | `youtube_report_jobs.last_report_created_after` | per job | Only moves forward, and only after that report's rows were written (new invariant) |
| Per-video daily figures | YouTube, copied to ClickHouse | `(project_id, platform, video_id, metric_date)` | Replaced on re-delivery |
| Channel residual, core | Derived: sum of unmatched `channel_basic_a3` rows | `(connection_id, metric_date)` in `channel_daily` | Replaced per date on re-delivery (FR-3) |
| Channel residual, reach | Derived: sum of unmatched reach rows, impression-weighted CTR | `(connection_id, metric_date)` in `channel_reach_daily` | Same |

**Invariant:** for connection C and date D, *matched + residual = channel
total*. Both halves come from the same report delivery (§15 FR-3 makes this
hold on re-delivery too).

## 14. Database Design and Changes

**Postgres: none.** `youtube_report_jobs` is used as is. No typegen needed.

**ClickHouse: new migration `011_channel_reach_residual.ts`** (this number
comes next after `010_video_dim_channel_language`; the runner applies
migrations by name, `run.ts:44-60`):

```sql
CREATE TABLE IF NOT EXISTS channel_reach_daily (
  connection_id   UUID,
  metric_date     Date,
  impressions     UInt64,
  impressions_ctr Float32,            -- impression-weighted within the day, 0..1 (Q1)
  inserted_at     DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(metric_date)
ORDER BY (connection_id, metric_date);

-- Decision 2 (recommended). Both columns carry no measurement:
ALTER TABLE channel_daily     DROP COLUMN IF EXISTS impressions;
ALTER TABLE video_reach_daily DROP COLUMN IF EXISTS engaged_views;
```

`inserted_at` is `DateTime64(3)`, following 008's reasoning
(`008_channel_subscribers.ts:21-25`): the version decides last-write-wins,
and second resolution leaves ties undefined in principle.

**Before / after `channel_daily`:**

- Before: `views, watch_time_seconds, impressions, engaged_views,
  subscribers_gained, subscribers_lost, inserted_at`
- After: the same without `impressions`

**Production implications:**

- Production ClickHouse is not provisioned (`CLICKHOUSE_ENABLED` unset;
  `scripts/deploy.sh:308` runs ClickHouse migrations only when it is
  `true`). So 011 first runs at the FILM-1503 cutover against empty tables.
  No locking, no backfill, instant.
- `DROP COLUMN` on a MergeTree is a metadata change plus part rewrites. It
  is trivial at local and CI sizes.

**Local and CI data:** existing reach-shaped rows in `channel_daily` (all
zeros once `impressions` is dropped) may still sit over real core rows in
dev databases. Re-seeding (`./scripts/local-env.sh up` / seed script) or
re-ingesting fixes them. There is no production data to repair.

**Rollback:** 011 is forward-only, like every migration here (the runner has
no `down`).

- Rolling back the app alone is safe for `channel_reach_daily`: the old app
  simply never writes it.
- It is **not** safe after the drops: the old app's writers still send
  `impressions` / `engaged_views`. ClickHouse would ignore them (unknown
  JSON fields are skipped, `dim-sync.local-stack.test.ts:12-14`), and the
  old `queryQualityMetricsForVideos` would fail on `engaged_views`.

Mitigation: deploy order (§25), or choose Decision 2's alternative.

## 15. Low-Level Design

**`@kit/clickhouse`**

- `types.ts`:
  - `ChannelDaily` loses `impressions`.
  - New `ChannelReachDaily { connection_id; metric_date; impressions;
    impressions_ctr }`, with all fields required. This follows FILM-1618's
    rule that a new construction site must name every field.
  - `VideoReachDaily` loses `engaged_views`.
- `queries.ts`: `insertChannelReachDaily(rows)`, the same shape as
  `insertChannelDaily` (it returns when there are no rows or ClickHouse is
  disabled). Exported from `server/index.ts`.
- `queries-detail.ts`: remove `engaged_views` from the reach leg and the
  result mapping. Remove `engagedViews` from `VideoQualityMetrics`.
- `lib/data-provenance.ts`:
  - `SourceTable` gains `'channel_reach_daily'`.
  - `TABLE_WRITERS.channel_reach_daily = 'insertChannelReachDaily'`.
  - `WRITER_CALL_SITES.channel_reach_daily = [VERIFY_SCRIPT,
    report-ingest.ts]`.
  - `'engaged_views'` is removed from the reach reference fields.
- `scripts/verify-queries.ts`:
  - A step that calls `insertChannelReachDaily`.
  - A seeded value check: insert a core residual row, then a reach residual
    row for the same `(C, D)`, then assert `queryChannelWatchWindow` returns
    the core watch time and `channel_reach_daily FINAL` returns the reach
    figures.
  - Drop `impressions` / `engaged_views` from the existing seeds.
- `migrations/011_channel_reach_residual.ts`, and register it in `run.ts`.

**`csv-parsers.ts`**

- `ReachReportRow` becomes `{ date, youtubeVideoId, impressions,
  impressionsCtr }`.
- `parseReachReport` stops reading `engaged_views` and additionally returns
  `maxCtr` from a sibling helper, or throws. Preferred: a pure
  `assertCtrIsRatio(rows)` in the same file, called by the ingest, so the
  parser stays total.
- A header-validation warning hook: each parser returns `[]` as today. The
  ingest logs when the rows are empty **and** the CSV had more than one line
  (data present but columns unrecognised), which is the case that matters.

**`report-ingest.ts`**

```ts
export function planReportBatch(reports: YouTubeReport[], cap: number):
  Array<{ report: YouTubeReport; advanceTo: string | null }>
// Takes the first `cap` reports (already sorted ascending by createTime).
// advanceTo = report.createTime when no report *outside* the batch shares
// that createTime and it is the last report of its createTime group within
// the batch; otherwise null (hold the watermark).
```

- `ingestJobReports`: loop over the plan. After a successful
  `ingestReportCsv`, if `advanceTo` is set, update the high-water mark and
  **check the error** (today it is ignored at `:267`). If the update fails,
  throw, so the connection records an error. Re-processing is idempotent.
- `ReachCtrUnitError` counts as a refusal: logged at error level with
  `{ reportId, reportType, maxCtr }`, counted in `reportsRefused`, and it
  stops that job's loop without advancing the high-water mark. Other jobs
  continue.
- `runReportingIngestJob`: after `ensureReportJobs`, `if
  (!isClickHouseEnabled()) continue;` with one info log per run, not per
  connection. `result.clickhouseEnabled` is set once.
- `ingestReportCsv` (exported for tests, as `accumulateChannelDaily` already
  is):
  - Reach branch: accumulate the unmatched rows into a
    `Map<date, {impressions, ctrWeighted}>` via a new pure
    `accumulateChannelReach`, seed a zero entry for **every date seen in
    the report**, then `insertChannelReachDaily`.
  - Basic branch: seed `accumulateChannelDaily` with a zero entry for every
    date seen (FR-3), then insert as today.
  - Returns `{ matched, unmatched, residualDates }` for FR-9.
- `accumulateChannelDaily`: unchanged, apart from `impressions` leaving the
  type.

**Concurrency.** Two overlapping runs can both read high-water mark *h* and
both process the same reports. Writes are idempotent. The last high-water
mark update wins, and both write the same values. There is no regression
path in which the mark moves backwards to a lower value than a concurrent
writer set: both write `createTime`s from the same ascending list. Accepted
without a lock, as today.

**Configuration.** No new environment variables. This relies on the existing
`CLICKHOUSE_ENABLED` and `CRON_SECRET`, and for tests only the existing
`VENDOR_SANDBOX` and `VENDOR_URL_YOUTUBE_REPORTING`.

## 16. API and Event Design

`POST /api/analytics/reports-ingest`: existing endpoint.

- **Producer:** `StorybookReportIngestCron` lambda. **Consumer:** the route.
- **Request:** no body. Header `Authorization: Bearer <CRON_SECRET>`.
- **Response 200:** `ReportIngestResult` =
  - `{ success, connectionsProcessed, jobsEnsured, reportsIngested,
    rowsMatched, rowsUnmatched, errors[], durationMs }` (existing)
  - plus `clickhouseEnabled: boolean` and `reportsRefused: number` (new)
- **Other responses:** 401 for a bad secret. 500 when the secret is not
  configured or on an unexpected throw (unchanged).
- **Idempotency:** yes, by design (§7).
- **Pagination:** not applicable. The rate limit is the cron itself.
  Timeout: the lambda's 10 minutes.
- **Compatibility:** the new fields are additive, and the lambda's
  `ReportIngestResult` interface (`index.ts:9-17`) is structural and
  optional-fielded, so the lambda code is unchanged (keeps KB-14 out of it).

**Vendor calls (unchanged):** `reportTypes.list`, `jobs.list`,
`jobs.create`, `jobs.reports.list(createdAfter, pageSize 50, paged)`,
`media.download`. Quota: the Reporting API does not charge per data row
(`youtube-reporting.ts:58-60`).

There are no asynchronous events.

## 17. State and Lifecycle Design

**Job registry row:** `active` on creation. No code writes `error` or
`disabled` today (unchanged, noted in §31 Q6). Deleted by the cascade on
disconnect.

**High-water mark, per job:**

```
null ──first run──► createTime(r_k)  where k = last report whose createTime group is complete
  │                        │
  │   ClickHouse off:      │   CTR refusal / download error / write error:
  └── stays null ◄─────────┴── stays at last safely-written createTime
```

Invariant: `hwm` ≤ the `createTime` of every report not yet written.

**Report (at YouTube):** generated → listed → downloaded → written →
passed by the high-water mark. Terminal: it expires at YouTube after 60
days (30 for backfill).

## 18. Failure and Error Handling

| Operation | Failure | System | Visible | Recovery |
|---|---|---|---|---|
| Token | Invalid (KB-29, revoked) | Per-connection error. Others continue | Stale channel | Fix KB-29 / reconnect |
| Job ensure | Scope missing / API error | Per-connection error | Stale | Reconnect |
| List reports | API error | Per-connection error. High-water mark unchanged | Stale | Next run |
| Download | Network / 5xx | Per-connection error. High-water mark at the last written report | Partial | Next run resumes |
| Parse | Unknown header | `[]` plus a warning. High-water mark advances | Missing day | Operator. Parser change. Reset the high-water mark to re-fetch (runbook) |
| Parse | CTR > 1 | Refused. High-water mark held. Error log | No reach for the rest of that job | Owner confirms the unit (Q1) |
| ClickHouse insert | Server error | Throws before the high-water mark update | Stale | Next run |
| High-water mark update | Postgres error | Now throws (today ignored) | — | Next run re-processes (idempotent) |
| Whole route | Unexpected throw | 500, logged (unchanged) | — | Next cron |

There is no dead-letter queue. YouTube's retention window is the replay
buffer: 60 days, which is 240 cron runs.

## 19. Security

- **Authentication:** `CRON_SECRET` bearer, unchanged. The vendor OAuth
  token is read by `ensureValidToken`, unchanged.
- **Tenant isolation:**
  - Publish matching is scoped to `platform_connection_id = C`
    (`report-ingest.ts:495`), so a report can never attribute rows to
    another tenant's publish.
  - The new table is keyed by `connection_id`. Future readers must scope by
    connections the caller may access. The pattern is `assertScopeAccess`,
    as in `getYppProgressAction` (`deep-dive-actions.ts:246`). No reader is
    added here.
- **Vendor override:** used only in tests and the local sandbox. The
  resolver refuses it in production and in Lambda (`resolver.ts:84-89`).
- **Production credentials: none used, none needed.** All vendor behaviour
  comes from Google's documentation and fixtures.
- **Input handling:**
  - CSV fields are never interpolated into SQL. ClickHouse inserts are
    `JSONEachRow` values.
  - The traffic-code lookup is already prototype-safe (`csv-parsers.ts:233`).
- **No new secrets, grants or RLS changes.**

## 20. Performance and Scale

| Aspect | Value |
|---|---|
| Report cadence | 1 per job per day, plus about 30 backfill reports on the first run of a new job |
| CSV size | Proportional to (videos with activity × dimension combinations). Large channels: MBs per basic/combined report |
| Per-run cap | 20 reports per job, so at most 80 downloads per connection per run |
| New writes | +1 ClickHouse insert per reach report (a handful of rows). +≤20 Postgres updates per job per run |
| Read cost | Unchanged. `channel_daily FINAL` gets smaller (one row per date instead of up to two) |

Bottleneck: unchanged. That is serial per-connection processing within one
route invocation. At the one-owner scale it is far below the 10-minute
budget. Many connections is a pre-existing concern, not changed here.

## 21. Accessibility and Client Behavior

Not applicable: no UI, component or copy changes in this ticket.

## 22. Observability and Operations

**Logs (new or changed):**

- One info line per report: `{ name: 'youtube-report-ingest', connectionId,
  reportType, reportId, startTime, matched, unmatched, residualDates }`.
- A warning when a non-empty CSV parses to zero rows: `{ reportType,
  reportId, header }`.
- An error for CTR refusal: `{ reportType, reportId, maxCtr }`.
- An info line, once per run, when ClickHouse is disabled: `"ClickHouse
  disabled — jobs ensured, reports left at YouTube"`, with a
  `jobsEnsured` count.
- The existing end-of-run summary gains `clickhouseEnabled` and
  `reportsRefused`.

**How an operator knows it is working:**

- `select report_type_id, last_report_created_after from
  youtube_report_jobs` shows high-water marks moving forward about daily
  per job while ClickHouse is on, and all null while it is off.
- `SELECT metric_date, count() FROM channel_daily FINAL WHERE connection_id
  = … GROUP BY 1` has one row per reported day.

**Distinguishing expected from failing:**

| Situation | Expected | Failure |
|---|---|---|
| Result shape | `reportsIngested = 0` with `clickhouseEnabled = false` | `reportsIngested = 0` with ClickHouse on for more than 3 days |
| Refusals | — | Any `reportsRefused > 0` |

There are no alerts or dashboards: the monitoring stack (Baselime) is not
wired for cron jobs here, and adding it is out of scope.

## 23. Configuration and Feature Flags

- `CLICKHOUSE_ENABLED`: existing. It now also gates downloading and the
  high-water mark (FR-6). Absent or anything but `'true'` means off, which
  is the safe default.
- `CRON_SECRET`: existing. Absent → 500.
- `MAX_REPORTS_PER_JOB_PER_RUN = 20`: constant, unchanged.
- No new feature flag. The behaviour is a correctness fix, and a flag would
  leave the clobber reachable.

## 24. Compatibility

| Consumer | Impact |
|---|---|
| `queryChannelWatchWindow`, `querySubscriberDeltas` | None to the SQL. Figures become correct |
| `queryQualityMetricsForVideos` | Loses `engagedViews` (no reader, grep) |
| `apps/e2e/tests/deep-dive/subscriber-evidence.spec.ts:133` (inserts `impressions: 0` into `channel_daily`) | The field is dropped from the seed. It would otherwise be ignored as unknown JSON |
| `apps/e2e/tests/utils/clickhouse.ts:244` `seedVideoReach` and `experiments-evidence.spec.ts:159,221` (send `engaged_views: 0`) | The field is dropped from the seeds |
| `verify-queries.ts` seeds (`:282,:360,:1475`) | Updated |
| `apps/web/scripts/seed-local-analytics.ts` | Checked, and updated if it writes either column |
| Lambda | Unchanged |
| FILM-1503 runbook | Gains a step (§25, Decision 7) |

**Deploy order matters for the column drops only:** ClickHouse migration
first, then the app. The same order as 007 and 010. Since production
ClickHouse does not exist yet, this is automatically satisfied at cutover.

## 25. Migration and Rollout Strategy

1. **Merge.** The CI `verify` job applies 011 to CI's ClickHouse and runs
   the new steps.
2. **Production today (ClickHouse off).** The deploy ships FR-6. From that
   moment no report is discarded. Jobs keep being ensured, so YouTube keeps
   generating.
3. **Owner check (one read-only query in the production dashboard, Q3):**
   `select report_type_id, last_report_created_after from
   youtube_report_jobs;`
   - All null, or no rows: nothing was lost.
   - Non-null: reports up to that point were discarded, and step 4 recovers
     what YouTube still holds.
4. **FILM-1503 cutover (existing runbook, plus one new step):**
   1. Disable the sync cron.
   2. Run the ClickHouse migrations (includes 011).
   3. **New:** `update youtube_report_jobs set last_report_created_after =
      null;`
   4. Enable ClickHouse.
   5. Run the report ingest (manual POST or wait for the cron).
   6. Continue with the runbook.
5. **Validation gate after cutover:**
   - Within 48–72 h, `channel_daily` and `channel_reach_daily` have rows for
     the owner's channel.
   - One video/day is cross-checked against YouTube Studio (criterion 6,
     done by the owner).
6. **Rollback:** revert the app. The migration stays: see §14 for why the
   column drops must stay with it.

## 26. Testing Strategy

Every new guard is seen **red on today's code** first, for the stated
reason, then green.

| ID | Layer | What | Red-before-green |
|---|---|---|---|
| T1 | Unit, `__tests__/csv-parsers.test.ts` + `__tests__/fixtures/youtube-reporting/*.csv` | Fixtures for `channel_basic_a3`, `channel_combined_a3`, `channel_traffic_source_a3`, `channel_reach_basic_a1`, `channel_reach_combined_a1`. Headers exactly as Google documents them (§8.4 D2 and the channel-reports page), multi-dimension rows, hand-computed expectations. Each type also header-only and empty | Reach: "row has no `engagedViews`" is red today. Coverage-only cases (header-only/empty for the other types) pass today, because the code already returns `[]`. Each is shown able to fail by a deliberate parser mutation (treat the header line as data), recorded in the PR |
| T2 | Unit, `__tests__/report-ingest.test.ts` (mocked `@kit/clickhouse/server` writers, fake Supabase client, fake provider, mocked `ensureValidToken`) | (a) The reach residual goes to `insertChannelReachDaily`, never `insertChannelDaily`. (b) A zero residual row is written for an all-matched date. (c) ClickHouse off: jobs ensured, `downloadReport` not called, no high-water-mark update. (d) `planReportBatch`: an equal-`createTime` group across the cap holds the high-water mark; per-report saving. (e) CTR > 1 refused, high-water mark held. Plus FR-9 log fields | (a), (b), (c), (d), (e) are each red on today's code |
| T3 | Local stack, `__tests__/report-ingest.local-stack.test.ts`, off unless `REPORT_INGEST_LOCAL_STACK=1` (the pattern of `dim-sync.local-stack.test.ts`) | Real local Postgres (a seeded YouTube connection and a matched publish) and real ClickHouse. Fake provider serving T1 fixtures. Mocked `ensureValidToken`. Runs `runReportingIngestJob` then reads back via the **real readers**: `queryChannelWatchWindow`, `querySubscriberDeltas`, plus `video_metrics`, `video_reach_daily`, `channel_reach_daily` `FINAL`. Asserts the §3 hand-computed values in **both orders** (basic→reach and reach→basic), after a **re-delivery**, and after the **video-becomes-matched** re-delivery. Also asserts 4 `youtube_report_jobs` rows after the first run and still 4 after the second (FR-10) | Basic→reach reading `watch_time = 0` on today's code is the red. Recorded with the table in the PR |
| T4 | CI ClickHouse `verify` (`verify-queries.ts`) | Seeded residual check (core then reach, same key) through `queryChannelWatchWindow`. Every exported writer is exercised | The new check fails against a build where the reach residual is written into `channel_daily` (shown locally by pointing the check's reach insert at `insertChannelDaily`) |
| T5 | Production build + sandbox (§27) | `build:test` / `start:test` on :3109 with `VENDOR_SANDBOX=1` and `VENDOR_URL_YOUTUBE_REPORTING` pointing at a local fixture HTTP server. `curl` the route with a local `CRON_SECRET`. Read ClickHouse | — (end-to-end confirmation, not a new guard) |
| T6 | Existing guards | `data-provenance.test.ts`, `verify-coverage.test.ts` | Red until the new writer is registered, then green |

There is no Playwright UI spec, because no form or interactive component
changes. No pgTAP test, because no policy changes. Full
`@kit/content-analytics` and `@kit/clickhouse` suites, `pnpm typecheck`,
`pnpm lint:fix`, `pnpm format:fix`.

Hand-computed fixture answers (T1/T3), date `D`:

| Figure | Value |
|---|---|
| `vidA` basic | 150 views, 900 s, +3/−1 |
| `vidX` residual | 400 views, 1,800 s, net +2 |
| `vidA` reach | 4,000 impressions, CTR 0.04 |
| residual reach | 4,000 impressions, CTR 0.055 |
| Traffic, `vidA` | SUBSCRIBER 200 views / 80 min, RELATED_VIDEO 200 / 90 |

## 27. Production-Build Verification

**Question:** does the production bundle run the route, ensure jobs,
download, parse, write the right tables and move the high-water mark, with
no Google call?

Procedure, holding the DB lock and a heavy slot, dev port 3109:

1. `./scripts/local-env.sh up` and `supabase db reset` from this worktree.
   Apply ClickHouse migrations (011 included).
2. Seed an active YouTube `platform_connection`:
   - token encrypted with the local key, `token_expires_at` = now + 1 day,
     so there is **no refresh call** and KB-29 is sidestepped
   - one publish whose `platform_content_id = 'vidA'`
3. Start a local fixture HTTP server that answers the five Reporting API
   routes from the T1 fixtures. Each report has a `createTime`, and two
   reports share one `createTime` so D4 is exercised.
4. `pnpm --filter web build:test`, then `NODE_ENV=test VENDOR_SANDBOX=1
   VENDOR_URL_YOUTUBE_REPORTING=http://localhost:<port>
   CLICKHOUSE_ENABLED=true CRON_SECRET=<local value> next start -p 3109`.
5. `curl -X POST -H "Authorization: Bearer <local value>"
   localhost:3109/api/analytics/reports-ingest`, then read back
   `youtube_report_jobs` and the four ClickHouse tables. Run it twice (the
   second run must write nothing new and keep 4 jobs).
6. Repeat with `CLICKHOUSE_ENABLED=false`: `clickhouseEnabled:false`, no
   fixture-server download hits, high-water marks null.

Results go in the PR as tables. The fixture server lives in the scratchpad
unless the owner wants it committed (Decision 6).

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Production verification |
|---|---|---|---|---|---|---|---|
| YPP counts every video | J3–J4 | FR-1, FR-3 | §10 table split, §15 | `report-ingest.ts`, migration 011 | `channel_daily`, `channel_reach_daily` | T2a/b, T3, T4 | T5 read-back. Owner's Studio check after cutover |
| Subscriber curve counts every video | J3, J5 | FR-1, FR-3 | same | same | `channel_daily.subscribers_*` | T3 (`querySubscriberDeltas`) | T5 |
| Residual reach kept | J3 | FR-2 | §14 | `insertChannelReachDaily` | `channel_reach_daily` | T3, T4 | T5 |
| No fabricated figures | — | FR-5, FR-8 | §15 parser | `csv-parsers.ts`, `queries-detail.ts` | column drops | T1, T2e | T5 |
| Reports survive ClickHouse off | J6 | FR-6 | §15 gate | `runReportingIngestJob` | high-water mark | T2c | T5 step 6. Owner query Q3 |
| Nothing skipped / resumable | J3 | FR-7 | `planReportBatch` | `report-ingest.ts` | high-water mark | T2d | T5 (shared `createTime`) |
| Jobs exist for every connection | J2 | FR-10 | unchanged | `ensureReportJobs` | `youtube_report_jobs` | T3 | T5 |
| Parsers proven on real shapes | — | FR-4 | fixtures | `csv-parsers.ts` | — | T1 | T5 uses the same fixtures |
| Operable | — | FR-9 | §22 | logger | route JSON | T2 | T5 log capture |
| Guards stay honest | — | FR-11 | §15 | provenance, verify | — | T6 | CI |

## 29. Architectural Alternatives and Trade-offs

**A. Channel residual fix.**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A1. New `channel_reach_daily` table (proposed)** | Applies 003's own rule at the grain where it was missed. Symmetric with `video_reach_daily`. Reader SQL unchanged. Reach CTR gets a natural home | One more table, writer and provenance entry | **Chosen** |
| A2. Add `report_family` to `channel_daily`'s sort key (`ADD COLUMN report_family LowCardinality(String), MODIFY ORDER BY (connection_id, metric_date, report_family)`, **tested legal on 24.8** in the scratch database; a column with a DEFAULT is refused) | No new table. Readers' `sum()` still works because the other columns are zero | Pre-existing rows get `''`, so the family is unknown. Every column is meaningful for one family only, so zero again stands in for "not this report", the pattern the analytics standards forbid. Any future `any()`/`argMax` reader would be wrong | Rejected |
| A3. Read-merge-write (read the `FINAL` row, fill the other family's columns, insert) | No schema change | Races with concurrent runs. Depends on order. Two round trips per report. A stale read resurrects old values | Rejected |
| A4. AggregatingMergeTree with `SimpleAggregateFunction(max)` per column | One row per key | Breaks re-delivery replacement (max never decreases after a correction) | Rejected |

**B. The two meaningless columns** (Decision 2):

- **Drop them (proposed).** Honest, and small.
- Keep them with a comment. Zero risk to rollback, but leaves columns that
  read as measurements.

**C. ClickHouse-off behaviour** (Decision 3):

- **Ensure jobs, hold the high-water mark (proposed).** Starts YouTube's
  history clock and loses nothing.
- Skip the whole run. This would not create jobs, and the 30-day
  pre-creation backfill only starts at job creation.
- Status quo. Silent loss.

**D. CTR unit guard** (Decision 4):

- **Refuse on any value > 1 (proposed).** Loud, and misses only a percent
  file whose every video had CTR ≤ 1 %, which is implausible for a whole
  channel-day.
- Auto-detect and rescale. This guesses, and the wrong guess is silent.
- No guard.

## 30. Risk Register

| # | Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | CTR unit is percent, not ratio (Q1) | CTR 100× off everywhere | FR-8 refusal, loud | Guard | Owner downloads one real report from their own channel (dev OAuth, not production credentials) and the parser is pinned |
| R2 | Google's real CSV headers differ from the docs (for example column order, extra columns) | Parsed as `[]` | New warning log | The parser is header-driven and ignores extra columns | Update fixtures from a real file |
| R3 | KB-29 breaks every token refresh | The ingest produces nothing | `result.errors` | The high-water mark is held, so no loss within 60 days | KB-29's fix. Not coupled in code |
| R4 | Production high-water marks already advanced (D3) | History before now may be partly gone | Q3 query | Null reset at cutover recovers what YouTube still holds | Accept the gap. Record it in the UI tooltip (FILM-1511, "unobtainable") |
| R5 | Equal-version tie within one second on the older `DateTime` tables | The survivor is undefined in principle | Not observable locally (the last insert won) | New table uses `DateTime64(3)`. Older tables unchanged (out of scope) | — |
| R6 | ClickHouse migration number 011 collides with another in-flight ticket | Merge conflict in `run.ts` | Rebase | Coordinate via the lead | Renumber. The runner applies by name |
| R7 | Column drop + app rollback | Old quality query fails on `engaged_views` | Error logs | Deploy order. Production has no ClickHouse yet | Keep the columns (Decision 2 alternative) |
| R8 | Traffic residual still not stored | Channel-wide traffic share excludes non-Storybook videos | Documented | Out of scope. Counted and logged | Future ticket if wanted |
| R9 | `channel_combined_a3` downloaded and discarded every run | Wasted bandwidth | — | Unchanged (a cross-check source) | Drop the job in a future ticket |

## 31. Open Questions and Assumptions

| # | Question | Why it matters | Current assumption | Info needed | Decision |
|---|---|---|---|---|---|
| Q1 | Is `video_thumbnail_impressions_ctr` a ratio (0.05) or a percentage (5.0)? Google says both: *"The percentage of impressions … calculated as clicks divided by impressions"* ([metrics](https://developers.google.com/youtube/reporting/v1/reports/metrics)) | Every CTR figure, the weekly-diagnostics low-CTR flag, and CSV exports (`weekly-diagnostics-table.tsx:159`, `csv-generator.ts:33` multiply by 100) | Ratio, which the code already assumes | One real reach CSV from the owner's channel | Owner. Guarded by FR-8 until answered |
| Q2 | Does `createdAfter` exclude reports whose `createTime` equals the value? | D4 | Assume it does. FR-7 is safe either way | Vendor behaviour (not callable) | None, because the guard makes it moot |
| Q3 | Has the production cron already advanced high-water marks against a live channel? | D3 recovery | Unknown | One read-only production query by the owner (§25 step 3) | Owner |
| Q4 | What should happen when a non-empty CSV's header is unrecognised: warn and advance (proposed), or refuse like FR-8? | Schema drift | Warn and advance. It is a vendor-side change we cannot fix by retrying | — | Owner (default: warn) |
| Q5 | Should engaged views for matched videos (present in `channel_basic_a3`, parsed, then dropped at `report-ingest.ts:369-395`) be stored? | The spec summary promises "including `engaged_views`" | Out of scope (Decision 5). It needs a nullable `video_metrics` column, because the hourly Analytics-API sync does not write it and a `DEFAULT 0` would be a default posing as a measurement | — | Owner |
| Q6 | Should `youtube_report_jobs.status` ever become `error`/`disabled`? | Nothing sets it today | No change | — | Future |

**Assumptions:**

- Fixture headers follow Google's documented column lists as of 2026-09-23.
- The local ClickHouse (24.8) matches CI's.
- Production ClickHouse is not provisioned (supported by `scripts/deploy.sh`
  and root `CLAUDE.md`).

## 32. Implementation Plan

Ordered by dependency. Each step ends green before the next.

1. **Fixtures + parser tests (T1).**
   - Add `__tests__/fixtures/youtube-reporting/`.
   - Write the reach "no `engagedViews`" test, see it red, then change
     `ReachReportRow` / `parseReachReport`.
   - Add coverage cases with a recorded mutation witness.
   - No DB impact.
2. **ClickHouse schema.**
   - `011_channel_reach_residual.ts` + `run.ts`.
   - Types (`ChannelReachDaily`; drop `impressions` / `engaged_views`).
   - `insertChannelReachDaily` + server export.
   - `queries-detail.ts` drops `engagedViews`.
   - Provenance entries.
   - `verify-queries.ts` step + seeded check (T4).
   - Update the e2e and seed-script fixtures that name the dropped columns.
   - **DB lock:** apply 011 to local ClickHouse and run `verify`.
3. **Ingest logic (T2, red first for each).**
   - Reach residual target.
   - Zero residual per date.
   - `planReportBatch` + per-report high-water mark with its error checked.
   - ClickHouse gate.
   - CTR refusal.
   - Per-report logs.
   - Result fields.
4. **Local-stack test (T3), under the DB lock.**
   - First run it against step-3-reverted code to capture the red
     (basic→reach, watch = 0).
   - Then run it green. Record the tables.
5. **Production build (T5)**, under the DB lock and a heavy slot, port 3109.
6. **Spec record.**
   - FILM-1504 YAML: flip `met`/`evidence` for criteria 1–4, and 5 as far
     as our side goes. Keep criterion 6 (Studio cross-check) unverified, so
     status stays **PARTIAL** with that one owner-operated item remaining.
   - Update the `notes` implementation map (new table, gate, fixtures).
   - Update the `specs/INDEX.md` row.
   - Update the phase-15 README verification counts.
   - Add the FILM-1503 runbook line if Decision 7 is approved.
7. **Quality gates.** `pnpm typecheck`, package test suites, `pnpm
   lint:fix`, `pnpm format:fix`. Commit, push, PR.

Rollback implications per step: steps 1 and 3 are code-only. Step 2 is
forward-only in ClickHouse (§14).

## 33. Definition of Done

- The `channel_daily` residual survives a later reach report, in both
  orders, re-delivery and the became-matched case. Proven by T3 against the
  real readers, red first.
- The reach residual is stored in `channel_reach_daily` and read back equal
  to the hand-computed values.
- Five report shapes have fixtures, each full, header-only and empty. The
  reach rows carry no fabricated `engagedViews`.
- ClickHouse-off runs download nothing and hold the high-water mark. The
  equal-`createTime` group is never split. The high-water mark is saved per
  report.
- CTR > 1 is refused loudly.
- The provenance and verify guards are green. CI `verify` includes the new
  check.
- The production build (T5) produces the same read-back.
- Typecheck, lint and format are clean.
- The FILM-1504 spec is updated honestly. Status stays PARTIAL solely for
  the owner's Studio cross-check (criterion 6) unless the owner performs it.

## 34. Final Consistency Pass

**Forward review.** The problem is that channel-wide YPP and subscriber
figures silently lose the residual (D1, reproduced).

- **Outcome:** channel totals are correct in any delivery order.
- **User actions:** none. It is a cron.
- **System:** separate residual tables per report family, plus residual
  rows per date.
- **Data:** `channel_reach_daily`, with `channel_daily` narrowed to the
  core report.
- **Architecture:** 003's own rule applied at the residual grain.
- **Tests:** T3 reads through the same functions the YPP card and subscriber
  curve use.
- **Deployment:** it lands before ClickHouse exists in production, and the
  cutover runbook gains a high-water-mark reset.
- **Production verification:** T5 (production bundle, fixture vendor) and
  the owner's Studio check.

The chain holds.

**Reverse review.** In production, today: jobs are ensured and nothing is
downloaded until ClickHouse is on, and the owner sees no change. After the
cutover:

- Reports are written to five ClickHouse tables, and the high-water mark
  moves forward only past written reports.
- `getYppProgressAction` and `querySubscriberDeltas` read `channel_daily`,
  which now holds only core-report figures. Their sums equal the channel's
  totals, which is the §1 outcome.
- Nothing in the change displays a value YouTube did not report (D2 is
  removed, and D3 no longer discards data).

The two directions converge.

**Residual gaps, stated rather than hidden:**

- The Studio cross-check (criterion 6, owner).
- The CTR unit (Q1, guarded).
- Traffic residual not stored (R8).
- Engaged views for matched videos (Q5).
- `youtube_report_jobs` RLS has no pgTAP test (not in this ticket's
  `remaining:`, flagged for the lead).

---

### Appendix — what each downstream spec needs from FILM-1504

| Downstream | Needs | Provided by this change | Still theirs |
|---|---|---|---|
| **FILM-1506** (video_dim + deep-dive queries) | YPP progress reads `queryChannelWatchWindow` over `channel_daily`. Today this under-counts whenever reach lands second (D1). Their seeded-value checks for YPP need a residual that is correct | D1 fixed. T3/T4 give the seeded pattern | Upload-month medians, rolling, back-catalog and returning-proxy fixture checks (their `remaining:`) |
| **FILM-1507** (taxonomy) | Nothing direct. It depends on 1506 (medians over `video_metrics`/`video_dim`) | — | The tagging UI (their `remaining:`) |
| **FILM-1511** (dashboards & reports) | Per-video impressions/CTR (`video_reach_daily`, unchanged). Channel-wide reach (new `channel_reach_daily`). An honest "unobtainable before job creation − 30 d" boundary: `youtube_report_jobs.created_at` per connection is the source. The CTR unit (Q1) | The table, the registry timestamp, and the refusal guard. `engagedViews` removed from `VideoQualityMetrics` (no reader) | A reader and card for channel reach. The tooltip. Distinguishing "0 impressions" from "no reach data" (`weekly-diagnostics-table.tsx:152` shows "—" for both) |
| **FILM-1601** (correctness bugs) | Raw-CSV per-day impressions from `video_reach_daily` (their remaining item) | Correct per-day reach rows (unchanged table, and no longer carrying a fabricated `engaged_views`) | Reading per-day reach in `scheduled/route.ts:517` |
| **FILM-1602** (per-channel YPP) | Per-connection `channel_daily` watch time. D1 corrupted exactly this leg per channel | D1 fixed | The Σ per-channel = pooled regression guard (their `remaining:`) |
| **Phase 17** | Waits on phase 16 | — | — |

### Appendix — implementation notes (approved 2026-09-23 with every recommended default)

Where the implementation differs from the text above. None of these
changes behaviour or scope.

- **CTR check name.** §15 called the pure check `assertCtrIsRatio`. It
  shipped as `findCtrOutOfRange(rows): number | null` in `csv-parsers.ts`,
  and the ingest throws `ReachCtrUnitError` itself. That keeps the parser
  total and puts the throw next to the watermark logic it affects.
- **T2 drives the whole job.** T2 calls `runReportingIngestJob` with fakes
  instead of exporting `ingestReportCsv`. That gave every guard an honest
  red on `origin/main`, where `ingestReportCsv` is not exported. The pure
  helpers `planReportBatch` and `accumulateChannelReach` are exported and
  unit-tested directly.
- **Report order across runs.** Within one run the ingest walks jobs in
  registry order, so the order two reports land in is set by which run
  collects each. T3's order tests therefore deliver each report to a
  separate run, as production does.
- **The fakes compare watermarks as instants.** Postgres returns
  `…+00:00` and the fixtures use `…Z`. A string comparison re-listed the
  watermark report. That made the first red run on `origin/main` look
  worse than the real bug, and I caught it before recording evidence.
- **Shared ClickHouse handed back in main's shape.** After T3–T5, the two
  dropped columns were re-added and the `011` record deleted from
  `_migrations`. Teammates on `main` would otherwise have had their quality
  query fail against the shared container. `011` is `IF [NOT] EXISTS`
  throughout, so this branch re-applies it cleanly.
- **Follow-up (owner decision D5).** Store engaged views for matched videos
  from `channel_basic_a3` in a nullable `video_metrics` column. The lead
  will number it.
