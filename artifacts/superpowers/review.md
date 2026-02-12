# Superpowers Review — Phase 4 ClickHouse Migration Cleanup

**Scope**: 19 files changed, −1790 / +926 lines
**Branch**: `feature/FILM-1201-clickhouse-migration`

---

## Blockers

*None found.*

---

## Majors

### M1. `buildWhereClause` returns `WHERE 1 = 1` when no filters given — full table scan risk

**File**: [queries.ts](file:///Users/shaurya/Work/projects/storybook/packages/clickhouse/src/queries.ts#L82-L84)
**Severity**: Major

If `queryTotals({})` is called with zero filters, the generated SQL becomes `SELECT … FROM video_daily_stats WHERE 1 = 1`, scanning the **entire** table. In production with millions of rows this could be expensive and slow.

**Recommendation**: Add a guard at the top of `queryTotals` / `queryDailyTimeSeries` / etc. that throws or returns empty if no meaningful filters are provided (at minimum one of `projectId` or `videoIds` should be required).

```diff
+ if (!filters.projectId && (!filters.videoIds || filters.videoIds.length === 0)) {
+   throw new Error('At least projectId or videoIds must be provided');
+ }
```

### M2. `queryTotalsByVideoIds` uses unsafe type cast

**File**: [queries.ts](file:///Users/shaurya/Work/projects/storybook/packages/clickhouse/src/queries.ts#L487-L491)
**Severity**: Major

```typescript
return queryPerVideoTotals({
    videoIds,
    startDate: options?.startDate,
    endDate: options?.endDate,
} as QueryFilters & { videoIds: string[] });
```

The `as` cast bypasses TypeScript's structural checks. Since `QueryFilters.projectId` is now optional, this cast is unnecessary — the object already satisfies `QueryFilters`. However `queryPerVideoTotals` requires `QueryFilters & { videoIds: string[] }` which means it expects `videoIds` to be non-optional. The cast hides that the `projectId` field is missing from the object.

**Recommendation**: Remove the cast; the type should already work since `projectId` is optional. If it doesn't, fix the type signature of `queryPerVideoTotals` instead.

### M3. No `try/catch` around ClickHouse calls in `account-dashboard-actions.ts`

**File**: [account-dashboard-actions.ts](file:///Users/shaurya/Work/projects/storybook/packages/features/content-analytics/src/server/account-dashboard-actions.ts#L106-L140)
**Severity**: Major

The `getAccountDashboardData` function makes 5 parallel ClickHouse calls via `Promise.all`. If ClickHouse is down, this throws an unhandled error that propagates to the user. Other files (e.g., `page.tsx`, `publish-actions.ts`) correctly wrap ClickHouse calls in `try/catch` with zero-value fallbacks.

**Recommendation**: Wrap the `Promise.all` block in a `try/catch` and return `getEmptyDashboardData()` on failure, matching the graceful degradation pattern used elsewhere.

---

## Minors

### m1. Inconsistent ClickHouse import style — dynamic vs static

Some files use `await import('@kit/clickhouse/server')` (dynamic), others use static top-level imports. This creates an inconsistent pattern:

| File | Import Style |
|------|-------------|
| `stats-actions.ts` | Dynamic `await import(…)` |
| `publish-actions.ts` | Dynamic `await import(…)` |
| `page.tsx` | Dynamic `await import(…)` |
| `route.ts` | Dynamic `await import(…)` |
| `account-dashboard-actions.ts` | Static `import { … } from …` |
| `aggregation-queries.ts` | Static `import { … } from …` |
| `language-analytics.ts` | Static `import { … } from …` |

**Recommendation**: Prefer static imports for all server-only files (they already have `@kit/clickhouse` as a dependency). Dynamic imports add unnecessary async overhead and complexity. Reserve dynamic imports for truly optional/conditional loading only.

### m2. `retentionData: null as Record<string, number> | null` — assertion smell

**File**: [route.ts](file:///Users/shaurya/Work/projects/storybook/apps/web/app/api/reports/scheduled/route.ts#L234)

Using `null as Record<string, number> | null` is a type assertion that masks the real issue — the object literal type doesn't match `AnalyticsDataRow`. A cleaner fix would be to declare an explicit temporary variable or add return type annotation.

### m3. `content_analytics` still referenced once in `@kit/content-analytics` package.json description

**File**: Check `packages/features/content-analytics/package.json` — the description or README may still mention the old table.

---

## Nits

### n1. `formatDate` helper is re-declared in 2 places

Both `stats-actions.ts` (line 71) and `route.ts` define a local `formatDate` closure. Consider extracting to a shared utility.

### n2. Migration timestamp `20260212080000` is in the future year 2026

The migration has a year-2026 timestamp prefix. While harmless for ordering, it may confuse developers who expect real timestamps.

### n3. `1 = 1` WHERE clause generates slightly inefficient SQL

While ClickHouse optimizes `WHERE 1 = 1` away, it's unconventional. A cleaner approach is to only prepend `WHERE` when conditions exist:

```diff
- clause: conditions.length > 0 ? conditions.join(' AND ') : '1 = 1',
+ clause: conditions.length > 0
+     ? 'WHERE ' + conditions.join(' AND ')
+     : '',
```

(with the `WHERE ` prefix moved into this function from the callers)

---

## Summary

The migration is **structurally sound** — all `from('content_analytics')` Supabase queries are gone, replaced with ClickHouse equivalents using the correct query functions. The migration SQL is clean with proper ordering (policies → indexes → table). The database types have been regenerated successfully.

**Key strengths:**
- Clean separation: metadata from Supabase, metrics from ClickHouse
- Proper `Promise.all` parallelism for multi-query patterns
- Graceful degradation with `try/catch` in most consumer files
- Empty-data early returns prevent unnecessary ClickHouse calls

**Key risks:**
- Full table scan possible if `buildWhereClause` receives empty filters (M1)
- Missing `try/catch` in dashboard actions could crash if ClickHouse is down (M3)
- Unnecessary type cast in `queryTotalsByVideoIds` (M2)

### Next Actions

1. **Fix M1** — Add guard clause to prevent unfiltered ClickHouse queries
2. **Fix M3** — Add `try/catch` with `getEmptyDashboardData()` fallback
3. **Fix M2** — Remove the `as` cast
4. **Consider m1** — Standardize on static imports for server files
5. Commit and push
