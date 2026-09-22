---
spec_id: FILM-401
status: 🗑️ RETIRED
audited: 2026-09-23
---

# FILM-401: Kling Video Generation Provider

> **🗑️ Retired (audit 2026-09-23).** The Kling provider (`packages/features/video-generation/src/providers/kling.ts`) was deleted in `5b88db3a` (2026-01-15), the commit that removed `packages/features/video-generation`; the owner retired in-app video generation on purpose. Nothing replaces it: the Visual Studio writes VEO 3.1 prompts and each shot's video, generated outside the app, is uploaded with `VideoUploader` (`packages/features/episodes/src/components/video-uploader.tsx`). Kept as a record; not outstanding work.

**Status**: 🗑️ RETIRED (audit 2026-09-23; was ✅ DONE)
**Phase**: 4
**Priority**: P0
**Effort**: L (5-7 days)
**Dependencies**: FILM-107 (@kit/video-generation package)
**Blocks**: FILM-405 (generate-video-action), FILM-407 (kling-webhook)

---

## Context

Kling AI is a primary video generation provider offering text-to-video and image-to-video generation capabilities via the PiAPI endpoint. The provider must integrate with the generation jobs system, handle API authentication, manage rate limiting, and provide status polling for asynchronous job completion.

Kling supports multiple models (v1.0, v1.5) with different quality tiers (standard, pro) and aspect ratios (16:9, 9:16, 1:1). The provider must handle webhook callbacks for job completion and implement fallback polling for cases where webhooks fail.

---

## Requirements

### Functional Requirements

1. **Text-to-Video Generation**
   - Accept prompt, duration, aspect ratio, model version
   - Support negative prompts for quality control
   - Generate idempotency keys to prevent duplicate submissions
   - Return provider job ID immediately
   - Store job reference in generation_jobs table

2. **Image-to-Video Generation**
   - Accept reference image URL + prompt
   - Support same parameters as text-to-video
   - Validate image URL accessibility
   - Handle image preprocessing if needed

3. **Status Polling**
   - Query Kling API for job status
   - Parse completion percentage and ETA
   - Detect completion and extract video URL
   - Handle error states with retry logic

4. **Error Handling**
   - Detect rate limit errors (429)
   - Handle provider timeouts
   - Parse error codes from Kling API
   - Implement exponential backoff for retries

### Non-Functional Requirements

- API calls must timeout after 30 seconds
- Support concurrent requests with proper rate limiting
- Encrypt API keys at rest
- Log all API interactions for debugging
- Cache provider status for 5 seconds to reduce API calls

---

## Interface

### TypeScript Types

```typescript
import { z } from 'zod';

// Zod Schemas
export const KlingGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  negativePrompt: z.string().max(1000).optional(),
  duration: z.enum(['5', '10']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  model: z.enum(['kling-v1.0', 'kling-v1.5']).default('kling-v1.5'),
  mode: z.enum(['std', 'pro']).default('std'),
  referenceImageUrl: z.string().url().optional(),
  seed: z.number().int().positive().optional(),
});

export const KlingStatusSchema = z.object({
  jobId: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  progress: z.number().min(0).max(100).optional(),
  videoUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  errorMessage: z.string().optional(),
  errorCode: z.string().optional(),
});

// TypeScript Interfaces
export interface KlingGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  duration: '5' | '10';
  aspectRatio: '16:9' | '9:16' | '1:1';
  model?: 'kling-v1.0' | 'kling-v1.5';
  mode?: 'std' | 'pro';
  referenceImageUrl?: string;
  seed?: number;
}

export interface KlingGenerationResponse {
  providerJobId: string;
  status: 'pending' | 'processing';
  estimatedTime: number; // seconds
  message?: string;
}

export interface KlingJobStatus {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
  errorCode?: string;
  completedAt?: string;
}

export interface KlingProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  webhookUrl?: string;
}

// PiAPI Response Types
interface PiAPIGenerationResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    task_status: string;
    created_at: number;
  };
}

interface PiAPIStatusResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
    task_status_msg: string;
    created_at: number;
    updated_at: number;
    progress: number;
    task_result?: {
      videos: Array<{
        id: string;
        url: string;
        duration: number;
      }>;
    };
  };
}
```

