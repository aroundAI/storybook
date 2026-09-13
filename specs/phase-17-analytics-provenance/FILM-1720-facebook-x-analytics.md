---
spec_id: FILM-1720
title: Facebook and X Analytics
status: DRAFT
effort: XL
dependencies: FILM-1711, FILM-1714
---

# Facebook and X Analytics

## 1. Overview

The product targets five platforms. The analytics stack supports three, and
Facebook and X cannot store a single row.

| Layer | Facebook | X |
|---|---|---|
| Publishing provider | exists (FILM-704) | exists (FILM-714) |
| OAuth | `pages_*` for publishing; **no `read_insights`** | `tweet.read/write`, `users.read`; **no analytics scope** |
| Analytics provider | **none** | **none** |
| `AnalyticsPlatform` | **no** | **no** |
| ClickHouse `platform` enum | **no** | **no** |
| `platform_connections` CHECK | yes | yes, as `'twitter'` |

So a Facebook or X connection can be created, can publish, and can carry
revenue rows in Postgres — and can never produce an analytics row.

Worse: `dim-sync.ts` has no platform filter and `video_dim.platform` is an
unconstrained `LowCardinality(String)`, so Facebook publishes **do** get
dimension rows that can never have metrics. They appear as zero-view videos in
any dim-driven denominator.

## 2. Settle the vocabulary before touching the enum

Postgres stores `'twitter'`. The product says X. `oauth_states` alone also
permits `'meta'`.

Pick one vocabulary first. The ClickHouse enum is the expensive thing to change
twice, and a rename after the fact is a second eight-table migration.

## 3. The enum is the expensive part

`platform` is `Enum8('youtube'=1,'tiktok'=2,'instagram'=3)` in **all eight**
analytics tables — `001:17`, `002:27`, `002:48`, `003:22`, `003:35`, `004:27`,
`004:37`. No migration has ever extended it.

Widening means an `ALTER TABLE … MODIFY COLUMN` on each, plus `AnalyticsPlatform`
(`clickhouse/src/types.ts:11`) and `SyncPlatform`
(`content-analytics/src/server/types.ts:6`). Enum values must be *appended* —
renumbering rewrites every row.

`QueryFilters.platforms` is typed as `Array(Enum(...))` at the parameter level
(`queries.ts:220-224`), so a widened enum must be reflected there or a valid
selection errors at the server.

## 4. Two platforms that differ in shape, not only in data

This is where the signal model earns itself.

**Facebook** is recognisably the same funnel: reach, 3-second views, average
watch time, retention, ThruPlay, shares, followers gained. Its complication is
definitional — a 3-second view, a ThruPlay and an "initial view" are three
different denominators, and Meta computes average watch time as watch time over
*initial* views. Those definitions must be recorded rather than assumed
equivalent to YouTube's.

**X is not primarily a video recommender.** A video there can perform poorly as
a video and extremely well as a conversation starter. Its Audience and
Transmission stages bind to replies, reposts, bookmarks and profile visits;
its Reach stage binds to impressions; and completion matters less than it does
anywhere else. X also defines a view as two seconds with half the player in
view — not comparable to any other platform's view, which is precisely why
stage scores are never compared across platforms.

Both are expressed by adding rows to the signal map, not by changing any
consumer. **That is the test of whether FILM-1714's expandability design
worked**, and this spec is where it gets proven.

## 5. Scope work

Per FILM-1711's audit, both need analytics scopes added: `read_insights` for
Facebook Page and video insights; X's equivalent depends on API tier and must
be verified rather than assumed. Both mean reconnection for existing accounts,
and Facebook likely means App Review.

X's API access tier is a genuine open question — video analytics may require a
paid tier, and that is a commercial decision this spec surfaces rather than
answers.

## 6. Why this is last

Proving the analytical model needs one platform where every stage has real
data. That is YouTube today. Instagram and TikTok then test whether the model
survives different platform semantics.

Facebook and X are two providers that do not exist, two OAuth flows, an
eight-table enum migration and an unresolved API-tier question. Putting them
first would block the intelligence layer behind an integration programme, and
would design the signal map against platforms nobody had yet seen data from.

## 7. Out of scope

- Snap, Threads, LinkedIn. The framework should make them additive; this spec
  does not add them.
- Changing how the existing three platforms are analysed.
- The publishing providers, which already exist.

## 8. Acceptance criteria

- [ ] The platform vocabulary is settled and consistent across Postgres, the enum and the product before the migration runs
- [ ] The enum is widened by appending values, never renumbering
- [ ] All eight analytics tables, `AnalyticsPlatform`, `SyncPlatform` and `QueryFilters` accept the new platforms
- [ ] `dim-sync` no longer creates dimension rows for platforms that cannot have metrics
- [ ] Facebook and X analytics providers exist, with scope errors matching the existing pattern
- [ ] Both platforms' view and watch-time definitions are recorded in the capability matrix, not assumed equivalent
- [ ] X's stages bind to conversation metrics where that is what the platform measures
- [ ] Adding both platforms required **no change to any signal-map consumer**
- [ ] Both fail the structural tests until their capability entries and stage bindings are written
- [ ] X's API tier requirement is established and recorded before the provider is built

## 9. Verification

```bash
pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
./scripts/local-env.sh verify
pnpm turbo typecheck --force && pnpm lint
```

The migration is the risky part and must be verified against a table with rows,
not an empty one: insert under the old enum, migrate, and assert the existing
rows still read correctly and the new values are accepted.

The expandability claim is verified by the diff, not by a test: if adding these
two platforms changed anything other than the enum, the type unions, the
capability matrix and the signal map, then FILM-1714's design did not work and
that is the finding.

## 10. Risk

**The enum migration touches every analytics table.** It is metadata-only if
values are appended, and a full rewrite if anything is renumbered. That
distinction is the whole risk, and §2's vocabulary decision is what determines
whether it stays on the safe side.

**X may not be economically viable** at the required API tier. Better to find
that out in this spec than to design its signal map first.

**Facebook publishes already pollute `video_dim`.** Fixing that is arguably
urgent independent of this spec, since it distorts denominators today — worth
pulling forward if the enum work is deferred.
