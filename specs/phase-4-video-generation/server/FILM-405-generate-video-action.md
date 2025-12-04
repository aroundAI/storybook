# FILM-405: Generate Video Server Action

**Phase**: 4
**Priority**: P0
**Effort**: L (5-6 days)
**Dependencies**: FILM-401 (kling-provider), FILM-404 (job-queue), FILM-412 (cost-tracking)
**Blocks**: FILM-406 (batch-generate-action), FILM-409 (visual-studio)

---

## Context

The generateVideoAction server action is the primary entry point for video generation requests. It orchestrates the entire generation flow: validates inputs, checks budget, estimates costs, creates generation job records, submits to the provider via the job queue, and returns status information to the client.

---

## Requirements

### Functional Requirements

1. **Input Validation**
   - Validate shot ID and prompt
   - Verify project access
   - Check shot doesn't already have video
   - Validate generation parameters

2. **Budget Validation**
   - Estimate generation cost
   - Check account budget
   - Reserve budget for generation
   - Block if insufficient budget

3. **Job Creation**
   - Create generation_jobs record
   - Generate idempotency key
   - Set initial status to 'queued'
   - Link to shot and project

4. **Provider Submission**
   - Add job to queue
   - Submit to provider via factory
   - Store provider job ID
   - Update shot status

### Non-Functional Requirements

- Complete within 3 seconds
- Idempotent (duplicate requests don't create multiple jobs)
- Atomic transaction (all-or-nothing)
- Comprehensive error messages

---

## Interface

### TypeScript Types

```typescript
import { z } from 'zod';

export const GenerateVideoSchema = z.object({
  shotId: z.string().uuid(),
  provider: z.enum(['kling', 'runway', 'luma']).optional(),
  mode: z.enum(['std', 'pro']).optional().default('std'),
  referenceImageUrl: z.string().url().optional(),
});

export interface GenerateVideoResponse {
  success: boolean;
  generationJobId: string;
  estimatedCostCents: number;
  estimatedTime: number;
  queuePosition?: number;
  message?: string;
}
```

### Server Action Implementation

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createVideoProvider } from '@kit/video-generation/providers';
import { addVideoGenerationJob } from '@kit/video-generation/queue';
import { checkAndReserveBudget, recordJobCost } from '@kit/video-generation/lib/cost-tracking';
import { v4 as uuidv4 } from 'uuid';

