# Phase 22: Flexible Production

Seasons first, any entry point, publish what you have.

**Design document (approved by the owner, 2026-10-09):**
[FILM-2201 EDD](../plans/FILM-2201-flexible-production-edd.md). The specs
below are its task breakdown (EDD §11); where a spec and the EDD disagree,
the spec is the record and the EDD is updated.

## The problem

| Today | Consequence |
|---|---|
| A season is made only by Generate Season, or inline by the episode wizard | A creator can't lay out seasons before episodes exist |
| Publish opens only once a shot list exists (`episode-workspace-tabs.tsx:104`) | A finished cut made elsewhere can't be published without walking ideation to shots |
| Stage order is a chain, written twice (web tabs, MCP `deriveStages`) | Every stage gates the next, and the two copies can drift |
| `insert into seasons` exists twice; one copy doesn't retry a number race | A concurrent create in the wizard fails with a raw error |
| No MCP season tools; no MCP way to attach a video outside StorybookStudio | An external AI can't do either journey |

## Locked decisions (owner, 2026-10-09)

- Status pill: "In production" for `story/storyboard/generating/editing`.
- Channel import is out of scope. An episode gets analytics by being
  published through Storybook.
- Generate Season works exactly as today.

## Specs

| ID | Milestone |
|---|---|
| FILM-2201 | M0 Foundations: migration, season service, stage state |
| FILM-2202 | M1 Publish what you have (web) |
| FILM-2203 | M2 Seasons UI |
| FILM-2204 | M3 MCP seasons and video |
| FILM-2205 | M4 Start-from dialog and progress rail |
| FILM-2206 | M5 Follow-up from analytics |
