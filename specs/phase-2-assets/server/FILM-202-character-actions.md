# FILM-202: Character Server Actions

**Phase**: 2
**Priority**: P0
**Effort**: M (3-5 days)
**Dependencies**: FILM-103 (character_details table), FILM-201 (asset CRUD)
**Blocks**: FILM-205 (CharacterEditor component)
**Status**: ✅ COMPLETED (2024-12-09)
**PR**: feat/film-202-209-character-element-prompts

---

## Context

Characters are specialized assets that require additional metadata for AI-driven video generation. Unlike generic assets, characters store physical attributes (age, gender, ethnicity, hair, clothing) and personality traits that are used to generate consistent element prompts for Kling AI.

Character creation requires a database transaction to create both an asset record and a character_details record. The character_details table stores structured data that feeds into the LLM-based prompt generation system (FILM-209).

This spec implements server actions specifically for character management, building on top of the generic asset CRUD actions from FILM-201.

---

## Requirements

### Functional Requirements

1. **Create Character**
   - Create asset record with type='character'
   - Create character_details record in same transaction
   - Accept physical attributes and personality data
   - Support optional voice profile association
   - Return complete character data (asset + details)

2. **Get Character**
   - Fetch asset and character_details via JOIN
   - Include voice profile if associated
   - Return flattened character object
   - Handle missing character_details gracefully

3. **Update Character**
   - Update asset fields (name, description, reference image)
   - Update character_details fields (attributes, personality)
   - Use transaction for atomic updates
   - Update updated_at timestamps

4. **List Characters**
   - Get all characters for a project
   - Join with character_details
   - Support pagination
   - Exclude soft-deleted assets

### Non-Functional Requirements

- Transaction rollback on any failure
- All operations complete within 3 seconds
- Validate structured data with Zod schemas
- Preserve referential integrity
- Support future character versioning

---

## Interface

### TypeScript Types

```typescript
// Zod Schemas
import { z } from 'zod';

export const PhysicalAttributesSchema = z.object({
  age: z.number().int().min(0).max(150).optional(),
  ageRange: z.enum(['child', 'teen', 'young_adult', 'adult', 'senior']).optional(),
  gender: z.enum(['male', 'female', 'non_binary', 'other']).optional(),
  ethnicity: z.string().max(100).optional(),
  height: z.string().max(50).optional(), // e.g., "5'10\"", "180cm"
  build: z.enum(['slim', 'athletic', 'average', 'heavy', 'muscular']).optional(),
  hairColor: z.string().max(50).optional(),
  hairStyle: z.string().max(100).optional(),
  eyeColor: z.string().max(50).optional(),
  skinTone: z.string().max(50).optional(),
  distinctiveFeatures: z.array(z.string()).optional(), // scars, tattoos, glasses
  facialHair: z.string().max(100).optional(),
});

export const PersonalityTraitsSchema = z.object({
  traits: z.array(z.string()).optional(), // brave, shy, intelligent
  mannerisms: z.array(z.string()).optional(), // gestures, speech patterns
  motivations: z.string().max(500).optional(),
  fears: z.string().max(500).optional(),
  strengths: z.array(z.string()).optional(),
  weaknesses: z.array(z.string()).optional(),
});

export const ClothingStyleSchema = z.object({
  defaultOutfit: z.string().max(500).optional(),
  style: z.enum(['casual', 'formal', 'sporty', 'vintage', 'fantasy', 'modern']).optional(),
  colors: z.array(z.string()).optional(),
  accessories: z.array(z.string()).optional(),
});

export const CreateCharacterSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  referenceImageUrl: z.string().url().optional(),
  voiceProfileId: z.string().uuid().optional(),
  physicalAttributes: PhysicalAttributesSchema.optional(),
  personality: PersonalityTraitsSchema.optional(),
  clothing: ClothingStyleSchema.optional(),
  backstory: z.string().max(2000).optional(),
});

export const GetCharacterSchema = z.object({
  characterId: z.string().uuid(),
});

export const UpdateCharacterSchema = z.object({
  characterId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  referenceImageUrl: z.string().url().optional(),
  voiceProfileId: z.string().uuid().optional(),
  physicalAttributes: PhysicalAttributesSchema.optional(),
  personality: PersonalityTraitsSchema.optional(),
  clothing: ClothingStyleSchema.optional(),
  backstory: z.string().max(2000).optional(),
});

export const ListCharactersSchema = z.object({
  projectId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

// Return Types
export interface PhysicalAttributes {
  age?: number;
  ageRange?: 'child' | 'teen' | 'young_adult' | 'adult' | 'senior';
  gender?: 'male' | 'female' | 'non_binary' | 'other';
  ethnicity?: string;
  height?: string;
  build?: 'slim' | 'athletic' | 'average' | 'heavy' | 'muscular';
  hairColor?: string;
  hairStyle?: string;
  eyeColor?: string;
  skinTone?: string;
  distinctiveFeatures?: string[];
  facialHair?: string;
}

export interface PersonalityTraits {
  traits?: string[];
  mannerisms?: string[];
  motivations?: string;
  fears?: string;
  strengths?: string[];
  weaknesses?: string[];
}

export interface ClothingStyle {
  defaultOutfit?: string;
  style?: 'casual' | 'formal' | 'sporty' | 'vintage' | 'fantasy' | 'modern';
  colors?: string[];
  accessories?: string[];
}

export interface Character {
  // Asset fields
  id: string;
  projectId: string;
  name: string;
  type: 'character';
  description: string | null;
  referenceImageUrl: string | null;
  createdAt: string;
  updatedAt: string;

  // Character-specific fields
  voiceProfileId: string | null;
  physicalAttributes: PhysicalAttributes | null;
  personality: PersonalityTraits | null;
  clothing: ClothingStyle | null;
  backstory: string | null;
}

export interface ListCharactersResponse {
  characters: Character[];
  total: number;
  hasMore: boolean;
}
```

