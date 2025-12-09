/**
 * Video Render Service
 *
 * High-level service for video rendering operations.
 */

import type {
  RenderRequest,
  RenderResult,
  ProgressCallback,
  RenderProvider,
  ProviderConfig,
} from '../lib/types';
import type { TimelineProject, TimelineExportSettings } from '../lib/timeline/timeline-types';
import { timelineToRenderRequest } from '../lib/timeline/timeline-to-ffmpeg';
import { createVideoRenderProvider, createProviderFromEnv } from '../providers/factory';
import type { VideoRenderProvider } from '../providers/base';

/**
 * Render service configuration
 */
export interface RenderServiceConfig {
  /** Default provider to use */
  defaultProvider?: RenderProvider;
  /** Provider configuration */
  providerConfig?: ProviderConfig;
}

/**
 * Video Render Service
 *
 * Provides a high-level interface for video rendering operations.
 * Handles provider selection, request building, and progress tracking.
 */
export class VideoRenderService {
  private readonly provider: VideoRenderProvider;

  constructor(config: RenderServiceConfig = {}) {
    if (config.defaultProvider && config.providerConfig) {
      this.provider = createVideoRenderProvider(
        config.defaultProvider,
        config.providerConfig
      );
    } else {
      this.provider = createProviderFromEnv();
    }
  }

  /**
   * Render from a RenderRequest
   */
  async render(
    request: RenderRequest,
    onProgress?: ProgressCallback
  ): Promise<RenderResult> {
    return this.provider.render(request, onProgress);
  }

  /**
   * Render from a timeline project
   */
  async renderTimeline(
    project: TimelineProject,
    exportSettings: TimelineExportSettings,
    onProgress?: ProgressCallback
  ): Promise<RenderResult> {
    const request = timelineToRenderRequest(project, exportSettings);
    return this.provider.render(request, onProgress);
  }

  /**
   * Get render progress
   */
  async getProgress(jobId: string): Promise<number> {
    return this.provider.getProgress(jobId);
  }

  /**
   * Cancel a render
   */
  async cancel(jobId: string): Promise<void> {
    return this.provider.cancel(jobId);
  }

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    return this.provider.isAvailable();
  }

  /**
   * Get provider capabilities
   */
  getCapabilities() {
    return this.provider.capabilities;
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return this.provider.name;
  }
}

/**
 * Create a render service instance
 */
export function createRenderService(config?: RenderServiceConfig): VideoRenderService {
  return new VideoRenderService(config);
}

/**
 * Singleton instance for convenience
 */
let defaultService: VideoRenderService | null = null;

/**
 * Get the default render service instance
 */
export function getDefaultRenderService(): VideoRenderService {
  if (!defaultService) {
    defaultService = new VideoRenderService();
  }
  return defaultService;
}
