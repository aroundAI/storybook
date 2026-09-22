---
spec_id: FILM-401b
status: 🗑️ RETIRED
audited: 2026-09-23
---

# FILM-401b: Runway Gen-3 Video Generation Provider

> **🗑️ Retired (audit 2026-09-23).** The Runway provider and poller (`packages/features/video-generation/src/providers/runway.ts`, `packages/features/video-generation/src/lib/runway-poller.ts`) were deleted in `5b88db3a` (2026-01-15), the commit that removed `packages/features/video-generation`; the owner retired in-app video generation on purpose. Nothing replaces it: the Visual Studio writes VEO 3.1 prompts and each shot's video, generated outside the app, is uploaded with `VideoUploader` (`packages/features/episodes/src/components/video-uploader.tsx`). Kept as a record; not outstanding work.

## Metadata
- **Phase:** 4 - Video Generation
- **Priority:** P1 (Secondary Provider)
- **Effort:** M (4-8 hours)
- **Status:** 🗑️ RETIRED (audit 2026-09-23; was ✅ DONE)
- **Dependencies:** FILM-107 (@kit/video-generation package), FILM-402 (Provider Factory)
- **Blocks:** None (alternative to Kling)

---

## Context

Runway is a professional-grade AI video generation platform offering Gen-3 Alpha and Gen-3 Turbo models. As a secondary video provider, Runway offers higher quality output with longer duration support (up to 18 seconds) but at higher cost. This enables users to choose based on quality/cost tradeoffs.

**Provider Selection Criteria:**
- **Kling (Primary)**: Best value, 10s videos, good quality
- **Runway (Secondary)**: Professional quality, 18s videos, higher cost
- **Hailuo (Budget)**: Fastest generation, lowest cost

---

## Specification

### Requirements

1. **Text-to-Video Generation**
   - Support Gen-3 Alpha and Gen-3 Turbo models
   - Accept prompt, duration (5/10/18s), aspect ratio
   - Support seed for reproducibility
   - Return provider job ID immediately

2. **Image-to-Video Generation**
   - Accept reference image URL + prompt
   - Support motion strength control
   - Validate image dimensions

3. **Status Polling**
   - Query Runway API for job status
   - Parse progress percentage
   - Extract video URL on completion

4. **Error Handling**
   - Handle rate limits (429)
   - Handle credit exhaustion
   - Implement retry with backoff

### Platform Limits

```typescript
export const RUNWAY_LIMITS = {
  video: {
    maxDuration: 18, // seconds (Gen-3)
    minDuration: 5,
    supportedDurations: [5, 10, 18],
    supportedFormats: ['mp4'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:5'],
  },
  api: {
    requestsPerMinute: 5,
    concurrentRequests: 2,
    timeout: 60000, // 60 seconds
  },
  pricing: {
    gen3Alpha: {
      '5s': 100,  // cents
      '10s': 200,
      '18s': 360,
    },
    gen3Turbo: {
      '5s': 50,
      '10s': 100,
      '18s': 180,
    },
  },
};
```

### Provider Implementation