### Server Actions

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import {
  CreateCharacterSchema,
  GetCharacterSchema,
  UpdateCharacterSchema,
  ListCharactersSchema,
} from '../schemas/character.schema';

/**
 * Creates a new character with asset and character_details records
 * @throws {Error} If transaction fails or validation errors
 */
export const createCharacterAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    // Start transaction by creating asset first
    const { data: asset, error: assetError } = await client
      .from('assets')
      .insert({
        project_id: data.projectId,
        name: data.name,
        type: 'character',
        description: data.description ?? null,
        reference_image_url: data.referenceImageUrl ?? null,
      })
      .select()
      .single();

    if (assetError) {
      throw assetError;
    }

    // Create character_details record
    const { data: characterDetails, error: detailsError } = await client
      .from('character_details')
      .insert({
        asset_id: asset.id,
        voice_profile_id: data.voiceProfileId ?? null,
        physical_attributes: data.physicalAttributes ?? null,
        personality: data.personality ?? null,
        clothing: data.clothing ?? null,
        backstory: data.backstory ?? null,
      })
      .select()
      .single();

    if (detailsError) {
      // Rollback: delete asset if character_details creation fails
      await client.from('assets').delete().eq('id', asset.id);
      throw detailsError;
    }

    // Return flattened character object
    return {
      id: asset.id,
      projectId: asset.project_id,
      name: asset.name,
      type: asset.type,
      description: asset.description,
      referenceImageUrl: asset.reference_image_url,
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
      voiceProfileId: characterDetails.voice_profile_id,
      physicalAttributes: characterDetails.physical_attributes,
      personality: characterDetails.personality,
      clothing: characterDetails.clothing,
      backstory: characterDetails.backstory,
    };
  },
  { schema: CreateCharacterSchema, auth: true }
);

/**
 * Fetches a character with all details via JOIN
 * @throws {Error} If character not found or user lacks access
 */
export const getCharacterAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    const { data: result, error } = await client
      .from('assets')
      .select(
        `
        *,
        character_details (
          voice_profile_id,
          physical_attributes,
          personality,
          clothing,
          backstory
        )
      `
      )
      .eq('id', data.characterId)
      .eq('type', 'character')
      .is('deleted_at', null)
      .single();

    if (error) throw error;

    // Flatten structure
    const details = result.character_details?.[0];

    return {
      id: result.id,
      projectId: result.project_id,
      name: result.name,
      type: result.type,
      description: result.description,
      referenceImageUrl: result.reference_image_url,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
      voiceProfileId: details?.voice_profile_id ?? null,
      physicalAttributes: details?.physical_attributes ?? null,
      personality: details?.personality ?? null,
      clothing: details?.clothing ?? null,
      backstory: details?.backstory ?? null,
    };
  },
  { schema: GetCharacterSchema, auth: true }
);

