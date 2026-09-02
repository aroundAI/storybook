---
spec_id: FILM-1604
title: Cohort Medians & Growth
status: 🔍 IN REVIEW
effort: M
dependencies: FILM-1603
---

# Cohort Medians & Growth

## 1. Overview

The Cohort Analysis sheet exists to answer one question — *are newer uploads
outperforming older ones at the same age?* — and it is the only view in the
workbook that controls for how long a video has been live. Raw monthly
totals can never show this, because a good month may simply contain older
videos.

Two defects make the current implementation answer a different question.

**It reports a mean.** `queryCohortCurves` returns cohort *sums*, and
`getCohortCurvesAction` divides by video count. The sheet whose entire
purpose is controlling for luck is computed with the statistic the workbook
calls "hostage to one outlier" — one video going viral moves the whole
cohort's line, which is exactly the noise the view is meant to filter out.

**Maturity is judged per cohort, not per checkpoint.** The action derives
one `cohortAgeDays` from the *quarter start*
(`new Date(row.cohort)`), then flags every checkpoint from it. A quarter
spans about 90 days, so a cohort whose youngest video was published
yesterday is still flagged mature at 30 days — and that video contributes a
near-zero to the cohort's figure, dragging it down. The newest cohort, the
one the reader most wants to judge, is the most distorted.

## 2. Approach

Two-level aggregation. The inner query reduces to one row per video with
its age-bounded sums — the same shape FILM-1603 established — and the outer
query takes quantiles across the cohort, filtering each checkpoint by that
video's own age:

```sql
quantileExactIf(0.5)(v_30, age_days >= 30) as median_30
countIf(age_days >= 30)                    as mature_count_30
```

A video only contributes to "@30d" once *it* is 30 days old. `mature_count`
travels with the figure so a reader can see how many videos it rests on.

`quantileExact`, not `quantile`: cohorts are small enough that an
approximate quantile would be a different number run to run.

Three further decisions:

- **`LEFT JOIN` from the dim side**, so a video with no ingested metric rows
  counts as a zero in the median rather than vanishing. Dropping it would
  inflate the median by silently removing the worst performers.
- **`bucket: 'quarter' | 'month'`** is parameterised rather than hardcoded
  `toStartOfQuarter`, matching `queryMedianViewsPerVideo`.
- **`asOf` is a bound parameter**, defaulting to now, so "how old is this
  video" is fixed for a given call and testable rather than depending on
  server clock drift mid-query.

## 3. Growth

Growth against the prior cohort, per checkpoint:
`median_N / prior.median_N - 1`.

Returned `null` unless **both** cohorts have `matureVideoCount >= 5`, with
the reason surfaced rather than the number silently absent:

| reason | meaning |
|---|---|
| `no_prior_cohort` | the first cohort has nothing to compare against |
| `insufficient_sample` | one or both sides rest on fewer than 5 mature videos |
| `no_prior_baseline` | the prior cohort's median is zero, so a ratio is undefined |

Without the gate a headline "up 340%" can be two videos' luck. This is a
pure function over already-fetched rows, so it is unit-tested directly.

## 4. Implementation Map

| File | Change |
|------|--------|
| `packages/clickhouse/src/queries-advanced.ts` | `queryCohortCurves` → `queryCohortMedians`, returning median/p25/p75/mean and `matureVideoCount` per checkpoint. `CohortRow` → `CohortMedianRow`. |
| `packages/clickhouse/src/lib/cohort-growth.ts` | Pure `computeCohortGrowth(rows, checkpoints, minMatureVideos)`, returning growth or a suppression reason per cohort/checkpoint. |
| `packages/features/content-analytics/src/server/deep-dive-actions.ts` | `getCohortCurvesAction` drops the mean and the per-cohort maturity flag, gains `bucket` and the growth output. |
| `packages/features/content-analytics/src/components/deep-dive/cohort-curves-chart.tsx` | `CohortEntry` carries median, spread and growth; immature checkpoints stay dashed, and a figure resting on fewer than 5 mature videos is dimmed rather than hidden. |

## 5. Acceptance Criteria

- [x] Cohort figures are medians, with p25/p75 and mean alongside
- [x] Each checkpoint filters on the video's own age, not the cohort's start
- [x] `matureVideoCount` is returned per cohort per checkpoint
- [x] Videos with no metric rows count as zero in the median
- [x] `bucket` selects month or quarter
- [x] Growth is suppressed with a reason when either side has fewer than 5 mature videos
- [x] Growth is suppressed when the prior median is zero
- [x] The chart renders medians, marks immature checkpoints, and dims low-sample figures

## 6. Verification

```bash
pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
pnpm typecheck && pnpm lint
```

The growth logic and the SQL shape are testable now. The numbers themselves
cannot be verified until ClickHouse is provisioned
(`CLICKHOUSE_ENABLED=false`): the chart renders as no cohorts.

Note this changes existing figures — the chart moves from mean to median,
and immature videos stop dragging their cohort down. That is the point, but
it means the two are not comparable to earlier screenshots.
