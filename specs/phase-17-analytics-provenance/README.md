# Phase 17: Analytics Provenance and Signal

Phase 15 made the analytics numbers disciplined and Phase 16 made them match
the workbook. Neither asked whether a reader can tell **where a number came
from**. This phase does, and the investigation that produced it found that the
answer is currently no — in ways that range from a missing label to three cards
displaying literals typed into a source file.

The phase has three parts. **Provenance** (FILM-1701–1709) answers *where did
this number come from*. **Signal** (FILM-1710–1720) answers *what is it telling
me* — a different answer on every platform. **Reference** (FILM-1721–1723) is
the researched vendor truth the other two are built on, and it is the root of
the dependency graph rather than an appendix.

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
| Revenue from sync | **`scope_missing`** — plumbed, never authorised | — | — |
| `video_audience` | 7 dimensions | 3, percentage-only | 3, account-level |

The page presents all of this as one kind of thing.

## Specs & dependency order

The reference trio is the root. Nothing that cites a vendor fact should start
before FILM-1721 exists.

```
FILM-1721 (capability reference)  ── the researched vendor truth
   ├─→ FILM-1722 (view definitions) ─→ FILM-1713 (measures, velocity)
   ├─→ FILM-1703 (capability matrix)
   │        ├─→ FILM-1704 (observed coverage) ─┐
   │        └─→ FILM-1706 (card shell v2) ─────┤
   │                                           ├─→ FILM-1705 (surfaces)
   ├─→ FILM-1711 (authorisation) ─→ FILM-1712 (metric recovery)
   └─→ FILM-1715, FILM-1720, FILM-1727

FILM-1723 (API versions)  ── independent; check Graph v18 first
FILM-1701 (audience truth-up) ─→ FILM-1705
FILM-1710 (asset duration) ─→ FILM-1716 (format families) ─→ FILM-1714, FILM-1715

FILM-1714 (signal model)  ← FILM-1703, FILM-1713, FILM-1716
FILM-1715 (self-benchmark) ← FILM-1703, FILM-1713, FILM-1716, FILM-1721
   └─→ FILM-1718 (diagnosis)   ← does NOT wait on the genome
FILM-1717 (genome) ← FILM-1606, FILM-1610, FILM-1715, FILM-1716
   └─→ FILM-1719 (signal surfaces) ← also FILM-1706, FILM-1718
FILM-1702 (language) ← phase-16 FILM-1606 ─→ FILM-1707
FILM-1708 (drill-down + ramp) ← FILM-1605 ✅, FILM-1706
FILM-1709 (filter completion) ← FILM-1704, FILM-1707
FILM-1720 (Facebook) ← FILM-1711, FILM-1714, FILM-1721, FILM-1723
FILM-1727 (X) ← the same; FILM-1725 Check A for the Enterprise tier only
FILM-1703 + FILM-1711 ─→ FILM-1730 (TikTok Business API) ← also a Business developer app we do not hold
FILM-1723 (API versions) ─→ FILM-1728 (Graph v26.0) ; ─→ FILM-1729 (X media.write) — the live upload needs X credentials
```

**FILM-1721 has shipped.** The reference is at
[docs/platform-capability-reference.md](../../docs/platform-capability-reference.md),
and its rule is automated rather than a review convention — a request naming a
field the document does not carry fails the build. Two things it settled while
being written, both of which change work downstream:

- **Graph v18.0 expired 2026-01-26 and v19.0 expired 2026-05-21.** Meta defaults
  an expired version to the next oldest usable one instead of rejecting it, so
  `token-refresh.ts` (v18.0) and the lambda handlers (v19.0) are running on a
  version nobody chose. FILM-1723 was written against an *inferred* EOL; it is
  now documented, and the failure mode is worse than the spec assumed.
- **TikTok's traffic sources were never ingested because they were never
  returned.** The provider parsed a `traffic_source_types` field the Display API
  does not have. This changes FILM-1703 §2's evidence, not its conclusion — see
  the note there.

