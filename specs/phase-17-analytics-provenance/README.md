# Phase 17: Analytics Data Provenance

Phase 15 made the analytics numbers disciplined and Phase 16 made them match
the workbook. Neither asked whether a reader can tell **where a number came
from**. This phase does, and the investigation that produced it found that the
answer is currently no — in ways that range from a missing label to three cards
displaying literals typed into a source file.

Scheduled to start **after Phase 16 closes**. FILM-1706 makes a prop required
on a card shell used by ~14 files, and FILM-1611, 1615 and 1617 all add cards;
running the two phases concurrently would guarantee conflicts.

## The problem, in one table

Established by reading every ingest writer and confirming against a live
ClickHouse instance:

| Data | YouTube | TikTok | Instagram |
|---|---|---|---|
| `video_traffic_sources` | native | **not ingested** | **unsupported** |
| `channel_daily`, `video_reach_daily`, retention curves | native | — | — |
| `video_metrics` | native, true daily | derived — snapshot delta | derived — snapshot delta |
| Revenue from sync | native | — | — |
| `video_audience` | 7 dimensions | 3, percentage-only | 3, account-level |

The page presents all of this as one kind of thing.

## Specs & dependency order

```
FILM-1703 (capability model)
     ├─→ FILM-1704 (observed coverage) ──┐
     └─→ FILM-1706 (card shell v2) ──────┤
                   │                     ├─→ FILM-1705 (provenance surfaces)
FILM-1701 (audience truth-up) ───────────┘              │
                   │                                    │
                   │       FILM-1702 (language) ────────┤
                   │          needs 16's FILM-1606      │
                   │                                    ├─→ FILM-1707 (six-tab adoption)
                   │                                    │            │
                   └─→ FILM-1708 (drill-down + ramp)    │            │
                          needs 16's FILM-1605 ✅        │            │
                                                        │            │
                                    FILM-1709 (filter completion) ←──┘
                                         also needs FILM-1704
```

**`FILM-1701` and `FILM-1703` are the two independent starting points** and can
run in parallel. Everything else descends from one of them: `FILM-1703` gates
`FILM-1704` and `FILM-1706` (both need `MetricFamily`), and those three
converge on `FILM-1705`.

`FILM-1708` needs only the shell and Phase 16's FILM-1605, so it can run
alongside `FILM-1707` rather than after it.

| Spec | Status | Effort | Covers |
|------|--------|--------|--------|
| [FILM-1701](./FILM-1701-audience-truth-up.md) | DRAFT | M | Delete two fabricated cards, plumb the third from data we already ingest, fix the seed fixture's platform bug |
| [FILM-1702](./FILM-1702-language-dimension-reconciliation.md) | DRAFT | L | Two disagreeing language columns, and the `'en'` default that doubles as the unknown bucket |
| [FILM-1703](./FILM-1703-provenance-capability-model.md) | DRAFT | M | The capability matrix and the tests that stop it drifting from the writers |
| [FILM-1704](./FILM-1704-observed-coverage.md) | DRAFT | M | One query answering what data exists for this project in this window |
| [FILM-1705](./FILM-1705-provenance-surfaces.md) | DRAFT | L | Card chip, coverage strip, filter dimming |
| [FILM-1706](./FILM-1706-analytics-card-shell.md) | DRAFT | M | Semantic tokens, progressive disclosure, required `metricFamily` |
| [FILM-1707](./FILM-1707-six-tab-adoption.md) | DRAFT | L | All six tabs on one shell, and the Deep Dive scope decision |
| [FILM-1708](./FILM-1708-traffic-drill-down-colour-ramp.md) | DRAFT | M | Group → native source drill-down; eight distinguishable colours |
| [FILM-1709](./FILM-1709-platform-filter-completion.md) | DRAFT | L | The filter reaching the four tabs it currently ignores |

## Already shipped as a prerequisite

