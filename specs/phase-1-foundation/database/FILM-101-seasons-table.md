# FILM-101 Seasons Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Status:** ✅ COMPLETE
- **Completed:** 2025-12-05
- **PR:** [#3](https://github.com/aroundAI/storybook/pull/3)
- **Dependencies:** None (depends on existing projects table)
- **Blocks:** FILM-101 (episodes-table), FILM-302 (season-crud-actions)

## Context
The `seasons` table organizes episodes into seasons for series-type projects. This is optional - films and shorts collections don't require seasons. Each season belongs to a project and has a sequential number within that project.

## Specification

### Table Definition
```sql
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  name VARCHAR(255),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, number)
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| project_id | UUID | NO | - | Foreign key to projects table |
| number | INTEGER | NO | - | Sequential season number (1, 2, 3...) |
| name | VARCHAR(255) | YES | NULL | Display name (e.g., "Season 1: Origins") |
| description | TEXT | YES | NULL | Season synopsis or notes |
| created_at | TIMESTAMPTZ | NO | NOW() | Timestamp when record was created |
| updated_at | TIMESTAMPTZ | NO | NOW() | Timestamp when record was last updated |

### Indexes
```sql
-- Composite index for project + number lookups
CREATE INDEX idx_seasons_project_number ON seasons(project_id, number);

-- Index for foreign key
CREATE INDEX idx_seasons_project_id ON seasons(project_id);
```

### Constraints
- **Primary Key**: `id` (UUID)
- **Foreign Key**: `project_id` references `projects(id)` ON DELETE CASCADE
- **Unique Constraint**: `(project_id, number)` - ensures no duplicate season numbers within a project
- **Check Constraint**: `number > 0` (optional - can be enforced at application level)

### Triggers
```sql
-- Auto-update timestamps
CREATE TRIGGER seasons_set_timestamps
BEFORE INSERT OR UPDATE ON seasons
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [x] Table created successfully with all columns
- [x] Foreign key to projects with CASCADE delete behavior
- [x] Unique constraint on (project_id, number) enforced
- [x] Indexes created for performance
- [x] Timestamps auto-populate on insert/update
- [x] Deleting a project cascades to delete all its seasons

## Test Plan

### Unit Tests
- [ ] Insert season with valid project_id succeeds
- [ ] Insert season with invalid project_id fails (FK violation)
- [ ] Insert duplicate season number for same project fails (unique constraint)
- [ ] Insert same season number for different projects succeeds
- [ ] Timestamps populate automatically on insert
- [ ] Timestamps update automatically on update

### Integration Tests
- [ ] Deleting a project cascades to delete all its seasons
- [ ] Deleting a season sets episodes.season_id to NULL (tested in episodes table)
- [ ] Query seasons ordered by number returns correct order
- [ ] Can create Season 1, 2, 3 in sequence
- [ ] Cannot create Season 5 before Season 4 (enforced at app level)

### Edge Cases
- [ ] Season number = 0 (should fail if check constraint added)
- [ ] Season number negative (should fail if check constraint added)
- [ ] Very long season name (255 char limit)
- [ ] NULL name is allowed (optional field)
