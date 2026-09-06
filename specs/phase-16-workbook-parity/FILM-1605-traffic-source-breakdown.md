---
spec_id: FILM-1605
title: Traffic Source Breakdown
status: DRAFT
effort: M
dependencies: FILM-1602
---

# Traffic Source Breakdown

## 1. Overview

The workbook's Traffic Sources sheet asks where views came from, as a share
of the whole, over time. The platform ingests every number that question
needs and can answer only one seventh of it.

`video_traffic_sources` has been populated since FILM-1504, and
`csv-parsers.ts:56-75` resolves eighteen YouTube traffic-source codes to
names, with an explicit `TS_${code}` fallback at `:230` so an unrecognised
code is stored rather than dropped. The data is complete. What is missing
is a read shape.

Exactly two queries touch that table today:

| query | shape | limitation |
|---|---|---|
| `queries-detail.ts:194` `queryTrafficSources` | takes a **video-id list**, groups by `source` (+ optional date, video) | not scope-shaped; the caller must already know every video id |
| `queries-advanced.ts:391` `queryTrafficShareTrend` | takes a `DimScope`, buckets by week/month | returns **one** number — `sumIf(views, source IN browseSources)` over the total |

So a scope-shaped caller can learn the Browse+Suggested share and nothing
else. The other six surfaces — search, external, Shorts, playlists, the
channel page, direct — are in the table, aggregated by nobody. A user
asking "search is up, but up from what?" cannot be answered.

This spec adds the breakdown query, and rebuilds the existing share trend
on top of it so there is one grouping rule in the codebase rather than two.

## 2. Conventions Fixed Here

- **A source *group* is a presentation concept; a source *code* is data.**
  The table stores the raw name. Grouping happens above the SQL, in a pure
  module, so changing the taxonomy never requires a migration or a
  backfill. Storing groups instead would make every past row unfixable the
  first time the mapping is wrong — and §3 shows the mapping has at least
  three genuinely arguable rows.
- **`CHANNEL_PAGE` stays its own group**, not folded into Browse+Suggested.
  This is a locked decision (phase README): it matches Studio, and folding
  it would silently move the 60% milestone the workbook treats as a
  threshold. An implementer who "tidies" it into browse_suggested changes a
  number the user reads as a goal.
- **Unknown codes land in `other`, never nowhere.** `TS_*` names reach the
  table by design. A `switch` with no default would drop them from the
  numerator while leaving them in the denominator, so the groups would not
  sum to 100% and no error would say why.
- **Shares are computed over the returned total, not over a separate
  `COUNT(*)`.** One query, one denominator. Two queries can disagree when a
  merge lands between them.
- **Zero-view groups are returned as zero, not omitted.** A group missing
  from the result is indistinguishable from a group with no views, and a
  stacked chart that silently drops a series re-orders its colours between
  renders.

## 3. Source Groups

`TRAFFIC_SOURCE_GROUPS` in a new pure module. Seven named groups plus
`other`:

| group | codes | why |
|---|---|---|
| `browse_suggested` | `RELATED_VIDEO`, `SUBSCRIBER`, `NOTIFICATION` | Unchanged from `DEFAULT_BROWSE_SUGGESTED_SOURCES` (`queries-advanced.ts:112-116`). Changing it here would silently move an already-shipped number. |
| `search` | `YT_SEARCH` | |
| `external` | `EXTERNAL_URL` | |
| `shorts_feed` | `SHORTS`, `SOUND_PAGE`, `VIDEO_REMIXES` | The two extras are Shorts-only surfaces; a viewer arriving from a sound page is in the Shorts feed by any reading. |
| `playlists` | `PLAYLIST`, `PLAYLIST_PAGE` | |
| `channel_page` | `CHANNEL_PAGE` | Its own group — see §2. |
| `direct` | `DIRECT_OR_UNKNOWN` | Named `direct` for the UI, but it is *direct or unknown*; the label must say so. |
| `other` | `ADVERTISING`, `ANNOTATION`, `END_SCREEN`, `PRODUCT_PAGE`, `HASHTAG_PAGE`, `LIVE_REDIRECT`, and every `TS_*` | |

