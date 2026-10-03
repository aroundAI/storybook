# @kit/studio-mcp

StoryBook's remote MCP server (FILM-1904; design in
`specs/phase-19-dual-ai-mcp/EDD.md`, sections 4 and 5). `apps/web/app/api/mcp`
serves it: stateless Streamable HTTP, JSON responses, a fresh `McpServer` per
request from the tool registry here.

## Entry points

| Import | Contents | server-only |
| --- | --- | --- |
| `@kit/studio-mcp` | `McpToolError` and the nine codes, `McpScopeSchema`, `McpPrincipal`, `defineTool`, `McpTokenVerifier`, the request context | no |
| `@kit/studio-mcp/request-context` | `getMcpRequestContext()` alone, for packages the Lambda worker bundles | no |
| `@kit/studio-mcp/scopes` | `MCP_SCOPES`, `McpScopeSchema`, `McpScopesSchema`, `hasScope`: the only entry a `'use client'` file may import values from (the root pulls in `node:async_hooks`) | no |
| `@kit/studio-mcp/server` | `createMcpRouteHandlers`, `withMcpAuth`, verifiers, signer, rate limits, audit, personal access tokens, `defaultTools` | yes |

## Adding a tool

```ts
import { z } from 'zod';
import { defineTool, McpToolError } from '@kit/studio-mcp';

export const getEpisode = defineTool({
  name: 'get_episode',
  title: 'Get episode',
  description: 'One episode with its stage content.',
  inputSchema: { episodeId: z.string().uuid() },
  scope: 'studio:read',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  async handler(input, { principal, accountId }) {
    const { data } = await principal.supabase // RLS-scoped, as the user
      .from('episodes').select('*').eq('id', input.episodeId).maybeSingle();
    if (!data) throw new McpToolError('NOT_FOUND', 'No such episode');
    return { structuredContent: data };
  },
});
```

Then pass it to the route: `createMcpRouteHandlers({ tools: [...defaultTools, getEpisode] })`,
or append it to the list in `src/server/tools/index.ts`, which is what the
route serves by default.

## The tools today

| Tool | Scope | What it does |
| --- | --- | --- |
| `whoami` | any | user, team, scopes, generation mode (FILM-1904) |
| `get_workflow_guide` | read | stage order, what each stage needs, how brief/submit/finalize work; also the `workflow_guide` prompt |
| `list_projects`, `get_project` | read | projects of the bound team with their series settings; episode, character and location counts |
| `list_episodes`, `get_episode` | read | episodes without deleted ones; `get_episode` adds stage status (locked/available/done per stage), the story, a screenplay summary, counts and per-stage origin (null until FILM-1903) |
| `get_screenplay`, `get_shots`, `get_dialogue` | read | full stage content, paged by scene |
| `list_assets` | read | characters (with details) and locations, other types on request |
| `create_project`, `update_project` | write | name, description, slug, status, and the studio settings page's series settings |
| `create_episode`, `update_episode` | write | title, description (logline), target duration, content style, visual tone, tone notes; `update_episode` is optimistic-locked (`TARGET_CHANGED`) |
| `upsert_asset` | write | a character or a location, by `assetId` or by type and name |
| `start_voice_render` | render | ElevenLabs voice for one line or the whole episode, through the web's own render start (FILM-1909) |
| `start_audio_render` | render | music, SFX or ambience for one audio cue (`audio-file-generation`), through the web's own render start |
| `get_render_progress` | render | lines and cues by status, what is still rendering or failed, and the voice batch |
| `edit_scene`, `edit_shot`, `edit_dialogue_line` | write | one scene, shot or English line, checked as its stage checks it, versioned and snapshotted (FILM-1909) |
| `get_veo_manifest` | read | the visual studio's OpenClaw export: VEO prompts, frame descriptions, transitions and reference images per shot, paged by scene |
| `link_assets_to_episode` | write | links existing characters and locations (up to 50) to an episode, as the episode header does; the screenplay, shots and audio stages read their cast from these links (KB-183) |

Every list and long-content tool pages with `cursor` and `limit` (max 50);
screenplay, shots and dialogue page by whole scenes
(`src/server/tools/pagination.ts`). Each author tool validates with the same
Zod schema as its web form (`@kit/projects/schemas`,
`@kit/projects/schemas/studio-settings`, `@kit/episodes/schemas`,
`@kit/episodes/schemas/create-episode-wizard`, `@kit/assets/character-schemas`,
`@kit/assets/schemas/location`) and writes through the same service function
the web action calls (`@kit/projects/service`, `@kit/episodes/server/episode-service`,
`@kit/assets/service`, `@kit/assets/character/service`). None writes
`story_data`, `screenplay_data`, `shot_list`, `shots`, `dialogue_lines` or
`audio_cues`; `__tests__/tools/no-generated-writes.test.ts` fails if one starts to.

