# Superpowers Review — `feature/FILM-1120-verified-facts`

**Scope**: 43 files, +2374 / −151 lines, 23 commits
**Date**: 2026-02-10 (post-fix pass)

---

## Blockers (0)

No blockers found. All previous blockers have been resolved.

---

## Majors (0)

All previous majors have been resolved:
- ✅ Prompt/code `'likely'` mismatch fixed in `researcher-role.json`
- ✅ `as unknown as Json` casts replaced with documented `toJsonb()` helper

---

## Minors (3)

### m1 — `VALID_PRIORITIES` set is reallocated on every `.map()` iteration

**File**: [researcher.ts:132](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/documentary/researcher.ts#L132)

The `new Set(...)` allocation sits inside the `.map()` callback, so it's re-created once per claim. Move it to module scope (like `VALID_VERDICTS`/`VALID_SEVERITIES` in `fact-checker.ts`) for consistency and minor performance gain.

```diff
+const VALID_PRIORITIES = new Set(['critical', 'important', 'nice_to_have']);
+
 export async function runResearchPhase(...)  {
     ...
     const validatedClaims = research.claims.map((c) => {
-        const VALID_PRIORITIES = new Set(['critical', 'important', 'nice_to_have']);
         const priority = VALID_PRIORITIES.has(c.priority)
```

### m2 — Extra blank lines at researcher.ts:34-36

**File**: [researcher.ts:34-36](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/documentary/researcher.ts#L34-L36)

Two consecutive blank lines left from the `VerifiedFactRow` removal. Should be a single blank line.

### m3 — `researchGaps` array elements not sanitized in `formatResearchForPrompt`

**File**: [researcher.ts:196](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/documentary/researcher.ts#L196)

Wait — actually this IS sanitized already: `sanitizeForPrompt(g)`. False positive. ✅

**(Revised — only m1 and m2 are real minors)**

---

## Nits (2)

### n1 — `fact-checker.ts` still has comment "Import types locally" on line 24

**File**: [fact-checker.ts:24-25](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/documentary/fact-checker.ts#L24-L25)

The re-export + local import is correct, but the comment `// Import types locally for use in this file` is redundant after the consolidated re-export block above it. Can remove the comment line.

### n2 — `sourceCitation` is now optional in TS but still used without `?` guard in researcher

**File**: [researcher.ts:101](file:///Users/shaurya/Work/projects/storybook/packages/features/episodes/src/lib/documentary/researcher.ts#L101)

`VerifiedFactRow.source_citation` is `string` (required), so this is fine for the module-internal type. But if `VerifiedFact.sourceCitation` is consumed downstream and is now optional, callers should handle `undefined`. Low risk since the DB column does have data for all existing rows.

---

## Summary

| Severity | Count |
|----------|-------|
| Blocker  | 0 ✅  |
| Major    | 0 ✅  |
| Minor    | 2     |
| Nit      | 2     |

### Resolved Since Last Review
- ✅ **B1**: Prompt/code `'likely'` sync
- ✅ **M1**: `toJsonb()` helper
- ✅ **m1**: Shared `VerifiedFactRow`
- ✅ **m2**: `sanitizeForPrompt` tests (14 tests)
- ✅ **m3**: Runtime validation on LLM casts
- ✅ **n1**: Simplified imports
- ✅ **n2**: `sourceCitation` optional

### What Looks Good
- **Security**: `sanitizeForPrompt` with iterative tag stripping, tested with 14 cases
- **RLS**: Two-level access model (account for read/insert, project_members for update/delete), WITH CHECK preventing self-verification
- **Idempotent migrations**: `DO $$ BEGIN...EXCEPTION` blocks, `DROP POLICY IF EXISTS`
- **Runtime validation**: LLM output validated with fallback defaults for verdicts, severities, priorities, issue types
- **Error handling**: Graceful `FactCheckResult` on zero facts instead of throwing
- **Test coverage**: 319 tests across 16 files (sanitize, fact-checker, verified-facts, prompts, sequel-system)

### Next Actions (optional, non-blocking)
1. Hoist `VALID_PRIORITIES` set to module scope in `researcher.ts`
2. Remove extra blank line at line 35 in `researcher.ts`
