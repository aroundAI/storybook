---
spec_id: FILM-1706
title: Analytics Card Shell v2
status: DRAFT
effort: M
dependencies: FILM-1703
---

# Analytics Card Shell v2

## 1. Overview

`components/overview/analytics-card.tsx` is the shared shell for roughly
fourteen card files across the Overview and Deep Dive tabs. It is the leverage
point for everything visual in this phase, and it has three problems.

**It is off the design system.** The shell is written in raw Tailwind palette
classes with hand-written dark variants — `bg-white dark:bg-gray-900
border-gray-200 dark:border-gray-800` (`:51`), `text-gray-400` (`:62`),
`text-gray-500 dark:text-gray-400` (`:66,:107`) — while every card *body*
rendered inside it uses semantic tokens (`text-muted-foreground`,
`bg-primary/70`, `bg-chart-*`). `packages/ui/CLAUDE.md:296-310` names exactly
this pattern as the anti-pattern, quoting `bg-white text-black border-gray-200`.
So the shell is off-system and its contents are on-system.

**Its default height is wrong.** The root is `flex h-64 flex-col` (`:55`), and
every Deep Dive caller overrides it with `className={'h-auto'}`
(`deep-dive-tab.tsx:238,279,…`). A default that every caller in one of its two
consumers escapes is not a default.

**It has nowhere to put depth.** Everything a card wants to say beyond its
number goes into one `text-xs` footnote, which is why
`traffic-share-card.tsx:190-198` branches four ways to build a sentence and
`:454-459` carries a three-line methodological caveat in small grey type.
FILM-1705 adds a coverage caveat on top of that. Without somewhere to put it,
the provenance work makes the page worse.

## 2. The design principle

**One claim per card, evidence one gesture away.**

Not less information — the same information, ranked, with the lower ranks off
the critical path. The density people admire in Apple's interfaces comes from
hierarchy and restraint, not from emptiness; the current cards are simultaneously
sparse (one number) and cluttered (a paragraph of grey caveats under it).

Four zones, in fixed order so the pattern is learnable across all fourteen
cards:

1. **Eyebrow** — the title in `text-muted-foreground text-sm font-medium`, with
   the FILM-1705 provenance chip right-aligned.
2. **The claim** — one figure, `text-2xl font-semibold tracking-tight
   tabular-nums`, and **one sentence** under it in plain language. That sentence
   is what most of these cards are actually missing; several currently make the
   reader infer the point from the chart.
3. **The evidence** — the chart, unchanged, no longer carrying the explanation.
4. **The disclosure** — one low-contrast "Details" trigger, bottom-left.

`tabular-nums` matters more than it sounds: these figures update on refetch and
proportional digits make them jump.

## 3. Why `collapsible`

`@kit/ui/collapsible` (`packages/ui/src/shadcn/collapsible.tsx`), not the
alternatives:

- **Not accordion** — implies a set of siblings where opening one closes
  another. These cards are independent.
- **Not popover or dialog** — a modal for a footnote outweighs the footnote,
  and it puts the explanation somewhere you cannot read it beside the number it
  explains.
- **Not hover-card** — `@kit/ui` has none, and hover is unreachable on touch
  and by keyboard.

Collapsible expands in place, is keyboard-operable, and keeps its content in
the DOM so browser find and copy-paste reach it. Tooltip content does not.

The existing `Info` tooltip (`analytics-card.tsx:77-93`) stays, but only for
genuine one-liners. Two competing explanation channels on one card is the
current confusion; the rule is that anything longer than a sentence moves into
the disclosure.

## 4. The expanded region

Fixed order, so it is learnable:

- **Breakdown** — a `<dl>`, figures right-aligned and `tabular-nums`.
- **Where this comes from** — the source table and, for traffic, the native
  source codes.
- **How it's computed** — one sentence, from `capabilityFor().method`.
- **Caveats** — a `<Separator />` then the existing
  `text-muted-foreground text-xs` idiom, which is the right treatment once it
  is no longer on the front of the card.

`LATEST_BUCKET_CAVEAT` (`traffic-share-card.tsx:58-59`) is the existing
named-constant idiom for a reusable caveat and should become an entry in the
matrix's caveat registry rather than a card-local constant.

## 5. Other concrete changes to the shell

**Delete `variant="gradient"`.** `from-indigo-50 to-purple-50
dark:from-indigo-950/30 dark:to-purple-950/30` (`:50`) is the most templated
element on the page and it is doing badge duty — marking a card as special by
painting it. Emphasis via `ring-1 ring-border` and a larger figure.

**Tokens.** `bg-white dark:bg-gray-900 border-gray-200` → `bg-card
text-card-foreground border-border`. Keep `rounded-2xl`, which is the one
already-right choice.

**Drop `hover:shadow-md`.** A card that lifts on hover implies it is clickable;
most are not. Reserve a hover affordance (`hover:bg-accent/30`) for cards that
actually have a disclosure.

**Drop `h-64`** and let content size the card, since that is what every Deep
Dive caller already forces.

**Props gained:** `metricFamily: MetricFamily` (required — see FILM-1705 §5)
and an optional `platforms?: AnalyticsPlatform[]` for cards narrower than their
family.

## 6. Out of scope

- The chip's own logic and copy — FILM-1705 owns those; this spec provides the
  slot and renders what it is given.
- The colour ramp for the eight traffic groups — FILM-1708.
- Migrating the Language tab's cards onto this shell — FILM-1707.
- The `charts/` primitives (`donut-chart`, `heatmap-grid`, `sparkline-area`,
  …), which are inside card bodies and unaffected.

## 7. Acceptance criteria

- [ ] No raw Tailwind palette colour remains in the shell; it passes the `packages/ui/CLAUDE.md` dark-mode rule
- [ ] The shell renders correctly in light and dark without hand-written `dark:` colour pairs
- [ ] `metricFamily` is required, so a new card cannot be added without declaring what it shows
- [ ] No caller passes `h-auto` to escape a default height
- [ ] `variant="gradient"` is gone and no card is emphasised by painting it
- [ ] Every card has one figure and one plain-language sentence; none relies on the reader inferring the point from the chart
- [ ] Caveats are reachable in two interactions at most, and are in the DOM for browser find
- [ ] The disclosure is keyboard-operable and announces its state
- [ ] Figures use `tabular-nums` and do not shift width on refetch
- [ ] A card with a disclosure is visually distinguishable from one without, before clicking

## 8. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm turbo typecheck --force && pnpm lint
NEXT_PUBLIC_SITE_URL=https://example.com pnpm --filter web build
```

Visual pass in Chrome, measured in the DOM: assert computed colours resolve
through tokens rather than literals, assert the disclosure's
`aria-expanded` flips, and assert no card's rendered height depends on an
override class.

Check both themes explicitly — the current shell's hand-written dark variants
are exactly the kind of thing that silently regresses when tokens replace them.

## 9. Risk

This is a fourteen-call-site change that lands in the middle of a phase, and
FILM-1611, 1615 and 1617 from Phase 16 all add cards. Making `metricFamily`
required will collide with any of those in flight. Either this spec lands after
they do, or the conflict is budgeted for — that is a sequencing decision to
confirm against what is actually open at the time, and it is the main reason
this phase is scheduled after Phase 16 closes.

The second risk is that "cleaner" is read as "remove the caveats". The caveats
are the product. Moving them behind a disclosure is only an improvement if they
remain complete, reachable and discoverable; a card whose details are empty has
failed this spec, not passed it.
