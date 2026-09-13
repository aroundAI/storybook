---
spec_id: FILM-1701
title: Audience Truth-Up
status: DRAFT
effort: M
dependencies: none
---

# Audience Truth-Up

## 1. Overview

Three cards on the Audience tab render numbers that were never measured, in
the same visual treatment as the cards beside them that were.

`components/audience/audience-grid.tsx:23-54` declares:

```ts
const DEFAULT_DEVICE_TYPES = { mobile: 78, desktop: 18, tablet: 4 };
const DEFAULT_INTERESTS = [ /* six hardcoded interest categories */ ];
const DEFAULT_PEAK_ACTIVITY = [ /* hardcoded hour-of-day curve */ ];
```

and falls back to them at `:89-91`:

```ts
const deviceTypes = data?.deviceType || DEFAULT_DEVICE_TYPES;
const peakActivity = data?.peakActivity || DEFAULT_PEAK_ACTIVITY;
const interests = data?.interests || DEFAULT_INTERESTS;
```

The server type `ProjectAudienceData` (`server/aggregation-queries.ts:654-661`)
has no `deviceType`, `peakActivity` or `interests` field, so the left-hand side
of every one of those `||` is permanently `undefined`. **The fallback is not a
fallback. It is the only code path.** A creator reading "78% mobile" is reading
a literal that was typed into a source file.

This has to be fixed before anything else in Phase 17, and not merely because
it is wrong. The rest of this phase attaches a provenance chip to every card —
a statement about where a number came from. Attaching one to an invented number
does not label the invention, it **launders** it: the chip's presence is itself
a claim of lineage. There is also a structural reason. The capability matrix in
FILM-1703 has exactly four support levels, none of which is *fabricated*, and
adding a fifth to accommodate these three cards would poison the model
permanently, because the next person will reach for it.

## 2. The three cards split two ways

They are not one problem. Checking what ingest actually writes against what the
read query actually asks for:

`buildAudienceRows` (`server/ingest.ts:214-229`) writes, for YouTube:

```ts
for (const city of data.cityGeography ?? [])   push('city', ...);
for (const device of data.deviceBreakdown ?? []) push('device', ...);
for (const os of data.operatingSystem ?? [])   push('os', ...);
if (data.subscribedStatus) { push('follower_status', 'subscribed', ...); ... }
```

`getProjectAudienceData` (`server/aggregation-queries.ts:700-704`) reads:

```ts
queryAudienceRows({ videoIds: publishIds, dimension: 'age_group' }),
queryAudienceRows({ videoIds: publishIds, dimension: 'gender' }),
queryAudienceRows({ videoIds: publishIds, dimension: 'country' }),
```

So:

| Card | Ingested? | Read? | Action |
|------|-----------|-------|--------|
| Device Type | **yes**, `dimension = 'device'` | no | **Plumb it.** Real data we never asked for. |
| Interests | no — no provider field, no `AudienceDimension` slot | no | **Delete.** |
| Peak Activity | no — no provider field, no slot | no | **Delete.** |

`AudienceDimension` (`packages/clickhouse/src/types.ts:70-77`) is the closed
union `age_group | gender | country | city | device | os | follower_status`.
`device` and `os` have had slots and writers since the dimension was
introduced; nothing ever read them. `city` and `follower_status` are stranded
the same way — `follower_status` is read only by
`getReturningViewerProxyAction` (`server/deep-dive-actions.ts:362`), never by
the Audience tab.

That materially shrinks the "this is a visible regression" objection to doing
this first: one card gets **fixed**, two honestly disappear.

## 3. Conventions fixed here

**A card with no data says so, and says why.** The two deleted cards are
replaced with the existing `@kit/ui/empty-state` naming the reason — "We don't
collect this" — not a shrug and not a zero. A zero is a measurement; absence is
not.

**No `||` fallback to a literal, anywhere in the analytics feature.** A
fallback to a constant is indistinguishable at the call site from a fallback to
a computed default, which is how this survived review. The rule is enforceable
by grep and is asserted in FILM-1703's test suite once the provenance module
exists.

**A dimension that is ingested is either read or removed from ingest.** Writing
rows nobody reads costs ClickHouse storage on every sync and creates exactly
this class of confusion — someone assumes the absence of a card means the
absence of data. `device`, `os`, `city` and `follower_status` are all in this
state today.

## 4. Implementation map

