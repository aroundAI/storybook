# Storybook Film Studio - Specification Documents

This directory contains all specification documents for the AI Cinematic Film Studio project, following **Spec-Driven Development (SDD)** methodology.

---

## Quick Links

- [Constitution](./constitution.md) - Non-negotiable project conventions
- [PRD](/PRD.md) - Product Requirements Document
- [Engineering Design](/ENGINEERING_DESIGN.md) - Technical architecture

---

## Folder Structure

```
specs/
├── constitution.md           # Project conventions (READ FIRST)
├── README.md                 # This file
│
├── phase-1-foundation/       # Database, packages, schemas
├── phase-2-assets/           # Asset library (characters, locations)
├── phase-3-episodes/         # Episodes, story generation
├── phase-4-video-generation/ # Video generation (Kling, etc.)
├── phase-5-audio-generation/ # Audio generation (ElevenLabs, Suno)
├── phase-6-edit-suite/       # Timeline editor
├── phase-7-publishing/       # Multi-platform publishing
├── phase-8-analytics/        # Cross-platform analytics
├── phase-9-integration/      # Navigation, settings, polish
└── spikes/                   # Research & investigation
```

---

## MVP Scope (Phases 1-5)

| Phase | Description | Spec Count | Priority |
|-------|-------------|------------|----------|
| 1 | Foundation & Database | 25 | P0 |
| 2 | Asset Library | 9 | P0 |
| 3 | Episodes & Story | 12 | P0 |
| 4 | Video Generation | 12 | P0 |
| 5 | Audio Generation | 8 | P0 |
| - | Spikes | 5 | P0 |
| **Total MVP** | | **71** | |

---

## Post-MVP (Phases 6-9)

| Phase | Description | Spec Count | Priority |
|-------|-------------|------------|----------|
| 6 | Edit Suite | 4 | P1 |
| 7 | Publishing | 11 | P1 |
| 8 | Analytics | 8 | P2 |
| 9 | Integration | 6 | P2 |
| **Total Post-MVP** | | **29** | |

---

## Spec Status Legend

| Status | Meaning |
|--------|---------|
| `DRAFT` | Initial spec written, needs review |
| `REVIEW` | Under review, feedback requested |
| `APPROVED` | Ready for implementation |
| `IN_PROGRESS` | Implementation started |
| `DONE` | Implementation complete & tested |

---

## Phase 1: Foundation

### Database Tables
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-101a | [seasons-table](./phase-1-foundation/database/FILM-101-seasons-table.md) | DRAFT | S |
| FILM-101b | [episodes-table](./phase-1-foundation/database/FILM-101-episodes-table.md) | DRAFT | S |
| FILM-101c | [shots-table](./phase-1-foundation/database/FILM-101-shots-table.md) | DRAFT | S |
| FILM-101d | [assets-table](./phase-1-foundation/database/FILM-101-assets-table.md) | DRAFT | S |
| FILM-101e | [character-details-table](./phase-1-foundation/database/FILM-101-character-details-table.md) | DRAFT | XS |
| FILM-101f | [voice-profiles-table](./phase-1-foundation/database/FILM-101-voice-profiles-table.md) | DRAFT | XS |
| FILM-101g | [dialogue-lines-table](./phase-1-foundation/database/FILM-101-dialogue-lines-table.md) | DRAFT | XS |
| FILM-101h | [audio-tracks-table](./phase-1-foundation/database/FILM-101-audio-tracks-table.md) | DRAFT | XS |
| FILM-101i | [generation-jobs-table](./phase-1-foundation/database/FILM-101-generation-jobs-table.md) | DRAFT | M |
| FILM-101j | [platform-connections-table](./phase-1-foundation/database/FILM-101-platform-connections-table.md) | DRAFT | S |
| FILM-101k | [publishes-table](./phase-1-foundation/database/FILM-101-publishes-table.md) | DRAFT | S |
| FILM-101l | [content-analytics-table](./phase-1-foundation/database/FILM-101-content-analytics-table.md) | DRAFT | S |
| FILM-101m | [shared-resources-table](./phase-1-foundation/database/FILM-101-shared-resources-table.md) | DRAFT | XS |
| FILM-101n | [external-api-keys-table](./phase-1-foundation/database/FILM-101-external-api-keys-table.md) | DRAFT | XS |

### RLS Policies
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-102a | [enable-rls](./phase-1-foundation/rls/FILM-102-enable-rls.md) | DRAFT | XS |
| FILM-102b | [project-policies](./phase-1-foundation/rls/FILM-102-project-policies.md) | DRAFT | M |
| FILM-102c | [account-policies](./phase-1-foundation/rls/FILM-102-account-policies.md) | DRAFT | S |