### Provider Implementation

```typescript
import { VideoGenerationProvider } from '@kit/video-generation/providers';

export class KlingProvider implements VideoGenerationProvider {
  readonly name = 'kling';
  readonly supportedAspectRatios = ['16:9', '9:16', '1:1'];
  readonly supportedDurations = [5, 10];

  private config: KlingProviderConfig;
  private baseUrl: string;

  constructor(config: KlingProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.piapi.ai/api/kling/v1';
  }

  /**
   * Generate video from text prompt
   */
  async generateVideo(
    request: KlingGenerationRequest
  ): Promise<KlingGenerationResponse> {
    const validated = KlingGenerationRequestSchema.parse(request);

    const payload = {
      model: validated.model,
      prompt: validated.prompt,
      negative_prompt: validated.negativePrompt,
      cfg_scale: 0.5,
      mode: validated.mode,
      aspect_ratio: validated.aspectRatio,
      duration: validated.duration,
      seed: validated.seed,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<PiAPIGenerationResponse>(
      '/generations',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    if (response.code !== 200) {
      throw new Error(`Kling API error: ${response.message}`);
    }

    return {
      providerJobId: response.data.task_id,
      status: this.mapStatus(response.data.task_status),
      estimatedTime: validated.duration === '5' ? 180 : 300,
    };
  }

  /**
   * Generate video from image + prompt
   */
  async generateVideoWithImage(
    request: KlingGenerationRequest
  ): Promise<KlingGenerationResponse> {
    if (!request.referenceImageUrl) {
      throw new Error('Reference image URL is required for image-to-video');
    }

    const validated = KlingGenerationRequestSchema.parse(request);

    const payload = {
      model: validated.model,
      image_url: validated.referenceImageUrl,
      prompt: validated.prompt,
      negative_prompt: validated.negativePrompt,
      cfg_scale: 0.5,
      mode: validated.mode,
      duration: validated.duration,
      seed: validated.seed,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<PiAPIGenerationResponse>(
      '/image2video',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    if (response.code !== 200) {
      throw new Error(`Kling API error: ${response.message}`);
    }

    return {
      providerJobId: response.data.task_id,
      status: this.mapStatus(response.data.task_status),
      estimatedTime: validated.duration === '5' ? 180 : 300,
    };
  }

  /**
   * Get job status from Kling API
   */
  async getStatus(providerJobId: string): Promise<KlingJobStatus> {
    const response = await this.makeRequest<PiAPIStatusResponse>(
      `/generations/${providerJobId}`,
      { method: 'GET' }
    );

    if (response.code !== 200) {
      throw new Error(`Kling API error: ${response.message}`);
    }

    const data = response.data;
    const status = this.mapStatus(data.task_status);

    return {
      jobId: data.task_id,
      status,
      progress: data.progress,
      videoUrl: data.task_result?.videos[0]?.url,
      thumbnailUrl: undefined,
      errorMessage: status === 'failed' ? data.task_status_msg : undefined,
      completedAt:
        status === 'completed' ? new Date(data.updated_at * 1000).toISOString() : undefined,
    };
  }

  /**
   * Cancel a running job
   */
  async cancelJob(providerJobId: string): Promise<void> {
    // Kling API may not support cancellation
    // Log the attempt for now
    console.warn(`Kling job cancellation not supported: ${providerJobId}`);
  }

  /**
   * Estimate cost for a generation request
   */
  estimateCost(request: KlingGenerationRequest): number {
    const mode = request.mode || 'std';
    const duration = parseInt(request.duration, 10);

    // Cost in cents
    const COST_PER_SECOND = {
      std: 10,  // $0.10/second = 50 cents for 5s
      pro: 30,  // $0.30/second = 150 cents for 5s
    };

    return COST_PER_SECOND[mode] * duration;
  }

  /**
   * Make HTTP request to Kling API
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const timeout = this.config.timeout || 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          ...options.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          `HTTP ${response.status}: ${error.message || response.statusText}`
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Kling API request timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Map Kling status to internal status
   */
  private mapStatus(
    klingStatus: string
  ): 'pending' | 'processing' | 'completed' | 'failed' {
    switch (klingStatus) {
      case 'submitted':
        return 'pending';
      case 'processing':
        return 'processing';
      case 'succeed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'pending';
    }
  }
}
```

