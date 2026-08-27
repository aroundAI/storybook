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

All 11 specs are **code-complete** and pass `typecheck`, `lint`, and their unit
tests. Their acceptance-criteria checkboxes remain unchecked because they are
runtime assertions that need a live database, and the implementation
environment had neither Docker (for local Supabase/ClickHouse) nor permission
to touch the linked production project.

Before checking them off, run:

```bash
pnpm --filter @kit/clickhouse migrate      # applies 002–005 against ClickHouse
pnpm --filter web supabase migration up    # applies the Phase 15 migrations
pnpm supabase:web:typegen                  # regenerates database.types.ts
```

> [!IMPORTANT]
> `packages/supabase/src/database.types.ts` and `apps/web/lib/database.types.ts`
> were hand-edited in typegen's exact format for the Phase 15 tables, against
> the repo convention of never editing generated files, because typegen could
> not be run. The typegen command above regenerates both and supersedes those
> edits — run it before trusting the types.

Then follow the FILM-1503 cutover runbook (disable sync cron → migrate → drain
backfill → re-enable) and spot-check dashboard totals against YouTube Studio.
