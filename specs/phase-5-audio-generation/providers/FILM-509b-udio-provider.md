---
spec_id: FILM-509b
status: ✅ DONE
audited: 2026-09-23
---

# FILM-509b: Udio Music Generation Provider

## Metadata
- **Phase:** 5 - Audio Generation
- **Priority:** P1 (Secondary Provider)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-108 (Audio Generation Package), FILM-502b (Audio Provider Factory)
- **Blocks:** None (alternative to Suno)
- **Status:** ✅ DONE

---

## Context

Udio is an AI music generation service that creates high-quality original songs from text prompts. As a secondary music provider to Suno, Udio offers competitive quality with different stylistic strengths, particularly excelling in certain genres and vocal styles. Having Udio as an alternative ensures no vendor lock-in for music generation.

**Provider Selection Criteria:**
- **Suno (Primary)**: Full songs with vocals, longer duration (4 min), broader genre coverage
- **Udio (Secondary)**: High audio quality, strong in electronic/pop, good vocals
- **Beatoven.ai (Background)**: Royalty-free background music, no vocals
- **Mubert (Ambient)**: Ambient/electronic loops, real-time generation

---

## Specification

### Requirements

1. **Text-to-Music Generation**
   - Support Udio's music generation models
   - Accept prompt, style tags, duration
   - Support instrumental and vocal modes
   - Return generation task ID immediately

2. **Style Control**
   - Genre selection (pop, rock, electronic, classical, etc.)
   - Mood specification (happy, sad, energetic, calm)
   - Tempo/BPM preferences
   - Instrumental vs vocal toggle

3. **Status Polling**
   - Query Udio API for generation status
   - Handle progress updates
   - Extract audio URL on completion

4. **Song Extensions**
   - Extend existing generations
   - Continue from specific timestamp
   - Add variations to existing songs

### Platform Limits

```typescript
export const UDIO_LIMITS = {
  generation: {
    maxDuration: 120, // seconds (2 minutes)
    minDuration: 15,
    supportedDurations: [15, 30, 60, 120],
    maxPromptLength: 500,
  },
  api: {
    requestsPerMinute: 10,
    concurrentRequests: 3,
    timeout: 180000, // 3 minutes
    typicalProcessingTime: 60, // seconds
  },
  pricing: {
    perGeneration: 40, // cents ($0.40 per song)
    perExtension: 20, // cents ($0.20 per extension)
  },
  extensions: {
    maxExtensionsPerSong: 5,
    extensionDuration: 30, // seconds per extension
  },
};
```

### Provider Implementation

