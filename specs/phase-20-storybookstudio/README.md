# Phase 20: StorybookStudio — the desktop AI editor

StoryBook gets its post-production half. **StorybookStudio** is a fork of
the upstream GPL-3.0 editor (an Electron video editor with a 130-tool MCP
server) that runs on the creator's own computer, pulls a planned
episode from StoryBook, assembles a rough cut, lets an AI cut it with preview,
undo and an explain-why report, checks its own renders, and sends a
publish-ready delivery package back. StoryBook stays the content source of
truth, the orchestrator and the memory of every edit; it never renders video
and never holds a timeline. The fork lives at
[aroundAI/storybookstudio](https://github.com/aroundAI/storybookstudio).

**Design document (2026-10-03):**
[StorybookStudio: PRD and EDD](https://claude.ai/code/artifact/7a69fcdb-7582-4fd2-85df-ae58c15b2b13),
with a repository copy in [PRD-EDD.md](./PRD-EDD.md) (diagrams in Mermaid).
Part 1 is the product (the closed user loop, requirements R-01 to R-72),
Part 2 the fork's design, Part 3 the web app's design, Part 4 the loop end to
end. The specs below are its task breakdown; where a spec and the document
disagree, the spec is the record and the document is updated. The document's
Part 3 predates the reading of Phase 19 and is corrected in the specs: the
desktop authenticates with Phase 19's MCP tokens and talks to StoryBook
through MCP tools, not a new `/api/v1` and a new token table (see
[Locked decisions](#locked-decisions)).

## The problem, in one table

Measured 2026-10-04 on `main` at `2d99b8334`:

| | Today | Consequence |
|---|---|---|
| Editing | None in the product. The Edit Suite was retired (FILM-607) and its tables dropped (FILM-608). `episodes.status` has an `editing` value nobody sets | Every episode leaves StoryBook as a ZIP of clips plus an FCPXML the OpenClaw browser agent assembles for Final Cut Pro |
| Where the edit inputs are | `shots` (timing, trims, transitions, prompts, frames), `dialogue_lines` (audio, `timeline_start_seconds`), `audio_tracks`, `caption_segments`, `shorts`, `dubbed_versions`, `screenplay_data` | A rough cut is already described in the database; nothing consumes it |
| How a client authenticates | Phase 19: `/api/mcp` (stateless Streamable HTTP), personal access tokens `sbk_pat_`, OAuth 2.1 + PKCE with DCR and pre-registered clients, `withMcpAuth` minting a 5-minute RLS JWT | A desktop app can be one more MCP client; no new auth is needed |
| What MCP exposes | 60 tools: read, author, generation, analytics, three renders, `get_veo_manifest` | No tool hands over an episode's media for editing, and none accepts a finished video back |
| Media URLs | R2 with public read URLs (`R2_PUBLIC_URL/...`); presigned PUT for uploads (`/api/storage/presign`) | A desktop download must use signed GETs; the adapter has none yet |
| Final video | `episodes.final_video_url`, `master_video_asset_id`, set by a manual upload | No record of renders per preset or language, no QA, no edit history |
| The upstream editor as shipped (v0.3.36) | 130 MCP tools with `previewOnly`, undo and action plans; local whisper captions; hardware export; **no auth on its MCP server**, an unrestricted `storybookstudio-file://` file protocol, in-memory checkpoints, no deep links, no package import | The editor exists; the connection to a cloud and the AI-native layer do not |

## Specs and dependency order

```
StoryBook (web app)                                   StorybookStudio (the fork)

FILM-2004 (brand + edit policy) ─→ FILM-2001 (edit package tool) ─┐
FILM-2002 (edit sessions + events) ────────────────────────────────┼─→ FILM-2011 (cloud client) ─→ FILM-2012 (EditGraph + rough cut)
FILM-2005 (Studio OAuth client + Open in Studio) ──────────────────┘            ▲                          │
FILM-2003 (renders + delivery) ──────────────────────────→ FILM-2017 (delivery + variants) ◄── FILM-2014   ├─→ FILM-2013 (capability tools)
FILM-2002 + FILM-2003 ─→ FILM-2006 (edit record + analytics)                                              ├─→ FILM-2014 (render, QA, critic)
FILM-2001 ─→ FILM-2007 (regeneration + localization jobs) ─→ FILM-2019                                     ├─→ FILM-2016 (audio buses + captions)
                                                                                                           └─→ FILM-2015 (Studio UI)
FILM-2010 (fork + security baseline) ─→ FILM-2011
FILM-2013 + FILM-2014 ─→ FILM-2018 (compositions + semantic effects, v2)
FILM-2007 + FILM-2016 ─→ FILM-2019 (localization lanes, v2)
SPIKE-06 (continuity scoring, 2D puppets) — time-boxed, no dependents
```

| Spec | Repo | Milestone | Effort | Covers |
|------|------|-----------|--------|--------|
| [FILM-2001](./FILM-2001-edit-package-tool.yaml) | StoryBook | M1 | L | `get_edit_package`: one MCP tool that assembles scenes, shots, dialogue, audio, captions, characters, brand, policy and analytics hints with 1-hour signed R2 GETs and an ETag |
| [FILM-2002](./FILM-2002-edit-sessions-and-events.yaml) | StoryBook | M1 | M | `edit_sessions`, `edit_events`, `episodes.edit_state`; `open_edit_session`, `record_edit_events`, `close_edit_session`; the `editing` status finally set |
| [FILM-2003](./FILM-2003-renders-and-delivery.yaml) | StoryBook | M3 | L | `episode_renders`; `request_render_upload`, `finalize_render`, `deliver_edit` with the episode version lock; publish page reads renders |
| [FILM-2004](./FILM-2004-brand-and-edit-policy.yaml) | StoryBook | M0 | M | `projects.brand`, `projects.edit_policy`, their zod schemas and settings tabs |
| [FILM-2005](./FILM-2005-studio-oauth-client-and-open-in-studio.yaml) | StoryBook | M3 | M | The pre-registered `storybookstudio` OAuth client (`storybookstudio://` and loopback redirects), "Open in Studio" on the episode, "Editing in Studio" badge |
| [FILM-2006](./FILM-2006-edit-record-and-analytics.yaml) | StoryBook | M3 | M | The episode's Edit record page, `edit_sessions_fact` in ClickHouse, the Edit style card |
| [FILM-2007](./FILM-2007-regeneration-and-localization-jobs.yaml) | StoryBook | M4 | L | `regenerate_shots` and `localize_episode` tools over the existing workers; package ETag changes drive the Studio's re-sync |
| [FILM-2010](./FILM-2010-fork-and-security-baseline.yaml) | Studio | M0 | M | The fork, naming, upstream remote, `AI_EDITOR_CONTRACT.md`, MCP bearer secret and Origin check, `storybookstudio-file://` allowlist, persisted checkpoints |
| [FILM-2011](./FILM-2011-cloud-client.yaml) | Studio | M1 | L | Main-process MCP client to StoryBook: token vault (PAT and PKCE), pull job with resume and sha256, re-sync, `storybookstudio://` protocol |
| [FILM-2012](./FILM-2012-editgraph-and-rough-cut.yaml) | Studio | M1 | L | EditGraph v1 (additive fields on `project.storybookstudio`), the project builder's rough-cut rules, the operation log, versions, reports |
| [FILM-2013](./FILM-2013-agent-capability-tools.yaml) | Studio | M2 | XL | The `agent` MCP profile: 16 capability tools, intent compilers to action plans over the 130 primitives, the edit policy, the in-app agent on the same profile |
| [FILM-2014](./FILM-2014-render-qa-critic.yaml) | Studio | M2 | L | Preview render tiers, deterministic QA (FFmpeg), the critic, the apply → QA → repair loop |
| [FILM-2015](./FILM-2015-studio-ui.yaml) | Studio | M1–M3 | L | Welcome, episode picker, AI panel, scene strip, review screen, deliver screen |
| [FILM-2016](./FILM-2016-audio-buses-and-captions.yaml) | Studio | M2 | M | Audio buses with sidechain ducking and stems; brand caption styling and safe areas |
| [FILM-2017](./FILM-2017-delivery-and-variants.yaml) | Studio | M3 | L | Delivery presets, Shorts with subject-tracking reframe, the confirmed upload through FILM-2003's tools |
| [FILM-2018](./FILM-2018-compositions-and-semantic-effects.yaml) | Studio | M4 | XL | `composition` clips rendered by Remotion to cached alpha WebM; graphics primitives; semantic effects |
| [FILM-2019](./FILM-2019-localization-lanes.yaml) | Studio | M4 | L | Language lanes on one master edit, localized graphics that refit, per-language render and QA |
| [SPIKE-06](../spikes/SPIKE-06-continuity-and-puppets.yaml) | Studio | R&D | M | Shot-boundary continuity scoring; one layered 2D puppet in Remotion |

**Milestones.** M0 (contracts, fork, security, brand schema) is one week and
has no dependencies. M1 (pull and rough cut) closes when a 20-shot episode
opens as a correct rough cut in under two minutes and Claude can tighten it
with preview and undo, every change in the op log and restorable after a
restart. Met 2026-10-04 (FILM-2011, aroundAI/storybookstudio#7): 20-shot fixture
episode playable in 4.72 s over /api/mcp. M2 met 2026-10-05 (FILM-2013, aroundAI/storybookstudio#9): 'tighten scene 3 to 12 s and fix the audio' ran plan → preview → apply → version → report over MCP (21.0 s → 13.9 s; dialogue alone is 12.7 s, the card says so). M3 met 2026-10-05 (FILM-2017, aroundAI/storybookstudio#10): pull → Short → two renders → deliver_edit (TARGET_CHANGED then retry) → episode ready, publish page lists the renders, 59 s. M2 (the closed AI loop) closes when "tighten scene 3 to 12 s and fix
the audio" runs plan → preview → apply → render → QA → revise with no human
touch and produces a report. M3 (round trip) closes when idea to "Ready to
publish" happens without a manual file. M4 is v2: compositions, localization,
regeneration and analytics feedback. The two repos work in parallel from M0;
the web-app specs of a milestone land first because the fork's specs test
against them.

## How the loop works

**Open.** The user clicks "Open in Studio" on an episode (FILM-2005). The
Studio opens on `storybookstudio://open`, signs the user in through FILM-1907's OAuth
server as the pre-registered `storybookstudio` client (or with a pasted
`sbk_pat_` token), and calls `open_edit_session` then `get_edit_package` over
`/api/mcp` (FILM-2002, FILM-2001). It downloads the media from the package's
signed URLs with resume and checksums, writes a normal upstream project folder
with the rough cut assembled from the shots' timings, dialogue, music and
captions (FILM-2011, FILM-2012), and the episode shows "Editing in Studio" in
the web app.

**Cut.** The user types an instruction, or Claude Desktop calls the Studio's
own local MCP server. The `agent` profile's `studio_edit` compiles the intent
to a plan over the upstream editor's primitives, previews it as per-scene cards, and on
approval applies it into a new version while the operation log records every
step with its reason (FILM-2013, FILM-2012). The Studio renders keyframes and
a scene preview on the local GPU, runs deterministic QA and the critic, and
repairs its own technical failures before showing the result (FILM-2014).

**Deliver.** `studio_deliver` renders the chosen presets with hardware
encoding, QA-checks each file, uploads them to presigned URLs from
`request_render_upload`, finalizes each render, and calls `deliver_edit`
with the report and the episode version it edited (FILM-2017, FILM-2003).
StoryBook sets `final_video_url`, the session summary and `edit_state`, moves
the episode to `ready`, and the existing publish worker takes it from there.
The Edit record page shows the versions, the report and the renders
(FILM-2006).

**Learn.** The package carries retention drop-offs from analytics as hints;
re-opening a published episode places them as markers and offers a re-cut
intent (FILM-2001, FILM-2013). Edit style joins performance in ClickHouse
(FILM-2006).

## Locked decisions

**The desktop is an MCP client of StoryBook.** No new REST surface and no new
token table. StorybookStudio connects to `/api/mcp` with the SDK client, using
FILM-1904's personal access tokens or FILM-1907's OAuth 2.1 PKCE flow as a
pre-registered public client; `withMcpAuth` mints the RLS JWT as for any other
client, so every read and write runs as the user under the existing policies.
Bulk bytes (media down, renders up) move over signed R2 URLs the tools hand
out; nothing large passes through a tool call. This replaces the document's
`/api/v1` and `desktop_access_tokens` (Part 3), which were drafted before
Phase 19 was read. Scopes stay `studio:read` (package, session reads),
`studio:write` (sessions, events, delivery) and `studio:render` (regeneration
and localization jobs).

**StoryBook stores the record of an edit, not the edit.** The timeline lives
in the Studio's project folder (EditGraph v1, an additive extension of
the upstream project file, `project.storybookstudio`). StoryBook stores sessions, events, renders,
QA results and the explain-why report, which is what publishing and analytics
need. The retired `edit_projects/clips/tracks` tables are not revived.

**Episode is the unit, not project.** Scenes, shots, dialogue and timing hang
off `episodes`; a project is a series container with brand and policy.

**Rough cut on open, never an empty timeline.** The builder places shots by
`timeline_start_seconds` (or sequentially by `sequence_number`), dialogue by
its own start, music and SFX on their buses, captions on a captions track, one
marker per scene. Veo shot audio stays on and ducks under dialogue.

**The AI proposes, shows, applies on approval, checks, explains.** Every
capability tool defaults to `previewOnly: true`; every applied plan is a
version; every operation is logged with a reason; delivery always needs a
confirmation that names the episode, the files and the destination. The AI
never overwrites a hand edit silently.

**Sixteen capability tools over 130 primitives.** The model sees the `agent`
profile; the `expert` profile keeps every upstream tool. Intent compilers are
plain functions from context, scope, params and policy to an action plan with
reasons; the plan runs through the primitives' own preview path.

**Local compute, cloud memory.** Preview and delivery renders, QA, captions
and analysis run on the user's GPU and are free to repeat. Generation,
storage, publishing and analytics stay in StoryBook.

**Security before tokens.** The fork's MCP server gets a per-install bearer
secret and an Origin check, the `storybookstudio-file://` protocol gets a path
allowlist, checkpoints move to disk, and tokens live only in the main process
under `safeStorage`, before any StoryBook token is stored (FILM-2010).

**GPL-3.0 stays at arm's length.** The fork is GPL like the upstream editor and public;
StoryBook's server code is a separate program over HTTP. Remotion's company
license is confirmed before FILM-2018.

## Open questions (owner)

1. Which content type comes first: generative cinema, information or
   explainer videos, or cartoons? If explainer or cartoons, FILM-2018
   (graphics) moves ahead of FILM-2003/2017 (delivery).
2. Which model drives the agent and critic: Claude over the Studio's MCP,
   the Studio's in-app agent (LM Studio today), or a hosted model billed
   through StoryBook? The capability profile is the same either way; billing
   and the vision critic's availability differ.
3. Should `deliver_edit` auto-publish, or only attach renders and set `ready`
   for the existing publish flow? Recommended: attach only.
4. Is a Windows build needed at launch? Deep links and `safeStorage` differ
   per OS; the test matrix in FILM-2010 assumes macOS first.
5. FILM-2003: does a delivery on a `published` episode supersede the live
   renders, or create a new publish candidate? Recommended: supersede, with
   the publish page offering to re-publish.
6. FILM-2007: ElevenLabs Dubbing (one call per language, background audio
   preserved) or the existing per-line TTS for localized dialogue?
