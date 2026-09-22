---
spec_id: FILM-101e
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-101 Character Details Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** XS
- **Status:** 🟡 PARTIAL (audit 2026-09-23; was ✅ COMPLETE)
- **Completed:** 2025-12-05
- **PR:** [#3](https://github.com/aroundAI/storybook/pull/3)
- **Dependencies:** FILM-101 (assets-table)
- **Blocks:** FILM-202 (character-actions), FILM-205 (character-editor)

## Context
The `character_details` table extends the `assets` table specifically for character-type assets. It stores character appearance, personality, and the Kling-ready element prompt for consistent character generation across shots.

## Specification

### Table Definition
```sql
CREATE TABLE character_details (
  asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  physical_attributes JSONB,
  personality TEXT,
  element_prompt TEXT,
  reference_images TEXT[],
  voice_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  CHECK ((SELECT type FROM assets WHERE id = asset_id) = 'character')
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| asset_id | UUID | NO | - | Primary key, FK to assets table |
| physical_attributes | JSONB | YES | NULL | Structured character appearance data |
| personality | TEXT | YES | NULL | Character personality description |
| element_prompt | TEXT | YES | NULL | Kling-ready prompt for character consistency |
| reference_images | TEXT[] | YES | NULL | Array of reference image URLs |
| voice_asset_id | UUID | YES | NULL | FK to voice asset for this character |

### Indexes
```sql
-- Index for voice_asset_id (FK lookup)
CREATE INDEX idx_character_details_voice_asset_id ON character_details(voice_asset_id)
  WHERE voice_asset_id IS NOT NULL;

-- GIN index for JSONB physical_attributes queries
CREATE INDEX idx_character_details_physical_attributes
  ON character_details USING GIN (physical_attributes);
```

### Constraints
- **Primary Key**: `asset_id` (UUID)
- **Foreign Keys**:
  - `asset_id` references `assets(id)` ON DELETE CASCADE
  - `voice_asset_id` references `assets(id)` ON DELETE SET NULL
- **Check Constraint**: Asset must be of type 'character'

### JSONB Schema

#### PhysicalAttributes Interface
```typescript
interface PhysicalAttributes {
  age?: string;              // "child", "teenager", "young adult", "middle-aged", "elderly"
  height?: string;           // "short", "average", "tall"
  build?: string;            // "slim", "athletic", "muscular", "heavyset"
  hair?: {
    color: string;           // "black", "brown", "blonde", "red", "gray", "white", etc.
    style: string;           // "short", "long", "curly", "straight", "bald"
    length?: string;         // "cropped", "shoulder-length", "waist-length"
  };
  eyes?: {
    color: string;           // "brown", "blue", "green", "hazel", "gray"
    shape?: string;          // "almond", "round", "hooded"
  };
  skin?: {
    tone: string;            // "pale", "fair", "olive", "tan", "brown", "dark"
    features?: string[];     // ["freckles", "scar on left cheek", "tattoo on arm"]
  };
  outfit?: {
    style: string;           // "casual", "formal", "fantasy", "sci-fi", "period"
    colors: string[];        // ["blue", "white"]
    description: string;     // "Blue jeans and white t-shirt"
  };
  distinguishingFeatures?: string[]; // ["glasses", "beard", "prosthetic arm", "glowing eyes"]
}
```

### Example Data
```sql
INSERT INTO assets (project_id, type, name, description)
VALUES ('project-123', 'character', 'Alice Blackwood', 'The protagonist detective')
RETURNING id;

INSERT INTO character_details (asset_id, physical_attributes, personality, element_prompt, reference_images)
VALUES (
  'alice-asset-id',
  '{
    "age": "young adult",
    "height": "average",
    "build": "athletic",
    "hair": {
      "color": "black",
      "style": "straight",
      "length": "shoulder-length"
    },
    "eyes": {
      "color": "green"
    },
    "skin": {
      "tone": "fair"
    },
    "outfit": {
      "style": "modern",
      "colors": ["black", "gray"],
      "description": "Black leather jacket, gray shirt, dark jeans"
    },
    "distinguishingFeatures": ["scar above left eyebrow"]
  }',
  'Determined, intelligent, cynical but compassionate. Trust issues stemming from past betrayal.',
  'A young adult woman with shoulder-length straight black hair and piercing green eyes. Fair skin with a small scar above left eyebrow. Wearing black leather jacket over gray shirt and dark jeans. Athletic build, average height. Determined expression.',
  ARRAY['https://storage.example.com/ref1.jpg', 'https://storage.example.com/ref2.jpg']
);
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [x] Table created successfully with all columns — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:420`; `voice_asset_id` is now `elevenlabs_voice_id` text (`apps/web/supabase/migrations/20251225160000_change_voice_id_to_text.sql:18`)
- [x] Foreign key to assets with CASCADE delete — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:421`
- [ ] ~~Foreign key to voice_asset_id with SET NULL delete~~ — *audit: retired* — FK dropped and column retyped to an ElevenLabs voice ID in 30ed2083 (`apps/web/supabase/migrations/20251225160000_change_voice_id_to_text.sql:8`)
- [ ] Check constraint ensures asset is type 'character' — *audit: not met* — no check or trigger exists (a CHECK cannot hold the spec's subquery); the insert policy ignores type (`apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:1104`)
- [x] GIN index on physical_attributes JSONB — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:438`
- [x] Can store multiple reference image URLs in array — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:425`
- [x] Deleting character asset cascades to delete character_details — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:421`

## Test Plan

### Unit Tests
- [ ] Insert character_details with valid asset_id (type='character') succeeds — *audit: not met* — no test found
- [ ] Insert character_details with non-character asset_id fails (check constraint) — *audit: not met* — no test found; the constraint it would test does not exist
- [ ] Insert character_details with NULL physical_attributes succeeds — *audit: not met* — no test found
- [ ] Insert character_details with valid JSONB physical_attributes succeeds — *audit: not met* — no test found
- [ ] Insert character_details with invalid JSONB fails — *audit: not met* — no test found
- [ ] Array of reference_images stores and retrieves correctly — *audit: not met* — no test found

### Integration Tests
- [ ] Deleting character asset cascades to delete character_details — *audit: not met* — no test found
- [ ] ~~Deleting voice asset sets voice_asset_id to NULL~~ — *audit: retired* — the `voice_asset_id` FK was dropped in 30ed2083
- [ ] Can query characters by physical attributes (e.g., hair color) — *audit: not met* — no test found
- [ ] GIN index improves JSONB query performance — *audit: not met* — no test found

### JSONB Query Examples
```sql
-- Find all characters with black hair
SELECT a.name, cd.physical_attributes
FROM assets a
JOIN character_details cd ON a.id = cd.asset_id
WHERE cd.physical_attributes @> '{"hair": {"color": "black"}}';

-- Find all characters with glasses
SELECT a.name
FROM assets a
JOIN character_details cd ON a.id = cd.asset_id
WHERE cd.physical_attributes @> '{"distinguishingFeatures": ["glasses"]}';
```

### Edge Cases
- [ ] Character with no physical_attributes (NULL) — *audit: not met* — no test found
- [ ] Character with minimal physical_attributes (just age) — *audit: not met* — no test found
- [ ] Character with maximal physical_attributes (all fields populated) — *audit: not met* — no test found
- [ ] Element prompt over 5000 characters — *audit: not met* — no test found
- [ ] Empty reference_images array — *audit: not met* — no test found
- [ ] Reference_images array with 20+ URLs — *audit: not met* — no test found
- [ ] ~~Voice_asset_id pointing to non-voice asset (should be prevented at app level)~~ — *audit: retired* — the column now holds an ElevenLabs voice ID, not an asset reference (30ed2083)

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Check constraint: asset is type 'character' | Never created: Postgres rejects a subquery in a CHECK, and no trigger or policy tests the type (`git log -S` finds none). Only the app create path sets it (`packages/features/assets/src/lib/server/character.mutations.ts:58`) | unassigned |
