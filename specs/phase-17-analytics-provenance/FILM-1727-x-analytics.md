---
spec_id: FILM-1727
title: X Analytics
status: DRAFT
effort: L
dependencies: FILM-1711, FILM-1714, FILM-1721, FILM-1723; FILM-1725 Check A for the Enterprise tier only
---

# X Analytics

> **Split from FILM-1720 on 2026-09-21**, which was "Facebook and X Analytics".
> Facebook is now [FILM-1720](./FILM-1720-facebook-analytics.md) and ships
> first.

> **X is not blocked; its richer tier is.** §2 decides X ships on the
> pay-per-use `media.non_public_metrics` path, which needs only an ordinary
> token. [FILM-1725](./FILM-1725-deferred-vendor-verifications.md) Check A
> blocks the *Enterprise* tier and the question of a window beyond 30 days —
> not X itself.

> **Authorisation is not the blocker either.** `tweet.read` and `users.read` are
> already requested for publishing (`oauth/twitter/config.ts:13-15`). An earlier
> draft said "not requested"; it was wrong. What X lacks is a provider.

## 1. Where X actually stands

| Layer | X |
|---|---|
| Publishing provider | exists (FILM-714) |
| Analytics provider | **none** |
| Analytics API | `/2/media/analytics` (Enterprise) or `media.non_public_metrics` (pay-per-use) |
| OAuth | `tweet.read` + `users.read` — **held** |
| Commercial | **metered** on the pay-per-use path; **Enterprise-gated** for the full one |
| `AnalyticsPlatform` | **no** |
| ClickHouse enum | **no** |

**The pay-per-use path is metered.** Every sync costs money per call, so X's
sync cadence is a cost decision in a way no other platform's is. This spec
surfaces that decision; it does not make it.

## 2. X has two capability tiers, and we ship the lower one

This is the decision this spec exists to record.

### Enterprise — `GET /2/media/analytics`

`video_views`, `playback_start`, `playback25`, `playback50`, `playback75`,
`playback_complete`, **`watch_time_ms`**, `cta_url_clicks`, `cta_watch_clicks`,
`play_from_tap`, `timestamped_metrics`. Up to 100 media keys,
`hourly | daily | total`.

`GET /2/tweets/analytics` adds `bookmarks`, `user_profile_clicks`,
`url_clicks`, `shares`, `quote_tweets`, `impressions`, and — uniquely among
these five platforms — **`follows` and `unfollows` attributed to a post**.

Gated to Enterprise per an explicit comparison table on X's Enterprise
introduction. **Pricing is unpublished.**

### Pay-per-use — `media.non_public_metrics`

Via the ordinary posts lookup: `playback_0_count`, `playback_25_count`,
`playback_50_count`, `playback_75_count`, `playback_100_count`, `view_count`.

**Note the two quartile vocabularies differ** — `playback25` versus
`playback_25_count`. Mixing them is a silent bug.

No watch time, no CTA clicks, no time series, and a hard 30-day wall.

### What ships

**The degraded path, with the Enterprise fields declared and dark.** Quartiles
plus views give X a real Attention stage — enough to be useful — and the
capability matrix records exactly what Enterprise would add, so the gap is
visible rather than forgotten.

In FILM-1703's axes: capability `native`, access `authorised` once the ordinary
scope is added, availability **`metered`** for the degraded path and
**`tier_gated`** for the full one.

## 3. The decisive unknown is the window, not the price

`media.non_public_metrics` is documented: *non-public, organic and promoted
metrics are only available for posts created within the last 30 days*, gated on
the post's **creation date**.

**The historical window on `/2/media/analytics` is undocumented.** Not on the
endpoint reference, the media introduction, or the metrics page. The legacy
enterprise Engagement API allowed 365 days with 4-week spans — a prior, not a
fact.

This decides whether X can ever be benchmarked past 30 days (FILM-1715 §5), and
it matters more than the price because no amount of money fixes a 30-day
ceiling. **Ask X sales in writing before any X work is scheduled.** Until
answered it is `availability: 'unknown'` with a named owner, per FILM-1703.

One cheap empirical check first: the endpoints live in the standard
`docs.x.com/x-api/` namespace and their own pages state no tier requirement, so
the docs are internally inconsistent. **One call with a pay-per-use token
settles the gate.**

Also constraining: **user context is required** — no app-only path — so X data
is only ever available for accounts that authorised us.

## 4. Settle the vocabulary before touching the enum

Postgres stores `'twitter'`. The product says X. `oauth_states` also permits
`'meta'`.

Pick one vocabulary **first**. The ClickHouse enum is the expensive thing to
change twice, and a rename afterwards is a second seven-table migration.

**This is X's decision alone** — Facebook's value is unambiguous and has already
been appended by FILM-1720. Settle `x` versus `twitter` before this spec's
migration, because appending one and renaming it later rewrites every row.

## 5. The enum migration — append X's value

Same mechanics as FILM-1720 §3: `ALTER TABLE … MODIFY COLUMN` on each of the
seven enum-bearing tables, **appending** the value, plus `AnalyticsPlatform`,
`SyncPlatform` and `QueryFilters.platforms`. By the time this runs, `facebook`
is already appended; X takes the next ordinal.

## 6. The second test of FILM-1714's expandability

X binds its stages to conversation metrics where TikTok binds them to watch
behaviour — X is not primarily a video recommender, and `follows` per post is a
better Audience signal than anything the others expose. **That is only on the
Enterprise tier**, so on the path that ships, X's Audience stage may be unbound.

If adding X requires changing anything **other than** the enum, the type unions,
the capability matrix and the signal map, then FILM-1714's design did not work.
FILM-1720 runs this test first; X is the harder case.

## 7. Out of scope

- Facebook — FILM-1720.
- Buying X Enterprise — a commercial decision this spec surfaces.
- Choosing the pay-per-use sync cadence — also commercial; this spec supplies
  the per-call cost it depends on.

## 8. Acceptance criteria

- [ ] The platform vocabulary (`x` vs `twitter`) is settled and consistent before the migration runs
- [ ] X's value is appended to the enum, never renumbering
- [ ] All seven enum-bearing tables, `AnalyticsPlatform`, `SyncPlatform` and `QueryFilters` accept it, and the three without the enum are handled explicitly rather than assumed
- [ ] X ships on the pay-per-use path, with Enterprise-only fields declared and dark
- [ ] The two X quartile vocabularies are never mixed
- [ ] X's 30-day wall is expressed as a `DataWindow` anchored on publish date
- [ ] The `/2/media/analytics` window is recorded as `unknown` with a named owner until X answers in writing
- [ ] The per-call cost of the pay-per-use path is recorded, so the sync cadence can be chosen against it
- [ ] Adding X required **no change to any signal-map consumer**
- [ ] X fails the structural tests until its capability entries and stage bindings are written

## 9. Verification

```bash
pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
./scripts/local-env.sh verify
pnpm turbo typecheck --force && pnpm lint
```

The enum migration must be verified against a table **with rows** — including
`facebook` rows by then.

One live check before implementation: `/2/media/analytics` with a pay-per-use
token settles the Enterprise gate (FILM-1725 Check A). And one that must be
answered by a human: X sales, in writing, on the media analytics historical
window.

## 10. Risk

**X's window may make benchmarking impossible there**, regardless of spend. If
the answer is 30 days, X supports exactly one checkpoint and its signal map
should say so rather than implying a comparison it cannot make.

**Metered syncs cost money indefinitely.** A cadence chosen for YouTube, where
calls are free, would be expensive here.
