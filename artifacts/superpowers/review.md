# Superpowers Review — PR #178 (feature/FILM-1120-verified-facts)

**Date**: 2026-02-10
**Reviewer**: Antigravity
**Files Reviewed**: 31 (migration SQL, service functions, types, prompt templates, unit tests, barrel exports)
**Test Status**: 216/216 passing (prompt-engine), fact-checker + verified-facts unit tests passing

---

## Blockers

**None found.** No data-loss risks, security holes, or broken builds detected.

---

## Majors

### M1. `as any` Supabase casts mask runtime errors (6 occurrences)
**Files**: `researcher.ts:98`, `fact-checker.ts:109`, `sequel-system.ts:102,109,125,142,387`, `act-context-bridge.ts:49,78`

Every query to tables not yet in generated types uses `(supabase as any).from(...)`. This silently swallows:
- Column name typos → runtime `null` data with no TypeScript compile error
- Missing `.single()` or `.limit()` → undetected shape mismatches
- Wrong `.eq()` column names → silent empty results

**Recommendation**: Run `pnpm supabase:web:typegen` after merging the migration so these casts can be removed in a fast follow-up. Add a TODO comment in each file with a tracking issue number.

**Severity**: Major — likely bugs won't surface until integration testing.

---

### M2. Fact-checker throws on zero facts — may break automated pipelines
**File**: `fact-checker.ts:118-122`

```typescript
if (facts.length === 0) {
    throw new Error('No verified facts found. Add facts before fact-checking.');
}
```

If fact-checking is called programmatically (e.g., as part of a content publishing pipeline), an unhandled throw will crash the pipeline. For researcher.ts, the same scenario gracefully returns `"No existing facts in database."` — the asymmetry is confusing.

**Recommendation**: Convert to a result-type pattern or return a `FactCheckResult` with `overallVerdict: 'fail'` and a descriptive issue instead of throwing.

---

### M3. `.limit(1000)` on verified_facts with no pagination
**Files**: `researcher.ts:103`, `fact-checker.ts:114`

For projects with >1000 facts, the query silently truncates — missing facts could cause the LLM to incorrectly flag valid claims as "needs_source" or miss citation errors.

**Recommendation**: Either:
1. Add a comment documenting the intentional safeguard + log a warning when the limit is hit, or
2. Implement cursor-based pagination (future)

**Severity**: Major if documentary projects can accumulate >1000 facts.

---

## Minors

### m1. `researcher.ts` fetches `account_id` in a separate query from the project
**File**: `researcher.ts:81-89`

The project could be fetched once with `select('account_id')` (which it already does), but the pattern duplicates the query structure from fact-checker.ts. Consider extracting a shared helper like `getProjectAccountId(projectId)`.

---

### m2. Researcher `userId` defaults to empty string when no user
**File**: `researcher.ts:93`

```typescript
const userId = user?.id ?? '';
```

An empty userId in the LLM context logging is misleading — it suggests a valid but empty identifier rather than "no user." Consider `'anonymous'` or omitting the field entirely.

---

### m3. `sanitizeForPrompt` not applied in `act-context-bridge.ts`
**File**: `act-context-bridge.ts:99-164`

`formatBridgeForPrompt` renders `bridge.characterStates`, `bridge.carryForwardContext`, etc. directly into LLM prompt text without `sanitizeForPrompt()`. Since bridge data comes from a previous LLM call (trusted), this is low-risk — but inconsistent with `researcher.ts`, `fact-checker.ts`, and `sequel-system.ts` which all sanitize.

**Recommendation**: Apply `sanitizeForPrompt` in `formatBridgeForPrompt` for consistency. If LLM output is trusted, document the decision explicitly.

---

### m4. `prompt-format.test.ts` parses JSON outside `it()` block
**File**: `prompt-format.test.ts:93-94`

```typescript
content = fs.readFileSync(filePath, 'utf-8');
template = JSON.parse(content);
```

These lines run at describe-time, not inside a test. If a file has invalid JSON, the entire test suite crashes with a parse error instead of a clean test failure with file name in the output.

**Recommendation**: Move the parsing into a `beforeAll()` or wrap in a try/catch at describe level.

---

