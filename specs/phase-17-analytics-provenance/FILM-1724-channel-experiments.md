---
spec_id: FILM-1724
title: Channel Experiments — Which Styles Work
status: DRAFT
effort: L
dependencies: FILM-1610, FILM-1715, FILM-1716; FILM-1710 for hook tests
---

# Channel Experiments — Which Styles Work

## 1. Overview

A creator makes videos in several **styles** and wants to know which work:
five thumbnail styles, of which three turn out to pull their weight. Or two
kinds of thumbnail, mouth open against mouth closed, with each new upload in
one or the other and the two groups compared afterwards.

Nothing in the product does this today.

- **The Change log (FILM-1610)** compares *the same videos* before and after
  a start date. It fits changes that can be made to a published video, such
  as a thumbnail or title, and cannot measure anything baked into the video.
  A new upload has no "before" of its own.
- **Hook Lab (FILM-1510)** maps one published video to each hook variant.
  Reviewed 2026-09-20: it cannot be used (no way to create a test), reads
  retention at the wrong place in the video, and can read another
  account's data ([FILM-CC-04](../cross-cutting/FILM-CC-04-known-bugs.md)
  KB-9, KB-10). Hook tests move here (§6).
- **Self-benchmarking (FILM-1715)** compares a video with the channel's own
  history at a comparable age. That is exactly the comparison a style needs,
  but it answers "how did this video do?", not "which of my styles does
  better?".

A channel experiment compares **groups of different videos**: one group per
style, each video measured at the same age as the others.

## 2. What the user does

1. Creates an experiment on one channel and one format family (FILM-1716:
   shorts and long-form are different products, and are never pooled),
   naming 2–8 styles.
2. As each new video goes out, assigns it to a style. The page suggests the
   style with the fewest videos so far, so the groups stay balanced. The user
   can override the suggestion, and the override is recorded.
3. Watches each style's results fill in as videos reach each age, then ends
   the experiment and records what they concluded, as the Change log does.

Only videos published **on or after the experiment's start** can be
assigned. Assigning older videos after seeing how they did would let the
result be chosen rather than observed.

## 3. Schema (hand-written migration; mirrored in `schemas/`)

- **`channel_experiments`:**
  - account, `connection_id` (required; a channel-level question), format
    family, title, hypothesis, expected outcome;
  - status, with the same lifecycle trigger pattern as FILM-1610 round 4:
    planned → running → concluded or abandoned;
  - `started_at` / `ended_at`, calendar days in the user's zone as in
    FILM-1610 E1, and the chosen metrics.
- **`channel_experiment_styles`:** experiment, name, description, sort order.
  At least 2 and at most 8, enforced by the table.
- **`channel_experiment_videos`:** style, publish, `assigned_by` and
  `assigned_at` (set by trigger, as FILM-1610 R4), and whether the suggested
  style was overridden.
  - Unique `(experiment, publish)`: a video belongs to one style per
    experiment.
  - The publish must be on the experiment's channel and account (the
    composite key pattern from FILM-1608), and published on or after
    `started_at`.
- **Freezing:** the hypothesis and expected outcome are fixed once running,
  as FILM-1610 round 5 H3. Styles can't be removed once a video is assigned
  to them.
- **RLS:** account membership reads; project-member writes. pgTAP proves
  both, including a user who belongs to two accounts.

## 4. Measures: the same age, never the same calendar window

Every measure is taken at a **video age**, so a style whose videos went out
in a busy month is not flattered by the calendar:

| Measure | Source | At |
|---|---|---|
| Views at N days | `queryVideoViewsAtAge` (FILM-1603/1715) | 7 and 30 days, mature videos only |
| CTR over the first N days | `video_reach_daily`, impression-weighted as FILM-1610 §5 | 7 days |
| Average percentage viewed, first N days | `video_daily_stats`, view-weighted | 7 days |
| Subscribers per 1,000 views, first N days | FILM-1610 `queryNetSubscribersForVideos` | 30 days |