Three rows are arguable and are called out so a reviewer disagrees with the
decision rather than with an accident:

- **`END_SCREEN` and `ANNOTATION` are not `browse_suggested`.** They are
  surfaces on *your own* videos, not YouTube's recommender. Folding them in
  inflates the exact metric the 60% milestone is measured against, and does
  so invisibly because both are usually small.
- **`HASHTAG_PAGE` is not `search`.** A hashtag page is browse-shaped, but
  it is also not the recommender, so it goes to `other` rather than
  strengthening either claim on thin evidence.
- **`ADVERTISING` is `other`, not excluded.** Paid views are real views and
  belong in the denominator; hiding them would make organic share read
  high.

## 4. Implementation Map

| File | Change |
|------|--------|
| `packages/clickhouse/src/lib/traffic-groups.ts` | New, pure. `TRAFFIC_SOURCE_GROUPS`, `TrafficSourceGroup`, `groupForSource(source)` and `groupTrafficRows(rows, {allGroups: true})` returning per-bucket per-group views, watch minutes and share. No ClickHouse import, no I/O — the split `lib/cohort-growth.ts` (FILM-1604) and `lib/subscriber-series.ts` (FILM-1607) already establish, and the reason the grouping is unit-testable while `CLICKHOUSE_ENABLED=false`. |
| `packages/clickhouse/src/queries-advanced.ts` | New `queryTrafficSourceBreakdown({scope, bucket, startDate?, endDate?})`. Groups by `toStartOfWeek/Month(metric_date)` **and raw `source`**, never by group — the SQL must not know the taxonomy, or §2's first convention is lost and a mapping change becomes a migration. Video set from `dimSubquery(conditions)`, exactly as `queryTrafficShareTrend` does at `:417-427`. |
| `packages/clickhouse/src/queries-advanced.ts` | `queryTrafficShareTrend` reimplemented over the breakdown: fetch grouped rows, then fold `browse_suggested` share. Its **return type and numbers must not change** — `getTrafficShareTrendAction` and `TrafficShareCard` are live. Keeping two SQL paths is the alternative, and it guarantees the two drift the first time the browse set is edited. |
| `packages/features/content-analytics/src/server/deep-dive-actions.ts` | New `getTrafficBreakdownAction` reusing `ScopeSchema` and `toDimScope` (`:28`, `:43`), with `await assertScopeAccess(scope)` first like every other action in the file (`:61`, `:91`, `:121`, `:147`). The query carries no tenant predicate of its own beyond the scope conditions, so the guard is the boundary, not a formality. |
| `packages/features/content-analytics/src/components/deep-dive/traffic-share-card.tsx` | Gains a stacked variant over the group breakdown. `TrafficShareEntry` (`:6`) stays for the existing single-share mode so the card keeps working during the change. |
| `packages/clickhouse/src/server/index.ts` | Export the new query and the pure helpers, matching how `video-age.ts` and `cohort-growth.ts` are surfaced. |
| `packages/clickhouse/scripts/verify-queries.ts` | Add the new query. Its header (`:1-14`) records why: the mocked suite once shipped a `WHERE` clause ClickHouse rejects outright, behind 120 green tests. |

## 5. What the Denominator Excludes

Three facts that make this share **not** Studio's share. All three predate
this spec; all three must be stated wherever the percentage renders,
because each one silently shrinks the total rather than erroring.

1. **Unmatched videos are dropped entirely.** `report-ingest.ts:296-302`
   counts a traffic row whose video resolves to no publish and `continue`s.
   The reach and basic branches accumulate their unmatched rows into
   `channel_daily` (`:356-357`, `:409-410`); the traffic branch has no such
   residual and no table to put one in — `channel_daily` has no `source`
   column. So the traffic denominator is *matched videos only*, while the
   channel view total includes the residual. **The two are not comparable,
   and this spec does not make them so.**
