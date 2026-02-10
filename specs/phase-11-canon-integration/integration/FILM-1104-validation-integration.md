---
id: FILM-1104
title: Validation Integration at Generation Checkpoints
status: done
priority: high
effort: M
dependencies: [FILM-1003, FILM-1102]
---

# FILM-1104: Validation Integration at Generation Checkpoints

## Overview

Integrate the Continuity Validator into the story generation pipeline at three checkpoints: plot skeleton, scene blocks, and dialogue.

## Problem Statement

The Continuity Validator exists (`packages/features/episodes/src/lib/canon/continuity-validator.ts`) with 9 validation rules, but:
- It is never called during story generation
- Violations are not detected until manual review
- No blocking mechanism prevents generation of invalid content

## Solution

Add validation calls at three checkpoints in the generation pipeline, with configurable enforcement levels (strict = block, flexible = warn).

---

## Checkpoint Architecture

```
Story Ideation  ───► [CHECKPOINT 1: Plot Skeleton] ───►
                            │
                      VALIDATOR
                            │
Screenplay Gen  ───► [CHECKPOINT 2: Scene Blocks] ───►
                            │
                      VALIDATOR
                            │
Shot List Gen   ───► [CHECKPOINT 3: Dialogue] ───►
                            │
                      VALIDATOR
                            │
                       Final Output
```

---

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/lambda/llm-worker/handlers/story-generation.ts` | Add checkpoint 1 |
| `apps/web/lambda/llm-worker/handlers/screenplay-conversion.ts` | Add checkpoint 2 |
| `apps/web/lambda/llm-worker/handlers/shot-generation.ts` | Add checkpoint 3 |

## Files to Create

| File | Purpose |
|------|---------|
| `apps/web/lambda/llm-worker/utils/validation-checkpoint.ts` | Shared validation utility |

---

## Implementation

### Step 1: Create Shared Validation Utility

```typescript
// apps/web/lambda/llm-worker/utils/validation-checkpoint.ts

import type { SupabaseClient } from '@supabase/supabase-js';

interface ValidationCheckpointOptions {
  projectId: string;
  episodeNumber: number;
  content: unknown;
  checkpointType: 'plot_skeleton' | 'scene_blocks' | 'dialogue';
  enforcement: 'strict' | 'flexible';
}

interface ValidationResult {
  passed: boolean;
  violations: Array<{
    rule: string;
    severity: 'critical' | 'hard_fail' | 'soft_fail';
    message: string;
    suggestion?: string;
  }>;
  warnings: string[];
}

export async function runValidationCheckpoint(
  options: ValidationCheckpointOptions,
  supabase: SupabaseClient,
): Promise<ValidationResult> {
  const { 
    projectId, 
    episodeNumber, 
    content, 
    checkpointType,
    enforcement 
  } = options;
  
  // Import validator dynamically
  const { 
    buildMemoryContext, 
    createContinuityValidator 
  } = await import('@kit/episodes');
  
  // Build context for validation
  const context = await buildMemoryContext(projectId, episodeNumber);
  
  // Create validator instance
  const validator = createContinuityValidator(context);
  
  // Run appropriate validation based on checkpoint
  let result;
  switch (checkpointType) {
    case 'plot_skeleton':
      result = await validator.validatePlotSkeleton(content);
      break;
    case 'scene_blocks':
      result = await validator.validateSceneBlocks(content);
      break;
    case 'dialogue':
      result = await validator.validateDialogue(content);
      break;
  }
  
  // Filter violations by enforcement level
  const criticalViolations = result.violations.filter(
    v => v.severity === 'critical' || 
         (enforcement === 'strict' && v.severity === 'hard_fail')
  );
  
  const warnings = result.violations
    .filter(v => v.severity === 'soft_fail')
    .map(v => `${v.rule}: ${v.message}`);
  
  return {
    passed: criticalViolations.length === 0,
    violations: criticalViolations,
    warnings,
  };
}
```

### Step 2: Integrate Checkpoint 1 in Story Generation

```typescript
// In story-generation.ts, after LLM generates plot skeleton

