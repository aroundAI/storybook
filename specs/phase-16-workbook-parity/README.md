# Phase 16: Workbook Parity

Closes the gap between Phase 15's analytics discipline and the *YouTube Channel Metrics Tracker* workbook. A gap-check found roughly two-thirds of the workbook covered, with the misses clustered on the columns the workbook itself calls "the numbers that actually matter", plus eight correctness defects — one introduced by Phase 15.

## Specs & Dependency Order

Shipped:

```
FILM-1601 (correctness bugs + revenue delete RLS)
     │
     ├─→ FILM-1602 (channel dimension + per-channel YPP)
     │        │
     │        └─→ FILM-1612 (PostgREST row-cap pagination sweep)
     │                 │
     │                 ├─→ FILM-1603 (per-video views-at-age + Video Log)
     │                 │        │
     │                 │        └─→ FILM-1604 (cohort medians + growth)
     │                 │
     │                 └─→ FILM-1607 (absolute subscriber snapshots)
     │
     └─→ FILM-1613 (revenue alert account scoping)

FILM-1605 (traffic source breakdown)        ← FILM-1602
FILM-1606 (segment performance)             ← FILM-1603, FILM-1605
FILM-1608 (YPP targets settings)            ← FILM-1602
FILM-1609 (revenue mix completion)          ← FILM-1601
FILM-1618 (channel residual subscribers)    ← FILM-1601, FILM-1607
FILM-1611 (channel selector + orphan wiring) ← FILM-1606, FILM-1608, FILM-1609
FILM-1617 (subscriber surfaces)              ← FILM-1607, FILM-1611, FILM-1618
```

Specified, not yet built:

```
FILM-1610 (experiment log + per-video notes) — needs FILM-1602, 1603, 1605, all ✅
     ┆ soft: the note column and its action
     ▼
FILM-1615 (Video Log table + note editor)     ← FILM-1603 ✅, FILM-1611 ✅

FILM-1616 (weekly diagnostics + retention drill-down) — needs FILM-1602 ✅;
          duration from FILM-1710, or ship without one (below)
```

