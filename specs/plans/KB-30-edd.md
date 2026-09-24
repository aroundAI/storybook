# EDD — KB-30: every YouTube upload declares "not made for kids", with no way to change it

- **Ticket:** KB-30 in `specs/cross-cutting/FILM-CC-04-known-bugs.md:1923`
- **Branch:** `fix/kb-30-youtube-made-for-kids` (from `origin/main` @ `52ed2ade`)
- **Teammate:** yt-kids (NN=07, dev server port 3107)
- **Status:** Approved and built (#KB30PR).
- **Owner decisions (2026-09-24):** Q1 — per YouTube channel. Q2 — no default; the first publish to
  each channel asks for the audience **and** the category in one required dialog, nothing pre-selected.
  Members' access to `platform_connections` is moving to column-level grants (KB-43/44), so the two
  columns are granted by name.

---

## 0. Summary

The product sends YouTube an audience declaration (`selfDeclaredMadeForKids`) and a category on every
upload. The creator never chose either value, and the publish screen never shows them. The fix:

1. **The audience is a property of the YouTube channel.** It is stored on the connection row
   (`platform_connections.youtube_made_for_kids`, nullable, **no default**). *Owner decision Q1.*
2. **Undeclared means the product asks.** Publishing or scheduling to an undeclared YouTube channel
   opens a required question ("Is *<channel>* made for kids?"). The answer is saved to the channel,
   and nothing is sent until it is answered.
3. **Every YouTube upload path uses one resolver.** Four upload sites across three files (in-app
   publish and retry, the in-app cron, and the lambda worker) call one pure function, which never
   falls back to `false` or `'22'` and refuses when it has no answer.
4. **The request carries the choice explicitly, and the publish row snapshots it.** Scheduled
   publishes, retries and the lambda therefore all send what the user saw.
5. **Category** uses the same mechanism and the same question (`youtube_category_id`). *Owner decision Q2.*

---

## 1. Start with the user

**Who:** the account owner, the sole first end-to-end user (memory: *owner-is-first-end-to-end-user*).
They publish episodes to one or more YouTube channels, typically one per language, plus other platforms.

**Problem:** YouTube requires each upload to declare whether the video is made for children
(COPPA; YouTube's "Audience" setting). Today every upload from the app declares "No, not made for
kids" and category 22 (People & Blogs). The user never sees or chooses these values. For a channel
whose content is child-directed, that is a false declaration made in the creator's name, and the
creator carries the liability. There is no control anywhere in the live UI to change it.

**After the fix, the user can:**
- See, for each YouTube channel, which audience and category the app will declare.
- Be asked once per channel, at the moment it matters (their first publish or schedule to that
  channel), with no pre-selected answer.
- Change the answer later, on the channel's row in *Settings → Platforms* (next to the channel's
  language selector, which already works this way).
- Trust that scheduled publishes, retries and the background worker send the answer they chose.

**Success:** YouTube receives `status.selfDeclaredMadeForKids` equal to the user's answer, and
`snippet.categoryId` equal to their chosen category, on every path.
**Failure (by design):** with no answer, nothing is uploaded. The user is asked, or, for a job
already queued before the fix, the publish fails with a message that says what to set.

**Persists:** the per-channel answer (DB) and the per-publish snapshot (`publishes.metadata`).
**Does not persist:** an answer from a question that was dismissed or cancelled.

---

## 2. User journey

| # | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| J1 | Opens *Publish* for an episode | Loads connections, including the new columns | Sidebar lists channels. A YouTube channel with no answer shows an "Audience not set" chip | Publish / Schedule |
| J2 | Clicks **Publish**. At least one target YouTube channel is undeclared | Client gate finds the undeclared target channels **before** translation starts | **"YouTube audience" dialog**: one required row per undeclared channel with *Made for kids* / *Not made for kids* (no pre-selection) and a category select (no pre-selection). **Continue** is disabled until every row is answered | Answer or Cancel |
| J3 | Answers and clicks **Continue** | `updateYouTubeChannelSettingsAction` per channel (RLS: account role) | Dialog closes. The flow resumes where it was (translation, then confirm) | Confirm |
| J4 | Reviews the confirm step | — | Each YouTube row in the confirm list shows "Made for kids" / "Not made for kids" and the category | Confirm upload |
| J5 | Confirms | `publishToAllAction` with `platformSpecific.madeForKids` and `categoryId` set explicitly. The server re-resolves, snapshots them into `publishes.metadata`, then uploads | Progress dialog as today | Done |
| J6 | Schedules a release (Schedule panel) | Same gate as J2 before `handleScheduleRelease` builds configs | Same dialog, then "Scheduled N uploads" | — |
| J7 | Changes their mind later | Settings → Platforms → YouTube row → Audience select → same action | Toast "Audience set to …". Future publishes use it. Already-scheduled rows keep their snapshot (§31 Q3) | — |
| J8 | Cancels the dialog | Nothing saved, nothing published | Returns to the publish screen with its state intact | Retry |
| J9 | Refreshes mid-dialog | No write happened | Channel is still undeclared, so the question appears again next time | — |

Entry points for publishing: `publish-screen.tsx` `handlePublish` (line ~1000) and
`handleScheduleRelease` (line ~800). There is no other live YouTube publish UI; `PublishHub` and
`MetadataEditor` are not rendered (FILM-710 retired).

---

## 3. Happy path (reference behaviour)

1. The user opens Publish on an episode with an uploaded English full video. They have one YouTube
   channel "Acme Kids" (en), with `youtube_made_for_kids = null` and `youtube_category_id = null`.
2. They click **Publish**. `ensureYouTubeAudience(targets)` sees Acme Kids is undeclared and opens
   the dialog.
3. They choose **Made for kids** and category **Film & Animation (1)**, then Continue.
   `updateYouTubeChannelSettingsAction({connectionId, madeForKids: true, categoryId: '1'})` updates
   the row through the user's client (RLS `platform_connections_update`). The connections query is
   invalidated.
4. Translation runs as today. The configs now carry `platformSpecific: { madeForKids: true, categoryId: '1' }`
   for the YouTube row. This is the **request payload** that AC1 asserts on.
5. They confirm. `publishToAllHandler` validates all YouTube configs **before inserting any row**.
   `resolveYouTubeDeclaration(platformSpecific, connection)` returns `{ madeForKids: true, categoryId: '1' }`.
   The publish row is inserted with `metadata.madeForKids = true`, `metadata.categoryId = '1'`.
6. `uploadToYouTube` sends `status.selfDeclaredMadeForKids: true` and `snippet.categoryId: '1'`.
7. The user sees success. Publishing to the same channel next time asks nothing, and the confirm
   step shows "Made for kids · Film & Animation".

---

## 4. Alternate paths

| Trigger | System behaviour | User sees | Recovery | Final state |
|---|---|---|---|---|
| Dialog cancelled | No write, no publish | Publish screen unchanged | Click Publish again | Channel undeclared |
| Save action fails (network, RLS) | Toast error. Dialog stays open with its answers | "Could not save the audience for <channel>" | Retry Continue | Unchanged |
| Request bypasses the UI (crafted, or stale client) with no `madeForKids` and channel null | Server returns `ActionRefusal` **before any `publishes` insert** (returned as a value, so the message survives prod redaction) | Error text naming the channel | Declare, then retry | No row created |
| Request carries `madeForKids` while the channel is null | Accepted. The request value is snapshotted. Channel stays null (the server does not write channel settings as a side effect) | Normal | — | Row snapshot = request |
| Request `madeForKids` differs from the channel value | Request wins, and is snapshotted | Normal | — | See Q3 |
| Legacy scheduled row (created before deploy, no snapshot) reaches the cron or lambda | Resolver falls back to the channel column. If that is null too, it refuses | Publish marked **failed** with "YouTube audience not declared for this channel — set it in Settings → Platforms, then retry" | Declare, then **Retry** (retry resolves the same way) | Published after retry |
| Retry of a failed publish | `retryPublish` resolves (snapshot, then channel) and writes the resolved value back into metadata | Normal | — | — |
| Non-YouTube connection receives the setting | DB CHECK refuses. The action also refuses | Error toast | — | Unchanged |
| Two tabs answer differently | Last write wins on the channel. Each publish snapshots what its own request sent | — | — | Consistent per publish |
| Channel disconnected, then reconnected (KB-22) | OAuth callbacks upsert only token and name columns, so the new columns survive (verified by test) | Previous answer kept | — | — |
| Account member without access to the account | RLS refuses the update | Error toast | — | Unchanged |

Not applicable: large inputs, pagination, timeouts beyond the existing upload path.

---

## 5. User-facing contract

- **Inputs:** audience ∈ {made for kids, not made for kids}, with no pre-selection. Category ∈ the
  assignable YouTube category list (static, §15), with no pre-selection.
- **Dialog** `data-test="youtube-audience-dialog"`. One row per channel:
  `data-test="audience-row"` with `data-connection-id`. Radio group
  `data-test="audience-made-for-kids"` / `"audience-not-for-kids"` and select
  `data-test="audience-category"`. Continue is disabled until all rows are complete
  (`data-test="audience-continue"`).
- **Copy (proposed):** title "Who is this YouTube channel for?". Body: "YouTube requires every upload
  to say whether it is made for children. You decide this for your channel; we'll send it with every
  upload and you can change it in Settings → Platforms." Link text "YouTube's guidance"
  (support.google.com, a plain link, not a vendor API host).
- **Settings → Platforms** YouTube row: an "Audience" select (Not set / Made for kids / Not made for
  kids) and a "Category" select beside the language select. "Not set" cannot be chosen once a value
  is set, because clearing is not offered (§31 Q4).
- **Confirm step:** each YouTube entry shows the declared audience and category.
- **Sidebar channel badge:** YouTube channels with no answer show "Audience not set".
- **Server error (refusal):** "Choose whether “<channel>” is made for kids before publishing to YouTube."
- **Tags placeholder** "animation, kids, story" (`publish-settings-sidebar.tsx:86`) becomes a neutral
  "episode, series, topic". The KB names it as a nudge toward "kids".

---

## 6. Functional requirements

| ID | Requirement | Verification |
|---|---|---|
| FR-1 | A YouTube connection has a nullable audience and a nullable category. Neither has a default | pgTAP: columns nullable with no default. Insert leaves them null |
| FR-2 | Only YouTube rows may carry them (CHECK) | pgTAP |
| FR-3 | A member with a role on the account can set them. Others cannot (existing policy) | pgTAP |
| FR-4 | Publish and Schedule never send a YouTube config for an undeclared channel. They ask first | Playwright (red on main: no dialog, payload `platformSpecific: {}`) |
| FR-5 | Every YouTube config in the `publishToAllAction` request carries explicit `madeForKids` and `categoryId` | Playwright request-payload assertion |
| FR-6 | The server refuses an unresolved YouTube config before inserting any publish row | Unit (handler, mocked client) and E2E via direct action call |
| FR-7 | The server snapshots the resolved values into `publishes.metadata` | E2E (DB read of the scheduled row) |
| FR-8 | All YouTube upload sites (in-app immediate, retry, in-app cron, lambda worker) use one resolver. None has a literal `false` or `'22'` fallback | Unit (resolver table) plus parity test (lambda vs in-app, same captured body). Grep guard |
| FR-9 | For a row with no snapshot, the resolver uses the channel value. If both are missing it refuses with an actionable message | Unit |
| FR-10 | The user can change the channel value in Settings → Platforms | Playwright (second submission) |
| FR-11 | The confirm step shows the audience per YouTube target | Playwright plus screenshot |

---

## 7. Non-functional requirements

- **Compliance:** the core of the ticket. No code path may produce a declaration the user did not
  make. This is enforced structurally: the resolver has no fallback value.
- **Performance:** one extra PATCH per newly declared channel, and two extra columns on an existing
  read. Negligible.
- **Security:** writes go through the user's client under the existing RLS. There is no new
  service-role write.
- **Accessibility:** a Radix RadioGroup with labels. Focus moves to the first unanswered row. The
  disabled Continue button has `aria-describedby` explaining why.
- **Backward compatibility:** legacy `scheduled` rows keep working once the channel is declared (FR-9).
- **Observability:** refusals are logged with `{connectionId, publishId, reason: 'youtube_audience_undeclared'}`.
- **i18n:** strings go through `Trans` with defaults, matching `platform-connections.tsx`.

---

## 8. Existing system (verified 2026-09-24 on `52ed2ade`)

**Reproduced (runtime, lambda path).** A throwaway vitest called
`apps/web/lambda/publish-worker/handlers/youtube.ts#uploadToYouTube` with `metadata: {}`, against a
local listener standing in for `VENDOR_URL_YOUTUBE_DATA`. The captured `POST /upload/youtube/v3/videos` body was:

```
{"snippet":{"title":"T","description":"","tags":[],"categoryId":"22"},
 "status":{"privacyStatus":"public","madeForKids":false,"selfDeclaredMadeForKids":false}}
```

**Confirmed by reading (in-app path):** `publish-screen.tsx:845,872,1070,1113` build every YouTube
config with `platformSpecific: {}`. `publish-actions.ts:682,685` default `categoryId ?? '22'`,
`madeForKids ?? false`.

**Bigger than recorded — four YouTube upload sites, not two:**

| Site | Default today | Reads |
|---|---|---|
| `packages/features/publishing/src/server/publish-actions.ts:650-692` `uploadToYouTube`: immediate publish (`:275`) **and** `retryPublish` (`:528`, which feeds `publish.metadata` in as `platformSpecific`) | `?? '22'`, `?? false` | request / row metadata |
| `packages/features/publishing/src/jobs/process-scheduled-publishes.ts:473-499`: the in-app cron (`/api/cron/publish-scheduled`, `jobs/cron/scheduler.ts`). **Not in the KB** | `?? '22'`, `?? false`, `privacy ?? …` | `publishes.metadata` |
| `apps/web/lambda/publish-worker/handlers/youtube.ts:39-45`, fed by `apps/web/lambda/scheduled-publish/index.ts:235` (SST cron, `sst.config.ts:1372`) | `?? '22'`, `?? false` (both fields) | `job.metadata` = `publishes.metadata` |
| `providers/youtube/youtube-provider.ts:50-63` | none (passes input through) | — |

`uploadToYouTube` is copy-pasted between `publish-actions.ts` and `process-scheduled-publishes.ts`,
and the lambda builds its own resource.

**Data flow today:** request `platformSpecific` → `publishes.metadata` (`publish-actions.ts:178`) →
read back by retry, the cron and the lambda. So a value put in the request and snapshotted reaches
every path. That is the lever this design uses.

**Other facts that shaped the design:**
- `platform_connections` already holds a per-channel user setting, `language`, edited on the
  Settings → Platforms row (`platform-connections.tsx:305-370`, `updateConnectionLanguageAction`,
  `connection-actions.ts:269`). Policy `platform_connections_update` uses `has_role_on_account`, and
  there is a table-wide `update` grant to `authenticated` (`20251205125737…:581`).
- `platform_connections.metadata` is **overwritten by every OAuth callback upsert**
  (`callback/*/route.ts`), so the audience cannot live there. A reconnect would erase it.
- `project_publishing_configs` (project × channel) is edited in project settings but **never read by
  the publish flow** (grep with a positive control). It is not a usable home, and it is noted as a lead (§30).
- `PlatformSpecificSettingsSchema` already has `madeForKids?` and `categoryId?`
  (`publish.schema.ts:21-37`). No API shape change is needed.
- `getDefaultPlatformSettings('youtube')` returns `madeForKids: false, categoryId: '22'`
  (`platform-limits.ts:170-175`). It is used only by the unrendered `PublishHub`.
- Vendor stand-in pattern: `VENDOR_SANDBOX=1` plus `VENDOR_URL_YOUTUBE_DATA` (FILM-1801), as used by
  `youtube-root-url.test.ts` and the KB-22 E2E.

---

## 9. Desired system behaviour

- **Declare:** dialog/settings → `updateYouTubeChannelSettingsAction` → `update platform_connections
  set youtube_made_for_kids, youtube_category_id where id = ?` (user client, RLS) → invalidate
  `['platform-connections', accountId]` and the publish screen's connections query.
- **Publish/schedule:** client gate → configs carry explicit values → `publishToAllHandler`
  pre-validates every YouTube config (reads the connection's two columns with the existing
  connection read) → insert row with the resolved snapshot → upload through the shared resolver.
- **Cron / lambda / retry:** read `publishes.metadata` plus the connection's two columns → resolver →
  upload, or fail the row with an actionable message.

---

## 10. High-level architecture

No new services. Changes sit inside existing boundaries:
- **DB:** two columns on `platform_connections`.
- **`@kit/publishing`:** a new pure module `lib/youtube-declaration.ts` (no imports beyond types, so
  lambdas can load it, as they already load `lib/token-expiry`), a new server action, and a
  deduplicated `server/youtube-upload.ts` used by `publish-actions.ts` and `process-scheduled-publishes.ts`.
- **Lambda worker:** imports the resolver and reads the two columns in its existing connection read.
- **Web app:** a gate hook and dialog in the publish `_components`, a confirm-step display, and a
  settings-row control in `platform-connections.tsx`.

Trust boundary: the client gate is UX. **The server resolver is the guard.** A crafted request
without a value is refused (FR-6).

## 11. Diagrams

```
            ┌──────────── Publish screen ───────────┐
 click ───▶ │ ensureYouTubeAudience(targets)        │──undeclared──▶ Audience dialog ─▶ updateYouTubeChannelSettingsAction ─▶ platform_connections
            │ build configs {madeForKids, categoryId}│◀──────────────── resolved ─────────────────────────────────────────────┘
            └──────────────┬─────────────────────────┘
                           ▼ publishToAllAction (request payload = AC1 assertion point)
            resolveYouTubeDeclaration(request, connection) ── missing ─▶ ActionRefusal (no row)
                           │ ok
                           ▼ insert publishes.metadata {madeForKids, categoryId}  (snapshot)
          ┌────────────────┼──────────────────────┬──────────────────────────┐
          ▼ now            ▼ retry                ▼ in-app cron              ▼ SST cron → SQS → publish-worker
   youtube-upload.ts  youtube-upload.ts    youtube-upload.ts          handlers/youtube.ts
          └──── all call resolveYouTubeDeclaration(metadata, connection) ─── missing ─▶ row failed (actionable msg)
                           ▼
         YouTube videos.insert  status.selfDeclaredMadeForKids / snippet.categoryId  (AC2 parity point)
```

## 12. End-to-end data flow

Source: the user's answer → client state → server action (Zod: `z.boolean()`, `z.string().regex(/^\d+$/)`
and membership in the static list) → `platform_connections` (authoritative per-channel value) →
publish screen reads it → request `platformSpecific` → server resolve → `publishes.metadata`
snapshot (authoritative per publish) → upload body.