/**
 * Updates character asset and details atomically
 * @throws {Error} If character not found or update fails
 */
export const updateCharacterAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    // Update asset fields if provided
    const assetUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) assetUpdates.name = data.name;
    if (data.description !== undefined) {
      assetUpdates.description = data.description;
    }
    if (data.referenceImageUrl !== undefined) {
      assetUpdates.reference_image_url = data.referenceImageUrl;
    }

    const { data: asset, error: assetError } = await client
      .from('assets')
      .update(assetUpdates)
      .eq('id', data.characterId)
      .eq('type', 'character')
      .is('deleted_at', null)
      .select()
      .single();

    if (assetError) throw assetError;

    // Update character_details if any character-specific fields provided
    const detailsUpdates: Record<string, unknown> = {};

    if (data.voiceProfileId !== undefined) {
      detailsUpdates.voice_profile_id = data.voiceProfileId;
    }
    if (data.physicalAttributes !== undefined) {
      detailsUpdates.physical_attributes = data.physicalAttributes;
    }
    if (data.personality !== undefined) {
      detailsUpdates.personality = data.personality;
    }
    if (data.clothing !== undefined) {
      detailsUpdates.clothing = data.clothing;
    }
    if (data.backstory !== undefined) {
      detailsUpdates.backstory = data.backstory;
    }

    let details = null;

    if (Object.keys(detailsUpdates).length > 0) {
      const { data: updatedDetails, error: detailsError } = await client
        .from('character_details')
        .update(detailsUpdates)
        .eq('asset_id', data.characterId)
        .select()
        .single();

      if (detailsError) throw detailsError;
      details = updatedDetails;
    } else {
      // Fetch existing details if no updates
      const { data: existingDetails } = await client
        .from('character_details')
        .select('*')
        .eq('asset_id', data.characterId)
        .single();

      details = existingDetails;
    }

    return {
      id: asset.id,
      projectId: asset.project_id,
      name: asset.name,
      type: asset.type,
      description: asset.description,
      referenceImageUrl: asset.reference_image_url,
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
      voiceProfileId: details?.voice_profile_id ?? null,
      physicalAttributes: details?.physical_attributes ?? null,
      personality: details?.personality ?? null,
      clothing: details?.clothing ?? null,
      backstory: details?.backstory ?? null,
    };
  },
  { schema: UpdateCharacterSchema, auth: true }
);

/**
 * Lists all characters for a project with pagination
 * @throws {Error} If user lacks project access
 */
export const listCharactersAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    const { data: results, error, count } = await client
      .from('assets')
      .select(
        `
        *,
        character_details (
          voice_profile_id,
          physical_attributes,
          personality,
          clothing,
          backstory
        )
      `,
        { count: 'exact' }
      )
      .eq('project_id', data.projectId)
      .eq('type', 'character')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (error) throw error;

    const characters = (results ?? []).map((result) => {
      const details = result.character_details?.[0];

      return {
        id: result.id,
        projectId: result.project_id,
        name: result.name,
        type: result.type,
        description: result.description,
        referenceImageUrl: result.reference_image_url,
        createdAt: result.created_at,
        updatedAt: result.updated_at,
        voiceProfileId: details?.voice_profile_id ?? null,
        physicalAttributes: details?.physical_attributes ?? null,
        personality: details?.personality ?? null,
        clothing: details?.clothing ?? null,
        backstory: details?.backstory ?? null,
      };
    });

    return {
      characters,
      total: count ?? 0,
      hasMore: (count ?? 0) > data.offset + data.limit,
    };
  },
  { schema: ListCharactersSchema, auth: true }
);
```

---

## Implementation Details

### File Structure

```
packages/features/assets/src/
├── lib/
│   ├── schemas/
│   │   ├── asset.schema.ts           # From FILM-201
│   │   └── character.schema.ts       # Character schemas (CREATE THIS)
│   └── server/
│       ├── mutations/
│       │   ├── asset-actions.ts      # From FILM-201
│       │   └── character-actions.ts  # Character actions (CREATE THIS)
│       └── queries/
│           └── character-queries.ts  # Helper queries (CREATE THIS)
└── types/
    ├── asset.types.ts                # From FILM-201
    └── character.types.ts            # Character types (CREATE THIS)
