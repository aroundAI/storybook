# Superpowers Review — FILM-1135: External Context Provider Interface

**PR**: [#180](https://github.com/aroundAI/storybook/pull/180)
**Branch**: `feature/FILM-1135-external-context-provider`
**Files Reviewed**: 13 (9 new, 4 modified)

---

## Blockers

None.

---

## Majors

### M1 — Singleton aggregator never re-initializes after source config changes

**File**: [context-aggregator.ts](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/server/services/context-aggregator.ts#L300-L311)

The singleton `getContextAggregator()` initializes once and never refreshes. If an admin activates a new source or deactivates one in the `external_sources` table, the running server will not pick up the change until it restarts. `resetContextAggregator()` exists but nothing calls it.

**Recommendation**: Consider a TTL-based reinitialisation (e.g. refresh every 5 minutes), or expose the reset through an admin action. Alternatively, document this as an intentional trade-off for Phase 11 MVP.

---

### M2 — `cacheContent` uses service-role implicitly but `getSupabaseServerClient()` returns the request-scoped client

**File**: [context-aggregator.ts](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/server/services/context-aggregator.ts#L213-L253)

The `external_content` RLS policies only allow `service_role` to INSERT/UPDATE. If `getSupabaseServerClient()` returns the session-scoped (authenticated) client, the `upsert` in `cacheContent()` will silently fail because the RLS policy blocks it.

**Recommendation**: Verify that `getSupabaseServerClient()` in this codebase returns a service-role client, or use `getSupabaseServerAdminClient()` (if available) specifically for write operations. Same concern applies to the aggregator's `initialize()` reading inactive sources — the SELECT policy on `external_sources` only allows viewing `is_active = true` rows to non-service-role users, but `initialize()` already filters by `is_active`, so this is fine for reads.

---

### M3 — Duplicate row mapping logic between `context-aggregator.ts` and `external-context-actions.ts`

**Files**:
- [context-aggregator.ts L269-294](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/server/services/context-aggregator.ts#L269-L294) (`rowToExternalContent`)
- [external-context-actions.ts L183-206](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/server/external-context-actions.ts#L183-L206) (inline mapping)

The `ExternalContentRow → ExternalContent` mapping is duplicated. Any schema addition (e.g. a new column) will require updating both places.

**Recommendation**: Export `rowToExternalContent` from the aggregator (or a shared mapper module) and reuse in the server action.

---

### M4 — `textSearch` on `title` may not hit the FTS index

**File**: [context-aggregator.ts L181](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/server/services/context-aggregator.ts#L181)

The migration creates a composite FTS index on `title || ' ' || COALESCE(description, '')`, but the Supabase `textSearch('title', ...)` only searches the `title` column. The GIN index is on the concatenated expression, not on `title` alone, so Postgres may do a sequential scan instead of using the index.

**Recommendation**: Either create a generated `tsvector` column and index that, or change the query to use `rpc()` with a raw `to_tsvector(...) @@ websearch_to_tsquery(...)` call that matches the index expression.

---

## Minors

### m1 — Stale `NOTE` comments should be removed

**Files**:
- [context-aggregator.ts L44](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/server/services/context-aggregator.ts#L44)
- [context-aggregator.ts L171](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/server/services/context-aggregator.ts#L171)
- [external-context-actions.ts L95](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/server/external-context-actions.ts#L95)
- [external-context-actions.ts L172](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/server/external-context-actions.ts#L172)

Comments like `"NOTE: external_sources table is FILM-1135 — types will be generated after migration."` are now stale since types have been regenerated. They should be removed.

---

### m2 — `EMPTY_ENTITIES.extractedAt` is shared mutable state

**File**: [external-context.ts L40-47](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/types/external-context.ts#L40-L47)

`EMPTY_ENTITIES` is exported as a module-level constant with `extractedAt: new Date()`. This means:
- The `Date` object is captured once at module load time, not at call time.
- Every provider does `{ ...EMPTY_ENTITIES, extractedAt: now }` which correctly overrides it, but the exported constant itself is misleading.

**Recommendation**: Either change `EMPTY_ENTITIES` to a factory function `createEmptyEntities()` or document that `extractedAt` must always be overridden by consumers.

---

### m3 — No timeout on external HTTP fetches

**Files**: All three provider `fetchContent` methods.

The `fetch()` calls to NewsAPI, Semantic Scholar, and Archive.org don't set a timeout. If an upstream API hangs, the server action will hang indefinitely.

**Recommendation**: Use `AbortSignal.timeout(10000)` (or a configurable duration) in the fetch options:
```ts
const response = await fetch(url.toString(), {
    headers: { ... },
    signal: AbortSignal.timeout(10_000),
});
```

---

### m4 — `fetchedNew` in `AggregatorSearchResult` returns cached count, not fetched count

**File**: [context-aggregator.ts L107-118](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/server/services/context-aggregator.ts#L107-L118)

```ts
const cachedCount = await this.cacheContent(freshContent);
// ...
fetchedNew: cachedCount,  // This is the number of rows upserted, not fetched
```

The variable name `cachedCount` and the field name `fetchedNew` are semantically misaligned. `fetchedNew` should be `freshContent.length` (items fetched from providers). `cachedCount` is really the number that were successfully persisted to cache.

---

### m5 — Missing `updated_at` field in `cacheContent` upsert mapping

**File**: [context-aggregator.ts L218-240](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/server/services/context-aggregator.ts#L218-L240)

The `external_content` table has an `updated_at` column, but the upsert mapping doesn't set it. For new inserts this defaults to `null`, and for upserts (on conflict) the `updated_at` won't be refreshed since there's no trigger on `external_content` (only `external_sources` has the `updated_at` trigger).

**Recommendation**: Either add `updated_at: new Date().toISOString()` to the upsert mapping, or add a `BEFORE UPDATE` trigger on `external_content` similar to the one on `external_sources`.

---

## Nits

### n1 — `ExternalContentRow` duplicates generated Supabase types

**File**: [external-context.ts L188-213](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/types/external-context.ts#L188-L213)

Now that types are generated, `ExternalContentRow` and `ExternalSourceRow` could be derived from `Database['public']['Tables']['external_content']['Row']` instead of manually maintained. This would auto-sync with schema changes.

---

### n2 — `id: ''` in provider return values is a magic sentinel

**Files**: All three providers set `id: ''` in mapped results.

While the comment says "Set by cache manager on insert", a more explicit approach would be to make `id` optional on the input type or use a `NewExternalContent` (Omit<ExternalContent, 'id'>) type for provider returns.

---

### n3 — Provider barrel export includes `BaseExternalProvider` which shouldn't be directly instantiated

**File**: [providers/index.ts](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/server/providers/index.ts)

`BaseExternalProvider` is abstract and only needed for subclassing. Exporting from the barrel is fine for extensibility but could be clarified with a comment.

---

### n4 — `page` parameter naming inconsistency

The Archive.org API uses `page` for pagination, but Semantic Scholar uses `offset`. Both are correctly handled, but `ExternalSearchParams.page` is 1-indexed. Worth a JSDoc on the `page` field noting this convention.

---

## Overall Summary

FILM-1135 is a solid foundational implementation. The architecture (provider interface → aggregator → cache → server actions) is clean and extensible. The database migration has proper RLS, indexes, and triggers. Type safety is good after the typegen cleanup.

**Key areas to address before merge:**

| Priority | Item | Effort |
|----------|------|--------|
| 🟡 Major | M2 — Verify `getSupabaseServerClient()` grants service-role for writes | ~30 min |
| 🟡 Major | M3 — Extract shared `rowToExternalContent` mapper | ~15 min |
| 🟡 Major | M4 — FTS index/query mismatch | ~30 min |
| 🔵 Minor | m1 — Remove stale NOTE comments | ~5 min |
| 🔵 Minor | m3 — Add fetch timeouts | ~10 min |
| 🔵 Minor | m4 — Fix `fetchedNew` semantics | ~5 min |
| 🔵 Minor | m5 — Add `updated_at` to upsert or add trigger | ~10 min |

**Recommended next actions:**
1. Address M2 first (potential silent data loss if writes are blocked by RLS)
2. Fix M3 and M4 (correctness and performance)
3. Clean up m1/m3/m4/m5 (quick wins)
4. M1 and nits can be deferred to a follow-up
