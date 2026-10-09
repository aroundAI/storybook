# EDD: Flexible Production (seasons first, any entry point, publish what you have)

| | |
|---|---|
| Tickets | FILM-2201..FILM-2206 (phase 22, to be filed from §11) |
| Builds on | FILM-302 (season CRUD), FILM-1143 (Generate Season), FILM-1905 (MCP author tools), FILM-1912 (performance context), FILM-2003 (episode renders), FILM-1504 (Reporting API ingest) |
| Surfaces | Web studio (`apps/web/app/home/[account]/studio/[projectSlug]/`) and the Studio MCP server (`packages/features/studio-mcp/`) |
| Status | **Design: awaiting owner approval. No code has been changed.** Revised 2026-10-09 with the owner's decisions (§14); channel import dropped. |

Evidence notation: `file:line` refers to `main` @ `ca2cbcf`.

---

## 1. Start with the user

**Who.** Three kinds of creator, all of whom we turn away today:

1. **The planner.** Knows the show's shape (three seasons, a theme for each)
   before any episode exists. Wants to lay out the seasons, then fill them
   one at a time.
2. **The producer with material.** Already has a script, or a finished cut
   made in another tool. Wants Storybook's publishing, localisation and
   analytics, not its ideation-to-shots pipeline.
3. **The creator who iterates.** Publishes through Storybook, reads the
   analytics (retention, genome, deep dive, revenue), and wants the *next*
   episode to build on what the numbers say.

**Problem.** Storybook offers one path: *Project → Generate Season →
Episodes → Ideation → Story → Screenplay → Shots → Audio → Publish*. Each
step is a gate on the next:

- A season can only be created by **Generate Season**, or as a side effect
  of creating an episode. There is no "new season" anywhere.
- **Publish opens only after a shot list exists**
  (`episode-workspace-tabs.tsx:104`), even though the publish screen already
  has an upload dialog for a finished video.
- Analytics see a video once it is published through Storybook (a
  `publishes` row; `publishes.episode_id not null`,
  `film-studio-tables.sql:470`), and an episode can only reach Publish after
  its shots exist. So a creator with a finished cut gets no per-episode
  analytics unless they walk the whole pipeline first.

**What the user gets when this ships:**

- Seasons are first-class: create an empty one, name it, write its
  direction notes, reorder it, add episodes to it later.
- An episode can start **from an idea**, **from a script**, or **from a
  finished video**. Every stage is optional. Publish opens as soon as there
  is a video.
- An episode published this way gets the same analytics as any other: the
  publish records the platform video id, and ingest matches on it.
- From any published episode's analytics, **"Make a follow-up"** starts a
  new episode whose brief already carries what worked.
- Everything above can also be done over **MCP** by an external AI, with the
  same validation and the same rows, because both surfaces call one service.

**Success.**

- A new user can create a project, an empty season and an episode with an
  uploaded video, and publish it, without opening Ideation, Story,
  Screenplay or Shots. Measured by an E2E spec and by the funnel event in §8.
- An episode published from an uploaded video shows its own analytics the
  day after its first Reporting API ingest, like any pipeline episode.
- An MCP client can do each of the three journeys in §3 using only tools
  listed in `get_workflow_guide`.

**Failure** (what the user must never see):

- A stage that was skipped showing as "locked" or as an error.
- An episode with a published video that the analytics page can't find.
- A season that disappears with its episodes still inside it. Deleting a
  season moves its episodes to *Unsorted*; it never deletes them.

**Out of scope** (owner, 2026-10-09):

- **Importing videos already on a channel** that were published outside
  Storybook. Episodes get analytics by being published through Storybook.
  Import, and the analytics backfill it would need, can be its own EDD later.
- **Changes to Generate Season.** It works exactly as today: same dialog,
  same numbering, same placement.

---

## 2. Current state

### 2.1 Seasons

| Fact | Evidence |
|---|---|
| Table exists: `seasons(project_id, number, name, description)`, `unique(project_id, number)`; later `direction_notes`, `deleted_at` | `20251205125737_film-studio-tables.sql:27`, `20260607072741_add-season-direction-notes.sql`, `20251209142715_add-seasons-deleted-at.sql` |
| `createSeasonAction`, `updateSeasonAction`, `deleteSeasonAction`, `getProjectSeasonsAction` exist and are tested | `packages/features/episodes/src/lib/server/mutations/season-actions.ts:37` |
| **No UI calls `createSeasonAction`.** Seasons are made only by Generate Season, or inline by the create-episode action | `season-generator-dialog.tsx`; `packages/features/episodes/src/server/actions.ts:173` |
| **Two copies of "insert a season".** `createSeasonAction` retries when two requests race for the same number; the copy in `actions.ts:173` does not, so a race there fails with a raw error | `season-actions.ts:56-101` vs `actions.ts:173-200` |
| **No MCP season tools.** `create_episode` takes a `seasonId` but there is no way to list or create one | `studio-mcp/src/server/tools/author/index.ts`; `read/episodes.ts:100` |
| `episodes.season_id` is nullable, `on delete set null` | `film-studio-tables.sql:60` |
| Episode `number` is unique **per project**, not per season | `20261004085714_kb-175-unique-episode-number-per-project.sql:48` |

### 2.2 Stage gating

