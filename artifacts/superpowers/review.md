# Superpowers Review v2 — FILM-1133: News Anchor Role

**Branch**: `feature/FILM-1133-anchor-role`
**Files changed**: 6 (2 new, 4 modified)
**Date**: 2026-02-11
**Previous review**: v1 found M1 + 2 minors + 3 nits — all fixed.

---

## Blockers

_None._

---

## Majors

_None._ (M1 trailing newline fixed — confirmed `0a` at EOF.)

---

## Minors

_None._ (m1 redundant slice removed, m2 BiasLabel cast removed.)

---

## Nits

### n1 — `checkSourceBalance` center_left/center_right grouping is asymmetric

**File**: `anchor-service.ts:163-168`

`center_left` and `center_right` are counted toward `centerCount` (line 165-166)
**and** toward `leftCount`/`rightCount` (lines 174-178). This means a single
`center_left` article satisfies both the "has center" and "has left" checks.
This is arguably correct behavior (center_left IS both), but it means a set of
only `center_left` articles would report `isBalanced: true` even though there are
no true left, true center, or true right sources. Unlikely to matter in practice
since the seed data has distinct buckets.

**Impact**: Very low — edge case only.

---

### n2 — `GenerateSegmentOptions` doesn't expose `projectId`/`episodeId`

Carried over from v1 n3. These will be needed when FILM-1134 (Producer) orchestrates
full episodes and persists scripts. Not blocking for FILM-1133.

---

## Summary

**Verdict**: ✅ Clean — ship it.

All 5 findings from the v1 review have been fixed:

| v1 Finding | Status |
|-----------|--------|
| M1 trailing newline | ✅ Fixed — confirmed `\n` at EOF |
| m1 redundant `.slice()` | ✅ Removed |
| m2 `BiasLabel` cast + import | ✅ Removed |
| n1 `authors[0]` as source | ✅ Now uses `sourceId` |
| n2 inconsistent `_user` param | ✅ Added |

### Code Quality Checklist

- [x] Correctness vs requirements — prompt template + service + actions match spec intent
- [x] Edge cases & error handling — empty articles fallback, LLM failure fallback
- [x] Security — XML delimiters, auth-gated actions, no hardcoded secrets
- [x] Performance — no N+1, single aggregator call, bounded article count
- [x] Readability — clean types, JSDoc, section dividers
- [x] TypeScript — `npx tsc --noEmit` passes clean

### Next Actions

1. Create PR for `feature/FILM-1133-anchor-role`
2. Continue to FILM-1134 (Producer Role) on a new branch