**Declarative schema drift** (PR #253, not a spec). Four live columns —
`platform_connections.language`, `platform_connections.metadata`,
`publishes.language`, `publishes.dubbed_version_id` — were missing from the
declarative schemas that `supabase db diff` treats as the desired state, so a
diff would have generated `DROP`s for them. Fixed and verified against
`information_schema`.

Two things that repair surfaced and did not fix:

- `public.platform_connections` is **declared twice**, in `30-film-studio.sql`
  and `32-platform-connections.sql`, both with `if not exists`. The earlier file
  wins; the later is a silent no-op. That is how `metadata` came to be missing
  from the copy that actually runs. Collapsing them moves the table's creation
  order relative to `public.publishes`, which references it.
- **`supabase db diff` cannot run in this repo at all** — the shadow database
  fails on the first migration with `relation "storage.objects" does not exist`.
  The drift was therefore latent rather than live. Worth fixing on its own.

## Locked decisions

**Four support levels, and never a fifth.** `native`, `derived`,
`not_ingested`, `unsupported`. The distinction between *the platform can't* and
*we haven't* is the point of the model — a single "limited" label tells a
creator to stop asking for something we could build. There is deliberately no
*fabricated* level: FILM-1701 removes the only data that would need one, and
keeping the model unable to express fabrication is what stops it recurring.

**The matrix stays in code.** Moving it to the database or making it
account-overridable kills the writer-binding test that is its entire guarantee.
Same argument `lib/traffic-groups.ts` makes for itself in its own header.

**Dim, never remove.** A platform that cannot be covered is shown dimmed with a
reason and stays selectable. A user who cannot find TikTok in the filter
concludes the product does not support TikTok, and there is no affordance left
to correct them.

**Colour encodes support level, not platform brand.** Brand colours inside a
data card compete with the chart for meaning.

**Capability is not coverage.** Capability is static and needs no query;
coverage is per project, per window. They render on different paths so
capability can paint immediately.

## Verified corrections to earlier assumptions

Recorded because each was believed at some point during this phase's planning:

- **Channels *are* tagged with language.** `platform_connections.language`
  exists (migration `20251223150000`). An earlier note claiming otherwise had
  grepped the declarative schema, which was missing the column — which is how
  the drift in PR #253 was found.
- **Device Type is not missing data, it is unread data.** `buildAudienceRows`
  (`server/ingest.ts:214-229`) writes `device`, `os`, `city` and
  `follower_status` rows; `getProjectAudienceData`
  (`server/aggregation-queries.ts:700-704`) reads three dimensions. Only
  Interests and Peak Activity are genuinely fabricated.
- **`publishes.source_shot_id` is not drift.** It was dropped deliberately by
  migration `20260124120000` in favour of `metadata.shortsGroupId`. The
  `source_shot_id` entries in `database.types.ts` belong to
  `compilation_segments`, `edit_clips` and `shorts`.
- **`database.types.ts` is not stale.** A regeneration differs by 443 lines,
  but every difference is a CLI-version artifact — the local CLI would *remove*
  the `__InternalSupabase` block and rewrite `unknown` as `unknown | null`.

## Known limits — do not promise these

- **Traffic-source attribution is YouTube-only and stays that way in this
  phase.** TikTok's provider returns percentage-only sources with incompatible
  labels; Instagram has no such concept. FILM-1703 records both; neither is
  built here.
- **TikTok and Instagram daily metrics are snapshot deltas attributed to the
  fetch day.** No amount of labelling makes them comparable to YouTube's true
  daily rows. FILM-1707 decides how the Deep Dive aggregates handle that; the
  underlying imprecision is not fixable without a data-day estimate the
  providers do not give us.
- **Instagram audience rows are account-level**, replicated per video. They are
  not that video's audience.
- **Historical language data is unrecoverable.** Both language columns default
  to `'en'`, so publishes whose language was never set are indistinguishable
  from deliberate English ones. FILM-1702 can separate them going forward and
  must record an interpretation for existing rows; it cannot recover them.
- **The YouTube Analytics and Reporting APIs use different traffic-source
  vocabularies** — `BROWSE_FEATURES`/`EXT_URL` versus `RELATED_VIDEO`/
  `EXTERNAL_URL`. Only the reporting path writes today, so they have never
  collided. Nothing reconciles them, and `BROWSE_FEATURES` would bucket as
  `other` if it ever arrived.

## Open product questions

**Facebook.** `platform_connections` and `publishes` allow six platforms;
`AnalyticsPlatform` and the ClickHouse enum allow three; the export schema
(`lib/schemas/report.schema.ts:26`) offers Facebook. A user can connect a
Facebook channel and select it for export, and the write would be rejected.
FILM-1705 shows it in the strip as unsupported rather than hiding it. Whether
Facebook should also come out of the export schema — or be properly supported —
is not settled here.

**The Deep Dive scope.** FILM-1707 §2 offers three options for the mixed
time-semantics pooling and recommends excluding snapshot-delta rows from
time-bucketed aggregates. That decision changes numbers already on screen and
wants sign-off before implementation, not after.
