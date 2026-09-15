---
spec_id: FILM-1609
title: Revenue Mix Completion
status: ✅ DONE
effort: S
dependencies: FILM-1601
---

# Revenue Mix Completion

## 1. Overview

This spec is much smaller than its backlog entry implies, and the reason is
worth stating before the work: **most of it already shipped.**

The original phase plan called for `RevenueSummary` to gain `totalViews`,
`adsRevenueCents`, `nonAdRevenueCents`, `adsSharePercent`,
`nonAdSharePercent`, `adsRpmCents` and `allInRpmCents`, so that the
workbook's Revenue sheet becomes direct field reads. Every one of those
fields is on the type today (`lib/types/revenue.ts:45-72`), computed in
`getRevenueSummaryAction`, with `rpm` retained as an alias of
`allInRpmCents` for back-compat and the RPM denominator already fixed by
FILM-1601 to count every published video rather than only revenue-bearing
ones.

Two things are actually missing.

**There is no `licensing` category.** The CHECK constraint permits
`ads, premium, sponsorship, product, affiliate, other`
(`schemas/38-revenue-tracking.sql:28-29`). The doc comment on
`nonAdRevenueCents` already reads *"sponsorship, product, licensing…"* — the
category was anticipated in prose and never added to the vocabulary. Today
licensing income is recorded as `other`, where it is indistinguishable from
everything else uncategorised.

**No category has a display path at all.** The labels and the colours for
all six exist in exactly one place — `components/revenue-mix-card.tsx:14-31`
— inside a component that is exported and **rendered nowhere**. So
`byType` is computed on every summary and shown to no one.

## 2. Why a Seventh Category and Not a Free-Text Field

`category` is a closed vocabulary enforced by a CHECK constraint, a zod
enum and a unique index that includes it
(`idx_revenue_records_unique_scope on (coalesce(publish_id, account_id), record_date, category)`).
Loosening it to free text would let two spellings of the same category
occupy two rows for one day and one scope, defeating that index silently —
the mix chart would show "Licensing" and "licensing" as separate wedges.

Licensing/IP revenue has no API on any platform and is manual entry
permanently (phase README, known limits). That makes it exactly the kind of
value a human types into a dropdown, which is an argument for adding it to
the vocabulary, not for removing the vocabulary.

## 3. Colour Allocation

Seven categories, and the design system exposes **five** `bg-chart-*`
tokens. The current map spends all five plus `bg-muted-foreground` for
`other` (`revenue-mix-card.tsx:14-31`).

Choose deliberately rather than collide. The rule this spec fixes:

- **`other` keeps `bg-muted-foreground`.** It is the residual, and it
  should not read as a first-class category.
- **`ads` and `premium` keep `bg-chart-1` and `bg-chart-2`.** They are the
  platform-payout pair that `adsRevenueCents` sums
  (`revenue-actions.ts:123`), and they are the two most people will see.
- **`licensing` shares a token with the category it is most distant from on
  screen**, at a different opacity, rather than taking a token from
  `sponsorship`, `product` or `affiliate` — the three the mix chart exists
  to separate.

An implementer who instead adds a sixth `bg-chart-6` should check it exists
in the theme first; a token that does not resolve renders transparent, and
a transparent wedge in a stacked bar reads as missing revenue rather than
as a styling bug.

### Corrected during implementation: a sixth token, not a shared one

**The opacity-sharing rule above rests on an assumption that does not
hold.** It reasons from where categories sit relative to each other on
screen — but `RevenueMixCard` sorts wedges by value descending
(`revenue-mix-card.tsx:53-55`), so adjacency is data-dependent and the two
sharing a hue can land side by side, reading as one wedge with a gradient
rather than two categories.

`--chart-6` was therefore **added** — to all three theme blocks in
`apps/web/styles/shadcn-ui.css` (`:root.light`, `:root`, `.dark`) and
mapped to `--color-chart-6` in `theme.css`, which is what makes
`bg-chart-6` resolve. The check this section asks for was done first: only
`--chart-1` … `--chart-5` existed, so `bg-chart-6` would indeed have
rendered transparent. The addition is purely additive — nothing else uses
the token — and a test binds every category's colour to the set the theme
defines, so the transparent-wedge failure cannot recur silently.

## 4. Implementation Map

