---
spec_id: FILM-1704
title: Observed Coverage Query
status: DRAFT
effort: M
dependencies: FILM-1703
---

# Observed Coverage Query

## 1. Overview

FILM-1703 says what each platform *can* report. That is a static product fact
and it is not enough to explain a blank card. A creator looking at an empty
traffic chart needs to know which of four different things is true:

| State | Source | What it means |
|---|---|---|
| unsupported / not ingested | the matrix | "Instagram doesn't report this" |
| not connected | Postgres `platform_connections` | "No TikTok account is connected" |
| no data in window | ClickHouse, per window | "TikTok is connected, but has no rows in these 52 weeks" |
| covered | ClickHouse, per window | rows exist; how many, how fresh |

Collapsing *not connected* into *no data* is the easy mistake and the damaging
one: "no data" on a project that never had a TikTok channel reads as a pipeline
failure, and generates a support question every time.

This spec builds the query and the distribution mechanism. It renders nothing.

## 2. One query, not one per card

There are roughly fifteen cards across six tabs. A coverage query per card is
fifteen round trips for one page, re-run on every date-range change.

`queryObservedCoverage(scope, from, to)` in
`packages/clickhouse/src/queries-advanced.ts` — the module that already owns
`DimScope`, `buildDimConditions` and `dimSubquery`. One statement, `UNION ALL`
over the five fact tables (`video_metrics`, `video_traffic_sources`,
`video_reach_daily`, `video_retention_curves`, `channel_daily`), returning
`count()`, `max(metric_date)` and `groupUniqArray(metric_source)` where those
columns exist. At most fifteen rows back.

**Four of the five group by `platform`; `channel_daily` cannot** — it has no
platform column (`migrations/003_reach_and_traffic.ts:45-56`) and is keyed by
`connection_id`. That branch either joins to the connection to resolve a
platform, or emits `platform: null` and the fold resolves it. Hence the
nullable field above. Do not silently label those rows `youtube` because that
happens to be true today.

```ts
interface ObservedCoverageRow {
  table: SourceTable;
  platform: string | null;   // null for channel_daily — see below
  rows: number;
  latestDate: string | null;
  metricSources: string[];
}
```

Notes for implementation:

- Avoid `FINAL` for the counts. Coverage asks *does anything exist*, not *what
  is the deduplicated total*, and `FINAL` over five tables on every date change
  is not worth paying for an answer that does not need it.
- The table→family mapping is a matrix fact. Fold with a pure
  `foldObservedCoverage(rows, CAPABILITY_MATRIX)` living in
  `data-provenance.ts`, so it is unit-testable without a database.

## 3. The resulting state

```ts
export type CoverageState =
  | { kind: 'unsupported' | 'not_ingested'; note: string }  // matrix only
  | { kind: 'not_connected' }                               // Postgres only
  | { kind: 'no_data_in_window' }
  | { kind: 'covered'; rows: number; latestDate: string; stale: boolean };
```

`stale` exists because a table with rows whose newest is six weeks old is a
different problem from one with no rows, and both are different from healthy.
The YouTube reporting ingest lags one to three days by design, so the
threshold must be generous enough not to cry wolf — define it once, here, not
per card.

The connected half comes from `listAccountChannels`
(`server/channels.ts:105`), which already pages with `fetchAllRows`. It selects
`id, platform, platform_account_name, is_active, metadata` — it needs
`language` added for FILM-1702's channel dimension and for the strip to name a
channel's target language.

## 4. Distribution

`getCoverageMatrixAction` in a new `server/coverage-actions.ts`, following the
`enhanceAction` + `ScopeSchema` shape already established in
`server/deep-dive-actions.ts`. Fetched once in
`components/analytics-dashboard.tsx`, keyed on `[projectId, from, to]`,
published through a `CoverageContext`. Cards call `useCoverage(family)` and
issue no query of their own.

Three things to get right:

**Two windows, not one.** The page header drives a date-range picker; the Deep
Dive tab ignores it and uses a fixed 52 complete weeks
(`components/deep-dive/deep-dive-tab.tsx:53`, `TRAFFIC_WINDOW_WEEKS`). A single
page-level provider would state coverage for a window Deep Dive is not using.
The provider takes its window as a prop so Deep Dive can mount its own with
`TRAFFIC_WINDOW_LABEL`; the nesting is then deliberate rather than a bug
someone finds later.

**Split the render.** Capability needs no query and can paint immediately.
Only the observed half waits. Do not block first paint of fifteen cards on a
five-table scan.

**Cache hard.** Coverage changes when ingest runs, not when a user moves a
date picker by one day. A short `staleTime` here undoes the whole point of
asking once.

## 5. Out of scope

- Rendering. The strip, the chip and the filter dimming are FILM-1705.
- Per-video coverage. This is per (family, platform), which is the grain the
  surfaces need. A per-video answer is a different, much larger query.
- Fixing the fact that the platform filter does not reach most tabs —
  FILM-1709. This spec makes the *information* available; acting on it comes
  later.

## 6. Acceptance criteria

- [ ] One query answers coverage for the whole page; adding a card adds no query
- [ ] *Not connected*, *connected but empty in this window*, and *not supported* are three distinguishable states, never collapsed
- [ ] `channel_daily` coverage resolves a real platform rather than assuming one
- [ ] The fold from rows to `CoverageState` is pure and unit-tested without a database
- [ ] Deep Dive's coverage describes Deep Dive's 52-week window, not the header's date range
- [ ] Capability renders before the coverage query resolves
- [ ] Staleness is defined once and tolerates the YouTube reporting lag without reporting healthy ingest as stale
- [ ] Changing the date range does not re-query five tables on every keystroke
- [ ] A project with no connections at all renders an intelligible page, not fifteen error states

## 7. Verification

```bash
pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
./scripts/local-env.sh verify
pnpm turbo typecheck --force && pnpm lint
```

The FILM-1701 fixture must be able to produce all four states at once, and the
verification is that it does:

- YouTube `traffic_sources` → `covered`
- TikTok `traffic_sources` → `not_ingested` (matrix, no query needed)
- Instagram `traffic_sources` → `unsupported` (matrix)
- TikTok `engagement` with a connected channel and no rows in window → `no_data_in_window`
- a platform with no connection → `not_connected`

Measure the query count in the browser network panel on a full page load:
loading the six tabs must not scale coverage queries with card count.

## 8. Risk

The cost is real — five aggregates through `dimSubquery`, on a table that grows
with every video every day. The mitigations are in §2 and §4 (no `FINAL`,
aggressive caching, split render), but this should be measured on the largest
available project before it is considered done, not assumed.

The subtler risk is the two-window design being mistaken for a bug by a future
reader and "fixed" into one. §4 states the reason; it should also be a comment
at the provider.
