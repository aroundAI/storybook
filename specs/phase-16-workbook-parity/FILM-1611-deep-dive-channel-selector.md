---
spec_id: FILM-1611
title: Deep Dive Channel Selector & Orphan Wiring
status: ✅ DONE
effort: M
dependencies: FILM-1606, FILM-1608, FILM-1609
---

# Deep Dive Channel Selector & Orphan Wiring

## 1. Overview

FILM-1602 made channel a first-class dimension: `video_dim.connection_id`,
`DimScope.connectionId`, `buildDimConditions`, `assertScopeAccess`
verification, `listProjectChannels` / `listAccountChannels`, and a
per-channel `getYppProgressAction`. All of it works. **None of it is
reachable from the UI.**

`ScopeSchema` (`lib/schemas/traffic.schema.ts:28-41`) accepts `connectionId`,
`platform`, `contentType` and `language`. A search across `apps/` and
`packages/` finds no route and no component that passes any of the four.
`DeepDiveTab` (`components/deep-dive/deep-dive-tab.tsx:62`) takes
`{ projectId }` and builds `scope = { projectId }` at `:67`. There is no
channel selector anywhere in the analytics UI — the only `ChannelPicker` in
the repo belongs to the YouTube connect flow and is unrelated.

Three finished components are in the same state — exported, complete, and
rendered nowhere. Each already has an action whose return type matches its
props, so each needs a mount point and nothing else:

| component | its data |
|---|---|
| `YppProgressCard` (`deep-dive/ypp-progress-card.tsx:58`) | `getYppProgressAction` returns an array whose element type **already matches** its `progress` prop exactly |
| `TagMediansCard` (`taxonomy/tag-medians-card.tsx:64`) | `getMedianByTagAction` returns its rows *and* its gate fields |
| `RevenueMixCard` (`revenue-mix-card.tsx:32`) | `RevenueSummary.byType`, computed on every summary |

**Five components are orphaned in total, not three.** The phase README
originally counted `RetentionCurveChart`, `WeeklyDiagnosticsTable` and
`YppProgressCard`. Only the last of those three is in the table above; the
other two need actions built and are FILM-1616. The two the README missed —
`TagMediansCard` and `RevenueMixCard` — are both mountable now and are
therefore here instead. `RevenueMixCard` is the one that matters most: it
is the only *display* path for revenue categories (the labels and colours
themselves live in `lib/revenue-mix.ts`), so adding a category (FILM-1609)
still shows nobody anything until it renders.

This spec is **pure wiring**. Every action it needs already exists; none of
it adds a query. The two orphans that need a data path built are FILM-1616.

## 2. Conventions Fixed Here

- **Channel is a filter, not a scope.** `assertDimScope` requires
  `projectId || accountId` and rejects a bare `connectionId`. The selector
  therefore *narrows* the current project or account scope and can never
  replace it — "All channels" is the absence of the filter, not a special
  value. An implementer who makes the selector the scope breaks the tenant
  boundary the guard provides.
- **"All channels" is the default and must stay selectable.** Every number
  on the tab today is an all-channel number; defaulting to the first
  channel would silently change every figure on first render, and users
  would read it as data loss.
- **The selector state does not survive as a URL scope.** It is a view
  filter. Persisting it into the route makes a shared link show someone
  else's channel selection over data they may not have, and
  `assertScopeAccess` would then reject rather than degrade.
- **Per-channel cards render one card per channel, not a summed card.**
  `getYppProgressAction` returns an array precisely because pooling watch
  hours against one 4,000-hour target reports a threshold as met when no
  channel has met it (FILM-1602). Mapping the array is the whole point; a
  `reduce` here would undo the phase's most-argued fix.

## 3. Implementation Map