| File | Change |
|------|--------|
| `apps/web/supabase/schemas/38-revenue-tracking.sql` | Add `licensing` to `revenue_records_category_check`. A CHECK cannot be extended in place — the migration drops and re-adds it. Nothing else in the file changes. |
| `apps/web/supabase/migrations/<timestamp>_revenue-licensing-category.sql` | The generated migration. Note the constraint was already re-created once by `20260827104500_revenue-categories.sql:26-28`, so the drop must target the current name, not the original schema-file text. |
| `packages/features/content-analytics/src/lib/schemas/revenue.schema.ts` | Add `licensing` to the category enum (`:29-36`). The manual-entry default stays `sponsorship` (`:53`) — licensing is rarer, and changing a default silently re-categorises whatever a user submits without touching the field. |
| `packages/features/content-analytics/src/components/revenue-mix-card.tsx` | Reads labels and colours from `lib/revenue-mix.ts` rather than holding its own maps — see below. |
| `packages/features/content-analytics/src/lib/revenue-mix.ts` | **New.** `REVENUE_CATEGORY_LABELS` (ordered, for the entry form), `REVENUE_CATEGORY_LABEL` (keyed, for lookups), `REVENUE_CATEGORY_COLOR`, and `splitRevenueByPayout`. |
| `packages/features/content-analytics/src/components/manual-revenue-form.tsx` | **Not in the original map, and required by AC-2.** The form held a hardcoded `<SelectItem>` list — a *third* copy of the vocabulary after the zod enum and the card's labels. Adding `licensing` to it alone would have left the next category to be added in three places, so the labels were collapsed into the shared list and the form now renders from it. |
| `packages/features/content-analytics/src/server/revenue-actions.ts` | Confirm `licensing` falls to `nonAdRevenueCents`. It should already: `adsRevenueCents` is an explicit `byType.ads + byType.premium` (`:123`), so a new category is non-ad by construction — but the acceptance criteria assert it rather than assuming, because the alternative implementation (`total − ads`) has the same value today and a different one the moment a category is added that should count as a payout. |

Nothing changes in `analytics-sync-cron.ts:977-980`, which writes only
`ads`, `premium` and `other` from the YouTube Analytics API. Licensing has
no API source, so no ingest path produces it.

## 4b. Two things this spec makes reachable and does not resolve

Both pre-date this work. Neither mattered while the manual form could not
submit; both matter now that it can.

**Same-day channel-level entries overwrite rather than accumulate.** The
existing-row lookup in `revenue-actions.ts` keys on
`(record_date, category, account_id)` and updates in place, matching
`idx_revenue_records_unique_scope` on
`coalesce(publish_id, account_id), record_date, category`. Two sponsorship
deals — or two licensing payments — recorded for one channel on one date
collapse to a single row, the second replacing the first, with no error and
no warning. Manual channel-level income is exactly where two entries on one
date are normal, so this wants a decision: sum them, reject the second, or
key on something finer. It is a product question, not a cleanup, and it is
**not decided here**.

**Channel-level revenue accepts any account role; per-video does not.**
`revenue_records_create` has two branches (`schemas/38-revenue-tracking.sql:166`).
The publish branch requires `pm.role in ('owner','admin','member')` on the
project. The account branch requires only `public.has_account_access`,
which returns true for the owner *or any team member* with no role filter
(`30-film-studio.sql:1329`). The `accountId` cannot be forged — RLS
settles that — but the two branches disagree about who may write, and
this spec is what makes the account branch reachable from the UI. So the
lowest-privileged member of an account can now create, overwrite and
delete channel-level revenue while being unable to touch a single video's.

Not changed here deliberately: tightening that policy affects every
revenue write path including the sync jobs, which is a security decision
with a blast radius past a category vocabulary. It wants its own ticket.

**Per-video attribution is unreachable from the dashboard.**
`revenue-dashboard.tsx:295` mounts the form without a `publishes` prop, so
the video list always renders its disabled "No published content available"
item and channel-level is the only selectable scope. The per-publish path
that `byContent`, per-video RPM and top-content all read from therefore
cannot be populated by hand. Wiring the publish list in is small and
belongs with whoever next touches that dashboard.

## 4c. Delivered beyond this spec

Seven review rounds on an S-sized spec, because the acceptance criterion
"licensing is selectable in the manual revenue entry form" turned out to
require repairing a form that could not submit anything at all. What
shipped alongside the category:

