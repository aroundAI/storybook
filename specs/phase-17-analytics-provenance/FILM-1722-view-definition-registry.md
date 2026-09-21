---
spec_id: FILM-1722
title: View Definition Registry
status: ✅ DONE
effort: M
dependencies: FILM-1721
---

# View Definition Registry

> **Shipped.** The registry is `packages/clickhouse/src/lib/view-definitions.ts`,
> exported from the client-safe `@kit/clickhouse` barrel. It is bound to
> [docs/platform-capability-reference.md](../../docs/platform-capability-reference.md)
> by `packages/features/content-analytics/__tests__/view-definition-sources.test.ts`:
> a field must be in the block it names, a date must be stated in the section it
> cites, and "estimated" must be the vendor's word. §4 records where the shipped
> types differ from the sketch below and why; §11 records what has **not** adopted
> the rule yet.

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
| X | `video_views` (analytics) or `view_count` (`public_metrics` and `organic_metrics` — **not** `non_public_metrics`; corrected against FILM-1721 on 2026-09-22) |

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
- **2025-06-24** — the bulk reports gained `engaged_views`, completing the
  rollout. **Added 2026-09-22 from the revision history:** the 2025-03-26 entry
  says of the API, *"until then, views will be based on the old methodology"*.
  Studio changed on 2025-03-31; targeted queries on 2025-04-24; bulk reports on
  2025-06-24. So a *stored* Shorts view between 2025-03-31 and 2025-06-24 is one
  definition or the other and nothing says which. The registry keeps 2025-03-31
  as the effective date and records 2025-06-24 as `rolloutCompleteBy`; a range
  touching that window is not comparable.
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

### What shipped differs from the sketch in five ways

Each is a place where the sketch could not say something true.

- **`includesReplays`, `includesPaid` and `isEstimated` are `VendorFact`
  (`boolean | 'undocumented'`), not `boolean`.** Most vendors do not say whether
  a view includes replays or paid plays. A `false` there would be *measured
  badly* passing as *measured*; `'undocumented'` is *cannot say*. Only what a
  vendor states is `true` or `false`.
- **`effectiveFrom` is `string | null`.** TikTok, Facebook and X document no
  start date. `null` means "no dated start on record — in force as far back as
  the vendor documents". The type makes it impossible for a definition that
  `supersedes` another to be undated.
- **Added fields:** `id` (what `supersedes` points at, and what a rate
  records), `label`, `role` (`views_column` — the chain behind
  `video_metrics.views` — or `concurrent`), `availability`, `appliesTo`
  (`all_formats` | `shorts`), `rolloutCompleteBy`, and `reference` (the heading
  in the capability reference the entry traces to). `countsFrom` gains
  `'unique_account'`, because reach is a denominator (FILM-1713 §4) and is not
  an impression.
- **ThruPlay has `field: null`.** `availability: 'ads_only'` forces `field` and
  `surface` to `null` in the type, so "absent from organic insights" is not a
  flag someone can forget to read — there is no name to request.
- **Both functions take an optional fourth argument, `{ field?, format? }`,
  and return a discriminated union rather than a bare definition or boolean.**
  A pooled YouTube figure between 2025-03-31 and 2026-08-27 is *two*
  definitions (`kind: 'by_format'`); Facebook has no single one
  (`kind: 'no_single_view_definition'`); `engagedViews` has none before
  2025-04-24 (`kind: 'not_defined_on_date'`). With no `format`, every change on
  the platform counts, which is the safe reading of a pooled column.

Exported from `@kit/clickhouse`: `VIEW_DEFINITIONS`, `PLATFORM_IDS`,
`viewDefinitionAt`, `comparableAcross`, `viewDefinitionChangesBetween`, and the
types `PlatformId`, `ViewDefinition`, `ViewDefinitionLookup`,
`ViewComparability`, `ViewComparisonSuppressionReason`, `ViewDefinitionChange`,
`ContinuousAlternative`, `ViewDefinitionOptions`, `ViewFormat`,
`ViewCountsFrom`, `VendorFact`.

Two functions are the point of it:

