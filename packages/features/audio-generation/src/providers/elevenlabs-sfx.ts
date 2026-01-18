/**
 * ElevenLabs Sound Effects Provider
 *
 * Uses ElevenLabs Text-to-Sound-Effects API for AI SFX generation.
 * API: elevenlabs.text_to_sound_effects.convert(text)
 *
 * Returns audio directly (streaming), not job-based.
 */
import type { MusicProviderConfig } from '../lib/types';

// ElevenLabs SFX constants
export const ELEVENLABS_SFX = {
  BASE_URL: 'https://api.elevenlabs.io/v1',
  MAX_PROMPT_LENGTH: 500,
  DEFAULT_DURATION: 5, // seconds
  MAX_DURATION: 22, // seconds (API limit)
  COST_PER_GENERATION: 5, // cents per SFX generation
  RATE_LIMITS: {
    REQUESTS_PER_MINUTE: 30,
    CONCURRENT_REQUESTS: 10,
  },
} as const;

/**
 * SFX generation request
 */
export interface SfxGenerationRequest {
  /** Text description of the sound effect */
  text: string;
  /** Duration hint in seconds (optional, max 22s) */
  durationSeconds?: number;
}

/**
 * SFX generation response
 */
export interface SfxGenerationResponse {
  /** Local job ID for tracking */
  jobId: string;
  /** Status (always completed for ElevenLabs sync API) */
  status: 'completed' | 'failed';
  /** Audio buffer (MP3) */
  audioBuffer?: Buffer;
  /** Duration in seconds */
  duration?: number;
  /** Estimated cost in cents */
  cost: number;
  /** Error message if failed */
  error?: string;
}

/**
 * ElevenLabs Sound Effects Provider
 *
 * Generates sound effects from text descriptions.
 * Returns audio directly (synchronous).
 */
export class ElevenLabsSfxProvider {
  readonly name = 'elevenlabs-sfx';

  private readonly config: MusicProviderConfig;
  private readonly baseUrl: string;

  constructor(config: MusicProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? ELEVENLABS_SFX.BASE_URL;
  }

  /**
   * Generate sound effect from text description
   */
  async generateSfx(
    request: SfxGenerationRequest,
  ): Promise<SfxGenerationResponse> {
    // Validate request
    if (!request.text || request.text.trim().length === 0) {
      throw new Error('Text description is required');
    }

    if (request.text.length > ELEVENLABS_SFX.MAX_PROMPT_LENGTH) {
      throw new Error(
        `Text exceeds maximum length of ${ELEVENLABS_SFX.MAX_PROMPT_LENGTH} characters`,
      );
    }

    if (
      request.durationSeconds &&
      request.durationSeconds > ELEVENLABS_SFX.MAX_DURATION
    ) {
      throw new Error(
        `Duration exceeds maximum of ${ELEVENLABS_SFX.MAX_DURATION} seconds`,
      );
    }

    try {
      // Make API request
      const response = await fetch(`${this.baseUrl}/sound-generation`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: request.text,
          duration_seconds: request.durationSeconds,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `ElevenLabs SFX API error: ${response.status} - ${errorText}`,
        );
      }

      // Get audio buffer
      const audioBuffer = await response.arrayBuffer();

      // Generate a unique job ID
      const jobId = `11labs-sfx-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      return {
        jobId,
        status: 'completed',
        audioBuffer: Buffer.from(audioBuffer),
        duration: request.durationSeconds ?? ELEVENLABS_SFX.DEFAULT_DURATION,
        cost: this.estimateCost(),
      };
    } catch (error) {
      const jobId = `11labs-sfx-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      return {
        jobId,
        status: 'failed',
        cost: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Estimate cost for SFX generation (in cents)
   */
  estimateCost(): number {
    return ELEVENLABS_SFX.COST_PER_GENERATION;
  }

  /**
   * Get rate limit configuration
   */
  getRateLimits() {
    return {
      requestsPerMinute: ELEVENLABS_SFX.RATE_LIMITS.REQUESTS_PER_MINUTE,
      concurrentRequests: ELEVENLABS_SFX.RATE_LIMITS.CONCURRENT_REQUESTS,
    };
  }
}