export const generateVideoAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    // Get shot details
    const { data: shot, error: shotError } = await client
      .from('shots')
      .select('*, episodes!inner(project_id)')
      .eq('id', data.shotId)
      .single();

    if (shotError || !shot) {
      throw new Error('Shot not found');
    }

    // Check if shot already has video
    if (shot.video_url) {
      throw new Error('Shot already has generated video');
    }

    // Get account ID from project
    const { data: project } = await client
      .from('projects')
      .select('account_id')
      .eq('id', shot.episodes.project_id)
      .single();

    if (!project) {
      throw new Error('Project not found');
    }

    const accountId = project.account_id;

    // Determine provider
    const provider = data.provider || 'kling';

    // Estimate cost
    const videoProvider = await createVideoProvider({
      accountId,
      provider,
    });

    const estimatedCostCents = videoProvider.estimateCost({
      prompt: shot.prompt,
      duration: shot.duration.toString(),
      aspectRatio: shot.aspect_ratio,
      mode: data.mode,
    });

    // Check and reserve budget
    const budgetCheck = await checkAndReserveBudget(
      accountId,
      estimatedCostCents
    );

    if (!budgetCheck.allowed) {
      throw new Error(
        `Insufficient budget. Required: $${(estimatedCostCents / 100).toFixed(2)}, Available: $${(budgetCheck.remaining / 100).toFixed(2)}`
      );
    }

    // Create generation job record
    const generationJobId = uuidv4();
    const idempotencyKey = `${shot.id}-${Date.now()}`;

    const { error: jobError } = await client
      .from('generation_jobs')
      .insert({
        id: generationJobId,
        idempotency_key: idempotencyKey,
        account_id: accountId,
        project_id: shot.episodes.project_id,
        job_type: 'video',
        reference_type: 'shot',
        reference_id: shot.id,
        provider,
        status: 'queued',
        input_data: {
          prompt: shot.prompt,
          duration: shot.duration,
          aspectRatio: shot.aspect_ratio,
          mode: data.mode,
          referenceImageUrl: data.referenceImageUrl,
        },
        estimated_cost_cents: estimatedCostCents,
      });

    if (jobError) {
      throw jobError;
    }

    // Add to queue
    await addVideoGenerationJob({
      accountId,
      projectId: shot.episodes.project_id,
      shotId: shot.id,
      provider,
      generationJobId,
      prompt: shot.prompt,
      duration: shot.duration.toString(),
      aspectRatio: shot.aspect_ratio,
      mode: data.mode,
      referenceImageUrl: data.referenceImageUrl,
      priority: 5,
    });

    return {
      success: true,
      generationJobId,
      estimatedCostCents,
      estimatedTime: shot.duration === 5 ? 180 : 300,
      message: 'Video generation started',
    };
  },
  { schema: GenerateVideoSchema, auth: true }
);
```

---

## Implementation Details

### File Structure

```
packages/features/video-generation/src/
├── server/
│   ├── actions/
│   │   ├── generate-video-action.ts     # Main action (CREATE THIS)
│   │   └── __tests__/
│   │       └── generate-video-action.test.ts
│   └── index.ts                         # Export actions (UPDATE THIS)
```

### Transaction Flow

```
1. Validate shot exists and has no video
2. Get account ID from project
3. Estimate cost
4. Check budget → Reserve budget
5. Create generation_jobs record
6. Add to queue
7. Return success
```

### Idempotency

Use combination of shot ID + timestamp as idempotency key:
```typescript
const idempotencyKey = `${shotId}-${Date.now()}`;
```

Prevent duplicate submissions within 5 minutes using unique constraint.

---

## File Changes

### New Files

1. **packages/features/video-generation/src/server/actions/generate-video-action.ts**

### Modified Files

1. **packages/features/video-generation/src/server/index.ts** - Export action

---

## Acceptance Criteria

- [ ] Action validates shot exists
- [ ] Action checks budget before generation
- [ ] Action reserves budget atomically
- [ ] Action creates generation_jobs record
- [ ] Action adds job to queue
- [ ] Action returns generation job ID
- [ ] Action rejects duplicate submissions
- [ ] Action enforces authentication

---

## Test Plan

### Unit Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import { generateVideoAction } from '../generate-video-action';

describe('generateVideoAction', () => {
  it('should generate video for valid shot', async () => {
    const result = await generateVideoAction({
      shotId: 'shot-123',
    });

    expect(result.success).toBe(true);
    expect(result.generationJobId).toBeDefined();
  });

  it('should reject shot that already has video', async () => {
    await expect(
      generateVideoAction({ shotId: 'shot-with-video' })
    ).rejects.toThrow('already has generated video');
  });

  it('should check budget before generation', async () => {
    await expect(
      generateVideoAction({ shotId: 'shot-no-budget' })
    ).rejects.toThrow('Insufficient budget');
  });
});
```

---

## Security Considerations

- Verify user has access to project
- Validate all inputs with Zod
- Check RLS policies enforce access
- Don't expose sensitive cost data

---

## Error Handling

| Error | Code | Message |
|-------|------|---------|
| Shot not found | NOT_FOUND | "Shot not found" |
| Already has video | CONFLICT | "Shot already has generated video" |
| Insufficient budget | PAYMENT_REQUIRED | "Insufficient budget" |
| Provider unavailable | SERVICE_UNAVAILABLE | "Provider temporarily unavailable" |

---

## Performance Considerations

- Cache provider instances
- Use database indexes on shots table
- Batch budget checks if possible

---

## Future Enhancements

1. **Advanced Options** - Expose seed, negative prompt
2. **Video Variants** - Generate multiple versions
3. **Smart Queuing** - Prioritize based on user tier

---

## References

- **FILM-401**: Kling provider
- **FILM-404**: Job queue
- **FILM-412**: Cost tracking
- **Constitution**: Section 2.2 (Server Actions)
