# Superpowers Review — FILM-1121 Fact Management UI

**Branch:** `feature/FILM-1121-fact-management-ui`
**Commit:** `811ab9e8`
**Diff:** 12 files changed, 1914 insertions

---

## Blockers

None.

## Majors

### M1 — Fact detail page not scoped to project

**File:** `settings/facts/[factId]/page.tsx` lines 68-72
**Severity:** Major
**Finding:** The query fetches a fact by `factId` alone without scoping to the project:
```ts
.from('verified_facts')
.select('*')
.eq('id', factId)
.single();
```
If RLS doesn't scope facts to the project, a user could view facts from other projects by guessing UUIDs. The `projectSlug` param is resolved but never used to verify ownership.
**Recommendation:** Resolve `projectSlug → project.id` first (as done in the list page), then add `.eq('project_id', project.id)` to the detail query. Same issue in `generateMetadata`.

## Minors

### m1 — Duplicate `STATUS_STYLES` / `STATUS_LABELS` constants

**File:** `fact-card.tsx` lines 23-41, `[factId]/page.tsx` lines 27-41
**Severity:** Minor
**Finding:** `STATUS_STYLES` and `STATUS_LABELS` are copy-pasted identically in two files. If a status value is added or renamed, both must be updated in sync.
**Recommendation:** Extract to a shared `fact-constants.ts` file and import in both components.

### m2 — `eslint-disable @typescript-eslint/no-explicit-any` on Supabase client

**File:** `fact-actions.ts` lines 303-304, 351-352
**Severity:** Minor
**Finding:** `getProjectFactsAction` and `getFactByIdAction` cast the Supabase client to `any` to work around missing generated types for `verified_facts`. This bypasses all type-safety for those queries.
**Recommendation:** Run `pnpm supabase:web:typegen` to regenerate types that include the `verified_facts` table, then remove the `as any` casts. If types aren't available yet (table not in local dev), add a TODO comment with the ticket reference.

### m3 — Category lists duplicated across files

**File:** `add-fact-form.tsx` lines 87-99, `fact-library.tsx` lines 30-43
**Severity:** Minor
**Finding:** `CATEGORY_OPTIONS` is defined twice with slightly different shapes (array of strings vs. array of `{value, label}`). These can diverge silently.
**Recommendation:** Extract a single canonical `FACT_CATEGORIES` array in a shared file and derive both shapes from it.

## Nits

### n1 — `confirm()` for delete is browser-only

**File:** `fact-library.tsx` line 143
**Severity:** Nit
**Finding:** `if (!confirm('Are you sure...'))` uses the native browser confirm dialog, which is inconsistent with the rest of the UI's shadcn dialog pattern and won't work in non-browser environments.
**Recommendation:** Replace with a shadcn `AlertDialog` for visual consistency. Acceptable as-is for MVP.

### n2 — `facts/page.tsx` uses `<a>` instead of `<Link>` for back nav

**File:** `settings/facts/page.tsx` line 119
**Severity:** Nit
**Finding:** The back button uses a raw `<a href=...>` tag, which triggers a full page reload. Other pages in the app use `next/link`'s `<Link>` for client-side nav.
**Recommendation:** Replace `<a>` with `<Link>` from `next/link`.

### n3 — No unit tests

**Severity:** Nit
**Finding:** No tests accompany this feature. `addVerifiedFactAction`, `mapFactRow`, and form validation logic are all easily testable.
**Recommendation:** Defer to follow-up ticket. Pure functions like `mapFactRow` and the `simplifiedClaim` generation are ideal first targets.

---

## Summary

| Severity | Count |
|----------|-------|
| Blocker  | 0     |
| Major    | 1     |
| Minor    | 3     |
| Nit      | 3     |

**Verdict:** ⚠️ Fix **M1** before shipping; minors recommended but non-blocking.

**Recommended actions:**
1. Fix **M1** (scope detail query to project) — security-relevant.
2. Fix **m1** (extract shared constants) and **m2** (typegen) — quick wins.
3. **m3**, **n1**, **n2** — batch in polish pass.
4. Defer **n3** (unit tests) to follow-up.
