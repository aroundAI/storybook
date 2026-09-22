---
spec_id: FILM-408
status: 🗑️ RETIRED
audited: 2026-09-23
---

# FILM-408: Poll Video Status Action

> **🗑️ Retired (audit 2026-09-23).** `packages/features/video-generation/src/server/actions/poll-status-action.ts` was deleted in `5b88db3a` (2026-01-15), the commit that removed `packages/features/video-generation`; the owner retired in-app video generation on purpose. Nothing replaces it: no video job is started in the app, so there is nothing to poll. Kept as a record; not outstanding work.

**Status**: 🗑️ RETIRED (audit 2026-09-23; was ✅ DONE)
**Phase**: 4
**Priority**: P0
**Effort**: S (1-2 days)
**Dependencies**: FILM-405 (generate-video-action)
**Blocks**: FILM-411 (generation-progress)

---

## Context

Webhook delivery isn't guaranteed. The poll status action provides a fallback mechanism for clients to check video generation progress by directly querying the provider API. This ensures users can monitor generation status even if webhooks fail, and provides real-time progress updates in the UI.

---

## Requirements

### Functional Requirements

1. **Status Polling**
   - Query provider API for job status
   - Parse progress percentage
   - Return estimated time remaining
   - Update local database with latest status

2. **Fallback Handling**
   - Detect webhook failures (status not updated for >5 minutes)
   - Automatically poll provider when webhook stale
   - Update generation_jobs with polled data
   - Sync video URL when completed

3. **Client Updates**
   - Return current status to client
   - Include progress percentage
   - Calculate queue position if queued
   - Provide ETA for completion

---

## Interface

### TypeScript Types

```typescript
import { z } from 'zod';

export const PollVideoStatusSchema = z.object({
  generationJobId: z.string().uuid(),
});

export interface PollVideoStatusResponse {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
  estimatedTimeRemaining?: number;
  queuePosition?: number;
  lastUpdated: string;
}
```

### Server Action Implementation

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createVideoProvider } from '@kit/video-generation/providers';
import { logger } from '@kit/monitoring';

