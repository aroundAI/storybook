# Superpowers Review — FILM-1134 Producer Role

**Branch:** `feature/FILM-1134-producer-role`
**Commit:** `1be24e3a`
**Diff:** 6 files changed, 374 insertions, 5 deletions

---

## Blockers

None.

## Majors

None.

## Minors

### m1 — Duplicate schema definition

**File:** `news-actions.ts` lines 121-125 and 146-150
**Severity:** Minor
**Finding:** `PlanRundownSchema` and `OrchestrateEpisodeSchema` are byte-for-byte identical. If one is updated without the other, they silently diverge.
**Recommendation:** Extract a shared base schema or reuse `PlanRundownSchema` directly for `orchestrateNewsEpisodeAction`.

### m2 — `NewsStoryService` instantiated per call

**File:** `producer-service.ts` line 83-84
**Severity:** Minor
**Finding:** `planEpisodeRundown()` creates a new `NewsStoryService()` instance on every invocation. The existing `news-actions.ts` uses a module-level singleton pattern (lines 13-19). For consistency and to avoid repeated initialization, use the same singleton pattern.
**Recommendation:** Add a `getNewsStoryService()` lazy singleton inside `producer-service.ts`, matching the `news-actions.ts` pattern.

## Nits

### n1 — `OrchestrateEpisodeOptions` is an empty extension

**File:** `producer-service.ts` line 57
**Severity:** Nit
**Finding:** `OrchestrateEpisodeOptions extends PlanRundownOptions {}` adds no new fields. This is a forward-compatibility placeholder which is fine, but the empty `{}` body looks unintentional.
**Recommendation:** Add a brief JSDoc comment explaining the extension point (e.g., future fields like `style`, `voiceTone`).

### n2 — No unit tests for `inferCategory`

**File:** `producer-service.ts` lines 196-242
**Severity:** Nit
**Finding:** `inferCategory()` is a pure function with clear deterministic behavior — ideal for unit testing but none are included.
**Recommendation:** Deferred — add unit tests in a follow-up.

### n3 — `topics` array items lack `.min(1)` in schemas

**File:** `news-actions.ts` lines 124, 149
**Severity:** Nit
**Finding:** `z.array(z.string().max(500)).optional()` allows empty strings as topic items. Not a security risk since the aggregator would just return no results, but arguably wasted work.
**Recommendation:** Add `.min(1)` to topic string items: `z.string().min(1).max(500)`.

---

## Summary

| Severity | Count |
|----------|-------|
| Blocker  | 0     |
| Major    | 0     |
| Minor    | 2     |
| Nit      | 3     |

**Verdict:** ✅ Ship-ready with minor polish recommended.

**Recommended actions:**
1. Fix **m1** (dedup schemas) and **m2** (singleton NewsStoryService) — quick wins.
2. **n3** (`.min(1)` on topic strings) — easy to batch.
3. Defer **n1** (JSDoc) and **n2** (unit tests) to follow-up.
