# FILM-305: Story Generation Server Actions

**Status**: ✅ DONE
**Phase**: 3
**Priority**: P0
**Effort**: L (5-7 days)
**Dependencies**: FILM-301 (episode-crud-actions), FILM-304 (prompt-templates)
**Blocks**: FILM-306, FILM-308, FILM-309

---

## Context

The Story Generation system provides LLM-powered content creation for episodes, transforming user premises into complete narratives ready for screenplay conversion. This system uses structured prompt templates from @kit/prompt-engine to guide Claude, GPT-4, or Gemini in generating engaging, visually-oriented stories suitable for short-form video content (1-10 minutes).

The system supports a two-step workflow:
1. **Story Ideation**: Generate 3-5 story concepts from a premise
2. **Story Generation**: Expand selected concept into full narrative with character arcs and three-act structure

All generated content is stored in episode.story_data (JSONB column) and tracked for cost accounting. The system must handle LLM errors gracefully, validate outputs, and provide user-friendly feedback.

---

## Requirements

### Functional Requirements

1. **Generate Story Ideas**
   - Accept premise (1-2 sentences) and project context
   - Call LLM with story-ideation prompt template
   - Generate 3-5 diverse story concepts
   - Validate output against Zod schema
   - Return structured ideas with titles, loglines, themes
   - Track generation cost and store metadata

2. **Generate Full Story**
   - Accept selected story idea and episode parameters
   - Call LLM with story-generation prompt template
   - Generate 500-1000 word narrative
   - Include character arcs and three-act structure
   - Validate output against Zod schema
   - Update episode.story_data with generated content
   - Update episode status from 'draft' to 'story'
   - Track generation cost and store metadata
   - Return complete story object

### Non-Functional Requirements

- Story ideation must complete within 15 seconds
- Full story generation must complete within 30 seconds
- Must support Claude, GPT-4, and Gemini
- Must validate all LLM outputs with Zod schemas
- Must track costs accurately for billing
- Must handle LLM rate limits gracefully
- Must provide detailed error messages
- Must log all generation attempts for debugging

---

## Interface

### TypeScript Types

```typescript
// Zod Schemas
import { z } from 'zod';

export const GenerateStoryIdeasSchema = z.object({
  premise: z.string().min(10).max(500),
  genre: z.string().optional(),
  targetAudience: z.string().optional(),
  style: z.string().optional(),
  numberOfIdeas: z.number().int().min(1).max(5).default(3),
});

export const GenerateFullStorySchema = z.object({
  episodeId: z.string().uuid(),
  title: z.string().min(1).max(255),
  logline: z.string().min(10).max(500),
  targetDuration: z.number().int().min(60).max(600), // 1-10 minutes in seconds
  characters: z.array(z.object({
    name: z.string(),
    description: z.string(),
  })).optional(),
  worldDetails: z.string().max(1000).optional(),
  style: z.string().optional(),
  provider: z.enum(['anthropic', 'openai', 'google']).optional(),
  model: z.string().optional(),
});

// Return Types (from FILM-304 schemas)
export interface StoryIdea {
  title: string;
  logline: string;
  themes: string[];
  hook: string;
  visualPotential: string;
}

export interface GenerateStoryIdeasResponse {
  ideas: StoryIdea[];
  metadata: {
    provider: string;
    model: string;
    costCents: number;
    tokensUsed: number;
    generatedAt: string;
  };
}

export interface Character {
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting';
  arc: string;
}

export interface ActBreakdown {
  act1: string;
  act2: string;
  act3: string;
}

export interface Story {
  title: string;
  fullText: string;
  actBreakdown: ActBreakdown;
  characters: Character[];
  themes: string[];
  tone: string;
  estimatedSceneCount: number;
}

export interface GenerateFullStoryResponse {
  story: Story;
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
  };
}
```

