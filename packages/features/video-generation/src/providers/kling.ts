import { PROVIDER_CAPABILITIES } from '../lib/constants';
import { KlingGenerationRequestSchema } from '../lib/kling-schemas';
import type {
  KlingCostEstimate,
  KlingGenerationRequest,
  KlingGenerationResponse,
  KlingJobStatus,
  KlingProviderConfig,
  PiAPIGenerationPayload,
  PiAPIGenerationResponse,
  PiAPIImageToVideoPayload,
  PiAPIStatusResponse,
  PiAPITaskStatus,
} from '../lib/kling-types';
import { KlingProviderError } from '../lib/kling-types';
import type {
  ProviderCapabilities,
  ProviderConfig,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationStatus,
} from '../lib/types';
import { BaseVideoGenerationProvider } from './base';

/**
 * Default configuration values for the Kling provider.
 */
const KLING_DEFAULTS = {
  baseUrl: 'https://api.piapi.ai/api/kling/v1',
  timeout: 30000,
  cfgScale: 0.5,
  defaultModel: 'kling-v1.5' as const,
  defaultMode: 'std' as const,
} as const;

/**
 * Cost per second in cents for each mode.
 */
const COST_PER_SECOND = {
  std: 10, // $0.10/second
  pro: 30, // $0.30/second
} as const;

/**
 * Estimated generation time in seconds based on duration.
 */
const ESTIMATED_TIME = {
  5: 180, // 3 minutes for 5-second video
  10: 300, // 5 minutes for 10-second video
} as const;

/**
 * Kling AI video generation provider.
 *
 * Integrates with the PiAPI endpoint to provide text-to-video and
 * image-to-video generation capabilities.
 *
 * @example
 * ```typescript
 * const provider = new KlingProvider({
 *   apiKey: process.env.KLING_API_KEY!,
 *   webhookUrl: 'https://example.com/webhooks/kling',
 * });
 *
 * const result = await provider.generateVideo({
 *   prompt: 'A cat playing piano',
 *   duration: 5,
 *   aspectRatio: '16:9',
 * });
 * ```
 */
export class KlingProvider extends BaseVideoGenerationProvider {
  readonly name = 'kling';
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.kling;

