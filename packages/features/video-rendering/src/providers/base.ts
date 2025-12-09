/**
 * Base Video Render Provider
 *
 * Abstract base class for all video rendering providers.
 * Provides common validation and interface enforcement.
 */

import type {
  RenderCapabilities,
  RenderRequest,
  RenderResult,
  ProgressCallback,
  ProviderConfig,
} from '../lib/types';
import { RenderRequestSchema } from '../lib/schemas';
import { LIMITS } from '../lib/constants';

/**
 * Video render provider interface
 */
export interface VideoRenderProvider {
  /** Provider name */
  readonly name: string;
  /** Provider capabilities */
  readonly capabilities: RenderCapabilities;

  /**
   * Render a video from the given request
   */
  render(request: RenderRequest, onProgress?: ProgressCallback): Promise<RenderResult>;

  /**
   * Get the progress of a render job
   */
  getProgress(jobId: string): Promise<number>;

  /**
   * Cancel a running render job
   */
  cancel(jobId: string): Promise<void>;

  /**
   * Check if the provider is available/configured
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Abstract base class for video render providers
 */
export abstract class BaseVideoRenderProvider implements VideoRenderProvider {
  abstract readonly name: string;
  abstract readonly capabilities: RenderCapabilities;

  protected readonly config: ProviderConfig;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
  }

  abstract render(
    request: RenderRequest,
    onProgress?: ProgressCallback
  ): Promise<RenderResult>;

  abstract getProgress(jobId: string): Promise<number>;

  abstract cancel(jobId: string): Promise<void>;

  abstract isAvailable(): Promise<boolean>;

  /**
   * Validate a render request against provider capabilities
   */
  protected validateRequest(request: RenderRequest): void {
    // Validate against schema
    const result = RenderRequestSchema.safeParse(request);
    if (!result.success) {
      throw new Error(`Invalid render request: ${result.error.message}`);
    }

    // Check shot count
    if (request.shots.length > LIMITS.maxShots) {
      throw new Error(`Too many shots: ${request.shots.length} (max: ${LIMITS.maxShots})`);
    }

    // Check provider-specific limits
    if (
      this.capabilities.maxInputVideos &&
      request.shots.length > this.capabilities.maxInputVideos
    ) {
      throw new Error(
        `Provider ${this.name} supports max ${this.capabilities.maxInputVideos} input videos`
      );
    }

    // Check output format support
    if (!this.capabilities.supportedFormats.includes(request.outputFormat)) {
      throw new Error(
        `Provider ${this.name} does not support format: ${request.outputFormat}`
      );
    }

    // Check transition support
    if (request.transitions && request.transitions.length > 0) {
      if (!this.capabilities.supportsTransitions) {
        throw new Error(`Provider ${this.name} does not support transitions`);
      }

      // Check specific transition types
      if (this.capabilities.supportedTransitions) {
        for (const transition of request.transitions) {
          if (!this.capabilities.supportedTransitions.includes(transition.type)) {
            throw new Error(
              `Provider ${this.name} does not support transition type: ${transition.type}`
            );
          }
        }
      }
    }

    // Check audio mixing support
    if (request.audioTracks && request.audioTracks.length > 0) {
      if (!this.capabilities.supportsAudioMixing) {
        throw new Error(`Provider ${this.name} does not support audio mixing`);
      }
    }

    // Check text overlay support
    if (request.textOverlays && request.textOverlays.length > 0) {
      if (!this.capabilities.supportsTextOverlays) {
        throw new Error(`Provider ${this.name} does not support text overlays`);
      }
    }

    // Calculate total duration and check limits
    const totalDuration = request.shots.reduce((sum, shot) => sum + shot.duration, 0);
    if (this.capabilities.maxDuration && totalDuration > this.capabilities.maxDuration) {
      throw new Error(
        `Total duration ${totalDuration}s exceeds provider max of ${this.capabilities.maxDuration}s`
      );
    }
  }

  /**
   * Calculate estimated render time in milliseconds
   */
  protected estimateRenderTime(request: RenderRequest): number {
    const totalDuration = request.shots.reduce((sum, shot) => sum + shot.duration, 0);

    // Base estimate: 1 second of video = 2 seconds to render
    let multiplier = 2;

    // Adjust for resolution
    switch (request.resolution) {
      case '480p':
        multiplier *= 0.5;
        break;
      case '720p':
        multiplier *= 0.75;
        break;
      case '1080p':
        multiplier *= 1;
        break;
      case '4k':
        multiplier *= 4;
        break;
    }

    // Adjust for quality
    switch (request.quality) {
      case 'draft':
        multiplier *= 0.5;
        break;
      case 'standard':
        multiplier *= 1;
        break;
      case 'high':
        multiplier *= 2;
        break;
    }

    // Add time for transitions
    if (request.transitions) {
      multiplier += 0.1 * request.transitions.length;
    }

    // Add time for audio mixing
    if (request.audioTracks && request.audioTracks.length > 0) {
      multiplier += 0.2 * request.audioTracks.length;
    }

    return Math.round(totalDuration * multiplier * 1000);
  }
}
