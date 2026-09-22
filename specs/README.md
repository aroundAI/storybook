> **Acceptance criteria are claims, and claims get executed.** One about a form
> is not met until the form has been driven end to end — four review rounds in
> FILM-1609 were spent on a criterion ticked by reading types. See
> [docs/ENGINEERING-WORKFLOW.md](../docs/ENGINEERING-WORKFLOW.md).

# Storybook Film Studio - Specification Documents

This directory contains all specification documents for the AI Cinematic Film Studio project, following **Spec-Driven Development (SDD)** methodology.

---

## Quick Links

- **[INDEX.md](./INDEX.md)** - Every spec's status, and progress
- [Constitution](./constitution.md) - Non-negotiable project conventions
- [PRD](./PRD.md) - Product Requirements Document
- [Engineering Design](./ENGINEERING_DESIGN.md) - Technical architecture

---

## Folder Structure

```
specs/
├── INDEX.md                       # Every spec's status, and progress: the one place
├── README.md                      # This file
├── constitution.md                # Project conventions (READ FIRST)
├── PRD.md                         # Original product requirements (December 2025)
├── ENGINEERING_DESIGN.md          # Original technical architecture (December 2025)
├── PRD-public-sharing.md          # Public sharing: requirements
├── ENGINEERING-public-sharing.md  # Public sharing: design and delivery (PR #126)
│
├── cross-cutting/                 # Upload validation, webhooks, OAuth refresh; FILM-CC-04, the known-bugs register
├── design-system/                 # UI patterns, tokens, accessibility
├── spikes/                        # Research & investigation
│
├── phase-1-foundation/            # Database, RLS, packages, schemas
├── phase-2-assets/                # Asset library (characters, locations)
├── phase-3-episodes/              # Episodes, story, screenplay, shot lists
├── phase-4-video-generation/      # In-app video generation (retired); Visual Studio
├── phase-5-audio-generation/      # Voice, music, cloning
├── phase-6-edit-suite/            # The original timeline editor; replaced by phase 14
├── phase-7-publishing/            # Multi-platform publishing
├── phase-8-analytics/             # Cross-platform analytics
├── phase-9-integration/           # Navigation, settings, dashboard
├── phase-10-canon-management/     # Canon: continuity and memory
├── phase-11-canon-integration/    # Canon in generation; content types; facts; news
├── phase-12-scale/                # ClickHouse; network strategy
├── phase-13-hook-optimization/    # Retired
├── phase-14-edit-suite-v2/        # Edit suite v2
├── phase-15-deep-analytics/       # Analytics discipline
├── phase-16-workbook-parity/      # Workbook parity
├── phase-17-analytics-provenance/ # Provenance and signal
└── phase-18-local-vendor-sandbox/ # Local vendor sandbox
```

---

## Status and progress

**[INDEX.md](./INDEX.md) is the one place statuses are listed**, with what each
status means and the progress counts. Every spec file also carries its own
`status:` in frontmatter, and INDEX is counted from those.

This README used to keep a second copy of the phase 1–9 tables. It drifted: on
2026-09-23 it listed 87 specs as `DRAFT` that had shipped months earlier. It no
longer repeats them.

---

## How to Use This Directory

### For Reviewers
1. Read [constitution.md](./constitution.md) first
2. Check a spec's status in [INDEX.md](./INDEX.md)
3. Read [docs/ENGINEERING-WORKFLOW.md](../docs/ENGINEERING-WORKFLOW.md) for how work is verified

### For Implementers
1. Pick a `DRAFT` spec whose dependencies have shipped (INDEX, and the phase README's graph)
2. Read the constitution for conventions, and follow `docs/ENGINEERING-WORKFLOW.md`
3. Build what the spec says; if the spec is wrong, correct it in the same PR
4. When it merges, tick each criterion **with its evidence beside it** and set the file's `status:`. A criterion still open makes the spec `🟡 PARTIAL`, with a *Remaining* section naming who closes it
5. Update the spec's row in INDEX.md, and in its phase README if that has a table

### For Adding New Specs
1. Create the file in its phase folder, with frontmatter: `spec_id`, `title`, `status: DRAFT`, `effort`, `dependencies`
2. Add a row to INDEX.md *By Phase*, and to the phase README
3. Recount that phase's row in the INDEX *Progress Tracker*

---

## Contributing

1. All specs must follow the [constitution](./constitution.md)
2. Use the spec template format
3. Include acceptance criteria that are testable
4. Link dependencies between specs
5. Keep specs focused (one task per spec)

---

**Last Updated:** 2026-09-23
