---
spec_id: FILM-1616
title: Weekly Diagnostics & Retention Drill-Down
status: ✅ DONE
effort: M
dependencies: FILM-1602; FILM-1710 soft (the cliff timestamp, §4)
---

# Weekly Diagnostics & Retention Drill-Down

## 1. Overview

Two finished components have been sitting in `deep-dive/index.ts` since
Phase 15 with **no action behind them**. Unlike the orphans FILM-1611
mounts — where the data already exists and only a caller was missing —
these two need a data path built.

`WeeklyDiagnosticsTable` (`deep-dive/weekly-diagnostics-table.tsx:56`)
renders `DiagnosticRow[]` (`:16-28`): recent publishes with views,
impressions, CTR, average view duration, and an optional detected retention
`cliff`. **There is no `getWeeklyDiagnosticsAction` anywhere in the repo.**

`RetentionCurveChart` (`deep-dive/retention-curve-chart.tsx:32`) renders
`RetentionPoint[]` — `{ elapsedRatio, audienceWatchRatio }`. The query
exists (`queries-detail.ts:55` `queryRetentionCurve`) and has exactly one
caller: the scheduled-reports cron. No action exposes it to a page.

The two belong together. `WeeklyDiagnosticsTable` accepts an `onSelect`
prop (`:33`) that **nothing ever passes** — it is the drill-down from "this
video has a cliff" to "here is the curve", designed and never connected.

The workbook has one scalar retention cell. This is one of the places the
platform is ahead of it, and it currently ships to nobody.

## 2. The Ownership Check Is the Spec

`queryRetentionCurve` takes a `videoId` and applies **no tenant predicate
of its own**. Nor does `queryQualityMetricsForVideos`. This is deliberate
and documented: the connection-keyed and id-keyed queries in
`@kit/clickhouse` take id lists, and the tenant check lives in the calling
action (`queries-advanced.ts:1080-1085`). ClickHouse is outside Postgres RLS
entirely, so there is no second line of defence behind it.