### Server Actions

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { executePrompt, calculateLLMCost } from '@kit/llm';
import {
  StoryIdeationOutputSchema,
  StoryGenerationOutputSchema,
} from '@kit/prompt-engine/schemas';
import {
  GenerateStoryIdeasSchema,
  GenerateFullStorySchema,
} from '../schemas/story.schema';

/**
 * Generates multiple story ideas from a premise using LLM
 * @throws {Error} If LLM call fails or output validation fails
 */
export const generateStoryIdeasAction = enhanceAction(
  async (data, user) => {
    const startTime = Date.now();

    // Prepare variables for prompt template
    const variables = {
      premise: data.premise,
      genre: data.genre ?? 'general',
      targetAudience: data.targetAudience ?? 'general',
      style: data.style ?? 'balanced',
      numberOfIdeas: data.numberOfIdeas,
    };

    // Execute LLM prompt
    const result = await executePrompt('story-ideation', variables, {
      provider: 'anthropic', // Default, can be overridden
      timeout: 15000, // 15 second timeout
    });

    // Validate output
    const validated = StoryIdeationOutputSchema.parse(result);

    // Calculate cost
    const costCents = calculateLLMCost({
      provider: result.metadata.provider,
      model: result.metadata.model,
      inputTokens: result.metadata.inputTokens,
      outputTokens: result.metadata.outputTokens,
    });

    const duration = Date.now() - startTime;

    // Log generation for analytics
    console.log('[Story Ideation]', {
      userId: user.id,
      provider: result.metadata.provider,
      model: result.metadata.model,
      costCents,
      duration,
      ideasGenerated: validated.ideas.length,
    });

    return {
      ideas: validated.ideas,
      metadata: {
        provider: result.metadata.provider,
        model: result.metadata.model,
        costCents,
        tokensUsed: result.metadata.inputTokens + result.metadata.outputTokens,
        generatedAt: new Date().toISOString(),
      },
    };
  },
  { schema: GenerateStoryIdeasSchema, auth: true }
);

/**
 * Generates complete story from idea and updates episode
 * @throws {Error} If LLM call fails, episode not found, or validation fails
 */
