/**
 * Base Video Render Provider
 *
 * Defines the interface that all render providers must implement.
 * Following the same pattern as @kit/video-generation providers.
 */
import type { Timeline } from '../schema/timeline';
import type {
  ProviderConfig,
  RenderCapabilities,
  RenderCostEstimate,
  RenderJobRequest,
  RenderJobResponse,
  RenderJobStatus,
  RenderProviderType,
} from '../types/render-job';

/**
 * Video render provider interface
 */
export interface VideoRenderProvider {
  /** Provider name */
  readonly name: RenderProviderType;

  /** Provider capabilities */
  readonly capabilities: RenderCapabilities;

  /**
   * Submit a render job
   * @param request - Render job request
   * @returns Job response with ID and initial status
   */
  render(request: RenderJobRequest): Promise<RenderJobResponse>;

  /**
   * Get the status of a render job
   * @param jobId - Job ID from render response
   * @returns Current job status
   */
  getStatus(jobId: string): Promise<RenderJobStatus>;

  /**
   * Cancel a render job
   * @param jobId - Job ID to cancel
   */
  cancel(jobId: string): Promise<void>;

  /**
   * Estimate the cost of rendering a timeline
   * @param timeline - Timeline to estimate
   * @returns Cost estimate
   */
  estimateCost(timeline: Timeline): RenderCostEstimate;

  /**
   * Estimate the time to render a timeline
   * @param timeline - Timeline to estimate
   * @returns Estimated time in seconds
   */
  estimateTime(timeline: Timeline): number;
}

/**
 * Base provider implementation with common functionality
 */
export abstract class BaseVideoRenderProvider implements VideoRenderProvider {
  abstract readonly name: RenderProviderType;
  abstract readonly capabilities: RenderCapabilities;

  protected config: ProviderConfig;
  protected debug: boolean;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.debug = config.debug ?? false;
  }

  abstract render(request: RenderJobRequest): Promise<RenderJobResponse>;
  abstract getStatus(jobId: string): Promise<RenderJobStatus>;
  abstract cancel(jobId: string): Promise<void>;
  abstract estimateCost(timeline: Timeline): RenderCostEstimate;

  /**
   * Estimate render time based on timeline duration and provider speed
   */
  estimateTime(timeline: Timeline): number {
    const baseDuration = timeline.duration;
    const speedRatio = this.capabilities.typicalRenderSpeed;

    // Factor in quality settings
    const qualityMultiplier = this.getQualityMultiplier(timeline);

    // Factor in resolution
    const resolutionMultiplier = this.getResolutionMultiplier(timeline);

    // Factor in transitions (add overhead)
    const transitionOverhead = timeline.transitions.length * 2; // 2 seconds per transition

    return Math.ceil(
      baseDuration * speedRatio * qualityMultiplier * resolutionMultiplier +
        transitionOverhead,
    );
  }

  /**
   * Validate a timeline before rendering
   */
  protected validateTimeline(timeline: Timeline): void {
    // Check duration
    if (timeline.duration > this.capabilities.maxDuration) {
      throw new VideoRenderError(
        `Timeline duration ${timeline.duration}s exceeds max ${this.capabilities.maxDuration}s`,
        'DURATION_EXCEEDED',
      );
    }

    // Check resolution
    if (timeline.renderSettings.width > this.capabilities.maxWidth) {
      throw new VideoRenderError(
        `Width ${timeline.renderSettings.width} exceeds max ${this.capabilities.maxWidth}`,
        'RESOLUTION_EXCEEDED',
      );
    }

    if (timeline.renderSettings.height > this.capabilities.maxHeight) {
      throw new VideoRenderError(
        `Height ${timeline.renderSettings.height} exceeds max ${this.capabilities.maxHeight}`,
        'RESOLUTION_EXCEEDED',
      );
    }

    // Check format support
    if (
      !this.capabilities.supportedFormats.includes(
        timeline.renderSettings.format,
      )
    ) {
      throw new VideoRenderError(
        `Format ${timeline.renderSettings.format} not supported`,
        'FORMAT_NOT_SUPPORTED',
      );
    }

    // Check codec support
    if (
      !this.capabilities.supportedCodecs.includes(timeline.renderSettings.codec)
    ) {
      throw new VideoRenderError(
        `Codec ${timeline.renderSettings.codec} not supported`,
        'CODEC_NOT_SUPPORTED',
      );
    }

    // Check transitions support
    for (const transition of timeline.transitions) {
      if (!this.capabilities.supportedTransitions.includes(transition.type)) {
        throw new VideoRenderError(
          `Transition ${transition.type} not supported`,
          'TRANSITION_NOT_SUPPORTED',
        );
      }
    }
  }

  /**
   * Get quality multiplier for time estimation
   */
  protected getQualityMultiplier(timeline: Timeline): number {
    switch (timeline.renderSettings.quality) {
      case 'draft':
        return 0.5;
      case 'standard':
        return 1.0;
      case 'high':
        return 2.0;
      default:
        return 1.0;
    }
  }

  /**
   * Get resolution multiplier for time estimation
   */
  protected getResolutionMultiplier(timeline: Timeline): number {
    const pixels =
      timeline.renderSettings.width * timeline.renderSettings.height;
    const hdPixels = 1920 * 1080;

    if (pixels <= hdPixels * 0.5) return 0.7; // 720p or lower
    if (pixels <= hdPixels) return 1.0; // 1080p
    if (pixels <= hdPixels * 2) return 1.5; // 1440p
    return 2.5; // 4K or higher
  }

  /**
   * Format cost for display
   */
  protected formatCost(cents: number): string {
    if (cents === 0) return 'Free';
    if (cents < 100) return `$0.${cents.toString().padStart(2, '0')}`;
    return `$${(cents / 100).toFixed(2)}`;
  }

  /**
   * Log debug message
   */
  protected log(message: string, data?: unknown): void {
    if (this.debug) {
      console.log(`[${this.name}] ${message}`, data ?? '');
    }
  }
}

/**
 * Error class for render provider errors
 */
export class VideoRenderError extends Error {
  code: string;
  statusCode?: number;

  constructor(message: string, code: string, statusCode?: number) {
    super(message);
    this.name = 'VideoRenderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Error codes
 */
export const ERROR_CODES = {
  DURATION_EXCEEDED: 'DURATION_EXCEEDED',
  RESOLUTION_EXCEEDED: 'RESOLUTION_EXCEEDED',
  FORMAT_NOT_SUPPORTED: 'FORMAT_NOT_SUPPORTED',
  CODEC_NOT_SUPPORTED: 'CODEC_NOT_SUPPORTED',
  TRANSITION_NOT_SUPPORTED: 'TRANSITION_NOT_SUPPORTED',
  INVALID_TIMELINE: 'INVALID_TIMELINE',
  RENDER_FAILED: 'RENDER_FAILED',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