| Fact | Evidence |
|---|---|
| Web tabs unlock in a chain: screenplay ⇐ story, shots ⇐ screenplay, audio ⇐ shots, **publish ⇐ shots** | `episodes/[episodeSlug]/_components/episode-workspace-tabs.tsx:93-106` |
| MCP repeats the same rule in its own function, and says so in a comment | `studio-mcp/src/server/tools/read/stage-status.ts:74-79` (`deriveStages`) |
| The MCP guide tells the external AI "A stage unlocks when the one before it has data" and "Publishing stays a web action" | `tools/workflow-guide.ts:33`, `read/stage-status.ts:44-46` |
| `episodes.status` is a CHECK enum of pipeline steps: `draft, story, storyboard, generating, editing, ready, published` | `film-studio-tables.sql:76`, `episodes/src/lib/schemas.ts:7` |

The gate is a front-end and contract rule. **No database constraint requires
a shot list before publishing.**

### 2.3 Bringing a video

| Fact | Evidence |
|---|---|
| Web publish screen uploads a full video through a presigned URL and saves it with `updatePublishedVideoAction` (`final_video_url` / `localized_videos`) | `publish/_components/publish-screen.tsx:765-787`, `apps/web/lib/presigned-upload.ts:29`, `episodes/src/lib/server/mutations/publish-actions.ts:87` |
| `markAsExternallyUploadedAction` links an **already-published** platform URL to an episode, extracting the platform content id, with `platform_connection_id` null | `publishing/src/server/upload-only-actions.ts:189` |
| MCP can upload a render (`request_render_upload` → PUT → `finalize_render`), but **only inside an open StorybookStudio edit session** | `tools/studio/renders.ts:172`, `:340`; `requireOwnOpenSession` |
| `episode_renders.edit_session_id` is nullable, so a render without a session is already allowed by the schema | `20261004162108_film-2003-episode-renders.sql:26` |

### 2.4 Analytics attribution

| Fact | Evidence |
|---|---|
| Reporting API rows are matched to Storybook by `publishes.platform_content_id` → episode → project | `content-analytics/src/server/reporting/report-ingest.ts:707-725` |
| So any episode published through Storybook, however it was made, is attributed with no analytics change | follows from the row above |
| FILM-1912 already feeds past performance into new generation briefs (DONE) | `specs/phase-19-dual-ai-mcp/FILM-1912-performance-context.yaml` |

### 2.5 Gaps this design closes

1. No way to create or manage a season on its own (web or MCP).
2. Season insert logic exists twice, and one copy is unsafe under a race.
3. Stage gating is a chain, and is written twice (web and MCP).
4. Publish requires shots.
5. MCP cannot attach a finished video outside StorybookStudio, cannot link a
   published URL, and cannot move an episode between seasons.
6. No path from analytics back into a new episode.

---

## 3. User journeys

Each journey is given as **UI path** and **MCP path**. Both write the same
rows through the same service functions (§6.1).

### J1. Plan seasons first, fill them later

**UI**

1. Project → **Episodes** tab. Empty project shows three cards (§7.1):
   *Plan a season with AI* · *Start a season* · *Add a finished video*.
2. **Start a season** → dialog: Name (required), Description, Direction
   notes (collapsed). Save.
3. The season appears as an empty section showing two actions:
   **+ New episode** · **⬆ Upload video** (which opens J2 on the *finished
   video* tile).
4. **+ New episode** opens the *How do you want to start?* dialog (J2),
   with the season already filled in.
5. Season header ⋯ menu: Rename · Edit notes · Move up / Move down ·
   Delete season (confirm: "Its N episodes move to Unsorted").

**MCP**

```
list_seasons(projectId)                              → []
create_season(projectId, name, description?, directionNotes?)
                                                     → { season: {id, number, …} }
create_episode(projectId, seasonId, title, startFrom: "idea")
update_season(seasonId, version, name?, directionNotes?)
reorder_seasons(projectId, seasonIds: [...])         → seasons renumbered
delete_season(seasonId, version)                     → episodes moved: N
```

### J2. Start an episode from what you have

**UI**: the *How do you want to start?* dialog (§7.3).

| Tile | Fields | Creates | Lands on |
|---|---|---|---|
| ✨ From an idea | title, season, duration, style | draft episode | Ideation |
| 📝 From a script | title, season, paste or upload (.fountain / .fdx / .txt / .md) | episode with `screenplay_data` parsed from the script, story marked skipped | Screenplay |
| 🎬 From a finished video | title, season, video file **or** published URL | episode with a video (render or publish link), story/screenplay/shots/audio skipped | Publish |

**MCP**

```
# idea: unchanged
create_episode(projectId, seasonId?, title, startFrom: "idea", …creative direction)

# script
create_episode(projectId, seasonId?, title, startFrom: "script")
start_generation(stage: "screenplay", episodeId, mode: "import")   # §6.4
submit_generation(runId, partKey, output: <screenplay JSON>)
finalize_generation(runId)

# finished video file
create_episode(projectId, seasonId?, title, startFrom: "video")
request_episode_video_upload(episodeId, language, bytes, contentType, aspect)
  → { renderId, uploadUrl, method, headers }
PUT <file> → uploadUrl
finalize_episode_video(renderId)                                   → episode.status = ready

# already on YouTube
create_episode(projectId, seasonId?, title, startFrom: "video")
link_published_video(episodeId, platform: "youtube", url)          → publish row
```