**Both now accept an optional `projectIds`, and it is not that defence**
(added in #274). It exists to stop a `video_id`-only filter scanning a table
whose sort key starts with `project_id`, and its own documentation says it
bounds what is *read* and never what is *returned*. It is optional, so a
caller that omits it gets no filter and no error; and it is the caller —
the same caller whose `publishId` is in question — that would supply it.
Passing it is worth doing for the read cost, and changes nothing about this
section: the ownership check below is still the whole of the defence.

An action that takes a caller-supplied `publishId` and hands it to
`queryRetentionCurve` therefore returns **any tenant's retention curve** to
anyone who can guess a uuid.

This is not hypothetical for this phase. FILM-1613 shipped in this same
phase for exactly this bug class — `evaluateRevenueAlerts` read
`revenue_records` on the admin client with no account predicate, and every
account's revenue alert was computed from platform-wide figures. The
mitigation there was scoping the read; the mitigation here is resolving the
publish through the **user-scoped** Supabase client before the ClickHouse
call, so RLS answers the question.

Concretely: resolve `publishId` → `publishes` → `episodes` → `projects`
with the user's own client, and treat "no row" as not-found. Do not use
`getSupabaseServerAdminClient` for that lookup. Do not check membership by
comparing an account id the caller also supplied.

`getWeeklyDiagnosticsAction` has the same obligation, discharged
differently: it *derives* its publish list from a scope rather than
accepting one, so `assertScopeAccess(scope)` plus a scoped publish query
bounds it — the same shape `getVideoLogAction` uses.

## 3. Conventions Fixed Here

- **A cliff is detected, never stored.** `detectRetentionCliff`
  (`lib/retention.ts`) is pure and already unit-tested. It runs on the
  fetched curve; nothing writes a `has_cliff` column that can go stale
  against a re-fetched curve.
- **The diagnostics table is a breakage check, not strategy.** It answers
  "did something break this week", and the deep-dive cards answer "what
  should we make next". Keep it visually distinct from them, or its framing
  is lost and users will read a low-CTR flag as a content verdict.
- **Retention curves are fetched per video, so the list is capped.** One
  query per video is the only shape the table supports; the cap and the
  concurrency limit are part of the design, not a tuning detail.
- **A missing curve is missing, not flat.** Videos with no retention rows
  return `cliff: null`, and the chart renders an empty state. A zero-filled
  curve would render as a video nobody watched.

## 4. Implementation Map

| File | Change |
|------|--------|
| `packages/features/content-analytics/src/server/diagnostics-actions.ts` | New `getWeeklyDiagnosticsAction({ scope, sinceDays, limit })`. `assertScopeAccess(scope)` first. Recent publishes from Postgres (paged with `fetchAllRows` — FILM-1612 exists because an unbounded `.select()` returns a short body with HTTP 200 and `error: null`), then `queryQualityMetricsForVideos` for the batch, then per-video `queryRetentionCurve` → `detectRetentionCliff`. Returns `DiagnosticRow[]` — the component's existing type, unchanged. |
| ↑ | Cap the video count and bound concurrency the way `apps/web/app/api/reports/scheduled/route.ts` already does: `MAX_RETENTION_VIDEOS = 500` (`:40`, applied at `:269` with a `logger.warn` when the cap bites), then `for (const batch of chunkIds(withMetrics, RETENTION_CONCURRENCY))` with an `await Promise.all` per batch (`:282`). Reuse that pattern rather than inventing a second one; an unbounded `Promise.all` over a week of publishes opens one ClickHouse connection per video, which the comment at `:266-267` says outright. Note that comment also wants a batched `queryRetentionCurves(videoIds)` — worth doing here, and it would remove the fan-out from both call sites. |
| `packages/features/content-analytics/src/server/diagnostics-actions.ts` | New `getRetentionCurveAction({ publishId })` with the §2 ownership check. Returns `{ points, durationSeconds }` — the chart's props. **`durationSeconds` must not come from `video_dim.duration_seconds`**: that column holds the *episode's* duration, falling back to its target and then `0` (`dim-sync.ts:166-168`), so a Short's cliff would be labelled far past the end of the clip. Either take FILM-1710's `asset_duration_seconds` (its YouTube leg does not need FILM-1711), or ship first with `durationSeconds` omitted — `RetentionCurveChart` and `detectRetentionCliff` already treat it as optional, and the cliff then shows its position through the video without a time. The phase plan ships the fallback, so closing phase 16 does not wait on phase 17. |
| `packages/features/content-analytics/src/components/deep-dive/weekly-diagnostics-table.tsx` | Unchanged props; `onSelect` finally gets passed. `lowCtrThreshold` keeps its 0.03 default. |
| `packages/features/content-analytics/src/components/deep-dive/retention-curve-chart.tsx` | Unchanged props. |
| `packages/features/content-analytics/src/components/deep-dive/deep-dive-tab.tsx` | Mount the diagnostics table, visually separated from the four strategy cards, with the drill-down opening the curve for the selected publish. |
| `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/analytics/page.tsx` | Second surface for `RetentionCurveChart` — the natural home for a single video's curve. The page is a client component fetching `/api/analytics/episode/${episode.id}` (`:44`); the curve is a separate action call, not a new field on that endpoint, so the ownership check in §2 stays the single gate. |
| `packages/features/content-analytics/src/server/index.ts` | Export both actions. |

## 5. Bounding

`getWeeklyDiagnosticsAction` is bounded three ways and needs all three: a
date window (`sinceDays`), a hard video cap, and a concurrency limit on the
per-video curve fetches. The first two bound the work; only the third
bounds the load.

`getRetentionCurveAction` is a single-video read and needs no bounding
beyond its ownership check.

## 6. Out of Scope

- **Storing detected cliffs** — see §3.
- **Retention for non-YouTube platforms** — `video_retention_curves` is fed
  only by the YouTube path; other platforms render as no curve.
- **Alerting on a cliff** — the table surfaces it; notifications are a
  different feature with a different cadence.
- **Mounting the other three orphans** — FILM-1611.

## 7. Acceptance Criteria

- [x] `getWeeklyDiagnosticsAction` returns rows matching `DiagnosticRow` without changing the component's type
- [x] It calls `assertScopeAccess` before any query
- [x] Its publish read is paged and cannot be silently truncated at 1,000 rows
- [x] The number of retention curves fetched per call is capped, and the fan-out concurrency is bounded
- [x] `getRetentionCurveAction` resolves the publish through the user-scoped client and returns not-found for a publish outside the caller's accounts
- [x] A publish id belonging to another tenant returns no curve, and the test asserts this explicitly
- [x] A video with no retention rows yields `cliff: null` and an empty chart, never a flat zero curve
- [x] `onSelect` is passed, and selecting a row opens that video's curve
- [x] The retention chart also renders on the episode analytics page
- [x] The diagnostics table is visually distinct from the deep-dive strategy cards
- [x] Cliff detection reuses `detectRetentionCliff` and adds no second implementation
- [x] Nothing reads `video_dim.duration_seconds`; `durationSeconds` is FILM-1710's asset duration or is omitted

## 7b. What shipped differently from §4

- **The fan-out became a batched `queryRetentionCurves`**, as the note in §4
  suggested. `RETENTION_CONCURRENCY` went with it — the concurrency limit
  only existed to bound the fan-out. `MAX_RETENTION_VIDEOS` stays, because
  it bounds the rows returned rather than the requests made.
- **`DiagnosticRow` needs three ClickHouse reads, not two.**
  `VideoQualityMetrics` has `impressionsCtr`, not `ctr`, and carries no
  `views` at all — those come from `queryTotalsByVideoIds`. All three are
  project-bounded.
- **The episode page was dead, not merely unwired.** It fetched
  `/api/analytics/episode/{id}`, a route that was never built; the 404 was
  swallowed by `if (response.ok)`, so every episode rendered the empty state.
  It reads `getEpisodeAnalytics` through an action now. The curve needed a
  second action to resolve the episode's YouTube publish, since the chart is
  keyed on a publish and only YouTube reports a curve.
- **Two seeder defects surfaced.** `seedPublishedEpisode` set no `slug`, and
  the episode routes resolve `[episodeSlug]` with `.eq('slug', …)` — so no
  test could reach an episode page. It also never set `publishes.title`,
  which is what the analytics surfaces read, so every row rendered
  "Untitled".

## 8. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm --filter @kit/clickhouse test
pnpm typecheck && pnpm lint
npx playwright test diagnostics      # from apps/e2e
```

The ownership check is the one thing in this spec that is **fully testable
today and must be**: it is Postgres-only, it does not depend on ClickHouse
being enabled, and it is the difference between a drill-down and a
cross-tenant read. Write that test first, with a publish from another
account.

Everything else is gated: `CLICKHOUSE_ENABLED=false`, so
`queryRetentionCurve` and `queryQualityMetricsForVideos` return empty, the
diagnostics table renders no rows and every chart renders its empty state.
A green suite proves the guard and the plumbing, not a single retention
figure.

**Playwright, in the two halves FILM-1617 used** (`apps/e2e/tests/deep-dive/`):
a guard spec in CI with ClickHouse off — both surfaces mount and render their
empty states, and a drill-down on another account's publish is refused — and
an evidence spec gated on `CAPTURE_EVIDENCE` and `CLICKHOUSE_EVIDENCE` that
seeds a real curve and screenshots the table and the chart with its cliff
marked. The evidence half cannot run in CI; the PR says so.

## 9. Risk

This spec adds the first action in the package that accepts a bare
resource id from the client rather than a scope object. Every other
analytics action takes `ScopeSchema` and leans on `assertScopeAccess`. If
the ownership check in §2 is skipped, weakened, or moved onto the admin
client for convenience, the result is a cross-tenant disclosure with no
error and no log line — the FILM-1613 failure mode, in a new place.