| File | Change |
|------|--------|
| `packages/features/content-analytics/src/server/channels-actions.ts` | New. `listChannelsAction({ projectId? , accountId? })` wrapping `listProjectChannels` / `listAccountChannels` (`channels.ts:48`, `:105`). Those are plain exported functions in a module with no `'use server'`, so a client component cannot call them — this wrapper is the missing link, not a redundancy. `assertScopeAccess` first, as every action in this package does. |
| `packages/features/content-analytics/src/components/deep-dive/channel-filter.tsx` | New client component over `ChannelRef` (`channels.ts:13`), rendering `thumbnailUrl` and `name`, with an explicit "All channels" option as the default. Inactive channels are shown but marked — a disconnected channel still owns historical data, and hiding it makes past figures unexplainable. |
| `packages/features/content-analytics/src/components/deep-dive/deep-dive-tab.tsx` | Props gain `accountId` (`:27-30`). One state object holds `{ connectionId, contentType, language }` — not three `useState` calls. The filter is merged into `scope` at `:45` and passed to all four existing cards, which already accept the wider scope through their actions. |
| ↑ | Mount `YppProgressCard`, one per entry of `getYppProgressAction`. The action takes `{ accountId, connectionId?, windowDays }` — **not `ScopeSchema`** — so it is called with the account id and the selected channel, not with the scope object the other four cards use. That asymmetry is real; a wrapper that forces it into `ScopeSchema` shape would have to invent an account id from a project. |
| `apps/web/app/home/[account]/studio/[projectSlug]/analytics/page.tsx` | Pass the resolved account **id** down alongside `projectId`. The page already resolves the project (`:44`); it must resolve the account id too rather than forwarding the slug. |
| `apps/web/app/home/[account]/studio/analytics/tags/page.tsx` | Mount `TagMediansCard` beside `TagManager`, with a dimension switcher over the four taxonomy dimensions **plus Language**, which is not a taxonomy dimension at all but a `video_dim` column — the distinction FILM-1606 exists to preserve. The Language option routes to the segment action, not the tag action. |
| `packages/features/content-analytics/src/components/revenue-dashboard.tsx` | Mount `RevenueMixCard` over `RevenueSummary.byType`, giving revenue categories their first display path. |
| `packages/features/content-analytics/src/components/analytics-dashboard.tsx` | Fix `:471`, which passes `accountId={accountSlug}` — a slug into a prop named for an id. Harmless only as long as nothing downstream uses it as a uuid; `assertScopeAccess` looks accounts up with `.eq('id', ...)`, so a slug matches nothing and would reject every caller the day it is used. FILM-1607's Implementation Map records the same trap for `getSubscriberSeriesAction`, where an earlier draft's `accountSlug` would have made the guard reject every caller — or invited an implementer to drop the guard because the shapes did not line up. |

## 4. What This Spec Does Not Wire

Two orphans are deliberately left alone, because neither has a data path:

- **`WeeklyDiagnosticsTable`** — there is no `getWeeklyDiagnosticsAction`
  anywhere. It needs recent publishes joined to quality metrics and a
  per-video retention curve.
- **`RetentionCurveChart`** — `queryRetentionCurve` (`queries-detail.ts:55`)
  carries **no tenant predicate at all**, so an action for it needs an
  explicit ownership check before it can exist.

Both are FILM-1616. Mounting them here with a stub would put an empty card
on screen and lose the reason it is empty.

## 5. Out of Scope

- **The Video Log table and its tab** — FILM-1615.
- **The subscriber series card and the Publish Hub badge** — FILM-1617.
- **Account-level deep dive.** Deep Dive is project-only today
  (`analytics/page.tsx` renders `RevenueDashboard` alone). Adding an
  account-wide deep-dive surface means account-scale queries and an
  enforced `publishedFrom`; it is a separate decision, recorded as an open
  question in the phase plan.
- **New queries or actions of any kind**, except the `listChannelsAction`
  wrapper in §3 — if this spec grows a query, it has stopped being wiring.

## 6. Acceptance Criteria

- [x] A channel selector appears on the Deep Dive tab and defaults to "All channels"
- [x] Selecting a channel passes `connectionId` into every deep-dive action on the tab
- [x] "All channels" omits `connectionId` entirely rather than sending a sentinel value
- [x] Every figure on the tab is unchanged from today when "All channels" is selected
- [x] Inactive channels appear in the selector and are marked as inactive
- [x] `YppProgressCard` renders once per YouTube channel, never as a pooled total
- [x] `TagMediansCard` renders on the tags page with a dimension switcher including Language
- [x] The Language option calls the segment action, not the tag action
- [x] `RevenueMixCard` renders, and every revenue category resolves to a label and a colour
- [x] `ExportReports` receives an account id, not a slug
- [x] `DeepDiveTab` holds its filter state in a single state object
- [x] No new ClickHouse query is added by this spec
- [x] Loading states are rendered for every newly mounted card