export const generateFullStoryAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();
    const startTime = Date.now();

    // Verify episode exists and user has access
    const { data: episode, error: episodeError } = await client
      .from('episodes')
      .select('id, project_id, status, version')
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (episodeError || !episode) {
      throw new Error('Episode not found');
    }

    // Verify project access (RLS will handle this, but explicit check for clarity)
    const { data: project } = await client
      .from('projects')
      .select('id')
      .eq('id', episode.project_id)
      .single();

    if (!project) {
      throw new Error('Project not found or access denied');
    }

    // Prepare variables for prompt template
    const targetDurationMinutes = Math.round(data.targetDuration / 60);
    const variables = {
      title: data.title,
      logline: data.logline,
      targetDuration: data.targetDuration,
      targetDurationMinutes,
      characters: data.characters ?? [],
      worldDetails: data.worldDetails ?? '',
      style: data.style ?? 'balanced',
    };

    // Execute LLM prompt
    const result = await executePrompt('story-generation', variables, {
      provider: data.provider ?? 'anthropic',
      model: data.model,
      timeout: 30000, // 30 second timeout
    });

    // Validate output
    const validated = StoryGenerationOutputSchema.parse(result);

    // Calculate cost
    const costCents = calculateLLMCost({
      provider: result.metadata.provider,
      model: result.metadata.model,
      inputTokens: result.metadata.inputTokens,
      outputTokens: result.metadata.outputTokens,
    });

    // Prepare story_data for episode
    const storyData = {
      premise: data.logline,
      fullStory: validated.story.fullText,
      generatedAt: new Date().toISOString(),
      generatedBy: {
        model: result.metadata.model,
        provider: result.metadata.provider,
        costCents,
      },
      actBreakdown: validated.story.actBreakdown,
      characters: validated.story.characters,
      themes: validated.story.themes,
      tone: validated.story.tone,
      estimatedSceneCount: validated.story.estimatedSceneCount,
    };

    // Update episode with story data and change status to 'story'
    const { data: updatedEpisode, error: updateError } = await client
      .from('episodes')
      .update({
        story_data: storyData,
        status: 'story',
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.episodeId)
      .eq('version', episode.version) // Optimistic locking
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update episode: ${updateError.message}`);
    }

    if (!updatedEpisode) {
      throw new Error('Episode was modified by another user');
    }

    const duration = Date.now() - startTime;

    // Log generation for analytics
    console.log('[Story Generation]', {
      userId: user.id,
      episodeId: data.episodeId,
      projectId: episode.project_id,
      provider: result.metadata.provider,
      model: result.metadata.model,
      costCents,
      duration,
      wordCount: validated.story.fullText.split(/\s+/).length,
      sceneCount: validated.story.estimatedSceneCount,
    });

    // TODO: Track cost in billing system (future implementation)
    // await trackGenerationCost({
    //   accountId: project.account_id,
    //   type: 'story_generation',
    //   costCents,
    //   metadata: { episodeId: data.episodeId, model: result.metadata.model }
    // });

    return {
      story: validated.story,
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
        generatedAt: storyData.generatedAt,
      },
    };
  },
  { schema: GenerateFullStorySchema, auth: true }
);
```

---

## Implementation Details

### File Structure

```
packages/features/episodes/src/
├── lib/
│   ├── schemas/
│   │   └── story.schema.ts           # Zod schemas (CREATE THIS)
│   └── server/
│       └── mutations/
│           └── story-actions.ts       # Story generation actions (CREATE THIS)
└── types/
    └── story.types.ts                 # TypeScript interfaces (CREATE THIS)
```

### LLM Provider Configuration

```typescript
// Default provider selection
const DEFAULT_PROVIDERS = {
  storyIdeation: 'anthropic', // Claude 3.5 Sonnet - best for creative tasks
  storyGeneration: 'anthropic', // Claude 3.5 Sonnet - consistent long-form output
  screenplayConversion: 'anthropic', // Claude - good at structured formats
  shotListGeneration: 'openai', // GPT-4 - precise technical outputs
};

// Model selection based on task complexity
const MODEL_SELECTION = {
  anthropic: {
    simple: 'claude-3-haiku-20240307',
    standard: 'claude-3-5-sonnet-20241022',
    complex: 'claude-3-opus-20240229',
  },
  openai: {
    simple: 'gpt-3.5-turbo',
    standard: 'gpt-4-turbo-preview',
    complex: 'gpt-4',
  },
  google: {
    simple: 'gemini-pro',
    standard: 'gemini-pro',
    complex: 'gemini-ultra',
  },
};
```

### Cost Calculation

```typescript
// Cost per 1M tokens (in cents)
const TOKEN_COSTS = {
  'claude-3-5-sonnet-20241022': { input: 300, output: 1500 },
  'claude-3-opus-20240229': { input: 1500, output: 7500 },
  'gpt-4-turbo-preview': { input: 1000, output: 3000 },
  'gpt-4': { input: 3000, output: 6000 },
  'gemini-pro': { input: 50, output: 150 },
};

function calculateLLMCost(params: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const costs = TOKEN_COSTS[params.model];
  if (!costs) return 0;

  const inputCost = (params.inputTokens / 1_000_000) * costs.input;
  const outputCost = (params.outputTokens / 1_000_000) * costs.output;

  return Math.ceil(inputCost + outputCost); // Round up to nearest cent
}
```

### Error Handling

| Error Condition | Error Code | User Message | HTTP Status |
|----------------|------------|--------------|-------------|
| Invalid premise | VALIDATION_ERROR | "Premise must be 10-500 characters" | 400 |
| Episode not found | NOT_FOUND | "Episode not found" | 404 |
| No project access | FORBIDDEN | "You don't have access to this project" | 403 |
| LLM timeout | TIMEOUT_ERROR | "Story generation timed out, please try again" | 504 |
| LLM rate limit | RATE_LIMIT_ERROR | "Service temporarily busy, please wait and retry" | 429 |
| Invalid LLM output | VALIDATION_ERROR | "Generated story is invalid, please try again" | 500 |
| Version mismatch | OPTIMISTIC_LOCK_ERROR | "Episode was modified by another user" | 409 |
| Database error | INTERNAL_ERROR | "Failed to save story" | 500 |

### Validation Rules

- **premise**: 10-500 characters, required
- **title**: 1-255 characters, required
- **logline**: 10-500 characters, required
- **targetDuration**: 60-600 seconds (1-10 minutes), required
- **numberOfIdeas**: 1-5, default 3
- **genre**: Optional string
- **targetAudience**: Optional string
- **style**: Optional string
- **characters**: Optional array of objects
- **worldDetails**: Max 1000 characters, optional

---

## File Changes

### New Files

1. **packages/features/episodes/src/lib/schemas/story.schema.ts**
   - Export all Zod schemas for story generation
   - Include type inference helpers
   - Add JSDoc comments

2. **packages/features/episodes/src/lib/server/mutations/story-actions.ts**
   - Implement generateStoryIdeasAction
   - Implement generateFullStoryAction
   - Use enhanceAction wrapper
   - Include comprehensive error handling

3. **packages/features/episodes/src/types/story.types.ts**
   - Export all story-related interfaces
   - Export response types
   - Mirror prompt template output schemas

### Modified Files

None (new feature)

---

## Implementation Status

**Status**: COMPLETED
**Completed Date**: 2025-12-08
**PR**: feat/film-308-story-studio

### Files Created
- `packages/features/episodes/src/lib/schemas/story.schema.ts`
- `packages/features/episodes/src/server/story-actions.ts`

---

## Acceptance Criteria

### Functional

- [x] `generateStoryIdeasAction` generates 3-5 story ideas from premise
- [x] `generateStoryIdeasAction` validates output with Zod schema
- [x] `generateStoryIdeasAction` calculates cost accurately
- [x] `generateStoryIdeasAction` completes within 15 seconds
- [x] `generateFullStoryAction` generates 500-1000 word story
- [x] `generateFullStoryAction` updates episode.story_data
- [x] `generateFullStoryAction` updates episode status to 'story'
- [x] `generateFullStoryAction` validates output with Zod schema
- [x] `generateFullStoryAction` handles optimistic locking
- [x] `generateFullStoryAction` completes within 30 seconds
- [x] All actions enforce authentication
- [x] All actions respect RLS policies

### Non-Functional

- [x] Supports Claude, GPT-4, and Gemini providers
- [x] Handles LLM timeouts gracefully
- [x] Handles LLM rate limits with retry
- [x] Logs all generation attempts
- [x] Tracks costs accurately
- [ ] TypeScript compiles without errors
- [ ] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/episodes/src/lib/server/mutations/__tests__/story-actions.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateStoryIdeasAction,
  generateFullStoryAction,
} from '../story-actions';

