---
spec_id: FILM-504
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-504: Music Generation Server Action

**Phase**: 5
**Priority**: P0
**Effort**: M (3-5 days)
**Dependencies**: FILM-108 (audio-generation package)
**Blocks**: FILM-505

---

## Context

The music generation server action enables the creation of background music for episodes using the Suno API. Unlike voice generation which is synchronous, music generation is an asynchronous process: submit a generation request, receive a job ID, then poll for completion. This action must handle the complete workflow including job submission, status polling, audio retrieval, storage upload, and database updates.

Music tracks enhance the cinematic quality of episodes by providing atmosphere, emotion, and pacing. The action should support genre selection, mood specification, tempo control, and instrumental-only options. It must also handle long generation times (2-5 minutes) gracefully with proper status tracking.

---

## Requirements

### Functional Requirements

1. **Music Generation Request**
   - Accept episode ID and music prompt
   - Support genre, mood, tempo parameters
   - Option for instrumental-only (no vocals)
   - Set duration (max 4 minutes)
   - Submit to Suno API and receive job ID

2. **Job Status Polling**
   - Poll Suno API for job status
   - Track status transitions (pending → processing → completed/failed)
   - Retrieve audio URL when completed
   - Handle timeout (max 10 minutes)
   - Exponential backoff for polling

3. **Audio Storage**
   - Download audio from Suno
   - Upload to Supabase Storage bucket: `audio/music`
   - Generate signed URL for playback
   - Store metadata (duration, genre, mood)

4. **Database Management**
   - Create audio_tracks record
   - Update status as job progresses
   - Store generation metadata (cost, provider job ID)
   - Link track to episode
   - Support multiple tracks per episode

5. **Error Handling**
   - Handle API errors (rate limits, quota exceeded)
   - Timeout detection and graceful failure
   - Retry logic for transient failures
   - Detailed error messages in metadata

### Non-Functional Requirements

- Complete workflow within 10 minutes
- Support concurrent music generation (up to 3 per account)
- Atomic database transactions
- Comprehensive logging for debugging
- Cost tracking per generation

---

## Interface

### TypeScript Types

```typescript
// Zod Schemas
import { z } from 'zod';

export const GenerateMusicSchema = z.object({
  episodeId: z.string().uuid(),
  prompt: z.string().min(10).max(1000),
  duration: z.number().int().min(30).max(240).default(60),
  genre: z.string().optional(),
  mood: z.string().optional(),
  tempo: z.enum(['slow', 'medium', 'fast']).optional(),
  instrumentalOnly: z.boolean().default(true),
});

export const GetMusicJobStatusSchema = z.object({
  audioTrackId: z.string().uuid(),
});

export const CancelMusicGenerationSchema = z.object({
  audioTrackId: z.string().uuid(),
});

// Return Types
export interface GenerateMusicResult {
  audioTrackId: string;
  episodeId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  providerJobId: string;
  estimatedDuration: number;
  estimatedCost: number;
}

export interface MusicJobStatus {
  audioTrackId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audioUrl: string | null;
  duration: number | null;
  cost: number;
  error: string | null;
  progress: number; // 0-100
  estimatedCompletionAt: string | null;
}

// Database Types
export interface AudioTrack {
  id: string;
  episodeId: string;
  type: 'music' | 'sfx';
  name: string;
  audioUrl: string | null;
  duration: number | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  provider: string;
  providerJobId: string | null;
  generationMetadata: MusicGenerationMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface MusicGenerationMetadata {
  prompt: string;
  genre?: string;
  mood?: string;
  tempo?: string;
  instrumentalOnly: boolean;
  costCents: number;
  durationSeconds: number;
  generatedAt: string;
  providerResponse?: Record<string, unknown>;
  error?: string;
}

// Suno API Types
export interface SunoGenerateRequest {
  prompt: string;
  make_instrumental: boolean;
  wait_audio: boolean;
  model?: string;
  custom_mode?: boolean;
  tags?: string; // genre, mood
}

export interface SunoGenerateResponse {
  id: string;
  status: 'queued' | 'generating' | 'complete' | 'error';
  audio_url?: string;
  video_url?: string;
  image_url?: string;
  lyric?: string;
  title?: string;
  tags?: string;
  duration?: number;
  created_at: string;
}
```

