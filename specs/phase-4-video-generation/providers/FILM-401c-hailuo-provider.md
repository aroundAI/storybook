---
spec_id: FILM-401c
status: 🗑️ RETIRED
audited: 2026-09-23
---

# FILM-401c: Hailuo (MiniMax) Video Generation Provider

> **🗑️ Retired (audit 2026-09-23).** The Hailuo (MiniMax) provider (`packages/features/video-generation/src/providers/hailuo/`) was deleted in `5b88db3a` (2026-01-15), the commit that removed `packages/features/video-generation`; the owner retired in-app video generation on purpose. Nothing replaces it: the Visual Studio writes VEO 3.1 prompts and each shot's video, generated outside the app, is uploaded with `VideoUploader` (`packages/features/episodes/src/components/video-uploader.tsx`). Kept as a record; not outstanding work.

## Metadata
- **Phase:** 4 - Video Generation
- **Priority:** P1 (Budget Provider)
- **Effort:** M (4-8 hours)
- **Status:** 🗑️ RETIRED (audit 2026-09-23; was ✅ DONE)
- **Dependencies:** FILM-107 (@kit/video-generation package), FILM-402 (Provider Factory)
- **Blocks:** None (alternative to Kling)

---

## Context

Hailuo AI (by MiniMax) is a budget-friendly video generation provider known for extremely fast processing times (<30 seconds). It's ideal for rapid prototyping and cost-conscious creators who prioritize speed over maximum quality.

**Provider Selection Criteria:**
- **Kling (Primary)**: Best value, balanced quality/speed
- **Runway (Premium)**: Professional quality, longer videos
- **Hailuo (Budget)**: Fastest generation, lowest cost

---

## Specification

### Requirements

1. **Text-to-Video Generation**
   - Support Hailuo's video-01 model
   - Accept prompt, duration (5s), aspect ratio
   - Ultra-fast processing (<30 seconds typical)
   - Return provider job ID immediately

2. **Image-to-Video Generation**
   - Accept reference image URL + prompt
   - Support motion enhancement
   - Validate image URL accessibility

3. **Status Polling**
   - Query Hailuo API for job status
   - Handle rapid status changes (fast processing)
   - Extract video URL on completion

4. **Cost Tracking**
   - Lowest cost per generation
   - Track usage for budget management

### Platform Limits

```typescript
export const HAILUO_LIMITS = {
  video: {
    maxDuration: 6, // seconds
    minDuration: 5,
    supportedDurations: [5, 6],
    supportedFormats: ['mp4'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    maxPromptLength: 1500,
  },
  api: {
    requestsPerMinute: 10,
    concurrentRequests: 3,
    timeout: 30000, // 30 seconds (fast!)
    typicalProcessingTime: 20, // seconds
  },
  pricing: {
    perGeneration: 40, // cents ($0.40 per video)
  },
};
```

### Provider Implementation

