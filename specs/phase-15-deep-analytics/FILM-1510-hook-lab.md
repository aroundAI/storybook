---
spec_id: FILM-1510
title: Hook Lab Implementation (FILM-1301 folded in)
status: Approved
effort: L
dependencies: FILM-1505, FILM-1506, FILM-1507, FILM-1301
---

# Hook Lab Implementation (FILM-1301 folded in)

## 1. Overview

Implements the Hook Testing Engine from FILM-1301 using the **Hybrid** approach (§9.6): the "free" aggregate half is already delivered by FILM-1507's `hook_type` taxonomy dimension + `queryMedianByTag`; this spec adds deliberate A/B hook experiments with retention thresholds.

Key architectural change vs the original FILM-1301 draft: **no dedicated `hook_retention_metrics` ClickHouse table**. Retention comes from the generic `video_retention_curves` (FILM-1505) interpolated against `video_dim.duration_seconds` (FILM-1506).

## 2. Reuse from the shelved branch

`feature/FILM-1301-hook-testing-engine` (per FILM-1301 §9.5) contains a typechecking implementation: hook schema SQL, types/schemas/scoring in `@kit/episodes`, CRUD actions, prompt template. **Evaluate branch freshness first** (`git log`); cherry-pick if clean, otherwise use as reference. Renumber its schema file to `71-hook-testing.sql` (66–69 are taken by this phase). **Drop its `002_hook_retention.ts` migration entirely.**

## 3. Retention Computation

`packages/features/content-analytics/src/server/hook-retention.ts`:

```typescript
export async function computeVariantRetention(publishId: string): Promise<{
  retention1s: number; retention3s: number; retention5s: number; retentionFull: number;
} | null>
```

Interpolates the video's retention curve at `elapsed_ratio = t / duration_seconds` for t ∈ {1, 3, 5}; caches onto `hook_variants.retention_3s` / `retention_full`. Winner auto-declared when `retention_3s ≥ hook_tests.viral_threshold` (default 0.75), reusing the branch's scoring logic.

## 4. Implementation Map

| File | Purpose |
|------|---------|
| `apps/web/supabase/schemas/71-hook-testing.sql` | `hook_tests` + `hook_variants` (from branch, renumbered). |
| `packages/features/content-analytics/src/server/hook-retention.ts` | Curve interpolation + caching (new). |
| Hook CRUD actions | From branch, rewired to the new retention source. |
| `apps/web/app/home/[account]/studio/[projectSlug]/hooks/page.tsx` | Workbench route + sidebar entry. |
| `components/hooks/hook-test-list.tsx`, `hook-workbench.tsx`, `retention-comparison-chart.tsx` | UI; chart reuses `components/charts/sparkline-area`. |

## 5. Acceptance Criteria

- [ ] Hook test with 2+ variant publishes computes retention_3s matching hand-interpolated curve values
- [ ] Winner auto-declared at threshold; live comparison graph overlays variants
- [ ] Winning hooks archive (>threshold) is queryable
- [ ] `hook_type` tag medians (FILM-1507) visible alongside experiment results
- [ ] FILM-1301 spec updated: status Implemented, §10 acceptance criteria checked

## 6. Verification

```bash
pnpm --filter web supabase migration up && pnpm supabase:web:typegen
pnpm --filter @kit/content-analytics test   # interpolation unit tests
# Manual: seed two variant publishes with distinct curves; verify winner declaration.
```
