---
spec_id: FILM-1713
title: Normalised Measures, Velocity and Acceleration
status: DRAFT
effort: M
dependencies: FILM-1722
---

# Normalised Measures, Velocity and Acceleration

## 1. Overview

Raw counts are not comparable between videos. A normalised measure — a rate
against a denominator — is the layer everything above this depends on, and the
codebase currently has it in four copies and several gaps.

**Engagement rate is defined independently in four places**, all identical, no
shared helper:

- `server/aggregation-queries.ts:245-247` (per episode)
- `server/aggregation-queries.ts:872-874` (per publish)
- `server/account-dashboard-actions.ts:306-308`
- `server/language-analytics.ts:383-385`

**And these do not exist at all**, despite their inputs being persisted:

| Measure | Inputs | Status |
|---|---|---|
| Share rate | `shares`, denominator | shares summed, never divided |
| Save rate | `saves`, denominator | `saves` collected and **never turned into a ratio anywhere** |
| Subscriber conversion | `subscribers_gained`, denominator | present in totals, never per-view |
| Attention efficiency | `avg_view_duration_seconds`, asset duration | blocked on FILM-1710 |

## 2. One definition each, in a pure module

`packages/clickhouse/src/lib/measures.ts` — pure, dependency-free, the same
rule as `lib/traffic-groups.ts` and `lib/cohort-growth.ts`.

Each measure is a named export with a doc-comment stating its denominator and
why that denominator. This matters more than it sounds: the research is
emphatic that Instagram ratios belong over **reach** and not views, and reach
only exists on Instagram (FILM-1712). So the denominator is a per-platform
fact, not a constant, and it must be recorded rather than assumed.

The four duplicate engagement-rate sites all import the one definition. That
is most of the value of this spec — not the new measures, but the end of four
copies drifting.

## 3. The denominator is not stable, even within one platform

Before any rate can be defined, the thing it divides by has to be pinned down —
and `views` is not one metric.

**YouTube redefined it on 2026-08-27**, three weeks before this spec was
written: `views` now counts plays from the first frame with no minimum watch
time, for all formats. Shorts changed the same way on 2025-03-31. The previous
methodology moved to **`engagedViews`**.

So `video_metrics.views` for YouTube holds two different metrics either side of
that date, and every rate computed from it inherits the discontinuity.

**Facebook has four concurrent denominators** — impression (entered the screen,
no playback, estimated), play (≥1ms, replays excluded), 3-second view (≥3s *or*
full length if shorter), and ThruPlay (ads only, not on organic insights).

**Instagram's `views` replaced `plays`** in 2025, and **TikTok's Business-API
`video_views` mixes organic and paid** inseparably.

Every measure therefore records **which view definition produced it**, read
from FILM-1722's registry, and a measure computed across a definition change is
suppressed rather than returned. `engagedViews` is the series that is
continuous across the YouTube change and should back anything historical.

## 4. Denominators are a platform fact

| Platform | Preferred denominator | Fallback |
|---|---|---|
| Instagram | `reach` | `views`, with the substitution recorded |
| YouTube | `views` | — |
| TikTok | `views` | — |

A measure computed against a fallback denominator is **not the same measure**
and must say so, because a share rate over views and a share rate over reach
are different numbers with the same name. The measure carries which denominator
produced it, and FILM-1714 gives them different signal ids.

## 5. Velocity

Video age is already first-class — `computeMaturity`,
`checkpointPredatesIngest` (`lib/video-age.ts`), checkpoints at 30/90/180/365.
Velocity is the read *before* maturity: 1,000 views at two hours is not 1,000
views at ninety days, and a video cannot be benchmarked until it is old enough
to have peers at the same age.

```
velocity = Δ metric / Δ hours since publication
```

for views, watch minutes and shares.

**Raw `views/hour` is sharply age-sensitive**, so velocity is bucketed and only
ever compared within its bucket:

```
0–1h · 1–3h · 3–6h · 6–12h · 12–24h · 24–48h
```

Comparing a two-hour-old video's velocity to a twenty-two-hour-old one's is the
noise that makes early-warning systems get ignored.

A practical constraint: `video_metrics` is keyed by `metric_date`, a **date**,
so sub-daily velocity is not computable from it. The sub-24h buckets need
either `video_snapshots` (which carries `fetched_at`) or an accepted limit that
the finest available grain is daily. State which; do not quietly emit a
daily-grain number into an hourly bucket.

## 6. Acceleration

Velocity alone cannot tell a dying video from one that is breaking out:

```
Video A:  100 → 120 → 110 views/hour    decelerating
Video B:  100 → 150 → 240 views/hour    accelerating
```

Both have "high velocity" at some point. Only the second derivative
distinguishes them, and catching the second one early is the point.

```
velocity_delta  = velocity(t) − velocity(t−1)
velocity_ratio  = velocity(t) / velocity(t−1)
growth_state    = accelerating | stable | decelerating | stalled
```

`growth_state` is a **named state with thresholds**, and per house style each
threshold is a named constant with a doc-comment arguing that number. `stalled`
is not `decelerating` — one is "this is over", the other is "this is cooling" —
and both are different from "we do not have two points yet", which is a named
absent state, not `stable`.

## 7. Out of scope

- Comparing any of these to a cohort — FILM-1715. This spec produces the
  measure; benchmarking it is the next layer.
- Binding measures to funnel stages — FILM-1714.
- Attention efficiency as a *rendered* figure, which waits on FILM-1710's asset
  duration. The measure is defined here and gated on a non-null duration.

## 8. Acceptance criteria

- [ ] Engagement rate has exactly one definition in the repository
- [ ] Share rate, save rate and subscriber conversion exist and are unit-tested
- [ ] Every measure records the denominator that produced it, **including which view definition and its effective date**
- [ ] A measure spanning a view-definition change is suppressed with a named reason, not returned
- [ ] `engagedViews` backs any YouTube series crossing 2026-08-27
- [ ] A measure computed over a fallback denominator is distinguishable from one over the preferred denominator
- [ ] Velocity is only compared within an age bucket
- [ ] The finest genuinely available time grain is stated, and no measure is emitted at a finer one than the data supports
- [ ] Acceleration distinguishes accelerating, stable, decelerating and stalled
- [ ] "Not enough points yet" is a named state, not `stable`
- [ ] Every threshold is a named constant with a doc-comment arguing the number
- [ ] Attention efficiency returns `duration_unknown` rather than a figure when the asset duration is null

## 9. Verification

```bash
pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
pnpm turbo typecheck --force && pnpm lint
```

Unit tests carry this spec — it is pure arithmetic and should need no database.
Assert specifically:

- a zero denominator yields a named absent state, never `Infinity` or `0`
- the same video at two different ages yields different velocity buckets and is
  never compared across them
- a velocity series of `100 → 120 → 110` is `decelerating` and `100 → 150 → 240`
  is `accelerating`, with the boundary cases at each threshold
- removing the shared engagement-rate import from any of the four former
  duplicate sites fails typecheck

## 10. Risk

The genuine risk is quiet precision loss: emitting an hourly-looking velocity
from daily-grain data. It would look right, be wrong, and feed everything
above. §4 requires stating the grain explicitly for exactly this reason.

The second is threshold proliferation — four `growth_state` boundaries plus six
bucket edges is ten numbers, each of which needs a justification or it becomes
the kind of unargued constant this codebase has otherwise avoided.
