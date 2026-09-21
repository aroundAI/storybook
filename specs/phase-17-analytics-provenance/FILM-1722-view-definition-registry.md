---
spec_id: FILM-1722
title: View Definition Registry
status: DRAFT
effort: M
dependencies: FILM-1721
---

# View Definition Registry

## 1. A view is not one thing, and it changes without warning

Every platform in this product has a column called `views`. They count
different events, and at least one of them **changed its meaning three weeks
before this spec was written**.

| Platform | What `views` counts |
|---|---|
| YouTube (from 2026-08-27) | from the moment playback begins — **includes autoplay**, hover-to-play and click/tap. No minimum watch time |
| YouTube (before) | played past the first frame, or clicked/tapped to play |
| Instagram | "times the media has been played" — replaced `plays` in 2025 |
| TikTok Display API | `view_count` |
| TikTok Business API | `video_views` — **mixes organic and paid**, inseparable |
| Facebook | four different denominators — see below |
| X | `video_views` (analytics) or `view_count` (non-public metrics) |

Storing all of these in one `video_metrics.views` column, as we do, is
defensible only if something records what each one means.

## 2. The YouTube discontinuity is live

- **2025-03-31** — YouTube changed Shorts view counting: `views` counts plays
  or replays with no minimum watch time. (Announced 2025-03-26; the effective
  date is the one that matters to a registry, and it is the one recorded here.)
- **2025-04-24** — `engagedViews` introduced, carrying the *previous*
  methodology. **Corrected 2026-09-21: this spec previously dated it 2026-04-24,
  a year late.** The revision history reads *"A new metric, `engagedViews`, will
  reflect the previous view-counting methodology"* under 2025-04-24. A registry
  keyed on effective dates is worth less with a wrong date than with none, so
  this is a correctness fix, not a typo.
- **2026-08-27** — **YouTube unified view counting across all formats.** Verbatim:
  *"YouTube will count public views the moment a video begins to play"*,
  *"(includes autoplay, hold the pointer over, and click/tap to play)"*.

  **The autoplay clause is the part with teeth.** An autoplayed impression now
  counts as a view where it previously did not, so the step change at this date
  is upward by an amount that varies with surface mix. A channel whose traffic
  shifted toward browse/suggested will show growth that is partly definitional.

So `video_metrics.views` for YouTube contains **two different metrics either
side of 2026-08-27**, and for Shorts, either side of 2025-03-31 as well. Any
comparison spanning those dates — a cohort median, a growth figure, a stage
band — is comparing two things under one name.

Nothing in the codebase knows this. This is a correctness item, not a
nice-to-have, and it is the concrete case that motivates the whole spec.

**`engagedViews` is the series that is continuous across the change**, and is
therefore the one to use for anything historical.

## 3. Facebook has four denominators at once

Not a change over time — four concurrent concepts, all called some kind of
view:

| Concept | Field | Definition |
|---|---|---|
| Impression | `total_video_impressions`, `post_impressions_unique` | entered the screen; **no playback required**; *estimated* |
| Play | `blue_reels_play_count` | **≥1 millisecond**, replays excluded |
| 3-second view | `total_video_views` | ≥3s **or** nearly full length if shorter than 3s |
| ThruPlay | — | **Ads metric only.** Not on `video_insights` |

`total_video_15s_views` is **not** ThruPlay: ThruPlay is "completed or ≥15s,
whichever comes first", so a short video that completes under 15s counts for
ThruPlay and not for the organic metric. Labelling it ThruPlay in our product
would be wrong in a way users could not detect.

## 4. What this spec builds

A registry, pure and testable, beside the capability matrix:

```ts
interface ViewDefinition {
  platform: PlatformId;          // NOT AnalyticsPlatform — see below
  field: string;                 // the provider's own field name
  countsFrom: 'first_frame' | 'past_first_frame' | 'one_millisecond'
            | 'three_seconds' | 'impression' | 'unknown';
  minimumWatch: string | null;   // human-readable, e.g. "3s or full length if shorter"
  includesReplays: boolean;
  includesPaid: boolean;
  isEstimated: boolean;
  effectiveFrom: string;         // ISO date this definition began
  supersedes?: string;           // the definition it replaced
  continuousAlternative?: string; // e.g. YouTube 'engagedViews'
}

const VIEW_DEFINITIONS: readonly ViewDefinition[];
```

