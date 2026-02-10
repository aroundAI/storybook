# Superpowers Review — FILM-1135 External Context Provider (Post-Fix)

**Branch**: `feature/FILM-1135-external-context-provider`
**Date**: 2026-02-10
**Scope**: 10 new/modified files across types, providers, aggregator, server actions, and 2 SQL migrations
**Previous review findings**: All 4 Majors, 5 Minors, and 2 Nits have been addressed

---

## Blockers
None.

## Majors
None remaining. All 4 original Majors resolved:

| # | Original Finding | Resolution |
|---|-----------------|------------|
| M1 | Singleton never re-initialized after source config changes | ✅ Added `isStale()` with 5-min TTL; `getContextAggregator()` re-inits when stale |
| M2 | Cache writes used RLS-scoped client (could fail due to missing INSERT policy) | ✅ `cacheContent()` now uses `getSupabaseServerAdminClient()` |
| M3 | Duplicate row-to-model mapping in aggregator + server actions | ✅ Extracted shared `rowToExternalContent()`, reused via import |
| M4 | FTS index on expression but `textSearch()` queried `title` column | ✅ New migration adds generated `fts` tsvector column + GIN index; query targets `fts` |

## Minors

### m1 — `ExternalContentRow` does not include `fts` column (Low risk)
**File**: `external-context.ts:191`
The manually defined `ExternalContentRow` interface lacks the new `fts` tsvector column added in the follow-up migration. This is harmless today because:
- The `fts` column is GENERATED ALWAYS and never written/read by application code
- `rowToExternalContent()` maps only the columns it needs
- Supabase `.select('*')` will return it but TS will silently ignore unmapped fields

**Recommendation**: Consider deriving row types from `Database['public']['Tables']` in a future cleanup pass.

### m2 — `ExternalSourceRow` / `ExternalContentRow` could drift from generated types
**File**: `external-context.ts:166-215`
These manually-maintained interfaces mirror the DB schema. If the schema changes and these aren't updated, the mapper will silently produce wrong data.

**Recommendation**: Replace with `Database['public']['Tables']['external_sources']['Row']` and `Database['public']['Tables']['external_content']['Row']` in a future iteration.

## Nits

### n1 — Unused `now` variable in newsapi-provider
**File**: `newsapi-provider.ts:86`
The `now` variable is created but could be inlined since it's only used twice. No functional impact.

### n2 — `as const` assertions on string literal categories
**Files**: All three providers
`'tier_2' as const` and `'news' as SourceCategory` are redundant when the target type is already `ExternalContent`. TypeScript infers correctly. No functional impact.

---

## Summary

The FILM-1135 implementation is **ready to merge**. All 4 original Major findings and all 5 Minor findings from the first review have been addressed. The remaining 2 Minors (m1, m2) are type-drift hygiene items that can be addressed in a future cleanup pass — they carry no runtime risk.

### What's solid
- **Architecture**: Clean provider → aggregator → server-action layering
- **Cache strategy**: Admin client for writes, RLS-scoped reads, TTL-based expiry
- **FTS**: Generated tsvector column with GIN index matches the query path
- **Resilience**: 10s fetch timeouts, rate-limit tracking, error isolation per provider
- **Database**: Both tables have `updated_at` triggers, proper RLS policies, unique constraints

### Next actions
- **None blocking merge** — ship it
- **Future**: Derive `ExternalSourceRow` / `ExternalContentRow` from generated DB types (m1/m2)