---

## Implementation Details

### File Structure

```
packages/features/video-generation/src/
├── providers/
│   ├── kling/
│   │   ├── kling-provider.ts          # Main provider class (CREATE THIS)
│   │   ├── kling-types.ts             # Type definitions (CREATE THIS)
│   │   ├── kling-schemas.ts           # Zod schemas (CREATE THIS)
│   │   └── __tests__/
│   │       └── kling-provider.test.ts # Unit tests (CREATE THIS)
│   └── index.ts                       # Export providers (UPDATE THIS)
```

### PiAPI Integration

**Base URL**: `https://api.piapi.ai/api/kling/v1`

**Authentication**: API key via `X-API-Key` header

**Endpoints**:
- `POST /generations` - Text-to-video
- `POST /image2video` - Image-to-video
- `GET /generations/{task_id}` - Status polling

**Webhook Callback**:
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "task_status": "succeed",
  "task_status_msg": "Task completed successfully",
  "updated_at": 1640995200,
  "progress": 100,
  "task_result": {
    "videos": [{
      "id": "video-123",
      "url": "https://cdn.piapi.ai/videos/...",
      "duration": 5
    }]
  }
}
```

### API Key Storage

Fetch encrypted API key from database:

```typescript
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { decrypt } from '@kit/shared/crypto';

export async function getKlingApiKey(accountId: string): Promise<string> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('external_api_keys')
    .select('encrypted_key')
    .eq('account_id', accountId)
    .eq('provider', 'kling')
    .single();

  if (error || !data) {
    throw new Error('Kling API key not configured');
  }

  return await decrypt(data.encrypted_key);
}
```

### Error Handling

| Error Condition | Error Code | Retry Strategy | User Message |
|----------------|------------|----------------|--------------|
| Rate limit (429) | RATE_LIMITED | Exponential backoff, max 3 retries | "Rate limit reached. Try again in a few minutes." |
| API timeout | TIMEOUT | Retry after 30s | "Request timeout. Please try again." |
| Invalid API key | AUTH_ERROR | No retry | "Invalid API credentials. Check settings." |
| Invalid prompt | VALIDATION_ERROR | No retry | "Invalid prompt. Please revise." |
| Server error (500) | PROVIDER_ERROR | Retry after 60s | "Provider error. Please try again later." |
| Insufficient credits | CREDIT_ERROR | No retry | "Insufficient credits with provider." |

### Rate Limiting

Kling API limits:
- **Free tier**: 10 requests/day
- **Standard tier**: 100 requests/day
- **Pro tier**: 1000 requests/day

Implement local rate limiting with Redis (see FILM-403).

### Status Polling Strategy

```typescript
export async function pollKlingStatus(
  provider: KlingProvider,
  providerJobId: string,
  maxAttempts = 60
): Promise<KlingJobStatus> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await provider.getStatus(providerJobId);

    if (status.status === 'completed' || status.status === 'failed') {
      return status;
    }

    // Wait 5 seconds before next poll
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error('Job polling timeout after 5 minutes');
}
```

---

## File Changes

### New Files

1. **packages/features/video-generation/src/providers/kling/kling-provider.ts**
   - Implement KlingProvider class
   - All public methods with JSDoc
   - Error handling and retry logic

2. **packages/features/video-generation/src/providers/kling/kling-types.ts**
   - Export all TypeScript interfaces
   - Include PiAPI response types
   - Mirror API schema

3. **packages/features/video-generation/src/providers/kling/kling-schemas.ts**
   - Export Zod validation schemas
   - Include request and response schemas
   - Validation helpers

4. **packages/features/video-generation/src/providers/kling/__tests__/kling-provider.test.ts**
   - Unit tests for all methods
   - Mock PiAPI responses
   - Test error conditions

### Modified Files

1. **packages/features/video-generation/src/providers/index.ts**
   - Export KlingProvider
   - Export Kling types and schemas

---

## Acceptance Criteria

### Functional

- [ ] `generateVideo()` successfully submits text-to-video request
- [ ] `generateVideoWithImage()` successfully submits image-to-video request
- [ ] `getStatus()` correctly polls job status
- [ ] `estimateCost()` returns correct cost in cents
- [ ] Provider correctly maps Kling status to internal status
- [ ] API requests include proper authentication headers
- [ ] Webhook URL is included in generation requests
- [ ] Errors are properly caught and thrown with context

### Non-Functional

- [ ] API requests timeout after 30 seconds
- [ ] All inputs validated with Zod schemas
- [ ] API key is never logged or exposed
- [ ] TypeScript compiles without errors
- [ ] No ESLint warnings
- [ ] All public methods have JSDoc comments

---

## Test Plan

### Unit Tests

**File**: `packages/features/video-generation/src/providers/kling/__tests__/kling-provider.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KlingProvider } from '../kling-provider';

