# Phase 16: Workbook Parity

Closes the gap between Phase 15's analytics discipline and the *YouTube Channel Metrics Tracker* workbook. A gap-check found roughly two-thirds of the workbook covered, with the misses clustered on the columns the workbook itself calls "the numbers that actually matter", plus eight correctness defects — one introduced by Phase 15.

## Specs & Dependency Order

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
     │                 └─→ FILM-1607 (absolute subscriber snapshots) — not yet built
     │
     └─→ FILM-1613 (revenue alert account scoping)
```

| Spec | Delivered in |
|------|--------------|
| FILM-1601 | PR #232 (folded into the Phase 15 PR) |
| FILM-1602 | PR #233, including its code-review remediation |
| FILM-1613 | PR #234 |
| FILM-1612 | PR #235 |
| FILM-1603 | PR #236 |
| FILM-1604 | PR #237 |

## Locked decisions

- **A project spans multiple channels** — different platforms, and separate per-language channels where multi-language audio is unavailable. Channel is a *dimension inside a project*, and YPP must be **per-channel**: pooling channels against one 4,000-hour target reports a threshold as met when neither channel has met it.
- **Video Log is project-level with a channel filter**, delivered as both an in-app table and CSV export columns.
- **Unknown YPP applicant status defaults to new applicant (8,000h)** — better to over-state the bar than under-state it.
- **Day boundary `< N`** everywhere (days 0–29 = "@30d"), so the codebase carries one convention rather than two.
- **`CHANNEL_PAGE` stays its own traffic bucket**, not folded into Browse+Suggested — matches Studio, and folding it would silently move the 60% milestone.
- **Segment RPM is pooled** (Σrevenue / Σviews), not a mean of per-video RPMs, which tiny-view videos dominate.

## Verified corrections to earlier assumptions

- `platform_connections.subscriber_count` **is not a column** — it lives in `metadata` jsonb, written once at OAuth/channel-select and never refreshed.
- `channel_daily` is the **residual** of videos that failed to match a publish. A channel total is `Σ video_metrics for its publishes + channel_daily`; the two compose exactly once `connection_id` is on `video_dim` (FILM-1602) and publish resolution is complete (FILM-1612). They can be UNIONed, never joined per-video.
- Supabase enforces `max_rows = 1000` on **every** read including the service-role client, silently (FILM-1612).

## Not yet specified

The remaining workbook-parity scope is planned but **deliberately unspecified** — no spec file exists for it yet, and it should get one before implementation. The backlog order below is the spec-id order:

FILM-1605 traffic source breakdown · FILM-1606 segment performance ·
FILM-1608 YPP targets and settings UI · FILM-1609 revenue mix completion ·
FILM-1610 experiment log and per-video notes · FILM-1611 analytics UI.

**FILM-1607 (absolute subscriber snapshots) is no longer in this list** —
it has a spec and is awaiting implementation, so it belongs with the
specified work below rather than struck through under a heading that says
no spec file exists.

This list previously ended with "wiring up the four orphaned components".
Three are still orphaned today: `RetentionCurveChart`,
`WeeklyDiagnosticsTable` and `YppProgressCard` are exported from
`deep-dive/index.ts` and rendered nowhere — `deep-dive-tab.tsx` mounts only
`MedianViewsCard`, `TrafficShareCard`, `BackCatalogCard` and
`CohortCurvesChart`. FILM-1611 has since accumulated four deliverables, so
it is named "analytics UI" rather than after any one of them:

1. wiring those three orphaned components,
2. the `VideoLogTable` component and its tab, which do not exist at all yet
   — FILM-1603 built the query and the action and deferred the UI,
3. the subscriber-series card, deferred here by FILM-1607 §7,
4. re-pointing the Publish Hub follower badge at
   `getSubscriberSeriesAction`, also deferred by FILM-1607 §7.

Anyone sizing FILM-1611 from its name alone will undercount it, which is
why they are listed.

Three items have left this list: per-video views-at-age and the Video Log
(FILM-1603) and cohort medians and growth (FILM-1604), both shipped; and
absolute subscriber snapshots (FILM-1607), now specified and awaiting
implementation.

**Take FILM-1607 before the FILM-1503 cutover.** No API returns a
historical absolute count, but that does not make earlier days
unrecoverable: one anchor plus the exact net series levels the past as
readily as the future, so the first snapshot retroactively levels every day
for which a delta exists. What bounds recovery is delta collection —
nothing is written while `CLICKHOUSE_ENABLED=false`, and the FILM-1503
backfill carries no subscriber columns — so days before the cutover are
permanently absent and days after it are reconstructible.

Shipping first is therefore still the right sequencing, because it makes
the reconstructible window empty rather than merely recoverable; but
shipping late is a degradation, not a permanent loss. See FILM-1607 §1,
which an earlier version of this paragraph contradicted.

## Known limits — do not promise these

- **New vs returning viewers.** Studio-only on both APIs. The subscribed-vs-not proxy is the ceiling; keep it labelled a proxy.
- **Historical absolute subscriber counts.** The Data API gives only current, the Reporting API only gained/lost. Any series starts the day snapshots ship.
- **Views @30d for videos whose first 30 days predate ingest.** Reporting jobs backfill only ~30 days from job creation, so for anything published before jobs existed for that channel the early-life rows cannot be obtained. This affects every historical video and is the most important caveat in the workbook.
- **Exact YPP watch hours as YouTube computes them** — their figure adjusts for deleted/private/ineligible content no API exposes. Ours is a close approximation. The Shorts alternate path (10M views/90d) is not implemented.
- **A literal "Browse" traffic source** — no such code exists; it is approximated, so the percentage will not match Studio exactly.
- **Licensing/IP revenue** and **per-video revenue on TikTok/Instagram** — no API anywhere; manual entry permanently.

## Blocked on infrastructure

ClickHouse is still unprovisioned in production (`CLICKHOUSE_ENABLED=false`). Every gate lives inside `@kit/clickhouse`: reads return empty and writes no-op, so nothing errors — the UI simply shows zeros. None of this phase produces data until an instance exists and the FILM-1503 cutover runs.
