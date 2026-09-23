# Phase 15: Deep Analytics Discipline

Implements the full YouTube analytics discipline playbook — correct daily ingestion, CTR/impressions via the YouTube Reporting API, medians over means, rolling windows, traffic-share and back-catalog analysis, cohort curves, taxonomy medians, revenue mix, an experiment log, and the Hook Lab (FILM-1301 folded in).

## Specs & Dependency Order

```
FILM-1501 (ClickHouse v2) ─→ FILM-1502 (sync correctness) ─→ FILM-1503 (backfill + cron wiring)
       │
       └─→ FILM-1504 (YouTube Reporting API — ship early; history starts at job creation −30d)
                 │
FILM-1502/1504 ─→ FILM-1505 (stranded metrics) ─→ FILM-1506 (video_dim + deep-dive queries)
                                                        │
                                     ┌──────────────────┼──────────────────┐
                               FILM-1507 (taxonomy)  FILM-1508 (revenue) FILM-1509 (experiments)*
                                     │
                               FILM-1510 (Hook Lab)
                                     │
                    FILM-1511 (dashboards + reports) ← {1504,1505,1506,1507,1508}
```

\* FILM-1509 only depends on FILM-1502.

## Cutover note

FILM-1501+1502 must merge in quick succession with the analytics sync cron disabled in between; the wipe/backfill runbook lives in FILM-1503.

## Locked decisions

- Corrupt v1 ClickHouse data is wiped; YouTube history backfilled per-day, TikTok/IG restart from clean baselines.
- Unmatched channel videos → `channel_daily` rollup (YPP watch-hours channel-accurate).
- Headline median = views-to-date by upload month (views-in-period toggleable).
- Revenue records may be channel-level (`publish_id` nullable, `account_id` alternative).
- Hook Lab uses generic `video_retention_curves`, not a dedicated retention table.

## Verification status

**Audited against the code on 2026-09-23.** Of the 51 acceptance boxes across
the ten live specs, 28 are ticked with evidence, 6 are not met, and 19 are
unverified — they need a live database, a vendor account or a deploy to
settle. (FILM-1504's completion moved five boxes to ticked the same day; its
one left is the owner's YouTube Studio cross-check.) FILM-1504, 1506, 1507, 1509 and 1511 are 🟡 PARTIAL, each with a
*Remaining* section; the rest are ✅ DONE. The evidence sits beside each box.

This section used to say every box was unchecked, and that the phase-15 types
had been hand-edited because typegen could not run. Both are superseded: the
boxes are audited, and CI now regenerates the types and fails on any
difference (root `CLAUDE.md`, *Database Workflow*, step 4).

Still operational, and not recorded here as done: the FILM-1503 cutover
runbook (disable sync cron → migrate → drain backfill → re-enable) and a
spot-check of dashboard totals against YouTube Studio.
