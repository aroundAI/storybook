---
id: FILM-1102
title: Memory Context Injection into Story Generation
status: done
priority: critical
effort: M
dependencies: [FILM-1004, FILM-1101]
---

# FILM-1102: Memory Context Injection into Story Generation

## Overview

Integrate the Memory Context Builder into the story generation Lambda handler so that LLM calls receive relevant historical context about the project's narrative state.

## Problem Statement

The story generation handler (`apps/web/lambda/llm-worker/handlers/story-generation.ts`) currently:
- Builds `episodeContext` from the current episode and project
- Does **NOT** call `buildMemoryContext()` 
- Does **NOT** inject immutable events, character states, or narrative threads
- LLM has no awareness of past episode canon

## Solution

Import and call `buildMemoryContextAction` at the start of story generation, then inject the formatted context into the prompt variables.

---

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/lambda/llm-worker/handlers/story-generation.ts` | Add memory context building and injection |
| `packages/features/episodes/src/server/canon-actions.ts` | Ensure `buildMemoryContextAction` is exported properly |

---

## Implementation

### Step 1: Import Memory Context Builder

```typescript
// In story-generation.ts
import { buildMemoryContext, formatContextForPrompt } from '@kit/episodes';
```

### Step 2: Build Context After Episode Fetch

```typescript
export async function processStoryGeneration(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<StoryGenerationResult> {
  const data = payload as StoryGenerationPayload;
  
  // ... existing episode fetch ...
  
  // NEW: Build memory context for canon awareness
  let memoryContext = null;
  try {
    memoryContext = await buildMemoryContext(
      data.projectId,
      episodeContext.episodeNumber,
      {
        maxTokenPercentage: 15,
        contextWindowSize: 40000,
        memoryHorizon: episodeContext.contentType === 'SERIES_HARD' ? 50 : 10,
        priority: 'balanced',
      }
    );
    console.log(`[Story Generation] Memory context built: ${memoryContext.tokenBudget.used} tokens`);
  } catch (err) {
    console.warn('[Story Generation] Memory context build failed, continuing without:', err);
    // Non-fatal - continue without canon context
  }
  
  // ... rest of function
}
```

### Step 3: Inject into Prompt Variables

```typescript
// In the variables object
const variables = {
  // ... existing variables ...
  
  // NEW: Canon context sections
  established_facts: memoryContext 
    ? formatContextForPrompt(memoryContext, 'immutable')
    : '',
  character_states: memoryContext
    ? formatContextForPrompt(memoryContext, 'characters')
    : '',
  active_threads: memoryContext
    ? formatContextForPrompt(memoryContext, 'threads')
    : '',
  recent_episodes: memoryContext
    ? formatContextForPrompt(memoryContext, 'summaries')
    : '',
  
  // Token budget info for LLM awareness
  memory_budget_used: memoryContext?.tokenBudget.used ?? 0,
  memory_budget_max: memoryContext?.tokenBudget.max ?? 0,
};
```

### Step 4: Update Story Generation Prompt Template

Add sections for canon context in `story-generation.json`:

```json
{
  "variables": {
    "established_facts": {
      "type": "string",
      "required": false,
      "default": ""
    },
    "character_states": {
      "type": "string",
      "required": false,
      "default": ""
    },
    "active_threads": {
      "type": "string",
      "required": false,
      "default": ""
    },
    "recent_episodes": {
      "type": "string",
      "required": false,
      "default": ""
    }
  }
}
```

Update system prompt to include:

```
{{#if established_facts}}
## ESTABLISHED FACTS (DO NOT CONTRADICT)
The following facts are PERMANENT and cannot be changed:
{{{established_facts}}}
{{/if}}

{{#if character_states}}
## CURRENT CHARACTER STATES
{{{character_states}}}
{{/if}}

{{#if active_threads}}
## ACTIVE PLOT THREADS
These threads are open and expecting progress or resolution:
{{{active_threads}}}
{{/if}}

{{#if recent_episodes}}
## RECENT EPISODE CONTEXT
{{{recent_episodes}}}
{{/if}}
```

---

## Acceptance Criteria

- [x] `buildMemoryContext` is called in story generation handler
- [x] Memory context is injected into prompt variables
- [x] Story generation prompt template includes canon sections
- [x] Token budget stays within 15% of context window
- [x] Build failure is non-fatal (graceful degradation)
- [x] Logs show memory context token usage
- [x] Generated stories reference established facts appropriately

---

## Testing

### Unit Test

```typescript
describe('Story Generation with Memory Context', () => {
  it('should inject memory context when available', async () => {
    const mockContext = {
      immutableEvents: [{ description: 'John died in battle' }],
      tokenBudget: { used: 500, max: 6000 },
    };
    
    // Mock buildMemoryContext
    vi.mock('@kit/episodes', () => ({
      buildMemoryContext: vi.fn().mockResolvedValue(mockContext),
      formatContextForPrompt: vi.fn().mockReturnValue('• John died in battle'),
    }));
    
    const result = await processStoryGeneration(mockPayload, mockSupabase);
    
    expect(buildMemoryContext).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
  
  it('should continue without context if build fails', async () => {
    vi.mock('@kit/episodes', () => ({
      buildMemoryContext: vi.fn().mockRejectedValue(new Error('DB error')),
    }));
    
    const result = await processStoryGeneration(mockPayload, mockSupabase);
    
    // Should still succeed
    expect(result.success).toBe(true);
  });
});
```

### Integration Test

1. Create project with Episode 1 story including a character death
2. Add immutable event for the death
3. Generate Episode 2 story
4. Verify Episode 2 story mentions the death or respects it

---

## Estimated Effort

| Task | Time |
|------|------|
| Import and integrate memory context | 30 min |
| Update prompt template | 20 min |
| Add formatContextForPrompt sections | 30 min |
| Testing | 1 hour |
| **Total** | **~2.5 hours** |

---

## Dependencies

- **FILM-1004**: Memory Context Builder (✅ Complete)
- **FILM-1101**: Canon prompts registered in Lambda

## Blocks

- **FILM-1103**: LLM extraction needs context available
- **FILM-1104**: Validation integration needs context

---

## Implementation Status

**Implemented** in PR #175 — merged 2026-02-09