- Checkpoints come from FILM-1715 §5, not constants.
- A video younger than a checkpoint is **pending**, not zero. Each style
  shows "n measured, m pending".
- The folds are pure functions, as in FILM-1610's `watched-metrics.ts`.

## 5. Comparing styles, honestly

- **Per style:** the median at each checkpoint, the p25–p75 range, and n.
  Reuse FILM-1715's band and confidence approach (§8 there), and don't invent
  a new statistic.
- **No verdict until every style has enough measured videos** at that
  checkpoint. The threshold is decided in review; 5 is the starting proposal.
  Until then the page says how many more each style needs.
- **After that,** a style is "ahead" only where its range doesn't overlap
  the others'. Overlapping ranges are shown as "no clear difference yet". The
  page never picks a winner from medians alone.
- **What the page states plainly:** these are associations between styles
  and outcomes on this channel, not proof of cause. Topic, timing and
  seasonality are not controlled. Balanced assignment (§2) reduces that, and
  the page says what it can't rule out.

## 6. Relation to other specs

- **FILM-1610 Change log:** stays the tool for thumbnail and title swaps on
  published videos. Its per-video queries, folds, lifecycle trigger and
  refusal handling (`withRefusals`) are reused, not copied.
- **FILM-1717 Content genome:** concluded channel experiments are the
  strongest evidence it can use, because the styles were varied on purpose.
  How it consumes them is decided there.
- **Hook tests (replacing FILM-1510's Hook Lab):** an experiment whose
  styles are hooks, measured on early retention. Two limits the review
  measured decide where that is allowed:
  - YouTube's retention curve is 1% steps of the video's length, so a
    10-minute video's first point is at 6 seconds and "retention at 3s"
    does not exist for it. Early-retention measures are offered only for
    short-form videos (FILM-1716), where the curve resolves them: about
    150 seconds or less for a 3-second point.
  - The length must be the published video's. `video_dim.duration_seconds`
    is the episode's until FILM-1710, and Hook Lab also used the hook's
    own length in its place (KB-10 H-2).

## 7. Out of scope

- YouTube's own "Test & Compare" (A/B thumbnails on one video). Its results
  are shown in YouTube Studio; whether any API exposes them is to be checked
  in FILM-1721 before anyone builds on it.
- Automatic assignment at upload time. Assignment is by hand, with a
  suggestion.
- Cross-channel experiments. Styles are compared within one channel and one
  format family.

## 8. Acceptance criteria

- [ ] An experiment has 2–8 styles, and the table refuses fewer or more (pgTAP)
- [ ] Only videos on the experiment's channel, published on or after its start, can be assigned; a video belongs to one style (pgTAP, including a two-account user)
- [ ] Lifecycle, dates and expectation are held by the table as in FILM-1610 rounds 4–5 (pgTAP)
- [ ] Each style shows each checkpoint's median, range, n measured and n pending; a pending video is never a zero (unit on the folds; E2E)
- [ ] No verdict is shown while any style is under the threshold, and overlapping ranges read "no clear difference yet" (unit; E2E)
- [ ] Suggested assignment keeps styles balanced, and an override is recorded (unit; E2E)
- [ ] Shorts and long-form never share an experiment (pgTAP)
- [ ] The happy flow — create, assign over time, watch results fill in, conclude — runs end to end on a production build against local ClickHouse, with screenshots (E2E evidence spec)
- [ ] Refusals reach the user in a production build (FILM-1610 G1 pattern)

## 9. Before building

1. ~~Review Hook Lab (FILM-1510).~~ Done 2026-09-20 (FILM-CC-04 KB-9,
   KB-10): folded into this spec as hook tests (§6). Its cross-tenant read
   (KB-9) is fixed separately, before this spec.
2. **Settle the verdict threshold and the band method** with FILM-1715,
   which owns them.

## 10. Verification

The FILM-1610 process applies:
- red before green for every guard, and a mutation-guard entry per rule;
- pgTAP for every table rule;
- an E2E happy flow on a production build (⚫️ Test) with an evidence spec;
- screenshots in the PR.