Two kinds of refusal reach a client: the SDK validates `inputSchema` before
the handler and answers a JSON-RPC `-32602` ("Invalid arguments"), which the
SDK client throws; a refusal the handler or database makes (slug taken,
version moved, row not in your team) is a tool result with `isError` and
the error contract (`VALIDATION_FAILED`, `TARGET_CHANGED`, `NOT_FOUND`).
Every read is scoped to the bound team on top of RLS, so another team's id
is `NOT_FOUND`, never `FORBIDDEN`.

What the registry does around every handler, so a tool does not:

1. Counts the call against the connection's and the team's limits (120 calls
   and 20 writes a minute by default; `MCP_RATE_LIMIT_CALLS_PER_MIN`,
   `MCP_RATE_LIMIT_WRITES_PER_MIN`). Over: `RATE_LIMITED` with
   `details.retry_after_s`.
2. Checks the tool's `scope` against the connection's.
3. Resolves the team as the user (so a lost membership is `FORBIDDEN`), and
   checks the optional `account` slug every tool accepts against it. A token
   is bound to one team; another team's slug is `FORBIDDEN`.
4. Runs the handler inside the request context, where
   `getMcpRequestContext().mode === 'external'` (FILM-1903's `openRun` reads
   it; the mode is never an argument).
5. Turns a thrown `McpToolError` into `isError` with
   `structuredContent {code, message, retryable, details}`; anything else
   into `INTERNAL` with no detail (the detail is logged with the request id).
6. Writes an `mcp_tool_calls` row: tool, status, error code, duration, run
   id (`context.setRunId`). Never the arguments or the result.

The handler's only database client is `principal.supabase`, minted for the
user; `__tests__/boundaries.test.ts` fails the build if anything under
`src/server/tools/` imports a service-role client.

## Render and edit tools (FILM-1909)

The render tools call the functions the audio studio's actions call
(`@kit/audio-generation/server/render-starts`), with the principal's
client: the same write check (`authorizeEpisodeTarget`), voice assignment,
estimated cost on `batch_generation_jobs`, and the team's own ElevenLabs key
in the worker that renders. No language model is called;
`__tests__/render.contract.test.ts` proves it against a local Supabase and
ElasticMQ (`MCP_CONTRACT_SEED=1 RENDER_CONTRACT_SQS=http://127.0.0.1:4120`).

`edit_scene`, `edit_shot` and `edit_dialogue_line` (`src/server/tools/edit/`)
validate an edit with the stage's own output schema and `check()` and map it
to a commit plan. `runLayerEditWriter` opens an external run for the edit's
stage on the episode at the caller's version and applies the plan through
`apply_generation_commit`: one transaction, the version re-checked under a
lock (TARGET_CHANGED), what it replaces snapshotted into content_revisions.
The allowlist takes an update on a shot's or a line's content columns only
(migration `*_film-1909-edit-commit-allowlist.sql`).

`__tests__/generation-all-stages.contract.test.ts` drives every registered
stage over MCP with the scripted client in `__tests__/helpers/all-stages-script.ts`
(`MCP_CONTRACT_SEED=1`, in process or against `MCP_CONTRACT_URL`), then the
three edits; `apps/e2e/tests/mcp/external-all-stages.spec.ts` runs the same
script and reads the results off the studio pages.

## Analytics tools (FILM-1906)

`src/server/tools/analytics/` holds one read tool per dashboard area and the
six analytics writes, all in `defaultTools`. Each is a thin adapter over the
service FILM-1906 part A split out of the page's action
(`@kit/content-analytics/server/*-service`): the tool parses with the
service's exported schema, calls the service on `principal.supabase`, and
returns `{ view?, data, notes }`. No tool takes an account id: the scope is
the connection's team, and a project, channel, video, episode, experiment or
report of another team is `FORBIDDEN` even when the user is a member there
(`shared.ts`, `requireTeamScope` and the `requireOwned*` helpers).

| Tool | `view` | ClickHouse-off state it passes through |
| --- | --- | --- |
| `get_account_overview` | | null totals, `notes.measured: false` |
| `get_project_analytics` | overview, content, daily, audience | null views, empty series |
| `get_deep_dive` | median, rolling_views, traffic, back_catalog, cohorts, ypp_progress, returning_viewers, weekly_diagnostics, subscribers | empty series |
| `get_retention_curve` | | empty `points` |
| `get_video_log` | | no rows; `freshness` from the sync records |
| `get_language_analytics` | performance, platform_matrix, content_type, shorts_source, geography, trend, divergence | empty |
| `get_episode_analytics` | | null views; `freshness` is the page's "last refreshed" line |
| `get_video_funnel` | | `{ status: 'analytics_off' }` |
| `get_revenue` | summary, timeseries, top_content, projection, by_currency | with `revenueAccess`, the web's check, first |
| `get_reach_overview` | | `Measured` values that say why |
| `list_experiments`, `get_experiment` | | stored snapshots, nulls kept |
| `list_channel_experiments`, `get_channel_experiment` | | `results.kind: 'analytics_off'` |
| `get_tag_performance` | tags, median_by_tag, segments | empty rows |
| `get_genome_findings` | | `{ status: 'refused', refusal: { kind: 'analytics_off' } }` |
| `get_data_coverage`, `list_channels` | | `observed: false` |
| `list_reports`, `get_report_download` | | — |
| `get_analytics_settings` | | — |
| `get_saved_insights` | | — (the `analytics_insights_cache_read` policy) |
| `get_ai_usage` | | split by `generation_runs.mode` through `run_id` (FILM-1903); `byMode: null` with the reason on a database without the column |

