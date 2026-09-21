---
spec_id: FILM-1703
title: Data Provenance Capability Model
status: DRAFT
effort: M
dependencies: FILM-1721
---

# Data Provenance Capability Model

## 1. Overview

The analytics page presents numbers from three platforms as though they were
one kind of thing. They are not, and the differences are large enough to
invert a conclusion.

Established by reading every writer and confirming against a live ClickHouse:

| Data | YouTube | TikTok | Instagram |
|---|---|---|---|
| `video_traffic_sources` | native | **not ingested** | **unsupported** |
| `channel_daily`, `video_reach_daily`, `video_retention_curves` | native | — | — |
| `video_metrics` | native, true daily | **derived** — snapshot delta | **derived** — snapshot delta |
| Revenue from sync | native | — | — |
| `video_audience` | 7 dimensions | 3, percentage-only | 3, account-level |

`insertVideoTrafficSources` has exactly three call sites in the repository —
`server/reporting/report-ingest.ts:316`,
`apps/web/scripts/seed-local-analytics.ts:302` and
`packages/clickhouse/scripts/verify-queries.ts:242` — and every one hardcodes
`platform: 'youtube'`. The column exists on the table and in the type; in
practice it has never held another value.

This spec builds the single definition of those facts. It contains no UI.

## 2. Four levels, and why a fifth would be wrong

The distinction that earns this module its keep is between *the platform can't*
and *we haven't*:

- **`unsupported`** — Instagram has no traffic-source concept at all. Its
  provider type (`providers/instagram/types.ts:37-43`) has only `totals`,
  `reachBreakdown` and `audience`. There is nothing to fetch.
- **`not_ingested`** — TikTok reports traffic sources as `impression_sources`
  on the **Business API**, which needs a separate app registration and a TikTok
  Business account. We have neither, so nothing arrives. The
  `TikTokTrafficSource` shape (`providers/tiktok/types.ts`) is kept for that
  integration: `{ source, percentage }` with human labels — `'For You'`,
  `'Following'`, `'Sound'` — which is structurally incompatible with
  `VideoTrafficSource` (it requires `views` and `watch_time_minutes`) and
  lexically disjoint from `SOURCE_TO_GROUP`, so every TikTok source would land
  in `other`. **This is our gap, not TikTok's**, on both counts: the app we
  have not registered, and the mapping we have not written.

  ⚠️ **The evidence for this changed under FILM-1721; the conclusion did not.**
  This spec originally read "TikTok's provider *does* return traffic sources
  (`tiktok-analytics.ts:207`)". It did not. The provider parsed a
  `traffic_source_types` field that the Display API has never had — one of the
  five fabricated names FILM-1721 found — so `parseTrafficSources` could only
  ever receive `undefined`. The fabrication and the dead parse are gone. Read
  the capability from
  [docs/platform-capability-reference.md](../../docs/platform-capability-reference.md),
  never from our own types: that is the whole point of FILM-1721, and this
  paragraph is what it looks like when the rule is not followed.
- **`derived`** — TikTok and Instagram daily metrics are snapshot deltas
  attributed to the *fetch* day rather than the data day
  (`server/ingest.ts:287-299`). They occupy the same columns as YouTube's true
  daily rows and are not comparable to them.
- **`native`** — the platform reports it and we ingest it directly.

A single "⚠️ limited" label collapses all four, and in doing so tells a creator
to stop asking for something we could actually build. The four levels are the
product of this spec; do not add a fifth. In particular there is no
*fabricated* level — FILM-1701 removes the only data that would have needed
one, and keeping the model unable to express fabrication is what stops the next
person reaching for it.

## 3. Where it lives, and why

`packages/clickhouse/src/lib/data-provenance.ts`, exported from
`packages/clickhouse/src/index.ts` — the client-safe barrel, beside the
`traffic-groups` exports.

That package rather than `content-analytics` for two reasons. Its own
precedent: `lib/traffic-groups.ts` states in its header that it is pure and
dependency-free "so a zod schema or a browser bundle can share the granularity
list instead of restating it and drifting". And proximity: the table
definitions and every insert function live in this package, so the honesty test
in §5 and the thing it guards are neighbours.

Pure means pure — no ClickHouse driver, no `server-only`, no imports beyond
types — so a client component can read it without pulling `@clickhouse/client`
into the bundle.

## 4. The shape

