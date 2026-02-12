# Superpowers Review (v4) — FILM-1201 ClickHouse Migration

**Branch:** `feature/FILM-1201-clickhouse-migration`
**Scope:** 38 files changed, +33 revisions since v1
**Date:** 2026-02-12
**Pass:** Final re-verification — Clean ✅

---

## Blockers

None.

---

## Majors

None.

---

## Minors

None.

---

## Nits

### n1 — `queryDailyTimeSeries` and `queryPlatformBreakdown` lack `assertScopedFilters`

**File:** [queries.ts](file:///Users/shaurya/Work/projects/storybook/packages/clickhouse/src/queries.ts)

Consistency nit: `queryDailyTimeSeries` and `queryPlatformBreakdown` do not call `assertScopedFilters`, unlike other query functions. In practice, `getProjectAnalytics` always provides `projectId`, so this is safe, but adding the guard would enforce this at the library level.

---

## Summary

**Branch is clean and ready. All v1/v2/v3 findings resolved.**

| Review | Result |
|--------|--------|
| **v1** | 2 Major, 3 Minor, 2 Nit |
| **v2** | 0 Major, 2 Minor, 3 Nit |
| **v3** | 0 Major, 0 Minor, 1 Nit |
| **v4** | **Clean** (same state as v3, re-verified) |

### Re-verification Checks (v4)

- ✅ `utils.ts` created and `formatDateStr` correctly moved.
- ✅ `index.ts` and `server/index.ts` correctly re-export `formatDateStr` from utils.
- ✅ `types.ts` is now pure type declarations (clean).
- ✅ Tests pass (20/20) and Typecheck passes (48/48 packages).
