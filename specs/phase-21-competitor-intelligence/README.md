# Phase 21: Competitor Intelligence

A creator adds anyone's YouTube channel, Instagram professional account or
Facebook Page, and Storybook tells them which of its videos are working and
which are not, when its audience shows up, how fast its uploads take off, and
what its winners have in common. Later, watched channels are linked to a
project. The project's own channel is then measured **the same way** and
compared with them, and each gap becomes a hypothesis to test.

**Design document (2026-10-06):** [PRD-EDD.md](./PRD-EDD.md). Part 1 is the
product (journeys, requirements R-01 to R-58). Part 2 is the data reality:
what can be known about a channel without its owner's YouTube Studio, and how
the rest is estimated. Part 3 is the engineering design. Part 4 covers
milestones, rollout, risks and open questions. Where a spec and the document
disagree, the spec is the record and the document is updated.

## The problem, in one table

Measured 2026-10-06 on `main` at `ff3e56b`:

| | Today | Consequence |
|---|---|---|
| Channels analytics can read | Only OAuth-connected ones (`platform_connections`) | Nobody can look at a channel they do not own |
| YouTube client auth | OAuth token only; no Data API key anywhere | No path reads public data |
| Benchmarks | FILM-1715: own channel, same format, same age; the channel axis cannot be relaxed | The only baseline is your own history |
| Time-of-day viewing | No hour or weekday dimension; `heatmap-grid.tsx` is unused | "When is the audience watching?" has no answer even for owned channels |
| Product intent | PRD.md "Competitor Analysis (P2)"; FILM-808 "Competitor Benchmarking (when available)" | Asked for twice, never designed |

## Without their YouTube Studio: the three tiers

| Tier | What | Label |
|---|---|---|
| Public, measured | Views, likes, comments, subscribers (rounded), uploads, durations, publish times; via the YouTube Data API **key**, Instagram Business Discovery, and (gated) Facebook Page Public Content Access | `native`, access `public` |
| Public, derived by observation | Reading those counts on a schedule: views at age *t*, takeoff curves, outlier scores, the **views-arrival heatmap** (hourly deltas), the **comment-activity heatmap**, **moments mentioned** (timestamps viewers write in comments) | `derived`, with a named method |
| AI reading | Gemini watching the public video by URL: hook, pacing, structure, title and thumbnail pattern | "AI reading", with model and prompt version |

**Never available, and never faked:** a competitor's retention curve, "Most
Replayed", watch time, CTR, impressions, traffic sources or demographics. None
of these is in any official API for a channel you do not own, and scraping
them breaks YouTube's Developer Policies.

## Specs and dependency order

```
FILM-1721 (reference) ─┐
FILM-1703 (provenance) ┴─→ FILM-2101 (public-data reference + compliance gates)
                                │
                                ├─→ FILM-2102 (tracked channels: registry, RLS, add/remove)
                                │        │
                                └────────┴─→ FILM-2103 (public providers: YouTube key, IG Business Discovery, FB gated)
                                                  │
                                                  └─→ FILM-2104 (snapshot ingestion, cadence, quota, ClickHouse ext_*)
                                                           │
                          FILM-1715, FILM-1716 ──→ FILM-2105 (public measures: views at age, outlier score, takeoff)
                                                           │
                                                           ├─→ FILM-2106 (timing heatmaps + moments mentioned)
                          FILM-1717 ─────────────→ FILM-2107 (content breakdown by Gemini)
                                                           │
                          FILM-1705 ─────────────→ FILM-2108 (competitor report UI)  ◄── FILM-2105, FILM-2106
                                                           │
                                                           └─→ FILM-2109 (project link + symmetric comparison)
                                                                    │
                          FILM-1724, FILM-1717 ──→ FILM-2110 (gaps → hypotheses → experiments)  ◄── FILM-2107
                          FILM-1904 ────────────→ FILM-2111 (MCP tools)  ◄── FILM-2108, FILM-2110
```

