# Superpowers Review: FILM-1130/1131/1132 News System

**Branch**: `feature/FILM-1130-1132-news-system`
**PR**: [#182](https://github.com/aroundAI/storybook/pull/182)
**Scope**: 10 files, 637 insertions

---

## Blockers

None.

---

## Majors

### M1: `discoverTopStories()` makes N LLM calls per article — potential cost explosion
**File**: `news-story-service.ts:149-157`
**Severity**: Major (Performance / Cost)

`clusterByStory()` calls `extractEntitiesFromArticle()` for *every* article in the result set (up to 100 via `pageSize: 100`). Each call hits the LLM. For a single `discoverTopStories()` invocation:
- **100 articles × 1 LLM call each = 100 Gemini calls**
- At $0.10/1M input tokens, this may be acceptable cost-wise but could be slow (~30-60s).

**Recommendation**: Cap entity extraction to top N articles (e.g., 20-30) similar to how `getTopicContext()` caps to 5, or batch entity extraction. At minimum, add a configurable `maxArticlesToExtract` parameter.

```diff
+    private static readonly MAX_EXTRACT = 30;
     private async clusterByStory(...) {
-        const articlesWithEntities = await Promise.all(
-            articles.map(async (article) => ({
+        const toExtract = articles.slice(0, NewsStoryService.MAX_EXTRACT);
+        const articlesWithEntities = await Promise.all(
+            toExtract.map(async (article) => ({
```

### M2: Wildcard query `'*'` may not work with NewsAPI
**File**: `news-story-service.ts:73`
**Severity**: Major (Correctness)

When no `topics` are provided, the search query is `'*'`. NewsAPI's `/everything` endpoint does not support wildcard queries — it requires at least one of `q`, `sources`, or `domains`. This will likely return an error or empty results.

**Recommendation**: When no topics are given, use the `/top-headlines` endpoint pattern or pass a general query like `'breaking news'`, or use the `sources` parameter to fetch latest from seeded sources instead.

### M3: Module-level `new NewsStoryService()` instantiation in server action file
**File**: `news-actions.ts:13`
**Severity**: Major (Reliability)

```typescript
const service = new NewsStoryService();
```

This runs at module load time. If the class constructor had side effects or if the module is imported in edge contexts, this could fail. While the current constructor is empty (class has no constructor), this pattern is fragile. If someone later adds initialization logic, it will run at import time.

**Recommendation**: Use lazy initialization or a factory function similar to `getContextAggregator()`:

```typescript
let _service: NewsStoryService | null = null;
function getNewsStoryService(): NewsStoryService {
    _service ??= new NewsStoryService();
    return _service;
}
```

---

## Minors

### m1: Seed migration lacks `ON CONFLICT` update clause
**File**: `20260211200003_seed_news_sources.sql:50`
**Severity**: Minor

`ON CONFLICT (slug) DO NOTHING` means re-running the migration won't update existing rows if bias labels, rate limits, or descriptions are corrected later. This is intentional for idempotency, but makes source metadata effectively immutable without a new migration.

**Recommendation**: Consider `ON CONFLICT (slug) DO UPDATE SET description = EXCLUDED.description, bias_label = EXCLUDED.bias_label, rate_limit_per_hour = EXCLUDED.rate_limit_per_hour` so re-seeding updates stale metadata.

### m2: `getClusterKey()` produces poor cluster keys for generic news
**File**: `news-story-service.ts:193-206`
**Severity**: Minor (Correctness)

The cluster key is `"person1,person2|org1"`. For large news events (e.g., "US Election"), many different articles will share the same key if they mention the same top 2 people. Conversely, articles about the same story but mentioning different people will split into separate clusters.

This is a known limitation of entity-based clustering and is acceptable for v1, but worth documenting.

### m3: `importance` score is naive
**File**: `news-story-service.ts:184`
**Severity**: Minor

`importance: items.length / articles.length` gives a ratio of articles in cluster vs total — this strongly favors large clusters and penalizes breaking news with only 1-2 articles. Consider incorporating recency, source tier, or a minimum floor.

### m4: Bias balance is asymmetric in seed data
**File**: `20260211200003_seed_news_sources.sql`
**Severity**: Minor

Current bias distribution:
- **Left**: 1 (The Guardian)
- **Center-left**: 4 (BBC, NYT, CNN, NPR)
- **Center**: 4 (Reuters, AP, AFP, Al Jazeera)
- **Center-right**: 1 (WSJ)
- **Right**: 0

The `getBalancedSources()` function groups `left + center_left` together and `right + center_right` together. So:
- Left bucket: 5 sources
- Center bucket: 4 sources
- Right bucket: 1 source

This severely underrepresents the right perspective. Consider adding Fox News (`center_right`/`right`) or The Daily Wire/Daily Telegraph.

---

## Nits

### n1: Prompt JSON `slug` doesn't include category prefix
**Files**: `entity-extraction.json:2`, `topic-summary.json:2`

The `slug` is `"entity-extraction"` but the `templateSlug` used in code is `"news-generation/entity-extraction"`. The `slug` field in the JSON is unused/cosmetic — not a bug, but could confuse someone reading the prompt file in isolation.

### n2: `dedupeByName` keeps first occurrence arbitrarily
**File**: `entity-extractor.ts:100-111`

When deduplicating, the first occurrence wins. If a later extraction has richer metadata (e.g., role or type filled in), it's discarded. Consider preferring the entry with more fields populated.

### n3: `cache-config.ts` `CACHE_TTL_HOURS` comment inconsistency
**File**: `cache-config.ts:14-18`

Some comments use `—` dashes and some use `//`. Minor style inconsistency but all are clear.

### n4: Missing JSDoc return types on public service methods
**File**: `news-story-service.ts`

Public methods `discoverTopStories()` and `getTopicContext()` have TypeScript return types but no JSDoc `@returns` documentation. This is consistent with the codebase style but worth noting.

---

## Summary

**Overall**: Solid implementation that correctly integrates with the existing `ExternalContextAggregator` and `executeLLM` infrastructure. Error handling is consistently best-effort with graceful fallbacks. Types are clean and well-structured.

**Key Strengths**:
- ✅ Best-effort entity extraction with `createEmptyEntities()` fallback
- ✅ Auth-protected server actions with Zod validation
- ✅ Idempotent seed migration
- ✅ Clean separation of concerns (types / config / service / actions)

**Next Actions**:
1. **Fix M1** — Cap entity extraction to ~30 articles max in `clusterByStory()`
2. **Fix M2** — Handle empty topics case (don't use `'*'` wildcard)
3. **Consider M3** — Lazy service instantiation (low risk, easy fix)
4. **Consider m4** — Add at least one right-leaning source to seed for balance

**Verdict**: ✅ **Ship with M1 and M2 fixes** (M3 and minors can follow up)