Writes (`studio:write`): `update_publish_note`, `assign_publish_tags`,
`create_experiment`, `start_experiment`, `conclude_experiment`,
`abandon_experiment`. Not exposed, by test: ingest and sync, cron, manual
revenue, platform revenue sync, report schedules, super-admin.

`notes` is the coverage strip's answer for the same scope and window plus
`measured` and, when ClickHouse is off (production's state), the reason the
figures are null or empty rather than zero. A service's `ActionRefusal` is
returned as `isError` with its own words (`shared.ts`, `callService`).

This package must not import `@kit/clickhouse` (no RLS there): the package's
`eslint.config.mjs` forbids it and `__tests__/boundaries.test.ts` scans for it.

## Authentication

`withMcpAuth` resolves `Authorization: Bearer …` through an `McpTokenVerifier`:

- `own` (default): opaque tokens whose SHA-256 hashes are in `mcp_tokens`.
  Personal access tokens (`sbk_pat_…`, created in Settings → Connected apps)
  today; FILM-1907's access and refresh tokens next.
- `supabase` (FILM-1907): Supabase Auth's OAuth server JWTs, mapped to the
  same `McpConnectionRecord`.

A verified token yields an `McpPrincipal` whose `supabase` client carries a
5-minute HS256 JWT (`sub` = user, `role` = `authenticated`) signed with
**`SUPABASE_JWT_SECRET`**, the project's JWT secret (Supabase dashboard →
Settings → API). Local Supabase's is the published default in
`apps/web/.env.development`. FILM-1907 adds signing with an imported private
key behind `McpJwtSigner`; `MCP_JWT_PRIVATE_KEY` is reserved for it.

Refusals: no or malformed/unknown/expired/revoked token → HTTP 401,
`WWW-Authenticate: Bearer resource_metadata="<site>/.well-known/oauth-protected-resource"`
(the metadata route is FILM-1907's); a valid token whose user left the team →
HTTP 403. Membership is re-checked on every call, and nothing is cached, so a
revocation in settings refuses the next call.

## Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `SUPABASE_JWT_SECRET` | signs the minted user JWT | required |
| `MCP_AUTH_SERVER` | which verifier (`own`) | `own` |
| `MCP_RATE_LIMIT_CALLS_PER_MIN` / `MCP_RATE_LIMIT_WRITES_PER_MIN` | limits | 120 / 20 |
| `MCP_ALLOWED_ORIGINS` | CORS origins, comma-separated | `https://claude.ai` |
| `CACHE_PROVIDER`, `REDIS_URL` | where the counters live (`@kit/cache`) | memory |

With the memory cache each Lambda instance counts on its own; set
`CACHE_PROVIDER=redis` for one shared count.

## Trying it

```bash
TOKEN=sbk_pat_…   # from Settings → Connected apps
curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
```

MCP Inspector: `npx @modelcontextprotocol/inspector`, transport Streamable
HTTP, URL `http://localhost:3000/api/mcp`, header `Authorization: Bearer …`.
The contract test (`__tests__/contract.test.ts`) does the same with the SDK
client, then drives every read and author tool (FILM-1905). Two ways to run
it: against a running server with a token you made
(`MCP_CONTRACT_URL`, `MCP_CONTRACT_TOKEN`), or seeded
(`MCP_CONTRACT_SEED=1`, `E2E_SUPABASE_URL`), which creates two teams and a
token against a local Supabase and, without `MCP_CONTRACT_URL`, runs the
route handlers in-process behind the client's `fetch`, so no server is
needed. The checks that need a second team, a deleted episode, an admin read
of `mcp_tool_calls` or a read-only token run only when seeding.

```bash
MCP_CONTRACT_SEED=1 E2E_SUPABASE_URL=http://127.0.0.1:55321 \
  pnpm --filter @kit/studio-mcp test contract
```

`packages/mcp-server` is a different thing: a stdio developer tool with SQL
execution. `__tests__/boundaries.test.ts` fails if anything reachable from
`apps/web` imports it.