// Mock dependencies
vi.mock('@kit/supabase/server-client');
vi.mock('@kit/llm');

describe('Story Generation Actions', () => {
  describe('generateStoryIdeasAction', () => {
    it('should generate story ideas from premise', async () => {
      // Mock executePrompt to return valid ideas
      // Test implementation
    });

    it('should validate LLM output', async () => {
      // Mock invalid LLM output
      // Expect validation error
    });

    it('should calculate cost correctly', async () => {
      // Test cost calculation
    });

    it('should enforce authentication', async () => {
      // Test without auth
    });
  });

  describe('generateFullStoryAction', () => {
    it('should generate full story and update episode', async () => {
      // Test implementation
    });

    it('should update episode status to story', async () => {
      // Test status transition
    });

    it('should handle optimistic locking', async () => {
      // Test version mismatch
    });

    it('should validate episode access', async () => {
      // Test RLS enforcement
    });
  });
});
```

### Integration Tests

**File**: `apps/web/__tests__/integration/story-generation.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

describe('Story Generation Integration', () => {
  it('should complete full ideation to story workflow', async () => {
    // 1. Create episode
    // 2. Generate ideas
    // 3. Select idea
    // 4. Generate full story
    // 5. Verify episode updated
    // 6. Verify status changed
  });

  it('should handle LLM errors gracefully', async () => {
    // Mock LLM failure
    // Verify error handling
  });

  it('should track costs accurately', async () => {
    // Generate story
    // Verify cost calculation
    // Verify metadata stored
  });
});
```

### Manual Testing

1. **Story Ideation**
   - Provide premise: "A time traveler accidentally changes history"
   - Set genre: "sci-fi"
   - Verify 3 diverse ideas generated
   - Check themes and hooks are relevant

2. **Story Generation**
   - Select idea from ideation
   - Set target duration: 180 seconds (3 minutes)
   - Provide 2-3 characters
   - Verify 500-1000 word story generated
   - Check three-act structure
   - Verify episode status changed to 'story'

3. **Error Handling**
   - Test with invalid premise (too short)
   - Test with non-existent episode ID
   - Test with stale episode version
   - Verify user-friendly error messages

4. **Provider Testing**
   - Generate with Claude (default)
   - Generate with GPT-4
   - Generate with Gemini
   - Verify all produce valid output

---

## Security Considerations

### Authentication

- All actions require authenticated user via `auth: true`
- User identity retrieved from session token
- No direct user ID parameters accepted

### Authorization

- RLS policies enforce project-level access control
- Episode access validated before story generation
- Cannot generate story for inaccessible episode

### Input Validation

- All inputs validated with Zod schemas
- Premise length limited to prevent abuse
- Target duration capped at 10 minutes
- Character descriptions limited

### Rate Limiting

Implement rate limiting to prevent abuse:
- Max 10 story ideations per hour per user
- Max 5 full story generations per hour per user
- Track by user ID and IP address

### Cost Protection

- Set maximum token limits per request
- Alert on unusually high costs
- Implement budget caps per account

---

## Performance Considerations

### LLM Optimization

- Use appropriate model for task complexity
- Set reasonable temperature (0.6-0.8 for creativity)
- Limit max tokens to prevent runaway generation
- Implement streaming for long outputs (future)

### Caching Strategy

Story ideas can be cached temporarily:

```typescript
// Cache ideas for 5 minutes (user might regenerate)
const cacheKey = `story-ideas:${premise}:${genre}`;
await cache.set(cacheKey, ideas, { ttl: 300 });
```

Full stories should NOT be cached (always fresh generation).

### Timeout Handling

```typescript
const result = await Promise.race([
  executePrompt('story-generation', variables),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), 30000)
  ),
]);
```

---

## Future Enhancements

1. **Interactive Editing**
   - User feedback during generation
   - Iterative refinement
   - Branch alternate versions

2. **Style Transfer**
   - Generate in style of famous authors
   - Match existing IP style guides
   - User-defined writing styles

3. **Multi-Language Support**
   - Generate stories in multiple languages
   - Localize for different markets

4. **Collaborative Generation**
   - Multiple users suggest premises
   - Vote on story directions
   - Collaborative editing

5. **Story Analytics**
   - Track which premises perform best
   - Identify popular themes
   - Success rate by genre

---

## References

- **FILM-301**: Episode CRUD actions
- **FILM-304**: Prompt templates
- **@kit/llm**: LLM client abstraction
- **@kit/prompt-engine**: Prompt template engine
- **Constitution**: Section 2.2 (Server Actions Pattern)
- **Constitution**: Section 5 (Error Handling)
- **Anthropic Claude**: https://docs.anthropic.com/claude/docs
- **OpenAI GPT-4**: https://platform.openai.com/docs