Loss and staleness points:
1. The channel value changes after a publish is scheduled. The snapshot wins by design (Q3).
2. Legacy rows have no snapshot, so the channel value is used at run time.
3. The connections query goes stale in another tab. The server re-resolves, and the request still
   has to carry the value or the channel has to have one. There is no silent default.

## 13. Data model

- `platform_connections.youtube_made_for_kids boolean null`. Authoritative per channel. `null` means
  "not declared".
- `platform_connections.youtube_category_id text null`. Same semantics.
- `publishes.metadata.madeForKids: boolean`, `.categoryId: string`. Per-publish snapshot. Existing
  jsonb, no schema change.
- Invariant: a `publishes` row for `platform = 'youtube'` created after this change always has both
  keys (enforced in the handler, asserted by E2E).

## 14. Database changes

`apps/web/supabase/migrations/<ts>_kb30-youtube-channel-audience.sql`, hand-written:

```sql
alter table public.platform_connections
  add column youtube_made_for_kids boolean,
  add column youtube_category_id text;

alter table public.platform_connections
  add constraint platform_connections_youtube_settings_only_youtube
    check (platform = 'youtube' or (youtube_made_for_kids is null and youtube_category_id is null)),
  add constraint platform_connections_youtube_category_numeric
    check (youtube_category_id is null or youtube_category_id ~ '^[0-9]{1,3}$');

comment on column public.platform_connections.youtube_made_for_kids is
  'KB-30: the creator''s COPPA declaration for this channel. NULL = not declared; the app asks and never assumes.';
```

