# Performance Optimization Plan

## Executive Summary
A comprehensive audit of the StoryBook codebase has identified critical bottlenecks in API reliability, data fetching architecture, and infrastructure configuration. This plan outlines specific, high-impact changes to achieve sub-second response times and robust background processing.

## 1. Reliability Fixes (Critical)

### `batch-actions.ts`: Fix "Fire-and-Forget" Anti-Pattern
**Issue:** The `batchGenerateDialogueAction` currently triggers `processBatchInBackground` without awaiting it. In a Serverless/Lambda environment, the execution context is frozen immediately after the response is sent, causing background tasks to fail silently.
**Fix:** Replace the unawaited function call with the existing `queueLlmJob` (SQS) system. This ensures durable processing decoupled from the HTTP request lifecycle.

## 2. Waterfall Elimination (High Impact)

### `EpisodeWorkspaceLayout`: Flatten Triple Waterfall
**Location:** `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/layout.tsx`
**Current Flow:**
1. Fetch Project (await)
2. Fetch Episode (await)
3. Fetch Shots (await)
**Optimization:** Replace with a single Supabase query using Foreign Key joins:
```typescript
.select(`
  *,
  projects!inner(*),
  season:seasons(*),
  shots(*)
`)
```
**Impact:** Reduces database round-trips from 3 to 1, significantly improving workspace load time.

### Public Pages: Parallel Data Fetching
**Location:** `apps/web/app/(public)/[...slug]/page.tsx`
**Current Flow:** Sequential fetches for Company -> Project -> Episode.
**Optimization:** Implement `getPublicEpisodeBySlugs` to fetch the entire hierarchy in one optimized query, or parallelize the lookups using `Promise.all`.

### Root Layout: Parallelize Global Fetches
**Location:** `apps/web/app/layout.tsx`
**Optimization:** Wrap `createI18nServerInstance`, `getRootTheme`, and `getCspNonce` in `Promise.all` to execute them concurrently instead of sequentially.

## 3. Server Action Optimization

### `shot-list-actions.ts`: Parallelize Auth & Data
**Issue:** Sequentially awaits `requireUser()` and then the database query.
**Fix:** Use `Promise.all([requireUser(), dbQuery])` to overlap the authentication check latency with the database read latency.

## 4. Infrastructure & Caching

### Redis Configuration
**Issue:** Production caching configuration needs verification.
**Action:** Ensure `sst.config.ts` propagates `REDIS_URL` and `CACHE_REDIS_URL` to the Lambda environment, and that `@kit/cache` is configured to use Redis in production (`CACHE_PROVIDER=redis`).

### Caching Strategy
**Recommendation:** Implement `unstable_cache` for public-facing data (marketing pages, public profiles) to leverage the Next.js Data Cache and reduce database load.

---

## Execution Checklist

- [ ] Refactor `batch-actions.ts` (SQS Integration)
- [ ] Optimize `EpisodeWorkspaceLayout` (Single Query)
- [ ] Optimize Public Page Queries
- [ ] Parallelize `shot-list-actions.ts`
- [ ] Verify/Update Redis Config in `sst.config.ts`
