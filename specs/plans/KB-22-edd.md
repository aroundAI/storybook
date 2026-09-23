# KB-22 — Disconnecting a platform keeps the creator's records (EDD)

**Ticket:** KB-22 in `specs/cross-cutting/FILM-CC-04-known-bugs.md`, designed together
with **KB-20 item 3** (the vendor-data deletion mechanism). Severity High.
**Branch:** `fix/kb-22-disconnect-keeps-records` from `origin/main` (49b851d6).
**Status:** Approved 2026-09-23 (all ten decisions at their defaults; §5
wording approved). PR A implemented (#317); PR B stacked on it (#322).

**Confirmed by the owner, 2026-09-23, after implementation:** (1) deviation 6
below — a `BEFORE DELETE` trigger in place of `NO ACTION` foreign keys;
(2) PR A's YouTube dialog line without "— normally within the hour", which
PR B restores with the job; (3) PR B's data-deletion page bullet, "Within 7
calendar days it also removes the per-video statistics…".

**Deviations found while implementing PR A** (none changes user-visible scope):

1. The per-platform `disconnect*Action` server actions were removed rather
   than kept as delegating wrappers: nothing but the router called them, and
   a `'use server'` file exporting them would have made each a callable
   endpoint. Their vendor calls moved to `oauth/<platform>/revoke.ts`
   (`server-only`), composed by `oauth/revokers.ts`.
2. The analytics sync skips a disconnected connection in `syncEligibility`
   (not in the query, as §20 proposed): the existing `not_authorised` and
   `suppressed` skips have the same shape, and a PostgREST filter on an
   embedded connection would drop upload-only publishes with no connection.
3. The YouTube dialog sentence ships in PR A without "— normally within the
   hour": until PR B's job exists the 7-day deletion is the owner's, by hand
   (`docs/data-deletion-runbook.md`). PR B adds the clause with the job.
4. The privacy policy repeated the sentence the data-deletion page corrects
   ("Disconnecting also removes our records…"); it is corrected with it.
5. The Playwright reconnect case needs a server started with a local OAuth
   sandbox and an `ENCRYPTION_KEY`, which CI's E2E job does not have (no
   `ENCRYPTION_KEY` is configured anywhere locally or in CI today), so it is
   gated on `KB22_OAUTH_SANDBOX_PORT` and runs locally; the disconnect cases
   run everywhere.
6. **§14's foreign-key change was wrong and is replaced** (FR-4/FR-5, §29
   "FK action"). This EDD said `NO ACTION` "is checked at statement end, so
   account deletion still succeeds". It is not, inside a cascade: each
   referential step is checked as it runs, deleting an account reaches
   `platform_connections` while the publishes are still there, and the pgTAP
   account-deletion case **died with 23503** — every account deletion refused,
   the KB-1 shape. `DEFERRABLE INITIALLY DEFERRED` fixed that but stopped
   `channel_analytics_settings`' composite key refusing a cross-account
   insert at insert time (its own pgTAP case went red). What shipped: the
   keys are **unchanged** (still `CASCADE`), and a `BEFORE DELETE` trigger,
   `platform_connections_refuse_delete`, refuses to delete a connection whose
   account still exists (SQLSTATE 23001). During account deletion the account
   row is already gone when the cascade reaches its connections, so that
   works; every other delete — member, service role, operator — is refused,
   including of a connection nothing yet points at. Same user-visible
   behaviour as approved, and stricter. Runbook procedure B no longer deletes
   the connection row.
