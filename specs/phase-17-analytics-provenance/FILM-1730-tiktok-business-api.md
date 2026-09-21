---
spec_id: FILM-1730
title: TikTok Business API Integration
status: DRAFT
effort: XL
dependencies: FILM-1703, FILM-1711, FILM-1721; a TikTok API for Business developer app (not held — see §3)
---

# TikTok Business API Integration

## 1. Why this exists

Everything we know about a TikTok video today comes from the **Display API**
(`/v2/video/query/`): views, likes, comments, shares, a duration. It is the
shallow surface, and it is all the Display API has. No watch time, no reach, no
traffic sources, no geography — not because we failed to ask, but because those
fields are not there to ask for. [FILM-1721](./FILM-1721-platform-capability-reference.md)
established this after the provider had spent months parsing a
`traffic_source_types` field the Display API never returned.

TikTok's real analytics live on a different product: the **TikTok API for
Business**, `business-api.tiktok.com/open_api/v1.3/business/video/list/`.

[FILM-1712](./FILM-1712-metric-recovery.md) §4 described it and recommended
splitting it out: *"its own piece of work with its own approval, its own app and
its own product constraint. Doing it inside a spec called 'metric recovery' would
hide a second integration inside a cheap-sounding name."* This spec is that
split (owner decision, 2026-09-22).

**It already has a hole waiting for it.** [FILM-1703](./FILM-1703-provenance-capability-model.md)'s
capability matrix carries four TikTok entries at `level: 'not_ingested'` whose
`blockedBy` is `'FILM-1712'` — a placeholder, because the matrix's own guard
requires `blockedBy` to name a spec that exists and this one did not:

| Metric family | What the Business API supplies | Matrix today |
|---|---|---|
| `watch_time` | `total_time_watched`, `average_time_watched`, `full_video_watched_rate` | `not_ingested`, blocked by FILM-1712 (placeholder) |
| `traffic_sources` | `impression_sources` | same |
| `reach` | `reach` | same |
| `geography` | `audience_countries` | same |

The first change this spec makes is to point those four at `FILM-1730`.

## 2. What the surface gives, and what it never will

From `docs/platform-capability-reference.md`, "Business API `/business/video/list/`
— the real one". **That section is the oldest in the reference** — last verified
2026-09-14, not re-verified on 2026-09-21 because `developers.tiktok.com` refused
connections, and its field block is headed *"source not fetched … No request site
may use this block."* So:

**Step zero of this spec is to re-verify that section against the vendor's own
`/business/video/list/` reference page** (not the portal root it currently cites),
and update the `<!-- fields: tiktok/business -->` block. `platform-field-names.test.ts`
fails the build on a requested field the reference does not carry, so no provider
code can be written before this is done. That is the rule working as designed.

Fields as currently recorded: `video_views`, `reach`, `likes`, `comments`,
`shares`, `full_video_watched_rate`, `total_time_watched`, `average_time_watched`,
`impression_sources`, `audience_countries`.

Documented constraints — each one is a thing the UI must say, not hide:

| Constraint | Consequence |
|---|---|
| `video_views` **mixes organic and paid** and cannot be separated | It is a *different measure* from the Display API's `view_count`. It gets its own entry in [FILM-1722](./FILM-1722-view-definition-registry.md)'s view-definition registry, and the two are **not comparable** — a creator who connects a Business account must not see their views "jump" |
| `reach`, `full_video_watched_rate`, `total_time_watched`, `average_time_watched`, `impression_sources`, `audience_countries` return **empty once the video has been inactive for more than 7 days** | Empty is **not zero**. These must be stored as absent (see FILM-1712 §5, "stop writing zeros that look like measurements"), and the sync must capture them while the video is active — a video we first see at day 10 may never have them |
| Post data **stops updating 365 days after publish** | The capability's `window` axis is bounded; after 365 days the figure is final, and is labelled so |
| If TikTok Studio does not show it, the API will not return it | No retention curve, no replay count, no 2s/6s holds, no per-video follows — on any TikTok API. `full_video_watched_rate` is one scalar. **Do not promise these** |

