# Canon Management System - Implementation Review

> **Review Date**: 2026-01-29  
> **Scope**: `specs/phase-10-canon-management` (FILM-1001 to FILM-1007)

---

## Summary

Phase 10 Canon Management implementation is **partially complete**. Core backend infrastructure (database, types, services, actions) is implemented. However, UI components, integration with existing generation actions, and migration application are **not done**.

| Spec | Status | Notes |
|------|--------|-------|
| FILM-1001 (Canon Tables) | ✅ Done | 6 tables with proper schema |
| FILM-1002 (Canon RLS) | ✅ Done | 8 RLS policies |
| FILM-1003 (ContinuityValidator) | ✅ Done | 9 validation rules |
| FILM-1004 (MemoryContextBuilder) | ✅ Done | Token-budgeted loading |
| FILM-1005 (Canon Actions) | 🟡 Partial | Missing `state_deltas` recording |
| FILM-1006 (LLM Role Separation) | 🟡 Partial | Prompts done, no orchestrator |
| FILM-1007 (UI Components) | ❌ Missing | No components built |

---

## Blockers

| ID | Location | Issue |
|----|----------|-------|
| B-1 | `apps/web/supabase/` | **Migration not applied** - Supabase local instance not running. Tables don't exist in database. | # But its not needed to since we are using Supabase DB at apps/web/.env.localprod
| B-2 | `packages/features/episodes/src` | **`@ts-nocheck` comments** - Both `memory-context-builder.ts` and `canon-actions.ts` use `@ts-nocheck` to bypass type errors. Will cause runtime failures if tables don't exist. |
| B-3 | FILM-1007 | **No UI components built** - All 9 UI components from spec are missing (Canon Dashboard, Events Editor, Threads Visualization, etc.) |

---

## Majors

| ID | Location | Issue | Fix |
|----|----------|-------|-----|
| M-1 | `canon-actions.ts:211-250` | **`state_deltas` not recorded** - Spec (FILM-1005 line 114-121) requires recording state delta on character update. Not implemented. | Add `state_deltas` insert after character state update |
| M-2 | `story-actions.ts` | **No integration with Canon** - ARCHITECTURE.md shows story-actions should call `buildMemoryContext` and `validatePlotSkeleton`. Not integrated. | Call Canon services in story generation flow |
| M-3 | FILM-1006 | **No LLM Role Orchestrator** - Prompts exist but no `runRolePipeline()` function to orchestrate Planner→Writer→Editor→Stylist flow. | Implement orchestrator per spec |

---

## Minors

| ID | Location | Issue |
|----|----------|-------|
| m-1 | `canon-actions.ts:54` | Spec uses `created_by: user.id` but implementation doesn't get current user. Missing auth context. |
| m-2 | `canon-actions.ts:103-146` | `addImmutableEventAction` doesn't create audit log as shown in spec (lines 59-65). |
| m-3 | `types.ts` | `PlotSkeleton` and `SceneBlock` types used by validator but not exported from package index. |
| m-4 | LLM prompts | `planner-role.json` references `memory_context` variable but MemoryContextBuilder returns different structure. |

---

## Nits

| ID | Location | Issue |
|----|----------|-------|
| n-1 | `memory-context-builder.ts` | Token estimation uses magic number `CHARS_PER_TOKEN = 4`. Should be configurable or use tiktoken. |
| n-2 | `continuity-validator.ts` | `checkResurrectionFailure` has TODO comment placeholder (line ~150). |
| n-3 | `canon-actions.ts` | `getCanonHealthAction` returns `characterArcs: 0` hardcoded. |

---

## Next Actions

1. **Start Supabase** and apply migration:
   ```bash
   pnpm supabase:web:start
   pnpm --filter web supabase migration up
   ```

2. **Regenerate types** and remove `@ts-nocheck`:
   ```bash
   pnpm supabase:web:typegen
   ```

3. **Add `state_deltas` insert** to `updateCharacterStateAction`

4. **Integrate Canon with story-actions.ts**:
   - Call `buildMemoryContext` before LLM generation
   - Call `validatePlotSkeleton` on output

5. **Implement UI components** (FILM-1007) - separate ticket recommended

6. **Implement LLM Role Orchestrator** (FILM-1006) - separate ticket recommended
