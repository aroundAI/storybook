import { UDIO } from '../lib/constants';
import type {
  MusicGenerationRequest,
  MusicGenerationResponse,
  MusicProviderConfig,
} from '../lib/types';
import { BaseMusicGenerationProvider } from './base';

/**
 * Udio API response types
 */
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

/**
 * Request types for Udio-specific features
 */
export interface UdioExtendSongRequest {
  songId: string;
  prompt?: string;
  fromTimestamp?: number;
}

export interface UdioGenerationMetadata {
  title?: string;
  genre?: string;
  mood?: string;
  lyrics?: string;
  bpm?: number;
}

export interface UdioExtendedStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audioUrl?: string;
  progress?: number;
  duration?: number;
  metadata?: UdioGenerationMetadata;
  error?: string;
}

/**
 * Udio music generation provider
 * High-quality AI music generation with support for vocals, extensions, and variations
 *
 * Key features:
 * - Full songs with vocals or instrumental
 * - Song extensions (continue existing generations)
 * - Song variations (create alternatives)
 * - Lower cost per generation than Suno
 *
 * Limitations:
 * - Max duration: 2 minutes (vs Suno's 4 minutes)
 * - API availability may be limited
 */
export class UdioProvider extends BaseMusicGenerationProvider {
  readonly name = 'udio';
  readonly maxDuration = UDIO.MAX_DURATION;
  readonly supportsVocals = true;
  readonly supportsInstrumental = true;
  readonly supportedGenres = UDIO.SUPPORTED_GENRES as unknown as string[];

  private readonly baseUrl: string;

  constructor(config: MusicProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? UDIO.BASE_URL;
  }

  /**
   * Generate music from prompt
   */
  async generateMusic(
    request: MusicGenerationRequest,
  ): Promise<MusicGenerationResponse> {
    this.validateRequest(request);

    // Validate Udio-specific constraints
    if (request.prompt.length > UDIO.MAX_PROMPT_LENGTH) {
      throw new Error(
        `Prompt exceeds Udio maximum of ${UDIO.MAX_PROMPT_LENGTH} characters`,
      );
    }

    try {
      const response = await this.makeRequestWithRetry<UdioTaskResponse>(
        `${this.baseUrl}/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            prompt: request.prompt,
            duration_seconds: request.duration,
            genre: request.genre,
            mood: request.mood,
            tempo: request.tempo,
            instrumental: request.instrumentalOnly ?? false,
            tags: request.tags,
          }),
        },
      );

      return {
        jobId: response.task_id,
        status: this.mapStatus(response.status),
        estimatedTime: UDIO.TYPICAL_PROCESSING_TIME,
        cost: this.estimateCost(request),
      };
    } catch (error) {
      throw this.handleError(error, 'generateMusic');
    }
  }

  /**
   * Get status of a music generation job
   */
  async getStatus(jobId: string): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed';
    audioUrl?: string;
    progress?: number;
    error?: string;
  }> {
    try {
      const response = await this.makeRequestWithRetry<UdioStatusResponse>(
        `${this.baseUrl}/tasks/${jobId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
        },
      );

      return {
        status: this.mapStatus(response.status),
        audioUrl: response.audio_url,
        progress: response.progress,
        error: response.error_message,
      };
    } catch (error) {
      throw this.handleError(error, 'getStatus');
    }
  }

  /**
   * Get extended status with metadata (Udio-specific)
   */
  async getExtendedStatus(jobId: string): Promise<UdioExtendedStatus> {
    try {
      const response = await this.makeRequestWithRetry<UdioStatusResponse>(
        `${this.baseUrl}/tasks/${jobId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
        },
      );

      return {
        status: this.mapStatus(response.status),
        audioUrl: response.audio_url,
        progress: response.progress,
        duration: response.duration,
        metadata: {
          title: response.title,
          genre: response.genre,
          mood: response.mood,
          lyrics: response.lyrics,
          bpm: response.bpm,
        },
        error: response.error_message,
      };
    } catch (error) {
      throw this.handleError(error, 'getExtendedStatus');
    }
  }

  /**
   * Extend an existing song (Udio-specific feature)
   * Continues generation from existing audio
   */
  async extendSong(
    request: UdioExtendSongRequest,
  ): Promise<MusicGenerationResponse> {
    try {
      const response = await this.makeRequestWithRetry<UdioTaskResponse>(
        `${this.baseUrl}/extend`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            song_id: request.songId,
            prompt: request.prompt,
            from_timestamp: request.fromTimestamp,
          }),
        },
      );

      return {
        jobId: response.task_id,
        status: this.mapStatus(response.status),
        estimatedTime: 30, // Extensions are faster
        cost: UDIO.COST_PER_EXTENSION,
      };
    } catch (error) {
      throw this.handleError(error, 'extendSong');
    }
  }

  /**
   * Generate variations of an existing song (Udio-specific feature)
   */
  async getVariations(
    songId: string,
    count: number = 3,
  ): Promise<MusicGenerationResponse[]> {
    try {
      const response = await this.makeRequestWithRetry<{
        variations: UdioTaskResponse[];
      }>(`${this.baseUrl}/songs/${songId}/variations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ count }),
      });

      return response.variations.map((v) => ({
        jobId: v.task_id,
        status: this.mapStatus(v.status),
        estimatedTime: UDIO.TYPICAL_PROCESSING_TIME,
        cost: UDIO.COST_PER_GENERATION,
      }));
    } catch (error) {
      throw this.handleError(error, 'getVariations');
    }
  }

  /**
   * Cancel a generation in progress (Udio-specific feature)
   */
  async cancelGeneration(taskId: string): Promise<void> {
    try {
      await this.makeRequestWithRetry<{ success: boolean }>(
        `${this.baseUrl}/tasks/${taskId}/cancel`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
        },
      );
    } catch (error) {
      throw this.handleError(error, 'cancelGeneration');
    }
  }

  /**
   * Estimate cost for music generation (in cents)
   * Udio pricing: $0.40 per generation
   */
  estimateCost(_request: MusicGenerationRequest): number {
    return UDIO.COST_PER_GENERATION;
  }

  /**
   * Estimate cost for song extension (in cents)
   */
  estimateExtensionCost(): number {
    return UDIO.COST_PER_EXTENSION;
  }

  /**
   * Get rate limit configuration
   */
  getRateLimits() {
    return {
      requestsPerMinute: UDIO.RATE_LIMITS.REQUESTS_PER_MINUTE,
      concurrentRequests: UDIO.RATE_LIMITS.CONCURRENT_REQUESTS,
      dailyLimit: 100, // Approximate
    };
  }

  /**
   * Map Udio status to our standard status
   */
  private mapStatus(
    status: string,
  ): 'pending' | 'processing' | 'completed' | 'failed' {
    const statusMap: Record<
      string,
      'pending' | 'processing' | 'completed' | 'failed'
    > = {
      queued: 'pending',
      pending: 'pending',
      processing: 'processing',
      generating: 'processing',
      running: 'processing',
      complete: 'completed',
      completed: 'completed',
      done: 'completed',
      success: 'completed',
      failed: 'failed',
      error: 'failed',
    };

    return statusMap[status.toLowerCase()] ?? 'pending';
  }
}
