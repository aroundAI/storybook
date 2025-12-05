# FILM-101 Shared Resources Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** XS
- **Dependencies:** None (depends on existing accounts)
- **Blocks:** Phase 5 (audio generation features)

## Context
The `shared_resources` table stores organization-level assets that can be reused across projects: sound effects libraries, music templates, and system-provided resources. Distinguishes between user-uploaded and system resources.

## Specification

### Table Definition
```sql
CREATE TABLE shared_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  file_url TEXT,
  tags TEXT[],
  is_system BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK (type IN ('sfx', 'music_template', 'transition', 'overlay', 'preset'))
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| account_id | UUID | NO | - | Account owning this resource |
| type | VARCHAR(50) | NO | - | Resource type (see enum) |
| name | VARCHAR(255) | NO | - | Resource name |
| description | TEXT | YES | NULL | Resource description |
| file_url | TEXT | YES | NULL | URL to resource file |
| tags | TEXT[] | YES | NULL | Searchable tags |
| is_system | BOOLEAN | NO | FALSE | System-provided resource |
| created_at | TIMESTAMPTZ | NO | NOW() | Creation timestamp |

### Type Enum Values
- `sfx` - Sound effects (footsteps, doors, impacts, etc.)
- `music_template` - Music tracks available for use
- `transition` - Video transitions (fade, wipe, etc.)
- `overlay` - Visual overlays (borders, effects)
- `preset` - Generation presets (prompt templates)

### Indexes
```sql
CREATE INDEX idx_shared_resources_account_id ON shared_resources(account_id);
CREATE INDEX idx_shared_resources_type ON shared_resources(account_id, type);
CREATE INDEX idx_shared_resources_tags ON shared_resources USING GIN (tags);
CREATE INDEX idx_shared_resources_system ON shared_resources(is_system, type)
  WHERE is_system = TRUE;
```

### Constraints
- **Primary Key**: `id`
- **Check Constraint**: `type` in enum values

### Example Data
```sql
-- User-uploaded SFX
INSERT INTO shared_resources (account_id, type, name, description, file_url, tags)
VALUES (
  'account-123',
  'sfx',
  'Sword Slash',
  'Sharp metal blade swoosh',
  'https://storage.example.com/sfx/sword-slash.mp3',
  ARRAY['combat', 'weapon', 'sword', 'metal']
);

-- System-provided music template
INSERT INTO shared_resources (account_id, type, name, description, file_url, tags, is_system)
VALUES (
  'system-account-id',
  'music_template',
  'Epic Battle Theme',
  'Orchestral battle music with rising tension',
  'https://cdn.example.com/music/epic-battle.mp3',
  ARRAY['orchestral', 'battle', 'epic', 'intense'],
  TRUE
);

-- Generation preset
INSERT INTO shared_resources (account_id, type, name, description, tags)
VALUES (
  'account-123',
  'preset',
  'Cinematic Wide Shot',
  'Preset for cinematic establishing shots',
  ARRAY['cinematic', 'wide', 'establishing']
);
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [ ] Table created with all columns
- [ ] Type enum constraint enforced
- [ ] GIN index on tags array
- [ ] is_system flag differentiates user vs system resources
- [ ] Can query system resources across all accounts

## Test Plan

### Unit Tests
- [ ] Insert resource with valid type succeeds
- [ ] Insert resource with invalid type fails
- [ ] Insert with is_system = TRUE succeeds
- [ ] Tags array stores and retrieves correctly

### Integration Tests
- [ ] Query all SFX for account
- [ ] Query system resources (is_system = TRUE)
- [ ] Search by tags (GIN index)
- [ ] Filter by type and tags combined

### Query Examples
```sql
-- Get all SFX for account including system resources
SELECT *
FROM shared_resources
WHERE (account_id = 'account-123' OR is_system = TRUE)
  AND type = 'sfx'
ORDER BY is_system DESC, name;

-- Search by tag
SELECT *
FROM shared_resources
WHERE account_id = 'account-123'
  AND tags && ARRAY['combat', 'weapon'];

-- Get popular system resources (most commonly used)
-- (Requires usage tracking - future enhancement)
```

### Edge Cases
- [ ] Resource with no file_url (preset/config only)
- [ ] Empty tags array
- [ ] Very long tags array (100+ tags)
- [ ] System resource accessed by multiple accounts
- [ ] User trying to set is_system = TRUE (prevented at app level)
