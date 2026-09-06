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
```

Specified, not yet built:

```
FILM-1605 (traffic source breakdown)
     ├─→ FILM-1606 (segment performance) ──┐
     └─→ FILM-1610 (experiment log + per-video notes)
                                           │
FILM-1608 (YPP targets + settings UI) ─────┤
                                           ├─→ FILM-1611 (channel selector + orphan wiring)
FILM-1609 (revenue mix completion) ────────┘                │
                                                            ├─→ FILM-1615 (Video Log table)
                                                            └─→ FILM-1617 (subscriber surfaces)
                                                                        ▲
FILM-1618 (channel-residual subscribers, bug) ──────────────────────────┘

FILM-1616 (weekly diagnostics + retention drill-down) — independent, needs only FILM-1602
```

FILM-1605, 1608, 1609, 1616 and 1618 are mutually independent and parallelisable. FILM-1611 gates the remaining UI work; FILM-1617 additionally needs FILM-1618, because surfacing a curve built from systematically short deltas publishes a number that drifts from its own anchors.

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

Specified and not yet built:

| Spec | Status | Effort | Covers |
|------|--------|--------|--------|
| FILM-1605 | DRAFT | M | Traffic source breakdown — the six surfaces beyond Browse+Suggested |
| FILM-1606 | DRAFT | L | Segment performance by tag, language, content type and channel, at a checkpoint age |
| FILM-1608 | DRAFT | M | Per-channel YPP targets, and the first writer `analytics_settings` has ever had |
| FILM-1609 | DRAFT | S | The `licensing` revenue category (the rest of this scope already shipped) |
| FILM-1610 | DRAFT | M | Watched metrics, review windows, and per-video notes on `publishes` |
| FILM-1611 | DRAFT | M | Channel selector, plus mounting `YppProgressCard`, `TagMediansCard`, `RevenueMixCard` |
| FILM-1615 | DRAFT | M | The Video Log table — FILM-1603 built the query and action, not the screen |
| FILM-1616 | DRAFT | M | `WeeklyDiagnosticsTable` and `RetentionCurveChart`, both of which need actions built |
| FILM-1617 | DRAFT | S | Subscriber series card, YPP absolute count, Publish Hub badge |
| FILM-1618 | DRAFT | S | **Bug** — `channel_daily` subscriber columns are never written |

## Locked decisions

- **A project spans multiple channels** — different platforms, and separate per-language channels where multi-language audio is unavailable. Channel is a *dimension inside a project*, and YPP must be **per-channel**: pooling channels against one 4,000-hour target reports a threshold as met when neither channel has met it.
- **Video Log is project-level with a channel filter**, delivered as both an in-app table and CSV export columns.
- **Unknown YPP applicant status over-states rather than under-states the bar.** Where an escalated threshold is configured, an `unknown` status resolves to the higher one. FILM-1608 declines to hardcode the escalation *date* that an earlier draft attached to this decision: it could not be verified against YouTube policy, and a wrong date silently halves every channel's progress on the day it fires. The threshold is configuration; the over-state rule is unchanged.
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

Every remaining item has a spec file. FILM-1605, 1606, 1608, 1609, 1610,
1611, 1615, 1616, 1617 and 1618 are all DRAFT; nothing is left planned-but-
unwritten.

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

## Blocked on infrastructure

ClickHouse is still unprovisioned in production (`CLICKHOUSE_ENABLED=false`). Every gate lives inside `@kit/clickhouse`: reads return empty and writes no-op, so nothing errors — the UI simply shows zeros. None of this phase produces data until an instance exists and the FILM-1503 cutover runs.