```typescript
// packages/features/video-generation/src/providers/hailuo/hailuo-provider.ts

import { z } from 'zod';
import { BaseVideoGenerationProvider } from '../base';
import type {
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationStatus,
  VideoProviderConfig,
} from '../types';

// Zod Schemas
export const HailuoGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(1500),
  duration: z.enum(['5', '6']).default('5'),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
  referenceImageUrl: z.string().url().optional(),
  enhanceMotion: z.boolean().default(true),
});

export interface HailuoProviderConfig extends VideoProviderConfig {
  apiKey: string;
  baseUrl?: string;
  webhookUrl?: string;
}

export class HailuoProvider extends BaseVideoGenerationProvider {
  readonly name = 'hailuo';
  readonly supportedAspectRatios = ['16:9', '9:16', '1:1'];
  readonly maxDuration = 6;

  private config: HailuoProviderConfig;
  private baseUrl: string;

  constructor(config: HailuoProviderConfig) {
    super();
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.minimaxi.chat/v1';
  }

  /**
   * Generate video from text prompt
   */
  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    const validated = HailuoGenerationRequestSchema.parse(request);

    const payload = {
      model: 'video-01',
      prompt: validated.prompt,
      first_frame_image: validated.referenceImageUrl,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<HailuoTaskResponse>(
      '/video_generation',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    return {
      jobId: response.task_id,
      status: 'pending',
      estimatedTime: HAILUO_LIMITS.api.typicalProcessingTime,
      message: 'Generation started - expect completion in ~20 seconds',
    };
  }

  /**
   * Generate video from image + prompt
   */
  async generateVideoWithImage(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    if (!request.referenceImageUrl) {
      throw new Error('Reference image URL is required for image-to-video');
    }

    // Hailuo uses the same endpoint with first_frame_image
    return this.generateVideo(request);
  }

  /**
   * Get job status from Hailuo API
   */
  async getStatus(jobId: string): Promise<VideoGenerationStatus> {
    const response = await this.makeRequest<HailuoStatusResponse>(
      `/query/video_generation?task_id=${jobId}`,
      { method: 'GET' }
    );

    const status = this.mapStatus(response.status);

    return {
      jobId,
      status,
      progress: status === 'completed' ? 100 : status === 'processing' ? 50 : 0,
      videoUrl: response.file_id ? await this.getVideoUrl(response.file_id) : undefined,
      thumbnailUrl: undefined, // Hailuo doesn't provide thumbnails
      error: response.status === 'Fail' ? 'Video generation failed' : undefined,
      completedAt: status === 'completed' ? new Date().toISOString() : undefined,
    };
  }

  /**
   * Get downloadable video URL from file_id
   */
  private async getVideoUrl(fileId: string): Promise<string> {
    const response = await this.makeRequest<{ file: { download_url: string } }>(
      `/files/retrieve?file_id=${fileId}`,
      { method: 'GET' }
    );
    return response.file.download_url;
  }

  /**
   * Cancel a running job (if supported)
   */
  async cancelJob(jobId: string): Promise<void> {
    // Hailuo processes so fast that cancellation is rarely needed
    console.warn(`Hailuo job cancellation not supported: ${jobId}`);
  }

  /**
   * Estimate cost for generation request
   */
  estimateCost(_request: VideoGenerationRequest): number {
    // Flat rate pricing
    return HAILUO_LIMITS.pricing.perGeneration;
  }

  /**
   * Make HTTP request to Hailuo API
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
        ...options.headers,
      },
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      if (response.status === 429) {
        throw new Error('RATE_LIMITED: Too many requests. Please wait.');
      }

      throw new Error(`Hailuo API error: ${error.base_resp?.status_msg || response.statusText}`);
    }

    const data = await response.json();

    if (data.base_resp?.status_code !== 0) {
      throw new Error(`Hailuo API error: ${data.base_resp?.status_msg || 'Unknown error'}`);
    }

    return data;
  }

  private mapStatus(status: string): 'pending' | 'processing' | 'completed' | 'failed' {
    const statusMap: Record<string, 'pending' | 'processing' | 'completed' | 'failed'> = {
      'Queueing': 'pending',
      'Processing': 'processing',
      'Success': 'completed',
      'Fail': 'failed',
    };
    return statusMap[status] || 'pending';
  }
}

// Response types
interface HailuoTaskResponse {
  task_id: string;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

interface HailuoStatusResponse {
  task_id: string;
  status: 'Queueing' | 'Processing' | 'Success' | 'Fail';
  file_id?: string;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}
```

---

## File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/video-generation/src/providers/hailuo/hailuo-provider.ts` |
| CREATE | `packages/features/video-generation/src/providers/hailuo/types.ts` |
| CREATE | `packages/features/video-generation/src/providers/hailuo/constants.ts` |
| MODIFY | `packages/features/video-generation/src/providers/index.ts` |
| MODIFY | `packages/features/video-generation/src/providers/factory.ts` (add to registry) |
| MODIFY | `packages/features/video-generation/src/lib/types.ts` (add 'hailuo' to VideoProvider type) |

---

## Acceptance Criteria

- [x] `generateVideo()` successfully submits to Hailuo API
- [x] `generateVideoWithImage()` works with first_frame_image
- [x] `getStatus()` correctly polls and maps status
- [x] `getVideoUrl()` retrieves downloadable URL from file_id
- [x] `estimateCost()` returns flat rate ($0.40)
- [x] Provider registered in factory registry
- [x] Fast timeout (30s) configured by default

---

## Test Plan

### Unit Tests
- [ ] Test request formatting
- [ ] Test status mapping (Queueing, Processing, Success, Fail)
- [ ] Test video URL retrieval
- [ ] Test error handling

### Integration Tests
- [ ] Test fast generation lifecycle (~20s)
- [ ] Verify video playback from URL

---

## Speed Comparison

| Provider | Typical Time | Max Duration | Cost |
|----------|--------------|--------------|------|
| **Hailuo** | **~20s** | 6s | **$0.40** |
| Kling Std | ~3 min | 10s | $0.50-1.00 |
| Runway Turbo | ~30s | 18s | $0.50-1.80 |

---

## Use Cases

**Best for:**
- Rapid prototyping and iteration
- Budget-conscious creators
- High-volume generation needs
- Quick previews before final render

**Not ideal for:**
- Long-form content (max 6s)
- Maximum quality requirements
- Projects needing longer clips

---

## Registry Entry

```typescript
// Add to FILM-402 provider factory
[
  'hailuo',
  {
    metadata: {
      name: 'hailuo',
      displayName: 'Hailuo AI',
      description: 'Ultra-fast budget video generation (~20s processing)',
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      maxDuration: 6,
      minDuration: 5,
      supportsImageToVideo: true,
      costPerSecond: {
        standard: 8, // ~$0.40 for 5s
        professional: 8,
      },
    },
    factory: (config) => new HailuoProvider(config),
  },
]
```

---

## References

- **FILM-401**: Kling Provider (pattern reference)
- **FILM-402**: Provider Factory
- **Hailuo/MiniMax API Docs**: https://www.minimaxi.com/document/video-generation
