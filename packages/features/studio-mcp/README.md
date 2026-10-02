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
client when `MCP_CONTRACT_URL` and `MCP_CONTRACT_TOKEN` are set.

`__tests__/tools/read-author.integration.test.ts` (FILM-1905) seeds two
teams and a token against a local Supabase and drives every read and author
tool through the SDK client, in-process by default or against a running
server with `MCP_INTEGRATION_URL`:

```bash
MCP_INTEGRATION=1 E2E_SUPABASE_URL=http://127.0.0.1:55321 \
  pnpm --filter @kit/studio-mcp test read-author.integration
```

`packages/mcp-server` is a different thing: a stdio developer tool with SQL
execution. `__tests__/boundaries.test.ts` fails if anything reachable from
`apps/web` imports it.
