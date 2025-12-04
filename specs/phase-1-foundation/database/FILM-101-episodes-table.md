# FILM-101 Episodes Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Dependencies:** FILM-101 (seasons-table)
- **Blocks:** FILM-101 (shots-table), FILM-301 (episode-crud-actions), FILM-305 (story-generation)

## Context
The `episodes` table is the core content unit in the film studio. Each episode goes through a workflow: draft → story → storyboard → generating → editing → ready → published. Episodes include soft delete for safety and optimistic locking (version column) to prevent concurrent edit conflicts.

## Specification

### Table Definition
```sql
CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  season_id UUID REFERENCES seasons(id) ON DELETE SET NULL,
  number INTEGER NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'draft' NOT NULL,
  duration_seconds INTEGER,
  thumbnail_url TEXT,
  final_video_url TEXT,
  story_data JSONB,
  screenplay_data JSONB,
  shot_list JSONB,
  metadata JSONB DEFAULT '{}' NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  CHECK (status IN ('draft', 'story', 'storyboard', 'generating', 'editing', 'ready', 'published'))
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| project_id | UUID | NO | - | Foreign key to projects table |
| season_id | UUID | YES | NULL | Foreign key to seasons (NULL for films/shorts) |
| number | INTEGER | NO | - | Episode number within project or season |
| title | VARCHAR(255) | NO | - | Episode title |
| description | TEXT | YES | NULL | Episode synopsis |
| status | VARCHAR(50) | NO | 'draft' | Workflow status (see enum below) |
| duration_seconds | INTEGER | YES | NULL | Final video duration in seconds |
| thumbnail_url | TEXT | YES | NULL | Episode thumbnail URL |
| final_video_url | TEXT | YES | NULL | URL to final rendered video |
| story_data | JSONB | YES | NULL | Story generation output (see schema below) |
| screenplay_data | JSONB | YES | NULL | Screenplay conversion output (see schema below) |
| shot_list | JSONB | YES | NULL | Shot list generation output (see schema below) |
| metadata | JSONB | NO | '{}' | Additional metadata |
| version | INTEGER | NO | 1 | Optimistic locking version number |
| created_at | TIMESTAMPTZ | NO | NOW() | Timestamp when record was created |
| updated_at | TIMESTAMPTZ | NO | NOW() | Timestamp when record was last updated |
| deleted_at | TIMESTAMPTZ | YES | NULL | Soft delete timestamp |

### Status Enum Values
- `draft` - Initial state, no content generated
- `story` - Story has been generated
- `storyboard` - Screenplay and shot list created
- `generating` - Videos are being generated
- `editing` - In timeline editor
- `ready` - Final video rendered, ready to publish
- `published` - Published to at least one platform

### Indexes
```sql
-- Partial index for active episodes (excludes soft-deleted)
CREATE INDEX idx_episodes_project_status ON episodes(project_id, status)
  WHERE deleted_at IS NULL;

-- Index for season lookup
CREATE INDEX idx_episodes_season ON episodes(season_id)
  WHERE deleted_at IS NULL;

