# Superpowers Review v3 — FILM-1121 Fact Management UI

**Branch:** `feature/FILM-1121-fact-management-ui`
**Commit:** `abea48cd` (post M1/m1 fixes)
**Scope:** 14 files changed, ~2031 insertions

---

## Blockers

None.

## Majors

None. ✅ Previous M1 (write actions unscoped) fixed — all write schemas now require `projectId` and queries include `.eq('project_id', data.projectId)`.

## Minors

### m1 — Duplicate data fetching in list page vs. `getProjectFactsAction`

**File:** [facts/page.tsx](file:///Users/shaurya/Work/projects/storybook/apps/web/app/home/%5Baccount%5D/studio/%5BprojectSlug%5D/settings/facts/page.tsx#L55-L81)
**Finding:** The list page builds its own Supabase query (lines 55-81) duplicating the filtering/mapping logic in `getProjectFactsAction` (lines 308-352). Schema changes require updating both.
**Recommendation:** Extract a shared `queryProjectFacts()` service function, or call `getProjectFactsAction` from the RSC directly. Non-blocking since both are in the same PR and kept in sync.

### m2 — `getFactByIdAction` not scoped to project

**File:** [fact-actions.ts](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/server/fact-actions.ts#L357-L379)
**Finding:** `getFactByIdAction` queries by `factId` alone without a `projectId` filter. This is a read action (not a write), so risk is lower — and the detail page already scopes its own query — but the action itself could be called from other contexts without project scoping.
**Recommendation:** Add `projectId` to `GetFactByIdSchema` and scope the query, for consistency with other actions.

### m3 — `revalidatePath` uses dynamic route pattern

**File:** [fact-actions.ts](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/server/fact-actions.ts#L198) (also lines 239, 269, 295)
**Finding:** `revalidatePath('/home/[account]/studio/[projectSlug]/settings/facts')` revalidates all instances of this route across all accounts/projects. Acceptable for low-frequency mutations but imprecise.
**Recommendation:** Pass the actual resolved path for targeted invalidation in a future optimization pass. Non-blocking.

## Nits

### n1 — `SOURCE_TYPES` in `add-fact-form.tsx` mirrors server schema enum

**File:** [add-fact-form.tsx](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/components/facts/add-fact-form.tsx#L76-L89)
**Finding:** The `SOURCE_TYPES` array duplicates the `sourceType` Zod enum in `AddFactSchema`. Adding a new source type requires updating both.
**Recommendation:** Move to `fact-constants.ts` alongside other shared constants for a single source of truth.

### n2 — `FactCard` dropdown contains only "Delete"

**File:** [fact-card.tsx](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/components/facts/fact-card.tsx#L107-L131)
**Finding:** A `DropdownMenu` with a single item feels heavy. Acceptable if more actions (Edit, Duplicate) are planned.
**Recommendation:** No action needed if more items are planned. Otherwise simplify to an inline button.

### n3 — No unit tests for pure functions

**Finding:** `mapFactRow`, `simplifiedClaim` generation, and `generateAPACitation` are ideal unit-test targets but no tests are included.
**Recommendation:** Defer to follow-up ticket per prior agreement.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Blocker  | 0     | ✅ |
| Major    | 0     | ✅ (v2 M1 fixed) |
| Minor    | 3     | Non-blocking |
| Nit      | 3     | Optional polish |

### What's been fixed across v1→v3:
- ✅ **v1 M1** — Detail page query scoped to project
- ✅ **v2 M1** — Write actions (`verify`, `dispute`, `delete`) now scoped to `projectId`
- ✅ **v1 m1** — Shared constants extracted to `fact-constants.ts`
- ✅ **v2 m1** — `MappedFact` type exported and reused (net -19 lines)
- ✅ **v1 m3** — Duplicate `CATEGORY_OPTIONS` consolidated
- ✅ **v1 n1** — `confirm()` → `AlertDialog`
- ✅ **v1 n2** — `<a>` → `<Link>`
- ✅ **v1 m2** — `as any` casts addressed with typed helper + TODO

### Remaining (all non-blocking):
1. **m1** — Duplicate query logic in list page (refactor opportunity)
2. **m2** — `getFactByIdAction` not scoped to project (low risk, read-only)
3. **m3** — `revalidatePath` uses pattern path (optimization opportunity)
4. **n1-n3** — Optional polish items

**Verdict:** ✅ **Ship-ready.** No blockers or majors. All remaining items are non-blocking improvements.
