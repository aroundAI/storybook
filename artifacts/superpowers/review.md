# Superpowers Review v2: FILM-1130/1131/1132 News System (Post-Fix)

**Branch**: `feature/FILM-1130-1132-news-system`
**PR**: [#182](https://github.com/aroundAI/storybook/pull/182)
**Scope**: 10 files, ~700 lines (after fixes)

---

## Blockers

None.

---

## Majors

None. All 3 prior majors (M1, M2, M3) resolved:

| Prior ID | Issue | Status |
|----------|-------|--------|
| M1 | LLM cost explosion (100 articles) | ✅ Fixed — capped at 30 (`MAX_ARTICLES_TO_EXTRACT`) |
| M2 | Wildcard `'*'` query | ✅ Fixed — uses `'latest news today'` fallback |
| M3 | Module-level instantiation | ✅ Fixed — lazy `getNewsStoryService()` singleton |

---

## Minors

### m1: Duplicate JSDoc block before `clusterByStory`
**File**: `news-story-service.ts:138-145`
**Severity**: Minor (Readability)

There are now two consecutive comment blocks — the original method JSDoc and the new `MAX_ARTICLES_TO_EXTRACT` JSDoc — both sitting before the private static field. The static field JSDoc is wedged between the method JSDoc and the method signature, making it look like they belong together.

```typescript
    /**                          // ← method JSDoc
     * Cluster articles by entity overlap.
     * ...
     */
    /** Max articles to run ... */  // ← field JSDoc (reads awkwardly here)
    private static readonly MAX_ARTICLES_TO_EXTRACT = 30;

    private async clusterByStory( ...
```

**Recommendation**: Move `MAX_ARTICLES_TO_EXTRACT` above the method JSDoc, or collapse into a single comment block.

### m2: Bias balance still slightly uneven
**File**: `20260211200003_seed_news_sources.sql`
**Severity**: Minor (Acceptable for v1)

Updated distribution with 12 sources:
- **Left bucket** (left + center_left): 5 sources (Guardian, BBC, NYT, CNN, NPR)
- **Center bucket** (center + unknown): 4 sources (Reuters, AP, AFP, Al Jazeera)
- **Right bucket** (right + center_right): 3 sources (WSJ, Fox News, Daily Telegraph)

5:4:3 is significantly better than the prior 5:4:1. Acceptable for v1.

---

## Nits

### n1: `countFields` generic typing accepts `Record<string, unknown>` but receives `{ name: string; role?: string }`
**File**: `entity-extractor.ts:116`
**Severity**: Nit

The `countFields` function parameter is typed as `Record<string, unknown>`, which loses the generic `T` type safety from `dedupeByName<T>`. This works correctly at runtime but the type widening is worth noting. Not a bug since `T extends { name: string }` is always assignable to `Record<string, unknown>`.

### n2: Prompt JSON `slug` still doesn't include category prefix
**Files**: `entity-extraction.json:2`, `topic-summary.json:2`
**Severity**: Nit (Carried from v1)

Cosmetic — the `slug` field in JSON is unused by `executeLLM` (which uses `templateSlug`). No fix needed.

---

## Summary

**Overall**: Clean implementation with all prior review findings addressed. The code is well-structured, properly error-handled, and integrates correctly with the existing aggregator and LLM infrastructure.

**Remaining items are cosmetic** (JSDoc ordering, bias balance refinement) and do not warrant blocking the PR.

**Verdict**: ✅ **Ship-ready. No blocking issues.**
