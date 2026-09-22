---
spec_id: FILM-1707
title: Six-Tab Adoption and the Deep Dive Scope Decision
status: DRAFT
effort: L
dependencies: FILM-1702, FILM-1705, FILM-1706
---

# Six-Tab Adoption and the Deep Dive Scope Decision

## 1. Overview

FILM-1705 and FILM-1706 give Overview and Deep Dive a provenance chip and a
shell that can carry depth. This spec finishes the job across all six tabs —
and settles the one question the chip cannot answer by labelling.

Two tabs are structurally outside the pattern:

- **Language** uses `@kit/ui/card` (`Card`/`CardHeader`/`CardTitle`/`CardContent`)
  across `language-analytics-cards.tsx`, `language-trend-chart.tsx`,
  `language-insights-cards.tsx`, `shorts-geography-cards.tsx` and
  `analytics-enhancement-cards.tsx` — a different shell from every other tab.
- **AI Insights** (`ai-insights.tsx`) builds its own gradient blocks and an
  inline amber "Recommended Actions" panel.

And one tab has a problem that a label would paper over rather than fix.

## 2. The Deep Dive scope decision

This is the substantive half of the spec.

`components/deep-dive/deep-dive-tab.tsx:67` builds `const scope = { projectId }`.
`buildDimConditions` (`queries-advanced.ts:134-137`) adds a platform predicate
only when `scope.platform` is set. So on one tab, side by side:

- **Median views, cohort curves, back catalog** pool YouTube, TikTok and
  Instagram.
- **Browse + Suggested share, Where views came from** see YouTube only, because
  nothing else is in `video_traffic_sources`.

A chip reading "3 platforms" on the median card would be accurate and still
misleading, because the pooling is worse than multi-platform. YouTube rows are
true daily; TikTok and Instagram rows are snapshot deltas attributed to the
**fetch** day rather than the data day (`server/ingest.ts:287-299`). "Median
views per video by upload month" is therefore assembled from two different time
semantics, and a gap in the fetch schedule shifts TikTok views into the wrong
month.

**Do not let the chip substitute for the fix.** This spec must choose one:

1. **Default Deep Dive to YouTube**, with the platform explicit in `scope` and
   changeable. Honest and simple; loses cross-platform comparison on a tab
   whose whole subject is depth.
2. **Exclude `metric_source = 'snapshot_delta'` rows from time-bucketed
   aggregates**, keeping them in lifetime totals where fetch-day attribution
   does not distort. Keeps multi-platform where it is meaningful; more code,
   and needs the exclusion stated on the card.
3. **Bucket snapshot-delta rows by a corrected date** — not viable without a
   data-day estimate the providers do not give us. Recorded so it is not
   re-proposed.

Option 2 is the better answer and the more expensive one. Whichever is chosen,
the rationale belongs in this file before the code is written, because it
changes numbers that are already on screen.

### Decided (owner, 2026-09-22): option 2, plus option 1's platform switcher

**The rule: a fetch-dated figure never goes on a date axis.** Everything below
follows from it.

- **Time-bucketed aggregates exclude `metric_source = 'snapshot_delta'` rows.**
  Median views by upload month, cohort curves over time, weekly diagnostics —
  anything whose x-axis or grouping is a date — are built from true-daily rows
  only. Today that means YouTube. It is a rule about *how a row was dated*, not
  about a platform: if TikTok or Instagram ever supply a true daily series
  (FILM-1730 §4.6 asks exactly this of the TikTok Business API), those rows
  qualify with no change here. Do not write `platform = 'youtube'`.
- **Lifetime aggregates keep every platform.** Total views per video, back
  catalog totals — a lifetime sum is not distorted by which day a delta was
  attributed to, so pooling stays, and stays honest.
- **Each card says which kind it is.** A time-bucketed card carries a plain
  sentence, in the card and not only in a tooltip: *"TikTok and Instagram aren't
  shown here — they report running totals, not daily views."* The provenance
  chip (FILM-1705) states the platforms actually included, so "3 platforms" can
  never sit on a card that only plotted one. The sentence appears only when the
  project has publishes on an excluded platform; a YouTube-only creator sees
  no caveat about platforms they do not use.
- **A platform switcher, from option 1.** `scope.platform` becomes explicit and
  changeable on the tab. **Default: all platforms**, under the rule above — not
  YouTube, which was option 1's default and is not what was chosen. Selecting a
  single platform shows that platform's own figures; for TikTok or Instagram the
  time-bucketed cards then have nothing true to plot and show an empty state
  that says why (running totals, fetch-dated), never a fetch-dated chart. This
  is FILM-1709's filter reaching this tab; build it once, there or here, not
  twice.
- **Tell the creator the numbers moved.** For any project with TikTok or
  Instagram publishes, the median and cohort figures change the day this ships.
  The old figures were wrong in a way nobody could see, so the change needs one
  dismissible note on the tab — what changed, and why — not silence. Per-viewer
  dismissal; it does not need to outlive a release or two.

**Why not option 1 alone:** it throws away the cross-platform lifetime view,
which is true and useful, to fix the time-bucketed one, which is neither.
**Why not option 3:** unchanged — it invents a spread the providers never gave
us.