### m5. `VerifiedFact.sourceType` is required in TypeScript but nullable in SQL
**File**: `verified-facts.ts:54` vs migration line 30

TypeScript: `sourceType: SourceType` (required)
SQL: `source_type VARCHAR(50)` — no `NOT NULL` constraint

If a row is inserted via SQL without `source_type`, the TypeScript type will be violated at runtime.

**Recommendation**: Either add `NOT NULL` to the column or make `sourceType` optional in the interface.

---

### m6. RLS policy inconsistency: SELECT/INSERT use account-level, UPDATE/DELETE use project_members
**File**: `20260211100000_create_verified_facts.sql`

- SELECT (line 104-123): Uses `accounts.primary_owner_user_id` and `has_role_on_account()`
- INSERT (line 128-150): Same account-level check
- UPDATE (line 153-187): Uses `project_members.role IN ('owner', 'admin', 'member')`
- DELETE (line 190-199): Uses `project_members.role IN ('owner', 'admin')`

This inconsistency means a user who can view/insert facts (via account membership) might not be able to update them (if they're not in `project_members`). If `project_members` is populated for all account members, this works — but it's a subtle access control gap if not.

**Recommendation**: Document the intentional two-level access model, or unify to one pattern.

---

### m7. INSERT policy allows `verification_status = NULL`
**File**: `20260211100000_create_verified_facts.sql:145`

```sql
AND (verification_status IS NULL OR verification_status = 'unverified')
```

The column has `DEFAULT 'unverified'`, so NULL shouldn't normally occur. But an explicit `INSERT` with `verification_status = NULL` would bypass the CHECK constraint entirely. The `CHECK` constraint prevents invalid values but NULL passes through.

**Recommendation**: Add `NOT NULL` to the `verification_status` column definition if NULL is never valid.

---

## Nits

### n1. `episode_context` variable defined in `researcher-role.json` but never used
**File**: `researcher-role.json:26-30`

The variable `episode_context` is declared but doesn't appear in `user_prompt` or `system_prompt`. It's also not passed in `researcher.ts`.

---

### n2. `confidence_score` column allows exactly 1.0 but DECIMAL(3,2) max is 9.99
**File**: `20260211100000_create_verified_facts.sql:69-71`

```sql
confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1)
```

`DECIMAL(3,2)` allows values from -9.99 to 9.99. The CHECK constraint limits to 0–1. This works but `DECIMAL(3,2)` allocates more storage than needed. `DECIMAL(1,2)` doesn't exist — `NUMERIC(3,2)` would be equivalent.

---

### n3. `pr177_review_fixes.sql` sets `parent_project_name` default to empty string
**File**: `20260211100001_pr177_review_fixes.sql:11`

```sql
add column if not exists parent_project_name text not null default '';
```

Empty string defaults are generally fine, but for a "name" column, consider whether this should be NULL-able instead of defaulting to empty.

---

### n4. Test file `prompt-format.test.ts` regex doesn't catch `{{variable.nested}}`
**File**: `prompt-format.test.ts:173`

```regexp
/^\\{\\{[a-zA-Z_][a-zA-Z0-9_]*\\}\\}$/
```

The regex only matches simple `{{variable_name}}` — if someone adds `{{object.property}}`, the test would reject it. If dot-notation is intentionally unsupported, this is correct. If it might be needed later, the regex should be documented.

---

## Summary

| Category | Count |
|----------|-------|
| Blockers | 0 |
| Majors | 3 |
| Minors | 7 |
| Nits | 4 |

### Next Actions

1. **Post-merge (M1)**: Run `pnpm supabase:web:typegen` to remove `as any` casts — this is the single highest-value follow-up
2. **Consider (M2)**: Make `runFactCheck` return a result instead of throwing on zero facts
3. **Document (M3)**: Add logging/warning when `.limit(1000)` is hit on verified_facts queries
4. **Quick fix (m4)**: Move JSON parsing into `beforeAll()` in `prompt-format.test.ts`
5. **Schema alignment (m5, m7)**: Add `NOT NULL` to `source_type` and `verification_status` columns
6. **Cleanup (n1)**: Remove unused `episode_context` variable from `researcher-role.json` or use it
