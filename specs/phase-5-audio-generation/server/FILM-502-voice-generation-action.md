# FILM-502: Voice Generation Server Action

**Phase**: 5
**Priority**: P0
**Effort**: M (3-5 days)
**Dependencies**: FILM-501 (ElevenLabs provider)
**Blocks**: FILM-503, FILM-505, FILM-506

---

## Context

The voice generation server action provides the primary interface for generating voice audio from dialogue text. It orchestrates the complete workflow: validating inputs, calling the ElevenLabs provider, uploading audio to storage, updating database records, and tracking costs.

This action serves as the bridge between the UI components and the voice generation provider. It must handle authentication, budget validation, storage management, and graceful error handling. The action should support both individual dialogue line generation and provide the foundation for batch processing.

---

## Requirements

### Functional Requirements

1. **Voice Generation**
   - Accept dialogue line ID or raw text input
   - Retrieve voice settings from character or voice profile
   - Call ElevenLabs provider with proper parameters
   - Upload generated audio to Supabase Storage
   - Update dialogue_lines.audio_url with storage URL
   - Update dialogue_lines.status (pending → generating → completed/failed)

2. **Storage Management**
   - Upload audio files to Supabase Storage bucket: `audio/dialogue`
   - Use consistent file naming: `{episode_id}/{dialogue_line_id}.mp3`
   - Generate signed URL for audio playback
   - Set appropriate content-type headers
   - Handle upload failures and retries

3. **Cost Tracking**
   - Estimate cost before generation
   - Check account budget before proceeding
   - Record actual cost in generation_metadata
   - Update account usage statistics
   - Block if budget exceeded

4. **Error Handling**
   - Retry transient failures (max 3 retries)
   - Rollback on failure (delete uploaded audio, reset status)
   - Log errors with full context
   - Return user-friendly error messages

5. **Status Management**
   - Update status to 'generating' before API call
   - Update status to 'completed' on success
   - Update status to 'failed' on error
   - Store error message in generation_metadata

### Non-Functional Requirements

- Complete generation within 60 seconds
- Support concurrent generations (up to 5 per account)
- Atomic transactions (all-or-nothing updates)
- Idempotent (safe to retry)
- Comprehensive logging for debugging

---

## Interface

### TypeScript Types

```typescript
// Zod Schemas
import { z } from 'zod';

export const GenerateVoiceSchema = z.object({
  dialogueLineId: z.string().uuid(),
  voiceId: z.string().optional(),
  settings: z.object({
    stability: z.number().min(0).max(1).optional(),
    similarityBoost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    speed: z.number().min(0.5).max(2.0).optional(),
  }).optional(),
  overwriteExisting: z.boolean().default(false),
});

export const GenerateVoiceFromTextSchema = z.object({
  episodeId: z.string().uuid(),
  text: z.string().min(1).max(5000),
  voiceId: z.string(),
  settings: z.object({
    stability: z.number().min(0).max(1).optional(),
    similarityBoost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    speed: z.number().min(0.5).max(2.0).optional(),
  }).optional(),
});

// Return Types
export interface GenerateVoiceResult {
  dialogueLineId: string;
  audioUrl: string;
  duration: number;
  cost: number;
  status: 'completed' | 'failed';
  error?: string;
}

export interface GenerateVoiceFromTextResult {
  audioUrl: string;
  duration: number;
  cost: number;
  format: string;
}

// Database Types
export interface DialogueLine {
  id: string;
  episodeId: string;
  shotId: string | null;
  characterAssetId: string | null;
  text: string;
  sequenceNumber: number;
  audioUrl: string | null;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  generationMetadata: GenerationMetadata | null;
  createdAt: string;
}

export interface GenerationMetadata {
  provider: string;
  providerJobId?: string;
  voiceId: string;
  settings: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speed?: number;
  };
  costCents: number;
  durationSeconds: number;
  generatedAt: string;
  characterCount: number;
  error?: string;
}

export interface VoiceProfile {
  id: string;
  characterAssetId: string;
  provider: string;
  providerVoiceId: string;
  settings: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speed?: number;
  };
}
```

### Server Actions

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { ElevenLabsProvider } from '@kit/audio-generation/providers';
import { GenerateVoiceSchema, GenerateVoiceFromTextSchema } from '../schemas/voice.schema';
import type {
  GenerateVoiceResult,
  GenerateVoiceFromTextResult,
  DialogueLine,
  VoiceProfile,
  GenerationMetadata,
} from '../types/voice.types';

