---
spec_id: FILM-1511
title: Deep-Dive Dashboards & Reports Completion
status: Approved
effort: L
dependencies: FILM-1504, FILM-1505, FILM-1506, FILM-1507, FILM-1508
---

# Deep-Dive Dashboards & Reports Completion

## 1. Overview

Surfaces everything built in FILM-1504…1508 in the dashboards, and closes the report gaps (empty CTR/AVD columns, hardcoded-null retention, never-delivered raw export). Two PRs.

All new components follow the package's Tier A/Tier B convention: containers use TanStack `useQuery` on server actions; leaf cards are pure-prop presentational on the `AnalyticsCard` shell; every dashboard exports an `XSkeleton`; JSDoc on every prop.

## 2. PR 9a — Dashboards

### New Diagnostics tab (`analytics-dashboard.tsx`)

`weekly-diagnostics-table.tsx` — videos published in the last N weeks with impressions, CTR, AVD, avg view %, and a **retention-cliff flag**. Cliff detection is a pure, unit-tested fn in `lib/retention.ts`:

```typescript
export function detectRetentionCliff(
  points: Array<{ elapsedRatio: number; audienceWatchRatio: number }>,
): { position: number; drop: number } | null
// largest consecutive-point drop > 0.15 within the first 25% of the video
```

### New cards

| Component | Data | Placement |
|-----------|------|-----------|
| `retention-curve-chart.tsx` | `queryRetentionCurve` | Diagnostics detail + episode analytics |
| `traffic-share-trend-card.tsx` | `getTrafficShareTrendAction` | Overview: Browse+Suggested share trend |
| `median-views-card.tsx` | `getMedianPerformanceAction` | Median + p25–p75 band vs mean; default = views-to-date by upload month |
| `rolling-90-card.tsx` | `getRolling90Action` | Overview |
| `cohort-curves-chart.tsx` | `getCohortCurvesAction` | Insights: quarter cohorts at 30/90/180/365d |
| `back-catalog-card.tsx` | `getBackCatalogAction` | Insights (donut) |
| `ypp-progress-card.tsx` | `getYppProgressAction` | Overview (2× horizontal-progress; channel-accurate via `channel_daily`) |
| `returning-viewer-proxy-card.tsx` | `getReturningViewerProxyAction` | Audience |
| Tag medians card | `getMedianByTagAction` | Insights |

Account dashboard (`company-dashboard.tsx` via `account-dashboard-actions.ts`): median-views + rolling-90 tiles. Episode analytics (`episode-analytics.tsx`): retention curve + traffic sources.

## 3. PR 9b — Reports

- `csv-generator.ts` — real CTR (from `video_reach_daily`) and AVD (new column) instead of empty strings.
- `report-actions.ts` and `apps/web/app/api/reports/scheduled/route.ts` — replace hardcoded `retentionData: null` with `queryRetentionCurve`; the export-reports retention checkbox becomes real.
- **Monthly raw export**: migration extending `scheduled_reports.report_type` check with `'raw_csv'`; new `raw-export-generator.ts` producing per-video-per-day CSV (metrics ⋈ reach ⋈ traffic ⋈ dim columns) to the existing `reports` bucket; option in `scheduled-reports-manager.tsx`. Delivery cron already live (FILM-1503).

## 4. Acceptance Criteria

- [ ] Diagnostics tab lists recent videos with impressions/CTR/AVD and cliff flags; `detectRetentionCliff` unit-tested
- [ ] All new cards render with data, loading skeletons, and empty states
- [ ] Generated CSV has no empty CTR/AVD columns; retention included when selected
- [ ] `raw_csv` monthly report delivers a complete per-video-per-day export
- [ ] `pnpm --filter web typecheck` passes

## 5. Verification

```bash
pnpm --filter web typecheck && pnpm lint:fix
pnpm --filter @kit/content-analytics test
# Manual: visual pass per dashboard tab; trigger /api/reports/scheduled and open the CSV.
```