Two of FILM-1721's three empirical checks could not run: one needs a paid X
token, the other a TikTok sandbox app. They are **deferred, not dropped** —
[FILM-1725](./FILM-1725-deferred-vendor-verifications.yaml) holds the question,
the command, what each blocks, and the event that brings it back. The X one
gates FILM-1727's Enterprise tier and is the reason that spec should not be
scoped against `/2/media/analytics` until it is answered. X itself is not
blocked: it ships on the pay-per-use path.

**FILM-1723 and FILM-1710 are the remaining true roots.** FILM-1723 and phase 18's [FILM-1801](../phase-18-local-vendor-sandbox/FILM-1801-vendor-base-url-resolver.yaml) edit the same host constants — one pins a version per vendor, the other makes each host overridable for the local sandbox. Do them together, or FILM-1723 first. FILM-1701 is
independent of the reference but feeds FILM-1705. Everything else descends from
one of them — in particular FILM-1703 now depends on FILM-1721, so it is no
longer a starting point.

**FILM-1710's urgency was overstated and is corrected in the spec.** It was
described here as a production correctness incident that ships before all of
this, on the grounds that every Short auto-wins in the Hook Lab. The Hook Lab
reads `hook_variants.duration_seconds`, not `video_dim.duration_seconds`, and
the latter has no readers anywhere — so it is a latent write-only defect. It
still ships early, but for a different reason: phase-16 FILM-1616 is the first
thing that would read the column, through `getRetentionCurveAction`.

| Spec | Status | Effort | Covers |
|------|--------|--------|--------|
| [FILM-1701](./FILM-1701-audience-truth-up.yaml) | ✅ DONE | M | Delete two fabricated cards, plumb the third from data we already ingest, fix the seed fixture's platform bug |
| [FILM-1702](./FILM-1702-language-dimension-reconciliation.yaml) | ✅ DONE | L | Two disagreeing language columns, and the `'en'` default that doubles as the unknown bucket |
| [FILM-1703](./FILM-1703-provenance-capability-model.yaml) | ✅ DONE | M | The capability matrix and the tests that stop it drifting from the writers |
| [FILM-1704](./FILM-1704-observed-coverage.yaml) | DRAFT | M | One query answering what data exists for this project in this window |
| [FILM-1705](./FILM-1705-provenance-surfaces.yaml) | DRAFT | L | Card chip, coverage strip, filter dimming |
| [FILM-1706](./FILM-1706-analytics-card-shell.yaml) | ✅ DONE | M | Semantic tokens, progressive disclosure, required `metricFamily` |
| [FILM-1707](./FILM-1707-six-tab-adoption.yaml) | DRAFT | L | All six tabs on one shell, and the Deep Dive scope decision |
| [FILM-1708](./FILM-1708-traffic-drill-down-colour-ramp.yaml) | DRAFT | M | Group → native source drill-down; eight distinguishable colours |
| [FILM-1709](./FILM-1709-platform-filter-completion.yaml) | DRAFT | L | The filter reaching the four tabs it currently ignores |

### The signal half

```
FILM-1710 (asset duration) ── latent defect; ships before FILM-1616 reads it
     │                         (TikTok leg only waits on FILM-1711)
     └─→ FILM-1716 (format families)

FILM-1711 (authorisation) ─→ FILM-1712 (metric recovery)

FILM-1713 (measures, velocity) ─┬─→ FILM-1714 (signal model)   ← also FILM-1703
FILM-1716 (format families) ────┤
                                └─→ FILM-1715 (self-benchmark) ← also FILM-1703, FILM-1721

FILM-1714 + FILM-1715 ─→ FILM-1718 (diagnosis) ← not the genome

FILM-1715 + FILM-1716 ─→ FILM-1717 (genome v1 → v2) ← also FILM-1606 ✅, FILM-1610

FILM-1715 + FILM-1716 ─→ FILM-1724 (channel experiments) ← also FILM-1610 ✅;
   hook tests also need FILM-1710. Replaces Hook Lab (FILM-1510; reviewed
   and removed, FILM-CC-04 KB-9/KB-10)

FILM-1717 + FILM-1718 ─→ FILM-1719 (surfaces) ← also FILM-1706

FILM-1711 + FILM-1714 + FILM-1721 + FILM-1723 ─→ FILM-1720 (Facebook) ─→ FILM-1727 (X)
   ── last, and two tests of whether 1714 was expandable
```