/**
 * Generate voice audio for a dialogue line
 * @throws {Error} If generation fails or budget exceeded
 */
export const generateVoiceAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();
    const adminClient = getSupabaseServerAdminClient();

    // 1. Fetch dialogue line
    const { data: dialogueLine, error: fetchError } = await client
      .from('dialogue_lines')
      .select('*, episodes!inner(id, project_id, account_id)')
      .eq('id', data.dialogueLineId)
      .single();

    if (fetchError || !dialogueLine) {
      throw new Error('Dialogue line not found');
    }

    // 2. Check if already generated
    if (dialogueLine.audio_url && !data.overwriteExisting) {
      throw new Error('Audio already generated. Set overwriteExisting=true to regenerate.');
    }

    // 3. Get voice settings
    const voiceId = data.voiceId ?? await getVoiceIdForCharacter(
      client,
      dialogueLine.character_asset_id
    );

    if (!voiceId) {
      throw new Error('No voice ID specified and character has no voice profile');
    }

    const voiceSettings = data.settings ?? await getVoiceSettings(
      client,
      dialogueLine.character_asset_id
    );

    // 4. Estimate cost and check budget
    const estimatedCost = Math.ceil((dialogueLine.text.length / 1000) * 30);
    await checkBudget(client, dialogueLine.episodes.account_id, estimatedCost);

    // 5. Update status to 'generating'
    await client
      .from('dialogue_lines')
      .update({ status: 'generating' })
      .eq('id', data.dialogueLineId);

    try {
      // 6. Get API key
      const apiKey = await getApiKey(client, dialogueLine.episodes.account_id, 'elevenlabs');

      // 7. Generate audio
      const provider = new ElevenLabsProvider({ apiKey });
      const result = await provider.generateVoice({
        text: dialogueLine.text,
        voiceId,
        settings: voiceSettings,
        outputFormat: 'mp3_44100_128',
      });

      // 8. Upload to storage
      const audioPath = `audio/dialogue/${dialogueLine.episode_id}/${data.dialogueLineId}.mp3`;
      const { error: uploadError } = await adminClient.storage
        .from('audio')
        .upload(audioPath, result.audioBuffer, {
          contentType: 'audio/mpeg',
          upsert: data.overwriteExisting,
        });

      if (uploadError) {
        throw new Error(`Failed to upload audio: ${uploadError.message}`);
      }

      // 9. Get public URL
      const { data: urlData } = adminClient.storage
        .from('audio')
        .getPublicUrl(audioPath);

      // 10. Update dialogue line with audio URL and metadata
      const metadata: GenerationMetadata = {
        provider: 'elevenlabs',
        voiceId: result.metadata.voiceId,
        settings: result.metadata.settings,
        costCents: result.cost,
        durationSeconds: result.duration,
        generatedAt: new Date().toISOString(),
        characterCount: result.characterCount,
      };

      const { error: updateError } = await client
        .from('dialogue_lines')
        .update({
          audio_url: urlData.publicUrl,
          status: 'completed',
          generation_metadata: metadata,
        })
        .eq('id', data.dialogueLineId);

      if (updateError) {
        throw updateError;
      }

      // 11. Record cost
      await recordCost(
        client,
        dialogueLine.episodes.account_id,
        result.cost,
        'voice',
        'elevenlabs',
        data.dialogueLineId
      );

      return {
        dialogueLineId: data.dialogueLineId,
        audioUrl: urlData.publicUrl,
        duration: result.duration,
        cost: result.cost,
        status: 'completed' as const,
      };
    } catch (error) {
      // Rollback: update status to 'failed' and store error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await client
        .from('dialogue_lines')
        .update({
          status: 'failed',
          generation_metadata: {
            provider: 'elevenlabs',
            voiceId,
            settings: voiceSettings,
            error: errorMessage,
            characterCount: dialogueLine.text.length,
            generatedAt: new Date().toISOString(),
          } as GenerationMetadata,
        })
        .eq('id', data.dialogueLineId);

      throw error;
    }
  },
  { schema: GenerateVoiceSchema, auth: true }
);

/**
 * Generate voice audio from raw text (not linked to dialogue line)
 * Useful for voice previews and testing
 * @throws {Error} If generation fails or budget exceeded
 */
