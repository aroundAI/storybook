---
spec_id: FILM-1502
title: Sync Worker Ingestion Correctness
status: Approved
effort: M
dependencies: FILM-1501
---

# Sync Worker Ingestion Correctness

## 1. Overview

Rewrites the ingestion core of `analytics-sync-cron.ts` to write true daily rows into the FILM-1501 v2 model, fixes the sync schedule tier gap, and adds missing Postgres indexes. Ships immediately after FILM-1501 (sync cron disabled between the two merges — see FILM-1503 runbook).

## 2. Ingestion Design

### YouTube — per-day truth from `dailyData`

`fetchPlatformAnalytics` widens the fetch window from 2 days to `[lastSyncedDataDate − 3d, today]` (YouTube restates recent data for ~72h). New:

```typescript
async function ingestYouTubeDaily(
  projectId: string,
  publishId: string,
  result: YouTubeAnalyticsResult,
): Promise<void>
```

- Maps `result.dailyData[]` to per-day `VideoMetric` rows keyed by the **real data date**, `metric_source: 'analytics_api'`.
- Writes a `video_snapshots` row from `result.totals` (cross-check baseline).
- Persists `last_data_date` in publish `metadata.sync` (extend `PublishMetadata['sync']` in `server/types.ts`) so the window is restatement-safe.

### TikTok / Instagram — clamped snapshot deltas

These APIs only return lifetime cumulative counters. New:

```typescript
async function ingestCumulativeSnapshot(
  projectId: string,
  publishId: string,
  platform: 'tiktok' | 'instagram',
  totals: SnapshotTotals,
): Promise<void>
```

- Baseline = `queryLatestSnapshots` (batched for the whole sync batch) strictly before today.
- `today_row = max(0, current_lifetime − baseline)` per metric; re-inserted each sync — the row grows through the day and replaces itself (ReplacingMergeTree).
- No baseline + video older than 24h → write **snapshot only** (clean-baseline restart for adopted videos, per FILM-1500 decision). No baseline + video < 24h old → attribute lifetime to the publish date.
- Always writes the new `video_snapshots` row last.
- Known approximation (documented): intra-day deltas attribute to the UTC fetch day.

### Unchanged

The revenue upsert into Postgres `revenue_records` (`onConflict publish_id,record_date`) is already idempotent and stays as-is (extended later by FILM-1508).

## 3. Schedule Fix

`schedule.ts` currently puts videos aged 30–90 days on **weekly** sync with the misleading `ageCategory: 'after_90_days'`. Fix tiers:

| Age | Frequency | ageCategory |
|-----|-----------|-------------|
| < 24h | hourly | `first_day` |
| < 7d | every 6 hours | `first_week` |
| < 30d | daily | `first_month` |
| 30–90d | daily | `first_quarter` (new) |
| ≥ 90d | weekly | `after_90_days` |

Update the `ageCategory` union in `server/types.ts` and `getSyncPriority`.

## 4. Postgres Indexes

New Supabase migration (edit `apps/web/supabase/schemas/30-film-studio.sql`, then `db diff` + typegen):

```sql
create index if not exists idx_publishes_published_at
  on public.publishes (published_at desc) where status = 'published';
create index if not exists idx_publishes_status
  on public.publishes (status);
```

Supports `fetchPublishesForSync`'s filter + `published_at DESC` ordering.

## 5. Implementation Map

| File | Change |
|------|--------|
| `packages/features/content-analytics/src/server/analytics-sync-cron.ts` | Replace single-insert block with `ingestYouTubeDaily` / `ingestCumulativeSnapshot`; widen YouTube window; keep batching/rate-limit/token scaffolding. |
| `packages/features/content-analytics/src/server/schedule.ts` | Tier fix above. |
| `packages/features/content-analytics/src/server/types.ts` | `ageCategory` union + `PublishMetadata['sync'].last_data_date`. |
| `apps/web/supabase/schemas/30-film-studio.sql` + migration | Indexes above. |
| `packages/features/content-analytics/src/providers/instagram/*` | While here: re-verify current Instagram insights metric names (Meta deprecated `plays`/`impressions` variants ~2025). |

## 6. Acceptance Criteria

- [ ] Running the sync twice within an hour does NOT change day totals (idempotent)
- [ ] YouTube rows carry real platform data dates, not sync dates
- [ ] TikTok/IG day rows equal lifetime delta vs. previous snapshot, clamped ≥ 0
- [ ] First sync of an adopted (old) TikTok/IG video writes only a baseline snapshot
- [ ] 30–90-day-old videos sync daily
- [ ] New indexes exist; `fetchPublishesForSync` query plan uses them

## 7. Verification

```bash
pnpm --filter @kit/content-analytics test   # delta clamping, baseline, window math
pnpm --filter web supabase migration up && pnpm supabase:web:typegen
curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/analytics/sync  # twice; compare ClickHouse day totals
```
