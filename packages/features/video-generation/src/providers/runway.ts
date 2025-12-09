import 'server-only';

import { type CacheClient, createCacheClient } from '@kit/cache';
import { getLogger } from '@kit/shared/logger';

import { PROVIDER_CAPABILITIES } from '../lib/constants';
import { RunwayGenerationRequestSchema } from '../lib/runway-schemas';
import type {
  RunwayAPIGenerationPayload,
  RunwayAPIGenerationResponse,
  RunwayAPIImageToVideoPayload,
  RunwayAPIStatusResponse,
  RunwayAPITaskStatus,
  RunwayCostEstimate,
  RunwayGenerationRequest,
  RunwayGenerationResponse,
  RunwayJobStatus,
  RunwayProviderConfig,
} from '../lib/runway-types';
import { RunwayProviderError } from '../lib/runway-types';
import type {
  ProviderCapabilities,
  ProviderConfig,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationStatus,
} from '../lib/types';
import { BaseVideoGenerationProvider } from './base';

/**
 * Default configuration values for the Runway provider.
 */
const RUNWAY_DEFAULTS = {
  baseUrl: 'https://api.runwayml.com/v1',
  timeout: 60000,
  apiVersion: '2024-11-06',
  defaultModel: 'gen3_turbo' as const,
  defaultMotionStrength: 0.5,
} as const;

/**
 * Pricing in cents per generation by model and duration.
 */
const PRICING = {
  gen3_alpha: {
    5: 100,
    10: 200,
    18: 360,
  },
  gen3_turbo: {
    5: 50,
    10: 100,
    18: 180,
  },
} as const;

/**
 * Estimated generation time in seconds based on model and duration.
 */
const ESTIMATED_TIME = {
  gen3_turbo: {
    5: 30,
    10: 60,
    18: 108,
  },
  gen3_alpha: {
    5: 60,
    10: 120,
    18: 216,
  },
} as const;

/**
 * Cache TTL for status responses in seconds.
 */
const STATUS_CACHE_TTL = 5;

/**
 * Runway Gen-3 video generation provider.
 *
 * Integrates with the Runway API to provide text-to-video and
 * image-to-video generation capabilities with Gen-3 Alpha and Turbo models.
 *
 * @example
 * ```typescript
 * const provider = new RunwayProvider({
 *   apiKey: process.env.RUNWAY_API_KEY!,
 *   webhookUrl: 'https://example.com/webhooks/runway',
 * });
 *
 * const result = await provider.generateVideo({
 *   prompt: 'A cat playing piano',
 *   duration: 10,
 *   aspectRatio: '16:9',
 * });
 * ```
 */
export class RunwayProvider extends BaseVideoGenerationProvider {
  readonly name = 'runway';
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.runway;

  private readonly config: RunwayProviderConfig;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly cache: CacheClient;