export const generateVoiceFromTextAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();
    const adminClient = getSupabaseServerAdminClient();

    // 1. Get episode to find account
    const { data: episode, error: episodeError } = await client
      .from('episodes')
      .select('account_id')
      .eq('id', data.episodeId)
      .single();

    if (episodeError || !episode) {
      throw new Error('Episode not found');
    }

    // 2. Estimate cost and check budget
    const estimatedCost = Math.ceil((data.text.length / 1000) * 30);
    await checkBudget(client, episode.account_id, estimatedCost);

    // 3. Get API key
    const apiKey = await getApiKey(client, episode.account_id, 'elevenlabs');

    // 4. Generate audio
    const provider = new ElevenLabsProvider({ apiKey });
    const result = await provider.generateVoice({
      text: data.text,
      voiceId: data.voiceId,
      settings: data.settings,
      outputFormat: 'mp3_44100_128',
    });

    // 5. Upload to temporary storage
    const tempPath = `audio/temp/${user.id}/${Date.now()}.mp3`;
    const { error: uploadError } = await adminClient.storage
      .from('audio')
      .upload(tempPath, result.audioBuffer, {
        contentType: 'audio/mpeg',
      });

    if (uploadError) {
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }

    // 6. Get public URL
    const { data: urlData } = adminClient.storage
      .from('audio')
      .getPublicUrl(tempPath);

    // 7. Record cost
    await recordCost(
      client,
      episode.account_id,
      result.cost,
      'voice',
      'elevenlabs',
      null
    );

    return {
      audioUrl: urlData.publicUrl,
      duration: result.duration,
      cost: result.cost,
      format: result.format,
    };
  },
  { schema: GenerateVoiceFromTextSchema, auth: true }
);

/**
 * Helper: Get voice ID for a character
 */
async function getVoiceIdForCharacter(
  client: any,
  characterAssetId: string | null
): Promise<string | null> {
  if (!characterAssetId) return null;

  const { data: voiceProfile } = await client
    .from('voice_profiles')
    .select('provider_voice_id')
    .eq('character_asset_id', characterAssetId)
    .eq('provider', 'elevenlabs')
    .single();

  return voiceProfile?.provider_voice_id ?? null;
}

/**
 * Helper: Get voice settings for a character
 */
async function getVoiceSettings(
  client: any,
  characterAssetId: string | null
): Promise<any> {
  if (!characterAssetId) {
    return {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      speed: 1.0,
    };
  }

  const { data: voiceProfile } = await client
    .from('voice_profiles')
    .select('settings')
    .eq('character_asset_id', characterAssetId)
    .eq('provider', 'elevenlabs')
    .single();

  return voiceProfile?.settings ?? {
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0,
    speed: 1.0,
  };
}

/**
 * Helper: Check if account has sufficient budget
 */