// Mock fetch
global.fetch = vi.fn();

describe('KlingProvider', () => {
  let provider: KlingProvider;

  beforeEach(() => {
    provider = new KlingProvider({
      apiKey: 'test-api-key',
      webhookUrl: 'https://example.com/webhook',
    });
    vi.clearAllMocks();
  });

  describe('generateVideo', () => {
    it('should successfully submit text-to-video request', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          message: 'Success',
          data: {
            task_id: 'task-123',
            task_status: 'submitted',
            created_at: 1640995200,
          },
        }),
      });

      const result = await provider.generateVideo({
        prompt: 'A cat playing piano',
        duration: '5',
        aspectRatio: '16:9',
      });

      expect(result.providerJobId).toBe('task-123');
      expect(result.status).toBe('pending');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/generations'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-API-Key': 'test-api-key',
          }),
        })
      );
    });

    it('should reject invalid duration', async () => {
      await expect(
        provider.generateVideo({
          prompt: 'Test',
          duration: '15' as any,
          aspectRatio: '16:9',
        })
      ).rejects.toThrow();
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 400,
          message: 'Invalid prompt',
        }),
      });

      await expect(
        provider.generateVideo({
          prompt: 'Test',
          duration: '5',
          aspectRatio: '16:9',
        })
      ).rejects.toThrow('Kling API error: Invalid prompt');
    });

    it('should timeout after 30 seconds', async () => {
      (global.fetch as any).mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 35000))
      );

      await expect(
        provider.generateVideo({
          prompt: 'Test',
          duration: '5',
          aspectRatio: '16:9',
        })
      ).rejects.toThrow('timeout');
    }, 35000);
  });

  describe('generateVideoWithImage', () => {
    it('should submit image-to-video request', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          message: 'Success',
          data: {
            task_id: 'task-456',
            task_status: 'submitted',
            created_at: 1640995200,
          },
        }),
      });

      const result = await provider.generateVideoWithImage({
        prompt: 'Animate this image',
        referenceImageUrl: 'https://example.com/image.jpg',
        duration: '5',
        aspectRatio: '16:9',
      });

      expect(result.providerJobId).toBe('task-456');
    });

    it('should require reference image URL', async () => {
      await expect(
        provider.generateVideoWithImage({
          prompt: 'Test',
          duration: '5',
          aspectRatio: '16:9',
        })
      ).rejects.toThrow('Reference image URL is required');
    });
  });

  describe('getStatus', () => {
    it('should poll job status', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          message: 'Success',
          data: {
            task_id: 'task-123',
            task_status: 'processing',
            progress: 50,
            updated_at: 1640995200,
          },
        }),
      });

      const status = await provider.getStatus('task-123');

      expect(status.status).toBe('processing');
      expect(status.progress).toBe(50);
    });

    it('should return completed status with video URL', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 200,
          message: 'Success',
          data: {
            task_id: 'task-123',
            task_status: 'succeed',
            progress: 100,
            updated_at: 1640995200,
            task_result: {
              videos: [
                {
                  id: 'video-123',
                  url: 'https://cdn.piapi.ai/videos/video.mp4',
                  duration: 5,
                },
              ],
            },
          },
        }),
      });

      const status = await provider.getStatus('task-123');

      expect(status.status).toBe('completed');
      expect(status.videoUrl).toBe('https://cdn.piapi.ai/videos/video.mp4');
    });
  });

  describe('estimateCost', () => {
    it('should calculate standard mode cost', () => {
      const cost = provider.estimateCost({
        prompt: 'Test',
        duration: '5',
        aspectRatio: '16:9',
        mode: 'std',
      });

      expect(cost).toBe(50); // 10 cents/second * 5 seconds
    });

    it('should calculate pro mode cost', () => {
      const cost = provider.estimateCost({
        prompt: 'Test',
        duration: '10',
        aspectRatio: '16:9',
        mode: 'pro',
      });

      expect(cost).toBe(300); // 30 cents/second * 10 seconds
    });
  });
});
```

### Integration Tests

**File**: `apps/web/__tests__/integration/kling-provider.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { KlingProvider } from '@kit/video-generation/providers';