### Server Actions

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import {
  GenerateMusicSchema,
  GetMusicJobStatusSchema,
  CancelMusicGenerationSchema,
} from '../schemas/music.schema';
import type {
  GenerateMusicResult,
  MusicJobStatus,
  MusicGenerationMetadata,
  SunoGenerateRequest,
  SunoGenerateResponse,
} from '../types/music.types';

/**
 * Generate background music for an episode using Suno API
 * @throws {Error} If episode not found or API request fails
 */
export const generateMusicAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();
    const adminClient = getSupabaseServerAdminClient();

    // 1. Fetch episode
    const { data: episode, error: episodeError } = await client
      .from('episodes')
      .select('id, account_id, project_id, title')
      .eq('id', data.episodeId)
      .single();

    if (episodeError || !episode) {
      throw new Error('Episode not found');
    }

    // 2. Estimate cost (Suno: $0.50 per generation)
    const estimatedCost = 50; // cents

    // 3. Check budget
    await checkBudget(client, episode.account_id, estimatedCost);

    // 4. Get API key
    const apiKey = await getApiKey(client, episode.account_id, 'suno');

    // 5. Build Suno request
    const tags = [data.genre, data.mood, data.tempo]
      .filter(Boolean)
      .join(', ');

    const sunoRequest: SunoGenerateRequest = {
      prompt: data.prompt,
      make_instrumental: data.instrumentalOnly,
      wait_audio: false, // async generation
      tags,
    };

    // 6. Submit to Suno API
    const sunoResponse = await callSunoGenerateAPI(apiKey, sunoRequest);

    if (!sunoResponse || !sunoResponse.id) {
      throw new Error('Failed to submit music generation request to Suno');
    }

    // 7. Create audio_tracks record
    const trackName = `${episode.title} - Background Music`;
    const { data: audioTrack, error: trackError } = await client
      .from('audio_tracks')
      .insert({
        episode_id: data.episodeId,
        type: 'music',
        name: trackName,
        status: 'pending',
        provider: 'suno',
        provider_job_id: sunoResponse.id,
        generation_metadata: {
          prompt: data.prompt,
          genre: data.genre,
          mood: data.mood,
          tempo: data.tempo,
          instrumentalOnly: data.instrumentalOnly,
          costCents: estimatedCost,
        } as MusicGenerationMetadata,
      })
      .select()
      .single();

    if (trackError || !audioTrack) {
      throw new Error('Failed to create audio track record');
    }

    // 8. Start background polling for completion
    pollMusicJobInBackground(audioTrack.id, sunoResponse.id, apiKey);

    // 9. Return job info
    return {
      audioTrackId: audioTrack.id,
      episodeId: data.episodeId,
      status: 'pending' as const,
      providerJobId: sunoResponse.id,
      estimatedDuration: data.duration,
      estimatedCost,
    };
  },
  { schema: GenerateMusicSchema, auth: true }
);

/**
 * Get status of music generation job
 * @throws {Error} If audio track not found
 */
export const getMusicJobStatusAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    const { data: audioTrack, error } = await client
      .from('audio_tracks')
      .select('*')
      .eq('id', data.audioTrackId)
      .single();

    if (error || !audioTrack) {
      throw new Error('Audio track not found');
    }

    // Calculate progress based on status
    let progress = 0;
    if (audioTrack.status === 'processing') progress = 50;
    if (audioTrack.status === 'completed') progress = 100;
    if (audioTrack.status === 'failed') progress = 0;

    // Estimate completion time (typically 2-5 minutes)
    let estimatedCompletionAt: string | null = null;
    if (audioTrack.status === 'pending' || audioTrack.status === 'processing') {
      const now = Date.now();
      const createdAt = new Date(audioTrack.created_at).getTime();
      const elapsed = now - createdAt;
      const estimatedTotal = 4 * 60 * 1000; // 4 minutes
      const remaining = Math.max(0, estimatedTotal - elapsed);
      estimatedCompletionAt = new Date(now + remaining).toISOString();
    }

    return {
      audioTrackId: audioTrack.id,
      status: audioTrack.status,
      audioUrl: audioTrack.audio_url,
      duration: audioTrack.duration,
      cost: audioTrack.generation_metadata?.costCents || 0,
      error: audioTrack.generation_metadata?.error || null,
      progress,
      estimatedCompletionAt,
    };
  },
  { schema: GetMusicJobStatusSchema, auth: true }
);

