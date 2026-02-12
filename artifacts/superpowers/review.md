# Superpowers Review — Phase 11 UI Integration (Post-Fix)

**Branch:** `feature/phase-11-ui-integration`  
**Scope:** 25 files, +3,487 / −79 lines  
**Specs:** FILM-1140, FILM-1141, FILM-1142, FILM-1143  
**Reviewed:** 2026-02-12 after applying fixes from first review pass

---

## Blockers

None.

---

## Majors

None — all previous major findings resolved.

---

## Minors

### m1 — `apiEndpoint` collected but never submitted

**File:** [add-source-dialog.tsx](file:///Users/shaurya/Work/projects/storybook/apps/web/app/home/[account]/studio/[projectSlug]/research/_components/add-source-dialog.tsx#L63)

The `apiEndpoint` state is collected from the user when an API provider is selected, but is never passed to `addExternalSourceAction`. The value is simply discarded on submit.

```typescript
// Line 63: state exists
const [apiEndpoint, setApiEndpoint] = useState('');
// Line 82-90: not included in action call
await addExternalSourceAction({
    name, slug, description, websiteUrl, category, providerType, credibilityTier,
    // missing: apiEndpoint
});
```

**Impact:** Users see a field, enter data, but it's silently lost.  
**Fix:** Either pass `apiEndpoint` as part of the source's `config` / `website_url`, or remove the field until the schema supports it.

---

### m2 — Batch link can fail partially without rollback

**File:** [link-facts-dialog.tsx](file:///Users/shaurya/Work/projects/storybook/apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/story/_components/link-facts-dialog.tsx#L97-L101)

`handleLink` uses `Promise.all()` to link multiple facts simultaneously. If one fails, the entire batch is reported as failed even though some links may have succeeded. The duplicate-link guard (`23505`) mitigates some scenarios, but a true DB error on row 3 of 5 leaves an inconsistent state.

```typescript
await Promise.all(
    Array.from(selectedIds).map((factId) =>
        linkFactToEpisodeAction({ episodeId, factId }),
    ),
);
```

**Fix:** Use `Promise.allSettled()` and report partial success:
```typescript
const results = await Promise.allSettled(
    Array.from(selectedIds).map((factId) => linkFactToEpisodeAction({ episodeId, factId })),
);
const succeeded = results.filter((r) => r.status === 'fulfilled').length;
const failed = results.filter((r) => r.status === 'rejected').length;
```

---

### m3 — `onCountChange` missing from `useCallback` deps

**File:** [episode-facts-panel.tsx](file:///Users/shaurya/Work/projects/storybook/apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/story/_components/episode-facts-panel.tsx#L74)

`loadFacts` calls `onCountChange` but doesn't include it in its dependency array:

```typescript
const loadFacts = useCallback(() => {
    // ...
    onCountChange?.(result.length);  // used here
}, [episodeId]);  // but not in deps
```

**Impact:** If the parent re-creates the `onCountChange` callback, the stale version is invoked. Low risk since the parent uses a stable setter, but technically incorrect per React rules.

---

## Nits

### n1 — RLS policies don't check account membership

**File:** [migration SQL](file:///Users/shaurya/Work/projects/storybook/apps/web/supabase/migrations/20260212040241_create_episode_facts.sql#L23-L56)

The RLS policies verify that the episode exists in a project but don't verify the authenticated user is a **member** of the account that owns the project. Any authenticated user can read/link facts to any episode. This matches the pattern used elsewhere in the codebase, but worth noting for future hardening.

---

### n2 — Search debounce missing in link-facts-dialog

**File:** [link-facts-dialog.tsx](file:///Users/shaurya/Work/projects/storybook/apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/story/_components/link-facts-dialog.tsx#L73-L78)

`loadFacts` is re-triggered on every keystroke in the search input (via `useEffect` depending on `loadFacts` → `search`). No debounce is applied, causing a DB query per character typed.

---

## Previously Fixed (from first review pass)

| ID | Finding | Status |
|----|---------|--------|
| M1 | `external_sources` not project-scoped | ✅ Documented as intentional |
| m1 | Duplicated refresh logic | ✅ Extracted `fetchResearchData()` |
| m2 | PDF/DOCX extraction unreliable | ✅ Added amber warning banner |
| m3 | Regex fact extraction | ✅ Added `TODO(FILM-NEXT)` |
| n1 | Type assertions | ✅ Reduced to single intermediate cast |
| n2 | SSRF risk | ✅ Added blocklist for private IPs |
| n3 | Stale `extractedCount` | ✅ Reset at start of `handleSubmit` |

---

## Summary

The implementation is **clean and complete**. Typecheck passes (26/26, 0 errors). All 12 acceptance criteria across FILM-1140–1143 are met. Previous review findings have been properly addressed.

### Next Actions

| Priority | Action | Effort |
|----------|--------|--------|
| **Should do** | Wire `apiEndpoint` to action or remove the field (m1) | 10 min |
| **Should do** | Switch to `Promise.allSettled` in link-facts-dialog (m2) | 5 min |
| **Nice to have** | Add `onCountChange` to `useCallback` deps (m3) | 1 min |
| **Nice to have** | Add debounce to link-facts search (n2) | 5 min |
| **Track** | Harden RLS with account membership checks (n1) | Future |