```ts
export const METRIC_FAMILIES = [
  'engagement',       // views/likes/comments/shares   → video_metrics
  'watch_time',       //                               → video_metrics
  'revenue',          //                               → video_metrics
  'traffic_sources',  //                               → video_traffic_sources
  'retention_curve',  //                               → video_retention_curves
  'reach',            // impressions, CTR              → video_reach_daily
  'channel_totals',   // subscribers                   → channel_daily
  'demographics', 'geography', 'device', 'follower_status', // → video_audience
] as const;

export type SupportLevel = 'native' | 'derived' | 'not_ingested' | 'unsupported';

export type DerivationMethod =
  | 'snapshot_delta_fetch_day'  // delta attributed to the fetch day
  | 'percentage_only'           // provider reports share, not counts
  | 'account_level'             // dimension describes the channel, not the asset
  | 'publish_attribute';

export interface PlatformCapability {
  level: SupportLevel;
  table: SourceTable | null;          // null iff unsupported or not_ingested
  method?: DerivationMethod;          // required iff level === 'derived'
  note: string;                       // one sentence, rendered verbatim to users
  nativeSources?: readonly string[];  // feeds the FILM-1708 drill-down
  blockedBy?: string | null;          // ticket id; null iff platform-impossible
}

export const CAPABILITY_MATRIX:
  Record<MetricFamily, Record<AnalyticsPlatform, PlatformCapability>>;
```

### Four axes, not one level

Research (FILM-1721) made a single level untenable. Instagram is *capable* and
*implemented* and still returns nothing, because we lack a permission. X is
capable and gated on a contract. TikTok's deep metrics are gated on something
neither we nor the platform controls — **the creator's account type**.

`SupportLevel` stays exactly as specced. Three orthogonal fields join it:

```ts
interface PlatformCapability {
  level: SupportLevel;         // what the platform can do, and what we built
  access: AccessState;         // whether we are permitted
  availability: Availability;  // whether we can obtain it commercially
  window: DataWindow;          // how far back, anchored on what
  ...
}

type AccessState =
  | 'authorised'          // scope held AND verified against a live account
  | 'scope_missing'       // the scope exists; our OAuth config does not ask
  | 'review_required'     // App Review / audit needed before we may ask
  | 'review_pending'
  | 'review_denied'
  | 'account_type_gated'; // e.g. TikTok Business account — the creator's call

type Availability = 'included' | 'metered' | 'tier_gated' | 'unknown';

interface DataWindow {
  maxAgeDays: number | null;        // null = unbounded
  anchoredOn: 'publish_date' | 'job_creation' | 'request_date';
  stopsUpdatingAfterDays?: number;
}
```

**This does not violate §2's "do not add a fifth level" — it is what that rule
was protecting.** The prohibition guards the capability axis against having
absence-for-any-reason collapsed into it. Adding orthogonal axes is the
alternative to that collapse, not an instance of it.

Each state has a different owner and a different sentence:

| State | Who resolves it | What the user is told |
|---|---|---|
| `scope_missing` | us, this sprint | "Reconnect your account" |
| `review_required` | us, over weeks | a roadmap item |
| `account_type_gated` | **the creator** | "Switch to a Business account" |
| `tier_gated` | a commercial decision | possibly never |
| `unknown` | must be resolved before it is claimed either way | nothing |

`unknown` is not a default. It means *we asked and the vendor does not
publish it* — X's `/2/media/analytics` historical window is the live example —
and it carries the owner and the question.

`DataWindow.anchoredOn` matters as much as the number. YouTube's reporting
backfill is 30 days from **job creation**, so it shrinks the longer we wait to
onboard a channel; X's is 30 days from **post creation**, so it is fixed per
post. Those constrain benchmarking differently.

`note` is not optional and is not developer commentary — it is the sentence a
creator reads when they ask why a number is missing. Writing it is part of
adding a matrix entry.

Accessors, which are the whole public API:

- `capabilityFor(family, platform)`
- `platformsWithData(family)` — levels `native | derived`; drives filter
  dimming and replaces the hardcoded platform claim in
  `components/overview/views-card.tsx:38-39`
- `coverageSummary(family, selectedPlatforms)` →
  `{ measured, derived, absent, caveats }` — the one call a card makes

## 5. How it is kept honest

A matrix that drifts from the pipeline is worse than no matrix, because it is
believed. Three layers, in `packages/clickhouse/__tests__/data-provenance.test.ts`:

**(a) Structural.** Every (family, platform) pair has an entry — so adding a
value to `AnalyticsPlatform` fails the suite until the matrix is extended.
Every entry carries all four axes. `derived` requires `method`. `native |
derived` require a non-null `table`. `unsupported` requires `table: null`
**and** `blockedBy: null`. `not_ingested` requires a non-null `blockedBy`.
`review_pending` and `review_denied` require a date. `unknown` availability
requires a named owner and the question to be answered. Every entry has a
non-empty `note`, and a `window` whose `anchoredOn` is set.

