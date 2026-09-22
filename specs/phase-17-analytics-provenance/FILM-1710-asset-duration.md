---
spec_id: FILM-1710
title: Asset Duration
status: ✅ DONE (TikTok leg pending FILM-1711)
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
| Sync | Write it from the provider — YouTube `contentDetails.duration` (ISO 8601, e.g. `PT15M33S`), **TikTok `duration`** (on `/v2/video/query/`). **Instagram: none — see below** |
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
from its provider — YouTube `videos.list` (1 unit, batched) and TikTok
`/v2/video/query/` `duration`. Until it runs, those rows are
`duration_unknown` by §3's rules, which is correct but is *not* a corrected
figure.

**Instagram has no asset duration to read.** An earlier draft of this spec named
Instagram `video_duration`. Checked 2026-09-21 against Meta's IG Media reference:
**there is no duration field on the Media node at all.** The name was assumed,
not sourced — the failure FILM-1721 exists to prevent, sitting in a spec that
had not been built yet. Instagram publishes are therefore `duration_unknown`
permanently unless we record the duration of the file *we uploaded* at publish
time, which we hold and Meta does not return. That is the honest source, and
it belongs in the publish worker rather than the sync. `video_duration` is on
the capability reference's forbidden list for Instagram, so nothing requests
it.

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

- [x] `publishes` carries the published asset's duration, written from the provider — `publishes.duration_seconds integer`, nullable, `check (> 0)`; one writer (`syncAssetDurations`), held by a trigger that keeps browser sessions from writing it
- [x] `video_dim` carries it nullably, distinguishable from zero — `asset_duration_seconds Nullable(UInt32)`, migration `009_video_dim_asset_duration`
- [x] The episode duration is renamed rather than repurposed, so stale readers fail to compile — `episode_duration_seconds`, in the `VideoDim` type **and** the ClickHouse column. See §9 for the writers a compile error does *not* catch
- [x] `dim-sync` no longer falls back to a target duration for an asset measurement — nor for the episode's
- [x] A 45-second Short reports a 45-second duration, not its episode's — `dim-sync.test.ts`, and against the real stack in `dim-sync.local-stack.test.ts`
- [x] `retention_3s` for a short-form variant is computed against the clip, and no longer reads ≈ 1.0 — as a property of `retentionAtSeconds` (the decisive pair in `retention.test.ts`: 0.9333 at 45s, 0.9977 at 1,320s). There are no variants left to store it on; see §9
- [x] A variant whose asset duration is unknown yields `duration_unknown`, not a winner — `retentionAtSeconds` returns `{ ok: false, reason: 'duration_unknown' }`; it cannot return a number without a known `AssetDuration`
- [x] A backfill exists for YouTube and TikTok publishes that predate the column — `POST /api/analytics/asset-duration-backfill`, cursor-resumed, driven locally
- [ ] …and has been run against production. **Operational, after deploy.** YouTube rows fill on the first run; **TikTok rows stay null until FILM-1711** adds `video.list` — the request is built and tested, and reports `scope_missing` rather than a number until then
- [x] Instagram's duration comes from the uploaded file at publish time, or is `duration_unknown` — never requested from Meta, which has no such field. **It is `duration_unknown`**: the publish path holds a URL, not a measured length (§9)
- [x] Existing short-form retention caches are cleared, and recomputed **where a duration is now known**; where it is not, they read `duration_unknown` rather than a stale figure — **moot**: `hook_variants` and `hook_tests` were dropped (guarded on being empty) by migration `20260919193447_remove-hook-lab` before this spec was built, so no cache survives to clear
- [x] Any consumer that cannot get a duration returns a named reason rather than a number — `AssetDuration` (`lib/asset-duration.ts`); `getRetentionCurveAction` returns one
- [x] `detectRetentionCliff` is not passed a duration it cannot trust — it takes an `AssetDuration`, not a number, so an episode's duration does not typecheck

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

## 9. Implementation notes (2026-09-22)