## 3. The part that is not an engineering problem

Two gates, neither of which code can open:

1. **We need the app.** A separate developer portal, a separate app registration,
   its own review. We do not hold one. Until we do, nothing here can be seen to
   work against TikTok — and "red before green" applies to integrations as much as
   to forms. **Registration is the first action of this spec and it is the owner's,
   not an engineer's.** Lead time is unknown; third-party reports put Display API
   production review at 1–2 weeks, and nothing suggests Business is faster.
2. **The creator must be on a TikTok Business account.** A creator on a personal
   account *cannot grant these metrics*. This is why `account_type_gated` exists in
   FILM-1703's access axis, and it is per creator, not per platform — so consumers
   must call `accessFor(family, platform, { meetsAccountGate })`, never read
   `.access`. The honest UI is a sentence saying so, with what switching account
   type costs the creator (TikTok restricts the commercial music library for
   Business accounts — **verify and cite before putting it in copy**). It is not an
   empty chart.

**What can be built before the app exists:** the local sandbox.
[FILM-1802](../phase-18-local-vendor-sandbox/FILM-1802-social-platform-sandbox.md)
can serve `/business/video/list/` exactly as documented — including the 7-day
emptiness and the 365-day freeze, which are precisely the behaviours worth
testing and impossible to provoke on demand against the real thing. That makes
§4 buildable and testable locally. It does not make it *verified*: a sandbox
proves our code against our reading of the documentation. The live check goes in
[FILM-1725](./FILM-1725-deferred-vendor-verifications.md) as a new check, and the
spec is not DONE until it has run.

## 4. The work

1. **Reference first.** Re-verify and cite the Business section (§2). Record the
   OAuth flow, scopes, token lifetime and refresh behaviour, rate limits, and the
   pagination contract — none of which the reference holds today.
2. **A second connection, not a wider one.** The Business API authorises against a
   different app with different credentials. Decide — and write the decision here
   before code — whether it is a second row in `platform_connections` for the same
   TikTok account (a `surface` discriminator) or an upgrade of the existing row.
   A second row is the recommendation: the Display connection keeps working for
   publishing and for creators who never switch, and revoking one cannot break the
   other. Either way, FILM-1711's scope audit gains this surface.
3. **Host and version in one place.** `packages/shared/src/vendors/tiktok.ts`,
   following FILM-1723's pattern and FILM-1801's resolver: `business-api.tiktok.com`
   and `v1.3` each written once, covered by `vendor-api-versions.test.ts`.
4. **Provider.** A Business provider beside the Display one in
   `packages/features/content-analytics/src/providers/tiktok/`, returning absent
   (not `0`) for every field TikTok returned empty. Page with a deterministic
   order; nothing here may assume fewer than 1000 rows.
5. **Storage.** `total_time_watched` / `average_time_watched` map to the existing
   watch-time columns. `reach` needs the column FILM-1712 gives Instagram `reach` —
   **share it, do not add a second**. `impression_sources` needs a mapping into
   `traffic-groups.ts`'s groups, written and cited, with an explicit `other` for
   anything unmapped rather than a silent drop. `audience_countries` lands in the
   audience tables FILM-1701 plumbs. Rows carry a `metric_source` that
   distinguishes Business from Display.
6. **Time semantics.** Are Business figures lifetime totals per fetch (snapshot
   deltas, like the Display API — attributed to the *fetch* day, see FILM-1707 §2)
   or true daily series? **Find out in step 1 and record it.** It decides whether
   these rows can enter time-bucketed aggregates at all.
7. **Sync.** Capture inside the 7-day activity window: a newly published TikTok is
   fetched on a schedule tight enough that the decaying fields are read before they
   empty. State the schedule and the reasoning. Stop fetching at 365 days.
8. **The matrix.** Flip the four entries from `not_ingested` to their real level,
   with `accountGate` set, and let FILM-1703's writer-binding tests prove the matrix
   and the writers agree.