- There is no default and no backfill, deliberately: the correct value is unknowable without the
  owner. Existing rows become null, and the next publish asks.
- Adding nullable columns with no default is a metadata-only change, with a brief `ACCESS EXCLUSIVE`
  lock on a small table. The CHECKs validate against existing rows, which are all null, so they pass.
- RLS and grants: no policy change. The existing `platform_connections_update` policy and the
  table-wide update grant cover the columns. **Coordination risk:** if teammate *account-exposure*
  moves this table to column-level grants, the two columns need an explicit `grant update (…)`. I
  will check `main` before opening the PR.
- Mirror: `apps/web/supabase/schemas/` has a file for `platform_connections` if one exists (I'll
  check). Types: `pnpm supabase:web:typegen` under the lock. That also removes the need for the
  `as unknown as` cast in `updateConnectionLanguageAction`, but I won't touch that (it's out of scope).
- Rollback: `alter table … drop constraint …, drop column …`. Safe. Code that reads the columns
  treats a missing value as "undeclared", which refuses rather than defaults.

## 15. Low-level design

**`packages/features/publishing/src/lib/youtube-declaration.ts`** (pure; exported as `./lib/youtube-declaration`):
```ts
export const YOUTUBE_CATEGORIES = [ { id: '1', name: 'Film & Animation' }, …, { id: '27', name: 'Education' }, … ] as const; // assignable set
export type YouTubeDeclaration = { madeForKids: boolean; categoryId: string };
export class YouTubeDeclarationMissing extends Error { constructor(readonly missing: ('audience'|'category')[]) … }
export function resolveYouTubeDeclaration(
  requested: { madeForKids?: unknown; categoryId?: unknown },
  channel: { youtube_made_for_kids: boolean | null; youtube_category_id: string | null } | null,
): YouTubeDeclaration  // requested (typeof boolean / valid id) ?? channel ?? throw YouTubeDeclarationMissing
```
There is no literal `false` or `'22'` in any resolver branch. A unit test and a grep guard (below) keep it that way.

