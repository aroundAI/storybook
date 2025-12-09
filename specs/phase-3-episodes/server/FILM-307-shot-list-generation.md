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

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { executePrompt, calculateLLMCost } from '@kit/llm';
import { ShotListGenerationOutputSchema } from '@kit/prompt-engine/schemas';
import { GenerateShotListSchema } from '../schemas/shot-list.schema';
import { batchCreateShotsAction } from './shot-actions';

export const generateShotListAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();
    const startTime = Date.now();

    // Fetch episode with screenplay_data
    const { data: episode, error: episodeError } = await client
      .from('episodes')
      .select('id, project_id, screenplay_data, status, version')
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (episodeError || !episode) {
      throw new Error('Episode not found');
    }

    if (!episode.screenplay_data) {
      throw new Error('Episode must have screenplay generated first');
    }

    if (episode.status !== 'storyboard') {
      throw new Error(`Invalid episode status: ${episode.status}. Expected 'storyboard'`);
    }

    // Prepare screenplay text
    const screenplayText = formatScreenplayForPrompt(episode.screenplay_data);

    const variables = {
      screenplay: episode.screenplay_data,
      screenplayText,
      shotDurationMin: data.shotDurationMin,
      shotDurationMax: data.shotDurationMax,
      videoProvider: data.videoProvider,
    };

    // Execute LLM prompt
    const result = await executePrompt('shot-list-generation', variables, {
      provider: data.provider ?? 'anthropic',
      model: data.model,
      timeout: 40000, // 40 second timeout (longer for complex screenplays)
    });

    // Validate output
    const validated = ShotListGenerationOutputSchema.parse(result);

    // Calculate cost
    const costCents = calculateLLMCost({
      provider: result.metadata.provider,
      model: result.metadata.model,
      inputTokens: result.metadata.inputTokens,
      outputTokens: result.metadata.outputTokens,
    });

    // Prepare shot list data
    const shotListData = {
      shots: validated.shotList.shots,
      generatedAt: new Date().toISOString(),
      approvedAt: null,
      totalEstimatedDuration: validated.shotList.metadata.totalDuration,
      generatedBy: {
        model: result.metadata.model,
        provider: result.metadata.provider,
        costCents,
      },
      metadata: validated.shotList.metadata,
    };

    // Create shots using batchCreateShotsAction
    const shotsToCreate = validated.shotList.shots.map(shot => ({
      sceneNumber: shot.sceneNumber,
      shotNumber: shot.shotNumber,
      description: shot.description,
      prompt: shot.prompt,
      durationSeconds: shot.duration,
      cameraDirection: shot.cameraDirection,
      characters: shot.characters,
    }));

    const { shots: createdShots } = await batchCreateShotsAction(
      { episodeId: data.episodeId, shots: shotsToCreate },
      user
    );

    // Update episode with shot_list metadata
    const { data: updatedEpisode, error: updateError } = await client
      .from('episodes')
      .update({
        shot_list: shotListData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .eq('version', episode.version)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
      throw new Error('Episode was modified by another user');
    }

    const duration = Date.now() - startTime;

    console.log('[Shot List Generation]', {
      userId: user.id,
      episodeId: data.episodeId,
      projectId: episode.project_id,
      provider: result.metadata.provider,
      model: result.metadata.model,
      costCents,
      duration,
      shotCount: validated.shotList.shots.length,
      totalDuration: validated.shotList.metadata.totalDuration,
    });

    return {
      shots: validated.shotList.shots,
      shotsCreated: createdShots.length,
      episode: {
        id: updatedEpisode.id,
        status: updatedEpisode.status,
        version: updatedEpisode.version,
      },
      metadata: {
        provider: result.metadata.provider,
        model: result.metadata.model,
        costCents,
        tokensUsed: result.metadata.inputTokens + result.metadata.outputTokens,
        generatedAt: shotListData.generatedAt,
        totalShots: validated.shotList.metadata.totalShots,
        totalDuration: validated.shotList.metadata.totalDuration,
      },
    };
  },
  { schema: GenerateShotListSchema, auth: true }
);

function formatScreenplayForPrompt(screenplayData: any): string {
  let text = '';
  for (const scene of screenplayData.scenes) {
    text += `${scene.heading}\n\n`;
    text += `${scene.description}\n\n`;
    for (const dialogue of scene.dialogue) {
      text += `${dialogue.character}\n`;
      if (dialogue.parenthetical) {
        text += `(${dialogue.parenthetical})\n`;
      }
      text += `${dialogue.text}\n\n`;
    }
    text += `\n`;
  }
  return text;
}
```

---

## File Changes

### New Files

1. **packages/features/episodes/src/lib/schemas/shot-list.schema.ts**
2. **packages/features/episodes/src/lib/server/mutations/shot-list-actions.ts**
3. **packages/features/episodes/src/types/shot-list.types.ts**

---

## Acceptance Criteria

**Status**: ✅ Complete (2025-12-08)
**Implementation**: PR #TBD

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