| Spec | Status | Effort | Covers |
|------|--------|--------|--------|
| [FILM-1710](./FILM-1710-asset-duration.yaml) | 🟡 PARTIAL | M | The published clip's real duration. A **latent** defect — `video_dim.duration_seconds` is the episode's, and today nothing reads it |
| [FILM-1711](./FILM-1711-analytics-authorisation.yaml) | 🟡 PARTIAL | L | TikTok and Instagram analytics were never authorised; scope audit across all five platforms |
| [FILM-1712](./FILM-1712-metric-recovery.yaml) | DRAFT | L | Request the fields we already have access to; give Instagram `reach` a column |
| [FILM-1713](./FILM-1713-normalised-measures-velocity.yaml) | DRAFT | M | One definition per rate; bucketed velocity, acceleration, `growth_state` |
| [FILM-1714](./FILM-1714-signal-model.yaml) | DRAFT | M | Five funnel stages, primary/supporting signals, unbound stages, the expandability test |
| [FILM-1715](./FILM-1715-self-benchmarking.yaml) | DRAFT | M | Band, lift, cohort median and n against your own history; shrinkage |
| [FILM-1716](./FILM-1716-format-families.yaml) | DRAFT | M | `short_vertical` … `live`, mapped from `content_type` rather than read from it |
| [FILM-1717](./FILM-1717-content-genome.yaml) | DRAFT | XL | Creative mechanisms vs outcomes, discriminated against comparable losers. **v1 then v2** |
| [FILM-1718](./FILM-1718-stage-diagnosis.yaml) | DRAFT | M | Distribution-vs-content and the finite failure patterns. **Does not depend on the genome** |
| [FILM-1719](./FILM-1719-signal-surfaces.yaml) | DRAFT | L | The five-stage strip, three depths, evidence, "model after" |
| [FILM-1720](./FILM-1720-facebook-analytics.yaml) | DRAFT | L | Facebook's provider and enum value: 57 video, 11 Reels and 4 ad-break metrics, organic/paid splits, and the `dim-sync` fix. Split from X 2026-09-21 |
| [FILM-1721](./FILM-1721-platform-capability-reference.yaml) | ✅ DONE | L | **The researched truth table.** Per platform × metric × API surface × field name × scope × window, cited to vendor docs. Lives at [docs/platform-capability-reference.md](../../docs/platform-capability-reference.md); enforced by `platform-field-names.test.ts` |
| [FILM-1722](./FILM-1722-view-definition-registry.yaml) | 🟡 PARTIAL | M | What "a view" means per platform, with effective dates and the YouTube discontinuity |
| [FILM-1723](./FILM-1723-api-version-consolidation.yaml) | 🟡 PARTIAL | M | One pinned version per vendor; the Graph v18 token-refresh risk; X onto `api.x.com` |
| [FILM-1724](./FILM-1724-channel-experiments.yaml) | DRAFT | L | Which styles work: groups of new videos, one per style, compared at the same age; no verdict on thin samples |
| [FILM-1725](./FILM-1725-deferred-vendor-verifications.yaml) | ⏸️ DEFERRED | S | The FILM-1721 checks that need a paid X token, a TikTok sandbox app, or an Instagram insights permission we do not hold |
| [FILM-1727](./FILM-1727-x-analytics.yaml) | DRAFT | L | X on the pay-per-use path, Enterprise fields declared and dark; the `x`/`twitter` vocabulary; metered cost |
| [FILM-1726](./FILM-1726-monetisation-stage.yaml) | DRAFT | M | The Monetisation stage re-argued, after its premise turned out to be a fact about our writers rather than the platforms |
| [FILM-1728](./FILM-1728-meta-graph-v26-upgrade.yaml) | DRAFT | M | Move the single Meta pin to v26.0 (changelogs researched: nothing we call changes) **and make the next bump boring**: a served-version assertion in one `metaFetch()`, an expiry test that goes red 120 days early, one implementation per flow, the reference reconciled with the changelog. Found: v25.0 deprecated 41 Facebook insight metrics our reference still lists |
| [FILM-1729](./FILM-1729-x-media-write-scope.yaml) | PARTIAL | S | `/2/media/upload` needs `media.write`: requested since #488, and a connection made before is refused at publish and told to reconnect; the publish screen sends X full videos and Shorts, refusing first what X's limits would; publishing scopes audited for every platform. A real upload still needs X credentials — the same purchase unblocks FILM-1725 Check A |
| [FILM-1730](./FILM-1730-tiktok-business-api.yaml) | DRAFT | XL | TikTok's real analytics — watch time, reach, traffic sources, geography — live on the Business API: a second app, a second connection, and a creator on a Business account. Split from FILM-1712 §4. Owns the four TikTok Business matrix entries (blockedBy FILM-1730 since 2026-09-25) |

