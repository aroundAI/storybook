import 'server-only';

import { type CacheClient, createCacheClient } from '@kit/cache';
import { getLogger } from '@kit/shared/logger';

import { PROVIDER_CAPABILITIES } from '../../lib/constants';
import type {
  ProviderCapabilities,
  ProviderConfig,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationStatus,
} from '../../lib/types';
import { BaseVideoGenerationProvider } from '../base';
import {
  HAILUO_DEFAULTS,
  HAILUO_ESTIMATED_TIME,
  HAILUO_LIMITS,
  HAILUO_STATUS_CACHE_TTL,
} from './constants';
import type {
  HailuoApiStatus,
  HailuoBaseResponse,
  HailuoCostEstimate,
  HailuoErrorResponse,
  HailuoFileResponse,
  HailuoGenerationRequest,
  HailuoGenerationResponse,
  HailuoProviderConfig,
  HailuoStatusResponse,
  HailuoTaskResponse,
} from './types';
import { HailuoProviderError } from './types';

/**
 * Hailuo AI (MiniMax) video generation provider.
 *
 * A budget-friendly provider known for ultra-fast processing times (~20 seconds).
 * Ideal for rapid prototyping and cost-conscious creators.
 *
 * @example
 * ```typescript
 * const provider = new HailuoProvider({
 *   apiKey: process.env.HAILUO_API_KEY!,
 *   webhookUrl: 'https://example.com/webhooks/hailuo',
 * });
 *
 * const result = await provider.generateVideo({
 *   prompt: 'A cat playing piano',
 *   duration: 5,
 *   aspectRatio: '16:9',
 * });
 * ```
 */
export class HailuoProvider extends BaseVideoGenerationProvider {
  readonly name = 'hailuo';
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.hailuo;

  private readonly config: HailuoProviderConfig;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly cache: CacheClient;

  constructor(config: ProviderConfig, cache?: CacheClient) {
    super();
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      webhookUrl: config.webhookSecret,
    };
    this.baseUrl = config.baseUrl ?? HAILUO_DEFAULTS.baseUrl;
    this.timeout = HAILUO_DEFAULTS.timeout;
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

    const hailuoRequest = this.convertToHailuoRequest(request);

