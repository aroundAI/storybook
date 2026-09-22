---
spec_id: FILM-1504
title: YouTube Reporting API (Bulk Reports) Integration
status: 🟡 PARTIAL
audited: 2026-09-23
effort: L
dependencies: FILM-1501
---

# YouTube Reporting API (Bulk Reports) Integration

## 1. Overview

Integrates the YouTube **Reporting API** (bulk report jobs + daily CSV downloads) to obtain:

- **Thumbnail impressions + CTR** — `video_thumbnail_impressions`, `video_thumbnail_impressions_ctr` via the reach reports added to the API on **2026-01-15** (`channel_reach_basic_a1`, `channel_reach_combined_a1`). This closes the weekly "did the packaging fail?" diagnostic that was previously Studio-only.
- **Authoritative per-video per-day data** (`channel_basic_a3`, `channel_combined_a3`) including `engaged_views`.
- **Daily traffic sources** (`channel_traffic_source_a3`).

Uses the already-granted `yt-analytics.readonly` scope. Reporting API rows replace Analytics-API rows for the same (video, day) via later `inserted_at` (ReplacingMergeTree — FILM-1501).

> [!IMPORTANT]
> Reports arrive ~48h late (non-issue with the idempotent model) and history only reaches ~30 days before job creation. Impressions/CTR earlier than (job creation − 30d) are **unobtainable** — surface this in UI tooltips. Ship this phase as early as possible so jobs start accumulating.

## 2. Database Schema

### Supabase — `apps/web/supabase/schemas/66-youtube-report-jobs.sql`

```sql
create table if not exists public.youtube_report_jobs (
  id uuid primary key default extensions.uuid_generate_v4(),
  platform_connection_id uuid not null references public.platform_connections(id) on delete cascade,
  report_type_id varchar(100) not null,          -- e.g. 'channel_basic_a3'
  youtube_job_id varchar(255) not null,
  last_report_created_after timestamptz,          -- high-water mark for reports.list
  status varchar(20) not null default 'active',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_connection_id, report_type_id),
  check (status in ('active', 'error', 'disabled'))
);
-- RLS: account chain via platform_connections.account_id → has_role_on_account
```

### ClickHouse — `003_reach_and_traffic.ts`

```sql
CREATE TABLE video_reach_daily (
    project_id UUID, video_id String, platform Enum(...), metric_date Date,
    impressions UInt64, impressions_ctr Float32, engaged_views UInt64,
    inserted_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (project_id, platform, video_id, metric_date);

CREATE TABLE video_traffic_sources (
    project_id UUID, video_id String, platform Enum(...), metric_date Date,
    source LowCardinality(String),
    views UInt64, watch_time_minutes Float32,
    inserted_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (project_id, platform, video_id, metric_date, source);

-- Channel rollup for videos NOT published through the platform.
-- Makes YPP watch-hours channel-accurate (the gate is channel-wide).
CREATE TABLE channel_daily (
    connection_id UUID, metric_date Date,
    views UInt64, watch_time_seconds UInt64, impressions UInt64, engaged_views UInt64,
    inserted_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (connection_id, metric_date);
```

## 3. Implementation Map

| File | Purpose |
|------|---------|
| `packages/features/content-analytics/src/providers/youtube/youtube-reporting.ts` | `YouTubeReportingProvider` (googleapis `youtubereporting('v1')`): `ensureJobs(connectionId)`, `listNewReports(job, createdAfter)`, `downloadReport(url)`. Live-verify report types via `reportTypes.list` at implementation time. |
| `packages/features/content-analytics/src/server/reporting/csv-parsers.ts` | Pure parser fns per report type (`parseChannelBasicA3(csv)` etc.), fixture-tested. |
| `packages/features/content-analytics/src/server/reporting/report-ingest.ts` | `runReportingIngestJob()`: per active YouTube connection → `ensureValidToken` (reuse `@kit/publishing/token-refresh`) → ensure 4 jobs → download reports past watermark → parse → map YouTube video id → publish via `publishes(platform, platform_content_id)` → insert `video_metrics` (`metric_source:'reporting_api'`), `video_reach_daily`, `video_traffic_sources`; unmatched videos aggregate into `channel_daily`. |
| `apps/web/app/api/analytics/reports-ingest/route.ts` | `CRON_SECRET`-protected trigger. |
| `apps/web/lambda/report-ingest/index.ts` + `sst.config.ts` | `StorybookReportIngestCron`, `rate(6 hours)`. |

Report jobs created per connection: `channel_basic_a3`, `channel_combined_a3`, `channel_traffic_source_a3`, `channel_reach_combined_a1`.

## 4. Acceptance Criteria

- [ ] Report jobs auto-created for every active YouTube connection (rows in `youtube_report_jobs`) — *audit: unverified* — needs a live YouTube connection; path exists (`packages/features/content-analytics/src/server/reporting/report-ingest.ts:124` → `ensureReportJobs`)
- [ ] CSV parsers handle fixture files for all four report types, including header-only (empty) reports — *audit: not met* — no `channel_combined_a3` fixture; header-only tested only for the basic parser (`packages/features/content-analytics/__tests__/csv-parsers.test.ts:47`)
- [ ] Matched rows land in `video_metrics` / `video_reach_daily` / `video_traffic_sources`; re-delivery does not duplicate — *audit: unverified* — inserts at `packages/features/content-analytics/src/server/reporting/report-ingest.ts:316`, `:356`, `:416`; no test runs `ingestReportCsv`
- [ ] Unmatched channel videos aggregate into `channel_daily` (counted + logged, never dropped silently) — *audit: not met* — reach and basic branches insert zero-seeded rows on one key (`packages/features/content-analytics/src/server/reporting/report-ingest.ts:349`, `:403`); under `FINAL` the later zeroes the other
- [ ] Watermark (`last_report_created_after`) advances; already-ingested reports are skipped — *audit: unverified* — advances at `packages/features/content-analytics/src/server/reporting/report-ingest.ts:263`, sent as `createdAfter`; the skip is YouTube's filter, needs a live job
- [ ] One video/day cross-checked against YouTube Studio (views, impressions, CTR) — *audit: unverified* — a manual check against YouTube Studio on a real channel

## 5. Verification

```bash
pnpm --filter @kit/content-analytics test   # parser fixtures
curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/analytics/reports-ingest
# after 24–48h: SELECT count() FROM video_reach_daily
pnpm sst diff
```

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Parser fixtures for all four report types, incl. header-only | No `channel_combined_a3` fixture; header-only and empty-file cases are tested only for `parseChannelBasicReport` (`packages/features/content-analytics/__tests__/csv-parsers.test.ts:47`). The code returns `[]` for them, but no test shows it | unassigned |
| Unmatched videos never dropped silently in `channel_daily` | The reach branch (`report-ingest.ts:349`) and the basic branch (`:403`) each insert a `channel_daily` row with the other's columns zeroed, on the same `(connection_id, metric_date)` key (`packages/clickhouse/src/migrations/003_reach_and_traffic.ts:56`). Readers use `channel_daily FINAL` (`packages/clickhouse/src/queries-advanced.ts:841`), so whichever report lands later zeroes the residual views and watch time (the YPP input) or the impressions for that day | unassigned |