**`server/youtube-upload.ts`** (server-only): the single `uploadToYouTube(accessToken, options, channel)`,
moved out of `publish-actions.ts` and `process-scheduled-publishes.ts`, which both import it.
Behaviour is unchanged apart from the declaration. `privacy` stays as each caller has it (in-app
`'public'`, cron `metadata.privacy ?? 'public'`); unifying privacy is out of scope and is noted.

**`publishToAllHandler`:** before `Promise.allSettled`, for each `platform === 'youtube'` config,
read the connection (`platform_account_name, youtube_made_for_kids, youtube_category_id`) and
resolve. If any throw, `ActionRefusal` names the channel(s), **before any insert**. Pass the resolved
values into `metadata` and into `uploadToYouTube`.

**`retryPublish`:** resolve from `publish.metadata` plus the connection, and write the resolved
values back into metadata on success. The existing connection read gains two columns.

**`process-scheduled-publishes.ts`:** its connection read (`:232`) gains two columns. On
`YouTubeDeclarationMissing` the row is marked `failed` with the actionable message (the existing
failure branch).

**Lambda `publish-worker`:** `token.ts`'s connection select gains two columns, returned alongside
the token. `handlers/youtube.ts` takes the channel and resolves. Failure goes through the existing
`updateStatus('failed', error)` path. The message must not be retried by SQS as transient, so it
throws a non-retryable error (check how `index.ts` classifies errors in Phase 2; if everything
retries, the DLQ bounds it and the row still reads failed).