```typescript
// packages/features/audio-generation/src/providers/udio/udio-provider.ts

import { z } from 'zod';
import { BaseMusicGenerationProvider } from '../base';
import type {
  MusicGenerationRequest,
  MusicGenerationResponse,
  MusicGenerationStatus,
  MusicProviderConfig,
} from '../types';

// Zod Schemas
export const UdioGenerationRequestSchema = z.object({
  prompt: z.string().min(10).max(500),
  duration: z.enum(['15', '30', '60', '120']).default('60'),
  instrumental: z.boolean().default(false),
  style: z.object({
    genre: z.string().optional(),
    mood: z.string().optional(),
    tempo: z.enum(['slow', 'medium', 'fast']).optional(),
  }).optional(),
  seed: z.number().int().positive().optional(),
});

export const UdioExtensionRequestSchema = z.object({
  songId: z.string(),
  prompt: z.string().optional(),
  fromTimestamp: z.number().min(0).optional(),
});

export interface UdioProviderConfig extends MusicProviderConfig {
  apiKey: string;
  baseUrl?: string;
  webhookUrl?: string;
}

export class UdioProvider extends BaseMusicGenerationProvider {
  readonly name = 'udio';
  readonly maxDuration = 120;
  readonly supportsVocals = true;

  private config: UdioProviderConfig;
  private baseUrl: string;

  constructor(config: UdioProviderConfig) {
    super();
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.udio.com/v1';
  }

  /**
   * Generate music from text prompt
   */
  async generateMusic(request: MusicGenerationRequest): Promise<MusicGenerationResponse> {
    const validated = UdioGenerationRequestSchema.parse(request);

    const payload = {
      prompt: validated.prompt,
      duration_seconds: parseInt(validated.duration, 10),
      instrumental: validated.instrumental,
      genre: validated.style?.genre,
      mood: validated.style?.mood,
      tempo: validated.style?.tempo,
      seed: validated.seed,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<UdioTaskResponse>(
      '/generate',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    return {
      taskId: response.task_id,
      status: 'pending',
      estimatedTime: UDIO_LIMITS.api.typicalProcessingTime,
      message: 'Music generation started',
    };
  }

  /**
   * Extend an existing song
   */
  async extendSong(request: z.infer<typeof UdioExtensionRequestSchema>): Promise<MusicGenerationResponse> {
    const validated = UdioExtensionRequestSchema.parse(request);

    const payload = {
      song_id: validated.songId,
      prompt: validated.prompt,
      from_timestamp: validated.fromTimestamp,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<UdioTaskResponse>(
      '/extend',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    return {
      taskId: response.task_id,
      status: 'pending',
      estimatedTime: 30, // Extensions are faster
      message: 'Song extension started',
    };
  }

  /**
   * Get generation status
   */
  async getStatus(taskId: string): Promise<MusicGenerationStatus> {
    const response = await this.makeRequest<UdioStatusResponse>(
      `/tasks/${taskId}`,
      { method: 'GET' }
    );

    const status = this.mapStatus(response.status);

    return {
      taskId,
      status,
      progress: response.progress || (status === 'completed' ? 100 : 0),
      audioUrl: response.audio_url,
      duration: response.duration,
      metadata: {
        title: response.title,
        genre: response.genre,
        mood: response.mood,
        lyrics: response.lyrics,
        bpm: response.bpm,
      },
      error: response.error_message,
      completedAt: status === 'completed' ? new Date().toISOString() : undefined,
    };
  }

  /**
   * Get variations of an existing song
   */
  async getVariations(songId: string, count: number = 3): Promise<MusicGenerationResponse[]> {
    const response = await this.makeRequest<{ variations: UdioTaskResponse[] }>(
      `/songs/${songId}/variations`,
      {
        method: 'POST',
        body: JSON.stringify({ count }),
      }
    );

    return response.variations.map(v => ({
      taskId: v.task_id,
      status: 'pending' as const,
      estimatedTime: UDIO_LIMITS.api.typicalProcessingTime,
    }));
  }

  /**
   * Cancel a generation in progress
   */
  async cancelGeneration(taskId: string): Promise<void> {
    await this.makeRequest(
      `/tasks/${taskId}/cancel`,
      { method: 'POST' }
    );
  }

  /**
   * Estimate cost for generation
   */
  estimateCost(request: MusicGenerationRequest): number {
    // Flat rate pricing for Udio
    return UDIO_LIMITS.pricing.perGeneration;
  }

  /**
   * Estimate cost for extension
   */
  estimateExtensionCost(): number {
    return UDIO_LIMITS.pricing.perExtension;
  }

  /**
   * Get rate limit configuration
   */
  getRateLimits() {
    return {
      requestsPerMinute: UDIO_LIMITS.api.requestsPerMinute,
      concurrentRequests: UDIO_LIMITS.api.concurrentRequests,
      dailyLimit: 100, // Approximate
    };
  }

  /**
   * Make HTTP request to Udio API
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
      signal: AbortSignal.timeout(this.config.timeout || 60000),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      if (response.status === 429) {
        throw new Error('RATE_LIMITED: Too many requests. Please wait.');
      }
      if (response.status === 402) {
        throw new Error('CREDIT_ERROR: Insufficient Udio credits.');
      }
      if (response.status === 401) {
        throw new Error('AUTH_ERROR: Invalid API key.');
      }

      throw new Error(`Udio API error: ${error.message || response.statusText}`);
    }

    return response.json();
  }

  private mapStatus(status: string): 'pending' | 'processing' | 'completed' | 'failed' {
    const statusMap: Record<string, 'pending' | 'processing' | 'completed' | 'failed'> = {
      'queued': 'pending',
      'pending': 'pending',
      'processing': 'processing',
      'generating': 'processing',
      'completed': 'completed',
      'success': 'completed',
      'failed': 'failed',
      'error': 'failed',
    };
    return statusMap[status.toLowerCase()] || 'pending';
  }
}

// Response types
interface UdioTaskResponse {
  task_id: string;
  status: string;
  message?: string;
}

interface UdioStatusResponse {
  task_id: string;
  status: string;
  progress?: number;
  audio_url?: string;
  duration?: number;
  title?: string;
  genre?: string;
  mood?: string;
  lyrics?: string;
  bpm?: number;
  error_message?: string;
}
```

