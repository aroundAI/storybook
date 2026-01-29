# Superpowers Plan: Complete Canon Management Integration

## Goal

Integrate the 4 new Canon Management components into their parent screens and fix review issues (M1, m3, n1) so the feature is fully working.

## Assumptions

1. All 4 components exist and pass typecheck
2. Parent screens exist: `layout.tsx`, `story-screen.tsx`, `publish-screen.tsx`
3. Components need projectId/episodeId which are available in context
4. Branch `feature/FILM-1001-canon-management` is up to date

## Plan

---

### Step 1: Integrate CanonHealthBadge into Episode Header

**Files**:
- [MOD] `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/_components/episode-workspace-header.tsx`

**Change**:
- Import `CanonHealthBadge` from `./canon-health-badge`
- Find the episode header badges area (near status badge)
- Add `<CanonHealthBadge projectId={project.id} />` next to existing badges
- Pass projectId from the component props

**Verify**:
```bash
pnpm --filter web typecheck
```

---

### Step 2: Integrate InlineViolationWarning into StoryScreen

**Files**:
- [MOD] `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/story/_components/story-screen.tsx`

**Change**:
- Import `InlineViolationWarning` from `./inline-violation-warning`
- Add component above story content area (around line 300-350 in JSX)
- Pass props: `projectId={episode.projectId}`, `episodeId={episode.id}`, `storyContent={storyData?.story || ''}`
- Only render when storyData exists: `{storyData?.story && <InlineViolationWarning ... />}`

**Verify**:
```bash
pnpm --filter web typecheck
```

---

### Step 3: Integrate EpisodeSummaryGenerator into PublishScreen

**Files**:
- [MOD] `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/publish/_components/publish-screen.tsx`

**Change**:
- Import `EpisodeSummaryGenerator` from `./episode-summary-generator`
- Add component in the publish screen above or below MasterAssetManager (around line 100-150 in JSX)
- Pass props: `projectId={episode.projectId}`, `episodeId={episode.id}`, `episodeNumber={episode.number}`, `season={episode.season?.number || 1}`, `storyContent={episode.storyData?.story || ''}`

**Verify**:
```bash
pnpm --filter web typecheck
```

---

### Step 4: Fix Metadata Merge in commitCanonChangesAction

**Files**:
- [MOD] `packages/features/episodes/src/server/canon-actions.ts`

**Change**:
- In `commitCanonChangesAction` (around line 962-970)
- Before updating, fetch existing metadata: 
  ```ts
  const { data: existing } = await client.from('episodes').select('metadata').eq('id', data.episodeId).single();
  ```
- Merge with new values:
  ```ts
  .update({
      metadata: {
          ...(existing?.metadata || {}),
          canonSummary: data.changes.episodeSummary,
          sentimentScore: data.changes.sentimentScore,
      },
  })
  ```

**Verify**:
```bash
pnpm --filter web typecheck
```

---

### Step 5: Fix Unused Import and Minor Issues

**Files**:
- [MOD] `apps/web/.../publish/_components/episode-summary-generator.tsx`
- [MOD] `apps/web/.../story/_components/inline-violation-warning.tsx`

**Change**:
- episode-summary-generator.tsx: Remove `Check` from lucide imports (line 8)
- inline-violation-warning.tsx: Extract debounce constant:
  ```ts
  const VALIDATION_DEBOUNCE_MS = 1500;
  // Then use in setTimeout
  ```

**Verify**:
```bash
pnpm --filter web lint --fix && pnpm --filter web typecheck
```

---

### Step 6: Run Full Verification and Commit

**Files**: None (verification only)

**Change**:
- Run typecheck, lint
- Manually verify in browser: navigate to episode, check Story tab shows warnings, check Publish tab shows summary generator
- Commit and push

**Verify**:
```bash
pnpm --filter web typecheck && pnpm --filter web lint && git status
```

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| EpisodeWorkspaceHeader props differ | Low | View file before modifying |
| PublishScreen has complex layout | Medium | Place component in clear section |
| Metadata column is JSONB, merge may fail | Low | Use spread operator safely |

## Rollback Plan

1. All changes on feature branch - can revert commits
2. No database schema changes
3. Components remain unused until integrated (safe)

---

**Estimated Total Time**: 1-2 hours

**Note**: LLM-powered extraction (M2) deferred to Phase 11.