**Server action `updateYouTubeChannelSettingsAction`** (`connection-actions.ts`): schema
`{ connectionId: uuid, madeForKids: boolean, categoryId: enum(YOUTUBE_CATEGORIES ids) }`. It updates
through the user client with `.eq('platform','youtube')` and `.select('id').single()`, so an RLS
no-op (0 rows) is an error rather than a silent success. `revalidatePath` matches the language action.

**Client:**
- `publish/_components/youtube-audience-dialog.tsx`: react-hook-form plus a Zod schema (a shared
  schema in `@kit/publishing` lib, per the Form Architecture rule), a `useFieldArray` over the
  undeclared channels, and **controlled** RadioGroup and Select (the Radix-keeps-value lesson from FILM-1609).
- `use-youtube-audience-gate.ts`: `ensureDeclared(targetConnections): Promise<Map<id, Declaration> | null>`.
  It resolves immediately when all targets are declared, otherwise opens the dialog and resolves on
  Continue, or null on Cancel. `handlePublish` and `handleScheduleRelease` both `await` it first.
  There is one gate for both paths.
- Config builders: `platformSpecific` for YouTube becomes `{ madeForKids, categoryId }` from the
  declaration map. Facebook's `{ isReel: true }` is unchanged. A small `platformSpecificFor(channel, kind)`
  helper replaces the four inline literals.