  constructor(config: ProviderConfig, cache?: CacheClient) {
    super();
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      webhookUrl: config.webhookSecret, // webhookSecret is used as webhook URL in ProviderConfig
    };
    this.baseUrl = config.baseUrl ?? RUNWAY_DEFAULTS.baseUrl;
    this.timeout = RUNWAY_DEFAULTS.timeout;
    this.cache = cache ?? createCacheClient();
  }

  /**
   * Generate video from text prompt.
   *
   * @param request Video generation request parameters
   * @returns Provider job ID and initial status
   */
  async generateVideo(
    request: VideoGenerationRequest,
  ): Promise<VideoGenerationResponse> {
    this.validateRequest(request);

    // Convert base request to Runway-specific format
    const runwayRequest = this.convertToRunwayRequest(request);

    // Validate with Runway-specific schema
    const validated = RunwayGenerationRequestSchema.parse(runwayRequest);

    const payload: RunwayAPIGenerationPayload = {
      promptText: validated.prompt,
      model: validated.model,
      seconds: validated.duration,
      ratio: validated.aspectRatio,
      seed: validated.seed,
      exploreMode: false,
      watermark: false,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<RunwayAPIGenerationResponse>(
      '/image_to_video',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    return {
      jobId: response.id,
      status: this.mapStatus(response.status),
      estimatedTime: ESTIMATED_TIME[validated.model][validated.duration],
      message: 'Generation started',
    };
  }

  /**
   * Generate video from image reference + prompt.
   *
   * @param request Runway generation request with reference image URL
   * @returns Provider job ID and initial status
   */
  async generateVideoWithImage(
    request: RunwayGenerationRequest,
  ): Promise<RunwayGenerationResponse> {
    if (!request.referenceImageUrl) {
      throw new RunwayProviderError(
        'Reference image URL is required for image-to-video generation',
        'VALIDATION_ERROR',
      );
    }

    const validated = RunwayGenerationRequestSchema.parse(request);

    const payload: RunwayAPIImageToVideoPayload = {
      promptText: validated.prompt,
      promptImage: validated.referenceImageUrl!,
      model: validated.model,
      seconds: validated.duration,
      ratio: validated.aspectRatio,
      seed: validated.seed,
      motionStrength: validated.motionStrength,
      exploreMode: false,
      watermark: false,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<RunwayAPIGenerationResponse>(
      '/image_to_video',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    return {
      providerJobId: response.id,
      status: this.mapStatus(response.status) as 'pending' | 'processing',
      estimatedTime: ESTIMATED_TIME[validated.model][validated.duration],
      message: 'Generation started',
    };
  }

  /**
   * Get job status from Runway API.
   * Results are cached for 5 seconds to reduce API calls.
   *
   * @param jobId Provider job ID
   * @returns Current job status with video URL if completed
   */
  async getStatus(jobId: string): Promise<VideoGenerationStatus> {
    const cacheKey = `runway:status:${jobId}`;

    // Check cache first
    const cached = await this.cache.get<VideoGenerationStatus>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.makeRequest<RunwayAPIStatusResponse>(
      `/tasks/${jobId}`,
      { method: 'GET' },
    );

    const status = this.mapStatus(response.status);
    const videoResult = response.output?.[0];

    const result: VideoGenerationStatus = {
      jobId: response.id,
      status,
      progress: response.progress,
      videoUrl: videoResult?.url,
      thumbnailUrl: undefined, // Runway doesn't provide separate thumbnails
      error: status === 'failed' ? response.failure : undefined,
      completedAt:
        status === 'completed' ? new Date().toISOString() : undefined,
    };

    // Cache the result
    await this.cache.set(cacheKey, result, STATUS_CACHE_TTL);

    return result;
  }

  /**
   * Get detailed Runway job status with additional fields.
   * Results are cached for 5 seconds to reduce API calls.
   *
   * @param jobId Provider job ID
   * @returns Runway-specific job status
   */
  async getRunwayStatus(jobId: string): Promise<RunwayJobStatus> {
    const cacheKey = `runway:runway-status:${jobId}`;

    // Check cache first
    const cached = await this.cache.get<RunwayJobStatus>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.makeRequest<RunwayAPIStatusResponse>(
      `/tasks/${jobId}`,
      { method: 'GET' },
    );

    const status = this.mapStatus(response.status);
    const videoResult = response.output?.[0];

    const result: RunwayJobStatus = {
      jobId: response.id,
      status,
      progress: response.progress,
      videoUrl: videoResult?.url,
      thumbnailUrl: undefined,
      errorMessage: status === 'failed' ? response.failure : undefined,
      errorCode: status === 'failed' ? response.failureCode : undefined,
      completedAt:
        status === 'completed' ? new Date().toISOString() : undefined,
    };

    // Cache the result
    await this.cache.set(cacheKey, result, STATUS_CACHE_TTL);

    return result;
  }

  /**
   * Cancel a running job.
   *
   * @param jobId Provider job ID
   */
  async cancelJob(jobId: string): Promise<void> {
    const logger = await getLogger();
    const ctx = { name: 'runway-cancel-job', jobId };

    try {
      await this.makeRequest(`/tasks/${jobId}`, { method: 'DELETE' });
      logger.info(ctx, 'Runway job cancelled');
    } catch (error) {
      logger.warn({ ...ctx, error }, 'Failed to cancel Runway job');
      throw error;
    }
  }

  /**
   * Estimate cost for a generation request.
   *
   * @param request Runway generation request
   * @returns Cost in cents and breakdown
   */
  estimateCost(request: RunwayGenerationRequest): RunwayCostEstimate {
    const model = request.model ?? RUNWAY_DEFAULTS.defaultModel;
    const duration = request.duration;
    const rateCents = PRICING[model][duration];

    return {
      costCents: rateCents,
      breakdown: {
        model,
        duration,
        rateCents,
      },
    };
  }

  /**
   * Convert base VideoGenerationRequest to Runway-specific format.
   */
  private convertToRunwayRequest(
    request: VideoGenerationRequest,
  ): RunwayGenerationRequest {
    const settings = request.settings ?? {};
    const model =
      (request.modelVersion as 'gen3_alpha' | 'gen3_turbo') ??
      RUNWAY_DEFAULTS.defaultModel;

    // Map duration to supported values (5, 10, 18)
    let duration: 5 | 10 | 18 = 10;
    if (request.duration <= 5) {
      duration = 5;
    } else if (request.duration <= 10) {
      duration = 10;
    } else {
      duration = 18;
    }

    return {
      prompt: request.prompt,
      duration,
      aspectRatio: request.aspectRatio as '16:9' | '9:16' | '1:1' | '4:5',
      model,
      seed: request.seed,
      referenceImageUrl: settings['referenceImageUrl'] as string | undefined,
      motionStrength:
        (settings['motionStrength'] as number) ??
        RUNWAY_DEFAULTS.defaultMotionStrength,
    };
  }

  /**
   * Make HTTP request to Runway API with proper headers and timeout.
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          'X-Runway-Version': RUNWAY_DEFAULTS.apiVersion,
          ...options.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));

        if (response.status === 429) {
          throw new RunwayProviderError(
            'Rate limit exceeded. Please wait.',
            'RATE_LIMITED',
            { retryable: true, retryAfter: 60 },
          );
        }

        if (response.status === 402) {
          throw new RunwayProviderError(
            'Insufficient Runway credits',
            'CREDIT_ERROR',
          );
        }

        if (response.status === 401 || response.status === 403) {
          throw new RunwayProviderError(
            'Invalid API credentials',
            'AUTH_ERROR',
          );
        }

        throw new RunwayProviderError(
          `HTTP ${response.status}: ${(error as { message?: string }).message || response.statusText}`,
          'PROVIDER_ERROR',
          { retryable: response.status >= 500 },
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof RunwayProviderError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new RunwayProviderError('Runway API request timeout', 'TIMEOUT', {
          retryable: true,
          retryAfter: 30,
        });
      }

      throw new RunwayProviderError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        { retryable: true },
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Map Runway API status to internal generation status.
   */
  private mapStatus(
    runwayStatus: RunwayAPITaskStatus,
  ): 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' {
    const statusMap: Record<
      RunwayAPITaskStatus,
      'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
    > = {
      PENDING: 'pending',
      RUNNING: 'processing',
      SUCCEEDED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
    };
    return statusMap[runwayStatus] || 'pending';
  }
}

/**
 * Factory function to create a Runway provider instance.
 *
 * @param config Provider configuration
 * @param cache Optional cache client for status caching
 * @returns New RunwayProvider instance
 */
export function createRunwayProvider(
  config: ProviderConfig,
  cache?: CacheClient,
): RunwayProvider {
  return new RunwayProvider(config, cache);
}