2. **Nothing on the Analytics-API path writes traffic sources.** The only
   writer is the Reporting-API branch above, despite migration 003's
   comment anticipating otherwise. A channel with no report jobs has no
   traffic rows at all, and renders as an empty breakdown rather than an
   error.
3. **There is no literal "Browse" code.** `browse_suggested` is an
   approximation over three codes (phase README, known limits), so the
   figure will not match Studio's Browse row exactly.

## 6. Bounding

The breakdown is bounded by buckets × groups — at most a few hundred rows
for any window, so the *result* needs no pagination. The *scan* is bounded
by `dimSubquery`, which is the same bound `queryTrafficShareTrend` already
runs under.

`bucket` is a closed union (`'week' | 'month' | 'day'`), interpolated into
`toStartOfWeek` / `toStartOfMonth` / `toDate` by lookup, never by string
substitution of a caller value — the same treatment `VIDEO_AGE_ORDER_COLUMNS`
(`queries-advanced.ts:854`) gives `orderBy`.

## 7. Out of Scope

- **Backfilling traffic sources for channels without report jobs** — the
  Reporting API's ~30-day window makes this permanently impossible for
  older days; see the phase README's known limits.
- **A `channel_daily` traffic residual** — needs a `source` dimension on a
  table keyed `(connection_id, metric_date)`. That is a schema change with
  its own ingest work, not a query spec.
- **Per-source watch-time share as a separate view** — the query returns
  `watchTimeMinutes` per group, but deciding whether the UI shows a second
  chart is FILM-1611's call.

## 8. Acceptance Criteria

- [ ] `queryTrafficSourceBreakdown` accepts a `DimScope` and returns one row per bucket per group
- [ ] Every group in `TRAFFIC_SOURCE_GROUPS` appears in every bucket, as zero when it has no views
- [ ] Group shares within a bucket sum to 1 (within float tolerance) whenever the bucket has views
- [ ] An unrecognised `TS_*` source is counted in `other` and not dropped
- [ ] `CHANNEL_PAGE` is its own group and is absent from `browse_suggested`
- [ ] `END_SCREEN` and `ANNOTATION` are in `other`, not `browse_suggested`
- [ ] `queryTrafficShareTrend` returns the same shape and the same browse-suggested numbers as before the change
- [ ] The grouping and share maths are unit-tested with no ClickHouse client mocked at all
- [ ] `bucket` cannot inject SQL
- [ ] `getTrafficBreakdownAction` calls `assertScopeAccess` before querying
- [ ] The stacked card renders group order deterministically across re-renders
- [ ] The UI states that the denominator excludes unmatched videos

## 9. Verification

```bash
pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
pnpm typecheck && pnpm lint
```

The grouping maths, the share arithmetic and the generated SQL text are
fully testable now. **The numbers are not.** `CLICKHOUSE_ENABLED=false` in
production (`client.ts:98`), so reads return empty and the card renders as
no data — a green suite proves the query is well-formed and the taxonomy is
total, not that any figure is right.

`pnpm --filter @kit/clickhouse verify` runs the real SQL against a live
instance and is the only thing that proves ClickHouse accepts the query.
**It is in CI** — the `clickhouse-sql` job
(`.github/workflows/workflow.yml:48`) runs the migrations and then every
query against a 24.8-alpine service container on each PR, because the unit
suite mocks the client and an alias shadowing a filter column once reached
main behind 120 green tests. Locally, `./scripts/local-env.sh up` then
`verify` does the same against the same pinned image.

## 10. Risk

Rebuilding `queryTrafficShareTrend` on the new query touches a shipped,
rendered number. The mitigation is the acceptance criterion above: the
existing browse-suggested figures must be byte-identical before and after,
asserted against the same fixture. If that is inconvenient to test, the
reimplementation is the part to drop — the breakdown stands alone, and two
SQL paths for one week is cheaper than a silently moved milestone.