```typescript
// packages/features/video-generation/src/providers/runway/runway-provider.ts

import { z } from 'zod';
import { BaseVideoGenerationProvider } from '../base';
import type {
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationStatus,
  VideoProviderConfig,
} from '../types';

// Zod Schemas
export const RunwayGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(1000),
  duration: z.enum(['5', '10', '18']).default('10'),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5']).default('16:9'),
  model: z.enum(['gen3_alpha', 'gen3_turbo']).default('gen3_turbo'),
  seed: z.number().int().positive().optional(),
  referenceImageUrl: z.string().url().optional(),
  motionStrength: z.number().min(0).max(1).default(0.5),
});

export interface RunwayProviderConfig extends VideoProviderConfig {
  apiKey: string;
  baseUrl?: string;
  webhookUrl?: string;
}

export class RunwayProvider extends BaseVideoGenerationProvider {
  readonly name = 'runway';
  readonly supportedAspectRatios = ['16:9', '9:16', '1:1', '4:5'];
  readonly maxDuration = 18;

  private config: RunwayProviderConfig;
  private baseUrl: string;

  constructor(config: RunwayProviderConfig) {
    super();
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.runwayml.com/v1';
  }

  /**
   * Generate video from text prompt
   */
  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    const validated = RunwayGenerationRequestSchema.parse(request);

    const payload = {
      promptText: validated.prompt,
      model: validated.model,
      seconds: parseInt(validated.duration, 10),
      ratio: validated.aspectRatio,
      seed: validated.seed,
      exploreMode: false,
      watermark: false,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<RunwayTaskResponse>(
      '/image_to_video', // Runway uses same endpoint
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    return {
      jobId: response.id,
      status: 'pending',
      estimatedTime: this.getEstimatedTime(validated.duration, validated.model),
      message: 'Generation started',
    };
  }

  /**
   * Generate video from image + prompt
   */
  async generateVideoWithImage(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    if (!request.referenceImageUrl) {
      throw new Error('Reference image URL is required for image-to-video');
    }

    const validated = RunwayGenerationRequestSchema.parse(request);

    const payload = {
      promptText: validated.prompt,
      promptImage: validated.referenceImageUrl,
      model: validated.model,
      seconds: parseInt(validated.duration, 10),
      ratio: validated.aspectRatio,
      seed: validated.seed,
      motionStrength: validated.motionStrength,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<RunwayTaskResponse>(
      '/image_to_video',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    return {
      jobId: response.id,
      status: 'pending',
      estimatedTime: this.getEstimatedTime(validated.duration, validated.model),
    };
  }

  /**
   * Get job status from Runway API
   */
  async getStatus(jobId: string): Promise<VideoGenerationStatus> {
    const response = await this.makeRequest<RunwayStatusResponse>(
      `/tasks/${jobId}`,
      { method: 'GET' }
    );

    return {
      jobId: response.id,
      status: this.mapStatus(response.status),
      progress: response.progress,
      videoUrl: response.output?.[0],
      thumbnailUrl: response.thumbnail,
      error: response.failure,
      completedAt: response.status === 'SUCCEEDED' ? new Date().toISOString() : undefined,
    };
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<void> {
    await this.makeRequest(
      `/tasks/${jobId}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Estimate cost for generation request
   */
  estimateCost(request: VideoGenerationRequest): number {
    const duration = request.duration || '10';
    const model = request.modelVersion || 'gen3_turbo';

    const pricing = model === 'gen3_alpha'
      ? RUNWAY_LIMITS.pricing.gen3Alpha
      : RUNWAY_LIMITS.pricing.gen3Turbo;

    return pricing[duration as keyof typeof pricing] || pricing['10s'];
  }

  /**
   * Make HTTP request to Runway API
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'X-Runway-Version': '2024-11-06',
        ...options.headers,
      },
      signal: AbortSignal.timeout(this.config.timeout || 60000),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      if (response.status === 429) {
        throw new Error('RATE_LIMITED: Too many requests. Please wait.');
      }
      if (response.status === 402) {
        throw new Error('CREDIT_ERROR: Insufficient Runway credits.');
      }

      throw new Error(`Runway API error: ${error.error || response.statusText}`);
    }

    return response.json();
  }

  private mapStatus(status: string): 'pending' | 'processing' | 'completed' | 'failed' {
    const statusMap: Record<string, 'pending' | 'processing' | 'completed' | 'failed'> = {
      'PENDING': 'pending',
      'RUNNING': 'processing',
      'SUCCEEDED': 'completed',
      'FAILED': 'failed',
      'CANCELLED': 'failed',
    };
    return statusMap[status] || 'pending';
  }

  private getEstimatedTime(duration: string, model: string): number {
    // Turbo is faster, Alpha is slower
    const baseTime = model === 'gen3_turbo' ? 30 : 60;
    const durationMultiplier = parseInt(duration, 10) / 5;
    return baseTime * durationMultiplier;
  }
}

// Response types
interface RunwayTaskResponse {
  id: string;
  status: string;
  created_at: string;
}

interface RunwayStatusResponse {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  progress: number;
  output?: string[];
  thumbnail?: string;
  failure?: string;
}
```

---

## File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/video-generation/src/providers/runway/runway-provider.ts` |
| CREATE | `packages/features/video-generation/src/providers/runway/types.ts` |
| CREATE | `packages/features/video-generation/src/providers/runway/constants.ts` |
| MODIFY | `packages/features/video-generation/src/providers/index.ts` |
| MODIFY | `packages/features/video-generation/src/providers/factory.ts` (add to registry) |

---

## Acceptance Criteria

- [x] `generateVideo()` successfully submits to Runway API
- [x] `generateVideoWithImage()` works with reference image
- [x] `getStatus()` correctly polls job status
- [x] `estimateCost()` returns correct cost for model/duration
- [x] Provider registered in factory registry
- [x] Errors properly categorized (RATE_LIMITED, CREDIT_ERROR, etc.)
- [x] Webhook URL included in requests

---

## Test Plan

### Unit Tests
- [x] Test text-to-video request formatting
- [x] Test image-to-video request formatting
- [x] Test status mapping
- [x] Test cost estimation
- [x] Test error handling (429, 402)

### Integration Tests
- [ ] Test full generation lifecycle (requires API key)
- [ ] Test webhook delivery

---

## API Reference

**Base URL:** `https://api.runwayml.com/v1`

**Authentication:** Bearer token via `Authorization` header

**Key Endpoints:**
- `POST /image_to_video` - Generate video
- `GET /tasks/{id}` - Get status
- `DELETE /tasks/{id}` - Cancel task

---

## Pricing Comparison

| Duration | Kling Std | Kling Pro | Runway Turbo | Runway Alpha |
|----------|-----------|-----------|--------------|--------------|
| 5s | $0.50 | $1.50 | $0.50 | $1.00 |
| 10s | $1.00 | $3.00 | $1.00 | $2.00 |
| 18s | N/A | N/A | $1.80 | $3.60 |

---

## References

- **FILM-401**: Kling Provider (pattern reference)
- **FILM-402**: Provider Factory
- **Runway API Docs**: https://docs.runwayml.com
