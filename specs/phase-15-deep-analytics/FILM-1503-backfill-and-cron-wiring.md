---
spec_id: FILM-1503
title: Historical Backfill & Scheduled-Reports Cron Wiring
status: ✅ DONE
audited: 2026-09-23
effort: M
dependencies: FILM-1501, FILM-1502
---

# Historical Backfill & Scheduled-Reports Cron Wiring

## 1. Overview

Two independent fixes shipped together:

1. **Re-populate history** after the FILM-1501 wipe: YouTube per-day history rebuilt from each video's `published_at` via the Analytics API `day` dimension; TikTok/Instagram restart from clean cumulative baselines (their APIs offer no per-day history).
2. **Wire the orphaned scheduled-reports endpoint**: `/api/reports/scheduled` exists with full CRUD + generation logic but has **no `sst.aws.Cron` entry** — scheduled reports never run in deployed infra.

## 2. YouTube Backfill

`packages/features/content-analytics/src/server/backfill/youtube-backfill.ts`:

```typescript
export async function runYouTubeBackfillBatch(options: {
  maxVideos?: number;
  maxQueries?: number; // default 150 — check real Analytics API quota in Google Cloud console
  dryRun?: boolean;
}): Promise<BackfillBatchResult>
```

- Selects published YouTube publishes lacking `metadata.sync.backfill_completed_at`.
- Per video: ONE `reports.query` with `dimensions: 'day'` over `[published_at, today]` (a single query returns the full range; chunk if rows exceed `maxResults`), plus optionally one lifetime traffic-source query.
- Rows inserted with `metric_source: 'backfill'`; publish marked complete in `metadata.sync`.
- Quota-aware and resumable: repeated invocations drain the queue over days.

Trigger: `apps/web/app/api/analytics/backfill/route.ts` — `CRON_SECRET`-protected; invoked manually (or temporarily at the end of the sync cron) until drained.

## 3. Scheduled-Reports Cron

`sst.config.ts`: new `StorybookScheduledReportsCron` (`schedule: 'rate(1 hour)'`), copying the `StorybookAnalyticsSyncCron` pattern, pointing at new thin lambda `apps/web/lambda/scheduled-reports/index.ts` which HTTP-calls `/api/reports/scheduled` with `Authorization: Bearer ${CRON_SECRET}` (copy `apps/web/lambda/analytics-sync/index.ts`).

## 4. Cutover Runbook

1. Disable `StorybookAnalyticsSyncCron` (or deploy with it paused).
2. Merge FILM-1501 + FILM-1502; run `pnpm --filter @kit/clickhouse migrate` (drops corrupt data, creates v2).
3. Trigger `/api/analytics/backfill` repeatedly (respecting quota) until `BackfillBatchResult.remaining === 0`.
4. Re-enable the sync cron.
5. Spot-check dashboard totals against YouTube Studio for 2–3 videos.

## 5. Acceptance Criteria

- [x] Backfill dry-run prints planned queries without writing — *audit:* `packages/features/content-analytics/src/server/backfill/youtube-backfill.ts:109` (logs `plannedQueries`, skips every write; dims skipped at `:91`)
- [ ] After backfill, per-video `min(metric_date)` matches `published_at` — *audit: unverified* — depends on the rows the Analytics API returns; needs a real backfill run
- [x] Backfill is resumable — re-invocation skips completed publishes — *audit:* `packages/features/content-analytics/src/server/backfill/youtube-backfill.ts:207` (pending predicate; completion mark at `:298`)
- [ ] `pnpm sst diff` shows only the new scheduled-reports cron — *audit: unverified* — a ship-time diff; the cron exists (`sst.config.ts:1306`); a diff needs AWS credentials
- [ ] A due scheduled report is generated + emailed within an hour in deployed infra — *audit: unverified* — deployed-infra outcome; wiring present: `sst.config.ts:1306` → `apps/web/app/api/reports/scheduled/route.ts:581`

## 6. Verification

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "localhost:3000/api/analytics/backfill?dryRun=true"
# ClickHouse: SELECT video_id, min(metric_date), count() FROM video_metrics WHERE metric_source='backfill' GROUP BY video_id
pnpm sst diff
```