**FILM-1611 (PR #260) and FILM-1617 (PR #262) shipped.**

**FILM-1610 before FILM-1615.** Not a hard dependency, but the two specs
handed the note editor to each other: FILM-1610 §7 left the editable cell to
the table, and FILM-1615 §6 left editing notes to FILM-1610. FILM-1615 now
owns the cell. If FILM-1610 lands first the table ships complete; if not,
the note column is left out and needs a follow-up.

**FILM-1616 and FILM-1710.** It adds
`getRetentionCurveAction`, returning `{ points, durationSeconds }` for
`RetentionCurveChart`, which converts `elapsed_ratio` to seconds by
multiplying by that duration. The only per-video duration in ClickHouse is
`video_dim.duration_seconds`, which holds the **episode's** duration rather
than the published clip's (phase-17 FILM-1710). The column has no readers
today, so FILM-1616 would be the first — it must either take FILM-1710
first or omit the duration, and it must never read that column. FILM-1616
§4 now says so; the plan is to ship the fallback so phase 16 can close
without waiting on phase 17.

All three remaining specs — FILM-1610, 1615 and 1616 — can start today. Order FILM-1610 ahead of FILM-1615 for the reason above; FILM-1616 is independent of both.

**FILM-1614 is not a phase-16 spec.** The id is claimed by an in-code `TODO(FILM-1614)` at `packages/features/content-analytics/src/server/revenue-queries.ts:79`, for folding the two client-side revenue query shapes into a pre-grouped RPC. New spec ids in this phase therefore resume at 1615.

| Spec | Delivered in |
|------|--------------|
| FILM-1601 | PR #232 (folded into the Phase 15 PR) |
| FILM-1602 | PR #233, including its code-review remediation |
| FILM-1613 | PR #234 |
| FILM-1612 | PR #235 |
| FILM-1603 | PR #236 |
| FILM-1604 | PR #237 |
| FILM-1607 | PR #242 |
| FILM-1618 | PR #249 |
| FILM-1605 | PR #252 |
| FILM-1606 | PR #255 |
| FILM-1609 | PR #256 |
| FILM-1608 | PR #257 |
| FILM-1611 | PR #260 |
| FILM-1617 | PR #262 |

Specified and not yet built:

| Spec | Status | Effort | Covers |
|------|--------|--------|--------|
| FILM-1610 | DRAFT | M | Watched metrics, review windows, and per-video notes on `publishes` |
| FILM-1615 | DRAFT | M | The Video Log table — FILM-1603 built the query and action, not the screen |
| FILM-1616 | DRAFT | M | `WeeklyDiagnosticsTable` and `RetentionCurveChart`, both of which need actions built |

## Testing precedent set by this phase

Two things changed about how work in this phase is verified, both worth
applying to the remaining specs rather than rediscovering:

**UI changes ship with screenshots in the PR.** FILM-1609 ran seven review
rounds on one form, every one text-only, while the form could not be
submitted at all. A screenshot of it after a save would have ended that at
round one. The rule and the mechanism are in the root `CLAUDE.md`.

**Browser coverage for anything with form state.** Unit tests could not see
any of the defects in that form — they lived between the DOM and form
state, and only appeared on the *second* submission, after a reset.
`apps/e2e/tests/revenue/` is the pattern: seed the account through the API
rather than the UI (three brittle flows and ~20× slower otherwise), assert
the second submission, and prove each guard fails before believing it.

FILM-1608 was the first to follow both: `apps/e2e/tests/analytics-settings/`
seeds through the API, asserts the state after a *second* save, and each
guard was watched failing before it was believed. Relevant to what is left:
all three remaining specs fall under both rules. FILM-1610 adds form fields
to the experiment log — the FILM-1609 shape exactly, and Postgres-backed, so
its spec runs in CI in full. FILM-1615 and FILM-1616 add screens that have
no rows to show while ClickHouse is off, so each splits its browser coverage
the way FILM-1617 did: a guard spec in CI, and an evidence spec gated on
`CLICKHOUSE_EVIDENCE` for the screenshots.

## Locked decisions

- **A project spans multiple channels** — different platforms, and separate per-language channels where multi-language audio is unavailable. Channel is a *dimension inside a project*, and YPP must be **per-channel**: pooling channels against one 4,000-hour target reports a threshold as met when neither channel has met it.
- **Video Log is project-level with a channel filter**, delivered as both an in-app table and CSV export columns.
- **Unknown YPP applicant status over-states rather than under-states the bar.** Where an escalated threshold is configured, an `unknown` status resolves to the higher one. FILM-1608 declines to hardcode the escalation *date* that an earlier draft attached to this decision: it could not be verified against YouTube policy, and a wrong date silently halves every channel's progress on the day it fires. The threshold is configuration; the over-state rule is unchanged. As
  built, "an escalated threshold is configured" means the account and the
  channel both carry a value and they differ — the only shape the schema can
  express — so an `unknown` status resolves to the higher of the two and is
  otherwise inert. That makes a *downward* channel override inert while the
  status stays `unknown`, which is the one place the spec's own acceptance
  criteria collide; `resolveYppTarget`'s tests pin both directions.
- **Day boundary `< N`** everywhere (days 0–29 = "@30d"), so the codebase carries one convention rather than two.
- **`CHANNEL_PAGE` stays its own traffic bucket**, not folded into Browse+Suggested — matches Studio, and folding it would silently move the 60% milestone.
- **Segment RPM is pooled** (Σrevenue / Σviews), not a mean of per-video RPMs, which tiny-view videos dominate.

## Verified corrections to earlier assumptions

- `platform_connections.subscriber_count` **is not a column** — it lives in `metadata` jsonb, written once at OAuth/channel-select and never refreshed.
- `channel_daily` is the **residual** of videos that failed to match a publish. A channel total is `Σ video_metrics for its publishes + channel_daily`; the two compose exactly once `connection_id` is on `video_dim` (FILM-1602) and publish resolution is complete (FILM-1612). They can be UNIONed, never joined per-video.
- Supabase enforces `max_rows = 1000` on **every** read including the service-role client, silently (FILM-1612).
- `channel_daily.subscribers_gained` and `subscribers_lost` **have never been written**, despite migration `006`'s docstring saying that channel-wide subscriber movement from unmatched videos "is no longer discarded". `accumulateChannelDaily` (`report-ingest.ts:417`) cannot carry them — its `add` parameter is typed to four other fields — and the unmatched branch passes only those. It is silent because the TypeScript fields are optional, `JSONEachRow` omits absent keys, and both columns are `DEFAULT 0`. The `channel_daily` leg of `querySubscriberDeltas` therefore contributes nothing, so FILM-1607's reconstructed series understates net movement cumulatively (FILM-1618).
- **Traffic-source rows for unmatched videos are dropped entirely**, not accumulated into `channel_daily` the way the reach and basic branches are — `channel_daily` has no `source` column to hold them. Traffic shares are therefore computed over matched videos only and are not comparable to channel view totals (FILM-1605 §5).
- `video_metrics.revenue_cents` is **written as literal `0` by every ingest path**. Real revenue exists only in Postgres `revenue_records`, so any per-segment or per-video RPM must be composed across the two stores, and channel-level revenue rows (`publish_id is null`) belong to no segment at all (FILM-1606 §3).

## Everything is now specified

Every remaining item has a spec file. FILM-1610, 1615 and 1616 are DRAFT;
nothing is left planned-but-unwritten.

**FILM-1611 was split.** The backlog entry called "analytics UI" had
accumulated four unrelated deliverables, and anyone sizing it from its name
alone would have undercounted it. It is now four specs:

| was | is | why separate |
|---|---|---|
| wire the orphaned components | **FILM-1611** | pure wiring; every action already exists |
| `VideoLogTable` + its tab | **FILM-1615** | a component that does not exist at all — FILM-1603 built the query and action and deferred the screen |
| `WeeklyDiagnosticsTable`, `RetentionCurveChart` | **FILM-1616** | needs two new actions, one of which needs an ownership check because ClickHouse is outside RLS |
| subscriber card + Publish Hub badge | **FILM-1617** | deferred by FILM-1607 §7; touches the publishing package |

**Five components are orphaned, not three.** An earlier version of this
section said three. `deep-dive-tab.tsx` mounts only `MedianViewsCard`,
`TrafficShareCard`, `BackCatalogCard` and `CohortCurvesChart`, so
`RetentionCurveChart`, `WeeklyDiagnosticsTable` and `YppProgressCard` are
orphaned as stated — but so are `TagMediansCard`
(`components/taxonomy/tag-medians-card.tsx`, the tags page mounts only
`TagManager`) and `RevenueMixCard` (`components/revenue-mix-card.tsx`).
`RevenueMixCard` matters most of the five: it is the only place revenue
category labels and colours are defined, so no revenue category has any
display path today.

**FILM-1607 shipped in PR #242.** An earlier version of this section said
it was "now specified and awaiting implementation", contradicting the
delivery table above. It is done; the sequencing argument that followed
(take it before the FILM-1503 cutover) is preserved in FILM-1607 §1, which
is the authoritative account.


## Known limits — do not promise these

- **New vs returning viewers.** Studio-only on both APIs. The subscribed-vs-not proxy is the ceiling; keep it labelled a proxy.
- **Historical absolute subscriber counts.** The Data API gives only current, the Reporting API only gained/lost. Any series starts the day snapshots ship.
- **Views @30d for videos whose first 30 days predate ingest.** Reporting jobs backfill only ~30 days from job creation, so for anything published before jobs existed for that channel the early-life rows cannot be obtained. This affects every historical video and is the most important caveat in the workbook.
- **Exact YPP watch hours as YouTube computes them** — their figure adjusts for deleted/private/ineligible content no API exposes. Ours is a close approximation. The Shorts alternate path (10M views/90d) is not implemented.
- **A literal "Browse" traffic source** — no such code exists; it is approximated, so the percentage will not match Studio exactly.
- **Licensing/IP revenue** and **per-video revenue on TikTok/Instagram** — no API anywhere; manual entry permanently.
- **Project pages look projects up by slug alone.** Slugs are unique per account, not globally. FILM-1611 scoped the analytics page to the URL's account (a user in two teams sharing a slug got a 404 there); `page.tsx`, research, settings, facts, facts/add, platforms, episodes, canon, hooks, assets and audio-library under `[projectSlug]` still do not. `[projectSlug]/layout.tsx` is the correct pattern.

## Blocked on infrastructure

ClickHouse is still unprovisioned in production (`CLICKHOUSE_ENABLED=false`). Every gate lives inside `@kit/clickhouse`: reads return empty and writes no-op, so nothing errors — the UI simply shows zeros. None of this phase produces data until an instance exists and the FILM-1503 cutover runs.
