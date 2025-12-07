# Kling API Integration Guide

> **SPIKE-01 Deliverable**: Step-by-step guide for integrating Kling video generation into our platform.

## Overview

This guide covers the complete integration of Kling AI video generation via PiAPI into our application, including authentication, error handling, webhook setup, and best practices.

## Prerequisites

1. **PiAPI Account**: Sign up at https://app.piapi.ai/
2. **API Key**: Obtain from PiAPI workspace
3. **Webhook Endpoint**: Publicly accessible HTTPS endpoint
4. **Environment Variables**:

```bash
PIAPI_API_KEY=your_api_key_here
PIAPI_WEBHOOK_SECRET=your_webhook_secret
PIAPI_BASE_URL=https://api.piapi.ai/api/v1
```

---

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Our App       │────▶│   PiAPI Proxy   │────▶│   Kling AI      │
│   (Next.js)     │     │                 │     │   (Kuaishou)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        │                       │ Webhook callback
        ◀───────────────────────┘
```

### Flow

1. **Submit Task**: App sends video generation request to PiAPI
2. **Queue**: PiAPI queues the task and returns task_id
3. **Processing**: Kling AI generates the video (60-360 seconds)
4. **Webhook**: PiAPI sends completion notification to our webhook
5. **Retrieve**: App fetches video URL and updates database

---

## Implementation Steps

### Step 1: Create Provider Package

Create the video generation provider at `packages/video-generation/`:

```typescript
// packages/video-generation/src/providers/kling/client.ts
import { z } from 'zod';

const KlingConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().default('https://api.piapi.ai/api/v1'),
  webhookEndpoint: z.string().url().optional(),
  webhookSecret: z.string().optional(),
});

type KlingConfig = z.infer<typeof KlingConfigSchema>;

export class KlingClient {
  private config: KlingConfig;

  constructor(config: Partial<KlingConfig> = {}) {
    this.config = KlingConfigSchema.parse({
      apiKey: config.apiKey ?? process.env.PIAPI_API_KEY,
      baseUrl: config.baseUrl ?? process.env.PIAPI_BASE_URL,
      webhookEndpoint: config.webhookEndpoint ?? process.env.PIAPI_WEBHOOK_ENDPOINT,
      webhookSecret: config.webhookSecret ?? process.env.PIAPI_WEBHOOK_SECRET,
    });
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new KlingApiError(response.status, error.message ?? 'API request failed', error);
    }

    return response.json();
  }

  async createVideoTask(input: CreateVideoInput): Promise<CreateVideoResponse> {
    return this.request<CreateVideoResponse>('/task', {
      method: 'POST',
      body: JSON.stringify({
        model: 'kling',
        task_type: 'video_generation',
        input: {
          prompt: input.prompt,
          negative_prompt: input.negativePrompt,
          image_url: input.imageUrl,
          duration: input.duration,
          aspect_ratio: input.aspectRatio,
          mode: input.mode,
          version: input.version ?? '2.1',
          elements: input.elements,
          camera_control: input.cameraControl,
        },
        config: {
          service_mode: 'public',
          webhook_config: this.config.webhookEndpoint ? {
            endpoint: this.config.webhookEndpoint,
            secret: this.config.webhookSecret,
          } : undefined,
        },
      }),
    });
  }

  async getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    return this.request<TaskStatusResponse>(`/task/${taskId}`);
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.request('/task/cancel', {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId }),
    });
  }
}

export class KlingApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'KlingApiError';
  }
}
```

### Step 2: Define Types

```typescript
// packages/video-generation/src/providers/kling/types.ts

export type AspectRatio = '16:9' | '9:16' | '1:1';
export type VideoMode = 'std' | 'pro';
export type VideoDuration = 5 | 10;
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type KlingVersion = '1.5' | '1.6' | '2.0' | '2.1' | '2.1-master' | '2.5';

export interface CameraControl {
  type: 'simple';
  config: {
    horizontal?: number; // -10 to 10
    vertical?: number;   // -10 to 10
    pan?: number;        // -10 to 10
    tilt?: number;       // -10 to 10
    roll?: number;       // -10 to 10
    zoom?: number;       // -10 to 10
  };
}

export interface ElementReference {
  image_url: string;
}

export interface CreateVideoInput {
  prompt: string;
  negativePrompt?: string;
  imageUrl?: string;
  duration: VideoDuration;
  aspectRatio: AspectRatio;
  mode: VideoMode;
  version?: KlingVersion;
  elements?: ElementReference[];
  cameraControl?: CameraControl;
}