| Spec | Status | Effort | Milestone | Covers |
|------|--------|--------|-----------|--------|
| [FILM-2101](./FILM-2101-public-data-reference-and-compliance.yaml) | DRAFT | S | M0 | Documents every public field with citations; the `public` access state; the 30-day retention rule; files the YouTube derived-metrics and audit applications; answers whether Instagram exposes a public view count |
| [FILM-2102](./FILM-2102-tracked-channels.yaml) | DRAFT | M | M1 | `external_channels` (global registry), `account_competitors`, `add_competitor()` with role and limit, RLS + pgTAP, the flag |
| [FILM-2103](./FILM-2103-public-data-providers.yaml) | DRAFT | M | M1 / M5 | The resolver (URL → id), the YouTube Data API key client, Instagram Business Discovery, the Facebook PPCA leg (DEFERRED), the quota ledger, vendor-sandbox fakes |
| [FILM-2104](./FILM-2104-snapshot-ingestion.yaml) | DRAFT | L | M1 | The 15-minute competitor sync cron, back-catalogue import, age-tiered snapshots, comment buckets, ClickHouse `ext_*` tables with a 30-day TTL, shedding under quota |
| [FILM-2105](./FILM-2105-public-performance-measures.yaml) | DRAFT | M | M2 | Pure measures: views at age, typical curve, curve estimate, outlier score (FILM-1715's band and shrinkage), engagement per 1,000, takeoff, cadence, publish timing |
| [FILM-2106](./FILM-2106-timing-heatmaps-and-moments.yaml) | DRAFT | M | M2 | Views-arrival heatmap, comment-activity heatmap, moments-mentioned strip; interpolation and n-thresholds |
| [FILM-2107](./FILM-2107-content-breakdown.yaml) | DRAFT | M | M3 | Gemini media part for public YouTube URLs, `competitor-video-analysis` prompt and job, winners-vs-losers attributes, per-account cap |
| [FILM-2108](./FILM-2108-competitor-report-ui.yaml) | DRAFT | L | M2 | The Competitors list and channel report pages, provenance chips, every state, CSV export, admin panel, evidence screenshots |
| [FILM-2109](./FILM-2109-project-comparison.yaml) | DRAFT | M | M4 | `project_competitors`, self-enrolment in the public pipeline, the project Competitors tab side-by-side, Studio-only panel |
| [FILM-2110](./FILM-2110-gaps-and-recommendations.yaml) | DRAFT | M | M4 | Gap computation with evidence, the `competitor-gap-analysis` prompt, "Test this" into FILM-1724 / FILM-1717 |
| [FILM-2111](./FILM-2111-competitor-mcp-tools.yaml) | DRAFT | S | M5 | `list_competitors`, `get_competitor_report`, `get_competitor_gaps` |

## Locked decisions

**Official APIs only.** No scraping, headless browsers, `yt-dlp`,
unofficial endpoints or bought scrapes. A guard fails CI if such a
dependency enters the package. "Most Replayed" is therefore out of scope, and
the UI says why.

**A competitor's video is judged against that competitor's own history.**
"What's working for them" uses FILM-1715's rule (same channel, same format
family, same age, shrunk lift, IQR band) applied to their channel. Phase 17's
"the only defensible benchmark is your own history" holds for every verdict.

**Comparison is symmetric.** When a project is compared, its own channel is
enrolled in the same public pipeline, and every compared figure is the same
measure computed by the same code on both sides. Your Studio-only figures may
sit beside the comparison, labelled, and are never compared with a public
proxy.

**Channels of different sizes are compared through ratios to their own
baselines.** Outlier rate is the share of a channel's videos above *its own*
p75, never raw views.

**Same platform only.** Phase 17's cross-platform rule is unchanged.

**Competitor data never enters Phase 17's stage scores, self-benchmark or
genome tables.** It lives in its own `ext_*` tables and package, with its own
access guard.

**No fifth support level.** Public data is `native` or `derived`, with a new
access state `public` and named derived methods (`public_snapshot_delta`,
`public_age_interpolated`, `public_curve_estimated`,
`comment_timestamp_parse`). AI readings are not metrics.

**A heatmap says what it measured.** "Views counted", "comments posted" and
"moments mentioned" are never relabelled as watch time or retention.

**Compliance before scale.** Every `ext_*` statistics table has a 30-day TTL
until YouTube accepts our derived-metrics use (gate G1). The feature stays
internal-only until then.

**No recommendation without evidence.** It is enforced by the type: a
recommendation cannot be constructed without a `Gap` that carries both sides'
values and n.

**One registry, per-account tracking.** A channel tracked by many accounts
is polled once.

## Known limits — do not promise these

- Retention, watch time, CTR, impressions, traffic sources and demographics of a channel you do not own.
- Per-hour views of a video older than 72 hours at first sight. The back catalogue gets age-normalised estimates, labelled.
- Instagram personal accounts (Business Discovery reads only professional accounts).
- Facebook Pages before Meta's Page Public Content Access review passes.
- TikTok and X competitors (no lawful public path in our reference).
- More than 30 days of history before gate G1.

## Open product questions

See PRD-EDD.md §28: Q1 file the YouTube applications now; Q2 Instagram public
view count; Q3 channel limit by plan; Q4 TikTok; Q5 suggested channels; Q6
heatmap time zone.
