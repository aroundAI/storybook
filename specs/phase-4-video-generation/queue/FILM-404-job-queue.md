# FILM-404: Video Generation Job Queue

**Phase**: 4
**Priority**: P0
**Effort**: L (5-7 days)
**Dependencies**: FILM-403 (rate-limiter)
**Blocks**: FILM-405 (generate-video-action)

---

## Context

Video generation is an asynchronous, long-running process requiring robust job queue management. The job queue uses BullMQ (Redis-based queue) to manage video generation jobs with priorities, retries, concurrency limits, and dead letter queue handling. The queue must coordinate with the rate limiter, track job progress, and handle webhook-based status updates.

---

## Requirements

### Functional Requirements

1. **Job Queue Management**
   - Add jobs to queue with priority
   - Process jobs FIFO within priority levels
   - Support job cancellation
   - Track job lifecycle (queued → processing → completed/failed)

2. **Concurrency Control**
   - Limit concurrent jobs per provider
   - Prevent overwhelming provider APIs
   - Balance load across multiple workers

3. **Retry Logic**
   - Retry failed jobs with exponential backoff
   - Max 3 retries per job
   - Move to dead letter queue after max retries

4. **Job Prioritization**
   - Support priority levels (high, normal, low)
   - Process high priority jobs first
   - Prevent starvation of low priority jobs

### Non-Functional Requirements

- Jobs must persist across application restarts
- Support distributed workers
- Complete within provider timeout limits
- Log all job state transitions
- Metrics for queue depth and processing time

---

## Interface

### TypeScript Types

```typescript
import { z } from 'zod';
import { Queue, Worker, Job } from 'bullmq';

export interface VideoGenerationJobData {
  accountId: string;
  projectId: string;
  shotId: string;
  provider: string;
  generationJobId: string;
  prompt: string;
  duration: string;
  aspectRatio: string;
  mode?: string;
  referenceImageUrl?: string;
  priority: number;
}

export interface VideoGenerationJobResult {
  success: boolean;
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
  errorCode?: string;
  providerJobId?: string;
}

export const VideoGenerationJobSchema = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid(),
  shotId: z.string().uuid(),
  provider: z.string(),
  generationJobId: z.string().uuid(),
  prompt: z.string(),
  duration: z.string(),
  aspectRatio: z.string(),
  mode: z.string().optional(),
  referenceImageUrl: z.string().url().optional(),
  priority: z.number().int().min(0).max(10).default(5),
});
```

### Queue Implementation

```typescript
import { Queue, Worker, Job } from 'bullmq';
import { createVideoProvider } from '@kit/video-generation/providers';
import { checkRateLimit } from '@kit/video-generation/lib/rate-limiter';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { logger } from '@kit/monitoring';

// Queue configuration
const QUEUE_NAME = 'video-generation';
const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
};

// Concurrency limits per provider
const CONCURRENCY_LIMITS = {
  kling: 5,
  runway: 3,
  luma: 3,
};

// Initialize queue
export const videoGenerationQueue = new Queue<VideoGenerationJobData>(
  QUEUE_NAME,
  {
    connection: REDIS_CONNECTION,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30000, // Start with 30s
      },
      removeOnComplete: {
        age: 24 * 60 * 60, // Keep completed jobs for 24 hours
        count: 1000,
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60, // Keep failed jobs for 7 days
      },
    },
  }
);

// Add job to queue
export async function addVideoGenerationJob(
  data: VideoGenerationJobData
): Promise<Job<VideoGenerationJobData>> {
  const validated = VideoGenerationJobSchema.parse(data);

  const job = await videoGenerationQueue.add(
    'generate-video',
    validated,
    {
      priority: 10 - validated.priority, // BullMQ: lower number = higher priority
      jobId: validated.generationJobId, // Use generation job ID as queue job ID
    }
  );

  logger.info('Video generation job added to queue', {
    jobId: job.id,
    accountId: validated.accountId,
    provider: validated.provider,
  });

  return job;
}

// Initialize worker
export function createVideoGenerationWorker() {
  const worker = new Worker<VideoGenerationJobData, VideoGenerationJobResult>(
    QUEUE_NAME,
    async (job) => {
      return await processVideoGenerationJob(job);
    },
    {
      connection: REDIS_CONNECTION,
      concurrency: 10, // Total concurrent jobs
      limiter: {
        max: 10,
        duration: 1000, // Process max 10 jobs per second
      },
    }
  );

  // Event handlers
  worker.on('completed', (job, result) => {
    logger.info('Video generation job completed', {
      jobId: job.id,
      accountId: job.data.accountId,
      success: result.success,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error('Video generation job failed', {
      jobId: job?.id,
      accountId: job?.data.accountId,
      error: error.message,
      attempts: job?.attemptsMade,
    });
  });

  worker.on('error', (error) => {
    logger.error('Worker error', { error });
  });

  return worker;
}

// Process individual job
async function processVideoGenerationJob(
  job: Job<VideoGenerationJobData>
): Promise<VideoGenerationJobResult> {
  const { accountId, projectId, shotId, provider, generationJobId, ...request } =
    job.data;

  logger.info('Processing video generation job', {
    jobId: job.id,
    accountId,
    provider,
    attempt: job.attemptsMade + 1,
  });

  const client = getSupabaseServerClient();

  try {
    // Update job status to processing
    await client
      .from('generation_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
      })
      .eq('id', generationJobId);

    // Check rate limit
    const rateLimitResult = await checkRateLimit(accountId, provider);
    if (!rateLimitResult.allowed) {
      throw new Error(
        `Rate limit exceeded. Retry after ${rateLimitResult.retryAfter}s`
      );
    }

    // Create provider instance
    const videoProvider = await createVideoProvider({
      accountId,
      provider: provider as any,
    });

    // Submit generation request
    const generation = request.referenceImageUrl
      ? await videoProvider.generateVideoWithImage(request as any)
      : await videoProvider.generateVideo(request as any);

    // Update generation job with provider job ID
    await client
      .from('generation_jobs')
      .update({
        provider_job_id: generation.providerJobId,
      })
      .eq('id', generationJobId);

    // Update shot status
    await client
      .from('shots')
      .update({
        status: 'generating',
        updated_at: new Date().toISOString(),
      })
      .eq('id', shotId);

    logger.info('Video generation submitted to provider', {
      jobId: job.id,
      providerJobId: generation.providerJobId,
      provider,
    });

    // Job will be completed via webhook
    // Return success for now
    return {
      success: true,
      providerJobId: generation.providerJobId,
    };
  } catch (error) {
    logger.error('Video generation job error', {
      jobId: job.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    // Update generation job status
    await client
      .from('generation_jobs')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        retry_count: job.attemptsMade + 1,
      })
      .eq('id', generationJobId);

    throw error; // Re-throw to trigger retry
  }
}

// Get job status
export async function getJobStatus(
  jobId: string
): Promise<'queued' | 'processing' | 'completed' | 'failed' | 'unknown'> {
  const job = await videoGenerationQueue.getJob(jobId);
  if (!job) return 'unknown';

  const state = await job.getState();

  switch (state) {
    case 'waiting':
    case 'delayed':
      return 'queued';
    case 'active':
      return 'processing';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

// Cancel job
export async function cancelVideoGenerationJob(jobId: string): Promise<void> {
  const job = await videoGenerationQueue.getJob(jobId);
  if (!job) {
    throw new Error('Job not found');
  }

  await job.remove();

  logger.info('Video generation job cancelled', { jobId });
}

// Get queue metrics
export async function getQueueMetrics() {
  const waiting = await videoGenerationQueue.getWaitingCount();
  const active = await videoGenerationQueue.getActiveCount();
  const completed = await videoGenerationQueue.getCompletedCount();
  const failed = await videoGenerationQueue.getFailedCount();

  return {
    waiting,
    active,
    completed,
    failed,
    total: waiting + active,
  };
}
```