export const pollVideoStatusAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    // Get generation job
    const { data: job, error: jobError } = await client
      .from('generation_jobs')
      .select('*')
      .eq('id', data.generationJobId)
      .single();

    if (jobError || !job) {
      throw new Error('Generation job not found');
    }

    // If already completed or failed, return cached status
    if (job.status === 'completed' || job.status === 'failed') {
      return {
        status: job.status,
        progress: 100,
        videoUrl: job.output_data?.videoUrl,
        thumbnailUrl: job.output_data?.thumbnailUrl,
        errorMessage: job.error_message,
        lastUpdated: job.updated_at,
      };
    }

    // Check if webhook is stale (no update for >5 minutes)
    const lastUpdate = new Date(job.updated_at);
    const now = new Date();
    const minutesSinceUpdate =
      (now.getTime() - lastUpdate.getTime()) / 1000 / 60;

    // If recently updated, return cached status
    if (minutesSinceUpdate < 1) {
      return {
        status: job.status as any,
        progress: job.output_data?.progress,
        lastUpdated: job.updated_at,
      };
    }

    // Poll provider API
    try {
      const provider = await createVideoProvider({
        accountId: job.account_id,
        provider: job.provider!,
      });

      const providerStatus = await provider.getStatus(job.provider_job_id!);

      // Update local database
      const updates: any = {
        status: providerStatus.status,
        updated_at: new Date().toISOString(),
      };

      if (providerStatus.status === 'completed') {
        updates.output_data = {
          videoUrl: providerStatus.videoUrl,
          thumbnailUrl: providerStatus.thumbnailUrl,
        };
        updates.completed_at = new Date().toISOString();

        // Update shot
        await client
          .from('shots')
          .update({
            video_url: providerStatus.videoUrl,
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.reference_id);
      } else if (providerStatus.status === 'failed') {
        updates.error_message = providerStatus.errorMessage;
        updates.error_code = providerStatus.errorCode;
        updates.completed_at = new Date().toISOString();

        // Update shot
        await client
          .from('shots')
          .update({
            status: 'failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.reference_id);
      }

      await client
        .from('generation_jobs')
        .update(updates)
        .eq('id', job.id);

      logger.info('Generation status polled', {
        jobId: job.id,
        status: providerStatus.status,
        progress: providerStatus.progress,
      });

      return {
        status: providerStatus.status as any,
        progress: providerStatus.progress,
        videoUrl: providerStatus.videoUrl,
        thumbnailUrl: providerStatus.thumbnailUrl,
        errorMessage: providerStatus.errorMessage,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to poll generation status', {
        jobId: job.id,
        error: error instanceof Error ? error.message : 'Unknown',
      });

      // Return cached status on error
      return {
        status: job.status as any,
        progress: job.output_data?.progress,
        lastUpdated: job.updated_at,
      };
    }
  },
  { schema: PollVideoStatusSchema, auth: true }
);
```

---

## Implementation Details

### File Structure

```
packages/features/video-generation/src/
├── server/
│   ├── actions/
│   │   ├── poll-status-action.ts        # Poll action (CREATE THIS)
│   │   └── __tests__/
│   │       └── poll-status-action.test.ts
```

### Polling Strategy

**Smart Polling**:
- If updated <1 min ago: Return cached status
- If updated 1-5 min ago: Poll provider
- If updated >5 min ago: Poll provider + log webhook failure

**Rate Limiting**:
- Max 1 poll per job per minute
- Use caching to prevent excessive API calls

### Client Integration

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { pollVideoStatusAction } from '@kit/video-generation/server';

export function useVideoGenerationStatus(generationJobId: string) {
  return useQuery({
    queryKey: ['generation-status', generationJobId],
    queryFn: () => pollVideoStatusAction({ generationJobId }),
    refetchInterval: (data) => {
      // Stop polling when completed or failed
      if (data?.status === 'completed' || data?.status === 'failed') {
        return false;
      }
      // Poll every 5 seconds while processing
      return 5000;
    },
    enabled: !!generationJobId,
  });
}
```

---

## File Changes

### New Files

1. **packages/features/video-generation/src/server/actions/poll-status-action.ts**

### Modified Files

1. **packages/features/video-generation/src/server/index.ts** - Export action

---

## Acceptance Criteria

- [ ] Action queries provider API for status
- [ ] Action updates local database with latest status
- [ ] Action returns current status to client
- [ ] Action caches recent status (< 1 min)
- [ ] Action handles provider API errors gracefully
- [ ] Action updates shot when video completes
- [ ] Action works for all providers

---

## Test Plan

### Unit Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import { pollVideoStatusAction } from '../poll-status-action';

describe('pollVideoStatusAction', () => {
  it('should return cached status if recently updated', async () => {
    const result = await pollVideoStatusAction({
      generationJobId: 'job-recent',
    });

    expect(result.status).toBe('processing');
    // Should not call provider API
  });

  it('should poll provider if status stale', async () => {
    const result = await pollVideoStatusAction({
      generationJobId: 'job-stale',
    });

    expect(result.status).toBe('completed');
    expect(result.videoUrl).toBeDefined();
  });

  it('should handle provider API errors', async () => {
    const result = await pollVideoStatusAction({
      generationJobId: 'job-error',
    });

    // Should return cached status on error
    expect(result).toBeDefined();
  });
});
```

---

## Security Considerations

- Verify user has access to generation job
- Check RLS policies on generation_jobs table
- Rate limit polling per account
- Don't expose sensitive provider data

---

## Performance Considerations

- Cache status for 1 minute
- Use database indexes on generation_jobs
- Minimize provider API calls
- Batch status checks if polling multiple jobs

---

## Future Enhancements

1. **Batch Polling** - Poll multiple jobs at once
2. **WebSocket Support** - Real-time updates via WebSocket
3. **Smart Intervals** - Adjust poll interval based on ETA

---

## References

- **FILM-405**: Generate video action
- **FILM-401**: Kling provider
- **Constitution**: Section 2.2 (Server Actions)