### J3. Skip a stage, or come back to it

**UI**

- The progress rail (§7.4) shows every stage as **Done**, **Empty** or
  **Skipped**. All of them can be clicked.
- An empty stage shows an empty state with actions, never a lock:
  *"No screenplay yet."* **Generate from story** · **Paste a script** ·
  **Skip this stage**.
- A Generate button whose inputs are missing is disabled with the reason
  inline: *"Needs a story. Write one, or paste a screenplay instead."*
- A skipped stage shows *"Skipped. You can still add one."* plus its actions.
  **Un-skip** is implicit: writing content to the stage clears the skip.

**MCP**

```
get_episode(episodeId)
  → stages: [{ key, state: "done" | "empty" | "skipped",
               canGenerate, missing: ["story"] }, …]
set_stage_skipped(episodeId, version, stage, skipped: true|false)
```

### J4. Publish what you have

**UI**: Publish opens when the episode has **any** of: a ready
`episode_renders` row, a `final_video_url`, a `localized_videos` entry, or an
external publish. With none, the Publish page itself is the upload surface:
a large drop zone, plus *"Already on YouTube? Paste the link"*.

**MCP**: publishing to a platform stays a web action in this phase (it
needs the user's OAuth consent per platform; FILM-1905 decision kept). MCP
can do everything up to that point: attach the video (J2), link an
already-published URL, and read `get_episode().publishReadiness`:

```
publishReadiness: { hasVideo: true, languages: ["en"],
                    connectedChannels: 2, blockers: [] }
```

### J5. Make a follow-up from analytics

**UI**: on an episode's Analytics page and on each row of the project video
log: **Make a follow-up**. It opens the J2 dialog on the *From an idea* tile,
with the title "Follow-up to ‹title›", the same season, and a read-only
*"What worked"* card (top retention moments, hook, genome findings) that is
attached to the new episode.

**MCP**

```
create_episode(projectId, seasonId?, title, startFrom: "idea",
               followUpOf: <episodeId>)
start_generation(stage: "story", episodeId)
  → brief.context.performance includes the source episode's findings
```

---

## 4. Functional requirements

### Seasons

- **S1** Create a season with only a name; number auto-assigned; safe
  under concurrent creates.
- **S2** Rename, describe, write direction notes, set a cover image.
- **S3** Reorder seasons. Numbers stay `1..n` with no gaps.
- **S4** Delete (soft) a season. Its live episodes move to `season_id =
  null`. The response says how many moved.
- **S5** Move an episode into, out of, or between seasons. Its episode
  `number` (production number) does not change; its **position in the
  season** is derived (§6.2).

### Episodes and stages

- **E1** Create an episode with `startFrom ∈ {idea, script, video}` (UI and
  MCP).
- **E2** Every stage is reachable at any time. Stage state is `done`,
  `empty` or `skipped`, never `locked`.
- **E3** A generate action checks its own inputs and refuses with the
  missing stages named.
- **E4** A stage can be marked skipped and un-skipped. Writing content to a
  skipped stage un-skips it.
- **E5** One function decides stage state for web and MCP.
- **E6** Script import parses Fountain, Final Draft (.fdx), and plain text
  into `screenplay_data` through the existing screenplay validator.

### Video and publishing

- **V1** An episode can hold a video without an edit session (web upload or
  MCP upload).
- **V2** Publish opens when the episode has a video or an external publish.
- **V3** An already-published URL can be linked (web and MCP).
- **V4** Status follows content: attaching a video sets `ready` unless the
  episode is already `published`.

### Analytics

- **A1** "Make a follow-up" creates an episode carrying a snapshot of the
  source episode's findings, which the story brief reads.

---

## 5. Non-functional requirements

| Requirement | Target |
|---|---|
| Parity | Every write in §4 is reachable from both web and MCP, via one service function. A test asserts each MCP author tool and its web action call the same function (pattern in `studio-mcp/__tests__`). |
| Tenancy | All new writes run under the user's RLS client (web: server client; MCP: `context.principal.supabase`). No new service-role writes. |
| Concurrency | Season create/reorder safe under parallel calls (unique violations retried or done in one RPC). Episode writes keep optimistic locking (`version`). |
| Row cap | Season and episode lists page every read (`fetchAllRows`) per CLAUDE.md "Reading More Than 1000 Rows". |
| Upload size | Same as today: presigned PUT, 500 MB per file for renders (`request_render_upload`), the publish screen's limit for web. |
| Accessibility | New dialogs keyboard-navigable; tiles are radio buttons with labels; progress rail is an `ol` with `aria-current`. |
| No regressions | The existing path (Generate Season → Ideation → … → Publish) is unchanged in behaviour; only its gates are removed. Generate Season itself is untouched. |

---

## 6. Design

### 6.0 Key decisions

| # | Decision | Why | Rejected alternative |
|---|---|---|---|
| D1 | **Stages are optional, not ordered gates.** Requirements move from *page access* to *the action that needs the input* | The DB never required order; the gate only blocked people who had material from elsewhere | Keep the chain and add "skip" buttons: still forces walking every step |
| D2 | **One `season.service.ts`, one `stage-state.ts`**, both called by web actions and MCP tools | Today both rules are written twice and have drifted (season race) | Keep separate copies with shared tests: drift returns |
| D3 | **Keep `episodes.number` project-wide**; derive "S2 · E3" from order within season | KB-175 made the number unique per project; renumbering on move would break slugs, URLs and links | Per-season numbering: migration on every move, slug churn |
| D4 | **Skipped stages stored explicitly** (`episodes.skipped_stages text[]`) | "Empty" and "deliberately skipped" look different to the user and to the MCP agent | Infer skipped from empty: the agent would keep offering to generate |
| D5 | **A video attached outside StorybookStudio is an `episode_renders` row** with `edit_session_id = null`, `source = 'upload'` | One table answers "does this episode have a video?"; the publish render picker already reads it | New table: two places to check |
| D6 | **No analytics changes.** An episode gets analytics by being published through Storybook, whatever path made its video | Ingest already matches on `publishes.platform_content_id` | Import channel videos as episodes: dropped by the owner (§1 Out of scope) |
| D7 | **Platform publishing stays web-only over MCP** | Unchanged from FILM-1905: per-platform OAuth consent is a human act | Publish tool now: needs consent design first |
| D8 | **Status follows content** for one new transition only (video attached → `ready`). Other transitions untouched | Minimal change to a CHECK enum many queries read | Derive status entirely from content: large blast radius |

### 6.1 Season service — one function per write

**New:** `packages/features/episodes/src/server/season.service.ts`
(`server-only`), next to `episode.service.ts`, same shape as
`insertEpisode`: takes a client, returns `{ ok: true, data } | { ok: false,
refusal, field? }`.

```ts
insertSeason(client, { projectId, name, description?, directionNotes?, number? })
updateSeasonRow(client, { seasonId, version, name?, description?, directionNotes?, coverUrl? })
reorderSeasons(client, { projectId, seasonIds })        // → rpc reorder_seasons
softDeleteSeason(client, { seasonId, version })          // → rpc soft_delete_season
moveEpisodeToSeason(client, { episodeId, version, seasonId: string | null })
listSeasons(client, { projectId })                       // with episode counts
```

- `insertSeason` keeps `createSeasonAction`'s retry on `23505` (3 tries).
- `createSeasonAction`, `updateSeasonAction`, `deleteSeasonAction`,
  `getProjectSeasonsAction` become thin wrappers (auth, audit log,
  `revalidatePath`).
- `actions.ts:173` (inline season in the episode wizard) calls
  `insertSeason`. **This deletes the unsafe copy.**
- MCP season tools (§9.1) call the same functions.

### 6.2 Season position and display

- Display label: `S{season.number} · E{position}` where `position` is the
  1-based index of the episode among the season's live episodes ordered by
  `number`. Unsorted episodes show `#{number}`.
- Computed in SQL by a view, so web and MCP read the same value:

```sql
create view public.episode_positions with (security_invoker = true) as
select e.id as episode_id,
       e.season_id,
       row_number() over (partition by e.season_id order by e.number) as season_position
from public.episodes e
where e.deleted_at is null;
```

- Moving an episode changes its position, never its `number`.

### 6.3 Stage state — one function

**New:** `packages/features/episodes/src/lib/stage-state.ts` (pure, no I/O,
safe on client and server).

```ts
export type StageKey = 'ideation' | 'story' | 'screenplay' | 'shots' | 'audio' | 'video' | 'publish';
export type StageState = 'done' | 'empty' | 'skipped';

export interface StageView {
  key: StageKey;
  state: StageState;
  canGenerate: boolean;      // inputs for the stage's generator are present
  missing: StageKey[];       // inputs it lacks, in order
}

export function deriveStageViews(input: StageInputs): StageView[];
export function canPublish(input: StageInputs): boolean;  // has a video or an external publish
```

`StageInputs` adds to today's (`stage-status.ts:62`): `skippedStages`,
`readyRenderCount`, `localizedVideoCount`, `externalPublishCount`.

**Generator inputs** (what `canGenerate` checks, unchanged from today's
generators):

| Stage | Generator needs |
|---|---|
| story | title (always present) |
| screenplay | `story_data` |
| shots | `screenplay_data` |
| audio | shots and dialogue lines |
| video | (rendered in StorybookStudio or uploaded; not generated here) |
| publish | `canPublish` |

**Callers:**

- `episode-workspace-tabs.tsx` replaces `getTabUnlockState` with
  `deriveStageViews`. No tab is disabled.
- `studio-mcp/.../read/stage-status.ts` `deriveStages` becomes a mapper over
  `deriveStageViews` (adds `origin`). Its `STAGE_ORDER[].needs` text is
  rewritten (§9.3).
- Server-side generator entry points (`start_generation`, the web
  generate actions) call `deriveStageViews` and refuse with `missing` when
  `canGenerate` is false. **This is the one place the order is enforced.**

**New stage `video`.** Between audio and publish, it's done when a ready
render or a `final_video_url` exists. It is what the "From a finished video"
path fills, and what StorybookStudio's `finalize_render` already fills.

### 6.4 Entry modes

`episodes.entry_mode` (§10) records how an episode started. It affects only
defaults and copy, never permissions.

| `startFrom` | On create | Skipped stages set |
|---|---|---|
| `idea` | today's behaviour | none |
| `script` | none until the script is imported | `ideation`, `story` |
| `video` | none until the video is attached | `ideation`, `story`, `screenplay`, `shots`, `audio` |

**Script import.** Web: the dialog posts the file to
`importScreenplayAction`, which parses (Fountain and Final Draft .fdx with a
small in-house reader, since neither format has a parser in the repo today;
plain text via the existing screenplay converter, FILM-306) into the screenplay
schema, then writes through the same commit path the screenplay generator
uses, so validation and `generation_origin` stamping are identical. MCP: a
new `mode: "import"` on `start_generation` for `stage: "screenplay"` returns
the schema with **no generation instructions**; the agent submits the
parsed script as the output. Origin is stamped `{ via: 'import' }`, so
analytics by origin (`get_performance_by_origin`) can separate imported
scripts from generated ones.

### 6.5 Attaching a finished video

**Web.** The Publish page, when `canPublish` is false, renders
`AttachVideoPanel`: a drop zone (reusing `UploadVideoDialog`'s dropzone) and
a URL field.

- File → existing presigned upload (`uploadPublishVideo`) → new
  `attachEpisodeVideoAction` which inserts an `episode_renders` row
  (`source = 'upload'`, `edit_session_id = null`, `preset = 'master'`,
  status `ready` after size check) and sets `final_video_url` for the chosen
  language through `updatePublishedVideo`. Status → `ready` (D8).
- URL → existing `markAsExternallyUploadedAction`. No new code; the panel
  just exposes it before shots exist.

**MCP.** Two new tools (§9.2) mirroring `request_render_upload` /
`finalize_render`, minus the session requirement. Both delegate to a shared
`episode-video.service.ts` (`requestEpisodeVideoUpload`,
`finalizeEpisodeVideo`) that the web action also calls. The StorybookStudio
tools are unchanged.

### 6.6 Follow-up from analytics

- `create_episode` / `createEpisodeWithContextAction` gain
  `followUpOf?: uuid`. The service checks the source episode is in the same
  project, then writes `metadata.follow_up = { episode_id, snapshot }` where
  `snapshot` is what FILM-1912's performance context already computes for
  that episode (retention moments, hook score, genome findings), frozen at
  creation.
- FILM-1912's brief builder reads `metadata.follow_up.snapshot` first and
  puts it at the top of `context.performance` with the label *"This episode
  follows up ‹title›. What worked there:"*.
- No new analytics queries. The snapshot is frozen so the brief is
  reproducible (FILM-1903 runs store their brief).

---

## 7. UI design

All components use `@kit/ui` (Shadcn). New interactive elements carry
`data-test`. Copy is in `apps/web/public/locales/en/studio.json`.

### 7.1 Episodes page — empty project

```
┌──────────────────────────────────────────────────────────────────────┐
│  Let's make your first season                                        │
│                                                                      │
│  ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐│
│  │ ✨                  │ │ ▢                  │ │ ⬆                  ││
│  │ Plan a season       │ │ Start a season     │ │ Add a finished     ││
│  │ with AI             │ │                    │ │ video              ││
│  │ Outline N episodes  │ │ Name it now, add   │ │ Upload a file or   ││
│  │ from your premise.  │ │ episodes later.    │ │ paste a YouTube    ││
│  │                     │ │                    │ │ link.              ││
│  └────────────────────┘ └────────────────────┘ └────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

`episodes-zero-state.tsx` is replaced. `data-test="zero-plan-season"`,
`"zero-start-season"`, `"zero-add-video"`.

### 7.2 Episodes page — with seasons

```
 Episodes                                    [ + New season ] [ + New episode ▾ ]

 ▾ Season 1 · Origins            6 episodes · 42 min        ⋯
   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ thumb    │ │ thumb    │ │ thumb    │ │          │
   │ S1·E1    │ │ S1·E2    │ │ S1·E3    │ │  + Add   │
   │ Pilot    │ │ The Gate │ │ Ashes    │ │ episode  │
   │ ●●●●●●○  │ │ ●●●○○○○  │ │ ○○○○○●●  │ │          │
   │ [Live]   │ │ [In prod]│ │ [Ready]  │ │          │
   └──────────┘ └──────────┘ └──────────┘ └──────────┘

 ▾ Season 2 · Untitled           0 episodes                 ⋯
   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
     This season is empty.
     [ + New episode ]  [ ⬆ Upload video ]
   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘

 ▾ Unsorted                      2 episodes
```

- `collapsible-season-section.tsx`: header gains count, total runtime
  (sum of `duration_seconds`), ⋯ menu; body becomes a responsive grid
  (1 / 2 / 3 / 4 columns at sm / md / lg / xl). Empty body renders
  `EmptySeasonSlot`.
- `episode-card.tsx`: adds `StageDots` (7 dots: filled = done, hollow =
  empty, dashed ring = skipped) and a status pill mapped from
  `episodes.status`: `draft` → Draft, `story|storyboard|generating|editing`
  → In production (owner, 2026-10-09), `ready` → Ready, `published` → Live.
- **Drag and drop**: cards drag between season sections and Unsorted
  (`@dnd-kit/core`, already a dependency of `web` and `@kit/episodes`). Keyboard alternative: card ⋯ → *Move to season…*.
  Calls `moveEpisodeToSeasonAction`. Optimistic, rolled back on refusal.
- **+ New episode ▾** splits into: *New episode* (J2 dialog) · *Generate
  season* (today's Generate Season dialog, unchanged).
- **+ New season** opens `CreateSeasonDialog`.

### 7.3 *How do you want to start?* dialog

Replaces the first step of `create-episode-dialog.tsx` /
`create-episode-wizard.tsx`; the wizard's creative-direction step stays as
step 2 of the *idea* path only.

```
 New episode                                                    ✕
 ─────────────────────────────────────────────────────────────────
 Title   [ The Gate                                          ]
 Season  [ Season 1 · Origins                              ▾ ]

 How do you want to start?
 ( ✨ From an idea )   ( 📝 From a script )   ( 🎬 From a finished video )
   We'll help you        Paste or upload a      Upload a file, or paste
   build the story.      screenplay.            a YouTube link.

 ─────────────────────────────────────────────────────────────────
 [ tile-specific fields appear here ]
                                          [ Cancel ]  [ Create ▸ ]
```

- Tiles are a `RadioGroup` (`data-test="start-from-idea|script|video"`).
- One `react-hook-form` form with a discriminated-union Zod schema
  (`CreateEpisodeStartSchema`, in `_lib/schemas/`) shared with the server
  action and the MCP tool input:

```ts
const Base = z.object({ projectId: z.string().uuid(), seasonId: z.string().uuid().nullable(), title: z.string().min(1).max(255) });
export const CreateEpisodeStartSchema = z.discriminatedUnion('startFrom', [
  Base.extend({ startFrom: z.literal('idea'), ...creativeDirection }),
  Base.extend({ startFrom: z.literal('script'), scriptText: z.string().max(500_000).optional(), scriptFileKey: z.string().optional() })
      .refine((v) => v.scriptText || v.scriptFileKey, { path: ['scriptText'], message: 'Paste a script or upload a file' }),
  Base.extend({ startFrom: z.literal('video'), videoFileKey: z.string().optional(), publishedUrl: z.string().url().optional() })
      .refine((v) => v.videoFileKey || v.publishedUrl, { path: ['publishedUrl'], message: 'Upload a video or paste a link' }),
]);
```

- `seasonId` uses a **controlled** `Select` (CLAUDE.md: uncontrolled Radix
  selects keep their label across `reset()`).
- On success: `redirect` to the landing stage (table in J2).

### 7.4 Episode workspace — progress rail

Replaces `episode-workspace-tabs.tsx`'s tab strip.

```
 ● Idea ── ● Story ── ● Screenplay ── ◌ Shots ── ◌ Audio ── ● Video ── ○ Publish
   done      done       done            skipped    skipped    done       ready
```

- `ol` of links; current stage has `aria-current="step"`; each item shows
  label + state icon; skipped items are muted with a dashed ring.
- Below the rail, a stage with `state = 'empty'` renders `StageEmptyState`:

```
 ┌──────────────────────────────────────────────────────────────┐
 │  No screenplay yet                                           │
 │  [ ✨ Generate from story ]  [ 📝 Paste a script ]  Skip →    │
 │  Generate needs a story. Write one first, or paste a script. │
 └──────────────────────────────────────────────────────────────┘
```

- *Skip* calls `setStageSkippedAction`; the rail updates optimistically.
- The Publish page with no video renders `AttachVideoPanel` (§6.5) instead
  of the publish form.

### 7.5 Analytics → follow-up

Episode Analytics page header and project video-log rows gain
**Make a follow-up** (`data-test="make-follow-up"`). It opens §7.3 with the
*idea* tile, the title pre-filled, the same season, and a read-only
*What worked* card above the fields.

---

## 8. Observability

| Event (`useAppEvents().emit`, forwarded by `@kit/analytics`) | Properties |
|---|---|
| `season_created` | `via: ui|mcp|wizard|generator`, `empty: bool` |
| `episode_created` | `startFrom`, `via`, `hasSeason` |
| `stage_skipped` / `stage_unskipped` | `stage`, `via` |
| `episode_video_attached` | `via`, `kind: upload|link` |
| `follow_up_created` | `via`, `sourceStatus` |

**Funnel** for the success metric: `episode_created(startFrom=video)` →
`episode_video_attached` → `publish_succeeded` without any
`generation_started` in between.

MCP calls already write `mcp_audit` rows (`server/audit.ts`); new tools get
the same. Season writes keep `createAuditLog` (object type `season`).

---

## 9. MCP design

### 9.1 New season tools (`tools/author/seasons.ts`, `tools/read/seasons.ts`)

| Tool | Scope | Annotations | Input | Output |
|---|---|---|---|---|
| `list_seasons` | `studio:read` | readOnly | `projectId` | `{ seasons: [{ id, number, name, description, directionNotes, episodeCount, version }] }` |
| `create_season` | `studio:write` | write | `projectId, name, description?, directionNotes?, number?` | `{ season }` |
| `update_season` | `studio:write` | write, idempotent | `seasonId, version, name?, description?, directionNotes?` | `{ season }` |
| `reorder_seasons` | `studio:write` | write, idempotent | `projectId, seasonIds[]` (every live season, once) | `{ seasons }` |
| `delete_season` | `studio:write` | **destructive** | `seasonId, version` | `{ deleted: true, episodesMoved: n }` |

Example description (house style, see `create_episode`):

> `create_season` — Creates an empty season in a project. Name 1-255
> characters; optional description and direction notes (the generators read
> direction notes when writing this season's episodes). The number is the
> next free one unless given. Adds no episodes: use `create_episode` with
> this `seasonId`, or Generate Season on the web.

### 9.2 Episode and video tools

| Tool | Change | Scope |
|---|---|---|
| `create_episode` | **+ `startFrom`** (`idea` default, `script`, `video`), **+ `followUpOf`** | `studio:write` |
| `update_episode` | **+ `seasonId`** (uuid or `null` = Unsorted) | `studio:write` |
| `set_stage_skipped` | **new.** `episodeId, version, stage, skipped` | `studio:write` |
| `get_episode` | `stages[]` becomes `{ key, state: done|empty|skipped, canGenerate, missing, origin }`; **+ `seasonPosition`**, **+ `entryMode`**, **+ `publishReadiness`** | `studio:read` |
| `list_episodes` | **+ `seasonPosition`**, **+ `entryMode`**; filter `seasonId: null` returns Unsorted | `studio:read` |
| `request_episode_video_upload` | **new.** `episodeId, language, aspect, bytes, contentType` → `{ renderId, key, uploadUrl, method, headers }` | `studio:write` |
| `finalize_episode_video` | **new.** `renderId` → `{ render, episode }`; size check as `finalize_render` | `studio:write` |
| `link_published_video` | **new.** `episodeId, platform, url` → `{ publish }` (wraps the `markAsExternallyUploaded` service) | `studio:write` |
| `start_generation` | **+ `mode: "import"`** for `stage: "screenplay"` (§6.4); refuses with `MISSING_INPUTS` + `missing[]` when `canGenerate` is false (replaces the stage-lock check) | `studio:write` |

### 9.3 Workflow guide

`tools/workflow-guide.ts` and `STAGE_ORDER[].needs` are rewritten:

- Replace *"A stage unlocks when the one before it has data"* with
  *"Every stage is optional. A generator needs the stages it reads; when they
  are missing, `start_generation` refuses with `MISSING_INPUTS` and names
  them. Mark a stage you will not do with `set_stage_skipped`."*
- Add **Three ways to start an episode** (idea / script / video) with the
  tool sequences from J2.
- Add **Seasons** (J1 sequence) and **Follow-ups** (J5 sequence).
- Publish line: *"Publishing to a platform is a web action. Over MCP you
  can attach the video (`request_episode_video_upload`) or link one already
  published (`link_published_video`); `get_episode().publishReadiness`
  says what the web publish will need."*

### 9.4 Contract change and compatibility

`get_episode().stages[].state` no longer emits `locked` and adds `empty`
and `skipped`. Clients that treat `locked` as "don't touch" now see
`empty` and may try to generate. That is the intended behaviour, and
`start_generation` still refuses with the missing inputs. The tool
description says so, and the change is noted in the server's `instructions`
version string so connectors re-read the guide.

---

## 10. Database changes

One migration, hand-written (`apps/web/supabase/migrations/<ts>_film-2201-flexible-production.sql`),
mirrored into the seasons/episodes schema files, types regenerated.

```sql
-- Seasons: cover and optimistic lock
alter table public.seasons
  add column cover_url text,
  add column version integer not null default 1;

-- Episodes: how it started, and what was skipped
alter table public.episodes
  add column entry_mode text not null default 'idea'
    check (entry_mode in ('idea', 'script', 'video')),
  add column skipped_stages text[] not null default '{}'
    check (skipped_stages <@ array['ideation','story','screenplay','shots','audio']::text[]);

-- Renders not made in StorybookStudio
alter table public.episode_renders
  add column source text not null default 'studio'
    check (source in ('studio', 'upload'));

-- One episode per platform video (link_published_video refuses a video already
-- linked to another episode, so its analytics are never attributed twice)
create unique index idx_publishes_platform_content_unique
  on public.publishes (platform, platform_content_id)
  where platform_content_id is not null and status <> 'deleted';
-- ⚠ before this index: query for existing duplicates in production and
--   resolve them (expected 0; verified in M0)

-- Reorder seasons atomically (unique(project_id, number) blocks a naive swap)
create or replace function public.reorder_seasons(p_project_id uuid, p_season_ids uuid[])
returns setof public.seasons language plpgsql security invoker as $$ … $$;
-- 1. check p_season_ids = every live season of the project, once
-- 2. shift all numbers by +10000, then set number = ordinal

-- Soft delete a season and move its episodes to Unsorted in one transaction
create or replace function public.soft_delete_season(p_season_id uuid, p_version int)
returns integer language plpgsql security invoker as $$ … $$;  -- returns episodes moved

create view public.episode_positions with (security_invoker = true) as …; -- §6.2
```

**RLS.** `seasons`, `episodes`, `publishes` policies are unchanged (KB-48
studio owner access applies). The two functions are `security invoker`,
so they run under the caller's policies. **pgTAP** in
`apps/web/supabase/tests/database/flexible-production.test.sql`:

- a viewer can't create, reorder or delete a season;
- `soft_delete_season` moves episodes to `null`, never deletes them;
- `reorder_seasons` rejects a list that omits or repeats a season;
- linking a video already linked to another episode is refused by the
  unique index.

**`episodes.status` CHECK is unchanged.**

---

## 11. Task list

Each milestone is one spec and one PR (or more, as `(part N)`), titled per
CLAUDE.md. UI milestones carry Playwright evidence screenshots.

| ID | Milestone | Size | Depends |
|---|---|---|---|
| FILM-2201 | **M0 Foundations**: migration (§10), `season.service.ts`, `stage-state.ts`, delete the duplicate season insert, MCP `deriveStages` maps over `deriveStageViews` | M | — |
| FILM-2202 | **M1 Publish what you have** (web): tabs never lock; Publish opens on `canPublish`; `AttachVideoPanel`; `attachEpisodeVideoAction`; status → ready | S | 2201 |
| FILM-2203 | **M2 Seasons UI**: zero state (§7.1), `CreateSeasonDialog`, season header menu, empty slot, reorder, delete-moves-episodes, move episode (drag + menu), S·E labels | M | 2201 |
| FILM-2204 | **M3 MCP seasons and video**: §9.1 tools, `update_episode.seasonId`, `set_stage_skipped`, `request_episode_video_upload`, `finalize_episode_video`, `link_published_video`, new `get_episode` stage shape, workflow guide (§9.3) | M | 2201 |
| FILM-2205 | **M4 Start-from dialog and progress rail**: §7.3, §7.4, `StageEmptyState`, skip/un-skip, script import (web + `start_generation mode: import`) | L | 2202, 2203 |
| FILM-2206 | **M5 Follow-up**: `followUpOf` (web + MCP), snapshot, FILM-1912 brief reads it, analytics buttons | S | 2205 |

M1 and M2 together deliver the two original asks (empty seasons; publish
without ideation-to-shots). M3 lands MCP parity for them. M4 and M5 build
on top.

### Test plan per milestone

| Layer | What it proves | Where |
|---|---|---|
| Unit | `deriveStageViews` for every combination of present / skipped / empty; `canPublish`; schema refinements | `packages/features/episodes/__tests__/stage-state.test.ts` |
| Unit | Season service: retry on `23505`; refusals | `…/__tests__/season.service.test.ts` |
| Parity | Each MCP author tool and its web action call the same service function | `studio-mcp/__tests__/parity.test.ts` |
| pgTAP | §10 list | `supabase/tests/database/flexible-production.test.sql` |
| E2E (web) | J1, J2 (all three tiles), J3 skip/un-skip, J4 publish with upload, **second submission** of the start dialog after reset | `apps/e2e/tests/flexible-production/*.spec.ts`, seeded via `seedUser`/`seedTeamAccount` |
| E2E (MCP) | J1, J2 video + script, J5 brief contains snapshot | `apps/e2e/tests/mcp/flexible-production.spec.ts` |
| ClickHouse | An episode published from an uploaded video gets its seeded per-video rows on its analytics page, on local CH 24.8 | `apps/e2e/tests/analytics/uploaded-episode-evidence.spec.ts` |
| Evidence | Screenshots of §7.1–§7.5, including after-save states and error states | `CAPTURE_EVIDENCE=1` specs |

Red-before-green: each guard is shown failing against `main` (e.g., the
Publish tab test fails on `publish: hasShotList`) before the fix.

---

## 12. Rollout

- **Flag:** `enableFlexibleProduction` in `apps/web/config/feature-flags.config.ts`
  (`NEXT_PUBLIC_ENABLE_FLEXIBLE_PRODUCTION`, default off; added to
  `sst.config.ts` and kept in step by `feature-flags-parity.test.ts`) gates
  the UI changes in M1, M2, M4 and M5 and the new MCP tools' registration. The migration and
  services ship ungated; they're additive.
- **Order:** M0 → M1 + M2 behind the flag on staging → owner review with
  evidence → flag on in production → M3 (MCP) → M4 → M5.
- **Rollback:** flag off restores the old UI. Data written meanwhile is
  still valid for the old UI (seasons, episodes with fewer stages, publishes).
  An episode with a video but no shots shows a locked Publish tab again,
  but nothing is lost.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Existing duplicate `platform_content_id` rows block the unique index | M0 queries production first; migration resolves or the index is scoped to `status = 'published'` |
| External AI floods `start_generation` now that nothing is "locked" | Same `MISSING_INPUTS` refusal; existing generation rate limits (`tools/generation/limits.ts`) unchanged |
| Users skip everything and get worse content | Skipping is explicit and reversible; Ideation stays the default tile |
| Script parser accepts malformed input | Writes through the screenplay validator; rejection lists fields, as `submit_generation` does |

---

## 14. Owner decisions (2026-10-09)

1. **Status pill.** "In production" for `story/storyboard/generating/editing`.
   Applied in §7.2.
2. **Channel import.** Dropped. Episodes get analytics by being published
   through Storybook (§1 Out of scope, D6). This also settles the earlier
   questions on older analytics history, plan limits for imported episodes,
   and non-YouTube imports: none of them arise.
3. **Generate Season.** Works exactly as today. Nothing in this EDD changes
   it; the former requirement to generate into an existing season is
   removed.