**What shipped.** Postgres migration `20260921200942_publish-asset-duration`;
ClickHouse migration `009_video_dim_asset_duration`;
`server/asset-duration-sync.ts` (the single writer, called by the hourly sync,
the manual single-publish sync and the backfill route);
`getVideoDurations` on the YouTube and TikTok providers; `AssetDuration` in
`lib/asset-duration.ts`; and the two surfaces that were waiting on this spec —
the Deep Dive retention drill-down and the episode analytics page now time the
cliff against the clip, and say nothing when they cannot.

**Deferred on FILM-1711, and only this:** TikTok durations *arriving*. The
request (`/v2/video/query/?fields=id,duration`, 20 ids a call) is written,
bound to the capability reference by `platform-field-names.test.ts`, and unit
tested — but no connection holds `video.list`, so in production it is refused
and every TikTok publish stays `duration_unknown`. Nothing is estimated in the
meantime. After FILM-1711 re-authorises connections, re-run the backfill route;
no code change is needed. Which error code TikTok sends for a valid token
lacking the scope is not in the capability reference, so such a refusal may be
counted under `provider_error` rather than `scope_missing` until FILM-1711
establishes it — either way the row stays null.

**Not verified live:** a successful provider fetch. No real YouTube or TikTok
credentials exist locally (phase 18's sandbox is not built), so
`getVideoDurations` is verified against mocked clients only. Everything around
it — candidate selection, the cursor, token refusal, gaps, the fill-only write,
the ClickHouse round trip — was run against the real local stack.

**Instagram.** §2 suggests recording the uploaded file's duration in the publish
worker. The publish path passes a video *URL*
(`episodes.final_video_url`, `shorts_groups[].videos`); no measured length of
that file exists anywhere to copy, and probing media in the publish lambda is a
new capability rather than a column. So Instagram takes the criterion's other
branch: `duration_unknown`, permanently, never requested. It wants its own
ticket if Instagram completion figures are ever needed.

**The Hook Lab criteria are moot.** §4 and two criteria in §6 concern
`hook_variants`. The Hook Lab was reviewed and removed (FILM-CC-04 KB-9/KB-10)
after this spec was written; its tables are gone, and with them the
contaminated caches and every `is_winner`. What survives is
`retentionAtSeconds`, which FILM-1724's hook tests will call — so the
guarantee was moved into its signature instead.

**A correction to §8.** "A compile error is the cheapest possible way to find
every reader" holds for TypeScript. It does not hold for the ClickHouse column:
24.8 **silently drops a JSON field it does not recognise**
(`input_format_skip_unknown_fields`), so a raw `duration_seconds` writer keeps
succeeding after the rename and stores `episode_duration_seconds = 0`. Measured:
`insertVideoDims` with the new field names *passed* against the pre-009 table.
Three E2E helpers wrote the old name as raw JSON and were found by grep, not by
failure.

**Newly permitted, and guarded.** A new column on `publishes` is writable by
any project member through `publishes_update`. `publishes_keep_asset_duration`
holds it to the service role; `publish-asset-duration.test.sql` exercises it as
a member and as the service role. Its first draft keyed on `auth.role()` and
the test showed a member's write going straight through — it keys on
`current_user` now.

**Verified** (2026-09-22, local stack, ClickHouse 24.8):

```
pnpm --filter @kit/content-analytics test     52 files, 799 tests passed
pnpm --filter @kit/clickhouse test            12 files, 325 tests passed
pnpm --filter @kit/clickhouse verify          65 passed, 0 failed  (64/1 before 009)
pgTAP publish-asset-duration.test.sql         9/9
tooling/mutation-guards  FILM-1710            11 unit + 3 pgtap + 1 e2e, all RED
```

§7's query, after the real reconcile (`upsertVideoDims()`, 49 rows) over the
seeded fixture:

| platform | content_type | episode | asset |
|---|---|---|---|
| instagram | short | 1552 | NULL (9 of 9 unknown) |
| tiktok | short | 1534 | 44 |
| youtube | full | 1534 | 1534 |
