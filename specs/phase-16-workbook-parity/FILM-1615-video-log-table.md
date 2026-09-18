---
spec_id: FILM-1615
title: Video Log Table
status: DRAFT
effort: M
dependencies: FILM-1603, FILM-1611; FILM-1610 soft (the note column, §4)
---

# Video Log Table

## 1. Overview

Sheet 1 of the workbook — the per-video row the rest of the workbook is
derived from — exists in this codebase as a query, an action and eleven CSV
columns. It has **no screen**.

FILM-1603 built `queryVideoViewsAtAge` and `getVideoLogAction`
(`server/video-log-actions.ts:100`), which returns a fully-formed
`VideoLogRow` (`:60-84`): views at 30/90/180/365 days, CTR, average view
duration and percentage, lifetime views, revenue, channel name, and three
fields that exist for honesty rather than for data — `matureAt`,
`predatesIngestAt` and `ingestLagDays`. FILM-1603 §5 deferred the table
itself, and the phase README warns that anyone sizing the UI work from its
name alone will undercount it.

The CSV export already ships the columns
(`lib/raw-export-generator.ts`), so the numbers are reachable today by
downloading a file. What is missing is the view the workbook is actually
organised around.

## 2. Three States Per Cell, Not Two

This is the whole reason the table is a spec rather than a ticket. A
`viewsAt[30]` cell has **three** distinct meanings, and the row already
carries the flags to tell them apart:

| state | condition | must render as |
|---|---|---|
| **a real figure** | `matureAt[30]` and not `predatesIngestAt[30]` | the number |
| **not yet knowable** | `matureAt[30] === false` | greyed, not a number — the video is younger than 30 days |
| **unknowable** | `predatesIngestAt[30] === true` | distinct from both — the window closed before this channel's ingest began, and no API can recover it |

Rendering any of the three as `0` is the failure this table exists to
prevent, and it is a comfortable failure to ship: a zero looks like data,
sorts like data, and averages like data. FILM-1603 §2 and FILM-1604 §2 both
fixed this at the query layer; the table is where it becomes visible or is
thrown away.

The CSV solved the same problem by emitting an **empty cell**
(`checkpointCell`, `raw-export-generator.ts:53-56`) rather than a zero. The
table must be at least as honest, and it has more room to explain itself —
a tooltip saying *why* a cell is empty, which the CSV cannot carry.

`ingestLagDays > 1` flags the whole row: the video's early life was
partially missed, so even a mature, non-predating `@30d` is truncated. This
is the phase README's "most important caveat in the workbook", and it
affects **every historical video**.

## 3. Conventions Fixed Here

- **Sorting is server-side and whitelisted.** The action accepts exactly
  `published_at`, `lifetime_views` and `title`
  (`VIDEO_AGE_ORDER_COLUMNS`, `queries-advanced.ts:854`; the whitelist
  exists because ClickHouse cannot bind an identifier as a parameter).
  Offering a sort on any other column would sort **one page** client-side
  while presenting itself as a sort of the whole log — the same figure, a
  different and wrong answer.
- **Pagination is explicit, never infinite scroll.** `limit` is capped at
  500 by the schema and defaults to 200. A table that keeps appending pages
  invites a user to scroll to a "total" that is a page count.
- **Project-level with a channel filter** — the locked decision (phase
  README). The action accepts `accountId`, but an account-scale log needs
  `publishedFrom` enforced, which is an open question, not this spec.
- **Quality metrics are lifetime, and the checkpoints are not.** CTR and
  average view duration come from `queryQualityMetricsForVideos`
  deliberately unbounded (`video-log-actions.ts:135-141`), while
  `viewsAt[N]` is age-bounded. Two different windows sit in one row; the
  column headers must say which is which, or a reader will compare them.

## 4. Implementation Map

