# FILM-509: Suno Music Provider

## Metadata
- **Phase:** 5 - Audio Generation
- **Priority:** P1 (Post-MVP Enhancement)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-108 (Audio Generation Package), FILM-504 (Music Generation Action)
- **Blocks:** None

---

## Context

Suno is an AI music generation service that creates original songs from text prompts. Adding Suno as a music provider enables creators to generate custom background music, theme songs, and soundtracks for their episodes without licensing concerns.

---

## Specification

### Requirements

1. **Provider Adapter**: Implement Suno API client following the provider abstraction pattern
2. **Song Generation**: Support text-to-music generation with style/genre prompts
3. **Instrumental Mode**: Option to generate instrumentals without vocals
4. **Duration Control**: Specify target duration for generated music
5. **Style Tags**: Support genre, mood, and tempo parameters
6. **Cost Tracking**: Estimate and track generation costs per song

### Provider Interface

```typescript
// packages/features/audio-generation/src/providers/suno.ts

import { MusicGenerationProvider, MusicGenerationInput, MusicGenerationResult } from '../types';

interface SunoGenerationInput extends MusicGenerationInput {
  prompt: string;
  style?: string;           // "cinematic orchestral", "upbeat pop", etc.
  instrumental?: boolean;   // Generate without vocals
  duration?: number;        // Target duration in seconds (30-240)
  title?: string;           // Optional song title
}

export class SunoProvider implements MusicGenerationProvider {
  private apiKey: string;
  private baseUrl = 'https://api.suno.ai/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateMusic(input: SunoGenerationInput): Promise<string> {
    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: input.prompt,
        make_instrumental: input.instrumental ?? true,
        duration: input.duration ?? 60,
        style: input.style,
        title: input.title,
      }),
    });

    const data = await response.json();
    return data.task_id;
  }

  async getStatus(taskId: string): Promise<MusicGenerationResult> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });

    const data = await response.json();

    return {
      status: this.mapStatus(data.status),
      audioUrl: data.audio_url,
      duration: data.duration,
      metadata: {
        title: data.title,
        style: data.style,
        lyrics: data.lyrics, // If not instrumental
      },
      error: data.error_message,
    };
  }

  estimateCost(input: SunoGenerationInput): number {
    // Base cost: $0.50 per generation
    return 50; // cents
  }

  getRateLimits(): RateLimitConfig {
    return {
      requestsPerMinute: 5,
      concurrentRequests: 2,
      dailyLimit: 50,
    };
  }

  private mapStatus(status: string): 'pending' | 'processing' | 'completed' | 'failed' {
    const statusMap: Record<string, 'pending' | 'processing' | 'completed' | 'failed'> = {
      'queued': 'pending',
      'processing': 'processing',
      'complete': 'completed',
      'failed': 'failed',
    };
    return statusMap[status] || 'pending';
  }
}
```

### Server Action

```typescript
// packages/features/audio-generation/src/server/music-actions.ts

export const generateSunoMusicAction = enhanceAction(
  async ({ episodeId, prompt, style, instrumental, duration }, user) => {
    const client = getSupabaseServerClient();

    // Get episode and project context
    const { data: episode } = await client
      .from('episodes')
      .select('*, projects(account_id)')
      .eq('id', episodeId)
      .single();

    // Get API key
    const apiKey = await getApiKey(episode.projects.account_id, 'suno');

    // Check budget
    const estimatedCost = 50; // cents
    const budgetCheck = await checkAndReserveBudget(
      episode.projects.account_id,
      estimatedCost
    );
    if (!budgetCheck.allowed) {
      throw new Error(budgetCheck.reason);
    }

    // Create generation job
    const { data: job } = await client
      .from('generation_jobs')
      .insert({
        account_id: episode.projects.account_id,
        project_id: episode.project_id,
        job_type: 'music',
        reference_type: 'episode',
        reference_id: episodeId,
        provider: 'suno',
        status: 'queued',
        estimated_cost_cents: estimatedCost,
        input_data: { prompt, style, instrumental, duration },
      })
      .select()
      .single();

    // Trigger generation
    const sunoProvider = new SunoProvider(apiKey);
    const taskId = await sunoProvider.generateMusic({
      prompt,
      style,
      instrumental: instrumental ?? true,
      duration: duration ?? 60,
    });

    // Update job with provider task ID
    await client
      .from('generation_jobs')
      .update({
        provider_job_id: taskId,
        status: 'processing',
        started_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    return { jobId: job.id, taskId };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      prompt: z.string().min(10).max(500),
      style: z.string().optional(),
      instrumental: z.boolean().optional(),
      duration: z.number().min(30).max(240).optional(),
    }),
    auth: true,
  }
);
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/audio-generation/src/providers/suno.ts` |
| MODIFY | `packages/features/audio-generation/src/providers/index.ts` |
| MODIFY | `packages/features/audio-generation/src/server/music-actions.ts` |

---

## Acceptance Criteria

- [ ] Suno provider implements MusicGenerationProvider interface
- [ ] Text-to-music generation works with style prompts
- [ ] Instrumental mode generates music without vocals
- [ ] Duration parameter controls output length (30-240 seconds)
- [ ] Cost estimation returns correct value (50 cents)
- [ ] Rate limits enforced (5/min, 2 concurrent, 50/day)
- [ ] Generated audio saved to audio_tracks table
- [ ] Error handling for API failures with retry logic

---

## Test Plan

### Unit Tests
- [ ] Test prompt validation (min/max length)
- [ ] Test cost estimation function
- [ ] Test status mapping function
- [ ] Test rate limit configuration

### Integration Tests
- [ ] Test full generation flow with mock API
- [ ] Test webhook processing for completion
- [ ] Test budget check before generation

---

## Error Handling

| Error | User Experience |
|-------|-----------------|
| Invalid prompt | Show validation error with requirements |
| Rate limited | Queue job, show estimated wait time |
| Generation failed | Retry up to 3 times, then show error |
| Budget exceeded | Show upgrade prompt |

---

## Security Considerations

- API key stored encrypted in external_api_keys table
- User content validated before sending to API
- Generated audio scanned for policy violations