// Validate plot skeleton before proceeding
if (canonSettings?.enabled) {
  const { runValidationCheckpoint } = await import('../utils/validation-checkpoint');
  
  const validation = await runValidationCheckpoint({
    projectId: data.projectId,
    episodeNumber: episodeContext.episodeNumber,
    content: result.data.story, // The generated story
    checkpointType: 'plot_skeleton',
    enforcement: canonSettings.enforcement ?? 'flexible',
  }, supabase);
  
  if (!validation.passed) {
    await markJobFailed(supabase, data.episodeId, 'story', 
      `Canon violation: ${validation.violations[0].message}`
    );
    throw new ContinuityViolationError(validation.violations);
  }
  
  // Log warnings for review
  if (validation.warnings.length > 0) {
    console.warn('[Story Generation] Canon warnings:', validation.warnings);
  }
}
```

### Step 3: Integrate Checkpoint 2 in Screenplay Conversion

```typescript
// In screenplay-conversion.ts, after scenes generated

if (canonSettings?.enabled) {
  const { runValidationCheckpoint } = await import('../utils/validation-checkpoint');
  
  const validation = await runValidationCheckpoint({
    projectId: data.projectId,
    episodeNumber: episodeContext.episodeNumber,
    content: result.data.scenes,
    checkpointType: 'scene_blocks',
    enforcement: canonSettings.enforcement ?? 'flexible',
  }, supabase);
  
  if (!validation.passed) {
    throw new ContinuityViolationError(validation.violations);
  }
}
```

### Step 4: Integrate Checkpoint 3 in Shot Generation

```typescript
// In shot-generation.ts, after dialogue generated

if (canonSettings?.enabled) {
  const { runValidationCheckpoint } = await import('../utils/validation-checkpoint');
  
  const validation = await runValidationCheckpoint({
    projectId: data.projectId,
    episodeNumber: episodeContext.episodeNumber,
    content: result.data.shots,
    checkpointType: 'dialogue',
    enforcement: canonSettings.enforcement ?? 'flexible',
  }, supabase);
  
  if (!validation.passed) {
    throw new ContinuityViolationError(validation.violations);
  }
}
```

---

## Enforcement Levels

| Level | CRITICAL | HARD_FAIL | SOFT_FAIL |
|-------|----------|-----------|-----------|
| **strict** | Block | Block | Warn |
| **flexible** | Block | Warn | Warn |

---

## Acceptance Criteria

- [x] `runValidationCheckpoint` utility created
- [x] Story generation runs checkpoint 1 when canon enabled
- [x] Screenplay conversion runs checkpoint 2 when canon enabled
- [x] Shot generation runs checkpoint 3 when canon enabled
- [x] CRITICAL violations always block generation
- [x] HARD_FAIL violations block in strict mode only
- [x] SOFT_FAIL violations logged as warnings
- [x] Validation failure updates job status correctly
- [x] Validation latency < 200ms per checkpoint

---

## Testing

### Unit Test

```typescript
describe('Validation Checkpoint', () => {
  it('should block on dead character resurrection', async () => {
    // Setup: Create immutable death event
    await client.from('immutable_events').insert({
      project_id: projectId,
      event_type: 'death',
      event_key: 'character:john:dead',
      description: 'John died',
      established_in: episode1Id,
      season: 1,
      episode_number: 1,
    });
    
    // Attempt to generate story with John alive
    const storyWithJohn = {
      fullText: 'John walked into the room...',
      characters: ['John'],
    };
    
    const validation = await runValidationCheckpoint({
      projectId,
      episodeNumber: 2,
      content: storyWithJohn,
      checkpointType: 'plot_skeleton',
      enforcement: 'strict',
    }, supabase);
    
    expect(validation.passed).toBe(false);
    expect(validation.violations[0].rule).toBe('CANON_001');
  });
});
```

### Integration Test

1. Create project with canon enabled (strict)
2. Add death event for character
3. Attempt story generation mentioning character
4. Verify generation fails with CANON_001 violation
5. Verify job status shows failure reason

---

## Estimated Effort

| Task | Time |
|------|------|
| Create validation-checkpoint.ts | 45 min |
| Integrate checkpoint 1 | 30 min |
| Integrate checkpoint 2 | 30 min |
| Integrate checkpoint 3 | 30 min |
| Testing | 1.5 hours |
| **Total** | **~4 hours** |

---

## Dependencies

- **FILM-1003**: Continuity Validator (✅ Complete)
- **FILM-1102**: Memory context injection

## Blocks

- None (enhances generation pipeline)

---

## Implementation Status

**Implemented** in PR #175 — merged 2026-02-09
