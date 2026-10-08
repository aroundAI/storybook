> **Acceptance criteria are claims, and claims get executed.** One about a form
> is not met until the form has been driven end to end — four review rounds in
> FILM-1609 were spent on a criterion ticked by reading types. See
> [docs/ENGINEERING-WORKFLOW.md](../docs/ENGINEERING-WORKFLOW.md).

# Storybook Film Studio - Specification Documents

This directory contains all specification documents for the AI Cinematic Film Studio project, following **Spec-Driven Development (SDD)** methodology.

---

## Quick Links

- **[INDEX.md](./INDEX.md)** - Every spec's status, and progress
- **[SCHEMA.md](./SCHEMA.md)** - The YAML format task specs use, and why
- [Constitution](./constitution.md) - Non-negotiable project conventions
- [PRD](./PRD.md) - Product Requirements Document
- [Engineering Design](./ENGINEERING_DESIGN.md) - Technical architecture

---

## Two kinds of file here

**Task specs** (`FILM-*.yaml`, `SPIKE-*.yaml`) are machine-readable records:
one feature or module each, a fixed set of typed fields (status, effort,
dependencies, acceptance criteria with their evidence), described in
[SCHEMA.md](./SCHEMA.md). A script or an agent can load every one of these
and answer "what's open, and what does it depend on" without parsing prose.

**Everything else stays Markdown** — it's read by people, not folded into a
schema: the master index, this file, the constitution, the PRD and
engineering design, the phase READMEs (each with its own dependency graph and
locked decisions), and the living known-bugs register, `known-bugs/`: one
Markdown file per bug, with a few front-matter fields for tools
(`pnpm specs:known-bugs`) and the entry as prose under them.

## Folder Structure

```
specs/
├── INDEX.md                       # Every spec's status, and progress: the one place
├── README.md                      # This file
├── SCHEMA.md                      # The task-spec YAML format
├── constitution.md                # Project conventions (READ FIRST)
├── PRD.md                         # Original product requirements (December 2025)
├── ENGINEERING_DESIGN.md          # Original technical architecture (December 2025)
├── PRD-public-sharing.md          # Public sharing: requirements
├── ENGINEERING-public-sharing.md  # Public sharing: design and delivery (PR #126)
│
├── cross-cutting/                 # Upload validation (.yaml), webhooks (.yaml), OAuth refresh (.yaml); FILM-CC-04's stub (.md)
├── known-bugs/                    # FILM-CC-04, the known-bugs register: KB-<n>.md per bug, leads/, README
├── design-system/                 # UI patterns, tokens, accessibility (.yaml)
├── spikes/                        # Research & investigation (.yaml)
│
├── phase-1-foundation/            # Database, RLS, packages, schemas
├── phase-2-assets/                # Asset library (characters, locations)
├── phase-3-episodes/              # Episodes, story, screenplay, shot lists
├── phase-4-video-generation/      # In-app video generation (retired); Visual Studio
├── phase-5-audio-generation/      # Voice, music, cloning
├── phase-6-edit-suite/            # The timeline editor; the whole Edit Suite retired (FILM-607)
├── phase-7-publishing/            # Multi-platform publishing
├── phase-8-analytics/             # Cross-platform analytics
├── phase-9-integration/           # Navigation, settings, dashboard
├── phase-10-canon-management/     # Canon: continuity and memory
├── phase-11-canon-integration/    # Canon in generation; content types; facts; news
├── phase-12-scale/                # ClickHouse; network strategy
├── phase-13-hook-optimization/    # Retired
├── phase-14-edit-suite-v2/        # Edit suite v2 (one Markdown engineering doc); retired (FILM-607)
├── phase-15-deep-analytics/       # Analytics discipline
├── phase-16-workbook-parity/      # Workbook parity
├── phase-17-analytics-provenance/ # Provenance and signal
├── phase-18-local-vendor-sandbox/ # Local vendor sandbox
├── phase-19-dual-ai-mcp/          # Gemini in the app, Claude over MCP
├── phase-20-storybookstudio/      # The desktop AI editor (the StorybookStudio repo): specs for both repos
└── phase-21-competitor-intelligence/ # Watching other channels from public data; comparison with your own
```

Every phase folder's own subdirectories (`database/`, `components/`,
`providers/`, …) hold `.yaml` task specs; each phase's `README.md`, where one
exists, stays Markdown.

---

## Status and progress

**[INDEX.md](./INDEX.md) is the one place statuses are listed**, with what each
status means and the progress counts. Every task spec carries its own
top-level `status:` key, and INDEX is counted from those — never hand-edit
INDEX's counts.

This README used to keep a second copy of the phase 1–9 status tables (until
2026-09-23) and, before that, described every spec as Markdown with
frontmatter. Both drifted or went stale. This file describes what's actually
here; it doesn't restate per-spec status.

---

## How to Use This Directory

### For Reviewers
1. Read [constitution.md](./constitution.md) first
2. Check a spec's status in [INDEX.md](./INDEX.md), or open its `.yaml`
   directly — `status`, `acceptance_criteria[].met`, and `remaining` say
   exactly what's left and why
3. Read [docs/ENGINEERING-WORKFLOW.md](../docs/ENGINEERING-WORKFLOW.md) for how work is verified

### For Implementers
1. Pick a `DRAFT` spec whose dependencies have shipped (INDEX, and the phase README's graph)
2. Read the constitution for conventions, and follow `docs/ENGINEERING-WORKFLOW.md`
3. Build what the spec says; if the spec is wrong, correct it in the same PR
4. When it merges, set each `acceptance_criteria[]` entry's `met: true` **with
   `evidence:` beside it** (a `path:line`), and set the file's top-level
   `status:`. An entry still `met: false` makes the spec `PARTIAL`, with a
   `remaining:` entry naming who closes it — see [SCHEMA.md](./SCHEMA.md)
5. Update the spec's row in INDEX.md, and in its phase README if that has a table

### For Adding New Specs
1. Create the file in its phase folder as `FILM-<id>-<name>.yaml` (or
   `SPIKE-<id>-<name>.yaml`), following [SCHEMA.md](./SCHEMA.md): the common
   core fields plus the block for whichever category fits
2. Add a row to INDEX.md *By Phase*, and to the phase README. INDEX.md stores
   no count: `pnpm specs:index` checks the row and prints the totals

---

## Contributing

1. All specs must follow the [constitution](./constitution.md)
2. Follow [SCHEMA.md](./SCHEMA.md)'s format — don't invent new top-level keys or a new category
3. Include acceptance criteria that are testable
4. Link dependencies between specs (`dependencies: [{spec_id, note}]`, by id — never a path)
5. Keep specs focused (one task per spec)

---

**Last Updated:** 2026-09-23
