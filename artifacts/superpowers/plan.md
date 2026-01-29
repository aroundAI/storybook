# Superpowers Plan: Finish Canon Management

## Goal

Complete Phase 10 Canon Management by implementing remaining UI components and advanced server actions per specs in `specs/phase-10-canon-management/`.

## Assumptions

1. Database tables and RLS policies are complete (FILM-1001, FILM-1002)
2. Core server actions exist in `canon-actions.ts` (CRUD working)
3. LLM role prompts exist in `canon-roles/` (all 4 files confirmed)
4. Basic Canon Dashboard exists in Story sidebar
5. Branch `feature/FILM-1001-canon-management` is up to date

## Plan

---

### Step 1: Add Canon Health Badge to Episode Header

**Files**:
- [NEW] `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/_components/canon-health-badge.tsx`
- [MOD] `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/layout.tsx`

**Change**:
- Create `CanonHealthBadge` component showing OK/Warning/Error status
- Displays violation count from `getProjectCanonAction`
- Add to episode header layout

**Verify**:
```bash
pnpm --filter web typecheck
```

---

### Step 2: Add Memory Context Preview to Ideation Tab

**Files**:
- [NEW] `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/ideation/_components/memory-context-preview.tsx`
- [MOD] `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/ideation/_components/story-ideation.tsx`

**Change**:
- Create collapsible panel showing what AI knows
- Display immutable facts, active threads, character states
- Show token budget bar (used/max)
- Uses `buildEpisodeContextAction`

**Verify**:
```bash
pnpm --filter web typecheck
```

---

### Step 3: Add validateContentInlineAction Server Action

**Files**:
- [MOD] `packages/features/episodes/src/server/canon-actions.ts`

**Change**:
- Add `validateContentInlineAction` that checks story text against canon rules
- Returns violations with severity, suggestions
- Uses `continuity-validator.ts` functions

**Verify**:
```bash
pnpm --filter web typecheck
```

---

### Step 4: Add Inline Violation Warnings to Story Tab

**Files**:
- [NEW] `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/story/_components/inline-violation-warning.tsx`
- [MOD] `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/story/_components/story-screen.tsx`

**Change**:
- Create warning banner component that displays violations
- Call `validateContentInlineAction` on story content changes (debounced)
- Show actionable suggestions

**Verify**:
```bash
pnpm --filter web typecheck
```

---

### Step 5: Add Canon Extraction Actions for Publish

**Files**:
- [MOD] `packages/features/episodes/src/server/canon-actions.ts`

**Change**:
- Add `extractCanonChangesAction` - analyzes episode content for canon-worthy events
- Add `commitCanonChangesAction` - persists extracted changes to canon tables
- Returns structured list of detected events/threads/state changes

**Verify**:
```bash
pnpm --filter web typecheck
```

---

### Step 6: Add Episode Summary Generator to Publish Tab

**Files**:
- [NEW] `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/publish/_components/episode-summary-generator.tsx`
- [MOD] `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/publish/_components/publish-screen.tsx`

**Change**:
- Component to generate/review episode summary before publish
- Shows extracted canon changes for review
- Uses `extractCanonChangesAction`

**Verify**:
```bash
pnpm --filter web typecheck
```

---

### Step 7: Update Spec Statuses

**Files**:
- [MOD] `specs/phase-10-canon-management/database/FILM-1001-canon-tables.md`
- [MOD] `specs/phase-10-canon-management/database/FILM-1002-canon-rls-policies.md`
- [MOD] `specs/phase-10-canon-management/server/FILM-1005-canon-server-actions.md`
- [MOD] `specs/phase-10-canon-management/prompts/FILM-1006-llm-role-separation.md`
- [MOD] `specs/phase-10-canon-management/ui/FILM-1007-canon-ui-components.md`

**Change**:
- Update frontmatter `status: draft` → `status: implemented`

**Verify**:
```bash
grep -r "status:" specs/phase-10-canon-management/ | head -10
```

---

### Step 8: Run Full Verification and Commit

**Files**: None (verification only)

**Change**:
- Run typecheck, lint
- Commit all changes
- Push to branch

**Verify**:
```bash
pnpm --filter web typecheck && pnpm --filter web lint && git status
```

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Continuity validator missing functions | Medium | Check existing exports in `continuity-validator.ts` before Step 3 |
| Episode layout structure differs from expected | Low | View layout.tsx before modifying |
| Token counting not implemented | Medium | Use simple word-count estimate if `countTokens` unavailable |

## Rollback Plan

1. All changes on feature branch - can revert commits
2. No database changes required
3. Existing functionality unaffected (additive changes only)

---

**Estimated Total Time**: 3-4 hours

**Scope Note**: Continuity Sidebar (Component 7 in spec) deferred - complex timeline visualization better suited for dedicated ticket.
