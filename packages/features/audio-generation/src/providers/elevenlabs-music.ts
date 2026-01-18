/**
 * ElevenLabs Music Generation Provider
 *
 * Uses ElevenLabs Eleven Music API for AI music composition.
 * API: elevenlabs.music.compose(prompt, music_length_ms)
 *
 * Note: Unlike Suno, ElevenLabs returns the audio directly (streaming),
 * not a job ID. We handle this by treating completed immediately.
 */
import type {
  MusicGenerationRequest,
  MusicGenerationResponse,
  MusicProviderConfig,
} from '../lib/types';
import { BaseMusicGenerationProvider } from './base';

// ElevenLabs Music constants
export const ELEVENLABS_MUSIC = {
  BASE_URL: 'https://api.elevenlabs.io/v1',
  MAX_DURATION: 300, // 5 minutes max
  MIN_DURATION: 5, // 5 seconds min
  COST_PER_SECOND: 1, // cents per second (estimated)
  SUPPORTED_GENRES: [
    'cinematic',
    'electronic',
    'ambient',
    'orchestral',
    'rock',
    'pop',
    'jazz',
    'lofi',
    'dramatic',
    'uplifting',
  ],
  RATE_LIMITS: {
    REQUESTS_PER_MINUTE: 20,
    CONCURRENT_REQUESTS: 5,
  },
} as const;

/**
 * ElevenLabs Music Generation Provider
 *
 * Generates music using ElevenLabs Eleven Music API.
 * Returns audio directly (synchronous), not job-based.
 */
export class ElevenLabsMusicProvider extends BaseMusicGenerationProvider {
  readonly name = 'elevenlabs-music';
  readonly maxDuration = ELEVENLABS_MUSIC.MAX_DURATION;
  readonly supportsVocals = true;
  readonly supportsInstrumental = true;
  readonly supportedGenres =
    ELEVENLABS_MUSIC.SUPPORTED_GENRES as unknown as string[];

  private readonly baseUrl: string;

  constructor(config: MusicProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? ELEVENLABS_MUSIC.BASE_URL;
  }

  /**
   * Generate music from prompt
   * ElevenLabs returns audio stream directly
   */
  async generateMusic(
    request: MusicGenerationRequest,
  ): Promise<MusicGenerationResponse> {
    this.validateRequest(request);

    try {
      // Build the prompt with genre/mood if provided
      let fullPrompt = request.prompt;
      if (request.genre) {
        fullPrompt = `${request.genre} style: ${fullPrompt}`;
      }
      if (request.mood) {
        fullPrompt = `${request.mood} mood. ${fullPrompt}`;
      }
      if (request.tempo) {
        fullPrompt = `${fullPrompt}. Tempo: ${request.tempo}.`;
      }

      // Duration in milliseconds
      const durationMs = request.duration * 1000;

      // Make API request
      const response = await fetch(`${this.baseUrl}/music/compose`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          music_length_ms: durationMs,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `ElevenLabs Music API error: ${response.status} - ${errorText}`,
        );
      }

      // Get audio buffer
      const audioBuffer = await response.arrayBuffer();

      // Generate a unique job ID for tracking
      const jobId = `11labs-music-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Since ElevenLabs returns audio directly, we return completed status
      // The caller should save the audioBuffer to storage
      return {
        jobId,
        status: 'completed',
        audioUrl: undefined, // Caller will upload buffer and set URL
        duration: request.duration,
        cost: this.estimateCost(request),
        // Store buffer in metadata for caller to handle
        // @ts-expect-error - extending response with buffer
        audioBuffer: Buffer.from(audioBuffer),
      };
    } catch (error) {
      throw this.handleError(error, 'generateMusic');
    }
  }

  /**
   * Get status of a music generation job
   * For ElevenLabs, generation is synchronous, so this always returns completed
   */
  async getStatus(_jobId: string): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed';
    audioUrl?: string;
    progress?: number;
    error?: string;
  }> {
    // ElevenLabs music is synchronous - if we have a jobId, it's done
    return {
      status: 'completed',
      progress: 100,
    };
  }

  /**
   * Estimate cost for music generation (in cents)
   * Based on duration
   */
  estimateCost(request: MusicGenerationRequest): number {
    return request.duration * ELEVENLABS_MUSIC.COST_PER_SECOND;
  }

  /**
   * Get rate limit configuration
   */
  getRateLimits() {
    return {
      requestsPerMinute: ELEVENLABS_MUSIC.RATE_LIMITS.REQUESTS_PER_MINUTE,
      concurrentRequests: ELEVENLABS_MUSIC.RATE_LIMITS.CONCURRENT_REQUESTS,
    };
  }
}