---

## File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/audio-generation/src/providers/udio/udio-provider.ts` |
| CREATE | `packages/features/audio-generation/src/providers/udio/types.ts` |
| CREATE | `packages/features/audio-generation/src/providers/udio/constants.ts` |
| CREATE | `packages/features/audio-generation/src/providers/udio/index.ts` |
| MODIFY | `packages/features/audio-generation/src/providers/index.ts` (export Udio) |
| MODIFY | `packages/features/audio-generation/src/providers/factory.ts` (add to registry) |

---

## Acceptance Criteria

- [x] `generateMusic()` successfully submits to Udio API
- [x] `extendSong()` extends existing generations
- [x] `getStatus()` correctly polls and maps status
- [x] `getVariations()` generates song variations
- [x] `cancelGeneration()` cancels in-progress tasks
- [x] `estimateCost()` returns accurate estimates
- [x] Provider registered in music factory registry
- [x] Error handling for rate limits, auth, credits

---

## Test Plan

### Unit Tests
- [x] Test prompt validation (min/max length)
- [x] Test duration validation
- [ ] Test style schema validation — *audit: no longer true* — no Udio style schema or test exists in `packages/features/audio-generation`
- [x] Test status mapping
- [x] Test cost estimation

### Integration Tests
- [x] Test full generation flow with mock API
- [x] Test extension flow
- [x] Test variation generation
- [ ] Test webhook callback handling (N/A - no webhooks in current implementation) — *audit: not met* — no test found; no Udio webhook exists, as the item says

---

## Provider Comparison

| Feature | Suno | Udio | Notes |
|---------|------|------|-------|
| Max Duration | 4 min | 2 min | Suno longer |
| Vocals | Yes | Yes | Both support |
| Cost/Song | $0.50 | $0.40 | Udio cheaper |
| Extensions | No | Yes | Udio advantage |
| Variations | No | Yes | Udio advantage |
| API Availability | Unofficial | Limited | Both restricted |
| Quality | Excellent | Excellent | Comparable |
| Genre Strength | Broad | Electronic/Pop | Different focus |

---

## Use Cases

**Best for:**
- Electronic, pop, and modern genres
- Songs needing extensions/continuations
- Creating song variations
- Projects needing shorter clips (15-30s)

**Not ideal for:**
- Longer form music (>2 min)
- Classical/orchestral (Suno may be better)
- Projects requiring official API support

---

## Registry Entry

```typescript
// Add to FILM-502b audio provider factory
[
  'udio',
  {
    metadata: {
      name: 'udio',
      displayName: 'Udio',
      description: 'High-quality AI music with vocals and extensions',
      maxDuration: 120,
      supportsVocals: true,
      supportsExtensions: true,
      supportsVariations: true,
      costPerGeneration: 40, // cents
    },
    factory: (config) => new UdioProvider(config),
  },
]
```

---

## API Note

As of late 2024/early 2025, Udio's public API availability is limited. This spec is designed based on expected API patterns and should be validated against actual API documentation when available. The implementation follows the same abstraction pattern as Suno to ensure easy provider switching.

---

## References

- **FILM-509**: Suno Provider (pattern reference)
- **FILM-502b**: Audio Provider Factory
- **Udio Website**: https://udio.com