describe('Kling Provider Integration', () => {
  it('should complete full generation lifecycle', async () => {
    // Requires live API key (skip in CI)
    const apiKey = process.env.KLING_API_KEY;
    if (!apiKey) {
      console.log('Skipping integration test (no API key)');
      return;
    }

    const provider = new KlingProvider({ apiKey });

    // 1. Submit generation
    const generation = await provider.generateVideo({
      prompt: 'Test video generation',
      duration: '5',
      aspectRatio: '16:9',
    });

    expect(generation.providerJobId).toBeTruthy();

    // 2. Poll status until completion (with timeout)
    let status;
    for (let i = 0; i < 60; i++) {
      status = await provider.getStatus(generation.providerJobId);
      if (status.status === 'completed' || status.status === 'failed') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    expect(status?.status).toBe('completed');
    expect(status?.videoUrl).toBeTruthy();
  }, 300000); // 5 minute timeout
});
```

### Manual Testing

1. **Text-to-Video Generation**
   ```bash
   # Set API key
   export KLING_API_KEY="your-api-key"

   # Run test script
   pnpm --filter @kit/video-generation test:manual
   ```

2. **Monitor Webhook Delivery**
   - Use ngrok to expose local webhook endpoint
   - Submit generation request
   - Verify webhook received and parsed correctly

3. **Error Scenarios**
   - Submit with invalid API key → verify AUTH_ERROR
   - Submit with invalid prompt → verify VALIDATION_ERROR
   - Exceed rate limit → verify RATE_LIMITED error

---

## Security Considerations

### API Key Management

- API keys stored encrypted in `external_api_keys` table
- Keys decrypted only in memory during request
- Never log API keys or include in error messages
- Rotate keys periodically via admin interface

### Webhook Verification

Verify webhook signatures (see FILM-407):

```typescript
import crypto from 'crypto';

export function verifyKlingWebhook(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### Input Sanitization

- Validate all inputs with Zod schemas
- Sanitize prompts for injection attacks
- Validate image URLs before passing to API
- Limit prompt length to prevent abuse

### Rate Limiting

- Enforce rate limits per account per provider
- Track usage in Redis with sliding window
- Block requests when limit exceeded
- Notify users before reaching limit

---

## Error Handling

### Client-Side Error Display

```typescript
'use client';

import { toast } from '@kit/ui/sonner';
import { KlingProvider } from '@kit/video-generation/providers';

async function handleGeneration(data: FormData) {
  try {
    const provider = new KlingProvider({ apiKey: '...' });
    const result = await provider.generateVideo({
      prompt: data.get('prompt') as string,
      duration: '5',
      aspectRatio: '16:9',
    });

    toast.success('Video generation started');
    return result;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('RATE_LIMITED')) {
        toast.error('Rate limit reached. Try again later.');
      } else if (error.message.includes('AUTH_ERROR')) {
        toast.error('API credentials invalid. Check settings.');
      } else if (error.message.includes('timeout')) {
        toast.error('Request timeout. Please try again.');
      } else {
        toast.error('Video generation failed');
      }
    }
    throw error;
  }
}
```

### Server-Side Logging

```typescript
import { logger } from '@kit/monitoring';

try {
  const result = await provider.generateVideo(request);
  logger.info('Kling generation started', {
    providerJobId: result.providerJobId,
    accountId,
    shotId,
  });
} catch (error) {
  logger.error('Kling generation failed', {
    error,
    accountId,
    shotId,
    prompt: request.prompt,
  });
  throw error;
}
```

---

## Performance Considerations

### Request Caching

Cache provider status for 5 seconds to reduce API calls:

```typescript
import { createCache } from '@kit/cache';

const statusCache = createCache<KlingJobStatus>({
  ttl: 5000, // 5 seconds
});

export async function getCachedStatus(
  provider: KlingProvider,
  jobId: string
): Promise<KlingJobStatus> {
  const cached = await statusCache.get(jobId);
  if (cached) return cached;

  const status = await provider.getStatus(jobId);
  await statusCache.set(jobId, status);

  return status;
}
```

### Concurrent Requests

Limit concurrent API calls to avoid overwhelming provider:

```typescript
import pLimit from 'p-limit';

const limit = pLimit(5); // Max 5 concurrent requests

export async function batchGenerateVideos(
  provider: KlingProvider,
  requests: KlingGenerationRequest[]
): Promise<KlingGenerationResponse[]> {
  return Promise.all(
    requests.map((req) =>
      limit(() => provider.generateVideo(req))
    )
  );
}
```

### Timeout Configuration

Adjust timeouts based on duration:

```typescript
export function getTimeoutForDuration(duration: string): number {
  const seconds = parseInt(duration, 10);
  return seconds === 5 ? 30000 : 60000; // 30s or 60s
}
```

---

## Future Enhancements

1. **Model Selection UI**
   - Dropdown to select Kling v1.0 vs v1.5
   - Show estimated quality and cost difference

2. **Batch Generation**
   - Submit multiple shots to Kling at once
   - Queue management with priority

3. **Video Editing**
   - Support for Kling's extend video feature
   - Video interpolation for longer durations

4. **Advanced Settings**
   - Expose cfg_scale parameter
   - Support for motion strength control
   - Camera movement hints

5. **Monitoring Dashboard**
   - Track success rate per provider
   - Monitor average generation time
   - Alert on high failure rates

---

## References

- **PiAPI Kling Documentation**: https://docs.piapi.ai/kling
- **FILM-107**: @kit/video-generation package
- **FILM-403**: Rate limiter implementation
- **FILM-407**: Webhook handler
- **FILM-412**: Cost tracking
- **Constitution**: Section 4.2 (API Keys)
- **Constitution**: Section 4.3 (Webhook Security)
