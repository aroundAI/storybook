---
spec_id: FILM-1710
title: Asset Duration
status: DRAFT
effort: M
dependencies: none
---

# Asset Duration

## 1. This is a correctness incident, not an enhancement

`video_dim.duration_seconds` is the **episode's** duration, not the duration of
the clip that was actually published. `dim-sync.ts:166-168`:

```ts
duration_seconds:
  row.episodes?.duration_seconds ??
  row.episodes?.target_duration_seconds ??
  0,
```

Three levels of wrong: an episode's duration, then its *target* duration — a
plan, not a measurement — then zero.

In the live local fixture, Instagram and TikTok publishes with
`content_type = 'short'` average **1,550 seconds**.

### The Hook Lab is producing wrong verdicts today

`retentionAtSeconds(points, 3, durationSeconds)`
(`packages/features/content-analytics/src/lib/retention.ts:23`) converts a
time in seconds to an `elapsed_ratio` by dividing by the duration it is given.
`hook_tests.viral_threshold` (`71-hook-testing.sql:17`, default `0.75`)
declares a winner when `retention_3s` clears it.

Give it a 22-minute episode duration for a 45-second Short and `t = 3s`
resolves to `elapsed_ratio ≈ 0.002` — inside the first bucket of the retention
curve, where the curve is ≈ 1.0 by construction. **Every short-form variant
clears 0.75 and a winner is auto-declared.**

The Hook Lab is reachable at `/studio/[projectSlug]/hooks` and has a "Refresh
retention" button wired to `refreshHookTestAction`. This is live.

`hook_variants.duration_seconds` exists (`71-hook-testing.sql:46`) and is not
used on that path.

## 2. Fix

**Record what the platform actually served**, not what we rendered.

| Layer | Change |
|---|---|
| Postgres | `publishes.duration_seconds integer` (nullable) |
| Sync | Write it from the provider — YouTube `contentDetails.duration`, TikTok `duration`, Instagram `video_duration` |
| ClickHouse | Migration `009_video_dim_asset_duration`: add `asset_duration_seconds Nullable(UInt32)` |
| `dim-sync.ts` | Read the publish's duration; **stop falling back to the episode** |

**Add a column rather than reusing `duration_seconds`.** The existing column is
`UInt32`, where `0` and "unknown" are indistinguishable — which is how this
survived. And rename the existing field to `episode_duration_seconds` in
`VideoDim` so every current reader **fails to compile** rather than silently
reading a column whose meaning has changed.

Nullable is the point: absence must be representable, because it is the state
every historical row is in.

No backfill script — the nightly `upsertVideoDims()` reconcile fills it, and
nothing has been published yet.

## 3. Interim rules until it lands

These apply to any consumer written before the column exists, and afterwards to
any row where it is null:

- **Gate every completion and attention-efficiency figure** on
  `assetDurationSeconds != null` and return the named reason
  `duration_unknown`. Not a zero, not a guess.
- **Prefer the platform's own `avg_view_percentage`** over our arithmetic.
  The platform computed it against the real asset; we cannot.
- **Stop passing a duration to `detectRetentionCliff`.** It already makes
  `seconds` optional and emits it only when given one, so omitting it keeps the
  position and drops the false timestamp.
- `retentionAtSeconds` already returns `null` for `durationSeconds <= 0`. That
  is the one currently-safe path, and it is safe for the wrong reason — the
  `?? 0` fallback — which is exactly why the nullable column matters.

## 4. Contaminated data

Short-form `retention_1s/3s/5s` values in `hook_variants`, and any
`is_winner` derived from them, were computed against an episode duration and
are wrong. They are cached values (`71-hook-testing.sql:4-7` — the curve lives
in ClickHouse and these are interpolations of it), so they can be recomputed
rather than being lost.

This spec must clear them and re-run `refreshTestRetention`, not leave them to
be quietly re-read.

## 5. Out of scope

- Any signal, stage or benchmark — FILM-1713 onward.
- The `hook_type` vocabulary mismatch between `hook_variants.hook_type` (free
  text) and the taxonomy dimension — noted in FILM-1717.
- Changing `viral_threshold` or how a winner is chosen. The threshold is not
  wrong; the input to it was.

## 6. Acceptance criteria

- [ ] `publishes` carries the published asset's duration, written from the provider
- [ ] `video_dim` carries it nullably, distinguishable from zero
- [ ] The episode duration is renamed rather than repurposed, so stale readers fail to compile
- [ ] `dim-sync` no longer falls back to a target duration for an asset measurement
- [ ] A 45-second Short reports a 45-second duration, not its episode's
- [ ] `retention_3s` for a short-form variant is computed against the clip, and no longer reads ≈ 1.0
- [ ] A variant whose asset duration is unknown yields `duration_unknown`, not a winner
- [ ] Existing short-form retention caches are cleared and recomputed, not silently reused
- [ ] Any consumer that cannot get a duration returns a named reason rather than a number
- [ ] `detectRetentionCliff` is not passed a duration it cannot trust

## 7. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm --filter @kit/clickhouse test
pnpm turbo typecheck --force && pnpm lint
```

The decisive test is the one that currently fails: a retention curve plus a
45-second asset duration must yield a `retention_3s` well below 1.0, and the
same curve with a 1,320-second duration must yield ≈ 1.0 — proving the bug
reproduces before the fix and is gone after it.

Then, against the live fixture:

```sql
SELECT platform, content_type,
       round(avg(episode_duration_seconds)) AS episode,
       round(avg(asset_duration_seconds))   AS asset
FROM video_dim FINAL GROUP BY platform, content_type;
```

Shorts must show an asset duration in seconds, not in the thousands.

## 8. Risk

The rename is deliberately breaking. That is the mitigation, not the risk —
a silent meaning change on a column named `duration_seconds` is what produced
this, and a compile error is the cheapest possible way to find every reader.

The real risk is partial coverage: a nullable column written by only one of
several publish paths is the same class of defect as `revenue_cents` being
literal `0` in every writer — silent, permanent, and invisible in tests. Pick
the provider sync as the single writer, and make absence a named state.
