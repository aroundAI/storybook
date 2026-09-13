---
spec_id: FILM-1712
title: Metric Recovery
status: DRAFT
effort: L
dependencies: FILM-1711, FILM-1721
---

# Metric Recovery

> **Rewritten 2026-09-14.** The first draft claimed most missing metrics were a
> field-list change. Research against vendor documentation showed that is true
> for YouTube and false for TikTok and Instagram. The corrections are in §2.

## 1. Overview

Some of what the growth research asks for is data we already fetch and discard,
or never ask for despite having access. Some of it is a second API integration
we mistook for a URL parameter. This spec separates the two, because they cost
very different amounts and only one of them is cheap.

| Kind | Platform | Fix |
|---|---|---|
| Requested, dropped at ingest | Instagram `reach` | a column and a mapping |
| Not requested, same endpoint | YouTube ×3 | add to a metrics string |
| **Different API entirely** | TikTok ×5 | a second integration |
| **Does not exist for this surface** | Instagram `follows`, `profile_visits` on Reels | record as a limit |

## 2. Corrections to the first draft

These were wrong, and they were wrong because the first draft cited **our own
TypeScript types** as evidence of a platform's capability.

**TikTok: five of the fields are not on that endpoint.** The complete
documented field list for `POST /v2/video/query/` is `id, create_time,
cover_image_url, share_url, video_description, duration, height, width, title,
embed_html, embed_link, like_count, comment_count, share_count, view_count,
is_aigc`.

| We planned to add | Reality |
|---|---|
| `save_count` | **Does not exist** for own videos on any creator-auth surface |
| `average_watch_time` | `average_time_watched` — **TikTok Business API** |
| `total_play_time` | `total_time_watched` — **TikTok Business API** |
| `full_video_watched_rate` | Right name, **wrong API** |
| `traffic_source_types` | `impression_sources` — **TikTok Business API** |

**Instagram: `profile_visits` and `follows` do not exist for REELS.** They are
FEED and STORY only. Since Reels is what creators publish, Instagram's Audience
stage has no per-media signal, and no amount of requesting will produce one.

**YouTube: this part was right.** `averageViewPercentage` *is* valid with
`dimensions=day` and `filters=video==ID` — so it folds into the daily query and
the two YouTube calls collapse into one.

## 3. What is genuinely cheap

### YouTube — three metrics onto the daily query

The daily query (`youtube-analytics.ts:225`) currently asks for
`views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,subscribersGained`.
Add:

- **`averageViewPercentage`** — completion on the fast path, instead of only
  via the 1–3 day lagged bulk report
- **`subscribersLost`** — so net subscribers is real rather than gross
- **`dislikes`**

All three are already requested on the separate *totals* call and dropped,
because `buildYouTubeDailyRows` (`ingest.ts:115-141`) builds rows from the
daily query. Adding them there lets the totals call go.

Not `annotationClickThroughRate` — annotations were retired and it returns
zeros. Keep `cardClickRate`.

### Instagram — a column for the reach we already fetch

`reach` is in the request (`instagram-insights.ts:107`), read at `:139`, and
discarded because no column exists. It is the denominator the growth research
recommends for nearly every Instagram ratio. Give it one.

Also worth taking while here, all already returned: `total_interactions`,
`reposts`.

## 4. What is a second integration

TikTok's real analytics live on the **TikTok API for Business**,
`business-api.tiktok.com/open_api/v1.3/business/video/list/`:
`video_views`, `reach`, `full_video_watched_rate`, `total_time_watched`,
`average_time_watched`, `impression_sources`, `audience_countries`.

That is a different host, a **separate developer portal and app registration**,
and — the part that is not an engineering problem — **the creator must be on a
TikTok Business account.**

This is why `account_type_gated` exists in FILM-1703's access axis. A creator on
a personal account cannot grant these metrics, and the honest UI response is to
say so, not to show an empty chart.

Documented constraints to carry into the capability matrix:

- `video_views` **mixes organic and paid** and cannot be separated
- `reach`, `full_video_watched_rate`, `total_time_watched`,
  `average_time_watched`, `impression_sources`, `audience_countries` return
  **empty when the video has been inactive for more than 7 days**
- post data **stops updating 365 days after publish**
- if TikTok Studio does not show it, the API will not return it

**Recommendation: split this out.** The Business API integration is its own
piece of work with its own approval, its own app and its own product
constraint. Doing it inside a spec called "metric recovery" would hide a second
integration inside a cheap-sounding name — which is exactly the mistake the
first draft made.

## 5. Stop writing zeros that look like measurements

The rule this spec establishes, independent of platform: **a field we do not
have is null or absent, never zero.**

Today `saves: 0` for TikTok, `watch_time_seconds: 0` for Instagram, and
`revenue_cents: 0` everywhere are indistinguishable from genuine zeros. Several
of those exist *because* a never-requested field was mapped into a column — the
first draft would have added more.

Where a column cannot be made nullable cheaply, the capability matrix carries
the fact and the UI reads it from there. The default is to represent absence.

## 6. `extra_metrics` is write-only

`video_metrics.extra_metrics` holds `JSON.stringify` of the entire provider
response, written at `ingest.ts:139` and `analytics-sync-cron.ts:689`. **Nothing
reads it** — no `JSONExtract` anywhere in the repository, and the
`video_daily_stats` view enumerates columns and omits it.

Since nothing has been published yet there is nothing worth recovering from it.
It should gain a reader or stop being written; an unread payload on every row
is storage with no purpose.

## 7. Out of scope

- OAuth scopes and permissions — FILM-1711, which gates this entirely for
  TikTok and Instagram.
- The TikTok Business API integration, per §4's recommendation.
- Graph API version consolidation — FILM-1723, though it touches the same
  Instagram files and should be sequenced with this.
- Facebook and X — FILM-1720.
- Any ratio or signal computed from these fields — FILM-1713 onward.

## 8. Acceptance criteria

- [ ] Every field added to a request appears in FILM-1721 with a citation
- [ ] A test fails when a provider type declares a field the request does not ask for **and** when a request asks for a field FILM-1721 does not document
- [ ] YouTube's daily query returns average view percentage, and the separate totals call is removed or justified
- [ ] Instagram's `reach` reaches a column instead of `extra_metrics`
- [ ] The five TikTok field names that do not exist are recorded as such, so they are not re-added
- [ ] Instagram `follows`/`profile_visits` are recorded as unavailable for Reels rather than requested
- [ ] No provider maps a never-requested field to a column as zero
- [ ] A metric we do not have is distinguishable from one that is genuinely zero
- [ ] `input.metrics` on the Instagram provider is honoured or removed
- [ ] `extra_metrics` gains a reader or stops being written
- [ ] The capability matrix is updated in the same PR as each newly-ingested field, per FILM-1703's writer-binding test

## 9. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm --filter @kit/clickhouse test
./scripts/local-env.sh verify
pnpm turbo typecheck --force && pnpm lint
```

The declared-vs-requested-vs-documented test in §8 is what stops this
recurring, and it is the one to write first. The first draft of this spec would
have passed review without it; it is the mechanical version of "our own types
are not evidence".

Everything else needs live connections and therefore FILM-1711. Against a real
account per platform, assert each newly-requested field returns a **non-zero**
for a video known to have one — a zero proves nothing, because a zero is what
the bug produced.

## 10. Risk

**The estimate depends on FILM-1711's findings.** If TikTok's `video.list`
needs app review, or Meta declines the insights permission, this spec cannot be
verified on those platforms regardless of how small the diff is.

**A new column that only one writer fills** is the failure mode to avoid — the
same shape as `revenue_cents` being literal zero in all four writers. Each new
column gets one writer and a named absent state.

**And the meta-risk, recorded because it already happened once:** citing our own
types as evidence of a platform's capability. Five field names in the first
draft came from `TikTokVideoData` and none of them were real. FILM-1721 exists
to be the evidence instead.