/**
 * Cancel music generation job (if still pending)
 * @throws {Error} If track not found or already completed
 */
export const cancelMusicGenerationAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    const { data: audioTrack, error } = await client
      .from('audio_tracks')
      .select('status, provider_job_id')
      .eq('id', data.audioTrackId)
      .single();

    if (error || !audioTrack) {
      throw new Error('Audio track not found');
    }

    if (audioTrack.status === 'completed') {
      throw new Error('Cannot cancel completed generation');
    }

    // Update status to failed (cancelled)
    await client
      .from('audio_tracks')
      .update({
        status: 'failed',
        generation_metadata: {
          ...audioTrack.generation_metadata,
          error: 'Cancelled by user',
        },
      })
      .eq('id', data.audioTrackId);

    return {
      success: true,
      audioTrackId: data.audioTrackId,
    };
  },
  { schema: CancelMusicGenerationSchema, auth: true }
);

/**
 * Helper: Call Suno generate API
 */
async function callSunoGenerateAPI(
  apiKey: string,
  request: SunoGenerateRequest
): Promise<SunoGenerateResponse> {
  const response = await fetch('https://api.suno.ai/v1/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Suno API error: ${errorData.error || response.statusText}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Helper: Get Suno job status
 */
async function getSunoJobStatus(
  apiKey: string,
  jobId: string
): Promise<SunoGenerateResponse> {
  const response = await fetch(`https://api.suno.ai/v1/generate/${jobId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get Suno job status: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Helper: Poll music job until completion
 * Runs in background, non-blocking
 */
async function pollMusicJobInBackground(
  audioTrackId: string,
  providerJobId: string,
  apiKey: string
): Promise<void> {
  const client = getSupabaseServerClient();
  const adminClient = getSupabaseServerAdminClient();

  const maxAttempts = 60; // 10 minutes with 10s intervals
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      // Wait before polling (exponential backoff)
      const delay = Math.min(10000 + (attempt * 1000), 30000); // 10s to 30s
      await new Promise(resolve => setTimeout(resolve, delay));

      // Get job status from Suno
      const sunoStatus = await getSunoJobStatus(apiKey, providerJobId);

      // Update status in database
      if (sunoStatus.status === 'generating') {
        await client
          .from('audio_tracks')
          .update({ status: 'processing' })
          .eq('id', audioTrackId);
      }

      // Check if completed
      if (sunoStatus.status === 'complete' && sunoStatus.audio_url) {
        // Download audio from Suno
        const audioResponse = await fetch(sunoStatus.audio_url);
        if (!audioResponse.ok) {
          throw new Error('Failed to download audio from Suno');
        }

        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

        // Upload to storage
        const storagePath = `audio/music/${audioTrackId}.mp3`;
        const { error: uploadError } = await adminClient.storage
          .from('audio')
          .upload(storagePath, audioBuffer, {
            contentType: 'audio/mpeg',
          });

        if (uploadError) {
          throw new Error(`Failed to upload audio: ${uploadError.message}`);
        }

        // Get public URL
        const { data: urlData } = adminClient.storage
          .from('audio')
          .getPublicUrl(storagePath);

        // Update track with audio URL
        const { error: updateError } = await client
          .from('audio_tracks')
          .update({
            status: 'completed',
            audio_url: urlData.publicUrl,
            duration: sunoStatus.duration || null,
            generation_metadata: {
              ...sunoStatus,
              generatedAt: new Date().toISOString(),
            },
          })
          .eq('id', audioTrackId);

        if (updateError) {
          throw updateError;
        }

        // Record cost
        const { data: track } = await client
          .from('audio_tracks')
          .select('episodes!inner(account_id)')
          .eq('id', audioTrackId)
          .single();

        if (track) {
          await recordCost(
            client,
            track.episodes.account_id,
            50, // Suno cost
            'music',
            'suno',
            audioTrackId
          );
        }

        break; // Success, exit loop
      }

      // Check if failed
      if (sunoStatus.status === 'error') {
        await client
          .from('audio_tracks')
          .update({
            status: 'failed',
            generation_metadata: {
              error: 'Suno generation failed',
              providerResponse: sunoStatus,
            },
          })
          .eq('id', audioTrackId);

        break; // Failed, exit loop
      }

      attempt++;
    } catch (error) {
      // Log error but continue polling
      console.error('Error polling music job:', error);
      attempt++;
    }
  }

  // Timeout check
  if (attempt >= maxAttempts) {
    await client
      .from('audio_tracks')
      .update({
        status: 'failed',
        generation_metadata: {
          error: 'Music generation timed out after 10 minutes',
        },
      })
      .eq('id', audioTrackId);
  }
}

/**
 * Helper: Check budget availability
 */
async function checkBudget(
  client: any,
  accountId: string,
  estimatedCost: number
): Promise<void> {
  const { data: account } = await client
    .from('accounts')
    .select('monthly_budget_cents, current_usage_cents')
    .eq('id', accountId)
    .single();

  if (!account) {
    throw new Error('Account not found');
  }

  const remainingBudget = account.monthly_budget_cents - account.current_usage_cents;

  if (remainingBudget < estimatedCost) {
    throw new Error(
      `Insufficient budget. Remaining: $${(remainingBudget / 100).toFixed(2)}, ` +
      `Required: $${(estimatedCost / 100).toFixed(2)}`
    );
  }
}

/**
 * Helper: Get API key for provider
 */
async function getApiKey(
  client: any,
  accountId: string,
  provider: string
): Promise<string> {
  const { data: apiKeyRecord } = await client
    .from('external_api_keys')
    .select('encrypted_key')
    .eq('account_id', accountId)
    .eq('provider', provider)
    .single();

  if (!apiKeyRecord) {
    throw new Error(`No API key found for provider: ${provider}`);
  }

  return apiKeyRecord.encrypted_key;
}

/**
 * Helper: Record generation cost
 */
async function recordCost(
  client: any,
  accountId: string,
  costCents: number,
  type: string,
  provider: string,
  referenceId: string | null
): Promise<void> {
  await client.rpc('increment_account_usage', {
    p_account_id: accountId,
    p_amount_cents: costCents,
  });

  await client
    .from('generation_costs')
    .insert({
      account_id: accountId,
      type,
      provider,
      cost_cents: costCents,
      reference_id: referenceId,
    });
}
```

---

## Implementation Details

### File Structure

```
packages/features/audio-generation/src/
├── lib/
│   ├── schemas/
│   │   └── music.schema.ts              # Zod schemas (CREATE THIS)
│   ├── server/
│   │   ├── mutations/
│   │   │   └── music-actions.ts         # Main actions (CREATE THIS)
│   │   └── queries/
│   │       └── music-queries.ts         # Helper queries (CREATE THIS)
│   └── helpers/
│       ├── suno-client.ts                # Suno API client (CREATE THIS)
│       └── music-poller.ts               # Background polling (CREATE THIS)
└── types/
    └── music.types.ts                    # TypeScript types (CREATE THIS)
```

### Suno API Integration

**Base URL**: `https://api.suno.ai/v1`

**Authentication**: Bearer token via `Authorization` header

**Key Endpoints**:
- `POST /generate` - Submit generation request
- `GET /generate/{id}` - Get job status
- `GET /clips` - List generated clips

**Generation Flow**:
```
1. Submit request → Receive job ID
2. Poll /generate/{id} every 10-30s
3. Status: queued → generating → complete
4. Download audio_url when complete
5. Upload to our storage
6. Update database
```

### Polling Strategy

```typescript
// Exponential backoff with max delay
const getDelay = (attempt: number) => {
  const baseDelay = 10000; // 10 seconds
  const exponential = attempt * 1000;
  return Math.min(baseDelay + exponential, 30000); // max 30s
};

// Polling intervals
Attempt 1: 10s delay
Attempt 2: 11s delay
Attempt 3: 12s delay
...
Attempt 20+: 30s delay (max)
```

### Storage Structure

```
Supabase Storage Bucket: audio
└── music/
    ├── {audio_track_id}.mp3
    ├── {audio_track_id}.mp3
    └── ...
```

---

## File Changes

### New Files

1. **packages/features/audio-generation/src/lib/schemas/music.schema.ts**
   - Export all Zod schemas for music generation
   - Include validation rules

2. **packages/features/audio-generation/src/lib/server/mutations/music-actions.ts**
   - Implement generateMusicAction
   - Implement getMusicJobStatusAction
   - Implement cancelMusicGenerationAction

3. **packages/features/audio-generation/src/lib/server/queries/music-queries.ts**
   - Helper queries for audio tracks
   - Track status queries

4. **packages/features/audio-generation/src/lib/helpers/suno-client.ts**
   - Suno API client wrapper
   - Request/response handling
   - Error handling

5. **packages/features/audio-generation/src/lib/helpers/music-poller.ts**
   - Background polling logic
   - Status tracking
   - Audio download and upload

6. **packages/features/audio-generation/src/types/music.types.ts**
   - Export all TypeScript interfaces
   - Suno API types
   - Database types

### Modified Files

None (new feature)

---

## Acceptance Criteria

### Functional

- [x] `generateMusicAction` submits request to Suno API — *audit:* the live dialogs call `generateSceneMusicAction` and `generateMusicCueAction`, which submit to Suno (`packages/features/audio-generation/src/server/music-actions.ts:261`, `:392`); `generateMusicAction` is called only by the unmounted `MusicTrackList`
- [ ] `generateMusicAction` creates generation_jobs record with pending status — *audit: no longer true* — since `4417f9e1` the live actions create an `audio_tracks` row with `metadata.status: 'pending'` (`packages/features/audio-generation/src/server/music-actions.ts:230`), no `generation_jobs` row
- [x] `generateMusicAction` returns job info for client-side polling — *audit:* returns `trackId` and `jobId` (`packages/features/audio-generation/src/server/music-actions.ts:296`)
- [x] `generateMusicAction` validates input with schema — *audit:* `packages/features/audio-generation/src/server/music-actions.ts:320`, `:451`
- [x] `generateMusicAction` validates prompt length (1-1000 chars) — *audit:* 1–1000 enforced by the provider (`packages/features/audio-generation/src/providers/base.ts:224`); the action schemas are stricter, 10–500 (`packages/features/audio-generation/src/lib/schemas/music.schema.ts:41`)
- [x] `getMusicJobStatusAction` returns accurate status — *audit:* the live `pollMusicStatusAction` maps Suno's status (`packages/features/audio-generation/src/server/music-actions.ts:532`); mapping tested at `packages/features/audio-generation/__tests__/suno.test.ts:236`
- [ ] `getMusicJobStatusAction` calculates progress percentage — *audit: no longer true* — the live `pollMusicStatusAction` relays Suno's `progress` and computes none (`packages/features/audio-generation/src/server/music-actions.ts:592`)
- [x] `getMusicJobStatusAction` polls Suno for status updates — *audit:* `packages/features/audio-generation/src/server/music-actions.ts:531`
- [x] `getMusicJobStatusAction` updates database with audio URL when complete — *audit:* `packages/features/audio-generation/src/server/music-actions.ts:540`
- [ ] `getMusicJobStatusAction` records cost after completion — *audit: no longer true* — nothing records cost on completion (`packages/features/audio-generation/src/server/music-actions.ts:535`); only an estimate is stored at submit (`:286`)
- [x] `getMusicJobStatusAction` handles terminal states correctly — *audit:* `packages/features/audio-generation/src/server/music-actions.ts:509`
- [x] `getMusicJobStatusAction` marks as failed on Suno error — *audit:* `packages/features/audio-generation/src/server/music-actions.ts:562`
- [ ] `cancelMusicGenerationAction` cancels pending jobs — *audit: no longer true* — the live music path has no cancel; `cancelMusicGenerationAction` (`packages/features/audio-generation/src/server/actions.ts:374`) has no caller
- [x] All actions enforce authentication — *audit:* `packages/features/audio-generation/src/server/music-actions.ts:179`, `:352`, `:478`
- [ ] All actions use generation_jobs table for tracking — *audit: no longer true* — the live actions track status in `audio_tracks.metadata` (`packages/features/audio-generation/src/server/music-actions.ts:230`)

### Non-Functional

- [x] Client polls getMusicJobStatusAction for status updates — *audit:* the timeline polls `pollMusicStatusAction` (`apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/audio-studio/_components/music-timeline.tsx:337`)
- [x] Server actions don't block (return immediately after starting generation) — *audit:* returns once Suno accepts the job (`packages/features/audio-generation/src/server/music-actions.ts:296`)
- [x] All errors logged with context using structured logging — *audit:* `packages/features/audio-generation/src/server/music-actions.ts:315`, `:595`
- [x] API keys never exposed in logs — *audit:* `SUNO_API_KEY` is passed only to the provider (`packages/features/audio-generation/src/server/music-actions.ts:83`) and never logged
- [x] TypeScript compiles without errors
- [x] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/audio-generation/src/lib/server/mutations/__tests__/music-actions.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateMusicAction, getMusicJobStatusAction } from '../music-actions';

vi.mock('@kit/supabase/server-client');
vi.mock('../helpers/suno-client');

describe('Music Generation Actions', () => {
  describe('generateMusicAction', () => {
    it('should submit music generation request', async () => {
      // Mock Suno API response
      // Assert audio_tracks record created
      // Assert status = 'pending'
      // Assert provider_job_id set
    });

    it('should validate prompt length', async () => {
      await expect(
        generateMusicAction({
          episodeId: 'valid-id',
          prompt: 'short', // too short
          duration: 60,
        })
      ).rejects.toThrow();
    });

    it('should check budget before generation', async () => {
      // Mock insufficient budget
      await expect(
        generateMusicAction({
          episodeId: 'valid-id',
          prompt: 'Epic orchestral music for battle scene',
          duration: 120,
        })
      ).rejects.toThrow('Insufficient budget');
    });

    it('should include genre and mood in tags', async () => {
      // Mock Suno API
      await generateMusicAction({
        episodeId: 'valid-id',
        prompt: 'Epic battle music',
        genre: 'orchestral',
        mood: 'dramatic',
        tempo: 'fast',
      });

      // Assert API called with tags: 'orchestral, dramatic, fast'
    });
  });

  describe('getMusicJobStatusAction', () => {
    it('should return pending status', async () => {
      // Mock track with status='pending'
      const status = await getMusicJobStatusAction({
        audioTrackId: 'valid-id',
      });

      expect(status.status).toBe('pending');
      expect(status.progress).toBe(0);
    });

    it('should return processing status', async () => {
      // Mock track with status='processing'
      const status = await getMusicJobStatusAction({
        audioTrackId: 'valid-id',
      });

      expect(status.status).toBe('processing');
      expect(status.progress).toBe(50);
    });

    it('should return completed status with audio URL', async () => {
      // Mock completed track
      const status = await getMusicJobStatusAction({
        audioTrackId: 'valid-id',
      });

      expect(status.status).toBe('completed');
      expect(status.progress).toBe(100);
      expect(status.audioUrl).toBeTruthy();
    });
  });
});
```

### Integration Tests

**File**: `apps/web/__tests__/integration/music-generation.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { generateMusicAction, getMusicJobStatusAction } from '@kit/audio-generation/server';

describe('Music Generation Integration', () => {
  it('should complete full music generation workflow', async () => {
    // 1. Start music generation
    const job = await generateMusicAction({
      episodeId: testEpisodeId,
      prompt: 'Epic orchestral music for space battle',
      duration: 60,
      genre: 'orchestral',
      mood: 'epic',
    });

    expect(job.audioTrackId).toBeTruthy();
    expect(job.status).toBe('pending');

    // 2. Poll for completion (max 10 minutes)
    let status;
    let attempts = 0;
    do {
      await new Promise(resolve => setTimeout(resolve, 10000));
      status = await getMusicJobStatusAction({
        audioTrackId: job.audioTrackId,
      });
      attempts++;
    } while (
      (status.status === 'pending' || status.status === 'processing') &&
      attempts < 60
    );

    expect(status.status).toBe('completed');
    expect(status.audioUrl).toBeTruthy();
    expect(status.duration).toBeGreaterThan(0);

    // 3. Verify audio file exists
    const response = await fetch(status.audioUrl!);
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
  }, 600000); // 10 minute timeout
});
```

### Manual Testing

1. **Happy Path**
   - Submit music generation request
   - Poll status every 10 seconds
   - Verify status transitions: pending → processing → completed
   - Play audio to verify quality
   - Check metadata stored correctly

2. **Timeout**
   - Mock Suno API to never complete
   - Wait 10 minutes
   - Verify status changes to 'failed'
   - Verify error message: "timed out"

3. **Error Handling**
   - Use invalid API key
   - Verify error returned
   - Check status = 'failed'
   - Verify error stored in metadata

4. **Multiple Tracks**
   - Generate 3 music tracks for same episode
   - Verify all process independently
   - Check all complete successfully
   - Verify costs recorded separately

---

## Security Considerations

### API Key Security

- API keys stored encrypted
- Keys never logged
- Keys retrieved only in server context

### Budget Protection

- Check budget before starting
- Record cost after completion
- Alert if approaching budget limit

### Rate Limiting

- Respect Suno rate limits
- Max 3 concurrent generations per account
- Queue excess requests

---

## Error Handling

### Client-Side Error Display

```typescript
'use client';

import { toast } from '@kit/ui/sonner';
import { generateMusicAction, getMusicJobStatusAction } from '@kit/audio-generation/server';

async function handleMusicGeneration(episodeId: string, prompt: string) {
  try {
    const job = await generateMusicAction({ episodeId, prompt, duration: 60 });
    toast.success('Music generation started. This may take 2-5 minutes.');

    // Poll for status
    const interval = setInterval(async () => {
      const status = await getMusicJobStatusAction({
        audioTrackId: job.audioTrackId,
      });

      if (status.status === 'completed') {
        clearInterval(interval);
        toast.success('Music generated successfully!');
      } else if (status.status === 'failed') {
        clearInterval(interval);
        toast.error(`Music generation failed: ${status.error}`);
      } else {
        toast.info(`Generating music: ${status.progress}%`);
      }
    }, 10000);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('budget')) {
        toast.error('Insufficient budget for music generation.');
      } else {
        toast.error('Failed to start music generation.');
      }
    }
  }
}
```

---

## Performance Considerations

### Polling Optimization

- Use exponential backoff (10s → 30s)
- Reduce API calls to Suno
- Cache status responses briefly

### Storage Optimization

- Compress audio if necessary
- Use CDN for delivery
- Clean up failed generations

---

## Future Enhancements

1. **Multiple Variations**
   - Generate multiple versions of same prompt
   - Let user choose best one

2. **Music Library**
   - Pre-generated music tracks
   - Searchable by genre/mood
   - Reusable across episodes

3. **Audio Mixing**
   - Mix multiple tracks
   - Adjust volume levels
   - Fade in/out effects

4. **Custom Models**
   - Fine-tune Suno model
   - Brand-specific music style
   - Character themes

---

## References

- **FILM-108**: Audio Generation Package
- **Suno API Documentation**: https://suno.ai/api-docs
- **Constitution**: Section 2.2 (Server Actions Pattern)
- **Constitution**: Section 4.2 (API Keys)
- **Constitution**: Section 5.2 (Generation Job Errors)

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Creates a `generation_jobs` record; all actions track in `generation_jobs` | the live actions track status in `audio_tracks.metadata` (`packages/features/audio-generation/src/server/music-actions.ts:230`) — which is what this spec's own Functional Requirement 4 and reference code describe; these two criteria follow the replaced implementation | owner — decide whether music still needs a `generation_jobs` row |
| Calculates progress percentage | Suno's `progress` is relayed as-is (`packages/features/audio-generation/src/server/music-actions.ts:592`) | unassigned |
| Records cost after completion | no cost is written on completion; only an estimate at submit (`packages/features/audio-generation/src/server/music-actions.ts:286`) | unassigned |
| Cancels pending jobs | the live music path has no cancel | unassigned |