9. **The UI sentence.** Through FILM-1705's provenance surfaces: a personal-account
   creator sees why the metric is absent and what would change it.

## 5. Out of scope

- The Display API's own gaps — FILM-1711 (`video.list` was never authorised) and
  FILM-1712.
- TikTok Ads / paid metrics. `video_views` includes paid and we say so; we do not
  try to separate it.
- Anything the Research API offers. It is closed to commercial apps
  (capability reference, "The Research API is not available to us").
- Putting TikTok into the signal model. [FILM-1714](./FILM-1714-signal-model.md)
  binds stages to whatever the matrix says is measured; once §4.8 lands, that
  follows without a change here.

## 6. Acceptance criteria

- [ ] The four TikTok matrix entries name `FILM-1730` in `blockedBy` (can land immediately, ahead of everything else)
- [ ] Business section of the capability reference re-verified against the endpoint's own reference page, cited, dated; auth, scopes, limits, pagination and **time semantics** recorded
- [ ] Business developer app registered and approved *(owner action; blocks every criterion below that says "live")*
- [ ] Connection model decided and written into this spec before code; Business and Display connections cannot break each other
- [ ] Host and version live once in `@kit/shared/vendors`; the version guard covers them
- [ ] Provider returns absent, never `0`, for fields TikTok returned empty — seen red with a fixture of an 8-day-inactive video
- [ ] `impression_sources` → traffic groups mapping is written, cited, and sends unmapped values to `other`
- [ ] Business `video_views` is a separate view definition, not comparable with Display `view_count`; no chart joins them
- [ ] Sync reads a new video inside its 7-day window and stops at 365 days, with tests for both edges
- [ ] Capability matrix updated with `accountGate`; FILM-1703's binding tests pass
- [ ] A personal-account creator sees a sentence, not an empty chart — Playwright spec and screenshots of both account types
- [ ] Sandbox-backed E2E (FILM-1802): connect → sync → figures on the dashboard, hand-computed and read off the page
- [ ] **Live:** one real Business account connected and one sync verified against TikTok Studio's own numbers — filed as a FILM-1725 check until it can run

## 7. Risk

**The product risk is larger than the engineering risk.** If most of our creators
are on personal accounts — and creators avoid Business accounts for the music
library — this integration serves a minority, and the honest outcome of step 1 may
be a recommendation not to build it. **Find out what share of connected TikTok
accounts are Business accounts before committing the XL.** If the Display API
cannot tell us, ask.

**Planning assumption (owner, 2026-09-22): treat it as 50-50.** Two kinds of
TikTok channel are expected on this product. One is a **marketing channel for a
business** — a Business account is natural there, and this integration serves it.
The other is a **content channel** — shorts in the manner of "explained in one
minute", which needs to reach monetisation, and is likelier to be a personal or
creator account that *cannot grant these metrics at all*. So neither half is an
edge case, and the consequences are design requirements rather than risks:

- The **Display API path stays first-class**, not a fallback to be deprecated.
  Half the channels will never leave it. Nothing in the signal model
  (FILM-1714) or the diagnosis (FILM-1718) may *require* a Business-only metric
  for TikTok; a TikTok stage bound only to Business fields is an unbound stage
  for a content channel, and must say so.
- The **account-type sentence (§3, §4.9) is a main path**, seen by roughly every
  second TikTok channel — so it is designed, tested and screenshotted like one,
  and it never reads as an upsell or an error.
- The integration is **worth building** at 50%, which was the open question.
  It is not worth building *first*: FILM-1711's Display scopes unblock every
  TikTok channel, this unblocks half.
- The owner is the product's first end-to-end user; the first live verification
  (§6, last criterion) is the owner's own Business-account channel. Replace
  this assumption with the measured share once there are enough connected
  accounts to measure.

The engineering risk is the 7-day window: a sync outage longer than a week loses
those fields for every video active in it, permanently, and nothing can backfill
them. The sync's alerting has to treat that as data loss, not as lateness.