  private readonly config: KlingProviderConfig;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: ProviderConfig) {
    super();
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      webhookUrl: config.webhookSecret, // webhookSecret is used as webhook URL in ProviderConfig
    };
    this.baseUrl = config.baseUrl ?? KLING_DEFAULTS.baseUrl;
    this.timeout = KLING_DEFAULTS.timeout;
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

    // Convert base request to Kling-specific format
    const klingRequest = this.convertToKlingRequest(request);

    // Validate with Kling-specific schema
    const validated = KlingGenerationRequestSchema.parse(klingRequest);

    const payload: PiAPIGenerationPayload = {
      model: validated.model,
      prompt: validated.prompt,
      negative_prompt: validated.negativePrompt,
      cfg_scale: KLING_DEFAULTS.cfgScale,
      mode: validated.mode,
      aspect_ratio: validated.aspectRatio,
      duration: String(validated.duration),
      seed: validated.seed,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<PiAPIGenerationResponse>(
      '/generations',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (response.code !== 200) {
      throw new KlingProviderError(
        `Kling API error: ${response.message}`,
        this.mapErrorCode(response.code),
      );
    }

    return {
      jobId: response.data.task_id,
      status: this.mapStatus(response.data.task_status),
      estimatedTime: ESTIMATED_TIME[validated.duration],
      message: response.message,
    };
  }

  /**
   * Generate video from image reference + prompt.
   *
   * @param request Kling generation request with reference image URL
   * @returns Provider job ID and initial status
   */
  async generateVideoWithImage(
    request: KlingGenerationRequest,
  ): Promise<KlingGenerationResponse> {
    if (!request.referenceImageUrl) {
      throw new KlingProviderError(
        'Reference image URL is required for image-to-video generation',
        'VALIDATION_ERROR',
      );
    }

    const validated = KlingGenerationRequestSchema.parse(request);

    const payload: PiAPIImageToVideoPayload = {
      model: validated.model,
      image_url: validated.referenceImageUrl!,
      prompt: validated.prompt,
      negative_prompt: validated.negativePrompt,
      cfg_scale: KLING_DEFAULTS.cfgScale,
      mode: validated.mode,
      duration: String(validated.duration),
      seed: validated.seed,
      callback_url: this.config.webhookUrl,
    };

    const response = await this.makeRequest<PiAPIGenerationResponse>(
      '/image2video',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (response.code !== 200) {
      throw new KlingProviderError(
        `Kling API error: ${response.message}`,
        this.mapErrorCode(response.code),
      );
    }

    return {
      providerJobId: response.data.task_id,
      status: this.mapStatus(response.data.task_status) as
        | 'pending'
        | 'processing',
      estimatedTime: ESTIMATED_TIME[validated.duration],
      message: response.message,
    };
  }

  /**
   * Get job status from Kling API.
   *
   * @param jobId Provider job ID
   * @returns Current job status with video URL if completed
   */
  async getStatus(jobId: string): Promise<VideoGenerationStatus> {
    const response = await this.makeRequest<PiAPIStatusResponse>(
      `/generations/${jobId}`,
      { method: 'GET' },
    );

    if (response.code !== 200) {
      throw new KlingProviderError(
        `Kling API error: ${response.message}`,
        this.mapErrorCode(response.code),
      );
    }

    const data = response.data;
    const status = this.mapStatus(data.task_status);
    const videoResult = data.task_result?.videos?.[0];

    return {
      jobId: data.task_id,
      status,
      progress: data.progress,
      videoUrl: videoResult?.url,
      thumbnailUrl: undefined, // Kling doesn't provide thumbnails
      error: status === 'failed' ? data.task_status_msg : undefined,
      completedAt:
        status === 'completed'
          ? new Date(data.updated_at * 1000).toISOString()
          : undefined,
    };
  }

  /**
   * Get detailed Kling job status with additional fields.
   *
   * @param jobId Provider job ID
   * @returns Kling-specific job status
   */
  async getKlingStatus(jobId: string): Promise<KlingJobStatus> {
    const response = await this.makeRequest<PiAPIStatusResponse>(
      `/generations/${jobId}`,
      { method: 'GET' },
    );

    if (response.code !== 200) {
      throw new KlingProviderError(
        `Kling API error: ${response.message}`,
        this.mapErrorCode(response.code),
      );
    }

    const data = response.data;
    const status = this.mapStatus(data.task_status);
    const videoResult = data.task_result?.videos?.[0];

    return {
      jobId: data.task_id,
      status,
      progress: data.progress,
      videoUrl: videoResult?.url,
      thumbnailUrl: undefined,
      errorMessage: status === 'failed' ? data.task_status_msg : undefined,
      completedAt:
        status === 'completed'
          ? new Date(data.updated_at * 1000).toISOString()
          : undefined,
    };
  }

  /**
   * Cancel a running job.
   *
   * Note: Kling API may not support job cancellation.
   * This method logs a warning and returns without error.
   *
   * @param jobId Provider job ID
   */
  async cancelJob(jobId: string): Promise<void> {
    // Kling API does not currently support job cancellation
    console.warn(`Kling job cancellation not supported: ${jobId}`);
  }

  /**
   * Estimate cost for a generation request.
   *
   * @param request Kling generation request
   * @returns Cost in cents and breakdown
   */
  estimateCost(request: KlingGenerationRequest): KlingCostEstimate {
    const mode = request.mode ?? KLING_DEFAULTS.defaultMode;
    const duration = request.duration;
    const ratePerSecond = COST_PER_SECOND[mode];

    return {
      costCents: ratePerSecond * duration,
      breakdown: {
        mode,
        duration,
        ratePerSecond,
      },
    };
  }

  /**
   * Convert base VideoGenerationRequest to Kling-specific format.
   */
  private convertToKlingRequest(
    request: VideoGenerationRequest,
  ): KlingGenerationRequest {
    // Get mode from settings or default
    const settings = request.settings ?? {};
    const mode =
      (settings['mode'] as 'std' | 'pro') ?? KLING_DEFAULTS.defaultMode;
    const model =
      (request.modelVersion as 'kling-v1.0' | 'kling-v1.5') ??
      KLING_DEFAULTS.defaultModel;

    // Validate and convert duration
    const duration = request.duration;
    if (duration !== 5 && duration !== 10) {
      throw new KlingProviderError(
        `Invalid duration: ${duration}. Kling only supports 5 or 10 seconds.`,
        'VALIDATION_ERROR',
      );
    }

    // Validate aspect ratio
    const aspectRatio = request.aspectRatio as '16:9' | '9:16' | '1:1';
    if (!['16:9', '9:16', '1:1'].includes(aspectRatio)) {
      throw new KlingProviderError(
        `Invalid aspect ratio: ${aspectRatio}. Kling only supports 16:9, 9:16, or 1:1.`,
        'VALIDATION_ERROR',
      );
    }

    return {
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      duration: duration as 5 | 10,
      aspectRatio,
      model,
      mode,
      seed: request.seed,
      referenceImageUrl: settings['referenceImageUrl'] as string | undefined,
    };
  }

  /**
   * Make HTTP request to Kling API with proper headers and timeout.
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
          'X-API-Key': this.config.apiKey,
          ...options.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));

        if (response.status === 429) {
          throw new KlingProviderError('Rate limit exceeded', 'RATE_LIMITED', {
            retryable: true,
            retryAfter: 60,
          });
        }

        if (response.status === 401 || response.status === 403) {
          throw new KlingProviderError('Invalid API credentials', 'AUTH_ERROR');
        }

        throw new KlingProviderError(
          `HTTP ${response.status}: ${(error as { message?: string }).message || response.statusText}`,
          'PROVIDER_ERROR',
          { retryable: response.status >= 500 },
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof KlingProviderError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new KlingProviderError('Kling API request timeout', 'TIMEOUT', {
          retryable: true,
          retryAfter: 30,
        });
      }

      throw new KlingProviderError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        { retryable: true },
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Map PiAPI status to internal generation status.
   */
  private mapStatus(
    piApiStatus: string,
  ): 'pending' | 'processing' | 'completed' | 'failed' {
    switch (piApiStatus as PiAPITaskStatus) {
      case 'submitted':
        return 'pending';
      case 'processing':
        return 'processing';
      case 'succeed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'pending';
    }
  }

  /**
   * Map HTTP status codes to error codes.
   */
  private mapErrorCode(
    code: number,
  ):
    | 'RATE_LIMITED'
    | 'AUTH_ERROR'
    | 'VALIDATION_ERROR'
    | 'PROVIDER_ERROR'
    | 'CREDIT_ERROR' {
    switch (code) {
      case 429:
        return 'RATE_LIMITED';
      case 401:
      case 403:
        return 'AUTH_ERROR';
      case 400:
        return 'VALIDATION_ERROR';
      case 402:
        return 'CREDIT_ERROR';
      default:
        return 'PROVIDER_ERROR';
    }
  }
}

/**
 * Factory function to create a Kling provider instance.
 *
 * @param config Provider configuration
 * @returns New KlingProvider instance
 */
export function createKlingProvider(config: ProviderConfig): KlingProvider {
  return new KlingProvider(config);
}