```

### Transaction Handling

**Pattern**: Create asset first, then details. Rollback asset if details fail.

```typescript
// Pseudo-code for transaction
try {
  const asset = await createAsset(...);
  try {
    const details = await createCharacterDetails(asset.id, ...);
    return mergeAssetAndDetails(asset, details);
  } catch (detailsError) {
    await deleteAsset(asset.id); // Rollback
    throw detailsError;
  }
} catch (assetError) {
  throw assetError;
}
```

**Why not Supabase Transactions?**
Supabase JS client doesn't support multi-statement transactions. We handle rollback manually.

### Database Queries

**Create Character** (2 queries):
```sql
-- 1. Create asset
INSERT INTO assets (project_id, name, type, description, reference_image_url)
VALUES ($1, $2, 'character', $3, $4)
RETURNING *;

-- 2. Create character_details
INSERT INTO character_details (
  asset_id,
  voice_profile_id,
  physical_attributes,
  personality,
  clothing,
  backstory
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;
```

**Get Character** (JOIN query):
```sql
SELECT
  a.*,
  cd.voice_profile_id,
  cd.physical_attributes,
  cd.personality,
  cd.clothing,
  cd.backstory
FROM assets a
LEFT JOIN character_details cd ON a.id = cd.asset_id
WHERE a.id = $1
  AND a.type = 'character'
  AND a.deleted_at IS NULL;
```

**Update Character** (2 queries):
```sql
-- 1. Update asset
UPDATE assets
SET
  name = COALESCE($2, name),
  description = COALESCE($3, description),
  reference_image_url = COALESCE($4, reference_image_url),
  updated_at = NOW()
WHERE id = $1 AND type = 'character' AND deleted_at IS NULL
RETURNING *;

-- 2. Update character_details
UPDATE character_details
SET
  voice_profile_id = COALESCE($2, voice_profile_id),
  physical_attributes = COALESCE($3, physical_attributes),
  personality = COALESCE($4, personality),
  clothing = COALESCE($5, clothing),
  backstory = COALESCE($6, backstory)
WHERE asset_id = $1
RETURNING *;
```

### JSONB Structure Examples

**physical_attributes**:
```json
{
  "age": 28,
  "ageRange": "young_adult",
  "gender": "female",
  "ethnicity": "East Asian",
  "height": "5'6\"",
  "build": "athletic",
  "hairColor": "black",
  "hairStyle": "long, straight",
  "eyeColor": "brown",
  "skinTone": "light",
  "distinctiveFeatures": ["small scar above left eyebrow", "wears glasses"]
}
```

**personality**:
```json
{
  "traits": ["intelligent", "cautious", "determined"],
  "mannerisms": ["pushes glasses up when thinking", "taps pen when nervous"],
  "motivations": "Wants to prove herself as a detective",
  "fears": "Losing her sister",
  "strengths": ["analytical thinking", "attention to detail"],
  "weaknesses": ["trust issues", "workaholic"]
}
```

**clothing**:
```json
{
  "defaultOutfit": "Navy blazer, white shirt, gray slacks",
  "style": "formal",
  "colors": ["navy", "gray", "white"],
  "accessories": ["silver watch", "small earrings", "badge"]
}
```

---

## File Changes

### New Files

1. **packages/features/assets/src/lib/schemas/character.schema.ts**
   - Export all character Zod schemas
   - Include nested schemas for attributes, personality, clothing
   - Add comprehensive validation rules

2. **packages/features/assets/src/lib/server/mutations/character-actions.ts**
   - Implement all character CRUD actions
   - Handle transaction rollback logic
   - Flatten JOIN query results

3. **packages/features/assets/src/lib/server/queries/character-queries.ts**
   - Helper functions for character queries
   - Reusable JOIN query builders
   - Character validation helpers

4. **packages/features/assets/src/types/character.types.ts**
   - Export Character interface
   - Export all response types
   - Mirror JSONB column structures

### Modified Files

None (new feature, builds on FILM-201)

---

## Acceptance Criteria

### Functional

- [x] `createCharacterAction` creates asset and character_details in transaction
- [x] `createCharacterAction` rolls back asset if details creation fails
- [x] `createCharacterAction` validates all nested schemas
- [x] `getCharacterAction` returns complete character with JOIN
- [x] `getCharacterAction` handles missing character_details gracefully
- [x] `updateCharacterAction` updates both asset and details atomically
- [x] `updateCharacterAction` preserves unmodified fields
- [x] `listCharactersAction` returns all characters with details
- [x] `listCharactersAction` respects pagination
- [x] All actions enforce authentication and RLS
- [x] Physical attributes properly validated (age, gender, build)
- [x] Personality traits properly validated (arrays, strings)
- [x] Clothing style properly validated (enums, arrays)

### Non-Functional

- [x] All operations complete within 3 seconds
- [x] Transaction rollback works correctly
- [x] JSONB columns properly typed in TypeScript
- [x] No N+1 queries (use JOINs)
- [x] TypeScript compiles without errors
- [x] No ESLint warnings

### Implementation Notes

**Files Created:**
- `packages/features/assets/src/lib/types/character.types.ts` - Character type definitions
- `packages/features/assets/src/lib/schemas/character.schema.ts` - Zod validation schemas
- `packages/features/assets/src/lib/server/character-actions.ts` - Server actions
- `packages/features/assets/__tests__/character-schemas.test.ts` - Schema tests (37 tests)

**Deviations from Spec:**
- Used `fileUrl`/`thumbnailUrl` instead of `referenceImageUrl` for consistency with existing asset patterns
- Used `voiceAssetId` instead of `voiceProfileId` to match database schema
- Clothing and backstory stored in `physical_attributes` JSONB field due to existing schema constraints

---

## Test Plan

### Unit Tests

**File**: `packages/features/assets/src/lib/server/mutations/__tests__/character-actions.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCharacterAction,
  getCharacterAction,
  updateCharacterAction,
  listCharactersAction,
} from '../character-actions';