async function checkBudget(
  client: any,
  accountId: string,
  estimatedCost: number
): Promise<void> {
  // Get account budget and current usage
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
 * Helper: Get encrypted API key for provider
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

  // Decrypt API key (implementation depends on encryption method)
  // For now, assume encrypted_key is the actual key
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
  // Update account usage
  await client.rpc('increment_account_usage', {
    p_account_id: accountId,
    p_amount_cents: costCents,
  });

  // Record in cost tracking table (if exists)
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
│   │   └── voice.schema.ts              # Zod schemas (CREATE THIS)
│   ├── server/
│   │   ├── mutations/
│   │   │   └── voice-actions.ts         # Main actions (CREATE THIS)
│   │   └── queries/
│   │       └── voice-queries.ts         # Helper queries (CREATE THIS)
│   └── helpers/
│       ├── storage.ts                    # Storage helpers (CREATE THIS)
│       ├── budget.ts                     # Budget helpers (CREATE THIS)
│       └── cost-tracking.ts              # Cost tracking (CREATE THIS)
└── types/
    └── voice.types.ts                    # TypeScript types (CREATE THIS)
```

### Storage Structure

```
Supabase Storage Bucket: audio
├── dialogue/
│   ├── {episode_id}/
│   │   ├── {dialogue_line_id}.mp3
│   │   ├── {dialogue_line_id}.mp3
│   │   └── ...
│   └── ...
└── temp/
    ├── {user_id}/
    │   ├── {timestamp}.mp3
    │   └── ...
    └── ...
```

### Database Updates

The action performs the following database operations:

1. **Read dialogue_lines**: Fetch dialogue line with episode and account info
2. **Read voice_profiles**: Get voice settings for character
3. **Read external_api_keys**: Get encrypted API key
4. **Read accounts**: Check budget availability
5. **Update dialogue_lines**: Set status to 'generating'
6. **Update dialogue_lines**: Set audio_url, status='completed', metadata
7. **Call RPC**: Increment account usage
8. **Insert generation_costs**: Record cost for tracking

### Error Handling Strategy

| Error Type | Action | Rollback | Retry |
|------------|--------|----------|-------|
| Dialogue not found | Throw immediately | No | No |
| Budget exceeded | Throw immediately | No | No |
| API key missing | Throw immediately | No | No |
| Provider error | Set status='failed', store error | Yes | No |
| Upload error | Set status='failed', delete audio | Yes | Yes (3x) |
| Database error | Throw | Yes | Yes (3x) |

### Status Transitions

```
pending → generating → completed
                    → failed
```

- **pending**: Initial state, not yet processed
- **generating**: API call in progress
- **completed**: Audio generated and uploaded successfully
- **failed**: Generation or upload failed (error stored in metadata)

---

## File Changes

### New Files

1. **packages/features/audio-generation/src/lib/schemas/voice.schema.ts**
   - Export all Zod schemas for voice generation
   - Include validation rules and error messages

2. **packages/features/audio-generation/src/lib/server/mutations/voice-actions.ts**
   - Implement generateVoiceAction
   - Implement generateVoiceFromTextAction
   - Include all helper functions

3. **packages/features/audio-generation/src/lib/server/queries/voice-queries.ts**
   - Helper queries for voice profiles
   - Helper queries for dialogue lines
   - Type-safe query builders

4. **packages/features/audio-generation/src/lib/helpers/storage.ts**
   - Storage upload/download helpers
   - Path generation utilities
   - Error handling for storage operations

5. **packages/features/audio-generation/src/lib/helpers/budget.ts**
   - Budget checking functions
   - Cost estimation utilities
   - Budget warning logic

6. **packages/features/audio-generation/src/lib/helpers/cost-tracking.ts**
   - Cost recording functions
   - Usage reporting utilities
   - Budget analytics helpers

7. **packages/features/audio-generation/src/types/voice.types.ts**
   - Export all TypeScript interfaces
   - Database row types
   - API request/response types

### Modified Files

None (new feature)

---

## Acceptance Criteria

### Functional

- [ ] `generateVoiceAction` successfully generates audio for valid dialogue line
- [ ] `generateVoiceAction` uploads audio to correct storage path
- [ ] `generateVoiceAction` updates dialogue_lines.audio_url with public URL
- [ ] `generateVoiceAction` updates dialogue_lines.status to 'completed'
- [ ] `generateVoiceAction` stores generation metadata (cost, duration, settings)
- [ ] `generateVoiceAction` retrieves voice settings from character's voice profile
- [ ] `generateVoiceAction` uses default voice settings if no profile exists
- [ ] `generateVoiceAction` checks budget before generation
- [ ] `generateVoiceAction` throws error if budget exceeded
- [ ] `generateVoiceAction` records cost after successful generation
- [ ] `generateVoiceAction` sets status to 'failed' on error
- [ ] `generateVoiceAction` stores error message in metadata on failure
- [ ] `generateVoiceAction` respects overwriteExisting flag
- [ ] `generateVoiceFromTextAction` generates audio for raw text
- [ ] `generateVoiceFromTextAction` uploads to temp storage
- [ ] `generateVoiceFromTextAction` records cost
- [ ] Both actions enforce authentication
- [ ] Both actions enforce RLS policies

### Non-Functional

- [ ] Actions complete within 60 seconds
- [ ] Database updates are atomic (transaction)
- [ ] Actions are idempotent (safe to retry)
- [ ] All errors logged with context
- [ ] API keys never exposed in logs
- [ ] TypeScript compiles without errors
- [ ] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/audio-generation/src/lib/server/mutations/__tests__/voice-actions.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateVoiceAction, generateVoiceFromTextAction } from '../voice-actions';

// Mock dependencies
vi.mock('@kit/supabase/server-client');
vi.mock('@kit/supabase/server-admin-client');
vi.mock('@kit/audio-generation/providers');

describe('Voice Generation Actions', () => {
  describe('generateVoiceAction', () => {
    it('should generate voice for valid dialogue line', async () => {
      // Mock dialogue line fetch
      // Mock voice profile fetch
      // Mock provider generation
      // Mock storage upload
      // Assert status updated to 'completed'
      // Assert audio_url set
      // Assert metadata stored
    });

    it('should throw error if dialogue line not found', async () => {
      // Mock null dialogue line
      await expect(
        generateVoiceAction({
          dialogueLineId: 'non-existent-id',
        })
      ).rejects.toThrow('Dialogue line not found');
    });

    it('should throw error if budget exceeded', async () => {
      // Mock account with insufficient budget
      await expect(
        generateVoiceAction({
          dialogueLineId: 'valid-id',
        })
      ).rejects.toThrow('Insufficient budget');
    });

    it('should throw error if already generated without overwrite flag', async () => {
      // Mock dialogue line with existing audio_url
      await expect(
        generateVoiceAction({
          dialogueLineId: 'valid-id',
          overwriteExisting: false,
        })
      ).rejects.toThrow('Audio already generated');
    });

    it('should regenerate if overwriteExisting=true', async () => {
      // Mock dialogue line with existing audio_url
      // Mock provider generation
      // Assert new audio generated
      // Assert storage upload with upsert=true
    });

    it('should use character voice profile settings', async () => {
      // Mock dialogue line with character_asset_id
      // Mock voice profile with custom settings
      // Assert provider called with custom settings
    });

    it('should use default settings if no voice profile', async () => {
      // Mock dialogue line without character_asset_id
      // Assert provider called with default settings
    });

    it('should set status to failed on provider error', async () => {
      // Mock provider error
      // Assert status set to 'failed'
      // Assert error stored in metadata
    });

    it('should set status to failed on upload error', async () => {
      // Mock successful generation
      // Mock storage upload error
      // Assert status set to 'failed'
    });

    it('should record cost after successful generation', async () => {
      // Mock successful generation
      // Assert recordCost called with correct amount
      // Assert account usage incremented
    });
  });

  describe('generateVoiceFromTextAction', () => {
    it('should generate voice from raw text', async () => {
      // Mock episode fetch
      // Mock provider generation
      // Mock storage upload to temp path
      // Assert audio URL returned
    });

    it('should check budget before generation', async () => {
      // Mock account with insufficient budget
      await expect(
        generateVoiceFromTextAction({
          episodeId: 'valid-id',
          text: 'Test text',
          voiceId: 'voice-123',
        })
      ).rejects.toThrow('Insufficient budget');
    });

    it('should upload to temp storage', async () => {
      // Mock successful generation
      // Assert storage.upload called with temp path
      // Assert path includes user ID and timestamp
    });

    it('should record cost', async () => {
      // Mock successful generation
      // Assert recordCost called
      // Assert account usage incremented
    });
  });
});
```

### Integration Tests

**File**: `apps/web/__tests__/integration/voice-generation.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { generateVoiceAction } from '@kit/audio-generation/server';

describe('Voice Generation Integration', () => {
  let testEpisodeId: string;
  let testDialogueLineId: string;

  beforeAll(async () => {
    // Setup test data
    // Create test episode
    // Create test dialogue line
  });

  afterAll(async () => {
    // Cleanup test data
  });

  it('should complete full voice generation workflow', async () => {
    // 1. Generate voice for dialogue line
    const result = await generateVoiceAction({
      dialogueLineId: testDialogueLineId,
    });

    expect(result.status).toBe('completed');
    expect(result.audioUrl).toBeTruthy();
    expect(result.cost).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);

    // 2. Verify database updated
    const client = createClient(/* ... */);
    const { data: dialogueLine } = await client
      .from('dialogue_lines')
      .select('*')
      .eq('id', testDialogueLineId)
      .single();

    expect(dialogueLine.status).toBe('completed');
    expect(dialogueLine.audio_url).toBe(result.audioUrl);
    expect(dialogueLine.generation_metadata).toBeTruthy();
    expect(dialogueLine.generation_metadata.costCents).toBe(result.cost);

    // 3. Verify audio file exists in storage
    const { data: file } = await client.storage
      .from('audio')
      .download(`dialogue/${testEpisodeId}/${testDialogueLineId}.mp3`);

    expect(file).toBeTruthy();
    expect(file.size).toBeGreaterThan(0);
  });

  it('should respect budget limits', async () => {
    // Set very low budget
    // Attempt generation
    // Verify error thrown
    // Verify status not changed
  });

  it('should handle provider failures gracefully', async () => {
    // Mock provider error
    // Attempt generation
    // Verify status set to 'failed'
    // Verify error stored
  });
});
```

### Manual Testing

1. **Happy Path**
   - Create dialogue line in database
   - Call `generateVoiceAction` with dialogue line ID
   - Verify audio generated and uploaded
   - Play audio to verify quality
   - Check database for updated fields

2. **Budget Validation**
   - Set account budget to $1.00
   - Generate voice for long text (>4000 chars)
   - Verify budget error thrown
   - Verify no audio generated

3. **Voice Settings**
   - Create voice profile for character
   - Set custom stability, similarity_boost
   - Generate voice for dialogue line
   - Verify settings applied (compare audio quality)

4. **Error Recovery**
   - Disconnect internet during generation
   - Verify status set to 'failed'
   - Verify error message stored
   - Retry generation
   - Verify successful recovery

5. **Overwrite Existing**
   - Generate audio for dialogue line
   - Regenerate without overwriteExisting flag
   - Verify error thrown
   - Regenerate with overwriteExisting=true
   - Verify new audio generated

---

## Security Considerations

### Authentication & Authorization

- All actions require authenticated user
- RLS policies enforce project access control
- API keys retrieved only for authorized accounts
- User cannot generate voice for other accounts' episodes

### API Key Security

- API keys stored encrypted in database
- Keys never logged or exposed in responses
- Keys decrypted only in server context
- Rotate keys periodically

### Budget Protection

- Check budget before every generation
- Atomic budget updates (RPC function)
- Alert at 80% budget threshold
- Block at 100% budget threshold
- Log all cost events for auditing

### Storage Security

- Audio files stored in authenticated bucket
- RLS policies on storage bucket
- No direct public access (signed URLs only)
- Temporary files auto-deleted after 24 hours

---

## Error Handling

### Client-Side Error Display

```typescript
'use client';

import { toast } from '@kit/ui/sonner';
import { generateVoiceAction } from '@kit/audio-generation/server';

async function handleGenerateVoice(dialogueLineId: string) {
  try {
    const result = await generateVoiceAction({ dialogueLineId });
    toast.success('Voice generated successfully!');
    return result;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('budget')) {
        toast.error('Insufficient budget. Please upgrade your plan or add credits.');
      } else if (error.message.includes('already generated')) {
        toast.error('Audio already exists. Use regenerate to create new audio.');
      } else if (error.message.includes('not found')) {
        toast.error('Dialogue line not found.');
      } else if (error.message.includes('API key')) {
        toast.error('Voice generation service not configured. Please add your API key.');
      } else {
        toast.error('Failed to generate voice. Please try again.');
      }
    }
    throw error;
  }
}
```

---

## Performance Considerations

### Concurrent Generations

```typescript
// Limit concurrent generations per account
const MAX_CONCURRENT_GENERATIONS = 5;

// Check active generations before starting new one
const { count } = await client
  .from('dialogue_lines')
  .select('id', { count: 'exact', head: true })
  .eq('status', 'generating');

if (count >= MAX_CONCURRENT_GENERATIONS) {
  throw new Error('Too many concurrent generations. Please wait for current generations to complete.');
}
```

### Storage Optimization

- Use MP3 compression (128 kbps default)
- Clean up temporary files after 24 hours
- Implement CDN caching for audio playback
- Generate waveform thumbnails for preview

### Database Optimization

- Index on dialogue_lines.status for filtering
- Index on dialogue_lines.episode_id for batch queries
- Use RPC function for atomic budget updates
- Batch cost recording for multiple generations

---

## Future Enhancements

1. **Batch Generation**
   - Generate multiple dialogue lines in parallel
   - Progress tracking for batch jobs
   - Resume failed batch generations

2. **Voice Caching**
   - Cache generated audio for identical text+voice combinations
   - Save costs on repeated dialogue

3. **Audio Post-Processing**
   - Normalize audio levels
   - Add background noise reduction
   - Apply audio effects (reverb, EQ)

4. **Preview Generation**
   - Generate short preview before full generation
   - Allow user to approve/reject before committing

5. **Cost Optimization**
   - Use cheaper models for draft generations
   - Upgrade to premium models for final output
   - Automatic model selection based on quality requirements

---

## References

- **FILM-501**: ElevenLabs Provider
- **FILM-108**: Audio Generation Package
- **Constitution**: Section 2.2 (Server Actions Pattern)
- **Constitution**: Section 4.2 (API Keys)
- **Constitution**: Section 5.2 (Generation Job Errors)
- **Constitution**: Section 6 (Cost Tracking)
- **Supabase Storage Documentation**: https://supabase.com/docs/guides/storage