7. Three existing pgTAP files asserted the old behaviour and were updated:
   `channel-analytics-settings-rls` ("deleting a channel takes its override
   with it" → the delete is refused and the override stays),
   `analytics-experiments-watched` ("disconnecting nulls the experiment's
   channel" → the experiment keeps its channel). `ConnectionStatus` was
   defined twice (`src/types.ts`, `src/lib/types.ts`); the second now
   re-exports the first.
8. The red checks are kept as CI mutation guards (`tooling/mutation-guards/kb-22.json`).

**Decisions this builds on, not reopens** (KB-20, "Decided (owner, 2026-09-22)"):
disconnecting does not delete history; YouTube is carved out — its statistics are
deleted within 7 calendar days of an in-app disconnect and within 30 of a
revocation at Google or an authorisation that cannot be renewed; every other
platform keeps data until the creator asks, with no time limit; a requested
deletion happens within 7 days. The lead's summary and the file agree on all of
this. **One place where the tickets' own text is wrong:** KB-22 names "seven
ClickHouse tables". There are **nine** (`system.tables` on the local 24.8 server,
2026-09-23): the seven `video_*` tables plus `channel_daily` and
`channel_subscribers`, both keyed by `connection_id`. `docs/data-deletion-runbook.md`
already says nine. This plan uses nine.

---

## 1. Start With the User

**Who.** A creator (today: the owner, the only user) who has connected one or more
channels — YouTube, TikTok, Instagram, Facebook, X, LinkedIn — to a team account,
published through them, and then typed things into the product about those
publishes: manual revenue (a sponsorship, a brand deal), content tags, experiment
membership, YPP targets for the channel, default publishing settings per project.

**The problem.** Pressing **Disconnect** today silently and irreversibly deletes
all of that. The dialog says *"This will remove access to {account}. You won't be
able to publish to this account until you reconnect."* — which is true and is not
what happens. What happens is a `DELETE` on the connection row, and the schema
cascades it into every publish made through that channel and everything a person
attached to those publishes (reproduced below, §8). Meanwhile the vendor's own
statistics in ClickHouse, which YouTube's policy says we must delete, are left
behind forever with nothing pointing at them.

**After the fix, the creator can:**

- Disconnect a channel and lose **nothing they wrote**. Their record of what was
  published, manual revenue, tags, experiments, YPP targets and publishing
  defaults stay exactly as they were, still visible in analytics, the video log
  and experiments.
- See the disconnected channel in **Settings → Platforms** as *Disconnected*, with
  the date, and a **Reconnect** button.
- Reconnect the **same** channel later — days or months later — and find it
  re-attached to all its history: same channel in every filter, same revenue
  figures, analytics collection resuming.
- Read, **before** confirming, a dialog that says precisely what disconnecting does
  for that platform, including — for YouTube — that the statistics collected from
  YouTube will be deleted, and when.
- (PR B) Rely on the product, not the owner's memory, to delete YouTube
  statistics within the policy window after an in-app disconnect, and to delete
  any platform's statistics when a deletion is requested.

**What they could not do before:** disconnect without data loss; know what
disconnect does; reconnect to their history (the rows were gone).

**Success:** after disconnect → reconnect, every figure the creator typed in is
on the page exactly as before, and the channel is the same channel.
**Failure:** any user-authored row missing after disconnect; or a YouTube
statistic surviving past its window; or a dialog sentence the code does not honour.

**Persists after leaving/refresh:** the disconnected row and all history; the
purge record (PR B). **Does not persist:** the access and refresh tokens (wiped
on disconnect, never recoverable — reconnect issues new ones); for YouTube, the
collected statistics (deleted), which are **re-collected** from YouTube after a
reconnect where YouTube still serves them (§12).

## 2. Define the Complete User Journey

| # | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| 1 | Opens **Settings → Platforms** (`/home/[account]/settings/platforms` via `PlatformConnections`) | `getConnectionsAction` lists all the account's connections, including disconnected ones | Active rows as today; disconnected rows greyed, badge *Disconnected*, "Disconnected on 23 Sep 2026", **Reconnect** | 2 or 6 |
| 2 | Clicks the **Disconnect** icon (was a trash can; becomes an unplug icon) on an active/expired/error row | Opens the dialog; the copy is chosen by platform; for any platform with scheduled publishes on this channel the count is shown | Dialog (§5) | 3 or cancel |
| 3 | Confirms | Server action: revoke at the vendor (best effort, platform-specific, unchanged), then `disconnect_platform_connection(id)` wipes tokens, sets `is_active=false`, `disconnected_at=now()` — **no row is deleted** | Toast "Disconnected {account}. Your records are kept." Row flips to *Disconnected* | 4, 6 |
| 4 | Visits analytics / video log / experiments | Nothing changed in Postgres history; analytics sync stops collecting for that channel | Same videos, same manual revenue, same tags; the channel still appears in channel filters | — |
| 5 | (YouTube only, PR B) waits | Within an hour of the disconnect (after any in-flight sync) the purge job deletes that channel's YouTube statistics | Disconnected row says "Statistics collected from YouTube were deleted on {date}"; YouTube charts for those videos are empty; manual revenue and records remain | 6 |
| 6 | Clicks **Reconnect** | Standard OAuth; callback upserts on `(account_id, platform, platform_account_id)` — the kept row is updated in place, `disconnected_at` cleared by trigger | Row is *Connected* again, same row id → every publish, setting and experiment is attached again | 7 |
| 7 | Next hourly sync | Publishes eligible again (`grantedAt` newer than last failure); YouTube window restarts from the publish date because the purge cleared `last_data_date` | Charts refill over the next sync cycles; no duplicates (ReplacingMergeTree keys; revenue unique key) | — |

**Re-entry / refresh:** everything is server state; a refresh shows the same thing.
**Cancellation:** Cancel or Escape closes the dialog; nothing is sent.
**Session interruption mid-disconnect:** the server action runs to completion or
not at all at the DB step (single SQL function, one transaction); the vendor
revoke may have happened without the DB step — see §4.
**Navigation away during step 5:** the purge is a background job, independent of
the browser.
**Reconnecting a *different* channel:** creates a new row; the old one stays
*Disconnected* with its history.

## 3. Explicitly Define the Happy Path

Canonical scenario (the Playwright spec's script, §26):

1. **Setup.** Team *Acme* has YouTube channel *Acme TV* (connection `C`), one
   published episode (publish `P`, `platform_content_id = vid1`), a manual revenue
   entry of **$50.00** on `P` (`source='manual'`), an API revenue row of $12.34
   (`source='api'`), tag *Tutorial* on `P`, `P` in experiment *Thumbnail style*,
   YPP target 4,000 watch hours on `C`.
2. **User opens Settings → Platforms.** Reads `platform_connections` for the
   account. Sees *Acme TV · Connected*.
3. **User clicks Disconnect.** Dialog shows the YouTube copy (§5). Nothing is
   read or written yet except the scheduled-publish count (a head count query).
4. **User confirms.** `disconnectPlatformAction({connectionId: C})`:
   a. Reads `C` (RLS: caller must have account access), decrypts the access token.
   b. Revokes at Google (`POST oauth2/revoke`), logging the HTTP status.
   c. Calls `rpc('disconnect_platform_connection', {p_connection_id: C})`, which in
      one transaction sets `access_token_encrypted = null`,
      `refresh_token_encrypted = null`, `token_expires_at = null`,
      `is_active = false`, `disconnected_at = now()`; returns the ids it changed.
   d. (PR B) The `after update` trigger sees `disconnected_at` go null → set on a
      YouTube row and inserts a `vendor_data_purges` row: reason
      `in_app_disconnect`, `run_after = now() + 1 hour`, `due_by = now() + 7 days`.
   e. Returns `{ ok: true, data: { disconnected: [C] } }`.
   The user sees the toast and the row flip to *Disconnected*. **Success because**
   `P`, the $50.00 row, the tag, the experiment link and the YPP target are all
   still there (asserted in pgTAP and E2E), and no token remains.
5. **Analytics page.** Still lists `P` with $50.00 manual revenue.
6. **(PR B) Purge runs** (hourly cron, first run after `run_after`): deletes, for
   `C` only: `revenue_records` where `source='api'` on `C`'s publishes ($12.34
   row), `youtube_report_jobs` of `C`, ClickHouse rows for `vid1` in the six video
   tables, `channel_daily`/`channel_subscribers` for `C`, then `video_dim` rows of
   `C`; clears `publishes.metadata.sync` and `duration_seconds` on `C`'s publishes
   so a reconnect re-collects; strips vendor-display keys from `C.metadata`. Writes
   `completed_at` and per-table counts. **Success because** a count of each table
   for `C` is 0 afterwards and a control connection's counts are unchanged.
7. **User reconnects Acme TV.** Callback upserts the same `(account, youtube,
   channelId)`; the trigger clears `disconnected_at`; `is_active = true`. Row id is
   still `C`. **Success because** `P.platform_connection_id = C` still resolves,
   the $50.00 is still on the page (asserted *after* reconnect, per the AC), and
   the next sync treats `P` as eligible.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User sees | Recovery | Final state |
|---|---|---|---|---|
| Vendor revoke fails (network, 4xx/5xx, token already dead) | Logged at warn with status; disconnect continues (today's behaviour, kept) | Normal success | User can revoke at the vendor (data-deletion page §4 links) | Disconnected, tokens wiped |
| DB step fails after vendor revoke succeeded | Action returns a refusal value "Could not disconnect … try again" | Error toast; row still *Connected* but its token is revoked at the vendor | Retry → revoke is idempotent (already revoked → error logged, ignored) then DB step | Disconnected on retry; meanwhile sync fails with auth error as with any dead token |
| Connection not found / not the caller's (RLS) | RPC updates 0 rows → refusal "That connection no longer exists or you don't have access to it" | Error toast | Refresh | Unchanged |
| Double click / two tabs disconnect concurrently | RPC is idempotent: `where id = $1 and disconnected_at is null`; the second call changes 0 rows and returns `alreadyDisconnected` | Second toast says "already disconnected" | — | One `disconnected_at`, one purge row (trigger fires only on null→set) |
| Disconnect an Instagram connection linked to a Facebook Page (or the reverse) | Same linked-row rule as today (`metadata.linked_page_id`), but soft: all linked rows are disconnected together in the RPC | Dialog for Meta platforms says the linked Page/account disconnects together; toast lists both | Reconnect via Meta restores both (Meta callback upserts all pages) | Both disconnected, all records kept |
| X / LinkedIn | Revoke step is `not_implemented` (KB-25) and logged as such; soft disconnect as for every platform | Dialog says we delete the tokens but don't yet ask X/LinkedIn to revoke (matches the data-deletion page) | KB-25 fills the revoker | Disconnected |
| Scheduled publishes exist on the channel | Not cancelled. At run time they fail on `CONNECTION_INACTIVE` (existing path in `process-scheduled-publishes.ts:222-228`) with the publish marked failed | Dialog: "2 scheduled posts on this channel won't go out unless you reconnect before their time." | Reconnect before the time → they go out | Scheduled → published or failed |
| Reconnect with a different channel | New row (different `platform_account_id`) | Two rows: old *Disconnected*, new *Connected* | — | History stays on the old row |
| Reconnect the same channel **before** the YouTube purge ran (< 1 h) | Purge still runs (decision 2: reconnect does not cancel); clears `metadata.sync` so the sync re-collects | Charts empty briefly, then refill | Automatic | Consistent |
| Purge: ClickHouse unreachable | Postgres part committed; purge row keeps `completed_at = null`, `attempts++`, `last_error`; retried hourly | Row says "deletion pending" | Automatic retry; after `due_by` passes unfinished → error-level log (operator alert, §22) | Completed on a later run |
| Purge: `CLICKHOUSE_ENABLED != 'true'` (production today) | ClickHouse step recorded as `disabled`, not as `deleted` | Same as completed | — | Honest record: nothing to delete because nothing was written |
| Purge: an in-flight sync writes rows after the purge | Mitigated by `run_after = +1 h` (sync lambda timeout is < 15 min) and by tokens being wiped before the purge is enqueued; the purge verifies `count() = 0` per table after its mutations and retries otherwise | — | Retry | 0 rows |
| Account deleted (Settings → Danger Zone) | Cascade deletes connections (FK from `accounts`), publishes etc. as today. (PR B, decision 6) an `after delete` trigger enqueues a purge per connection, reason `connection_deleted` | Unchanged UI | Job purges ClickHouse by `video_dim.connection_id` | Nothing left in either store |
| Direct `DELETE` on a connection via PostgREST by a member | Refused: RLS delete policy removed (decision 8), and FK `NO ACTION` refuses while publishes/settings reference it | 403/409 from the API | Use Disconnect | Unchanged |
| Expired/errored connection disconnected | Same flow; revoke likely fails (logged) | Normal | — | Disconnected |
| Large channel (thousands of publishes) | Purge pages every read (`fetchAllRows`, `fetchAllByIds`) — PostgREST's 1000-row cap | — | — | Complete |

## 5. Establish the User-Facing Contract

**Settings → Platforms, per row:**

| State | Badge | Line under the name | Actions |
|---|---|---|---|
| active | Connected (existing) | Connected {time ago} | language, refresh token, **Disconnect** (unplug icon, `data-test="disconnect-connection"`) |
| expired / error | Expired / Error (existing) | as today | language, Reconnect, Disconnect |
| **disconnected** (new) | **Disconnected** (outline, muted) | "Disconnected on {date}. Your records from this channel are kept." + YouTube only (PR B): "Statistics collected from YouTube were deleted on {date}" / "…will be deleted by {date}" | **Reconnect** only (`data-test="reconnect-connection"`) |

`data-test` on the row (`data-connection-id`, `data-status`), badge, dialog, confirm button.

**Dialog (draft copy — owner approves wording; keys in `platforms.json`):**

- Title — `disconnectTitle`: "Disconnect {{accountName}}?"
- Common first paragraph — `disconnect.access`: "We'll stop collecting from {{platform}} and delete the access tokens we hold. You won't be able to publish to {{accountName}} until you reconnect."
- Revocation line, by platform:
  - YouTube/TikTok/Instagram/Facebook — `disconnect.revoke.asks`: "We'll also ask {{platform}} to revoke our access."
  - X/LinkedIn — `disconnect.revoke.notYet`: "We don't yet ask {{platform}} to revoke our access — remove it in {{platform}}'s settings too." (removed by KB-25)
- Kept list — `disconnect.kept`: "Kept: your record of what was published, revenue you entered, tags, experiments and channel targets. Reconnect this channel and they're attached again."
- Vendor data, by platform:
  - YouTube — `disconnect.vendorData.youtube`: "YouTube's policies require us to delete the statistics we collected from YouTube for this channel. We delete them within 7 days — normally within the hour. If you reconnect, we collect them again from YouTube."
  - Others — `disconnect.vendorData.kept`: "Statistics already collected from {{platform}} are kept until you ask us to delete them." + link "How to ask" → `/data-deletion#request`.
- Meta linked — `disconnect.linked`: "{{linkedName}} is connected through the same Facebook login and is disconnected with it."
- Scheduled — `disconnect.scheduled_one/_other`: "{{count}} scheduled post on this channel won't go out unless you reconnect before its time."
- Buttons: Cancel / **Disconnect** (destructive style stays: access is removed).

No typed confirmation (decision 4): nothing the user wrote is lost any more.

**Toasts:** success "Disconnected {{accountName}}. Your records are kept." · already
"{{accountName}} was already disconnected." · refusal: the action's returned
message (KB-6: values, not throws).

**Loading:** confirm button shows a spinner and is disabled while pending; the
dialog stays open until the result (so the result is read in context).

**Visibility/permissions:** unchanged — any member with account access may
disconnect (RLS `has_account_access`), as today.

**Data-deletion page** (`(marketing)/(legal)/data-deletion/page.tsx:147-156`):
the paragraph that today tells users that disconnecting deletes their records
"including ones you typed in yourself" becomes false and is rewritten (DRAFT for
owner approval) to: records are kept; YouTube statistics are deleted within 7
days; other platforms' statistics are kept until asked. Account-deletion bullet
("does not yet remove the per-video statistics") is updated only in PR B, if
decision 6 is taken.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Trigger → processing → state change | Verified by |
|---|---|---|---|
| FR-1 | Disconnect never deletes a `platform_connections` row | Any disconnect path → `disconnect_platform_connection` → UPDATE only | pgTAP `platform-connection-disconnect.test.sql`; unit test on the action (no `.delete()` on the table — grep guard) |
| FR-2 | After disconnect the row holds no credential | tokens, expiry null; `is_active=false`; `disconnected_at` set; CHECK constraint enforces it | pgTAP (constraint refuses a disconnected row with a token) |
| FR-3 | User-authored rows survive disconnect | publishes, manual `revenue_records`, `publish_tags`, `experiment_publishes`, `manual_tasks`, `channel_analytics_settings`, `episode/project_publishing_configs`, `analytics_experiments.connection_id` all unchanged | pgTAP, red on `main` |
| FR-4 | A connection referenced by user data cannot be hard-deleted on its own | FKs from `publishes`, `channel_analytics_settings`, `episode_publishing_configs`, `project_publishing_configs` become `NO ACTION`; RLS delete policy dropped | pgTAP: member DELETE refused; `postgres` DELETE refused with 23503 |
| FR-5 | Account deletion still succeeds (KB-1 scar) | `NO ACTION` is checked at statement end; the account cascade removes publishes and connections in one statement | pgTAP: `delete from accounts` lives_ok, nothing left |
| FR-6 | Reconnecting the same platform account re-attaches the kept row | callback upsert on `(account_id, platform, platform_account_id)`; BEFORE UPDATE trigger clears `disconnected_at` when a token is written | pgTAP (simulated upsert keeps id, clears flag); E2E through the real YouTube callback |
| FR-7 | Disconnected connections are not offered for publishing | `getConnectedPlatformsAction` excludes `disconnected_at is not null`; publish pickers read it | unit test on the query builder / E2E publish screen check |
| FR-8 | Analytics sync does not try disconnected connections | `syncEligibility` returns `'disconnected'` (skipped, not counted as failure); grant carries `disconnectedAt` | unit test, red first |
| FR-9 | Dialog copy matches behaviour per platform | pure `disconnectCopyFor(platform)` → i18n keys; bound by test to the revoker map | unit test; E2E screenshot per platform class (YouTube, TikTok, X) |
| FR-10 | Refusals are returned as values | action wrapped with `returnRefusals` | unit test; prod-build E2E asserts the refusal text |
| FR-11 | Every platform has a revoke entry, by type | `REVOKERS: Record<PlatformType, Revoker>` — X/LinkedIn `notImplemented` (KB-25 fills) | typecheck; unit test |
| FR-12 (B) | YouTube in-app disconnect enqueues a purge due in 7 days | AFTER UPDATE trigger on null→set `disconnected_at`, platform youtube | pgTAP |
| FR-13 (B) | The purge removes one connection's vendor rows — nine ClickHouse tables, `source='api'` revenue, `youtube_report_jobs` — and nothing else | `runVendorDataPurges()` | ClickHouse integration test with two connections side by side against the real local server; pgTAP for the Postgres part |
| FR-14 (B) | A purge readies the connection for re-collection | clears `publishes.metadata.sync`, `duration_seconds`; strips vendor-display metadata keys | unit + integration |
| FR-15 (B) | Purges are retried until done, and lateness is loud | attempts/last_error; overdue → `logger.error` | unit test on the scheduler selection; log assertion |
| FR-16 (B) | A request (email) is one insert, not a procedure | runbook B/C/D become `insert into vendor_data_purges …` | runbook rewritten; exercised once locally |
| FR-17 (B, decision 6) | Deleting a connection row (account deletion) enqueues its purge | AFTER DELETE trigger | pgTAP: account deletion lives_ok and leaves one purge row per connection |

## 7. Define Non-Functional Requirements

- **Durability/irreversibility:** no path in app code deletes a connection row
  (grep guard in a unit test over `packages/features/publishing/src` and `apps/web/app`).
- **Compliance latency:** YouTube in-app disconnect → purge completed ≤ 7 calendar
  days; target ≤ 2 h (hourly cron, `run_after` +1 h). Request → ≤ 7 days, target ≤ 1 h after insert.
- **Latency:** disconnect action p95 dominated by the vendor revoke call; add a 10 s
  timeout on revoke fetches (today none) so a hung vendor cannot hang the dialog.
- **Consistency:** the DB state change is one SQL function call = one transaction.
- **Security/privacy:** tokens wiped at disconnect (they are today, by deletion);
  purge job uses service role; purge table readable only by the account's members.
- **Accessibility:** dialog keeps Radix AlertDialog focus trap; badge text, not colour alone.
- **Observability:** structured logs for disconnect (revoke status per platform) and purge (per-table counts).
- **Backward compatibility:** old app code against new schema fails closed (DELETE refused), never deletes (§24).
- **i18n:** only `en` exists; all new strings go through `platforms.json`.
- **Cost:** one hourly lambda invocation (PR B), negligible.

## 8. Analyze the Existing System

**Reproduced** (local Supabase, `db reset` from this branch, DB lock held,
rolled-back transaction; script `$SP/kb22/repro.sql`, 2026-09-23). Two YouTube
connections on `storybook`, A (to be disconnected) and B (control). The single
statement every disconnect path issues, `delete from platform_connections where id = A`:

| Row | before | after |
|---|---|---|
| publishes (A) — incl. one *scheduled* | 2 | **0** |
| revenue `api` (A) | 1 | 0 |
| **revenue `manual` (A)** — typed in by a person | 1 | **0** |
| publish_tags (A) | 1 | **0** |
| experiment_publishes (A) | 1 | **0** |
| manual_tasks (A) | 1 | **0** |
| channel_analytics_settings (A) — YPP target | 1 | **0** |
| project_publishing_configs (A) | 1 | **0** |
| episode_publishing_configs (A) | 1 | **0** |
| youtube_report_jobs (A) | 1 | 0 |
| experiment itself / tag itself | 1 / 1 | 1 / 1 |
| publishes (B) / revenue manual (B) — control | 1 / 1 | 1 / 1 |

**FK tree from the live catalog** (`pg_constraint`, not from reading migrations):

```
platform_connections
 ├─ publishes                    CASCADE   (20251205125737_film-studio-tables.sql:471)
 │   ├─ revenue_records          CASCADE   ← source='manual' included
 │   ├─ publish_tags             CASCADE
 │   ├─ experiment_publishes     CASCADE
 │   └─ manual_tasks             CASCADE
 ├─ channel_analytics_settings   CASCADE   (composite (id, account_id), 20260916180412)
 ├─ episode_publishing_configs   CASCADE
 ├─ project_publishing_configs   CASCADE
 ├─ youtube_report_jobs          CASCADE
 ├─ analytics_experiments        SET NULL (connection_id)   ← experiment silently loses its channel
 ├─ short_publications           SET NULL
 └─ social_posts                 SET NULL
```

KB-22's diagram missed the three `SET NULL` children; they matter because the
experiment's channel scope is user intent too.

**Every disconnect path ends in that DELETE:**

| Path | File:line |
|---|---|
| Router | `packages/features/publishing/src/server/connection-actions.ts:122-153` |
| YouTube | `oauth/youtube/disconnect.ts:61-69` (revoke `:43-59`, response never checked) |
| TikTok | `oauth/tiktok/disconnect.ts:74-82` |
| Meta | `oauth/meta/disconnect.ts:71-79`, plus linked FB/IG rows `:81-95`, `:97-137` |
| X, LinkedIn | `connection-actions.ts:137-139` → `deleteConnection` `:254-267` (no revoke — KB-25) |
| `disconnectTwitterAction` | `oauth/twitter/disconnect.ts:79-87` — exported, called by nothing |

**Dialog:** `components/platform-connections.tsx:452-479`, copy
`apps/web/public/locales/en/platforms.json:13`; the button is a **trash icon**
(`:424-431`), matching what the code does rather than what the dialog says.
Errors are thrown from the actions, so a production build shows the generic
sentence (KB-6).

**Reconnect:** all six writers upsert with
`onConflict: 'account_id,platform,platform_account_id'` (unique constraint
`film-studio-tables.sql:227`): `callback/youtube/route.ts:238-263`,
`youtube/save-channel/route.ts:93-118`, `callback/meta/route.ts:321-326`,
`callback/tiktok:190`, `callback/twitter:204`, `callback/linkedin:169`. So a kept
row *is* re-attached by today's code — once it is kept.

**Token death** (not a disconnect): `token-refresh.ts:262-285`
`markConnectionInactive` sets `is_active=false`; `ensureValidToken` returns
`CONNECTION_INACTIVE` for inactive rows (`:115-117`). Every vendor-calling reader
already gates on `is_active` (subscriber-snapshot `:131`, report-ingest `:104`,
publish-short `:130`, publish-worker `:161`, revenue-actions `:772`, refresh job
`:78`) — so a kept, inactive row **fails closed** everywhere without touching the
refresh path (KB-29's area).

**Readers that would newly see disconnected rows:** the analytics sync
(`analytics-sync-cron.ts:297-391`, no `is_active` filter; would mark each publish
`requires_reauth` hourly — noise, not harm); `getConnectedPlatformsAction`
(`connection-actions.ts:277-354`, feeds publish pickers); `getConnectionsAction`
(settings list); `content-analytics/server/channels.ts` (channel filters — seeing
disconnected channels there is **wanted**: it is history).

**ClickHouse:** nine base tables (`system.tables`, 24.8.14): `video_dim`,
`video_metrics`, `video_snapshots`, `video_reach_daily`, `video_traffic_sources`,
`video_audience`, `video_retention_curves` (keyed `(project_id, platform, video_id, …)`,
`video_dim` by `video_id` and carrying `connection_id`/`account_id`), and
`channel_daily`, `channel_subscribers` (keyed `connection_id`); `video_daily_stats`
is a plain view. `grep -rn "DELETE\|TTL " packages/clickhouse/src` → nothing
(positive control: `ReplacingMergeTree` → 14 hits). Production runs with
`CLICKHOUSE_ENABLED=false`.

**Postgres vendor-sourced data:** `revenue_records` `source='api'`
(`analytics-sync-cron.ts:1301-1302`); `youtube_report_jobs`; `publishes.metadata.sync`
(markers: `last_data_date`, `backfill_completed_at` — they gate re-collection);
`publishes.duration_seconds` (vendor-reported, `asset-duration-sync.ts`);
`platform_connections.metadata` display keys (`thumbnail_url`, `profile_image_url`,
`avatar_url`, `analytics_account_gated`).

**Cron pattern:** SST `Cron` → lambda → `GET {API_URL}/api/cron/<job>` with
`Bearer CRON_SECRET` (e.g. `sst.config.ts:1402-1428`, `api/cron/subscriber-snapshot/route.ts`).

## 9. Define the Desired System Behavior

- **Disconnect:** UI → `disconnectPlatformAction` (wrapped `returnRefusals`) →
  load row (user client, RLS) → `REVOKERS[platform](row)` with 10 s timeout, outcome
  logged → `client.rpc('disconnect_platform_connection', { p_connection_id })` →
  returns `{ disconnected: uuid[], alreadyDisconnected: boolean }` → revalidate →
  toast → list re-query shows *Disconnected*.
- **Reconnect:** unchanged callbacks; the DB trigger does the re-attach bookkeeping.
- **Sync:** `fetchConnectionGrants` also selects `disconnected_at`;
  `syncEligibility` → `'disconnected'` → skipped silently.
- **Publish pickers:** `getConnectedPlatformsAction` adds `.is('disconnected_at', null)`.
- **(B) Purge:** SST cron hourly → `/api/cron/vendor-data-purge` →
  `runVendorDataPurges()` → for each due row: Postgres deletes/updates (admin client,
  paged) → ClickHouse mutations (if enabled) → verify zero → mark complete.

## 10. High-Level Architecture

Components and why each exists:

- **`public.disconnect_platform_connection(uuid)`** (Postgres, `security invoker`) —
  the single definition of "disconnected" (FR-1/2), testable in pgTAP exactly as the
  app calls it (a TS `update` would leave pgTAP testing a copy). Invoker so the
  existing RLS update policy is the authorisation.
- **Schema guards** — CHECK (no token on a disconnected row), BEFORE UPDATE trigger
  (writing a token clears `disconnected_at`), FK `NO ACTION` (a credential row cannot
  take user data with it). These make the rule hold for writers we did not write:
  six callbacks today, a seventh tomorrow, an operator in the SQL editor.
- **`REVOKERS` map** (TS, `publishing/src/oauth/revokers.ts`) — per-platform vendor
  revocation behind an exhaustive `Record<PlatformType, Revoker>`: the clean seam
  KB-25 fills for X/LinkedIn.
- **(B) `public.vendor_data_purges`** — queue *and* audit log (the runbook asks the
  operator to "note the date … somewhere the next audit can find"). No FK to the
  connection or account, so it outlives both.
- **(B) Purge job** (`content-analytics/src/server/vendor-data-purge/`) + cron route +
  lambda + SST Cron — the only code that deletes vendor data.

Trust boundaries: browser → server action (session, RLS); cron → route
(`CRON_SECRET`); job → Postgres (service role) and ClickHouse (server credentials).
Failure boundary: vendor revoke is best-effort and outside the transaction; the DB
step is atomic; the purge is retried independently of the disconnect.

## 11. Architecture and Flow Diagrams

**Disconnect (PR A + B):**

```
Browser            disconnectPlatformAction        Vendor           Postgres                        vendor_data_purges (B)
  │ confirm ─────────▶│
  │                   │ select row (RLS) ─────────────────────────▶│
  │                   │ REVOKERS[platform] ───────▶│ (best effort, 10 s, status logged)
  │                   │ rpc disconnect_platform_connection ───────▶│ UPDATE tokens=null, is_active=false,
  │                   │                                             │        disconnected_at=now()   (+ Meta linked rows)
  │                   │                                             │ AFTER UPDATE trigger (youtube) ──▶ insert (in_app_disconnect,
  │                   │                                             │                                    run_after +1h, due_by +7d)
  │◀── {ok, disconnected:[ids]} ───────────────────────────────────│
```

**Purge (PR B):**

```
SST Cron (hourly) → lambda → GET /api/cron/vendor-data-purge (Bearer)
  → select due purges (run_after ≤ now, completed_at null) order by due_by
  → per purge:  ids = publishes(C).platform_content_id ∪ CH video_dim(connection_id=C).video_id
                Postgres: delete revenue_records(api, publishes of C); delete youtube_report_jobs(C);
                          reset publishes.metadata.sync, duration_seconds; strip C.metadata display keys
                ClickHouse (if enabled): 6 video tables by (platform, video_id ∈ ids);
                          channel_daily, channel_subscribers by connection_id; video_dim last;
                          mutations_sync=2; verify count()=0
                → completed_at, result{table:count} | attempts++, last_error
  → overdue (now > due_by, not complete) → logger.error
```

**Connection lifecycle:**

```
            connect (callback upsert)
   (none) ───────────────────────────▶ ACTIVE ◀──────────── refresh ok ─────┐
                                        │  │                                  │
                         token dies     │  │ Disconnect (RPC)                 │
               (markConnectionInactive) ▼  ▼                                  │
                                   INACTIVE   DISCONNECTED ── reconnect ───────┘
                                   (expired)  (tokens null,    (upsert same key;
                                        │      disconnected_at) trigger clears flag)
                                        └── Disconnect ──▶ DISCONNECTED
   Any state ── account deleted ──▶ (row gone; B: purge enqueued)
```

## 12. End-to-End Data Flow

- **Vendor statistics:** vendor API → sync cron / report ingest → ClickHouse (9
  tables) + Postgres (`revenue_records` api, `metadata.sync` markers) → analytics
  pages. **Deletion:** only by the purge job (B), scoped by connection. **Loss
  points:** none new; **duplication:** a re-collection after reconnect rewrites the
  same `(project, platform, video, date)` keys in ReplacingMergeTree and the same
  revenue unique key — not duplicated; **stale:** between purge and re-collection
  charts are empty (by design, YouTube only).
- **User-authored data:** entered via forms → Postgres (`publishes`, manual
  revenue, tags, experiments, settings, configs). **Deletion:** only by the user's
  own actions or account deletion — never by a credential going away (FR-3/4).
- **Credentials:** OAuth callback → encrypted tokens on the row → wiped at
  disconnect → new ones on reconnect.
- **Re-collection after a YouTube purge:** purge clears `last_data_date` and
  `backfill_completed_at`; `computeYouTubeWindow` then starts from `publishedAt`
  (`analytics-sync-cron.ts:627-631`), so the hourly sync refetches the history
  YouTube still serves. Where YouTube no longer serves a range, that range is gone —
  the dialog says "collect them again from YouTube", not "restore".
- **Race:** an in-flight sync holding a token read before the disconnect could write
  after a too-early purge → `run_after = +1 h` and post-purge `count() = 0` check.

## 13. Data Model

| Entity | Authority | Lifecycle after this change |
|---|---|---|
| `platform_connections` | Postgres | Created by callback; ACTIVE ⇄ INACTIVE (token); → DISCONNECTED (user); DISCONNECTED → ACTIVE (reconnect same key); removed only with its account |
| `publishes` and user-authored children | Postgres | Independent of connection state |
| Vendor statistics | ClickHouse (+ `revenue_records` api) | Written by sync; deleted by purge job only |
| `vendor_data_purges` (B) | Postgres | pending → completed (or retried); kept as audit |

**Invariants:** (I1) `disconnected_at is not null ⇒ no tokens ∧ is_active = false`
(CHECK). (I2) writing a token clears `disconnected_at` (trigger). (I3) a connection
referenced by user data is not deletable on its own (FK). (I4, B) every YouTube
disconnect has exactly one purge row per disconnect event.

## 14. Database Design and Changes

**PR A migration** `<ts>_kb22-disconnect-keeps-records.sql` (hand-written; mirrored
into `schemas/32-platform-connections.sql`, `30-film-studio.sql`,
`73-channel-analytics-settings.sql`):

```sql
alter table public.platform_connections add column disconnected_at timestamptz;
comment on column … 'Set when the creator disconnected in-app; tokens are wiped. Cleared on reconnect.';

alter table public.platform_connections
  add constraint platform_connections_disconnected_holds_no_token check (
    disconnected_at is null
    or (access_token_encrypted is null and refresh_token_encrypted is null and not is_active));

-- writing a token = reconnecting
create function public.platform_connections_clear_disconnected() returns trigger …
  if new.access_token_encrypted is not null then new.disconnected_at := null; end if;
create trigger platform_connections_reconnect before insert or update on public.platform_connections …

-- a credential going away must never take user data with it
alter table public.publishes drop constraint publishes_platform_connection_id_fkey,
  add constraint publishes_platform_connection_id_fkey foreign key (platform_connection_id)
  references public.platform_connections(id) on delete no action;
-- same for channel_analytics_settings (composite, keep (id, account_id)),
-- episode_publishing_configs, project_publishing_configs.
-- youtube_report_jobs stays CASCADE (vendor registry, not user data);
-- analytics_experiments / short_publications / social_posts stay SET NULL (unreachable now).

create function public.disconnect_platform_connection(p_connection_id uuid)
  returns table (id uuid, already_disconnected boolean)
  language sql security invoker set search_path = '' as $$ … $$;
  -- updates the row and its Meta-linked rows (metadata->>'linked_page_id'),
  -- only where disconnected_at is null; returns what it changed.
grant execute on function … to authenticated;

drop policy platform_connections_delete on public.platform_connections;  -- decision 8
```

- **Existing data:** additive column, all null → every existing row is not
  disconnected; CHECK holds trivially. FK swap: `drop/add constraint` validates
  existing rows (all valid) — table sizes are small (one user); `not valid` is
  **not** used (workflow doc: a deferral postpones the rule's scan, not the rule).
- **Locking:** brief `ACCESS EXCLUSIVE` on the four child tables during the swap; small.
- **Rollback:** a down-migration can restore CASCADE, but should not be run — the
  point is that nothing cascades. App rollback alone is safe (§24).
- **Types:** `pnpm supabase:web:typegen` (generated, never edited). The generated
  file is shared with every teammate — regenerate after rebasing, never merge by hand.

**PR B migration** `<ts>_kb20-vendor-data-purges.sql`:

```sql
create table public.vendor_data_purges (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,          -- no FK: outlives the connection
  account_id uuid,                      -- no FK: outlives the account (audit)
  platform varchar(50) not null,
  reason varchar(30) not null check (reason in ('in_app_disconnect','request','connection_deleted')),
  requested_at timestamptz not null default now(),
  run_after timestamptz not null default now(),
  due_by timestamptz not null,
  started_at timestamptz, completed_at timestamptz,
  attempts int not null default 0, last_error text,
  result jsonb                           -- {"clickhouse":"deleted"|"disabled", "<table>": n, …}
);
create index … on (completed_at, run_after) where completed_at is null;
alter table … enable row level security;
revoke all … from anon, authenticated; grant select … to authenticated; grant all … to service_role;
create policy vendor_data_purges_read … for select to authenticated using (public.has_account_access(account_id));

-- enqueue: YouTube in-app disconnect (security definer, search_path '')
after update of disconnected_at on platform_connections
  when (old.disconnected_at is null and new.disconnected_at is not null and new.platform = 'youtube')
  → insert (…, 'in_app_disconnect', now() + interval '1 hour', now() + interval '7 days');
-- enqueue: connection row deleted (account deletion) — decision 6
after delete on platform_connections → insert (…, 'connection_deleted', now(), now() + interval '7 days');
```

No ClickHouse schema change (deletes use `ALTER TABLE … DELETE`), so no ClickHouse
migration number is needed.

## 15. Low-Level Design

**PR A**

- `packages/features/publishing/src/oauth/revokers.ts` (new):
  ```ts
  type RevokeOutcome = { status: 'revoked' | 'vendor_refused' | 'unreachable' | 'no_token' | 'not_implemented'; httpStatus?: number };
  type Revoker = (conn: RevokableConnection) => Promise<RevokeOutcome>;
  export const REVOKERS: Record<PlatformType, Revoker> = {
    youtube, tiktok, instagram: meta, facebook: meta,   // bodies moved from the three disconnect.ts files
    twitter: notImplemented, linkedin: notImplemented,  // KB-25
  };
  ```
  Each revoker: decrypt, `fetch` with `AbortSignal.timeout(10_000)`, classify
  `res.ok` (today the response is never read). No DB access.
- `server/connection-actions.ts` `disconnectPlatformAction`: schema unchanged
  (`connectionId`, `platform`); body: load row (RLS) → `ActionRefusal` if missing →
  `REVOKERS[row.platform]` (the stored platform, not the client's claim) → log →
  `rpc('disconnect_platform_connection')` → `revalidatePath`. Wrapped with
  `returnRefusals`. `deleteConnection` deleted.
- `oauth/{youtube,tiktok,meta,twitter}/disconnect.ts`: the four `disconnect*Action`
  exports become thin wrappers over the same path or are removed; they are exported
  from package indexes, so: keep the names, delegate (no dead second implementation).
  Twitter's stays uncalled — its wiring is KB-25.
- `getConnectedPlatformsAction`: `.is('disconnected_at', null)`.
- `getConnectionsAction` + `determineStatus`: `disconnected_at` → `'disconnected'`
  first; `ConnectionStatus` gains `'disconnected'`; row exposes `disconnectedAt`.
- `content-analytics/src/server/sync-authorisation.ts`: `ConnectionGrant.disconnectedAt`;
  `syncEligibility` → `'disconnected'` when set; `fetchPublishesForSync` skips it
  without counting it as not-authorised.
- UI (`platform-connections.tsx`): `ConnectionStatusBadge` gains `disconnected`;
  row renders the disconnected variant (§5); icon `Unplug`; dialog content from
  `disconnectCopyFor(platform)` (pure, `components/disconnect-copy.ts`); scheduled
  count via a small `countScheduledPublishesAction({connectionId})` fetched when the
  dialog opens (loading → count); mutation reads `ActionResult`.
- `platforms.json`: keys in §5; `disconnectDescription` removed.
- Data-deletion page paragraph + `docs/data-deletion-runbook.md` (Postgres no longer
  cascades on disconnect; procedure C adds `delete … source='api'` until PR B).

**PR B**

- `content-analytics/src/server/vendor-data-purge/plan.ts` (pure): given
  `{connectionId, platform, videoIds}` returns the ordered statement list; unit-tested
  so "nothing else" is a property of a pure function.
- `…/run.ts` `runVendorDataPurges({ now, limit })`: select due rows (admin client);
  per row: mark `started_at`; collect ids (`fetchAllRows` over publishes ordered by
  id; ClickHouse `SELECT DISTINCT video_id FROM video_dim FINAL WHERE connection_id`);
  Postgres steps (`fetchAllByIds` for revenue deletes); ClickHouse steps via
  `client.command({ query, query_params, clickhouse_settings: { mutations_sync: '2' } })`
  when `isClickHouseEnabled()`, else `result.clickhouse = 'disabled'`; verify counts;
  complete or record failure. Idempotent: every step is a delete/update by key.
- `apps/web/app/api/cron/vendor-data-purge/route.ts` (subscriber-snapshot pattern),
  `apps/web/lambda/vendor-data-purge/index.ts`, `sst.config.ts` Cron `rate(1 hour)`.
- Settings row shows purge status (reads `vendor_data_purges` for the connection).
- Runbook: procedures B/C/D → one `insert into public.vendor_data_purges …` +
  verification query; A keeps account deletion + (if decision 6) nothing more.

## 16. API and Event Design

| Interface | Change |
|---|---|
| `disconnectPlatformAction` (server action) | Input unchanged. Output was `{success:true}` or a throw → now `ActionResult<{ disconnected: string[]; alreadyDisconnected: boolean }>`. Auth: session + RLS. Idempotent. |
| `countScheduledPublishesAction({ connectionId })` (new) | → `ActionResult<{ count: number }>` (`count: 'exact', head: true` — not row-capped) |
| `rpc disconnect_platform_connection(p_connection_id uuid)` (new) | Returns `(id, already_disconnected)`; 0 rows = not found / no access |
| `getConnectionsAction` | Each item gains `status: 'disconnected'` possibility and `disconnectedAt: string \| null` |
| `getConnectedPlatformsAction` | Excludes disconnected rows (behaviour change for publish pickers only) |
| (B) `GET /api/cron/vendor-data-purge` | Bearer `CRON_SECRET`; 200 `{ processed, completed, failed, overdue }`; 401/500 as the sibling routes |
| (B) `vendor_data_purges` rows | The "event": inserted by triggers or the operator; consumed by the job; at-least-once, idempotent execution; no dead-letter — overdue rows are logged at error and stay visible |

## 17. State and Lifecycle Design

Connection: see §11. Valid transitions: ACTIVE→INACTIVE (refresh failure),
ACTIVE/INACTIVE→DISCONNECTED (RPC), DISCONNECTED→ACTIVE (token written),
INACTIVE→ACTIVE (reconnect or refresh). **Invalid:** DISCONNECTED with a token
(CHECK refuses); DISCONNECTED→INACTIVE by refresh (refresh never runs: `is_active`
false and no refresh token). Terminal: row removed only with the account.

Purge (B): `pending` (completed_at null, run_after future) → `due` → `running`
(started_at) → `completed` | back to `due` with attempts+1. `overdue` is a derived
condition, not a state. Terminal: completed.

## 18. Failure and Error Handling

| Operation | Failure | Behaviour | User | Recovery |
|---|---|---|---|---|
| Revoke | timeout / non-2xx / throw | outcome logged (`oauth.disconnect`, platform, status) | none | vendor settings links |
| RPC | 0 rows | `ActionRefusal("That connection no longer exists or you don't have access to it.")` | toast | refresh |
| RPC | DB error | thrown (KB-6: unexpected stays thrown → client fallback text via `refusalMessage`) | generic toast | retry |
| Count scheduled | error | dialog shows no count line (not "0") | — | — |
| Purge Postgres step | error | abort this purge, attempts++, last_error | pending status | next run |
| Purge ClickHouse step | error / count ≠ 0 after | same; Postgres part already done is idempotent to redo | pending | next run |
| Purge overdue | now > due_by | `logger.error({ name: 'vendor-data-purge.overdue', purgeId, connectionId, platform, due_by })` | — | operator (runbook) |
| Trigger enqueue during account deletion | insert fails | would abort the account deletion → trigger body is minimal, no FKs on the table, pgTAP covers it | — | — |

## 19. Security

- **AuthZ unchanged for disconnect:** RLS update policy `has_account_access`; RPC is
  `security invoker` so it cannot widen it. The action trusts the **stored** platform
  for choosing the revoker, not the client's `platform` field.
- **Least privilege:** drop `platform_connections_delete` (no app path needs it after
  this change; today any member can `DELETE` via PostgREST, bypassing the dialog and
  the revoke). Account deletion is unaffected (cascade ignores RLS).
- **Secrets:** tokens wiped at disconnect; never logged; revoke logs status only.
- **Purge table:** members read their own account's rows; writes by triggers
  (`security definer`, `search_path = ''`) and service role only; no anon access.
- **Tenant isolation of the purge:** every statement keyed by one `connection_id`
  (and the video ids derived from it); tested with a second connection — and a second
  account — side by side.
- **Cron route:** bearer check before any work, as siblings.
- **Sibling findings (reported, not fixed here — lead to assign KB numbers if wanted):**
  (a) `platform_connections_read` lets any member select `access_token_encrypted` /
  `refresh_token_encrypted` (ciphertext, but still more than a member needs);
  (b) `anon` holds `TRUNCATE` on `platform_connections` — Supabase's default grant,
  not reachable through PostgREST, but RLS does not apply to TRUNCATE.

## 20. Performance and Scale

One user today; a channel has at most thousands of publishes. Disconnect: one
select, one vendor call (≤ 10 s), one UPDATE. Purge: O(publishes) Postgres rows,
paged; ClickHouse: 9 mutations per purge with `video_id IN (…)` — chunk the id list
at 1,000 per statement to keep the query size bounded; `mutations_sync=2` makes the
job wait for completion (seconds at this volume). Hourly schedule, `limit` 20 purges
per run. The sync cron's `limit * 2` fetch (`analytics-sync-cron.ts:324`) could fill
with a disconnected channel's publishes and starve others — so the skip happens in
the query (`platform_connections!inner(disconnected_at)` filter), not only in
`syncEligibility`.

## 21. Accessibility and Client Behavior

AlertDialog (Radix) keeps focus trap, Escape to cancel, focus returns to the
trigger. Disconnect trigger gets an accessible name ("Disconnect {accountName}"),
not only `title`. Badge conveys state in text. The confirm button's pending state
uses `aria-busy` and the spinner has a label. Dialog text is paragraphs + a list
(screen readers read "Kept: …" as a list). Layout works at phone width (the row's
action group wraps). Dates via `date-fns` `format` in the user's locale.

## 22. Observability and Operations

- Logs: `oauth.disconnect` `{ connectionId, platform, revoke: outcome, httpStatus, disconnected: n }`;
  `vendor-data-purge` per purge `{ purgeId, connectionId, platform, reason, result }`;
  `vendor-data-purge.overdue` at **error** (the alert).
- Operator's check that it works: `select reason, requested_at, due_by, completed_at, result from vendor_data_purges order by requested_at desc` — every YouTube disconnect has a row, completed well before `due_by`.
- Distinguishing expected from failure: `result.clickhouse = 'disabled'` in
  production is expected; `completed_at is null and now() > due_by` is a breach.

## 23. Configuration and Feature Flags

No flag: the fix removes a data-loss path; there is no safe "off". PR B uses
existing `CRON_SECRET`, `CLICKHOUSE_ENABLED`/`CLICKHOUSE_*`, `API_URL`. Purge timing
constants (`RUN_AFTER = 1 h`, due windows) live in the migration's trigger (the
policy windows) and are asserted in pgTAP. No production values are read or needed.

## 24. Compatibility

- **Old app + new schema** (deploy window): old code's `DELETE` on a connection with
  publishes fails (FK) → "Failed to disconnect" — fails closed, no loss. A connection
  with no dependents would still delete — but the RLS delete policy is gone, so it
  fails too (user client). Acceptable for minutes.
- **New app + old schema:** RPC missing → action errors. Deploy order: migrations first
  (`scripts/deploy.sh` runs them first; note KB-2: it continues on migration failure —
  verify the migration applied before relying on the app).
- **Existing rows:** unaffected (column null). Connections already deleted before this
  ships are gone; nothing recovers them.
- **Consumers of `ConnectionStatus`:** the new `'disconnected'` member is handled
  wherever the type is switched (typecheck finds them).
- **KB-25:** fills `REVOKERS.twitter/linkedin`; the dialog key `revoke.notYet` is
  then unused and removed with it.

## 25. Migration and Rollout Strategy

1. PR A merged → deploy: migration, then app. Validate: disconnect a test
   connection locally-equivalent in production? **No** — no production data or
   credentials are used by us; the owner validates by disconnecting/reconnecting a
   non-critical channel if they wish (runbook line).
2. PR B merged → deploy: migration, app, lambda + SST Cron. Validate: the cron's
   first response in logs (`processed: 0` expected).
3. Rollback triggers: disconnect errors in logs; purge overdue errors. Rollback: app
   revert (schema stays); purge cron can be disabled by removing it from SST without
   schema change.

## 26. Testing Strategy

Every guard below is run **red first** on unmodified code (or with the fix reverted),
then green; results recorded in the PR.

| Layer | Test | Red on `main` because |
|---|---|---|
| pgTAP (A) | `platform-connection-disconnect.test.sql`, `plan(N)`: seed the §8 fixture for account *storybook* and a second account; as `member`: `disconnect_platform_connection(A)` → each of the 11 user-authored counts unchanged; tokens null, `is_active` false, `disconnected_at` set; B untouched; outsider gets 0 rows; second call returns `already_disconnected`; CHECK refuses a token on a disconnected row; simulated callback upsert keeps the id and clears the flag; member `DELETE` refused; `postgres` `DELETE` → 23503; **account deletion lives_ok and leaves nothing** | function/columns absent; cascade deletes; DELETE allowed |
| pgTAP (B) | `vendor-data-purges.test.sql`: trigger enqueues one row for YouTube, none for TikTok; windows are 1 h / 7 d; re-disconnect after reconnect enqueues again; account deletion enqueues one per connection and still succeeds; RLS: members read own account's rows only | table absent |
| Unit (A) | `sync-authorisation.test.ts` `'disconnected'`; `disconnect-copy.test.ts` (every `PlatformType` has copy; copy for platforms whose revoker is `notImplemented` says so — bound to `REVOKERS`); `revokers.test.ts` against a **local listener** (status classified, timeout honoured); action test: RPC called, no `.delete()`; grep-guard test: no `.from('platform_connections'…).delete(` in app code | new code |
| Unit (B) | `plan.test.ts`: statements touch exactly the nine tables + two Postgres tables, keyed only by the given connection/video ids; ordering (`video_dim` last) | new code |
| ClickHouse (B) | `packages/clickhouse` integration (gated like `verify-queries`, `local-env.sh verify`): seed connections A and B across all nine tables; purge A; per table A = 0, B unchanged; view `video_daily_stats` for A empty | new code |
| E2E (A) | `apps/e2e/tests/platform-connections/disconnect-keeps-records.spec.ts`: seed via API (team, YouTube connection, published episode, manual $50.00, tag); settings → disconnect dialog (assert copy) → confirm → row *Disconnected* → analytics page shows $50.00 → **reconnect through the real `/api/platforms/callback/youtube`** with a local listener standing in for `google-token` and `youtube-data` (`VENDOR_URL_*`, `VENDOR_SANDBOX=1`, FILM-1801's rules; fake app credentials seeded into `oauth_app_credentials`) → row *Connected*, same id → **$50.00 still there after reconnect**; second disconnect of the same row works (the "second submission") | disconnect deletes the $50.00 |
| E2E evidence | same spec under `CAPTURE_EVIDENCE=1`: before (run on `main`: old dialog; revenue gone after disconnect) and after screenshots: dialog YouTube, dialog TikTok, dialog X, disconnected row, revenue after disconnect, row after reconnect, revenue after reconnect | — |
| Prod build | `pnpm --filter web-e2e test:prod` for the new spec; refusal text visible in prod build | — |

Fallback if the local OAuth listener proves infeasible in the time box: reconnect by
issuing the callback's exact upsert through the service-role REST API, and say so in
the PR — weaker, because it would not exercise the callback code.

## 27. Production-Build Verification

`next build` + `start:test` (`test:prod`) runs the E2E spec: the action's refusal
values render (KB-6), the dialog copy is the i18n text (not `defaults`), the RPC is
called with the generated types. The purge route is exercised against the prod build
with `CRON_SECRET` from the local test env (never a production value), with ClickHouse
enabled via `deployment/config/local.env` and once disabled, asserting
`result.clickhouse` is `deleted` and `disabled` respectively.

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Prod verification |
|---|---|---|---|---|---|---|---|
| Lose nothing I wrote | 2→3→4 | FR-1,3,4,5 | RPC + FK NO ACTION | migration, action | `disconnect_platform_connection` | pgTAP A, E2E | test:prod E2E |
| No credential kept | 3 | FR-2 | CHECK + RPC | migration | columns | pgTAP A | — |
| Reconnect to my history | 6→7 | FR-6,8 | trigger; eligibility | migration, sync | upsert | pgTAP A, E2E, unit | test:prod E2E |
| Know what happens | 2 | FR-9,11 | copy bound to revokers | UI, i18n | — | unit, E2E screenshots | test:prod E2E |
| Errors readable | 3 | FR-10 | returnRefusals | action | ActionResult | unit, E2E | test:prod |
| Not offered for publishing | — | FR-7 | query filter | action | — | unit | — |
| YouTube stats deleted in window | 5 | FR-12,13,14,15 | queue + job | B | purges table, cron | pgTAP B, CH integration, unit | route under prod build |
| Requests automated | — | FR-16,17 | insert = request | runbook, triggers | purges table | pgTAP B | runbook exercised locally |

## 29. Architectural Alternatives and Trade-offs

| Decision | Chosen | Alternatives | Why |
|---|---|---|---|
| Keep history | Soft-disconnect the row | `publishes.platform_connection_id` → `SET NULL` | Loses which channel a publish went to; experiments and YPP targets are per channel; reconnect could not re-attach |
| Where "disconnected" lives | SQL function + constraints | TS update | pgTAP tests exactly what the app calls; constraints bind writers we did not write |
| Reconnect bookkeeping | DB trigger | Edit six callbacks | Six places to forget; a seventh later |
| FK action | `NO ACTION` | `RESTRICT` | `RESTRICT` checks immediately and can break the account-deletion cascade depending on order; `NO ACTION` checks at statement end |
| Purge trigger | Queue table + cron | Inline in the action | Survives ClickHouse outages, retries, is the audit log, serves requests and account deletion too; inline would also race in-flight syncs |
| YouTube timing | ASAP (+1 h) | Grace window cancelled by reconnect | Policy text deletes data stored under the revoked consent; re-collection makes ASAP cheap for the user |
| CH delete | `ALTER TABLE … DELETE`, `mutations_sync=2` | lightweight `DELETE FROM` | Physical removal, matches the runbook; volume is tiny |
| Split | Two PRs (A then B) | One PR | A stops the High data loss quickly; B is a new subsystem with its own review surface |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| FK change breaks account deletion (KB-1 shape) | Users undeletable | pgTAP account-deletion case | `NO ACTION`, tested | Revert FK in a migration |
| A reader treats a kept disconnected row as live | Publishing to / syncing a dead channel | typecheck on new status; unit tests; E2E publish screen | `is_active=false` fails closed everywhere today (§8) | — |
| Trigger enqueue failing aborts account deletion | Undeletable | pgTAP | minimal trigger, no FKs on queue | drop trigger |
| `video_dim.connection_id` missing for old rows | Purge misses rows for connection_deleted | CH integration test; post-purge verification query in runbook | also collect ids from publishes | runbook A by account_id |
| In-flight sync writes after purge | Data survives window | post-purge count check | +1 h, tokens wiped first | retry |
| Local OAuth listener for E2E harder than expected | Reconnect not driven through callback | — | time-boxed; fallback in §26 stated | say so in PR |
| Generated types conflict with teammates | Red CI | CI regen check | regenerate after rebase | — |
| Legal copy overclaims | Vendor-review risk | owner review | DRAFT, every sentence mapped to a test | — |
| Scheduled publishes silently fail later | Missed post | dialog count; failed status visible | decision 7 | cancel on disconnect instead |

## 31. Open Questions and Assumptions

1. **(Decision 2)** Does a reconnect within the window cancel the YouTube purge? Assume **no** (policy text). Needs owner.
2. **(Decision 3)** Is the channel id/title "statistics"? Assume **no**: kept to label history and re-attach; vendor display metadata (thumbnail, avatar) is stripped. Needs owner.
3. **(Decision 5)** 30-day dead-token purge: assume **deferred** until KB-29 lands — today KB-29 makes YouTube refresh fail for connections made since 2026-01-21, so automating it would delete the owner's statistics because of our bug. Runbook D stays manual.
4. TikTok's terms remain unverified (KB-20); assume "keep until asked" as decided.
5. Assumption: `revenue_records` `source='api'` rows are always per-publish (`publish_id`), never account-level; verified in Phase 2 before writing the delete.
6. Assumption: a disconnected row stays in the list forever; a "remove channel" action (purge + hide) is a follow-up, not this ticket.

## 32. Implementation Plan

**PR A — keep the records (fixes the High bug)**
1. pgTAP file written against current schema → run red (DB lock, reset). 
2. Migration (column, CHECK, trigger, FKs, RPC, drop delete policy) + schema mirrors → `migration up`, typegen → pgTAP green; revert migration → red again → restore.
3. `revokers.ts` + unit tests (local listener) red→green.
4. `disconnectPlatformAction` rewrite + `returnRefusals`; four `disconnect*Action` delegate; remove `deleteConnection`; grep guard test.
5. Readers: `syncEligibility` + query-level skip; `getConnectedPlatformsAction` filter; status/`disconnectedAt` in `getConnectionsAction`.
6. UI + i18n + `disconnect-copy.ts` + tests; scheduled count action.
7. E2E spec + local OAuth listener; red on `main` (manual revenue gone), green on branch; evidence screenshots before/after.
8. Data-deletion page paragraph (DRAFT) + runbook; KB-22 entry → Fixed (A part) row; typecheck, lint, format, test:prod.

**PR B — delete vendor data on schedule (KB-20 item 3), stacked on A**
1. pgTAP B red → migration (table, RLS, triggers) → green.
2. `plan.ts` + unit tests; `run.ts`; ClickHouse integration test red→green against local 24.8.
3. Cron route + lambda + SST Cron (+ KB-14's lambda typecheck list if it has landed).
4. Settings row purge status; runbook rewrite; data-deletion page account-deletion bullet (if decision 6); KB-20 item-3 box ticked.

Rollback per stage: each is a revert of its commit; the schema pieces are additive
except the FK swap and the dropped policy (both safe to keep).

## 33. Definition of Done

- The §8 reproduction, rerun on the branch, shows every user-authored count unchanged.
- pgTAP A/B green, each seen red first for its stated reason; account deletion case green.
- Unit tests green (seen red); ClickHouse integration green against the real local server (B).
- E2E disconnect → reconnect green on dev and under `test:prod`, asserting $50.00 after reconnect; screenshots (before and after, including after the action) in the PR.
- `pnpm typecheck`, `lint:fix`, `format:fix` clean; types generated, not edited.
- Dialog, data-deletion page and runbook each describe what the code does — every sentence traced to a test (§28); legal text marked DRAFT for the owner.
- FILM-CC-04: KB-22 marked Fixed (with PR numbers) and one row in the Fixed table; KB-20 item-3 box ticked by PR B.
- Sibling findings (§19) reported to the lead.

## 34. Final Consistency Pass

**Forward.** Problem: one click deletes what a person typed, while the vendor's data
stays forever. Outcome: disconnect removes access only; YouTube's statistics go on
YouTube's schedule; everything the creator wrote stays and re-attaches. The user
presses Disconnect, reads what will happen, confirms, sees *Disconnected*, still sees
their revenue, reconnects, sees it attached. The system must stop deleting the row
(RPC), stop anything else from deleting it with user data attached (FK, policy), keep
readers from treating it as live (is_active=false already fails closed; sync and
pickers filter), re-attach on reconnect (trigger), and — B — delete vendor rows by
connection on schedule (queue + job). Tests exercise each at the layer that can see
it; the E2E drives the real dialog and the real callback; production build verified.

**Reverse.** In production the action issues one vendor call and one UPDATE; no row is
deleted; the CHECK and trigger keep the row consistent; the FK refuses any other
attempt to remove it with user data. The user sees the row disconnected and their
figures intact — flow steps 3–4 — and on reconnect the same row, satisfying FR-6 and
the AC "manual revenue still there after reconnect". With B, the queue row and job
delete exactly one connection's vendor rows; with `CLICKHOUSE_ENABLED=false` the job
records `disabled` rather than claiming a deletion, which is what the data-deletion
page may truthfully say. The two paths converge on the owner's decision: keep until
asked, YouTube carved out.