---

## Implementation Details

### File Structure

```
packages/features/video-generation/src/
├── queue/
│   ├── video-generation-queue.ts    # Queue setup (CREATE THIS)
│   ├── worker.ts                     # Worker implementation (CREATE THIS)
│   ├── processor.ts                  # Job processor (CREATE THIS)
│   └── __tests__/
│       └── queue.test.ts             # Unit tests (CREATE THIS)
```

### BullMQ Architecture

```
┌─────────────┐
│   Client    │
│ (Add Jobs)  │
└──────┬──────┘
       │
       v
┌─────────────┐
│    Redis    │
│   (Queue)   │
└──────┬──────┘
       │
       v
┌─────────────┐
│   Worker    │
│ (Process)   │
└──────┬──────┘
       │
       v
┌─────────────┐
│  Provider   │
│    API      │
└─────────────┘
```

### Job Lifecycle

```
queued → processing → [webhook] → completed
   ↓                                  ↑
   └──────────→ failed ──retry───────┘
                  ↓
           [max retries]
                  ↓
            dead_letter
```

### Retry Strategy

```typescript
{
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 30000, // 30s, 60s, 120s
  }
}
```

---

## File Changes

### New Files

1. **packages/features/video-generation/src/queue/video-generation-queue.ts**
2. **packages/features/video-generation/src/queue/worker.ts**
3. **packages/features/video-generation/src/queue/processor.ts**
4. **packages/features/video-generation/src/queue/__tests__/queue.test.ts**

---

## Acceptance Criteria

- [x] Jobs added to queue successfully
- [x] Worker processes jobs in priority order
- [x] Retry logic works with exponential backoff
- [x] Dead letter queue captures max-retry failures
- [x] Rate limiter prevents over-requests
- [x] Concurrent jobs respect provider limits
- [x] Job cancellation works
- [x] Queue metrics accurate

---

## Test Plan

### Unit Tests

```typescript
import { describe, it, expect } from 'vitest';
import { addVideoGenerationJob, getJobStatus } from '../video-generation-queue';

describe('Video Generation Queue', () => {
  it('should add job to queue', async () => {
    const job = await addVideoGenerationJob({
      accountId: 'account-123',
      projectId: 'project-123',
      shotId: 'shot-123',
      provider: 'kling',
      generationJobId: 'job-123',
      prompt: 'Test video',
      duration: '5',
      aspectRatio: '16:9',
      priority: 5,
    });

    expect(job.id).toBeDefined();
  });

  it('should process job', async () => {
    // Test job processing
  });
});
```

---

## Security Considerations

- Validate all job data before processing
- Authenticate worker connections to Redis
- Encrypt sensitive data in job payloads
- Rate limit job submissions per account

---

## Performance Considerations

- Use Redis Cluster for high throughput
- Adjust concurrency based on system load
- Monitor queue depth and processing time
- Implement circuit breakers for provider failures

---

## Future Enhancements

1. **Priority Queue Optimization** - Prevent starvation
2. **Job Batching** - Submit multiple videos at once
3. **Smart Retry** - Skip retry for certain errors
4. **Queue Analytics** - Track job processing metrics

---

## References

- **BullMQ Documentation**: https://docs.bullmq.io/
- **FILM-403**: Rate limiter
- **Constitution**: Section 5.2 (Generation Job Errors)
