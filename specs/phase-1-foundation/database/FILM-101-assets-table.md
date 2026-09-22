---
spec_id: FILM-101d
status: ✅ DONE
audited: 2026-09-23
---

# FILM-101 Assets Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Status:** ✅ COMPLETE
- **Completed:** 2025-12-05
- **PR:** [#3](https://github.com/aroundAI/storybook/pull/3)
- **Dependencies:** None (depends on existing projects table)
- **Blocks:** FILM-101 (character-details-table, voice-profiles-table), FILM-201 (asset-crud-actions)

## Context
The `assets` table is a polymorphic table storing all project-level resources: characters, locations, props, voice profiles, music tracks, and sound effects. This is the base table, with extension tables (character_details, voice_profiles) providing type-specific fields.

## Specification

### Table Definition
```sql
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  file_url TEXT,
  thumbnail_url TEXT,
  metadata JSONB DEFAULT '{}' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK (type IN ('character', 'location', 'prop', 'voice', 'music', 'sfx')),
  UNIQUE(project_id, type, name)
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| project_id | UUID | NO | - | Foreign key to projects table |
| type | VARCHAR(50) | NO | - | Asset type (see enum below) |
| name | VARCHAR(255) | NO | - | Asset display name |
| description | TEXT | YES | NULL | Asset description or notes |
| file_url | TEXT | YES | NULL | URL to primary asset file |
| thumbnail_url | TEXT | YES | NULL | URL to thumbnail/preview image |
| metadata | JSONB | NO | '{}' | Type-specific metadata |
| created_at | TIMESTAMPTZ | NO | NOW() | Timestamp when record was created |
| updated_at | TIMESTAMPTZ | NO | NOW() | Timestamp when record was last updated |

### Type Enum Values
- `character` - Character definitions (extends to character_details)
- `location` - Locations/settings for scenes
- `prop` - Objects/items in scenes
- `voice` - Voice profiles (extends to voice_profiles)
- `music` - Music tracks
- `sfx` - Sound effects

### Indexes
```sql
-- Index for project + type queries (e.g., "get all characters")
CREATE INDEX idx_assets_project_type ON assets(project_id, type);

-- Index for type queries (e.g., "get all voices across projects")
CREATE INDEX idx_assets_type ON assets(type);

-- Index for project_id (FK)
CREATE INDEX idx_assets_project_id ON assets(project_id);

-- GIN index for JSONB metadata queries
CREATE INDEX idx_assets_metadata ON assets USING GIN (metadata);
```

### Constraints
- **Primary Key**: `id` (UUID)
- **Foreign Key**: `project_id` references `projects(id)` ON DELETE CASCADE
- **Unique Constraint**: `(project_id, type, name)` - prevents duplicate asset names within type
- **Check Constraint**: `type` must be one of the enum values

### JSONB Schema

#### Metadata by Type

**Character Metadata:**
```typescript
interface CharacterMetadata {
  tags?: string[];           // ["protagonist", "villain", "comic relief"]
  appearanceCount?: number;  // How many shots use this character
  elementPromptVersion?: string; // Version of element prompt (for tracking changes)
}
```

**Location Metadata:**
```typescript
interface LocationMetadata {
  tags?: string[];           // ["indoor", "outdoor", "day", "night"]
  referenceImages?: string[]; // Array of reference image URLs
  usageCount?: number;        // How many shots use this location
}
```

**Prop Metadata:**
```typescript
interface PropMetadata {
  tags?: string[];
  size?: string;             // "small", "medium", "large"
  referenceImages?: string[];
}
```

**Voice Metadata:**
```typescript
interface VoiceMetadata {
  sampleUrls?: string[];     // Sample audio clips
  language?: string;         // "en", "es", "fr", etc.
  gender?: string;           // "male", "female", "neutral"
  ageRange?: string;         // "child", "young", "adult", "elderly"
}
```

**Music Metadata:**
```typescript
interface MusicMetadata {
  genre?: string;            // "orchestral", "electronic", "ambient"
  mood?: string;             // "upbeat", "somber", "intense"
  bpm?: number;
  durationSeconds?: number;
  loopable?: boolean;
}
```

**SFX Metadata:**
```typescript
interface SFXMetadata {
  category?: string;         // "footsteps", "impact", "ambient", "ui"
  tags?: string[];
  durationSeconds?: number;
}
```

### Triggers
```sql
-- Auto-update timestamps
CREATE TRIGGER assets_set_timestamps
BEFORE INSERT OR UPDATE ON assets
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [x] Table created successfully with all columns — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:122`
- [x] Foreign key to projects with CASCADE delete — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:124`
- [x] Unique constraint on (project_id, type, name) — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:134`
- [x] Type check constraint enforces valid enum values — *audit:* `apps/web/supabase/migrations/20260127225653_master_video_schema.sql:22` (widened with `master_video`, `master_title_card`)
- [x] Indexes created for common query patterns — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:142-145`
- [x] GIN index on metadata JSONB column — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:145`
- [x] Timestamps auto-populate and auto-update — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:148`

## Test Plan

### Unit Tests
- [ ] Insert asset with valid project_id succeeds — *audit: not met* — no test asserts it; pgTAP inserts assets only as fixtures (`apps/web/supabase/tests/database/authors-deletable.test.sql:62`)
- [ ] Insert asset with invalid type fails (check constraint) — *audit: not met* — no test of the constraint; only the Zod enum is tested (`packages/features/assets/__tests__/asset-actions.test.ts:64`)
- [ ] Insert duplicate asset name for same project+type fails (unique constraint) — *audit: not met* — no test found
- [ ] Insert same asset name for different types succeeds — *audit: not met* — no test found
- [ ] Insert same asset name for different projects succeeds — *audit: not met* — no test found
- [ ] Timestamps populate automatically on insert — *audit: not met* — no test found
- [ ] Timestamps update automatically on update — *audit: not met* — no test found

### Integration Tests
- [ ] Deleting a project cascades to delete all its assets — *audit: not met* — no test found
- [ ] Extension tables (character_details, voice_profiles) cascade delete — *audit: not met* — no test found; `voice_profiles` no longer exists (`apps/web/supabase/migrations/20260103075610_remove_deprecated_voice_profiles.sql:13`)
- [ ] JSONB metadata accepts valid JSON and rejects invalid JSON — *audit: not met* — no test found
- [ ] GIN index allows efficient JSONB queries (metadata @> '{"tags": ["protagonist"]}') — *audit: not met* — no test found

### Type-Specific Tests
```sql
-- Test different asset types
INSERT INTO assets (project_id, type, name, description)
VALUES
  ('test-project-id', 'character', 'Alice', 'The hero'),
  ('test-project-id', 'location', 'Forest', 'Dark woods'),
  ('test-project-id', 'prop', 'Sword', 'Magic sword'),
  ('test-project-id', 'voice', 'Alice Voice', 'Female, young adult'),
  ('test-project-id', 'music', 'Battle Theme', 'Epic orchestral'),
  ('test-project-id', 'sfx', 'Sword Slash', 'Metal impact');

-- Query by type
SELECT * FROM assets WHERE project_id = 'test-project-id' AND type = 'character';
```

### Edge Cases
- [x] Very long name (255 char limit) — *audit:* `packages/features/assets/__tests__/asset-actions.test.ts:120` ("should reject name over 255 characters", app schema)
- [ ] NULL description, file_url, thumbnail_url allowed — *audit: not met* — no DB test; only the app schema's omitted-fields case is tested (`packages/features/assets/__tests__/asset-actions.test.ts:87`)
- [ ] Empty metadata JSONB ('{}') — *audit: not met* — no test found
- [ ] Large metadata JSONB (1MB+) — *audit: not met* — no test found
- [ ] Query performance with 1000+ assets per project — *audit: not met* — no test found
- [ ] Asset with file_url but no thumbnail_url — *audit: not met* — no test found
- [ ] Asset with thumbnail_url but no file_url (valid for abstract concepts) — *audit: not met* — no test found
