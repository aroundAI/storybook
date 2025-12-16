# FILM-501b: PlayHT Voice Generation Provider

## Status: DONE

- **Implementation Date:** 2025-12-11
- **PR:** https://github.com/aroundAI/storybook/pull/88

## Metadata
- **Phase:** 5 - Audio Generation
- **Priority:** P1 (Secondary Provider)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-108 (Audio Generation Package), FILM-502b (Audio Provider Factory)
- **Blocks:** None (alternative to ElevenLabs)

---

## Context

PlayHT is a cost-effective alternative to ElevenLabs for AI voice generation. It offers competitive quality with lower pricing, making it ideal for budget-conscious creators and high-volume voice generation needs. PlayHT also supports voice cloning and multiple languages.

**Provider Selection Criteria:**
- **ElevenLabs (Primary)**: Premium quality, best voice cloning, higher cost
- **PlayHT (Secondary)**: Good quality, better pricing, solid voice cloning
- **Google Cloud TTS (Budget)**: Basic quality, lowest cost, no cloning
- **Azure TTS (Enterprise)**: Enterprise features, compliance requirements

---

## Specification

### Requirements

1. **Text-to-Speech Generation**
   - Support PlayHT's ultra-realistic voices
   - Accept text, voice ID, and voice settings
   - Support streaming audio response
   - Return audio buffer or stream

2. **Voice Cloning**
   - Clone voices from audio samples
   - Minimum 30 seconds of sample audio
   - Support multiple cloned voices per account

3. **Voice Library**
   - List available stock voices
   - List user's cloned voices
   - Filter by language, gender, style

4. **Voice Settings**
   - Speed control (0.5x - 2.0x)
   - Temperature (emotion variance)
   - Quality selection (draft, standard, premium)

### Platform Limits

```typescript
export const PLAYHT_LIMITS = {
  text: {
    maxLength: 10000, // characters per request
    minLength: 1,
  },
  audio: {
    formats: ['mp3', 'wav', 'ogg', 'mulaw'],
    sampleRates: [8000, 16000, 24000, 44100, 48000],
    defaultFormat: 'mp3',
    defaultSampleRate: 24000,
  },
  api: {
    requestsPerMinute: 100,
    concurrentRequests: 10,
    timeout: 60000, // 60 seconds
  },
  cloning: {
    minSampleDuration: 30, // seconds
    maxSampleDuration: 300,
    maxClonesPerAccount: 10,
  },
  pricing: {
    perCharacter: 0.0002, // $0.20 per 1000 characters
    cloningPerVoice: 500, // cents ($5 one-time)
  },
};
```

### Provider Implementation