### Database Functions
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-103 | [transaction-functions](./phase-1-foundation/functions/FILM-103-transaction-functions.md) | DRAFT | M |

### Packages
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-104 | [film-studio-package](./phase-1-foundation/packages/FILM-104-film-studio-package.md) | DRAFT | S |
| FILM-105 | [assets-package](./phase-1-foundation/packages/FILM-105-assets-package.md) | DRAFT | S |
| FILM-106 | [episodes-package](./phase-1-foundation/packages/FILM-106-episodes-package.md) | DRAFT | S |
| FILM-107 | [video-generation-package](./phase-1-foundation/packages/FILM-107-video-generation-package.md) | DRAFT | S |
| FILM-108 | [audio-generation-package](./phase-1-foundation/packages/FILM-108-audio-generation-package.md) | DRAFT | S |
| FILM-109 | [zod-schemas](./phase-1-foundation/packages/FILM-109-zod-schemas.md) | DRAFT | M |
| FILM-110 | [project-extension](./phase-1-foundation/packages/FILM-110-project-extension.md) | DRAFT | M |

---

## Phase 2: Asset Library

### Server Actions
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-201 | [asset-crud-actions](./phase-2-assets/server/FILM-201-asset-crud-actions.md) | DRAFT | M |
| FILM-202 | [character-actions](./phase-2-assets/server/FILM-202-character-actions.md) | DRAFT | M |
| FILM-203 | [upload-route](./phase-2-assets/server/FILM-203-upload-route.md) | DRAFT | M |

### Components
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-204 | [asset-gallery](./phase-2-assets/components/FILM-204-asset-gallery.md) | DRAFT | M |
| FILM-205 | [character-editor](./phase-2-assets/components/FILM-205-character-editor.md) | DRAFT | L |
| FILM-206 | [voice-profile-editor](./phase-2-assets/components/FILM-206-voice-profile-editor.md) | DRAFT | M |
| FILM-207 | [image-uploader](./phase-2-assets/components/FILM-207-image-uploader.md) | DRAFT | S |

### Pages
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-208 | [asset-library-page](./phase-2-assets/pages/FILM-208-asset-library-page.md) | DRAFT | M |

### Library
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-209 | [element-prompt-generation](./phase-2-assets/lib/FILM-209-element-prompt-generation.md) | DRAFT | M |

---

## Phase 3: Episodes & Story

### Server Actions
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-301 | [episode-crud-actions](./phase-3-episodes/server/FILM-301-episode-crud-actions.md) | DRAFT | M |
| FILM-302 | [season-crud-actions](./phase-3-episodes/server/FILM-302-season-crud-actions.md) | DRAFT | S |
| FILM-303 | [shot-crud-actions](./phase-3-episodes/server/FILM-303-shot-crud-actions.md) | DRAFT | M |
| FILM-305 | [story-generation](./phase-3-episodes/server/FILM-305-story-generation.md) | DRAFT | L |
| FILM-306 | [screenplay-conversion](./phase-3-episodes/server/FILM-306-screenplay-conversion.md) | DRAFT | L |
| FILM-307 | [shot-list-generation](./phase-3-episodes/server/FILM-307-shot-list-generation.md) | DRAFT | L |

### Components
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-308 | [story-studio](./phase-3-episodes/components/FILM-308-story-studio.md) | DRAFT | L |
| FILM-309 | [story-ideation](./phase-3-episodes/components/FILM-309-story-ideation.md) | DRAFT | M |
| FILM-310 | [screenplay-viewer](./phase-3-episodes/components/FILM-310-screenplay-viewer.md) | DRAFT | M |
| FILM-311 | [shot-list-editor](./phase-3-episodes/components/FILM-311-shot-list-editor.md) | DRAFT | L |

### Pages
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-312 | [episode-workspace](./phase-3-episodes/pages/FILM-312-episode-workspace.md) | DRAFT | L |

### Prompts
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-304 | [prompt-templates](./phase-3-episodes/prompts/FILM-304-prompt-templates.md) | DRAFT | S |

---

## Phase 4: Video Generation

### Providers
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-401 | [kling-provider](./phase-4-video-generation/providers/FILM-401-kling-provider.md) | DRAFT | L |
| FILM-402 | [provider-factory](./phase-4-video-generation/providers/FILM-402-provider-factory.md) | DRAFT | S |