**What this costs:** every Deep Dive query that groups by date needs the
predicate, and each needs a fixture proving a `snapshot_delta` row is excluded
from the bucket and still counted in the lifetime total. Seed a sync gap across
a month boundary; the median for that month must not move.

## 3. Tab-by-tab

| Tab | Work |
|---|---|
| **Overview** | Already on `AnalyticsCard` via FILM-1706. Confirm all ten cards declare a family. `AIInsightCard` builds its string locally (`overview-grid.tsx:139-164`) and is not an LLM call — its chip must not imply it is one. |
| **Content** | The only tab whose platform filter already works server-side (`aggregation-queries.ts:831-832`). Cards are per-publish and already carry a platform badge; reconcile that badge with the new chip rather than showing both. |
| **Audience** | Post-FILM-1701 this is three real cards. Each needs a family and a chip; YouTube reports seven dimensions, TikTok three percentage-only, Instagram three at **account** level — an Instagram "audience" row is the channel's audience replicated per video, which the chip must not present as per-video measurement. |
| **Deep Dive** | §2, plus chips on the five cards. |
| **Language** | Re-shell onto `AnalyticsCard`; surface FILM-1702's dimension toggle. **Note `'language'` is not a `MetricFamily`** — see below. |
| **AI Insights** | A generated narrative is not a measurement. Its provenance statement is which numbers it was given and when, not which platform reported them. |

### Language is a dimension, not a metric family

`METRIC_FAMILIES` (FILM-1703 §4) has no `'language'` member, and `metricFamily`
is a **required** prop (FILM-1706 §5), so `metricFamily: 'language'` would not
typecheck.

That is correct rather than an omission. Language is a **segmentation of** a
metric, not a metric: the Language tab's cards show engagement, watch time and
retention *split by* language. Each card therefore declares the family it
actually shows, and the language split is a scope dimension —
`DimScope.language` already exists (`queries-advanced.ts:32`).

Adding a `'language'` family would also not be free: FILM-1703's structural test
requires an entry for every (family, platform) pair with a creator-facing note
each, and the entries would describe a thing that is not a data source.

## 4. The orphaned cards

`deep-dive/ypp-progress-card.tsx`, `deep-dive/weekly-diagnostics-table.tsx` and
`deep-dive/retention-curve-chart.tsx` are exported from `components/index.ts`
but mounted nowhere. Phase 16's FILM-1611, 1616 and 1617 mount them.

If those specs have landed, the cards are in scope here and adopt the shell
like any other. If they have not, this spec must **not** mount them — that is
Phase 16 scope — but it must leave them compiling against the v2 shell, since
`metricFamily` being required will otherwise break them the moment someone
mounts them. Adding the prop to an unmounted card is cheap; discovering it
missing during a different spec is not.

## 5. Out of scope

- Making the platform filter actually reach MetricCards, Audience, Deep Dive
  and Language — FILM-1709. This spec makes those tabs *describe* their
  coverage; acting on the filter is next.
- The traffic-group colour ramp and the drill-down — FILM-1708.
- Any new card, any new query, any new metric.
- Rewriting the AI Insights prompt or its delivery.

## 6. Acceptance criteria

- [ ] All six tabs use one card shell; `@kit/ui/card` no longer appears in the analytics feature's card layer
- [ ] Every card on every tab declares a metric family and renders a chip derived from the matrix
- [ ] The Deep Dive scope decision is recorded in this file with its rationale before implementation
- [ ] No Deep Dive card silently mixes true-daily and snapshot-delta rows in a time-bucketed aggregate
- [ ] Whichever option §2 selects, the resulting scope is visible to the reader rather than implicit
- [ ] An Instagram audience figure is not presented as per-video measurement
- [ ] The locally-built Overview insight string is not chipped as though it were generated or measured
- [ ] Content cards show one platform indication, not a badge and a chip saying the same thing
- [ ] The three unmounted Deep Dive cards compile against the v2 shell
- [ ] Tab-switching does not refetch coverage; the provider is above the tabs
- [ ] A chart crossing a view-definition boundary marks it (from `viewDefinitionChangesBetween`) rather than drawing a step change — handed on by [FILM-1722](./FILM-1722-view-definition-registry.md) §12, whose criterion stays open until this lands

## 7. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm turbo typecheck --force && pnpm lint
NEXT_PUBLIC_SITE_URL=https://example.com pnpm --filter web build
```

Visual pass in Chrome across all six tabs, measured in the DOM: every card has
a chip; the chip text matches `capabilityFor()` for its declared family; no
card renders a figure whose coverage the matrix cannot account for.

For §2 specifically, verify numerically rather than visually — take one project
with TikTok rows and confirm the median-by-month series changes in the expected
direction when snapshot-delta rows are handled, and that the change is
explainable from the fixture rather than merely different.

## 8. Risk

This is the spec where the phase's numbers move. §2 will change figures on the
Deep Dive tab that people may have quoted. That is the correction the phase
exists to make, but it should ship with an explicit note rather than silently —
the same handling FILM-1702 requires for the language buckets.

The second risk is breadth: six tabs, two shells, one scope decision and three
orphaned cards is a large surface for one pull request. It is a candidate for
splitting per-tab once the shell work in FILM-1706 has settled, and the
acceptance criteria are written so that a per-tab split still satisfies them
incrementally.
