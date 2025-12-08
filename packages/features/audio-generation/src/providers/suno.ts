import { SUNO } from '../lib/constants';
import type {
  MusicGenerationRequest,
  MusicGenerationResponse,
  MusicProviderConfig,
} from '../lib/types';
import { BaseMusicGenerationProvider } from './base';

/**
 * Suno music generation provider
 * Full song generation with AI vocals and lyrics
 *
 * Full implementation will be done in FILM-509
 */
export class SunoProvider extends BaseMusicGenerationProvider {
  readonly name = 'suno';
  readonly maxDuration = SUNO.MAX_DURATION;
  readonly supportsVocals = true;
  readonly supportsInstrumental = true;
  readonly supportedGenres = SUNO.SUPPORTED_GENRES as unknown as string[];

  private readonly baseUrl: string;

  constructor(config: MusicProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? SUNO.BASE_URL;
  }

  /**
   * Generate music from prompt
   */
  async generateMusic(
    request: MusicGenerationRequest,
  ): Promise<MusicGenerationResponse> {
    this.validateRequest(request);

    try {
      interface SunoGenerationResponse {
        id: string;
        status: string;
        audio_url?: string;
        estimated_time?: number;
      }

      const response = await this.makeRequestWithRetry<SunoGenerationResponse>(
        `${this.baseUrl}/v1/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            prompt: request.prompt,
            duration: request.duration,
            genre: request.genre,
            mood: request.mood,
            tempo: request.tempo,
            instrumental: request.instrumentalOnly ?? false,
            tags: request.tags,
          }),
        },
      );

      return {
        jobId: response.id,
        status: this.mapStatus(response.status),
        audioUrl: response.audio_url,
        estimatedTime: response.estimated_time,
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
      interface SunoStatusResponse {
        status: string;
        audio_url?: string;
        progress?: number;
        error?: string;
      }

      const response = await this.makeRequestWithRetry<SunoStatusResponse>(
        `${this.baseUrl}/v1/status/${jobId}`,
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
        error: response.error,
      };
    } catch (error) {
      throw this.handleError(error, 'getStatus');
    }
  }

  /**
   * Estimate cost for music generation (in cents)
   * Suno pricing: ~$0.50 per generation
   */
  estimateCost(_request: MusicGenerationRequest): number {
    return SUNO.COST_PER_GENERATION;
  }

  /**
   * Get rate limit configuration
   */
  getRateLimits() {
    return {
      requestsPerMinute: 5,
      concurrentRequests: 2,
      dailyLimit: 50,
    };
  }

  /**
   * Map Suno status to our standard status
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
