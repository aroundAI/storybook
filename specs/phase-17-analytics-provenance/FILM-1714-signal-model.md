---
spec_id: FILM-1714
title: The Signal Model
status: DRAFT
effort: M
dependencies: FILM-1703, FILM-1713, FILM-1716; FILM-1712 for the Instagram bindings
---

# The Signal Model

## 1. Overview

There is no universal engagement rate. Each platform defines a valuable viewer
differently, so each weights the funnel differently — but the **funnel itself
is universal**. That asymmetry is what lets one interface serve five platforms
without pretending they measure the same thing.

| Stage | Question |
|---|---|
| Reach | Did the platform show it? |
| Hook | Did they stop or click? |
| Attention | Did they keep watching? |
| Transmission | Did they pass it on? |
| Audience | Did they come back or follow? |

Stages are platform-independent and never change. Which metric fills a stage is
per platform and per format, and that mapping is the whole of this spec.

## 2. A stage may be unbound, and often should be

Five stages is a vocabulary, not a quota.

Reach is clean on YouTube long-form — impressions, then CTR. On a feed-based
Short it has no honest equivalent: `stayed-to-watch` is not exposed to us at
all, and there is no impression count. Forcing an approximate metric into the
stage so every platform shows five filled boxes is the failure this spec exists
to prevent.

```
Stage  = Reach
status = unbound
reason = platform_does_not_expose_an_impression_equivalent
```

**Four honest stages beat five with one invented.** Use `unbound`
aggressively.

An unbound stage and a dark stage are different facts:

- **unbound** — permanent, platform-shaped. "Instagram exposes no impression
  equivalent."
- **dark** — bound to a signal whose inputs are `not_ingested`. A ticket.

Same emptiness on screen, different sentence, and only one belongs in a
backlog. Collapsing them makes the ingestion gap invisible, which is precisely
what FILM-1703's `not_ingested` level exists to prevent.

## 3. A stage is not one metric

```
Stage
 ├── primary       the canonical diagnostic for this platform × format
 ├── supporting[]  what explains the primary
 └── unavailable[] named, so the gap stays visible
```

Examples, from the research and from what we can actually compute:

| Platform × format × stage | Primary | Supporting |
|---|---|---|
| YouTube long · Hook | impressions CTR | first-30s retention |
| YouTube long · Attention | average view duration | average % viewed, retention curve |
| TikTok short · Attention | average watch time | `full_video_watched_rate` |
| Instagram short · Transmission | shares per reach | saves per reach, comments per reach, **reposts per reach** |
| Instagram short · Attention | `ig_reels_avg_watch_time` | **`reels_skip_rate`** |

Treating signals as interchangeable loses the thing that makes a stage
diagnosable: the primary says *whether* the stage is weak, the supporting
signals say *why*.

**Corrected 2026-09-21 against the capability reference.** The Instagram
Attention row previously read `average watch time` / `average % viewed`. Both
halves were wrong in opposite directions, which is why it is worth writing down:

- The **primary is real and better-named**. `ig_reels_avg_watch_time` is
  documented for REELS. It is simply never requested
  (`instagram-insights.ts`), so FILM-1712 must land before this binds. Its
  **unit is inferred to be milliseconds** and must be confirmed before a figure
  is shown — a 1000× error here is silent and plausible-looking.
- The **supporting signal does not exist**. Instagram has no completion rate and
  no retention graph, so "average % viewed" cannot be computed for it.
  `reels_skip_rate` — "the percentage of views from people who skipped during
  the first 3 seconds" — is the real supporting signal, and it is arguably a
  *Hook* signal being borrowed by Attention. Worth deciding deliberately rather
  than by default.

Transmission gains `reposts_count` (Media node, FEED and REELS, added
2026-04-22) — the first media-level pass-it-on signal Instagram has offered,
which is precisely what this stage asks for. It is subject to FILM-1712.

## 4. Support is computed, never authored

A signal has no storage, so it can never fill FILM-1703's `PlatformCapability`
shape — which requires a `SourceTable`. **The signal layer therefore authors no
capabilities.** It declares its inputs and inherits:

```ts
interface SignalDefinition {
  id: SignalId;
  stage: FunnelStage;
  inputs: readonly MetricFamily[];   // non-empty
  composition: 'measured' | 'ratio' | 'interpolated';
  definition: string;                // creator-facing, per FILM-1703's note discipline
}
```

Support is the weakest input, computed at read time. Nothing is added to
`CAPABILITY_MATRIX`; its invariants and its four levels stay untouched, and
there is no fifth level and no nullable table.

**Keep the full input list, not just the minimum.** A two-input signal whose
minimum is `derived` needs to say *which half* is soft — "views per follower"
reading a native engagement family and an account-level channel family is not
usefully summarised by one word.