- `PlatformConnection` type and `getConnectedPlatformsAction` gain `youtubeMadeForKids` and `youtubeCategoryId`.
- Settings row: two selects for YouTube rows only, with the same mutation pattern as language.

**Dead-code alignment:** `getDefaultPlatformSettings('youtube')` drops `madeForKids: false` and
`categoryId: '22'`. `platform-specific-settings.tsx` is unrendered, so it is left alone and mentioned.

**Grep guard (fix the class):** a unit test reads the four upload files and fails on
`madeForKids as boolean) ?? false` or `categoryId as string) ?? '22'`. This follows the repo's
`vendor-api-versions.test.ts` source-scan pattern.

## 16. API and event design

- `publishToAllAction`: request shape is **unchanged**. `platformSpecific.madeForKids` and
  `categoryId` are already optional in the schema. The semantics change: for YouTube, the server
  requires them to resolve (request or channel), and otherwise returns a refusal value. There is no
  version bump. The only client is the publish screen, and it ships in the same deploy.
- New `updateYouTubeChannelSettingsAction`, as above. Auth required. Authorization via RLS.
- SQS `PublishJobMessage`: unchanged shape. `metadata` now always contains the snapshot for new
  rows. The worker tolerates its absence (FR-9).

## 17. State and lifecycle

Channel audience: `undeclared (null)` → `declared(true|false)`, by dialog or settings. It moves
between true and false freely. Returning to `undeclared` is not offered (Q4). Publish row states are
unchanged. A new failure reason, `youtube_audience_undeclared`, applies only to legacy rows and
crafted requests.

## 18. Failure and error handling

Covered in §4. Key rules:
- Refuse before side effects (no orphan `publishes` row).
- Return refusals as values (the prod message-redaction memory).
- Worker and cron failures write the actionable message to the row's `metadata.error`, which the
  published-content section already surfaces.

## 19. Security

- There are no new privileges. The update goes through the user's client and the existing
  `has_role_on_account` policy. The pgTAP test covers "non-member cannot set another account's
  channel audience".
- Input is validated (boolean, category in an allow-list). The CHECK constraints make the values
  consistent even for service_role.
- Abuse: a member could flip the audience for the account's channel. That is the same trust level
  as editing the channel language today, and is acceptable.
- No production credentials are used. The stand-in only covers local and E2E runs.

## 20. Performance and scale

One user, a handful of channels. Two extra columns on existing single-row reads, and one extra
PATCH per declaration. No concerns.

## 21. Accessibility and client behaviour

Labelled radio groups (`<fieldset><legend>`channel name`</legend>`). Esc/Cancel return focus to the
Publish button. The Continue disabled-state explanation is linked with `aria-describedby`. On mobile
(360px) the dialog is scrollable. Strings go through i18n `Trans` with defaults.

## 22. Observability and operations

- Logs: `publishing.youtubeDeclaration.refused {connectionId, publishId?, missing}` on refusal, and
  `publishing.youtubeDeclaration.resolved {source: 'request'|'snapshot'|'channel'}` at debug level
  on upload.
- Operator check: `select platform_account_name, youtube_made_for_kids from platform_connections
  where platform='youtube'`. A null means the next publish will ask. Failed rows with
  `metadata.error like 'YouTube audience not declared%'` mean a legacy scheduled row needs the channel declared.

## 23. Configuration and feature flags

No flag. The safe state is "ask", and a flag whose off-state restores the silent `false` would
reintroduce the bug. No new env. The E2E stand-in uses the existing `VENDOR_SANDBOX` / `VENDOR_URL_YOUTUBE_DATA`.

## 24. Compatibility

