---
spec_id: FILM-1508
title: Revenue Mix Categories & Alerts
status: ✅ DONE
audited: 2026-09-23
effort: M
dependencies: FILM-1506
---

# Revenue Mix Categories & Alerts

## 1. Overview

Revenue tracking today distinguishes only `api` vs `manual` source; `getRevenueSummaryAction.byType` is always empty, the YouTube ad-vs-Premium split is fetched then dropped, and `revenue_alerts` exists but is never written. This spec delivers the playbook's **revenue mix** (ads | premium | sponsorship | product | affiliate | other — watching ads fall as a share is the health indicator) and wires alerts.

## 2. Migration (edit `apps/web/supabase/schemas/38-revenue-tracking.sql` + `db diff`)

> ⚠️ **Superseded instruction.** This spec predates the rule against `supabase db diff` (root `CLAUDE.md`, "Do not run `supabase db diff` in this repo"). Migrations here are written by hand and mirrored into `schemas/`; do not follow the `db diff` step below if you reuse this spec.

- `revenue_records` gains `category varchar(30) not null default 'ads'`, `check (category in ('ads','premium','sponsorship','product','affiliate','other'))`.
- `publish_id` becomes **nullable**; new nullable `account_id uuid references accounts(id)`; `check (publish_id is not null or account_id is not null)` — sponsorship/product revenue is often channel-level (locked decision).
- Replace `unique(publish_id, record_date)` with a unique index on `(coalesce(publish_id, account_id), record_date, category)`.
- Extend RLS read/write policies with the account-level branch (`has_role_on_account(account_id)`).
- One-off backfill: split historical `source = 'api'` rows into `ads`/`premium` using the ad/red split already stored in `breakdown` jsonb.

## 3. Implementation Map

| File | Change |
|------|--------|
| `analytics-sync-cron.ts` `upsertRevenueRecord` | Writes **two rows** for YouTube: `category:'ads'` = estimatedAdRevenue, `category:'premium'` = estimatedRedPartnerRevenue. Conflict target includes category. |
| `revenue-actions.ts` | `getRevenueSummaryAction` populates `byType` (group by category); `addManualRevenueAction` schema gains `category` + account-level mode; `syncRevenueFromPlatformAction` stub → calls `syncSinglePublishById`. |
| `packages/features/content-analytics/src/server/revenue-alerts.ts` | New. `evaluateRevenueAlerts(accountId)` at end of the sync cron: `significant_change` (day revenue > 3× trailing 28-day avg), `threshold_reached` (monthly total crosses configured milestones) → inserts into `revenue_alerts`. |
| `manual-revenue-form.tsx` | Category select + channel-level entry mode. |
| `revenue-dashboard.tsx` | `RevenueMixCard` (donut, share-over-time) + alerts list card. |

## 4. Acceptance Criteria

- [x] YouTube sync produces separate ads/premium rows per day without clobbering (conflict-semantics unit test) — *audit:* `packages/features/content-analytics/__tests__/revenue-mix.test.ts:508`; the upsert became a planned write (FILM-1609), `analytics-sync-cron.ts:1275`
- [x] `byType` is populated in the revenue summary; RevenueMixCard renders the mix — *audit:* per currency since KB-12: `packages/features/content-analytics/__tests__/revenue-by-currency.test.ts:60`, `apps/e2e/tests/revenue/revenue-currency-evidence.spec.ts:105`
- [x] Manual entry supports category + channel-level records; RLS covers both branches — *audit:* `apps/e2e/tests/revenue/revenue.spec.ts:16`, `:30`; `apps/web/supabase/tests/database/revenue-records-rls.test.sql:79` (account branch), `:315` (publish branch)
- [x] Historical rows are backfilled into categories — *audit:* `apps/web/supabase/migrations/20260827104500_revenue-categories.sql:66`
- [x] Alerts appear in `revenue_alerts` when rules trigger — *audit:* `packages/features/content-analytics/__tests__/revenue-alerts.test.ts:113`, `:145`

## 5. Verification

```bash
pnpm --filter web supabase migration up && pnpm supabase:web:typegen
pnpm --filter @kit/content-analytics test
# Manual: run sync, check two categorized rows; add manual sponsorship at account level; view mix card.
```
