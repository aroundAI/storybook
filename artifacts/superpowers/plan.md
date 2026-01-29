# Plan: Implement Canon Management System (Phase 10)

## Goal
Implement the Canon Management System per `specs/phase-10-canon-management/` specifications:
- 6 database tables with RLS policies
- ContinuityValidator service (9 rules)
- MemoryContextBuilder service (15% token budget)
- Canon server actions
- LLM role prompt templates
- Integration with story generation pipeline

---

## Assumptions
- Database: PostgreSQL with existing Supabase setup
- User decisions confirmed (Phase 10, opt-in roles, flexible enforcement, 10-episode horizon)
- Fresh start migration (no backfill needed)
- Project already has `@kit/episodes` package for integration
- TypeScript types will be auto-generated via `supabase gen types`

---

## Plan

### Step 1: Create Database Migration (Tables)
**Files**: `apps/web/supabase/migrations/[timestamp]_canon_management.sql`
**Change**: Create 6 tables from FILM-1001:
- `immutable_events`
- `character_states`
- `world_states`
- `narrative_threads`
- `state_deltas`
- `episode_summaries`
**Verify**: 
```bash
pnpm --filter web supabase migration up
# Check: grep -c "create table" apps/web/supabase/migrations/*canon_management*.sql
```

---

### Step 2: Add RLS Policies
**Files**: Same migration file (append) or new migration
**Change**: Add RLS policies from FILM-1002:
- Project-based access control
- Enable RLS on all 6 tables
- Policies for SELECT, INSERT, UPDATE, DELETE
**Verify**:
```bash
# Check policies exist in migration
grep -c "create policy" apps/web/supabase/migrations/*canon_management*.sql
```

---

### Step 3: Generate TypeScript Types
**Files**: `packages/supabase/src/database.types.ts`
**Change**: Regenerate types with new tables:
```bash
cd apps/web && supabase gen types typescript --local > lib/database.types.ts
cp lib/database.types.ts ../../packages/supabase/src/database.types.ts
```
**Verify**:
```bash
grep -c "immutable_events\|character_states\|narrative_threads" packages/supabase/src/database.types.ts
# Expected: >= 3
```

---

### Step 4: Create Canon Types Package
**Files**: `packages/features/episodes/src/lib/canon/types.ts`
**Change**: Create TypeScript interfaces from spec:
- `ImmutableEvent`, `CharacterState`, `WorldState`
- `NarrativeThread`, `StateDelta`, `EpisodeSummary`
- `MemoryContext`, `ContinuityValidationResult`
- `ViolationType`, `ViolationSeverity`, `ContinuityViolation`
**Verify**:
```bash
grep -c "export interface\|export type" packages/features/episodes/src/lib/canon/types.ts
# Expected: >= 10
```

---

### Step 5: Implement MemoryContextBuilder Service
**Files**: `packages/features/episodes/src/lib/services/memory-context-builder.ts`
**Change**: Implement from FILM-1004:
- `buildMemoryContext()` - Main entry point
- Token budget allocation (15% limit)
- Priority-based loading with scoring
- Memory horizon windowing
**Verify**:
```bash
pnpm --filter @kit/episodes typecheck
grep -c "buildMemoryContext\|TokenBudget" packages/features/episodes/src/lib/services/memory-context-builder.ts
```

---

### Step 6: Implement ContinuityValidator Service
**Files**: `packages/features/episodes/src/lib/services/continuity-validator.ts`
**Change**: Implement from FILM-1003:
- `validatePlotSkeleton()` - STORY checkpoint
- `validateSceneBlocks()` - SCREENPLAY checkpoint
- 9 validation rules (CANON_001-009)
- Violation detection and error messages
**Verify**:
```bash
pnpm --filter @kit/episodes typecheck
grep -c "CANON_00" packages/features/episodes/src/lib/services/continuity-validator.ts
# Expected: >= 9
```

---

### Step 7: Create Canon Server Actions
**Files**: `packages/features/episodes/src/server/canon-actions.ts`
**Change**: Implement from FILM-1005:
- `addImmutableEventAction`
- `updateCharacterStateAction`
- `createNarrativeThreadAction`
- `getCanonHealthAction`
- `buildMemoryContextAction`
- `extractCanonChangesAction`
**Verify**:
```bash
pnpm --filter @kit/episodes typecheck
grep -c "export const.*Action" packages/features/episodes/src/server/canon-actions.ts
# Expected: >= 6
```

---

### Step 8: Create LLM Role Prompt Templates
**Files**: `packages/features/prompt-engine/src/prompts/canon-roles/`
**Change**: Create 4 role prompts from FILM-1006:
- `planner-role.json` - Structure, constraints
- `writer-role.json` - Prose generation
- `editor-role.json` - Refinement
- `stylist-role.json` - Polish
**Verify**:
```bash
ls packages/features/prompt-engine/src/prompts/canon-roles/*.json | wc -l
# Expected: 4
```

---

### Step 9: Integrate with story-actions.ts
**Files**: `packages/features/episodes/src/lib/server/mutations/story-actions.ts`
**Change**: 
- Add memory context injection before generation
- Add validation checkpoints after skeleton/scenes
- Add canon extraction on publish (opt-in)
**Verify**:
```bash
grep -c "buildMemoryContext\|validatePlotSkeleton" packages/features/episodes/src/lib/server/mutations/story-actions.ts
# Expected: >= 2
```

---

### Step 10: Export Package Entries
**Files**: `packages/features/episodes/src/index.ts`
**Change**: Export new services and actions:
- Export `buildMemoryContext` from services
- Export `validatePlotSkeleton`, `validateSceneBlocks`
- Export canon actions
**Verify**:
```bash
pnpm --filter @kit/episodes build
# Check for successful build
```

---

### Step 11: Run Full Verification
**Files**: All modified files
**Change**: Run linting, typecheck, and build across workspace
**Verify**:
```bash
pnpm typecheck
pnpm lint
pnpm build
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Migration conflicts | Use timestamp prefix, test on local Supabase first |
| Type generation fails | Ensure Supabase is running, re-run migration up |
| Token counting inaccuracy | Use tiktoken library, add margin buffer |
| Performance issues | Add indexes, batch queries, implement caching |
| Breaking story generation | Add feature flag, default to disabled |

---

## Rollback Plan

1. **Database**: Drop tables via down migration or reset
```bash
pnpm --filter web supabase db reset
```

2. **Code**: Revert changes
```bash
git checkout -- packages/features/episodes/src/lib/services/
git checkout -- packages/features/episodes/src/server/canon-actions.ts
```

3. **Types**: Regenerate without new tables

---

## Summary

| Step | Component | Est. Time |
|------|-----------|-----------|
| 1 | Database Tables | 15 min |
| 2 | RLS Policies | 10 min |
| 3 | TypeScript Types | 5 min |
| 4 | Canon Types | 20 min |
| 5 | MemoryContextBuilder | 45 min |
| 6 | ContinuityValidator | 60 min |
| 7 | Canon Actions | 30 min |
| 8 | LLM Role Prompts | 20 min |
| 9 | story-actions Integration | 30 min |
| 10 | Package Exports | 5 min |
| 11 | Full Verification | 10 min |
| **TOTAL** | | **~4 hours** |