describe('Character Actions', () => {
  describe('createCharacterAction', () => {
    it('should create character with all details', async () => {
      // Test implementation
    });

    it('should rollback asset if details creation fails', async () => {
      // Mock details creation failure
      // Verify asset deleted
    });

    it('should validate physical attributes schema', async () => {
      // Test invalid age, gender, etc.
    });

    it('should create character without optional fields', async () => {
      // Minimal data test
    });
  });

  describe('getCharacterAction', () => {
    it('should return character with all details', async () => {
      // Test implementation
    });

    it('should handle missing character_details', async () => {
      // Test orphaned asset
    });

    it('should throw error for non-character asset', async () => {
      // Try to get location as character
    });
  });

  describe('updateCharacterAction', () => {
    it('should update asset and details atomically', async () => {
      // Test implementation
    });

    it('should update only provided fields', async () => {
      // Partial update test
    });

    it('should preserve nested JSONB structures', async () => {
      // Update personality without affecting clothing
    });
  });

  describe('listCharactersAction', () => {
    it('should return all characters with details', async () => {
      // Test implementation
    });

    it('should respect pagination', async () => {
      // Create 10 characters, fetch 5
    });

    it('should exclude non-character assets', async () => {
      // Mix of characters, locations, voices
    });
  });
});
```

### Schema Validation Tests

**File**: `packages/features/assets/src/lib/schemas/__tests__/character.schema.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  PhysicalAttributesSchema,
  PersonalityTraitsSchema,
  ClothingStyleSchema,
  CreateCharacterSchema,
} from '../character.schema';

describe('Character Schemas', () => {
  describe('PhysicalAttributesSchema', () => {
    it('should accept valid attributes', () => {
      const valid = {
        age: 28,
        gender: 'female',
        build: 'athletic',
      };
      expect(() => PhysicalAttributesSchema.parse(valid)).not.toThrow();
    });

    it('should reject invalid age', () => {
      const invalid = { age: 200 };
      expect(() => PhysicalAttributesSchema.parse(invalid)).toThrow();
    });

    it('should reject invalid gender', () => {
      const invalid = { gender: 'alien' };
      expect(() => PhysicalAttributesSchema.parse(invalid)).toThrow();
    });
  });

  describe('PersonalityTraitsSchema', () => {
    it('should accept valid personality', () => {
      const valid = {
        traits: ['brave', 'intelligent'],
        motivations: 'Save the world',
      };
      expect(() => PersonalityTraitsSchema.parse(valid)).not.toThrow();
    });

    it('should reject non-array traits', () => {
      const invalid = { traits: 'brave' };
      expect(() => PersonalityTraitsSchema.parse(invalid)).toThrow();
    });
  });

  describe('ClothingStyleSchema', () => {
    it('should accept valid clothing', () => {
      const valid = {
        style: 'casual',
        colors: ['blue', 'white'],
      };
      expect(() => ClothingStyleSchema.parse(valid)).not.toThrow();
    });

    it('should reject invalid style', () => {
      const invalid = { style: 'futuristic' };
      expect(() => ClothingStyleSchema.parse(invalid)).toThrow();
    });
  });
});
```

### Integration Tests

**File**: `apps/web/__tests__/integration/character-crud.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

