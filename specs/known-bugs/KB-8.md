---
id: KB-8
title: "An experiment's baseline misses days not yet ingested"
status: fixed
fixed_in: ["#352"]
fixed_summary: "A baseline never picked up the days that had not arrived at the start; it is measured again at conclusion and both are shown"
severity: Low
found: 2026-09-19
---

## KB-8 — An experiment's baseline misses days not yet ingested

**Severity:** Low, and disclosed. **Found:** FILM-1610 review, round 4.

The baseline is measured when the experiment starts, over the
`review_window_days` before the start. YouTube's reporting data arrives
days late, so the last days of that window usually have no rows yet, and
the baseline never picks them up later. The page says so ("data on N of
M days"), so nothing is misreported, but the figure is less complete than
it could be. Option: measure the baseline window again at conclusion,
when it is fully ingested, and keep both. That changes what the baseline
means, so it needs a decision first.

> **Decided (owner, 2026-09-24):** re-measure at conclusion and keep both; the
> page shows both, labelled, each with "data on N of M days", and **draws no
> headline comparison** between them.
>
> **Fixed (2026-09-24), #352.** `concludeExperimentAction` measures the
> baseline window again and stores it as `result_metrics.baselineRemeasured`
> — written once, by the conclusion, which the lifecycle trigger already
> allows. The start's baseline is never rewritten. A metric with no window
> (`views_at_30d`) is not re-measured.
>
> - [x] Measured against the local ClickHouse
>   (`experiments-manage-evidence.spec.ts`): baseline at start **6.0%, data on
>   2 of 30 days**; the late day arrives; at conclusion the same window reads
>   **4.5%, data on 3 of 30 days** — hand-computed 120/2,000 and 180/4,000
> - [x] Unit: the re-measure covers the baseline window, skips an
>   age-bounded metric and an unwatched change, and never writes
>   `baseline_metrics` (each seen red under its mutation)
>
> **Still true, and disclosed rather than fixed:** the *result* window has
> the same late-days gap at conclusion, and cannot be measured again without a
> later write. The page says "data on N of M days" for it too. And production
> runs with ClickHouse off, so there every watched value is "no data" either
> way.
