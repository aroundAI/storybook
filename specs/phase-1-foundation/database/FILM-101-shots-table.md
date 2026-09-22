---
spec_id: FILM-101c
status: ✅ DONE
audited: 2026-09-23
---

# FILM-101 Shots Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Status:** ✅ COMPLETE
- **Completed:** 2025-12-05
- **PR:** [#3](https://github.com/aroundAI/storybook/pull/3)
- **Dependencies:** FILM-101 (episodes-table)
- **Blocks:** FILM-303 (shot-crud-actions), FILM-405 (generate-video-action)

## Context
The `shots` table stores individual video clips that make up an episode. Each shot has a sequence number, a generated video URL, and tracks its generation status. Shots are created from the shot list generated during story/screenplay processing.

## Specification

### Table Definition
```sql
CREATE TABLE shots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  duration_seconds INTEGER DEFAULT 10 NOT NULL,
  scene_description TEXT,
  action_description TEXT,
  prompt TEXT NOT NULL,
  camera_direction VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending' NOT NULL,
  video_url TEXT,
  thumbnail_url TEXT,
  generation_job_id UUID,
  generation_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK (status IN ('pending', 'queued', 'generating', 'completed', 'failed', 'approved')),
  CHECK (duration_seconds > 0 AND duration_seconds <= 60),
  UNIQUE(episode_id, sequence_number)
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| episode_id | UUID | NO | - | Foreign key to episodes table |
| sequence_number | INTEGER | NO | - | Order within episode (1, 2, 3...) |
| duration_seconds | INTEGER | NO | 10 | Target duration for video generation |
| scene_description | TEXT | YES | NULL | Scene context for the shot |
| action_description | TEXT | YES | NULL | What happens in this shot |
| prompt | TEXT | NO | - | Kling/Runway-ready prompt |
| camera_direction | VARCHAR(100) | YES | NULL | Camera movement (static, pan, zoom, etc.) |
| status | VARCHAR(50) | NO | 'pending' | Generation status (see enum below) |
| video_url | TEXT | YES | NULL | URL to generated video file |
| thumbnail_url | TEXT | YES | NULL | URL to video thumbnail |
| generation_job_id | UUID | YES | NULL | FK to generation_jobs (not enforced) |
| generation_metadata | JSONB | YES | NULL | Provider-specific metadata |
| created_at | TIMESTAMPTZ | NO | NOW() | Timestamp when record was created |
| updated_at | TIMESTAMPTZ | NO | NOW() | Timestamp when record was last updated |

### Status Enum Values
- `pending` - Shot defined, not yet queued for generation
- `queued` - Queued for generation
- `generating` - Currently generating with provider
- `completed` - Video generated successfully
- `failed` - Generation failed (check generation_jobs for error)
- `approved` - User approved the generated video

### Indexes
```sql
-- Index for episode + sequence number (common query pattern)
CREATE INDEX idx_shots_episode_sequence ON shots(episode_id, sequence_number);

-- Index for status queries (find all generating shots)
CREATE INDEX idx_shots_status ON shots(status);

-- Index for generation job lookup
CREATE INDEX idx_shots_generation_job_id ON shots(generation_job_id)
  WHERE generation_job_id IS NOT NULL;

-- Index for episode_id (FK)
CREATE INDEX idx_shots_episode_id ON shots(episode_id);
```

### Constraints
- **Primary Key**: `id` (UUID)
- **Foreign Key**: `episode_id` references `episodes(id)` ON DELETE CASCADE
- **Unique Constraint**: `(episode_id, sequence_number)` - ensures no duplicate sequence numbers
- **Check Constraints**:
  - `status` must be one of the enum values
  - `duration_seconds` must be between 1 and 60 (provider limits)

### JSONB Schema

#### GenerationMetadata Interface
```typescript
interface GenerationMetadata {
  provider: string;              // "kling", "runway", "hailuo"
  providerJobId: string;         // External job ID
  providerModel?: string;        // e.g., "kling-v1.5-std"
  costCents: number;             // Actual cost paid
  estimatedCostCents: number;    // Pre-generation estimate
  generatedAt: string;           // ISO timestamp
  completedAt?: string;          // ISO timestamp
  retryCount?: number;           // Number of retries
  errorCode?: string;            // If failed
  errorMessage?: string;         // If failed
  parameters?: {
    aspectRatio?: string;        // "16:9", "9:16", "1:1"
    mode?: string;               // "standard", "professional"
    negativePrompt?: string;     // What to avoid
    seed?: number;               // For reproducibility
  };
}
```

### Triggers
```sql
-- Auto-update timestamps
CREATE TRIGGER shots_set_timestamps
BEFORE INSERT OR UPDATE ON shots
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [x] Table created successfully with all columns — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:313`
- [x] Foreign key to episodes with CASCADE delete — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:315`
- [x] Unique constraint on (episode_id, sequence_number) — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:331`
- [x] Status check constraint enforces valid enum values — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:329`
- [x] Duration check constraint enforces 1-60 seconds — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:330`
- [x] Indexes created for common query patterns — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:341-345`; the sequence index is partial since `apps/web/supabase/migrations/20251209061319_add-missing-shots-columns.sql:32`
- [x] Timestamps auto-populate and auto-update — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:348`

## Test Plan

### Unit Tests
- [ ] Insert shot with valid episode_id succeeds — *audit: not met* — no test found
- [ ] Insert shot with invalid status fails (check constraint) — *audit: not met* — no test found
- [ ] Insert shot with duration_seconds = 0 fails (check constraint) — *audit: not met* — no test found
- [ ] Insert shot with duration_seconds = 61 fails (check constraint) — *audit: not met* — no test found
- [ ] Insert duplicate sequence_number for same episode fails (unique constraint) — *audit: not met* — no test found
- [ ] Insert same sequence_number for different episodes succeeds — *audit: not met* — no test found
- [ ] Timestamps populate automatically on insert — *audit: not met* — no test found

### Integration Tests
- [ ] Deleting an episode cascades to delete all its shots — *audit: not met* — no test found
- [ ] Query shots ordered by sequence_number returns correct order — *audit: not met* — no test found
- [ ] Can reorder shots by updating sequence_numbers — *audit: not met* — no test found
- [ ] Generation job ID can be NULL (shot not yet generated) — *audit: not met* — no test found
- [ ] JSONB generation_metadata accepts valid JSON — *audit: not met* — no test found

### Status Workflow Test
```sql
-- Test status progression
INSERT INTO shots (episode_id, sequence_number, prompt, status)
VALUES ('test-episode-id', 1, 'Test prompt', 'pending');

UPDATE shots SET status = 'queued' WHERE id = 'test-shot-id';
UPDATE shots SET status = 'generating' WHERE id = 'test-shot-id';
UPDATE shots SET status = 'completed', video_url = 'https://...'
WHERE id = 'test-shot-id';
UPDATE shots SET status = 'approved' WHERE id = 'test-shot-id';
```

### Edge Cases
- [ ] Very long prompt (10,000+ characters) — *audit: not met* — no test found
- [ ] NULL camera_direction allowed — *audit: not met* — no test found
- [ ] Empty scene_description and action_description allowed — *audit: not met* — no test found
- [ ] Query performance with 100+ shots per episode — *audit: not met* — no test found
- [ ] Reordering all shots in an episode (batch update) — *audit: not met* — no test found
- [ ] Shot with completed status but NULL video_url (error case) — *audit: not met* — no test found