**Two independent paths, deliberately.** `metrics → diagnosis` (FILM-1718)
works without the genome, so a creator gets a usable diagnosis immediately;
`metrics + genome → creative explanation` enriches it later. Coupling them
would make the diagnosis wait seven months for enough tagged videos.

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

### Locked for the signal half

**Five funnel stages, and no composite score, ever.** Reach, Hook, Attention,
Transmission, Audience. A total would average a dark stage as zero — exactly
the failure the dark/weak distinction exists to prevent — and it collapses the
diagnosis that makes the data useful.

**No Monetisation stage — but not for the reason first written.** The original
text read: *"`video_metrics.revenue_cents` is literal `0` on all four write
paths. It would be dark or wrong on every platform forever."* The first sentence
is true; the second does not follow, and was retired on 2026-09-21.

YouTube revenue is plumbed end to end — `analytics-sync-cron.ts:733-735` maps
`estimatedRevenue`, `estimatedAdRevenue` and `estimatedRedPartnerRevenue`, and
`upsertRevenueRecords` writes them to `revenue_records` with `source = 'api'`.
It arrives as zero because `yt-analytics-monetary.readonly` is not requested.
Facebook has its own ad-break revenue surface. So the constraint is **that we
have not authorised revenue**, not that revenue does not exist.

The stage stays absent while **FILM-1726** re-argues it from the real
constraint. Absence is still a decision — it is now a decision with a pending
review rather than a closed one.

**A stage may be unbound, and often should be.** Five stages is a vocabulary,
not a quota. Four honest stages beat five with one invented.

**The stage layer contains no absolute thresholds.** Every figure is relative
to the channel's own cohort. This is what keeps it from colliding with
FILM-1616, where the 0.03 CTR flag is deliberately a breakage check and not a
content verdict. Reach *benchmarks* CTR; it never *flags* it — and the
converse binds, so the diagnostics table gets no bands.

**Stage scores are never compared across platforms.** An Instagram share and a
YouTube share are different acts. Platform view definitions differ enough that
cross-platform percentages are not comparable; the only defensible benchmark is
your own history.

**Diagnosis describes, it does not explain.** `measurement → diagnosis →
hypothesis`, never `measurement → pretend-causality`. A causal claim is
reachable only through an experiment.

**No recommendation without evidence** — enforced by the type, not by review.
A recommendation that cannot name its evidence does not construct.

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
- **TikTok and Instagram analytics were never authorised.**
  `oauth/tiktok/config.ts:11` requests only `user.info.basic` and
  `video.upload`; `oauth/meta/config.ts:10` omits `instagram_manage_insights`.
  Only YouTube holds its analytics scope. This — not the seed fixture — is why
  `video_metrics` holds YouTube rows and nothing else.