    const payload = {
      model: HAILUO_DEFAULTS.model,
      prompt: hailuoRequest.prompt,
      first_frame_image: hailuoRequest.referenceImageUrl,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<HailuoTaskResponse>(
      '/video_generation',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    return {
      jobId: response.task_id,
      status: 'pending',
      estimatedTime: HAILUO_ESTIMATED_TIME,
      message: 'Generation started - expect completion in ~20 seconds',
    };
  }

  /**
   * Generate video from image reference + prompt.
   *
   * @param request Hailuo generation request with reference image URL
   * @returns Provider job ID and initial status
   */
  async generateVideoWithImage(
    request: HailuoGenerationRequest,
  ): Promise<HailuoGenerationResponse> {
    if (!request.referenceImageUrl) {
      throw new HailuoProviderError(
        'Reference image URL is required for image-to-video generation',
        'VALIDATION_ERROR',
      );
    }

    const payload = {
      model: HAILUO_DEFAULTS.model,
      prompt: request.prompt,
      first_frame_image: request.referenceImageUrl,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<HailuoTaskResponse>(
      '/video_generation',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    return {
      providerJobId: response.task_id,
      status: 'pending',
      estimatedTime: HAILUO_ESTIMATED_TIME,
      message: 'Image-to-video generation started',
    };
  }

  /**
   * Get job status from Hailuo API.
   * Results are cached for 5 seconds to reduce API calls.
   *
   * @param jobId Provider job ID
   * @returns Current job status with video URL if completed
   */
  async getStatus(jobId: string): Promise<VideoGenerationStatus> {
    const cacheKey = `hailuo:status:${jobId}`;

    const cached = await this.cache.get<VideoGenerationStatus>(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await this.makeRequest<HailuoStatusResponse>(
      `/query/video_generation?task_id=${jobId}`,
      { method: 'GET' },
    );

    const status = this.mapStatus(response.status);
    let videoUrl: string | undefined;

    if (status === 'completed' && response.file_id) {
      videoUrl = await this.getVideoUrl(response.file_id);
    }

    const result: VideoGenerationStatus = {
      jobId,
      status,
      progress: this.getProgressForStatus(status),
      videoUrl,
      thumbnailUrl: undefined,
      error:
        status === 'failed'
          ? response.base_resp.status_msg || 'Video generation failed'
          : undefined,
      completedAt:
        status === 'completed' ? new Date().toISOString() : undefined,
    };

    await this.cache.set(cacheKey, result, HAILUO_STATUS_CACHE_TTL);

    return result;
  }

  /**
   * Cancel a running job.
   *
   * Note: Hailuo processes so fast that cancellation is rarely needed.
   * This method logs a warning and returns without error.
   *
   * @param jobId Provider job ID
   */
  async cancelJob(jobId: string): Promise<void> {
    const logger = await getLogger();
    logger.warn(
      { name: 'hailuo-job-cancellation-unsupported', jobId },
      'Hailuo job cancellation not supported - processing is typically too fast',
    );
  }

  /**
   * Estimate cost for a generation request.
   * Hailuo uses flat-rate pricing.
   *
   * @returns Cost in cents ($0.40 per generation)
   */
  estimateCost(): HailuoCostEstimate {
    return {
      costCents: HAILUO_LIMITS.pricing.perGeneration,
    };
  }

  /**
   * Get downloadable video URL from file_id.
   *
   * @throws {HailuoProviderError} If the file or download URL is not available
   */
  private async getVideoUrl(fileId: string): Promise<string> {
    const response = await this.makeRequest<HailuoFileResponse>(
      `/files/retrieve?file_id=${fileId}`,
      { method: 'GET' },
    );

    if (!response.file?.download_url) {
      throw new HailuoProviderError(
        'Video URL not available from Hailuo API',
        'PROVIDER_ERROR',
      );
    }

    return response.file.download_url;
  }

  /**
   * Convert base VideoGenerationRequest to Hailuo-specific format.
   */
  private convertToHailuoRequest(
    request: VideoGenerationRequest,
  ): HailuoGenerationRequest {
    const settings = request.settings ?? {};

    return {
      prompt: request.prompt,
      duration: (request.duration as 5 | 6) ?? 5,
      aspectRatio: request.aspectRatio as '16:9' | '9:16' | '1:1',
      referenceImageUrl: settings['referenceImageUrl'] as string | undefined,
    };
  }

  /**
   * Make HTTP request to Hailuo API with proper headers and timeout.
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
          ...options.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorResponse: Partial<HailuoErrorResponse> = await response
          .json()
          .catch(() => ({}));

        if (response.status === 429) {
          throw new HailuoProviderError('Rate limit exceeded', 'RATE_LIMITED', {
            retryable: true,
            retryAfter: 60,
          });
        }

        if (response.status === 401 || response.status === 403) {
          throw new HailuoProviderError(
            'Invalid API credentials',
            'AUTH_ERROR',
          );
        }

        const errorMessage =
          errorResponse.base_resp?.status_msg ||
          errorResponse.error?.message ||
          response.statusText;

        throw new HailuoProviderError(
          `HTTP ${response.status}: ${errorMessage}`,
          'PROVIDER_ERROR',
          { retryable: response.status >= 500 },
        );
      }

      const data = (await response.json()) as HailuoBaseResponse & T;

      if (data.base_resp && data.base_resp.status_code !== 0) {
        throw new HailuoProviderError(
          `Hailuo API error: ${data.base_resp.status_msg || 'Unknown error'}`,
          'PROVIDER_ERROR',
        );
      }

      return data;
    } catch (error) {
      if (error instanceof HailuoProviderError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new HailuoProviderError('Hailuo API request timeout', 'TIMEOUT', {
          retryable: true,
          retryAfter: 30,
        });
      }

      throw new HailuoProviderError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        { retryable: true },
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Map Hailuo API status to internal generation status.
   */
  private mapStatus(
    hailuoStatus: HailuoApiStatus,
  ): 'pending' | 'processing' | 'completed' | 'failed' {
    switch (hailuoStatus) {
      case 'Queueing':
        return 'pending';
      case 'Processing':
        return 'processing';
      case 'Success':
        return 'completed';
      case 'Fail':
        return 'failed';
      default:
        return 'pending';
    }
  }

  /**
   * Get progress percentage for status.
   */
  private getProgressForStatus(
    status: 'pending' | 'processing' | 'completed' | 'failed',
  ): number {
    switch (status) {
      case 'pending':
        return 0;
      case 'processing':
        return 50;
      case 'completed':
        return 100;
      case 'failed':
        return 0;
      default:
        return 0;
    }
  }
}

/**
 * Factory function to create a Hailuo provider instance.
 *
 * @param config Provider configuration
 * @param cache Optional cache client for status caching
 * @returns New HailuoProvider instance
 */
export function createHailuoProvider(
  config: ProviderConfig,
  cache?: CacheClient,
): HailuoProvider {
  return new HailuoProvider(config, cache);
}