-- Index for deleted episodes (for cleanup jobs)
CREATE INDEX idx_episodes_deleted_at ON episodes(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Index for project_id (FK)
CREATE INDEX idx_episodes_project_id ON episodes(project_id);
```

### Constraints
- **Primary Key**: `id` (UUID)
- **Foreign Keys**:
  - `project_id` references `projects(id)` ON DELETE CASCADE
  - `season_id` references `seasons(id)` ON DELETE SET NULL
- **Check Constraint**: `status` must be one of the enum values
- **Unique Constraint**: Consider adding `UNIQUE(project_id, season_id, number)` at application level

### JSONB Schema

#### StoryData Interface
```typescript
interface StoryData {
  premise: string;           // One-sentence story hook
  fullStory: string;         // Complete narrative (500-1000 words)
  generatedAt: string;       // ISO timestamp
  approvedAt?: string;       // ISO timestamp when user approved
  generatedBy: {
    model: string;           // e.g., "claude-3-5-sonnet"
    provider: string;        // e.g., "anthropic"
    costCents: number;       // Cost of generation
  };
}
```

#### ScreenplayData Interface
```typescript
interface ScreenplayData {
  scenes: Scene[];
  dialogue: DialogueLine[];
  generatedAt: string;
  approvedAt?: string;
  generatedBy: {
    model: string;
    provider: string;
    costCents: number;
  };
}

interface Scene {
  number: number;
  location: string;
  timeOfDay: string;       // "day", "night", "dawn", "dusk"
  description: string;
  duration: number;        // estimated seconds
}

interface DialogueLine {
  sceneNumber: number;
  characterName: string;
  text: string;
  emotion?: string;        // "happy", "sad", "angry", etc.
}
```

#### ShotList Interface
```typescript
interface ShotList {
  shots: ShotDefinition[];
  generatedAt: string;
  approvedAt?: string;
  totalEstimatedDuration: number;
}

interface ShotDefinition {
  sequenceNumber: number;
  sceneNumber: number;
  duration: number;
  sceneDescription: string;
  actionDescription: string;
  prompt: string;          // Kling-ready prompt
  cameraDirection: string; // "static", "pan", "zoom", etc.
  characters: string[];    // Character names in shot
}
```

### Triggers
```sql
-- Auto-update timestamps
CREATE TRIGGER episodes_set_timestamps
BEFORE INSERT OR UPDATE ON episodes
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();

-- Increment version on update (optimistic locking)
CREATE OR REPLACE FUNCTION increment_episode_version()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.version IS NOT NULL THEN
    NEW.version = OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER episodes_increment_version
BEFORE UPDATE ON episodes
FOR EACH ROW EXECUTE FUNCTION increment_episode_version();
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [ ] Table created successfully with all columns
- [ ] Foreign keys with correct ON DELETE behavior (CASCADE for project, SET NULL for season)
- [ ] Status check constraint enforces valid enum values
- [ ] Partial indexes created for active episodes only
- [ ] Soft delete column (deleted_at) present
- [ ] Version column for optimistic locking
- [ ] Timestamps auto-populate and auto-update
- [ ] Version increments automatically on UPDATE

## Test Plan

### Unit Tests
- [ ] Insert episode with valid project_id succeeds
- [ ] Insert episode with invalid status fails (check constraint)
- [ ] Insert episode with NULL season_id succeeds (for films)
- [ ] Timestamps populate automatically on insert
- [ ] Timestamps update automatically on update
- [ ] Version starts at 1 on insert
- [ ] Version increments on update

### Integration Tests
- [ ] Deleting a project cascades to delete all episodes
- [ ] Deleting a season sets episode.season_id to NULL
- [ ] Soft delete: setting deleted_at excludes from active queries
- [ ] Optimistic locking: concurrent updates with stale version fail
- [ ] JSONB columns accept valid JSON and reject invalid JSON

### Optimistic Locking Test
```sql
-- Simulate concurrent edit conflict
BEGIN;
  SELECT version FROM episodes WHERE id = 'test-id'; -- returns 1
  -- User A and User B both read version 1

  -- User A updates first
  UPDATE episodes SET title = 'New Title A', version = 2
  WHERE id = 'test-id' AND version = 1; -- succeeds

  -- User B tries to update with stale version
  UPDATE episodes SET title = 'New Title B', version = 2
  WHERE id = 'test-id' AND version = 1; -- fails (no rows updated)
COMMIT;
```

### Edge Cases
- [ ] Very long title (255 char limit)
- [ ] Negative duration_seconds (should be prevented at app level)
- [ ] NULL story_data, screenplay_data, shot_list allowed
- [ ] Large JSONB objects (10MB+ - test performance)
- [ ] Query performance with 1000+ episodes per project
