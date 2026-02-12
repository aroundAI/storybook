# Superpowers Review — FILM-1201 ClickHouse Migration

**Branch:** `feature/FILM-1201-clickhouse-migration`
**Scope:** 32 files changed, +2483 / -3293 lines
**Date:** 2026-02-12

---

## Blockers

None.

---

## Majors

### M1 — `queryDailyStats` and `queryDailyTimeSeriesByPlatform` bypass `assertScopedFilters`

**Files:** [queries.ts](file:///Users/shaurya/Work/projects/storybook/packages/clickhouse/src/queries.ts)

`assertScopedFilters()` is called in `queryTotals`, `queryDailyTimeSeries`, and `queryPlatformBreakdown`, but **not** in `queryDailyStats` (line ~311) and `queryDailyTimeSeriesByPlatform` (line ~395). These functions accept `QueryFilters` and would happily scan the entire table if called without filters.

**Fix:** Add `assertScopedFilters(filters)` at the top of both functions, matching the pattern in the other query functions.

---

### M2 — `queryViewsForVideos` uses hardcoded WHERE, not `buildWhereClause`

**File:** [queries.ts](file:///Users/shaurya/Work/projects/storybook/packages/clickhouse/src/queries.ts#L366-L395)

`queryViewsForVideos` hand-writes its WHERE clause instead of calling `buildWhereClause`. While it does have a guard (`if (videoIds.length === 0) return 0`), it skips the centralized filter logic and the `assertScopedFilters` guard. If a future caller passes `projectId` but an empty `videoIds`, the function returns `0` silently — which is arguably fine for this specific function, but the inconsistency is a maintenance risk.

**Fix:** Either add a comment explaining the intentional deviation, or refactor to use `buildWhereClause` + `assertScopedFilters` for consistency.

---

## Minors

### m1 — `publish-actions.ts` still uses dynamic import while other files use static imports

**File:** [publish-actions.ts](file:///Users/shaurya/Work/projects/storybook/packages/features/publishing/src/server/publish-actions.ts#L863-L865)

The review round already fixed m1 (dynamic → static) in `stats-actions.ts`, `route.ts`, and `aggregation-queries.ts`. But `publish-actions.ts` still uses `await import('@kit/clickhouse/server')` inside `getEpisodePublishesAction`. This creates an inconsistency since every other consumer now uses a top-level static import.

**Fix:** Move to a static import at the top of the file. The `try/catch` for ClickHouse unavailability can remain around the query call itself, not the import.

---

### m2 — Empty `catch` blocks silently swallow errors

**Files:**
- [publish-actions.ts](file:///Users/shaurya/Work/projects/storybook/packages/features/publishing/src/server/publish-actions.ts#L867-L869) — `catch { // ClickHouse unavailable }`
- [account-dashboard-actions.ts](file:///Users/shaurya/Work/projects/storybook/packages/features/content-analytics/src/server/account-dashboard-actions.ts#L156-L162) — `catch { // ClickHouse unavailable }`

Both are intentional graceful degradation, which is good design. But they should **at least log** the error so operators can detect ClickHouse outages. A silent swallow risks hiding misconfiguration or query bugs.

**Fix:** Add `getLogger('analytics').warn({ err }, 'ClickHouse unavailable, returning empty data')` in each catch block.

---

### m3 — `analyticsMap` type in `publish-actions.ts` is structurally weaker than `AggregatedTotals`

**File:** [publish-actions.ts](file:///Users/shaurya/Work/projects/storybook/packages/features/publishing/src/server/publish-actions.ts#L856-L859)

The variable is typed as `Map<string, { views; likes; comments; shares; watch_time_seconds }>`, but `queryTotalsByVideoIds` returns `Map<string, AggregatedTotals>` which includes additional fields (`saves`, `revenue_cents`, `subscribers_gained`). The inline type is a subset but forces future maintainers to update it separately.

**Fix:** Import `AggregatedTotals` from `@kit/clickhouse` and type as `Map<string, AggregatedTotals>`.

---

## Nits

### n1 — `formatDate` helper duplicated across multiple files

The pattern `(d: Date) => d.toISOString().split('T')[0]!` appears in:
- `stats-actions.ts` (line ~70)
- `account-dashboard-actions.ts` (lines 109-112)
- `language-analytics.ts` (multiple places)

**Suggestion:** Extract to `@kit/shared/utils` or `@kit/clickhouse` as a shared `formatDateForClickHouse(d: Date): string` utility.

---

### n2 — Comment says "extra_metrics" but audience data returns empty

**File:** [aggregation-queries.ts](file:///Users/shaurya/Work/projects/storybook/packages/features/content-analytics/src/server/aggregation-queries.ts)

In `getProjectAudienceData`, the function now returns essentially no demographic data since `extra_metrics` ingestion doesn't include demographics yet. The function still computes `ageGroups`, `genders`, and `geography` dictionaries that will always be empty. Consider returning `null` early with a TODO, or at minimum log/document that this is a known data gap.

---

### n3 — Migration file uses `IF EXISTS` / `IF NOT EXISTS` — safe but hides errors

**File:** [20260212080000_drop_content_analytics.sql](file:///Users/shaurya/Work/projects/storybook/apps/web/supabase/migrations/20260212080000_drop_content_analytics.sql)

Using `DROP ... IF EXISTS` is safe for idempotency, which is good. No action needed, but be aware this will silently succeed even if the table was already dropped by another migration.

---

## Summary

The migration is well-structured — clean separation between ClickHouse client/queries/types, comprehensive test coverage (340 lines), and correct removal of the legacy `content_analytics` table with proper migration ordering. The `assertScopedFilters` guard pattern is a strong safety net.

### Next Actions

| Priority | Item | Effort |
|----------|------|--------|
| 🔴 High | **M1** — Add `assertScopedFilters` to `queryDailyStats` and `queryDailyTimeSeriesByPlatform` | 2 min |
| 🟡 Medium | **M2** — Add comment or refactor `queryViewsForVideos` for consistency | 5 min |
| 🟡 Medium | **m1** — Standardize `publish-actions.ts` to static import | 2 min |
| 🟡 Medium | **m2** — Add logging to empty catch blocks | 5 min |
| 🟢 Low | **m3** — Use `AggregatedTotals` type in `publish-actions.ts` | 2 min |
| 🔵 Nit | **n1** — Extract shared `formatDate` helper | 10 min |
| 🔵 Nit | **n2** — Document empty audience data gap | 2 min |
