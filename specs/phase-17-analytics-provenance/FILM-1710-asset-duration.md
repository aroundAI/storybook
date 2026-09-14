---
spec_id: FILM-1710
title: Asset Duration
status: DRAFT
effort: M
dependencies: FILM-1711 (TikTok leg only)
---

# Asset Duration

## 1. A latent data defect, not a live incident

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

### Corrected: the column is wrong, but nothing reads it

**An earlier version of this section claimed the Hook Lab is producing wrong
verdicts today — that `retentionAtSeconds` receives the episode duration, so
every short-form variant clears `0.75` and a winner is auto-declared. The code
does not do that, and the claim is withdrawn.**

`refreshTestRetention` reads **`hook_variants.duration_seconds`**
(`hook-retention.ts:72`, used at `:81`), not `video_dim.duration_seconds`.
That column is `numeric default 5` (`71-hook-testing.sql:46`), so it is never
null and never the episode's duration. This section previously asserted that
column "is not used on that path"; it is, at `:81`.

`video_dim.duration_seconds` has **no readers at all** — no hits anywhere in
`packages/clickhouse/src/queries*.ts`, and the only `retentionAtSeconds`
caller is the Hook Lab path above. The column is written by `dim-sync.ts` and
read by nothing.

So this is a **latent write-only data defect, not a live incident**, and it
does not need to ship before the rest of the phase. What it does need is to
ship before anything starts reading the column — which phase-16 FILM-1616 is
the first thing to do, via `getRetentionCurveAction`'s `durationSeconds`.

**A separate, real bug is visible here and is not this spec's scope.**
Dividing `t = 3s` by a 5-second hook-length default puts the checkpoint at
60% through the whole video's retention curve, because `elapsed_ratio` is a
position through the *video*, not through the hook. That understates
retention rather than auto-declaring winners — the opposite sign to the
withdrawn claim. It wants its own ticket against `hook_variants`.

## 2. Fix

**Record what the platform actually served**, not what we rendered.

| Layer | Change |
|---|---|
| Postgres | `publishes.duration_seconds integer` (nullable) |
| Sync | Write it from the provider — YouTube `contentDetails.duration`, **TikTok `duration`** (confirmed on `/v2/video/query/`), Instagram `video_duration` |
| ClickHouse | Migration `009_video_dim_asset_duration`: add `asset_duration_seconds Nullable(UInt32)` |
| `dim-sync.ts` | Read the publish's duration; **stop falling back to the episode** |

**Add a column rather than reusing `duration_seconds`.** The existing column is
`UInt32`, where `0` and "unknown" are indistinguishable — which is how this
survived. And rename the existing field to `episode_duration_seconds` in
`VideoDim` so every current reader **fails to compile** rather than silently
reading a column whose meaning has changed.

Nullable is the point: absence must be representable, because it is the state
every historical row is in.

**TikTok's is confirmed available.** `duration` is on the documented field list
for `POST /v2/video/query/` (FILM-1721 §4) — the same endpoint we already call,
requiring only the `video.list` scope FILM-1711 adds. No extra integration.

**A backfill is required, and the first draft was wrong to say otherwise.**
It claimed "nothing has been published yet" — but §1 says the Hook Lab is
producing wrong verdicts *today*, and FILM-1701 §6 counts 41 live publishes.
Both cannot be true.

The nightly `upsertVideoDims()` reconcile copies `publishes.duration_seconds`
into `video_dim`, but the provider sync only *writes* that column going
forward. So existing publishes keep a null asset duration forever unless
something fetches it for them.

That means a one-off backfill that re-reads each published asset's duration
from its provider — YouTube `videos.list` (1 unit, batched), TikTok
`/v2/video/query/` `duration`, Instagram `video_duration`. Until it runs, those
rows are `duration_unknown` by §3's rules, which is correct but is *not* a
corrected figure.

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
- [ ] Existing publishes have their asset duration backfilled from the provider, not left null
- [ ] Existing short-form retention caches are cleared, and recomputed **where a duration is now known**; where it is not, they read `duration_unknown` rather than a stale figure
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
