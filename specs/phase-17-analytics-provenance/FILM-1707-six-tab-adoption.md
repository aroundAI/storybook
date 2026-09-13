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

## 3. Tab-by-tab

| Tab | Work |
|---|---|
| **Overview** | Already on `AnalyticsCard` via FILM-1706. Confirm all ten cards declare a family. `AIInsightCard` builds its string locally (`overview-grid.tsx:139-164`) and is not an LLM call — its chip must not imply it is one. |
| **Content** | The only tab whose platform filter already works server-side (`aggregation-queries.ts:831-832`). Cards are per-publish and already carry a platform badge; reconcile that badge with the new chip rather than showing both. |
| **Audience** | Post-FILM-1701 this is three real cards. Each needs a family and a chip; YouTube reports seven dimensions, TikTok three percentage-only, Instagram three at **account** level — an Instagram "audience" row is the channel's audience replicated per video, which the chip must not present as per-video measurement. |
| **Deep Dive** | §2, plus chips on the five cards. |
| **Language** | Re-shell onto `AnalyticsCard`; declare `metricFamily: 'language'`; surface FILM-1702's dimension toggle. |
| **AI Insights** | A generated narrative is not a measurement. Its provenance statement is which numbers it was given and when, not which platform reported them. |

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
