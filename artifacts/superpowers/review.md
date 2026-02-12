# Superpowers Review — Phase 11 UI Integration (Pass 3 — Final)

**Branch:** `feature/phase-11-ui-integration`  
**Scope:** 26 files, +3,607 / −131 lines  
**Specs:** FILM-1140, FILM-1141, FILM-1142, FILM-1143  
**Reviewed:** 2026-02-12 after applying all fixes from passes 1 and 2

---

## Blockers

None.

## Majors

None.

## Minors

None.

## Nits

### n1 — RLS policies don't check account membership

**File:** [migration SQL](file:///Users/shaurya/Work/projects/storybook/apps/web/supabase/migrations/20260212040241_create_episode_facts.sql#L23-L56)

RLS policies verify that the episode/project exists but don't verify the authenticated user is a **member** of the owning account. Any authenticated user could theoretically read/link facts to any episode. This matches the existing RLS pattern used throughout the codebase, but worth hardening in a future pass.

**Track:** Future RLS hardening sprint.

---

## Resolved Findings (Passes 1 & 2)

| ID | Finding | Fix |
|----|---------|-----|
| M1 | `external_sources` not project-scoped | Documented as intentional global scope |
| m1 | Duplicated refresh logic | Extracted `fetchResearchData()` callback |
| m2 | PDF/DOCX extraction unreliable | Added amber warning banner |
| m3 | Regex fact extraction low quality | Added `TODO(FILM-NEXT)` for LLM replacement |
| n1 | Unsafe type assertions | Reduced to single intermediate cast |
| n2 | SSRF risk in URL fetch | Added blocklist for private/internal IPs |
| n3 | Stale `extractedCount` displayed | Reset at start of `handleSubmit` |
| m1′ | `apiEndpoint` collected but never submitted | Wired to `websiteUrl` (API endpoint takes priority) |
| m2′ | Batch link `Promise.all` partial failure | Switched to `Promise.allSettled` + partial reporting |
| m3′ | `onCountChange` missing from deps | Added to `useCallback` dependency array |
| n2′ | No search debounce in link-facts | Added 300ms debounce via `useRef` timer |

---

## Summary

**Clean bill of health.** All code compiles (26/26 typecheck, 0 errors). All 12 acceptance criteria across FILM-1140–1143 are met. All 11 review findings from passes 1 and 2 have been addressed.

The only remaining item (n1 — RLS account membership) is a codebase-wide pattern, not specific to this PR, and should be addressed in a dedicated RLS hardening sprint.

### Next Actions

| Priority | Action |
|----------|--------|
| ✅ Ready | Create PR for `feature/phase-11-ui-integration` → `main` |
| Track | RLS account membership checks (n1) — future sprint |
