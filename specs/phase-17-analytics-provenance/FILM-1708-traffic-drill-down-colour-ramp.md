---
spec_id: FILM-1708
title: Traffic Source Drill-Down and the Colour Ramp
status: DRAFT
effort: M
dependencies: FILM-1605, FILM-1706
---

# Traffic Source Drill-Down and the Colour Ramp

## 1. Overview

Two things the "Where views came from" card cannot currently do, both of which
the data already supports.

**It cannot show what a group is made of.** *Browse + Suggested = 52%* is the
headline number of the whole Deep Dive tab, and nothing on screen says it means
`RELATED_VIDEO + SUBSCRIBER + NOTIFICATION`. A creator who wants to know whether
that 52% is the recommender or their own subscribers cannot find out.

**It cannot reliably show eight groups apart.** `TRAFFIC_SOURCE_GROUPS` has
eight members; the colour map (`traffic-share-card.tsx:221-230`) gives five
distinct hues and then three variations of grey.

## 2. The drill-down is already paid for

The raw source is stored — `video_traffic_sources.source` — and
`queryTrafficSourceRows` (`queries-advanced.ts:403`) already returns per-source
rows. It is private; `queryTrafficSourceBreakdown` folds it through
`groupTrafficRows` and discards the detail.

`sourcesInGroup(group)` (`lib/traffic-groups.ts:115`) already inverts the
taxonomy. Its docblock records that review argued twice about whether it should
exist — once to export it, once to drop it as a dead export — and that it was
kept because the alternative is asserting group membership against a
module-private constant. **This spec is its first production consumer**, which
settles that argument on the evidence.

Carry the native sources *inside* each group in the breakdown response rather
than adding a second query. This is the same reasoning FILM-1605 used when it
derived the Browse+Suggested trend from the breakdown response instead of
issuing a byte-identical second query: one scan, one denominator, no way for
the parts to disagree with the whole.

Rendered in FILM-1706's disclosure, under "Where this comes from": the group's
member codes as `Badge variant="secondary"` chips with their individual shares,
summing to the group.

Two correctness points the implementation must respect:

- **Unknown codes are real.** `csv-parsers.ts:233-235` stores `TS_<code>` for
  any code it does not recognise, and `groupForSource` falls back to `other`.
  The drill-down must show `TS_44` rather than hiding it, because hiding it
  makes `other` unexplainable.
- **The list is per-window, not the taxonomy.** Showing all three members of
  `browse_suggested` when only two occurred in the window invites the reader to
  conclude the third was zero. Show what occurred, with the group's own total.

## 3. The ramp is worse than "five hues"

`--chart-1` through `--chart-5` are defined **twice with different values** in
`apps/web/styles/shadcn-ui.css`:

- `:60-64` — `orange-400`, `teal-600`, `green-800`, `yellow-200`, `orange-200`
- `:137-141` and `:207-211` — `oklch(65% 0.2 250)`, `oklch(70% 0.18 165)`,
  `oklch(70% 0.18 35)`, `oklch(65% 0.2 300)`, `oklch(70% 0.2 340)`

The first set is not a ramp: `chart-1` and `chart-5` are both orange, and
`chart-4` at `yellow-200` is close to invisible on a light card. The second is
coherent — lightness-matched at 65–70%, hues spread.

The remaining three groups are not hues at all:

```
channel_page: 'bg-primary/40'
direct:       'bg-muted-foreground/40'
other:        'bg-muted-foreground'
```

`direct` and `other` differ **only in alpha**, which is indistinguishable at
the 2px `MIN_SLICE_PX` floor that FILM-1605 spent three review rounds
establishing. And `channel_page` at 40% of `--primary` can collide with
`chart-1` whenever the theme's primary is blue.

### The fix

1. **De-duplicate.** Determine which selector actually wins in the shipped
   themes before deleting either block — do not assume. Make the oklch set
   canonical.