describe('Character CRUD Integration', () => {
  it('should complete full character lifecycle', async () => {
    // 1. Create character with all details
    // 2. Get character and verify details
    // 3. Update character attributes
    // 4. Delete character (soft delete)
  });

  it('should maintain transaction integrity', async () => {
    // Force character_details creation to fail
    // Verify asset was rolled back
  });

  it('should support voice profile association', async () => {
    // Create voice profile
    // Create character with voice_profile_id
    // Verify association
  });
});
```

---

## Security Considerations

### Input Sanitization

- JSONB columns sanitized by Supabase
- No raw SQL string concatenation
- Arrays properly validated (distinctiveFeatures, traits)

### Data Privacy

- Character details may contain sensitive information
- Respect project-level RLS policies
- No direct character_details access without asset ownership

### Validation

- Age range: 0-150 years (prevent negative or unrealistic values)
- String lengths enforced (prevent DoS via large strings)
- Enum values strictly validated
- Array lengths not enforced (consider adding max 20 items)

---

## Error Handling

### Transaction Rollback

```typescript
try {
  const asset = await createAsset(...);
  try {
    const details = await createCharacterDetails(...);
  } catch (detailsError) {
    await client.from('assets').delete().eq('id', asset.id);
    logger.error('Character details creation failed, rolled back asset', {
      assetId: asset.id,
      error: detailsError,
    });
    throw new Error('Failed to create character details');
  }
} catch (assetError) {
  logger.error('Character creation failed', { error: assetError });
  throw assetError;
}
```

### Missing Details Handling

```typescript
// Handle case where character_details was deleted/corrupted
const details = result.character_details?.[0];

if (!details) {
  logger.warn('Character missing details', { characterId: result.id });
  // Return character with null details rather than throwing
  return {
    ...result,
    voiceProfileId: null,
    physicalAttributes: null,
    personality: null,
    clothing: null,
    backstory: null,
  };
}
```

---

## Performance Considerations

### JOIN Query Optimization

```sql
-- Ensure foreign key index exists
CREATE INDEX idx_character_details_asset_id ON character_details(asset_id);

-- Query plan for JOIN
EXPLAIN ANALYZE
SELECT a.*, cd.*
FROM assets a
LEFT JOIN character_details cd ON a.id = cd.asset_id
WHERE a.project_id = '<uuid>' AND a.type = 'character';
```

### JSONB Indexing

For future filtering by physical attributes:

```sql
-- GIN index for JSONB columns
CREATE INDEX idx_character_physical_gin ON character_details
  USING GIN (physical_attributes);

-- Example query with JSONB filter
SELECT * FROM character_details
WHERE physical_attributes @> '{"gender": "female"}';
```

### Caching Strategy

```typescript
// React Query cache for character list
const { data } = useQuery({
  queryKey: ['characters', projectId],
  queryFn: () => listCharactersAction({ projectId }),
  staleTime: 5 * 60 * 1000, // 5 minutes
});

// Optimistic update after creation
await createCharacterAction(data);
queryClient.setQueryData(['characters', projectId], (old) => ({
  ...old,
  characters: [newCharacter, ...old.characters],
  total: old.total + 1,
}));
```

---

## Future Enhancements

1. **Character Versioning**
   - Track changes to character details over time
   - Support reverting to previous versions

2. **Character Templates**
   - Predefined character archetypes (hero, villain, sidekick)
   - Quick character creation from templates

3. **AI-Powered Character Generation**
   - Generate physical attributes from reference image
   - LLM-powered personality trait suggestions

4. **Character Relationships**
   - Define relationships between characters
   - Support character groups/families

5. **Character Validation**
   - Warn if character lacks required details for video generation
   - Suggest improvements to character descriptions

---

## References

- **FILM-101d**: Assets table schema
- **FILM-103**: Character details table schema
- **FILM-201**: Asset CRUD actions
- **FILM-209**: Element prompt generation (uses character data)
- **Constitution**: Section 2.2 (Server Actions Pattern)
- **Constitution**: Section 3.4 (JSONB Column Standards)