## 7. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm typecheck && pnpm lint
```

Then run the app and open a project's Deep Dive tab. This is the first spec
in the phase whose result is **visible**, and also the one where a green
suite proves least: `CLICKHOUSE_ENABLED=false`, so every newly mounted card
renders its empty state. What can be confirmed by looking is that the cards
mount, the selector filters, the scope reaches the actions, and nothing
throws — which is exactly what has never been true for these components
before.

The regression that matters is the "All channels" criterion above: the four
already-rendered cards must show the same numbers after this change as
before it.

## 8. As built

Checked against `main` before implementation; these corrections and
decisions differ from the text above.

**Corrections to the spec.**
- `DeepDiveTab` rendered **five** cards from four queries, and every query
  key used `projectId` alone. Without adding the channel to the keys a filter
  change would have served the all-channel cache entry and refetched nothing.
- `getYppProgressAction` **throws** for a `connectionId` that is not an active
  YouTube channel. The tab skips the query for any other selection and says
  why ("Partner Programme progress applies to active YouTube channels").
- The page does not render `DeepDiveTab` directly: the chain is
  `analytics/page.tsx` → `LazyAnalyticsDashboard` → `AnalyticsDashboard` →
  `DeepDiveTab`, so the account id is threaded through the dashboard.
- **The `ExportReports` slug bug was live, not latent.** Every report schema
  requires a uuid, so report generation and the scheduled-reports read failed
  validation on this page — silently, since the failure only reached the
  console.

**Deviations and decisions.**
- `DeepDiveFilters` is `{ connectionId? }`, not `{ connectionId, contentType,
  language }`: only channel has a control, and declaring the other two would be
  state nothing sets. It is still one object, so the next filter is a field.
- "All channels" builds the YPP call **without** the key. Passing
  `connectionId: undefined` serializes as `$undefined` in a server action call,
  which the e2e spec caught on the request body.
- Language on the tags page uses the account's `tag_min_sample` as `minVideos`
  (resolved on the server), so every option on the switcher applies the same
  cut-off; the segment action's own default is 5. Both paths use a 30-day
  checkpoint. `TagMediansCard` gained `segmentNoun` so Language is not
  described as a tag.
- Included, beyond the map: the project analytics page now looks the project
  up by slug **and** account. Slugs are unique per account, so a user in two
  teams sharing a slug got a 404 under both URLs. The other eleven
  `[projectSlug]` pages still look up by slug alone — see the phase README.
- Included from the FILM-1608 review: a future `joined_ypp_at` no longer counts
  as joined (resolver, schema and date input), since this spec is the first to
  render `YppProgressCard`.

**From the PR #260 review.**
- **One tag minimum-sample cap.** The segment action refuses a `minVideos`
  above 1000 while the setting allowed any positive integer, so Language
  failed for a high setting. `MAX_TAG_MIN_SAMPLE` is now used by the settings
  schema, the segment action and `resolveTagMinSample`, which clamps rows
  saved before the cap.
- **One joined-date bound.** `latestJoinDate()` (tomorrow in UTC) is both the
  latest date the form accepts and the cutoff `resolveYppTarget` counts as
  joined (`joinedCutoff`), so a date a user ahead of UTC enters counts at once.
- **YPP cards are the project's channels.** The action stays per account; the
  tab narrows its answer to the channels the filter lists.

**Verification.** `apps/e2e/tests/deep-dive/deep-dive.spec.ts`,
`tests/tags/tag-medians.spec.ts`, and additions to the revenue and
analytics-settings specs. With ClickHouse off, the filter is asserted on the
server action request bodies. Every guard was seen to fail with its change
reverted. Screenshots: `deep-dive-evidence.spec.ts` (`CAPTURE_EVIDENCE=1`).