| File | Change |
|------|--------|
| `packages/features/content-analytics/src/components/video-log/video-log-table.tsx` | New. Renders `VideoLogRow[]` with the three-state checkpoint cells of §2, a row-level ingest-lag flag, sortable headers **only** for the three whitelisted columns, and explicit pagination controls. Horizontal overflow scrolls inside its own container — sixteen columns will not fit, and the page body must not scroll sideways. |
| `packages/features/content-analytics/src/components/video-log/checkpoint-cell.tsx` | New, small, and separate on purpose: one component owns the three-state decision so the four checkpoint columns cannot disagree about it. Give it `data-test` hooks per state — this is the behaviour most worth an E2E assertion in the phase. |
| `packages/features/content-analytics/src/components/video-log/index.ts` | Barrel, matching `deep-dive/index.ts`. |
| `packages/features/content-analytics/src/components/analytics-dashboard.tsx` | New "Video Log" tab beside the existing six (`:371-378`). |
| ↑ | Reuse the `ChannelFilter` built in FILM-1611 rather than adding a second selector — two channel pickers with independent state on one dashboard is how the tabs start disagreeing about what is selected. |
| `packages/features/content-analytics/src/server/video-log-actions.ts` | No signature change. If FILM-1610 has landed, `VideoLogRow.analyticsNote` renders as an editable cell; if it has not, the column is simply absent — FILM-1603 already establishes that the action "leaves the field out entirely rather than" faking one. |
| `packages/features/content-analytics/src/components/video-log/note-cell.tsx` | New, only if FILM-1610 has landed. **This spec owns the note editor**: FILM-1610 §7 ships the column and `updatePublishNoteAction` and leaves the cell here. `react-hook-form` + `@kit/ui/form`, per the root `CLAUDE.md`, with `data-test` on the input and the save control. Land FILM-1610 first so this ships in one piece. **Editable only where `VideoLogRow.canEditNote` is true** (FILM-1610 computes it from the `publishes_update` roles); elsewhere the note renders read-only. The E2E must assert both: a project member gets an editor, and an account member who is not on the project gets read-only text — that is what proves `canEditNote` agrees with the policy. |

## 5. Bounding

Nothing new. The action is already bounded: `limit` 1–500, `offset`,
whitelisted `orderBy`, and `publishedFrom` / `publishedTo` as strict
`YYYY-MM-DD`. The table must not add a fetch that ignores those — in
particular it must not fetch every page to compute a client-side total or
median. There is no total row; a footer that sums the current page must say
it is summing the page.

## 6. Out of Scope

- **Account-scale Video Log** — see §3; needs an enforced `publishedFrom`.
- **Per-video drill-down into retention** — FILM-1616 owns the retention
  action and the chart; a row-click target can be added once it exists.
- **New CSV columns** — already shipped by FILM-1603.

## 7. Acceptance Criteria

- [ ] A "Video Log" tab renders one row per video for the selected project
- [ ] An immature checkpoint renders greyed and is visually distinct from zero
- [ ] A checkpoint that predates the channel's ingest renders distinctly from both a figure and an immature cell
- [ ] A video with a real zero at a mature checkpoint renders `0`, not an empty cell
- [ ] Rows with `ingestLagDays > 1` are flagged, with an explanation available
- [ ] Sorting is offered only on published date, lifetime views and title
- [ ] Sorting re-queries the server and does not reorder the current page client-side
- [ ] Pagination is explicit and respects the 500-row cap
- [ ] The channel filter is the same component the Deep Dive tab uses
- [ ] Column headers distinguish age-bounded checkpoints from lifetime CTR and duration
- [ ] The table scrolls horizontally within its own container; the page body does not
- [ ] Any footer total states that it covers the current page only
- [ ] A loading state renders while the action is in flight
- [ ] If FILM-1610 has landed, a note saved from a row survives a re-query, and a second edit to the same row saves the second value, not the first
- [ ] The note is editable only where `canEditNote` is true; an account member who is not on the video's project sees it read-only
- [ ] If FILM-1610 has not landed, the note column is absent rather than rendered empty

## 8. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm typecheck && pnpm lint
npx playwright test video-log        # from apps/e2e; the guard half
```

**Playwright is required**, not optional — the table is interactive
(server-side sort, pagination, and the note editor if FILM-1610 has landed),
and the root `CLAUDE.md` requires a spec before an interactive component's
criteria are ticked. It comes in the two halves FILM-1617 used in
`apps/e2e/tests/deep-dive/`, because with ClickHouse off the table has no
rows to sort, page or annotate:

- **A guard spec that runs in CI, with ClickHouse off**: the tab mounts,
  the empty state renders, the loading state appears, and the note column
  is absent or present according to whether FILM-1610 has landed. Seed
  through the API (`tests/utils/seed.ts`).
- **An evidence spec, gated on `CAPTURE_EVIDENCE` and
  `CLICKHOUSE_EVIDENCE`** as `subscriber-evidence.spec.ts` is, that seeds
  real rows and drives the table: the three checkpoint-cell states, a
  server-side sort, a page turn, and a note saved *twice* on one row with
  the second value surviving a re-query. Its screenshots and DOM readings
  go in the PR.

The second half cannot run in CI. Say so in the PR rather than letting a
green guard spec imply the editor was exercised.

Then run the app and open the tab. The three-state cell logic is a pure
function of `matureAt` / `predatesIngestAt` and is unit-testable now — do
that, because it is the part that matters and the part a green typecheck
says nothing about.

What cannot be verified: every actual number. `CLICKHOUSE_ENABLED=false`,
so `getVideoLogAction` returns an empty array and the table renders its
empty state. Confirming that immature and pre-ingest cells look different
from zero therefore needs seeded fixture rows in the component test, not a
running app.