2. **Extend to eight** on the same formula: fixed L ≈ 68%, C ≈ 0.19, hues
   roughly 45° apart, adding `--chart-6/7/8`.
3. **Assign by semantics, not by index.** The four groups a reader compares —
   `browse_suggested`, `search`, `shorts_feed`, `external` — take the four
   most-separated hues. `playlists` and `channel_page` take adjacent but
   distinct ones. `direct` and `other` become neutrals separated by
   **lightness, not alpha**.
4. Consider a hatch or pattern for `other`, so it reads as a residual rather
   than as an eighth peer category. It is the bucket for everything
   unrecognised and should not look like a finding.

Note `bg-chart-*` resolves only through `apps/web/styles/theme.css:50-54`, the
consuming app's stylesheet — a component in `packages/ui` using those classes
would break. The ramp must live where analytics can see it.

## 4. Chart tooltips

Hover detail on bars and slices is native `title=` attributes throughout —
`traffic-share-card.tsx:173-177,415-419,439-445`, `median-views-card.tsx:94`,
`back-catalog-card.tsx:67`. Unstyled, ~1s delay, invisible to keyboard users,
and inconsistent with every other tooltip in the product.

`packages/ui/src/shadcn/chart.tsx` already exists and provides
`ChartContainer` and `ChartTooltip`, and nothing in content-analytics uses it.
Move to it, or to `@kit/ui/tooltip` where a full chart context is unwarranted.

Keep what the `title` currently gets right: FILM-1605 established that a
floored 2px slice must remain hoverable and report its **true** share rather
than its rendered one. That property is load-bearing and must survive the move.

## 5. Out of scope

- Ingesting TikTok or Instagram traffic sources. This card is YouTube-only and
  FILM-1705's chip says so.
- Changing `SOURCE_TO_GROUP`. The taxonomy's locked decisions — `END_SCREEN`
  and `ANNOTATION` in `other`, `HASHTAG_PAGE` not `search`, `ADVERTISING`
  counted — stand, and are asserted by existing tests.
- Reconciling the YouTube **Analytics** API vocabulary
  (`BROWSE_FEATURES`, `EXT_URL`) with the **Reporting** API vocabulary that
  `SOURCE_TO_GROUP` uses. Only the reporting path writes today; see the phase
  README.
- The `charts/` primitives used by other tabs.

## 6. Acceptance criteria

- [ ] A traffic group expands to the native source codes observed in the window
- [ ] Those codes' shares sum to the group's share
- [ ] An unrecognised `TS_*` code is shown rather than hidden
- [ ] The drill-down issues no additional query
- [ ] `sourcesInGroup` has a production consumer
- [ ] `--chart-1..5` has exactly one definition
- [ ] All eight groups are distinguishable from each other, including at the 2px minimum slice height
- [ ] `direct` and `other` differ by more than alpha
- [ ] The ramp is checked for colour-blind separability, not only for looking different to the author
- [ ] Chart hover detail is keyboard-reachable and styled consistently with the rest of the product
- [ ] A floored minimum-height slice still reports its true share on hover

## 7. Verification

```bash
pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
./scripts/local-env.sh verify
pnpm turbo typecheck --force && pnpm lint
```

The `dataviz` skill documents a palette-validation method including colour-blind
simulation; use it for §3 rather than judging by eye.

Visual pass in Chrome, measured in the DOM as the FILM-1605 pass was: expand a
group and assert its member shares sum to the group's; sample the eight
rendered colours and assert pairwise distinguishability; confirm the 2px slice
is focusable and its reported share is the unrounded one.

## 8. Risk

Changing the colours changes charts people have learned to read, and the
Browse+Suggested series in particular is the tab's headline. Worth doing in one
move rather than drifting, and worth showing before and after side by side in
the pull request.

The `--chart-N` de-duplication reaches beyond analytics — those tokens are used
by any chart in the product. Establishing which definition currently wins, and
checking the other consumers, is the first task of this spec and not an
afterthought.
