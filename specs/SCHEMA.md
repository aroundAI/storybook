# Task spec schema

Every `FILM-*.yaml` and `SPIKE-*.yaml` file under `specs/` follows this shape.
It exists so a script or an agent can answer "what's open, and what does it
depend on" across ~226 specs without parsing prose — see
[README.md](./README.md#two-kinds-of-file-here) for which files this covers
and which stay Markdown.

Adopted 2026-09-23, converting every existing task spec from Markdown. If
you're adding a new spec or editing an existing one, this is the contract:
don't add a top-level key that isn't listed here, and don't invent a category.
If a real spec doesn't fit, that's a reason to extend this document, not to
freelance one file.

## Conventions

- 2-space indent, `snake_case` keys throughout.
- `status` is a plain enum string, no emoji: `DONE`, `PARTIAL`, `RETIRED`,
  `DRAFT`, or `DEFERRED`.
- Dates are quoted ISO strings (`"2026-09-23"`); `spec_id` is always quoted.
- A list with no entries is `[]`, not omitted. Omit a key only when the whole
  concept doesn't apply to this file (no `retirement:` unless `status:
  RETIRED`).
- **Spec-to-spec references are bare ids, never paths or links.** Write
  `FILM-1711` in prose, not a markdown link to its file — a reader resolves
  the id via [INDEX.md](./INDEX.md). This is what keeps specs from going
  stale when a file moves.
- Prose uses a folded block scalar (`summary: >`); anything where line breaks
  matter (a kept code/SQL excerpt) uses a literal one (`notes: |`).

## Common core

Every file has this top level:

```yaml
spec_id: "FILM-101a"
title: "Seasons Table"
phase: 1
phase_name: "Foundation"
category: database_table          # one of the fixed names below
status: DONE
audited: "2026-09-23"             # omit if this spec has never been re-verified against the code
effort: S                         # XS | S | M | L | XL — omit if not sized
dependencies:                     # always present; [] if none
  - spec_id: "FILM-101b"
    note: null                    # a qualifier, e.g. "TikTok leg only" — null if none
summary: >
  One paragraph: what this spec is and why it exists.
acceptance_criteria:
  - text: "Unique constraint on (project_id, number)"
    met: true
    evidence: "apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:31"
  - text: "Season number = 0 (should fail if check constraint added)"
    met: false
    reason: "not met — no check constraint exists"
test_plan:                        # omit the whole key if this spec has no test plan
  unit:
    - {text: "...", met: false, reason: "not met — no test found"}
  integration: []
  e2e: []
remaining: []                     # only present when status: PARTIAL — see below
retirement: null                  # only present (non-null) when status: RETIRED — see below
open_questions: []                # verbatim "Open Questions" bullets; [] if none
notes: >
  Anything with no typed home above: implementation notes, risk sections,
  locked decisions, known limits, corrections to an earlier draft.
```

**`acceptance_criteria` / `test_plan` items.** `met: true` needs `evidence:`
(a `path:line`, or a short description when there's no single line — a CI
run, a vendor doc citation). `met: false` needs `reason:`. A spec with no
checkboxes at all (a strategy doc, a research spike) has
`acceptance_criteria: []`, and puts its real content — findings, decisions,
deliverables — in the category block and `notes:`.

**`remaining:`** — only when `status: PARTIAL`:

```yaml
remaining:
  - criterion: "RLS applied and tested"
    reason: "no pgTAP test covers any canon policy"
    closed_by: "KB-17"            # a spec_id, a KB id, "owner", "unassigned", or null
```

**`retirement:`** — only when `status: RETIRED`:

```yaml
retirement:
  commit: "5b88db3a"
  date: "2026-01-15"              # null if unknown
  what_happened: >
    Prose.
  replacement: "apps/web/app/.../frame-uploader.tsx"   # or null — nothing replaced it
```

A retired spec's `acceptance_criteria` may drop `met`/`evidence` (just
`text:`) — retirement makes them moot.

## Categories

`category:` picks which extra top-level block a file carries. The category is
fixed by what the spec actually describes, not by convenience — see the
worked field lists below for what each expects. Where a leaf field doesn't
apply, use `null` or `[]` rather than inventing a value.

| category | extra key | typically |
|---|---|---|
| `database_table` | `database_table:` | a Postgres table: columns, indexes, FKs |
| `rls_policy` | `rls_policy:` | row-level security policies on a table |
| `db_function` | `db_function:` | a Postgres function |
| `package` | `package:` | a `packages/` module's public surface |
| `component` | `component:` | a React component |
| `page` | `page:` | a route/page |
| `library` | `library:` | a lib module (no DB, no UI) |
| `server_action` | `server_action:` | one or more `enhanceAction` server actions |
| `provider` | `provider:` | a vendor API client |
| `queue` | `queue:` | an SQS/job queue |
| `webhook` | `webhook:` | an inbound webhook handler |
| `oauth_flow` | `oauth_flow:` | a connect/callback OAuth flow |
| `prompt_template` | `prompt_template:` | an LLM prompt template |
| `cross_cutting_concern` | `cross_cutting_concern:` | a repo-wide convention (upload validation, webhook security) |
| `design_guideline` | `design_guideline:` | a design-system convention |
| `research_spike` | `research_spike:` | a time-boxed investigation |
| `strategy` | `strategy:` | a decision/recommendation document with no single artifact |
| `feature` | `feature:` | a feature spanning DB + queries + actions + UI in one spec (most of phases 11, 15–18) |

```yaml
database_table:
  table_name: "seasons"
  migration: "apps/web/supabase/migrations/20251205125737_film-studio-tables.sql"
  columns: [{name: id, type: uuid, nullable: false, default: "gen_random_uuid()", description: null}]
  indexes: [{name: "seasons_project_id_number_key", columns: [project_id, number], unique: true}]
  foreign_keys: [{column: project_id, references: "projects(id)", on_delete: CASCADE}]
  rls_enabled: true

rls_policy:
  table: "immutable_events"
  policies: [{name: "...", command: SELECT, roles: [authenticated], using: "...", with_check: null}]

db_function:
  function_name: "create_character_with_details"
  security: DEFINER                 # DEFINER | INVOKER
  language: plpgsql
  parameters: ["p_project_id uuid"]
  returns: "jsonb"
  migration: "apps/web/supabase/migrations/20251207165513_film-studio-functions.sql"

package:
  package_name: "@kit/assets"
  path: "packages/features/assets/"
  exports: ["listCharacters"]
  package_dependencies: ["@kit/supabase"]

component:
  component_name: "AssetGallery"
  file_path: "packages/features/assets/src/components/asset-gallery.tsx"
  props: [{name: "projectId", type: "string", required: true, description: null}]
  states: ["loading", "empty", "error"]
  accessibility_notes: null

page:
  route: "/home/[account]/studio/[projectSlug]/assets"
  file_path: "apps/web/app/home/[account]/studio/[projectSlug]/assets/page.tsx"
  components_used: ["AssetGallery"]

library:
  module_name: "rate-limiter"
  file_path: "packages/features/video-generation/src/lib/rate-limiter.ts"
  exports: ["checkRateLimit"]
  algorithm: >
    Prose.

server_action:
  actions: [{name: "createEpisode", file: "packages/features/episodes/src/server/actions.ts", schema: "CreateEpisodeSchema", auth: true}]

provider:
  vendor: "Kling"
  file_path: "packages/features/video-generation/src/providers/kling-provider.ts"
  base_url: "https://api.klingai.com"
  auth: "API key"
  endpoints: [{method: POST, path: "/v1/videos/text2video", purpose: "generate"}]
  rate_limits: null
  webhooks: []

queue:
  queue_name: "video-generation"
  job_types: ["generate", "poll"]
  concurrency: null
  retry_policy: null

webhook:
  endpoint: "apps/web/app/api/generation/webhooks/kling/route.ts"
  events: ["completed", "failed"]
  signature_verification: "HMAC-SHA256"

oauth_flow:
  vendor: "TikTok"
  scopes: ["video.upload", "user.info.basic"]
  endpoints: {authorize: "...", token: "...", revoke: null}
  redirect_uri: "apps/web/app/api/platforms/callback/tiktok/route.ts"

prompt_template:
  template_id: "scene-shot-generation"
  file_path: "packages/features/prompt-engine/src/prompts/story-generation/scene-shot-generation.json"
  model: null
  variables: ["reel_note"]

cross_cutting_concern:
  concern_name: "File Upload Validation"
  applies_to: ["assets", "audio", "video"]
  rules: ["Validate magic bytes, not just extension"]
  file_path: "packages/features/assets/src/lib/upload-validation.ts"

design_guideline:
  guideline_type: "Component Inventory"
  applies_to: ["packages/ui"]
  patterns: ["..."]
  file_path: null

research_spike:
  question: "Which video generation API best fits our needs?"
  findings: ["..."]
  recommendation: "..."
  docs: ["docs/kling-integration-guide.md"]
  poc_path: null

strategy:
  decisions: ["..."]
  recommendation: >
    Prose.

feature:
  database: {tables: ["..."], columns_added: ["..."]}
  queries: [{name: "queryMedianViewsPerVideo", purpose: "...", file: "packages/clickhouse/src/queries-advanced.ts"}]
  actions: [{name: "getRetentionCurveAction", file: "..."}]
  ui: [{component: "RetentionCurveChart", file: "..."}]
  provider_integration: null        # {vendor, endpoints} when the feature wraps a vendor API
```

`feature:` is deliberately the loosest category — it's the right home for a
spec that genuinely spans layers rather than living in one of `phase-N/<sub
directory>/`. Extend its block with extra fields (as `FILM-716` does, with
`user_stories:` and `key_features:`) before reaching for `notes:` — a real
list is more useful to a reader than a paragraph.

## What a tool can rely on

- Every task spec has `spec_id`, `title`, `status`, `category`. Nothing else
  is guaranteed non-empty.
- `status` values and their meaning are documented once, in
  [INDEX.md](./INDEX.md#progress-tracker) — don't duplicate the legend here.
- A `dependencies[].spec_id` and a `remaining[].closed_by` that looks like
  `FILM-\d+` or `KB-\d+` should resolve to a real spec or a real entry in
  `FILM-CC-04-known-bugs.md`. Nothing enforces that automatically yet.
- An item that is not `met: true` never has a `closed_by` naming finished
  work: a KB in FILM-CC-04's *Fixed* table, or a spec that is DONE or
  RETIRED. When you fix a KB or finish a spec, `git grep 'closed_by: "<ID>"'`
  and reconcile every hit against the code. Enforced by
  `packages/shared/__tests__/spec-closed-by-drift.test.ts` (KB-80).
