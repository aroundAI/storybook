# FILM-101 Character Details Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** XS
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
- [ ] Table created successfully with all columns
- [ ] Foreign key to assets with CASCADE delete
- [ ] Foreign key to voice_asset_id with SET NULL delete
- [ ] Check constraint ensures asset is type 'character'
- [ ] GIN index on physical_attributes JSONB
- [ ] Can store multiple reference image URLs in array
- [ ] Deleting character asset cascades to delete character_details

## Test Plan

### Unit Tests
- [ ] Insert character_details with valid asset_id (type='character') succeeds
- [ ] Insert character_details with non-character asset_id fails (check constraint)
- [ ] Insert character_details with NULL physical_attributes succeeds
- [ ] Insert character_details with valid JSONB physical_attributes succeeds
- [ ] Insert character_details with invalid JSONB fails
- [ ] Array of reference_images stores and retrieves correctly

### Integration Tests
- [ ] Deleting character asset cascades to delete character_details
- [ ] Deleting voice asset sets voice_asset_id to NULL
- [ ] Can query characters by physical attributes (e.g., hair color)
- [ ] GIN index improves JSONB query performance

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
- [ ] Character with no physical_attributes (NULL)
- [ ] Character with minimal physical_attributes (just age)
- [ ] Character with maximal physical_attributes (all fields populated)
- [ ] Element prompt over 5000 characters
- [ ] Empty reference_images array
- [ ] Reference_images array with 20+ URLs
- [ ] Voice_asset_id pointing to non-voice asset (should be prevented at app level)