**`composition` is not `SupportLevel.derived`.** FILM-1703's `derived` means
*snapshot-delta ingestion*. A share rate is arithmetically derived and, on
YouTube, `native` — both inputs are natively ingested. These axes are
orthogonal and conflating them is the most likely way this layer corrupts the
existing vocabulary.

`SUPPORT_ORDER` must be written down in `data-provenance.ts` with an argument:
FILM-1703 defines four levels and no total order, so "weakest" is undefined
until someone states it. The placement of `not_ingested` relative to
`unsupported` is a product call — both yield no number, only one is buildable —
and belongs in a comment, not in an implementation detail.

## 5. Expandability

Adding a platform must be adding data.

```ts
type PublishFormat = /* FILM-1716's format families */;
type StageBinding =
  | { primary: SignalId; supporting: readonly SignalId[] }
  | { primary: null; note: string };   // note required exactly when unbound

const SIGNAL_MAP:
  Record<AnalyticsPlatform, Record<PublishFormat, Record<FunnelStage, StageBinding>>>;
```

Format lives in the same table as an inner key rather than a second table —
two tables means two structural tests and a join at every read. Signal
*definitions* stay platform-agnostic; only the *map* is per-platform. That is
what keeps growth linear when Snap or Threads arrives.

### The test that enforces it

`packages/clickhouse/__tests__/signal-map.test.ts`:

1. An entry exists for every platform × format × stage. Adding a platform fails
   here **and** in `data-provenance.test.ts` — failing two suites is the signal
   that the platform union is the seam.
2. Every unbound binding carries a non-empty note; every referenced `SignalId`
   exists.
3. Every `inputs` is non-empty and every member is in `METRIC_FAMILIES`, so
   deleting a family from FILM-1703 fails here.
4. **Load-bearing:** a stage may be bound to a `not_ingested` signal — that is
   the dark-but-buildable state that keeps the backlog visible — but **binding
   to an `unsupported` input is rejected**. The matrix says what is possible;
   the map may not claim more.
5. **Reverse coverage:** every family `native` on some platform is an input to
   at least one signal, or is in an explicit allowlist with a reason. Otherwise
   newly-ingested data reaches no stage and nobody notices.

## 6. Out of scope

- Benchmarking a signal against anything — FILM-1715.
- The format family vocabulary — FILM-1716, which this consumes.
- Reading patterns across stages — FILM-1718.
- Rendering — FILM-1719.

## 7. Acceptance criteria

- [ ] Stages are platform-independent and defined in one place
- [ ] A stage can be unbound with a named reason, and unbound is distinguishable from dark
- [ ] A stage carries a primary signal, supporting signals, and named unavailable ones
- [ ] A signal declares its input families and its support is computed, not authored
- [ ] No entry is added to `CAPABILITY_MATRIX` by this spec
- [ ] The full input list survives to the consumer, not only the weakest level
- [ ] Arithmetic composition is a separate axis from ingestion support level
- [ ] `SUPPORT_ORDER` is explicit and its ordering argued in a comment
- [ ] Adding a platform fails two test suites until both the matrix and the map are extended
- [ ] Binding a stage to an `unsupported` input fails the test
- [ ] Binding to a `not_ingested` input is allowed, and surfaces as dark with its blocker
- [ ] Every `native` family feeds at least one signal or is allowlisted with a reason
- [ ] Instagram Attention binds `ig_reels_avg_watch_time` as primary and `reels_skip_rate` as supporting; no Instagram binding uses "average % viewed", which Instagram does not report
- [ ] Instagram Transmission includes reposts per reach, from `reposts_count`
- [ ] Until FILM-1712 requests those fields, both Instagram bindings render dark with FILM-1712 named as the blocker — never as a zero
- [ ] Instagram watch time is not shown until its unit (milliseconds, inferred) is confirmed against a live response

## 8. Verification

```bash
pnpm --filter @kit/clickhouse test
pnpm turbo typecheck --force && pnpm lint
```

Pure module, no database. Mutation-test the guards rather than trusting them —
the tests are the deliverable:

- add a platform to `AnalyticsPlatform`; both suites must fail
- bind a stage to an `unsupported` input; the map test must fail
- drop a note from an unbound stage; the test must fail
- remove a family from `METRIC_FAMILIES` that a signal uses; the test must fail
- make a `native` family feed no signal; the reverse-coverage test must fail

A guard that has never been seen failing has not been verified.

## 9. Risk

The vocabulary is the fragile thing. Four support levels, a separate
composition axis, unbound versus dark, primary versus supporting — each
distinction earns its keep, and each is one careless rename away from
collapsing into the others. The tests in §5 are what hold them apart; the
comments arguing each distinction are what stop someone "simplifying" them.

The second risk is the map becoming decorative — accurate when written, stale
later. Rule 4 is the mitigation: the map cannot claim support the matrix does
not grant, and the matrix is itself bound to the writer call sites by
FILM-1703.