| File | Change |
|------|--------|
| `server/aggregation-queries.ts` | Widen `ProjectAudienceData` with `deviceType`, and read `dimension: 'device'` (plus `city`, `os`, `follower_status` — see §5). |
| `components/audience/audience-grid.tsx` | Delete all three `DEFAULT_*` constants and the `\|\|` fallbacks. |
| `components/audience/device-type-card.tsx` | Bind to real data; empty state when the window has no device rows. |
| `components/audience/interests-card.tsx` | Delete. |
| `components/audience/peak-activity-card.tsx` | Delete. |
| `components/audience/index.ts` | Drop the two deleted exports. |
| `components/overview/views-card.tsx` | `description`/`footer` currently hardcode "Aggregated across TikTok, YouTube, and Instagram" (`:38-39`) regardless of the platform filter or of which platforms have data. Derive it, or state nothing. |
| `components/analytics-dashboard.tsx` | The Overview grid is passed `audience={audienceData}` while that query is `enabled: activeTab === 'audience'`, so Top Regions and Gender are empty on first load. Either enable it for both tabs or stop passing it. |
| `apps/web/scripts/seed-local-analytics.ts` | See §6. |

## 5. Scope call on the other stranded dimensions

`city`, `os` and `follower_status` are in the same state as `device` — ingested
and unread. This spec plumbs `device` because it has a card already built and
currently lying. The other three get no card here; they are listed in the
acceptance criteria as *either read or deliberately recorded as unread*, so the
next person does not rediscover them. Deciding their surfaces is FILM-1707's
job, once there is a shell that can describe coverage.

## 6. The seed script writes the wrong platform

`apps/web/scripts/seed-local-analytics.ts:239` picks a dimension row with
`dims[week % dims.length]`, which cycles through **every** publish in the
project, then writes `platform: 'youtube'` on both the traffic-source rows
(`:274`) and the metric rows (`:286`).

The seeded project has 41 publishes — 16 YouTube, 16 TikTok, 9 Instagram — so
24 of them are currently carrying YouTube traffic and YouTube metrics in local
ClickHouse. Verified against the live instance:

| Platform | videos in `video_dim` | videos with traffic rows |
|---|---|---|
| youtube | 16 | 16 |
| tiktok | 16 | 15 |
| instagram | 9 | 8 |

This is a fixture bug, not a product one, but it is disqualifying for this
phase specifically: every later spec is verified by looking at a page whose
whole subject is which platform a number came from. The fixture must be able to
show a true mixed-platform project — YouTube with traffic sources and true
daily metrics, TikTok and Instagram with snapshot-delta metrics and **no**
traffic rows at all — or none of the coverage work can be seen working.

## 7. Out of scope

- Ingesting anything new from any provider. This spec reads what is already
  written and deletes what never was.
- Any provenance chip, coverage strip or shell change — FILM-1703 onward.
- Interests and Peak Activity as *features*. If they are wanted, they need a
  provider field, an `AudienceDimension` slot, a writer and a backfill; that is
  a new spec, not a revival of these constants.
- The Audience tab's platform filtering, which does not work today and is
  FILM-1709.

## 8. Acceptance criteria

- [ ] No `DEFAULT_*` constant in `components/audience/` is rendered as data
- [ ] `grep -rn "|| DEFAULT_" packages/features/content-analytics/src` returns nothing
- [ ] Device Type renders rows read from `video_audience` `dimension = 'device'`
- [ ] Device Type renders an empty state, not a zero and not a default, when the window has no device rows
- [ ] Interests and Peak Activity are deleted, exports included, with no dangling imports
- [ ] Every `AudienceDimension` value is either read by a surface or listed in this spec as deliberately unread
- [ ] The Views card no longer claims a platform set it has not checked
- [ ] Top Regions and Gender are populated on first load of Overview, not only after visiting Audience
- [ ] The seed script writes each row under the platform of the publish it belongs to
- [ ] The seeded fixture contains at least one platform with **no** traffic-source rows, so absence is representable
- [ ] A reviewer can state, for every number on the Audience tab, which ClickHouse rows produced it

## 9. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm turbo typecheck --force && pnpm lint
set -a && . deployment/config/local.env && set +a
pnpm --filter web seed:local-analytics
```

Then confirm in the live database that the fixture is genuinely mixed:

```sql
SELECT platform, count() FROM video_traffic_sources FINAL GROUP BY platform;
-- expect: youtube only

SELECT platform, count() FROM video_metrics FINAL GROUP BY platform;
-- expect: all three
```

And in the browser, on the Audience tab: Device Type shows measured rows or an
empty state; Interests and Peak Activity are gone; nothing on the tab displays
a number that cannot be traced to a row.

## 10. Risk

Deleting two populated-looking cards is a visible regression to anyone who
believed them. That is the point, and the honest framing is that the regression
already happened — it happened when the constants were written. The mitigation
is the empty state: say we don't collect this, rather than removing the cards
silently and leaving a gap someone will try to refill.

The lower-profile risk is `views-card.tsx`. Deriving its platform claim
correctly needs the capability model that does not exist until FILM-1703, so
this spec may only be able to *remove* the false claim rather than replace it.
Removing it is still strictly better than leaving it, and FILM-1705 restores a
true one.