- Existing connection rows become undeclared, so the first publish after deploy asks once per YouTube channel.
- Existing `scheduled` YouTube rows have no snapshot, so they use the channel value at run time. If
  the owner has not declared by then, they fail with the actionable message and are retryable. **The
  owner should declare their channels right after deploy** (one line in the PR's ops notes).
- Deployment order: migration before app and lambda. The standard pipeline does this. A lambda
  deployed before the migration would select non-existent columns and error. I'll check that the
  SST deploy order runs migrations first; otherwise the worker read tolerates a missing column by
  selecting with a fallback. To be confirmed in Phase 2.

## 25. Migration and rollout

Merge, then CI (Supabase job applies the migration, typegen check), then deploy (migrations, then
web, then lambdas). After deploy, the owner declares each YouTube channel in Settings → Platforms,
or on the next publish. Rollback trigger: publishing to YouTube blocked in a way declaring can't
fix. Rollback = revert the PR. The columns can stay, since they are harmless.

## 26. Testing strategy (red first for each)

| Layer | Test | Red on main because |
|---|---|---|
| Unit | `youtube-declaration.test.ts`: the request / snapshot / channel / missing table; never returns false by default | module doesn't exist (the red is that assertions fail against a stub returning today's `?? false` behaviour, written first) |
| Unit (parity, AC2) | `youtube-declaration-parity.test.ts`: for `{true, false, missing}` × `{request, channel-only}`, run the **lambda handler** and the **in-app `uploadToYouTube`** against one local stand-in, and assert identical `status.selfDeclaredMadeForKids` / `snippet.categoryId` in the captured bodies. For missing: both throw and **no request is made** | today both send `false`/`22` for "missing" |
| Unit | source-scan guard for `?? false` / `?? '22'` in the four upload files | the literals exist today |
| Unit | `publishToAllHandler` refuses before insert (mocked client, asserts `insert` not called) | today it inserts and uploads |
| pgTAP | `platform-connections-youtube-audience.test.sql`: columns nullable with no default. CHECK refuses on a tiktok row and a non-numeric category. Member updates own channel. Non-member's update affects 0 rows. A reconnect upsert (token change) leaves the columns intact | columns don't exist |
| Playwright (CI) | `apps/e2e/tests/publishing/youtube-audience.spec.ts`: seed team, project, episode with a `localized_videos.en` URL and a YouTube connection (null). **Schedule** (no vendor call): dialog appears; answer *Made for kids* / Film & Animation; capture the `publishToAllAction` POST body with `page.waitForRequest` and assert `"madeForKids":true,"categoryId":"1"`; read the `publishes` row (`metadata.madeForKids === true`) and the connection row. **Second submission:** schedule again, no dialog, payload still true. **Change in settings** to Not made for kids, schedule, payload false. Plus a **direct action call** with `platformSpecific: {}` returns the refusal and inserts no row | on main no dialog; payload `platformSpecific:{}` |
| Playwright (sandbox-gated, like KB-22) | Publish-now path: stand-in on `KB30_YT_SANDBOX_PORT` answers token, `/upload/youtube/v3/videos` and thumbnails, and captures the insert body. Assert `selfDeclaredMadeForKids: true`. Skipped in CI without the port and `ENCRYPTION_KEY` | on main `false` |
| Evidence | `CAPTURE_EVIDENCE=1` screenshots: dialog empty (Continue disabled), dialog answered, confirm step showing the audience, settings row, refusal text | — |

Seed through the API (`seedTeamAccount`), use `signInAs`, and don't use `waitForTimeout`.
Local runs happen under the shared Supabase lock, with the dev server on port 3107.

## 27. Production-build verification

Run the Playwright spec against `next build && next start -p 3107` (not only `dev`). Refusal text
must survive prod redaction (memory: *server-action-errors-redacted-in-prod*). Check that the lambda
bundle resolves `@kit/publishing/lib/youtube-declaration`: build the worker with the SST/esbuild
config locally if it's runnable, otherwise by `esbuild --bundle` on the handler entry.

## 28. Traceability

| Outcome | Flow | Req | Design | Component | Data/API | Test | Prod verification |
|---|---|---|---|---|---|---|---|
| Declared audience reaches YouTube | J2–J5 | FR-4,5,7 | §15 gate + resolver | dialog, publish-screen, publish-actions | request `platformSpecific`, `publishes.metadata` | Playwright CI + gated | prod-build E2E |
| No silent default anywhere | all | FR-6,8,9 | resolver, no fallback | youtube-upload.ts, cron, lambda | — | unit table, parity, source scan | lambda bundle check |
| Per-channel setting | J3, J7 | FR-1,2,3,10 | §14 columns | connection-actions, settings row | `platform_connections` | pgTAP, Playwright | typegen CI check |
| User sees what is sent | J4 | FR-11 | confirm display | progress dialog | — | Playwright + screenshot | prod-build E2E |

## 29. Alternatives and trade-offs (for Q1)

| Option | For | Against |
|---|---|---|
| **A. Per YouTube channel (recommended)** | Matches YouTube's own model: Studio has a channel-level audience setting and COPPA guidance is framed per channel. Asked once, then always visible. Fits the per-channel `language` precedent and the "channels per language" setup. Legacy scheduled rows resolve from it | A channel that mixes kids and non-kids videos needs a per-upload override (A+ or C) |
| A+. Per channel, plus a third value "decide for each upload" | Mirrors YouTube Studio's "review this setting for every video". Covers mixed channels | More UI: a per-upload question in the confirm step. Roughly +1 day |
| B. Per project (series) | A kids series versus an adult series on one channel | Projects publish to every account channel. A "kids" project posting to a non-kids channel is exactly the mismatch YouTube penalises. No per-project settings are read by the publish flow today (`project_publishing_configs` is dead). Asks again for every new project |
| C. Every upload | Most explicit | Asked on every publish of every language channel (friction). An easy "click-through" defeats the purpose |
| D. Read from YouTube (`channels.list part=status`, `madeForKids`) | Uses the owner's existing declaration | Unverified semantics for "review per video" channels. Needs a network call at connect time. Still needs a fallback question. **Possible later enhancement:** pre-fill the question, never auto-answer |

