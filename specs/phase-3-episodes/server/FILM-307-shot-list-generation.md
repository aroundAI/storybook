# FILM-307: Shot List Generation Server Actions

**Phase**: 3
**Priority**: P0
**Effort**: L (5-7 days)
**Dependencies**: FILM-303 (shot-crud-actions), FILM-306 (screenplay-conversion)
**Blocks**: FILM-311, Phase 4 (Video Generation)

---

## Context

The Shot List Generation system uses LLM to break down screenplays into individual shots optimized for AI video generation. Each shot includes a detailed visual description, Kling-optimized prompt, camera direction, and duration. The system creates shot records using batchCreateShotsAction and updates episode.shot_list with the generation metadata.

This is the final step in the story pipeline before video generation begins. The system must produce shots that respect video provider constraints (3-10 seconds per shot, simple camera movements) and include all metadata needed for generation and editing.

---

## Requirements

### Functional Requirements

1. **Generate Shot List**
   - Accept episode ID with screenplay_data populated
   - Call LLM with shot-list-generation prompt template
   - Generate 10-50 shots from screenplay
   - Create shot records using batchCreateShotsAction
   - Validate output against Zod schema
   - Update episode.shot_list with metadata
   - Track generation cost and store metadata
   - Return complete shot list with created shot IDs

---

## Interface

### TypeScript Types

```typescript
import { z } from 'zod';

export const GenerateShotListSchema = z.object({
  episodeId: z.string().uuid(),
  shotDurationMin: z.number().min(3).max(10).default(5),
  shotDurationMax: z.number().min(3).max(10).default(8),
  videoProvider: z.enum(['kling', 'runway', 'luma']).default('kling'),
  provider: z.enum(['anthropic', 'openai', 'google']).optional(),
  model: z.string().optional(),
});

export interface GeneratedShot {
  sequenceNumber: number;
  sceneNumber: number;
  shotNumber: number;
  shotType: string;
  cameraDirection: string;
  description: string;
  action: string;
  prompt: string;
  characters: string[];
  duration: number;
  metadata: {
    location: string;
    timeOfDay: string;
    mood?: string;
    lighting?: string;
  };
}

export interface ShotListMetadata {
  totalShots: number;
  totalDuration: number;
  shotTypes: {
    wide: number;
    medium: number;
    closeUp: number;
  };
  locations: string[];
  characters: string[];
}

export interface GenerateShotListResponse {
  shots: GeneratedShot[];
  shotsCreated: number;
  episode: {
    id: string;
    status: string;
    version: number;
  };
  metadata: {
    provider: string;
    model: string;
    costCents: number;
    tokensUsed: number;
    generatedAt: string;
    totalShots: number;
    totalDuration: number;
  };
}
```

### Server Actions

**Implementation File**: `packages/features/episodes/src/lib/server/mutations/shot-list-actions.ts`

The actual implementation uses `executeLLM` from `@kit/prompt-engine/server` which provides:
- Automatic prompt template loading from JSON files
- Built-in cost tracking and analytics logging
- Structured logging via `@kit/shared/logger`

Key implementation details:
- Uses `requireUser()` for authentication
- Supports both `screenplay_data` and `story_data` as input (fallback)
- Uses `ShotListGenerationOutputSchema.parse()` for Zod validation
- Calls `batchCreateShotsAction` to create shot records
- Updates `episode.shot_list` with optimistic locking via `version` check
- Revalidates Next.js cache after successful generation

```typescript
// Simplified example - see actual implementation for full details
export const generateShotListAction = enhanceAction(
  async (data): Promise<GenerateShotListResponse> => {
    // 1. Authenticate user
    const { data: user } = await requireUser(client);

    // 2. Fetch episode with screenplay_data or story_data
    const { data: episode } = await client
      .from('episodes')
      .select('id, project_id, screenplay_data, story_data, status, version')
      .eq('id', data.episodeId)
      .single();

    // 3. Format input for LLM (supports both screenplay and story fallback)
    const screenplayText = episode.screenplay_data
      ? formatScreenplayForPrompt(episode.screenplay_data)
      : formatStoryForPrompt(episode.story_data);

    // 4. Execute LLM via prompt-engine
    const llmResult = await executeLLM<{ shotList: unknown }>({
      templateSlug: 'shot-list-generation',
      variables: {
        screenplay_text: screenplayText,
        shot_duration_min: data.shotDurationMin,
        shot_duration_max: data.shotDurationMax,
        video_provider: data.videoProvider,
      },
      context: { name: 'shot-list.generate', accountId, userId: user.id },
    });

    // 5. Validate output with Zod
    const validated = ShotListGenerationOutputSchema.parse(llmResult.data);

    // 6. Create shots via batchCreateShotsAction
    const batchResult = await batchCreateShotsAction({
      episodeId: data.episodeId,
      shots: shotsToCreate,
    });

    // 7. Update episode.shot_list with optimistic locking
    await client
      .from('episodes')
      .update({ shot_list: shotListData })
      .eq('id', data.episodeId)
      .eq('version', episode.version);  // Optimistic lock

    return { success: true, shots, metadata, ... };
  },
  { schema: GenerateShotListSchema }
);
```

---

## File Changes

### Implemented Files

1. **packages/features/episodes/src/lib/schemas/shot-list.schema.ts** - Zod schemas for input validation and LLM output
2. **packages/features/episodes/src/lib/server/mutations/shot-list-actions.ts** - `generateShotListAction` server action
3. **packages/features/episodes/src/lib/types.ts** - Contains `ShotListData`, `GenerateShotListResponse` types
4. **packages/features/prompt-engine/src/prompts/story-generation/shot-list-generation.json** - LLM prompt template

---

## Acceptance Criteria

**Status**: ✅ Complete (2025-12-08)
**Implementation**: Verified 2025-12-11

- [x] `generateShotListAction` generates shots from screenplay
- [x] Creates shot records via batchCreateShotsAction
- [x] Updates episode.shot_list with metadata
- [x] Validates output with Zod schema
- [x] Handles optimistic locking
- [x] Completes within 40 seconds
- [x] Enforces authentication
- [x] Supports both screenplay_data and story_data as input sources (fallback)

---

## References

- **FILM-303**: Shot CRUD actions (implemented together)
- **FILM-306**: Screenplay conversion
- **FILM-304**: Prompt templates