**(b) Writer binding — the load-bearing one.** Export

```ts
export const WRITER_CALL_SITES: Record<SourceTable, readonly string[]>;
```

and assert over a repository scan that every listed file still calls that
insert function, **and that no unlisted file calls it**. Today
`video_traffic_sources` lists three files (§1). A new TikTok traffic-source
writer added anywhere in the monorepo then fails CI, and the only way to green
it is to edit the matrix in the same pull request.

This is deliberately not a regex for `platform:` literals, which would break
the day someone passes a variable. It binds to *call sites*, which is the thing
that actually changes when coverage changes.

**(c) Live cross-check.** Extend `packages/clickhouse/scripts/verify-queries.ts`
— already run against a real ClickHouse 24.8 service container on every pull
request by the `clickhouse-sql` job — to assert, per family, that the platforms
actually present in the table are a **subset** of those the matrix marks
`native` or `derived`.

Subset, not equality, deliberately. Every table in a fresh fixture holds
`youtube` or nothing; an equality assertion would fail on any table the fixture
leaves empty, which is most of them. The matrix claims what the pipeline *may*
produce; this catches it producing more than it claims. Closing the other
direction — proving a `native` entry is genuinely populated — needs the
multi-platform fixture from FILM-1701, which is one more reason that spec
sequences first.

`metric_source` already exists on `VideoMetric` (`types.ts:17,44`) with values
`analytics_api | reporting_api | snapshot_delta | backfill`. Reconcile against
it rather than inventing a parallel notion of derivation: a `reporting_api` row
for TikTok means the matrix is wrong.

## 6. Out of scope

- Every visual surface. No chip, no strip, no filter change — FILM-1705.
- Observed coverage, which is per-project and per-window rather than static —
  FILM-1704.
- Ingesting TikTok traffic sources. This spec records that we don't; building
  it is its own spec, and `blockedBy` is where its id goes.
- Facebook, Twitter and LinkedIn. `AnalyticsPlatform` is a three-value union
  and the ClickHouse column is a three-value `Enum`; the wider `CHECK` on
  `platform_connections` is a known inconsistency, recorded in the phase README
  and settled in FILM-1705.

## 7. Acceptance criteria

- [ ] The module imports nothing but types, and a client component can import it without pulling in the ClickHouse driver
- [ ] Every metric family has an entry for every value of `AnalyticsPlatform`
- [ ] Adding a platform to `AnalyticsPlatform` fails the test suite until the matrix is extended
- [ ] `unsupported` and `not_ingested` are distinguishable by a consumer, and every `not_ingested` entry names what blocks it
- [ ] Every non-`native` entry carries a sentence written for a creator, not for a developer
- [ ] Adding a writer for a table in an unlisted file fails CI
- [ ] Removing a writer from a listed file fails CI
- [ ] The live check reports any platform present in a table but marked `unsupported` or `not_ingested`
- [ ] The declared derivation for a platform is consistent with the `metric_source` values actually observed for it
- [ ] No consumer restates a platform list that the matrix could have told it
- [ ] Every entry carries capability, access, availability and window
- [ ] `scope_missing`, `review_required` and `account_type_gated` are distinguishable, because they have different owners
- [ ] `unknown` availability is never a default and always names its owner and question
- [ ] `DataWindow.anchoredOn` is explicit, so a job-creation-anchored window is not confused with a publish-anchored one
- [ ] Every entry traces to a cited row in FILM-1721
- [ ] A metric name absent from FILM-1721 cannot be added to the matrix

## 8. Verification

```bash
pnpm --filter @kit/clickhouse test
./scripts/local-env.sh verify
pnpm turbo typecheck --force && pnpm lint
```

Mutation-test the guard rather than trusting it — the suite is the deliverable:

- add a fake `insertVideoTrafficSources` call in an unlisted file; test (b) must fail
- flip `traffic_sources × tiktok` to `native`; test (c) must fail once the fixture has TikTok rows
- drop a `note`; test (a) must fail
- add a platform to `AnalyticsPlatform`; test (a) must fail

A guard that has never been seen failing has not been verified.

## 9. Risk

The real risk is the matrix quietly becoming decoration — accurate on the day
it is written and wrong six months later. Test (b) is the entire mitigation,
and it only works while the matrix stays in code. If it is ever moved into the
database or made account-overridable, test (b) dies and the module loses its
reason to exist. That is the same argument `traffic-groups.ts` makes for itself
in its own header, and it should be treated as a locked decision.

The lesser risk is over-modelling: roughly eleven families times three
platforms is thirty-three entries, most of them `unsupported` with similar
copy. That is acceptable. Resist collapsing them with clever defaults — the
repetition is what makes each claim individually reviewable.