Default in every option: **none**. The product asks. (The ticket: "the product's job is to ask, not to assume.")

## 30. Risk register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| Legacy scheduled YouTube rows fail after deploy | Missed scheduled release | Failed row with the actionable message | Ops note: declare channels immediately after deploy | Retry after declaring |
| *account-exposure* changes `platform_connections` grants to column-level | Declaring fails (0 rows / permission denied) | pgTAP member-update case, `.single()` in the action | Coordinate before PR. Rebase and add a column grant | — |
| Lambda deployed before migration | Worker select errors | Worker logs | Deploy order check | Redeploy after migration |
| Category list drifts from YouTube's assignable set | Upload rejected with invalidCategoryId | Upload error on the row | Use the long-stable assignable ids only | Update the list |
| Scope: the ticket grows into the full publish-settings editor | Delay | Review | Only audience + category. Privacy, playlists and the dead `MetadataEditor` stay out | — |

**Leads (not fixing, to record):**
- L1: `project_publishing_configs` / `episode_publishing_configs` are edited in the UI but never
  applied by the publish flow (their default tags and title suffix are ignored).
- L2: `PlatformSpecificSettingsSchema.playlistIds` is `z.string().uuid()`, but YouTube playlist ids
  are not UUIDs, so any real playlist id would be rejected.
- L3: YouTube privacy differs by path (in-app always `'public'`; cron and lambda honour `metadata.privacy`).

## 31. Open questions and assumptions

- **Q1 — OWNER DECISION: where does the audience live?** Per **channel** (A, recommended), per
  channel with a "decide per upload" option (A+), per **project** (B), or per **upload** (C)?
  *Assumption if unanswered:* A.
- **Q2 — OWNER DECISION: default?** Recommended: **no default**. The first publish to each YouTube
  channel asks, and nothing uploads until answered. The alternative is to pre-select "Not made for
  kids" in the question (still shown, still one click), which I don't recommend, because it
  re-creates the nudge the KB objects to. *Also:* is category in scope, and asked in the same
  question with no default? The alternative is to show "People & Blogs (22)" visibly and let it be
  changed. Recommended: same question, no default.
- Q3 (engineering, my call unless overruled): an already-scheduled publish keeps the audience it was
  scheduled with, even if the channel setting changes later. The snapshot is what the user saw at confirm.
- Q4: no "clear back to not set" control. Not needed for the owner's workflow.
- Assumption: channel audience applies equally to full videos and Shorts on that channel (YouTube treats them the same).

## 32. Implementation plan (dependency order)

1. **Migration + pgTAP (red → green)** under the lock. Then typegen and a schema mirror if a file exists.
2. **Resolver + unit tests (red first)** and the source-scan guard (red on the current literals).
3. **Dedupe `uploadToYouTube`** into `server/youtube-upload.ts`. Wire the resolver into immediate,
   retry and cron. Handler pre-validation. Parity test (red first against the current lambda).
4. **Lambda worker**: token read + handler resolver. The parity test goes green.
5. **Server action** `updateYouTubeChannelSettingsAction` and the connection types.
6. **UI**: gate hook + dialog, config builders, confirm display, sidebar chip, settings row, tags placeholder.
7. **Playwright (red on main first by running the spec before step 6)**, the gated sandbox spec, evidence.
8. `pnpm typecheck`, `lint:fix`, `format:fix`. Run the publishing, web and lambda unit suites. Prod-build E2E.
9. **Records:** KB-30 entry marked Fixed with the PR and ticked with evidence, and a row appended to
   the Fixed table. Update the KB-30 mention in `FILM-710-metadata-editor.yaml:77`. Check whether
   `FILM-701` / `FILM-708` YAML criteria mention the audience, and update `audited:` / evidence only
   if touched. Update the `INDEX.md` row if one exists. Add the leads L1–L3 as KB leads.
10. PR, then a follow-up commit with the PR number. Screenshots via `gh pr comment --attach`.

## 33. Definition of done

Both KB-30 acceptance criteria are ticked with evidence:
(1) Playwright asserts the request payload carries the chosen audience, and the question appears
instead of a default (red on main recorded).
(2) The parity test shows the lambda and in-app paths send identical declarations.
In addition: the pgTAP test is green, the source-scan guard is green, the prod-build E2E is green,
screenshots are in the PR, records are updated, and Q1/Q2 are answered by the owner.

## 34. Consistency pass

Forward: false declaration → the owner declares per channel → the dialog asks when undeclared → the
request carries it → the server refuses otherwise → the snapshot reaches every path → tests at each hop.
Reverse: production sends `selfDeclaredMadeForKids` = resolver(request/snapshot, channel), and the
resolver has no fallback. So YouTube only ever receives a value that either the user typed, or came
from a channel setting the user typed, and that the confirm step displayed. That matches §1. The
one divergence, legacy rows resolving from the channel at run time rather than from a confirm-time
snapshot, is recorded in §24 and §30.