- `viewDefinitionAt(platform, date)` — what `views` meant on a given day.
- `comparableAcross(platform, from, to)` — **false** when a definition change
  falls inside the range, plus the date and the continuous alternative. The
  alternative carries `coversRange`: `engagedViews` begins 2025-04-24, so for a
  range starting before that it is offered with `coversRange: false` rather than
  claimed as continuous over dates it does not have. The `comparable: true`
  branch carries the definition the range was measured under, which is what
  FILM-1713 stamps onto a rate.
- `viewDefinitionChangesBetween(platform, from, to)` — the boundaries a chart
  marks. `comparableAcross` is built on it, so the two cannot disagree.

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

- [x] Every platform's `views` has a recorded definition with an effective date — or an explicit `null` where the vendor dates nothing (TikTok, Facebook, X)
- [x] The YouTube 2026-08-27 and 2025-03-31 changes are both recorded
- [x] Facebook's four denominators are distinguishable, and ThruPlay is marked ads-only and absent from organic insights
- [x] TikTok's Business-API `video_views` is marked as mixing organic and paid
- [x] Facebook impressions and Instagram reach are marked estimated where the vendor says so — Instagram's *"Metric is estimated"* was read off the vendor page on 2026-09-22 and added to the reference, which had not carried it
- [x] A comparison spanning a definition change is suppressed with a named reason and the date — `comparableAcross` returns `view_definition_changed` and `changedOn`. **In the registry; see §11 for the surfaces that do not call it yet**
- [x] Where a continuous alternative exists it is named and offered — with `coversRange`, so it is not over-claimed
- [ ] A chart crossing a boundary marks it rather than drawing a step change — **registry half only.** `viewDefinitionChangesBetween` returns the boundaries; no chart calls it. §11
- [ ] No rate is computed without recording which denominator definition it used — **registry half only.** The definition is available to stamp; the existing rate sites do not stamp it. This is FILM-1713's own criterion ("every measure records … which view definition and its effective date"). §11
- [x] Adding a platform without a view definition fails the test — widening `AnalyticsPlatform` fails typecheck at `PLATFORM_COVERAGE`, and listing the platform there fails `view-definitions.test.ts` until a definition exists. Both seen red

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

## 11. Adoption — what does not obey §5 yet

This spec shipped the registry and the rule as functions. It deliberately did
**not** retrofit the surfaces already on screen, for two reasons: doing one and
not the others is fixing the instance rather than the class, and suppressing a
figure a user can see today is the kind of change the phase README says "wants
sign-off before implementation, not after".

A sweep on 2026-09-22 found these computing a comparison or a per-view rate
over `video_metrics.views` with no knowledge of the boundary. Today is 26 days
after 2026-08-27, so **every one of them with a YouTube window of 28 days or
more is currently spanning it**:

| Site | What it compares |
|---|---|
| `computeCohortGrowth` → `getCohortCurvesAction` → `cohort-curves-chart.tsx` | cohort median views against the previous cohort — the literal "cohort median, growth figure" of §5 |
| `account-dashboard-actions.ts` `previousPeriodTotals` → `company-dashboard.tsx` | period-over-period totals |
| `language-analytics.ts` `viewsChange` → `language-analytics-cards.tsx` | views vs the previous period, per language |
| `queryRollingViews`, `queryMedianViewsPerVideo`, `queryBackCatalogShare` | view series and medians over long windows |
| `performance-chart.tsx`, `language-trend-chart.tsx` (and `comparison-chart.tsx`, which overlays whatever current/previous series it is handed) | views over time, drawn straight across the boundary |
| engagement rate in `aggregation-queries.ts`, `language-analytics.ts`, `account-dashboard-actions.ts` | `(likes + comments + shares) / views` — among the duplicate sites FILM-1713 §2 collapses |
| RPM in `revenue-actions.ts`, `lib/segment-stats.ts` | revenue per thousand views |

Who adopts it:

- **FILM-1713** — every rate, by taking its denominator from
  `comparableAcross`'s `comparable: true` branch.
- **FILM-1715** — cohort medians and benchmarks, including the cohort curves.
- **FILM-1707 / FILM-1719** — the charts and the copy, per §10.

The second unticked criterion closes when FILM-1713 does; the first when a
chart first calls `viewDefinitionChangesBetween`.

