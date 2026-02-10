# Superpowers Review — FILM-1135 External Context Provider

**Branch**: `feature/FILM-1135-external-context-provider`
**Commits**: 13 | **Files**: 18 | **Lines**: +1688 / -98
**Date**: 2026-02-10

---

## Blockers

**None.**

---

## Majors

### M1 — Redundant migration `20260211200002` after initial migration fix

**File**: `20260211200002_restrict_external_sources_rls.sql`
**Severity**: Major (deploy hygiene)

The initial migration `20260211200000` was fixed in-place to include `TO authenticated`, but the follow-up migration `20260211200002` still exists and drops+recreates the same policy. This results in:
1. The first migration creates the correct policy (`TO authenticated`)
2. The third migration drops it and recreates an identical policy with a different name

**Impact**: No functional harm (both are `TO authenticated`), but the third migration is dead weight and the final policy name ("Authenticated users can view active sources") differs from the one in the initial migration ("Anyone can view active sources"). This inconsistency could confuse future schema audits.

**Recommendation**: Delete `20260211200002_restrict_external_sources_rls.sql` entirely, since the fix is already in `20260211200000`. Alternatively, if preserving migration history is preferred, add a comment explaining it's a no-op.

---

### M2 — Singleton state leak across Lambda invocations

**File**: `context-aggregator.ts:331`

```typescript
let aggregatorInstance: ExternalContextAggregator | null = null;
```

Module-level singletons persist across warm Lambda invocations. The `isStale()` check (5 min TTL) mitigates this, but the `providers` Map also holds **mutable rate-limit state** (via `BaseExternalProvider.rateLimitRemaining`). If a provider gets rate-limited in invocation A, subsequent requests routed to the same warm instance inherit that state, potentially skipping an available provider.

**Impact**: Low in practice (TTL resets the whole instance), but the rate-limit state was designed for per-request lifecycle, not cross-request persistence.

**Recommendation**: Either reset rate-limit counters in `initialize()`, or document that Lambda warm-start sharing is intentional for the 5-min window.

---

## Minors

### m1 — `category` column not validated at DB level in `external_content`

**File**: `20260211200000_create_external_context_tables.sql:77`

`external_sources.category` has a `CHECK` constraint, but `external_content.category` does not. Since category is denormalized for performance, a CHECK ensures data integrity even if the app layer has a bug.

**Recommendation**: Add `CHECK (category IN ('news','research','encyclopedia','historical','official','multimedia'))` to `external_content.category`.

---

### m2 — `entities` JSON round-trip via `JSON.parse(JSON.stringify(...))`

**File**: `context-aggregator.ts:292`

```typescript
entities: JSON.parse(JSON.stringify(c.entities)) as Json,
```

This works but is wasteful. The only non-serializable value in `ExtractedEntities` is `extractedAt: Date`, which `JSON.stringify` converts to an ISO string automatically. A manual conversion of `extractedAt` would avoid the full deep-clone.

**Recommendation**: Consider `{ ...c.entities, extractedAt: c.entities.extractedAt.toISOString() }` instead.

---

### m3 — Missing `AbortSignal.timeout` fallback for older runtimes

**Files**: All 3 providers

`AbortSignal.timeout(10_000)` is used in all three providers. This requires Node 17.3+ / modern Edge runtimes. Since the project targets Next.js 15 on AWS Lambda, this should be fine, but if any provider runs in an older Node context, it will throw.

**Recommendation**: No change needed for current target, but add a brief comment noting the Node 17.3+ requirement.

---

### m4 — `id: ''` placeholder in freshly-fetched content

**Files**: All 3 providers (e.g., `newsapi-provider.ts:90`)

```typescript
id: '', // Set by cache manager on insert
```

The `ExternalContent.id` is typed as `string` (not optional), so downstream code that reads `.id` before caching will get an empty string. This is documented with a comment but could cause subtle bugs if content is used before being cached.

**Recommendation**: Consider using `crypto.randomUUID()` as a client-side temporary ID, or make `id` optional (`id?: string`) in the type.

---

### m5 — Hardcoded `credibilityTier` per provider

**Files**: All 3 providers

Each provider hardcodes its credibility tier (`'tier_1'`, `'tier_2'`). The `external_sources` table has a `credibility_tier` column, but it's not passed to providers during construction.

**Recommendation**: Pass `credibilityTier` from the source row into the provider constructor for configurability. Current hardcoding is a reasonable V1 approach, but note it in the README.

---

## Nits

### n1 — Import placement

**File**: `external-context.ts:169`

The `import type { Database }` at line 169 is at the bottom of the file, after all type definitions. Conventional style places imports at the top.

---

### n2 — `response.statusText` may be empty

**Files**: All 3 providers

HTTP/2 does not guarantee `statusText`. The error message `${response.status} ${response.statusText}` may end with a trailing space.

**Recommendation**: Use `${response.status}${response.statusText ? ' ' + response.statusText : ''}`.

---

### n3 — Provider barrel export is minimal

**File**: `providers/index.ts`

Only re-exports the three concrete providers and the base class. If consumers need to import `createEmptyEntities` or `SOURCE_CATEGORIES` they must go through the types path.

---

### n4 — `peerReviewed: true` hardcoded for Semantic Scholar

**File**: `semantic-scholar-provider.ts:101`

Not all Semantic Scholar results are peer-reviewed (preprints, ArXiv papers). This is a reasonable V1 default but may be refined later.

---

## Summary

| Severity | Count |
|----------|-------|
| Blocker  | 0     |
| Major    | 2     |
| Minor    | 5     |
| Nit      | 4     |

**Overall Assessment**: The feature is well-structured with clean separation (types → base → providers → aggregator → actions). Security posture is solid: all actions require `auth: true`, RLS is locked to `authenticated` + `service_role`, and SHA-256 is used for external IDs. The cache-first search strategy with TTL-based expiry is a pragmatic design.

### Next Actions

1. **M1**: Remove or annotate the redundant `20260211200002` migration
2. **M2**: Reset rate-limit counters in `initialize()` or document Lambda warm-start behavior
3. **m1**: Add CHECK constraint on `external_content.category` (can be a follow-up migration)
4. Remaining minors/nits are optional improvements for a future iteration