- **Providers requested fewer fields than their own types declared.** TikTok
  asked for five while declaring ten — five of which the endpoint does not have;
  FILM-1721 removed them. Instagram never requests `follows` or `profile_visits`
  (correct for Reels), never requests `ig_reels_avg_watch_time` or
  `ig_reels_video_view_total_time` (documented, and discarded), and the `reach`
  it *does* request is discarded at ingest for want of a column. YouTube's daily
  query omits `averageViewPercentage`.
- **`video_dim.duration_seconds` is the episode's, not the clip's**
  (`dim-sync.ts:166-168`). Short-form publishes in the live fixture average
  ~1,550 seconds, so any completion rate derived from it would be wrong.
  **It is write-only today** — no reader anywhere in
  `packages/clickhouse/src/queries*.ts` — so nothing is currently wrong on
  screen because of it. The Hook Lab divides by `hook_variants.duration_seconds`
  instead (`hook-retention.ts:81`, `numeric default 5`), so the claim that
  every Short auto-wins there was mistaken and is withdrawn in FILM-1710 §1.
- **`video_metrics.extra_metrics` is write-only.** It holds the full provider
  payload and nothing in the repository reads it — no `JSONExtract` anywhere.

## Corrections from the API research (2026-09-14)

The signal specs were first written citing **our own TypeScript types** as
evidence of platform capability. Research against vendor documentation
overturned several claims. FILM-1721 is the reference that exists so this
cannot recur; the rule it establishes is that **a metric name may not appear in
a spec, a type or a request unless FILM-1721 documents it with a citation.**

- **TikTok: five field names do not exist on the endpoint we call.**
  `save_count` exists nowhere for own videos; `average_watch_time`,
  `total_play_time`, `full_video_watched_rate` and `traffic_source_types` are
  real names on the **TikTok API for Business** — a different host, a separate
  app registration, and a creator-side **Business account** requirement. What
  looked like a field-list change is a second integration.
- **The TikTok scope is `video.list`.** There is no `video.query` scope.
- **`research.creator_insights` does not exist**, and the Research API is
  academic/non-profit only.
- **Instagram `profile_visits` and `follows` are FEED and STORY only — not
  REELS**, so Instagram's Audience stage has no per-media signal.
- **Instagram has no replay metric, no retention graph and no completion rate.**
  `reels_skip_rate` is the only curve-like surface — but average and total Reel
  watch time are documented and simply never requested (FILM-1712).
- **YouTube redefined `views` on 2026-08-27** across all formats (and for
  Shorts on 2025-03-31). `engagedViews` carries the previous methodology. Our
  series has a live discontinuity, which FILM-1722 exists to handle.
- **Facebook ThruPlay is an Ads metric**, absent from organic video insights;
  `total_video_15s_views` is not equivalent. And
  `post_video_avg_time_watched` **can exceed the video's duration**, which
  YouTube's average view duration cannot.
- **X analytics is capable but Enterprise-gated**, with a real degraded
  pay-per-use path. The decisive unknown is the undocumented historical window,
  not the unpublished price.
- **Meta Advanced Access needs App Review *and* Business Verification**, both,
  plus an annual Data Use Checkup.

## Known limits — do not promise these

**Four things the research asks for that no provider we ingest gives us:**
"sends" as distinct from shares, replays and loops, stayed-to-watch and
sub-second holds, and new-vs-returning viewers. *(Two qualifications:
Instagram's `reposts_count` is a media-level pass-it-on signal beside the first,
and Facebook's `fb_reels_replay_count` answers the second — on a platform we do
not ingest yet.)* New-vs-returning viewers (Studio-only — FILM-1506 already records the
subscribed-share proxy as the documented best available). Each becomes an
`unsupported` entry with a creator-facing sentence, and an unbound stage where
it was a platform's only candidate signal.

**The genome is a back-catalog feature.** At weekly publishing, a binary
creative attribute needs roughly seven months to reach an established evidence
tier; at biweekly, fifteen. The product must extract value below that tier by
labelling early signals as early, not by waiting or by overclaiming.

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