**`platform` is deliberately not `AnalyticsPlatform`.** That union is
`'youtube' | 'tiktok' | 'instagram'` (`packages/clickhouse/src/types.ts:11`)
until FILM-1720 and FILM-1727 widen it, but §1 and §3 require Facebook and X rows *now* —
Facebook's four denominators are the clearest example in the whole registry and
would be lost if the type forbade them.

So the registry is keyed on a wider `PlatformId`, and an entry for a platform
not yet in `AnalyticsPlatform` is **inert**: recorded, testable, and unreachable
by any query until FILM-1720 (Facebook) or FILM-1727 (X) lands. That keeps
this spec off both critical paths while letting it document what it learned.

Two functions are the point of it:

- `viewDefinitionAt(platform, date)` — what `views` meant on a given day.
- `comparableAcross(platform, from, to)` — **false** when a definition change
  falls inside the range, plus the date and the continuous alternative.

## 5. The rule this enforces

**No comparison may span a definition change without saying so.**

Concretely, where a range crosses a boundary:

- a cohort median, growth figure or stage band is **suppressed** with the named
  reason `view_definition_changed`, carrying the date — not silently computed
- where a `continuousAlternative` exists, the surface offers it: "computed on
  engaged views, which is continuous across the 27 Aug 2026 change"
- a chart plotting across the boundary marks it, rather than drawing a
  step-change as though it were real

This is the same discipline as the rest of the phase: a comparison we cannot
make honestly is a named absent state, never a number.

## 6. Interaction with the rest of the phase

- **FILM-1713** computes every rate against one of these denominators. A rate
  carries which definition produced it, which is where this registry is read.
- **FILM-1715** benchmarks a video against peers. If the peer window spans a
  definition change, the benchmark is suppressed.
- **FILM-1721** is the source: every entry here traces to a documented row
  there.
- **FILM-1703's** capability matrix gains nothing — a view definition is a
  property of a metric's *meaning*, not of whether we can get it.

## 7. Out of scope

- Migrating or restating historical data. We cannot recompute a view under a
  definition that no longer applies; the honest response is to mark the
  boundary, not to pretend it can be crossed.
- Any other metric's definition drift. Views are the acute case because every
  ratio in the product uses them as a denominator; if a second metric turns out
  to have the same problem, it joins this registry.

## 8. Acceptance criteria

- [ ] Every platform's `views` has a recorded definition with an effective date
- [ ] The YouTube 2026-08-27 and 2025-03-31 changes are both recorded
- [ ] Facebook's four denominators are distinguishable, and ThruPlay is marked ads-only and absent from organic insights
- [ ] TikTok's Business-API `video_views` is marked as mixing organic and paid
- [ ] Facebook impressions and Instagram reach are marked estimated where the vendor says so
- [ ] A comparison spanning a definition change is suppressed with a named reason and the date
- [ ] Where a continuous alternative exists it is named and offered
- [ ] A chart crossing a boundary marks it rather than drawing a step change
- [ ] No rate is computed without recording which denominator definition it used
- [ ] Adding a platform without a view definition fails the test

## 9. Verification

```bash
pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
pnpm turbo typecheck --force && pnpm lint
```

Pure registry, no database. The tests that matter:

- a range spanning 2026-08-27 on YouTube is not comparable, and says why
- a range wholly on one side is comparable
- the same range on a platform with no change in it is comparable
- `engagedViews` is offered as the continuous alternative for YouTube and
  nothing else claims one it does not have
- adding a platform to the union without a definition fails

## 10. Risk

The real risk is scope creep into "define every metric". Views earn a registry
because they are the denominator of nearly every ratio in the product and
because one of them demonstrably changed under us. Other metrics join only when
the same two conditions hold.

The second risk is that the suppression is experienced as the product being
broken — a user who cannot see a year-over-year comparison will not
spontaneously understand why. The copy has to carry the reason, and FILM-1719
is where that lands.