### Library
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-403 | [rate-limiter](./phase-4-video-generation/lib/FILM-403-rate-limiter.md) | DRAFT | M |
| FILM-412 | [cost-tracking](./phase-4-video-generation/lib/FILM-412-cost-tracking.md) | DRAFT | M |

### Queue
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-404 | [job-queue](./phase-4-video-generation/queue/FILM-404-job-queue.md) | DRAFT | L |

### Server Actions
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-405 | [generate-video-action](./phase-4-video-generation/server/FILM-405-generate-video-action.md) | DRAFT | L |
| FILM-406 | [batch-generate-action](./phase-4-video-generation/server/FILM-406-batch-generate-action.md) | DRAFT | M |
| FILM-408 | [poll-status-action](./phase-4-video-generation/server/FILM-408-poll-status-action.md) | DRAFT | S |

### Webhooks
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-407 | [kling-webhook](./phase-4-video-generation/webhooks/FILM-407-kling-webhook.md) | DRAFT | M |

### Components
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-409 | [visual-studio](./phase-4-video-generation/components/FILM-409-visual-studio.md) | DRAFT | L |
| FILM-410 | [shot-grid](./phase-4-video-generation/components/FILM-410-shot-grid.md) | DRAFT | L |
| FILM-411 | [generation-progress](./phase-4-video-generation/components/FILM-411-generation-progress.md) | DRAFT | M |

---

## Phase 5: Audio Generation

### Providers
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-501 | [elevenlabs-provider](./phase-5-audio-generation/providers/FILM-501-elevenlabs-provider.md) | DRAFT | M |

### Server Actions
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-502 | [voice-generation-action](./phase-5-audio-generation/server/FILM-502-voice-generation-action.md) | DRAFT | M |
| FILM-503 | [batch-dialogue-action](./phase-5-audio-generation/server/FILM-503-batch-dialogue-action.md) | DRAFT | M |
| FILM-504 | [music-generation-action](./phase-5-audio-generation/server/FILM-504-music-generation-action.md) | DRAFT | M |

### Components
| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| FILM-505 | [audio-studio](./phase-5-audio-generation/components/FILM-505-audio-studio.md) | DRAFT | L |
| FILM-506 | [dialogue-list](./phase-5-audio-generation/components/FILM-506-dialogue-list.md) | DRAFT | M |
| FILM-507 | [voice-assignment](./phase-5-audio-generation/components/FILM-507-voice-assignment.md) | DRAFT | M |
| FILM-508 | [audio-player](./phase-5-audio-generation/components/FILM-508-audio-player.md) | DRAFT | M |

---

## Spikes

| Task ID | Spec | Status | Effort |
|---------|------|--------|--------|
| SPIKE-01 | [kling-api-research](./spikes/SPIKE-01-kling-api-research.md) | DRAFT | S |
| SPIKE-02 | [ffmpeg-pipeline](./spikes/SPIKE-02-ffmpeg-pipeline.md) | DRAFT | M |
| SPIKE-03 | [tiktok-oauth-quirks](./spikes/SPIKE-03-tiktok-oauth-quirks.md) | DRAFT | S |
| SPIKE-04 | [video-stitching](./spikes/SPIKE-04-video-stitching.md) | DRAFT | M |
| SPIKE-05 | [character-consistency](./spikes/SPIKE-05-character-consistency.md) | DRAFT | M |

---

## Effort Legend

| Size | Time | Description |
|------|------|-------------|
| XS | < 2 hours | Simple config, single file |
| S | 2-4 hours | Single component or function |
| M | 4-8 hours | Multiple files, integration |
| L | 1-3 days | Feature slice, complex component |
| XL | 3-5 days | Major feature, multiple subsystems |

---

## How to Use This Directory

### For Reviewers
1. Read [constitution.md](./constitution.md) first
2. Check spec status in tables above
3. Review specs in `DRAFT` or `REVIEW` status
4. Leave comments in GitHub PR

### For Implementers
1. Find spec in `APPROVED` status
2. Read constitution for conventions
3. Implement exactly as specified
4. Update status to `IN_PROGRESS`
5. Create PR referencing spec
6. Update status to `DONE` after merge

### For Adding New Specs
1. Create file in appropriate phase folder
2. Use [spec template](./constitution.md#spec-template)
3. Add entry to this README
4. Submit PR for review

---

## Contributing

1. All specs must follow the [constitution](./constitution.md)
2. Use the spec template format
3. Include acceptance criteria that are testable
4. Link dependencies between specs
5. Keep specs focused (one task per spec)

---

**Last Updated:** December 2025