| Area | Why it was in scope |
|---|---|
| The manual entry form | Unsubmittable in two ways; then stale amount, currency, publish and date fields across a reset; a blank amount saved as `$0`; a pasted `1,250.00` saved as `$1.00`; the trigger showing the previous day west of UTC. Licensing is manual entry permanently, so an inert form makes this spec inert. |
| `@kit/content-analytics` and `@kit/clickhouse` in CI | Neither package's unit tests ran in CI at all — the job enumerates packages by name and both were missing. Every "N tests pass" reported against them was a local run. |
| `apps/e2e/tests/revenue/` | 13 browser specs, seeded through the API. Four review rounds passed typecheck, lint and 256 unit tests while the form was broken; every defect lived between the DOM and form state. |
| `tsconfig` test exclusion | `__tests__` was in both `include` and `exclude`, so the package's tests were never typechecked. Removing it surfaced a pre-existing bad cast. |
| Screenshot requirement | Written into `CLAUDE.md`, `README.md` and `apps/e2e/README.md`: UI changes ship with the rendered result in the PR. |

The lesson worth carrying into FILM-1608, which builds the first writer
`analytics_settings` has ever had: **an acceptance criterion about a form
is not met until the form has been driven end to end.** Four rounds here
ticked one on the strength of reading types.

## 5. Out of Scope

- **Rendering `RevenueMixCard`** — FILM-1611. This spec makes the category
  correct; it does not give it a surface.
- **Per-video revenue on TikTok and Instagram** — no API exists; phase
  README known limits.
- **Anything else on `RevenueSummary`** — already shipped; see §1.
- **Folding the two revenue query shapes into an RPC** — that is the
  in-code `TODO(FILM-1614)` at `server/revenue-queries.ts:79`, a separate
  ticket with its own migration.

## 6. Acceptance Criteria

- [x] `licensing` is accepted by `revenue_records_category_check`
- [x] `licensing` is selectable **and submittable** in the manual revenue entry form

  **This was ticked prematurely.** Selectable was true; submittable was not,
  and the form could not submit *any* entry. `accountId` was declared in
  `ManualRevenueFormProps` and never destructured, its only mount passes no
  `publishes`, and `defaultValues.publishId` was `''` against a
  `z.string().uuid().optional()` field — `''` is not `undefined`, so uuid
  validation failed and `handleSubmit` never reached `onSubmit`. The
  channel-level path the schema has always allowed (`publishId ?? accountId`)
  was unreachable from the UI. Since licensing has no API on any platform
  and is manual entry permanently, shipping the category into a form that
  cannot submit would have made this spec inert.
- [x] The manual-entry default category is unchanged
- [x] `licensing` revenue is counted in `nonAdRevenueCents`, not `adsRevenueCents`
- [x] `adsRevenueCents` remains an explicit sum of `ads` and `premium`, not a subtraction from the total
- [x] Every category, including `licensing`, resolves to a label and a colour that exists in the theme
- [x] `other` is visually distinct from the six named categories
- [x] A row inserted with an unknown category is still rejected by the database
- [x] `pnpm --filter web check:schema-drift` passes
- [x] Both `database.types.ts` copies are **unchanged**, and identical to each other

  **This criterion was wrong as written.** `category` is `varchar(30)` with
  a CHECK, not a Postgres enum, so extending the vocabulary produces no
  change in the generated types at all — a regeneration confirmed zero
  revenue-related lines in the diff. What it *did* produce was 372 lines of
  unrelated churn (`__InternalSupabase` removed, `SetofOptions` blocks
  dropped, `unknown` rewritten), because the local Supabase CLI (v2.40.7)
  is older than the one that generated the committed file. Committing that
  would be a silent CLI downgrade dressed as a schema change — the same
  artifact Phase 17's README already records. The right outcome here is an
  unchanged file, not a regenerated one.

## 7. Verification

```bash
pnpm --filter web supabase migration up
pnpm supabase:web:typegen
pnpm --filter web check:schema-drift
pnpm --filter @kit/content-analytics test
pnpm typecheck && pnpm lint
```

This is the one spec in the phase that is **fully verifiable today**. It
touches Postgres and TypeScript only — no ClickHouse — so the constraint,
the enum and the share arithmetic can all be exercised for real, unlike
every query-side spec in this phase.

The colour choice cannot be verified by a test; it needs a look at the
rendered card, which does not render until FILM-1611. Until then, assert
that each category resolves to a non-empty class name.
