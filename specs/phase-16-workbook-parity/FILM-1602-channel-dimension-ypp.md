---
spec_id: FILM-1602
title: Channel Dimension & Per-Channel YPP Progress
status: 🟡 PARTIAL
audited: 2026-09-23
effort: L
dependencies: FILM-1601, FILM-1506
---

# Channel Dimension & Per-Channel YPP Progress

## 1. Overview

A project spans several channels — different platforms, and separate per-language YouTube channels where multi-language audio is unavailable. Without `connection_id` on `video_dim`, no deep-dive metric can be grouped or filtered by channel, and YPP watch hours pool across channels against a single target **even though the gate is per-channel**. Summing two channels' watch hours against one 4,000-hour target reports a threshold as met when neither channel has met it.

Shipped in PR #233, including the code-review remediation in the same PR.

## 2. Migration

`007_video_dim_connection.ts`: `ALTER TABLE video_dim ADD COLUMN IF NOT EXISTS connection_id UUID`.

Cheap — `connection_id` is not part of `ORDER BY (video_id)`, so this is a metadata-only change with no re-sort and no partition rewrite.

**Deploy the migration before the app.** Inserts from the new code carry `connection_id`, and against a table still missing the column ClickHouse either rejects the batch or drops the field, depending on `input_format_skip_unknown_fields` — which this project does not set.

**Backfill** is the existing reconcile: `upsertVideoDims()` with no argument re-upserts every published row and ReplacingMergeTree keeps the newest by `updated_at`. It runs nightly, and on demand via `POST /api/analytics/backfill`. This only holds because the reconcile pages its reads (see FILM-1612) — an unbounded select stopped at 1,000 rows and backfilled nothing beyond that.

## 3. Implementation Map

| File | Change |
|------|--------|
| `dim-sync.ts` | Selects `platform_connection_id`, emits `connection_id`, falling back to the zero-UUID `UNATTRIBUTED_CONNECTION_ID` when null — ClickHouse UUID columns are non-nullable, so legacy/manual rows read as "unattributed" in a channel filter rather than vanishing from every metric. |
| `queries-advanced.ts` | `DimScope` gains `connectionId`; `buildDimConditions` filters on it. `assertDimScope` still requires `projectId \|\| accountId` — `connectionId` is a filter, not a scope. |
| `server/channels.ts` | New. `listProjectChannels(projectId)` derives channels from the project's published content; `listAccountChannels(accountId, client, { platform, activeOnly })` lists every connected channel, which is the right list for settings and YPP. Both return `ChannelRef{connectionId, platform, name, thumbnailUrl, isActive}`. |
| `deep-dive-actions.ts` | `ScopeSchema` gains `connectionId`. `assertScopeAccess` binds it to the scoped account. The check is **not** what keeps data private — `buildDimConditions` ANDs it onto an already-verified project or account, so a channel filter only ever narrows. It exists so a channel outside the scope fails loudly instead of silently matching nothing. |
| `deep-dive-actions.ts` | `getYppProgressAction` returns an **array**, one entry per channel, never a pooled total. Per channel: `queryWatchWindowTotals({ scope: { accountId, connectionId, platform: 'youtube' } })` + `queryChannelWatchWindow({ connectionIds: [id] })`. `windowDays` un-hardcoded (default 365). Throws for a channel that is not an active YouTube connection rather than returning `[]` that reads as "no data". |
| `ypp-progress-card.tsx` | `YppProgress` → `YppChannelProgress`, documented as **one element** of the action's array. The card stays single-channel; the caller maps over it. |

### Why the two halves compose

`channel_daily` holds exactly the residual for videos that never matched a publish (`report-ingest.ts`). A channel total is therefore `Σ video_metrics for its publishes + channel_daily` — complementary halves, so adding them double-counts nothing. This premise is load-bearing and depends on publish resolution being complete; see FILM-1612.

## 4. Acceptance Criteria

- [x] `video_dim.connection_id` populated for every published row, zero-UUID when unattributed
- [x] Deep-dive queries accept and filter by `connectionId`
- [x] `getYppProgressAction` returns one row per channel with its own target
- [x] A channel outside the scope raises an error rather than returning empty
- [ ] For a single-channel account, Σ per-channel watch hours equals the previous pooled number (regression guard) — *audit: not met* — no test compares per-channel and pooled totals; 2e44f648 added only SQL-shape tests
- [x] `YppChannelProgress` describes one channel, matching what the action returns

## 5. Verification

```bash
pnpm --filter @kit/clickhouse migrate      # apply 007 BEFORE deploying the app
pnpm --filter @kit/content-analytics test
pnpm --filter @kit/clickhouse test
pnpm typecheck && pnpm lint
```

End-to-end verification of the YPP numbers is blocked until a ClickHouse instance is provisioned (`CLICKHOUSE_ENABLED=false`); reads return empty and the UI shows zeros until then.

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Σ per-channel watch hours = pooled (regression guard) | No such test exists. The per-channel figure filters `connection_id` (`packages/clickhouse/src/queries-advanced.ts:142`), so a video synced with the zero-UUID `UNATTRIBUTED_CONNECTION_ID` is in a pooled total and in no channel's — the guard would have to seed one to mean anything | unassigned |
