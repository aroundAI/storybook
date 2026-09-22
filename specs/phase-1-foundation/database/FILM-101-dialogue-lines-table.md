---
spec_id: FILM-101g
status: ✅ DONE
audited: 2026-09-23
---

# FILM-101 Dialogue Lines Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** XS
- **Status:** ✅ COMPLETE
- **Completed:** 2025-12-05
- **PR:** [#3](https://github.com/aroundAI/storybook/pull/3)
- **Dependencies:** FILM-101 (episodes-table, shots-table, assets-table)
- **Blocks:** FILM-502 (voice-generation-action), FILM-503 (batch-dialogue-action)

## Context
The `dialogue_lines` table stores individual lines of dialogue to be converted to audio using voice generation providers. Each line is associated with an episode, optionally a shot, and a character asset.

## Specification

### Table Definition
```sql
CREATE TABLE dialogue_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  shot_id UUID REFERENCES shots(id) ON DELETE SET NULL,
  character_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  audio_url TEXT,
  status VARCHAR(50) DEFAULT 'pending' NOT NULL,
  generation_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK (status IN ('pending', 'generating', 'completed', 'failed')),
  UNIQUE(episode_id, sequence_number)
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| episode_id | UUID | NO | - | Foreign key to episodes |
| shot_id | UUID | YES | NULL | Optional FK to shot (for shot-specific dialogue) |
| character_asset_id | UUID | YES | NULL | FK to character speaking this line |
| text | TEXT | NO | - | Dialogue text to generate |
| sequence_number | INTEGER | NO | - | Order within episode |
| audio_url | TEXT | YES | NULL | URL to generated audio file |
| status | VARCHAR(50) | NO | 'pending' | Generation status |
| generation_metadata | JSONB | YES | NULL | Provider metadata |
| created_at | TIMESTAMPTZ | NO | NOW() | Creation timestamp |

### Status Enum Values
- `pending` - Not yet generated
- `generating` - Currently generating with provider
- `completed` - Audio generated successfully
- `failed` - Generation failed

### Indexes
```sql
CREATE INDEX idx_dialogue_lines_episode_sequence ON dialogue_lines(episode_id, sequence_number);
CREATE INDEX idx_dialogue_lines_shot ON dialogue_lines(shot_id) WHERE shot_id IS NOT NULL;
CREATE INDEX idx_dialogue_lines_character ON dialogue_lines(character_asset_id) WHERE character_asset_id IS NOT NULL;
CREATE INDEX idx_dialogue_lines_status ON dialogue_lines(status);
```

### Constraints
- **Primary Key**: `id`
- **Foreign Keys**:
  - `episode_id` references `episodes(id)` ON DELETE CASCADE
  - `shot_id` references `shots(id)` ON DELETE SET NULL
  - `character_asset_id` references `assets(id)` ON DELETE SET NULL
- **Unique**: `(episode_id, sequence_number)`

### JSONB Schema

```typescript
interface GenerationMetadata {
  provider: string;           // "elevenlabs", "playht"
  providerJobId?: string;
  voiceId: string;
  settings: {
    stability?: number;
    similarityBoost?: number;
    speed?: number;
  };
  costCents: number;
  durationSeconds: number;
  generatedAt: string;
  characterCount: number;
}
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [x] Table created with all columns — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:357`
- [x] Foreign keys with correct ON DELETE behavior — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:359-361`
- [ ] ~~Unique constraint on (episode_id, sequence_number)~~ — *audit: retired* — widened to (episode_id, sequence_number, language) for translated lines (`apps/web/supabase/migrations/20260101000000_fix_dialogue_language_constraint.sql:17`)
- [x] Status check constraint enforced — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:368`
- [x] Indexes created — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:378-383`

## Test Plan

### Unit Tests
- [ ] Insert with valid episode_id succeeds — *audit: not met* — no test found
- [ ] Insert with invalid status fails — *audit: not met* — no test found
- [ ] Duplicate sequence_number fails — *audit: not met* — no test found
- [ ] NULL shot_id and character_asset_id allowed — *audit: not met* — no test found

### Integration Tests
- [ ] Deleting episode cascades — *audit: not met* — no test found
- [ ] Deleting shot sets shot_id to NULL — *audit: not met* — no test found
- [ ] Deleting character sets character_asset_id to NULL — *audit: not met* — no test found
