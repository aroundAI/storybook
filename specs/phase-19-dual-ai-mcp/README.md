# Phase 19: Dual AI — Gemini in the app, Claude over MCP

StoryBook gets a second way to be driven. The web app keeps generating with
server-side Gemini on Vertex AI, exactly as today. In addition, the app exposes
itself as a **remote MCP server** that Claude Desktop, claude.ai or any MCP
client adds as a custom connector. In that mode the external AI writes the
ideas, story, screenplay, shots and dialogue, and StoryBook is the system of
record, the validator and the analyzer: it makes **no model call of its own**
for that work.

**Design document (reviewed by the owner, 2026-10-02):**
[EDD: Dual AI Architecture](https://claude.ai/code/artifact/ecf5b05b-019e-4512-abfc-9d6523f0a242),
with a repository copy in [EDD.md](./EDD.md) (diagrams in Mermaid).
It carries the diagrams (system architecture, the external shot-list sequence,
the model-access door, the milestone graph) and the full low-level design. The
specs below are its task breakdown; where a spec and the EDD disagree, the spec
is the record and the EDD is updated.

## The problem, in one table

Measured 2026-10-02 on `main` at `58bb9f8`:

| | Today | Consequence |
|---|---|---|
| Where content is written | 15 LLM job types in the SQS-driven `apps/web/lambda/llm-worker`, plus 2 synchronous server actions | Nothing outside the worker can produce a story, screenplay or shot list |
| What decides *what to save* | Inline in each of the 16 handlers: canon commit, asset auto-create, `dialogue_lines` rebuild, audio-cue chaining, status moves, job bookkeeping | An external writer has no "write API"; it would have to re-implement every rule |
| Output validation | The worker extracts JSON but does not enforce the prompt's `output.schema` (`apps/web/lambda/llm-worker/prompt-registry.ts`) | Malformed model output can reach the tables in server mode too |
| Model access | `executeLLM`, `executeLLMForLambda`, `runAgent`, `createLLMClient`, the Voyage embedder, the OpenAI embedding helper and the transcription service are each importable from anywhere | Any developer can add a model call no one routes; nothing stops Claude-driven work from triggering Gemini |
| Dead call sites | Continuity checker, news actions and services, act-context bridge, agent story generation, element-prompt generator, OpenAI audio embedding, transcription: exported, never called | Dangling entry points to a model |
| Inbound API auth | `enhanceRouteHandler` is cookie-only; no personal access tokens, no OAuth server | No way for an MCP client to act as a user |
| `packages/mcp-server` | A stdio **developer** tool with SQL execution | Must never be exposed; the product server needs its own package |

## Specs and dependency order

```
FILM-1901 (generation core) ──┬─→ FILM-1903 (generation runs + locks) ─┐
FILM-1902 (model gateway) ────┘                                        │
FILM-1904 (MCP endpoint + tokens) ─┬─→ FILM-1905 (read tools)          │
                                   ├─→ FILM-1906 (analytics tools)     │
                                   └─→ FILM-1907 (OAuth + consent)     │
FILM-1903 + FILM-1904 ─→ FILM-1908 (external generation: story) ───────┘
FILM-1908 ─→ FILM-1909 (remaining stages, edits, renders)
FILM-1903 + FILM-1908 ─→ FILM-1910 (web UX for dual mode)
FILM-1907 + FILM-1909 + FILM-1910 ─→ FILM-1911 (general availability)
FILM-1911 + FILM-1732 ─→ FILM-1912 (performance context, Phase 2)
```

| Spec | Milestone | Effort | Covers |
|------|-----------|--------|--------|
| [FILM-1901](./FILM-1901-generation-core.yaml) | M0 | XL | `@kit/generation`: stage registry, `prepare`/`commit`/output schemas extracted from the 16 handlers, the worker moved onto it, parity tests |
| [FILM-1902](./FILM-1902-model-gateway.yaml) | M0 | L | `@kit/ai-gateway`: the one door to every model; `run.write()`; import boundary in lint and CI; dead call sites deleted |
| [FILM-1903](./FILM-1903-generation-runs.yaml) | M0/M3 | L | `generation_runs`, parts, revisions, leases, run-id-only worker messages, chained runs, the database locks |
| [FILM-1904](./FILM-1904-mcp-endpoint-and-tokens.yaml) | M1 | M | `/api/mcp` (stateless Streamable HTTP), `@kit/studio-mcp`, `withMcpAuth`, personal access tokens, rate limits, audit |
| [FILM-1905](./FILM-1905-mcp-read-and-author-tools.yaml) | M1 | M | Read tools for projects, episodes, stage content, assets; author tools for user-written inputs |
| [FILM-1906](./FILM-1906-mcp-analytics-tools.yaml) | M1 | L | ~20 read tools, one per analytics view in the web app; actions split into wrapper + service |
| [FILM-1907](./FILM-1907-mcp-oauth-and-consent.yaml) | M2 | L | OAuth 2.1 authorization server, DCR and client metadata documents, consent page, Connected apps settings |
| [FILM-1908](./FILM-1908-external-generation-story.yaml) | M3 | M | `start_generation` / `get_brief` / `submit_generation` / `finalize_generation`; the story stage end to end from Claude |
| [FILM-1909](./FILM-1909-external-generation-all-stages.yaml) | M4 | L | Every other stage, targeted edits, voice/music/SFX renders, the VEO manifest |
| [FILM-1910](./FILM-1910-dual-mode-web-ux.yaml) | M3–M5 | M | Lease banners, origin badges, team AI settings, Realtime refresh |
| [FILM-1911](./FILM-1911-dual-ai-general-availability.yaml) | M5 | S | Workflow guide, docs, dashboards and alerts, the no-LLM-env boot test |
| [FILM-1912](./FILM-1912-performance-context.yaml) | Phase 2 | M | Past-episode performance as brief context, in both modes |

M0, M1 and M2 can run in parallel. The first stage driven from Claude (FILM-1908)
needs the core, the runs and the endpoint; OAuth gates only general availability,
because personal access tokens cover testing.

## How the two flows work

**Web (unchanged in behaviour):** Generate button → `openRun` (server mode) →
SQS message `{ runId }` → worker: `prepare` → orchestrator + Gemini → `commit` →
tables → WebSocket and Realtime refresh.

**Claude over MCP:**

1. `start_generation` → `prepare` runs, a run row is opened (mode `external`,
   with a lease) and the brief returns: instructions, context, output JSON
   Schema, constraints, quality rubric.
2. Claude writes. State lives in the run row, not in memory, so the time it
   takes does not matter.
3. `submit_generation(runId, part)` validates one part (for example one scene's
   shots) and stores it in `generation_run_parts`, not in the content tables.
   Errors come back field by field; Claude resubmits the part.
4. `finalize_generation(runId)` runs **the same `commit()` the worker uses**, in
   one transaction, and opens any chained run in the same mode.
5. If Claude never returns, the lease expires, the run is marked expired, and
   nothing half-written ever reached the content tables.

## Locked decisions

**One generation core, two entry points.** Every AI stage is a
`StageDefinition` (`prepare`, `outputSchema`, `check`, `commit`). The worker and
the MCP tools call the same functions; neither keeps its own copy of the rules.
Prompt JSON files stay the single source of creative direction: in server mode
they are sent to Gemini, in external mode they are returned as the brief.

**One door to AI models.** Code never asks for a model; it asks a run for
output (`run.write(part)`), and the run's mode picks the writer. Only
`@kit/ai-gateway` may import `@kit/llm` or a model SDK, enforced in lint and CI.
`openRun` is the only constructor; MCP-originated runs are always external
(hard-coded in the MCP request context, not an argument); the worker never
opens a run, it loads one by id and refuses anything but an open server run;
chained stages inherit their parent's mode. The database refuses an LLM job
without a server run and a usage row without a run id. Registering a stage
exposes it to both modes, and a matrix test runs every stage in both, so a
developer who forgets the external path fails CI rather than opening a hole.

**No dangling entry points.** The call sites with no caller are deleted in
FILM-1902. Reviving one means registering it as a stage.

**Tools are the surface.** MCP tools, not resources or prompts, carry the
workflow, because every client supports them. Generation tools are generic
over the registry. Long work never runs inside a tool call; it returns a run id.

**Stateless Streamable HTTP inside the Next.js app.** No SSE stream, no
in-memory session, any instance serves any call; fits both Vercel and Lambda
via OpenNext. Credentials only in the `Authorization` header, never as tool
arguments.

**The MCP path never uses the service role for reads or writes on behalf of
the user.** `withMcpAuth` mints a 5-minute Supabase JWT for the token's user,
so RLS and the analytics `scope-access.ts` checks apply exactly as on the web.

**Media stays vendor-rendered.** Voice, music and SFX are ElevenLabs renders,
started by explicit render tools. Video is not rendered in-app today and stays
that way; Claude gets the VEO prompt manifest.

**Publishing is out of scope for MCP** in this phase: an outward, hard-to-undo
step stays a web action.

## Open questions (owner)

1. ~~FILM-1907: own OAuth server or Supabase's?~~ Decided 2026-10-02: our
   own small authorization server, compatible with Supabase (Supabase Auth is
   the login and identity, RLS applies, and a Supabase verifier can be swapped
   in behind `McpTokenVerifier`).
2. FILM-1908: is the agent's self-check against the quality rubric enough, or
   should commit refuse below a deterministic score?
3. FILM-1909: store ideation output on `episodes.metadata.ideas` for both modes
   (recommended), or keep external ideation conversational?
4. FILM-1910: may a team turn server generation off entirely?
5. FILM-1904: endpoint inside the Next.js app (recommended) or its own Lambda?
6. FILM-1911: is ChatGPT's connector support in scope for GA?