export interface CreateVideoResponse {
  code: number;
  data: {
    task_id: string;
    model: string;
    task_type: string;
    status: TaskStatus;
  };
  message: string;
}

export interface TaskStatusResponse {
  code: number;
  data: {
    task_id: string;
    model: string;
    task_type: string;
    status: TaskStatus;
    input: Record<string, unknown>;
    output: {
      video_url?: string;
      video_url_no_watermark?: string;
      thumbnail_url?: string;
    };
    meta: {
      created_at: string;
      started_at?: string;
      ended_at?: string;
      usage?: {
        type: string;
        frozen: number;
        consume: number;
      };
    };
    error: {
      code: number;
      message: string;
      raw_message?: string;
      detail?: unknown;
    };
  };
  message: string;
}

export interface WebhookPayload {
  timestamp: number;
  data: TaskStatusResponse['data'];
}
```

### Step 3: Implement Webhook Handler

```typescript
// apps/web/app/api/webhooks/kling/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { WebhookPayload } from '@kit/video-generation/webhooks/types';

export async function POST(request: NextRequest) {
  try {
    // 1. Verify webhook secret
    const headersList = await headers();
    const webhookSecret = headersList.get('x-webhook-secret');

    if (webhookSecret !== process.env.PIAPI_WEBHOOK_SECRET) {
      console.error('Invalid webhook secret');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse payload
    const payload: WebhookPayload = await request.json();
    const { task_id, status, output, error } = payload.data;

    // 3. Respond immediately (before processing)
    // PiAPI expects quick response to avoid retries
    const response = NextResponse.json({ received: true });

    // 4. Process asynchronously
    void processKlingWebhook(payload);

    return response;
  } catch (err) {
    console.error('Webhook processing error:', err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

async function processKlingWebhook(payload: WebhookPayload) {
  const { task_id, status, output, error } = payload.data;
  const client = getSupabaseServerClient();

  try {
    // Find the generation job by external task ID
    const { data: job, error: fetchError } = await client
      .from('generation_jobs')
      .select('id, shot_id, account_id')
      .eq('external_task_id', task_id)
      .single();

    if (fetchError || !job) {
      console.error(`Job not found for task: ${task_id}`);
      return;
    }

    if (status === 'completed' && output?.video_url) {
      // Update job with success
      await client
        .from('generation_jobs')
        .update({
          status: 'completed',
          output_url: output.video_url,
          output_url_no_watermark: output.video_url_no_watermark,
          thumbnail_url: output.thumbnail_url,
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      // Update shot with video URL
      await client
        .from('shots')
        .update({
          video_url: output.video_url,
          thumbnail_url: output.thumbnail_url,
          status: 'generated',
        })
        .eq('id', job.shot_id);

      // Notify user (optional)
      await notifyUserOfCompletion(job.account_id, job.shot_id);

    } else if (status === 'failed') {
      // Update job with failure
      await client
        .from('generation_jobs')
        .update({
          status: 'failed',
          error_code: error?.code?.toString(),
          error_message: error?.message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      // Update shot status
      await client
        .from('shots')
        .update({ status: 'failed' })
        .eq('id', job.shot_id);

      // Notify user of failure
      await notifyUserOfFailure(job.account_id, job.shot_id, error?.message);
    }
  } catch (err) {
    console.error('Error processing webhook:', err);
  }
}

async function notifyUserOfCompletion(accountId: string, shotId: string) {
  // Implement notification logic (email, push, in-app)
}

async function notifyUserOfFailure(accountId: string, shotId: string, errorMessage?: string) {
  // Implement failure notification logic
}
```

### Step 4: Create Server Actions

```typescript
// packages/features/video-generation/src/server/actions.ts
'use server';

import { z } from 'zod';
import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { KlingClient } from '@kit/video-generation/providers';

const GenerateVideoSchema = z.object({
  shotId: z.string().uuid(),
  prompt: z.string().min(1).max(1000),
  negativePrompt: z.string().optional(),
  imageUrl: z.string().url().optional(),
  duration: z.enum(['5', '10']).transform(Number) as z.ZodEffects<z.ZodEnum<['5', '10']>, 5 | 10>,
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  mode: z.enum(['std', 'pro']),
  elements: z.array(z.object({ image_url: z.string().url() })).max(4).optional(),
});

export const generateVideoAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();
    const kling = new KlingClient();

    // 1. Verify shot belongs to user's account
    const { data: shot, error: shotError } = await client
      .from('shots')
      .select('id, episode_id, episodes(project_id, projects(account_id))')
      .eq('id', data.shotId)
      .single();

    if (shotError || !shot) {
      throw new Error('Shot not found');
    }

    // 2. Create generation job record
    const { data: job, error: jobError } = await client
      .from('generation_jobs')
      .insert({
        shot_id: data.shotId,
        provider: 'kling',
        status: 'pending',
        input_prompt: data.prompt,
        input_params: {
          duration: data.duration,
          aspectRatio: data.aspectRatio,
          mode: data.mode,
          elements: data.elements,
        },
      })
      .select()
      .single();

    if (jobError || !job) {
      throw new Error('Failed to create generation job');
    }

    try {
      // 3. Submit to Kling API
      const response = await kling.createVideoTask({
        prompt: data.prompt,
        negativePrompt: data.negativePrompt,
        imageUrl: data.imageUrl,
        duration: data.duration,
        aspectRatio: data.aspectRatio,
        mode: data.mode,
        elements: data.elements,
      });

      // 4. Update job with external task ID
      await client
        .from('generation_jobs')
        .update({
          external_task_id: response.data.task_id,
          status: 'processing',
          started_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      // 5. Update shot status
      await client
        .from('shots')
        .update({ status: 'generating' })
        .eq('id', data.shotId);

      return {
        success: true,
        jobId: job.id,
        taskId: response.data.task_id,
      };
    } catch (error) {
      // Update job with error
      await client
        .from('generation_jobs')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('id', job.id);

      throw error;
    }
  },
  {
    auth: true,
    schema: GenerateVideoSchema,
  },
);
```

### Step 5: Implement Polling Fallback

For cases where webhooks fail, implement a polling mechanism:

```typescript
// packages/video-generation/src/providers/kling/polling.ts
import { KlingClient, TaskStatus } from './client';

interface PollOptions {
  maxAttempts?: number;
  intervalMs?: number;
  onProgress?: (status: TaskStatus) => void;
}

export async function pollUntilComplete(
  client: KlingClient,
  taskId: string,
  options: PollOptions = {},
): Promise<string> {
  const {
    maxAttempts = 120,  // 10 minutes at 5s intervals
    intervalMs = 5000,
    onProgress,
  } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await client.getTaskStatus(taskId);
    const { status, output, error } = response.data;

    onProgress?.(status);

    if (status === 'completed') {
      if (!output?.video_url) {
        throw new Error('Video completed but no URL returned');
      }
      return output.video_url;
    }

    if (status === 'failed') {
      throw new Error(`Generation failed: ${error?.message ?? 'Unknown error'}`);
    }

    // Wait before next poll
    await sleep(intervalMs);
  }

  throw new Error(`Polling timeout: task ${taskId} did not complete in time`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Error Handling Strategy

### Retry Logic

```typescript
// packages/video-generation/src/providers/kling/retry.ts

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, retryableStatuses } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      const isRetryable = error instanceof KlingApiError &&
        retryableStatuses.includes(error.statusCode);

      if (!isRetryable || attempt === maxRetries) {
        throw lastError;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        maxDelayMs,
      );

      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastError;
}
```

### Content Moderation Handling

```typescript
// packages/video-generation/src/utils/prompt-sanitizer.ts

const BANNED_WORDS = ['chest', 'pig', 'exorcism', 'filthy'];

const WORD_REPLACEMENTS: Record<string, string> = {
  'pig': 'piglet',
  'filthy': 'unclean',
  'chest': 'torso',
};

export function sanitizePrompt(prompt: string): string {
  let sanitized = prompt;

  for (const [banned, replacement] of Object.entries(WORD_REPLACEMENTS)) {
    const regex = new RegExp(`\\b${banned}\\b`, 'gi');
    sanitized = sanitized.replace(regex, replacement);
  }

  return sanitized;
}

export function checkForBannedWords(prompt: string): string[] {
  const found: string[] = [];
  const lowerPrompt = prompt.toLowerCase();

  for (const word of BANNED_WORDS) {
    if (lowerPrompt.includes(word)) {
      found.push(word);
    }
  }

  return found;
}
```

---

## Cost Tracking

```typescript
// packages/video-generation/src/utils/cost-calculator.ts

interface CostConfig {
  version: string;
  mode: 'std' | 'pro';
  duration: 5 | 10;
}

const PRICING: Record<string, Record<string, number>> = {
  '2.5': {
    'pro-5': 0.33,
    'pro-10': 0.66,
  },
  '2.1-master': {
    'pro-5': 0.96,
    'pro-10': 1.92,
  },
  '2.0': {
    'pro-5': 0.96,
    'pro-10': 1.92,
  },
  // Standard pricing for 1.5, 1.6, 2.1
  'default': {
    'std-5': 0.35,
    'std-10': 0.70,
    'pro-5': 0.70,
    'pro-10': 1.40,
  },
};

export function calculateCost(config: CostConfig): number {
  const key = `${config.mode}-${config.duration}`;

  const versionPricing = PRICING[config.version] ?? PRICING['default'];
  return versionPricing[key] ?? PRICING['default'][key] ?? 0;
}

export function estimateBatchCost(configs: CostConfig[]): number {
  return configs.reduce((total, config) => total + calculateCost(config), 0);
}
```

---

## Testing

### Integration Test Setup

```typescript
// packages/video-generation/tests/kling-api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KlingClient } from '../src/providers/kling/client';

describe('KlingClient', () => {
  let client: KlingClient;

  beforeEach(() => {
    client = new KlingClient({
      apiKey: 'test-api-key',
      baseUrl: 'https://api.piapi.ai/api/v1',
    });
  });

  describe('createVideoTask', () => {
    it('should create a text-to-video task', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          code: 200,
          data: {
            task_id: 'test-task-123',
            status: 'pending',
          },
          message: 'success',
        }),
      });
      global.fetch = mockFetch;

      const result = await client.createVideoTask({
        prompt: 'A cat playing piano',
        duration: 5,
        aspectRatio: '16:9',
        mode: 'std',
      });

      expect(result.data.task_id).toBe('test-task-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.piapi.ai/api/v1/task',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-API-Key': 'test-api-key',
          }),
        }),
      );
    });

    it('should handle rate limit errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({
          message: 'Rate limit exceeded',
        }),
      });

      await expect(
        client.createVideoTask({
          prompt: 'Test',
          duration: 5,
          aspectRatio: '16:9',
          mode: 'std',
        }),
      ).rejects.toThrow('Rate limit exceeded');
    });
  });
});
```

### Webhook Test

```typescript
// apps/web/app/api/webhooks/kling/__tests__/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';
import { NextRequest } from 'next/server';

describe('Kling Webhook Handler', () => {
  it('should reject requests without valid secret', async () => {
    const request = new NextRequest('http://localhost/api/webhooks/kling', {
      method: 'POST',
      headers: {
        'x-webhook-secret': 'invalid-secret',
      },
      body: JSON.stringify({ timestamp: Date.now(), data: {} }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('should accept valid webhook and return quickly', async () => {
    process.env.PIAPI_WEBHOOK_SECRET = 'valid-secret';

    const request = new NextRequest('http://localhost/api/webhooks/kling', {
      method: 'POST',
      headers: {
        'x-webhook-secret': 'valid-secret',
      },
      body: JSON.stringify({
        timestamp: Date.now(),
        data: {
          task_id: 'test-123',
          status: 'completed',
          output: { video_url: 'https://example.com/video.mp4' },
        },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });
});
```

---

## Deployment Checklist

### Environment Variables

```bash
# Required
PIAPI_API_KEY=pk_live_xxxxx
PIAPI_WEBHOOK_SECRET=whsec_xxxxx

# Optional
PIAPI_BASE_URL=https://api.piapi.ai/api/v1
PIAPI_WEBHOOK_ENDPOINT=https://your-app.com/api/webhooks/kling
```

### Webhook Endpoint Setup

1. Deploy your application with the webhook route
2. Ensure HTTPS is enabled (required for webhooks)
3. Verify endpoint is accessible from Cloudflare workers
4. Test with webhook.site before production

### Monitoring

1. Set up alerts for webhook failures
2. Monitor API error rates
3. Track generation times and costs
4. Log all webhook payloads for debugging

---

## References

- [Kling API Reference](./kling-api-reference.md)
- [Character Consistency Guide](./character-prompt-guide.md)
- [PiAPI Documentation](https://piapi.ai/docs/kling-api/create-task)