```typescript
// packages/features/audio-generation/src/providers/playht/playht-provider.ts

import { z } from 'zod';
import { BaseVoiceGenerationProvider } from '../base';
import type {
  VoiceGenerationRequest,
  VoiceGenerationResponse,
  Voice,
  VoiceProviderConfig,
} from '../types';

// Zod Schemas
export const PlayHTVoiceSettingsSchema = z.object({
  speed: z.number().min(0.5).max(2.0).default(1.0),
  temperature: z.number().min(0).max(2).default(1.0),
  quality: z.enum(['draft', 'standard', 'premium']).default('standard'),
  sampleRate: z.number().default(24000),
  format: z.enum(['mp3', 'wav', 'ogg', 'mulaw']).default('mp3'),
});

export const PlayHTGenerationRequestSchema = z.object({
  text: z.string().min(1).max(10000),
  voiceId: z.string(),
  settings: PlayHTVoiceSettingsSchema.optional(),
});

export interface PlayHTProviderConfig extends VoiceProviderConfig {
  apiKey: string;
  userId: string;
  baseUrl?: string;
}

export class PlayHTProvider extends BaseVoiceGenerationProvider {
  readonly name = 'playht';
  readonly supportedLanguages = [
    'en-US', 'en-GB', 'en-AU', 'es-ES', 'es-MX', 'fr-FR', 'de-DE',
    'it-IT', 'pt-BR', 'pt-PT', 'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW',
    'hi-IN', 'ar-SA', 'nl-NL', 'pl-PL', 'ru-RU', 'tr-TR',
  ];
  readonly supportsCloning = true;

  private config: PlayHTProviderConfig;
  private baseUrl: string;

  constructor(config: PlayHTProviderConfig) {
    super();
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.play.ht/api/v2';
  }

  /**
   * Generate speech from text
   */
  async generateVoice(request: VoiceGenerationRequest): Promise<VoiceGenerationResponse> {
    const validated = PlayHTGenerationRequestSchema.parse(request);

    const payload = {
      text: validated.text,
      voice: validated.voiceId,
      output_format: validated.settings?.format || 'mp3',
      sample_rate: validated.settings?.sampleRate || 24000,
      speed: validated.settings?.speed || 1.0,
      temperature: validated.settings?.temperature || 1.0,
      quality: validated.settings?.quality || 'standard',
    };

    const response = await this.makeRequest<PlayHTGenerationResponse>(
      '/tts',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    // PlayHT returns a URL to the generated audio
    return {
      audioUrl: response.audioUrl,
      duration: response.duration,
      format: validated.settings?.format || 'mp3',
      sampleRate: validated.settings?.sampleRate || 24000,
      characterCount: validated.text.length,
    };
  }

  /**
   * Generate speech as stream (for real-time playback)
   */
  async generateVoiceStream(request: VoiceGenerationRequest): Promise<ReadableStream<Uint8Array>> {
    const validated = PlayHTGenerationRequestSchema.parse(request);

    const payload = {
      text: validated.text,
      voice: validated.voiceId,
      output_format: 'mp3',
      speed: validated.settings?.speed || 1.0,
      temperature: validated.settings?.temperature || 1.0,
    };

    const response = await fetch(`${this.baseUrl}/tts/stream`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'X-User-ID': this.config.userId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`PlayHT streaming error: ${response.statusText}`);
    }

    return response.body!;
  }

  /**
   * List available voices
   */
  async getVoices(): Promise<Voice[]> {
    const response = await this.makeRequest<{ voices: PlayHTVoice[] }>(
      '/voices',
      { method: 'GET' }
    );

    return response.voices.map(voice => ({
      id: voice.id,
      name: voice.name,
      language: voice.language,
      gender: voice.gender,
      previewUrl: voice.sample,
      isCloned: voice.isCloned || false,
      provider: 'playht',
      metadata: {
        style: voice.style,
        accent: voice.accent,
        age: voice.age,
      },
    }));
  }

  /**
   * Get user's cloned voices
   */
  async getClonedVoices(): Promise<Voice[]> {
    const response = await this.makeRequest<{ voices: PlayHTVoice[] }>(
      '/cloned-voices',
      { method: 'GET' }
    );

    return response.voices.map(voice => ({
      id: voice.id,
      name: voice.name,
      language: voice.language || 'en-US',
      gender: voice.gender || 'neutral',
      previewUrl: voice.sample,
      isCloned: true,
      provider: 'playht',
    }));
  }

  /**
   * Clone a voice from audio sample
   */
  async cloneVoice(
    name: string,
    audioFile: File | Buffer,
    options?: { language?: string }
  ): Promise<Voice> {
    const formData = new FormData();
    formData.append('voice_name', name);
    formData.append('sample_file', audioFile instanceof File ? audioFile : new Blob([audioFile]));

    if (options?.language) {
      formData.append('language', options.language);
    }

    const response = await fetch(`${this.baseUrl}/cloned-voices/instant`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'X-User-ID': this.config.userId,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Voice cloning failed: ${error.message || response.statusText}`);
    }

    const data = await response.json();

    return {
      id: data.id,
      name: data.name,
      language: options?.language || 'en-US',
      gender: 'neutral',
      isCloned: true,
      provider: 'playht',
    };
  }

  /**
   * Delete a cloned voice
   */
  async deleteClonedVoice(voiceId: string): Promise<void> {
    await this.makeRequest(
      `/cloned-voices/${voiceId}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Estimate cost for voice generation
   */
  estimateCost(request: VoiceGenerationRequest): number {
    const text = request.text || '';
    const charCount = text.length;
    return Math.ceil(charCount * PLAYHT_LIMITS.pricing.perCharacter);
  }

  /**
   * Get rate limit configuration
   */
  getRateLimits() {
    return {
      requestsPerMinute: PLAYHT_LIMITS.api.requestsPerMinute,
      concurrentRequests: PLAYHT_LIMITS.api.concurrentRequests,
      dailyLimit: undefined, // No daily limit
    };
  }

  /**
   * Make HTTP request to PlayHT API
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'X-User-ID': this.config.userId,
        'Content-Type': 'application/json',
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
        throw new Error('CREDIT_ERROR: Insufficient PlayHT credits.');
      }
      if (response.status === 401) {
        throw new Error('AUTH_ERROR: Invalid API key or user ID.');
      }

      throw new Error(`PlayHT API error: ${error.message || response.statusText}`);
    }

    return response.json();
  }
}

// Response types
interface PlayHTGenerationResponse {
  audioUrl: string;
  duration: number;
  message?: string;
}

interface PlayHTVoice {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  sample?: string;
  isCloned?: boolean;
  style?: string;
  accent?: string;
  age?: string;
}
```

---

## File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/audio-generation/src/providers/playht/playht-provider.ts` |
| CREATE | `packages/features/audio-generation/src/providers/playht/types.ts` |
| CREATE | `packages/features/audio-generation/src/providers/playht/constants.ts` |
| CREATE | `packages/features/audio-generation/src/providers/playht/index.ts` |
| CREATE | `packages/features/audio-generation/__tests__/playht-provider.test.ts` |
| MODIFY | `packages/features/audio-generation/src/providers/index.ts` (export PlayHT) |
| MODIFY | `packages/features/audio-generation/src/providers/registry.ts` (register PlayHT provider) |

---

## Acceptance Criteria

- [x] `generateVoice()` successfully generates audio from text
- [x] `generateVoiceStream()` returns streaming audio response
- [x] `getVoices()` returns list of available stock voices
- [x] `getClonedVoices()` returns user's cloned voices
- [x] `cloneVoice()` creates new voice from audio sample
- [x] `deleteClonedVoice()` removes cloned voice
- [x] `estimateCost()` returns accurate cost estimate
- [x] Provider registered in audio factory registry
- [x] Error handling for rate limits, auth errors, credit errors

---

## Test Plan

### Unit Tests
- [x] Test text validation (min/max length)
- [x] Test voice settings schema validation
- [x] Test cost estimation calculation
- [x] Test error response parsing
- [x] Test voice mapping function

### Integration Tests
- [x] Test full generation flow with mock API
- [x] Test streaming response handling
- [x] Test voice cloning flow
- [x] Test voice listing with filtering

---

## Pricing Comparison

| Feature | ElevenLabs | PlayHT | Savings |
|---------|------------|--------|---------|
| Per 1K chars | $0.30 | $0.20 | 33% |
| Voice cloning | $99/mo | $5/voice | Variable |
| Streaming | Yes | Yes | - |
| Languages | 29 | 20+ | - |
| Max chars/request | 5000 | 10000 | 2x |

---

## Use Cases

**Best for:**
- High-volume voice generation (cost savings)
- Projects needing longer text per request
- Budget-conscious creators
- Experimentation and prototyping

**Not ideal for:**
- Maximum voice quality requirements
- Specific accent/style needs only in ElevenLabs
- Projects requiring ElevenLabs-specific features

---

## Registry Entry

```typescript
// Add to FILM-502b audio provider factory
[
  'playht',
  {
    metadata: {
      name: 'playht',
      displayName: 'PlayHT',
      description: 'Cost-effective AI voice generation with cloning support',
      supportedLanguages: ['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE', ...],
      supportsCloning: true,
      supportsStreaming: true,
      costPer1KChars: 20, // cents
    },
    factory: (config) => new PlayHTProvider(config),
  },
]
```

---

## References

- **FILM-501**: ElevenLabs Provider (pattern reference)
- **FILM-502b**: Audio Provider Factory
- **PlayHT API Docs**: https://docs.play.ht/reference/api-getting-started
