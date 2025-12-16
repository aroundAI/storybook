import { fetchWithRetry, formatProviderError } from '../../lib/http';
import type {
  LipSyncInput,
  LipSyncProvider,
  LipSyncProviderConfig,
  LipSyncResult,
} from './types';

/**
 * Base class for lip sync providers
 * Provides common validation and error handling logic
 */
export abstract class BaseLipSyncProvider implements LipSyncProvider {
  abstract readonly name: string;

  protected config: LipSyncProviderConfig;

  constructor(config: LipSyncProviderConfig) {
    this.config = config;
  }

  abstract generateLipSync(input: LipSyncInput): Promise<string>;

  abstract getStatus(jobId: string): Promise<LipSyncResult>;

  abstract estimateDuration(input: LipSyncInput): number;

  abstract estimateCost(input: LipSyncInput): number;

  abstract getRateLimits(): {
    requestsPerMinute: number;
    concurrentRequests: number;
    dailyLimit?: number;
  };

  /**
   * Validate lip sync input
   */
  protected validateInput(input: LipSyncInput): void {
    if (!input.videoUrl || typeof input.videoUrl !== 'string') {
      throw new Error('Video URL is required and must be a string');
    }

    if (!input.audioUrl || typeof input.audioUrl !== 'string') {
      throw new Error('Audio URL is required and must be a string');
    }

    // Validate URLs
    try {
      new URL(input.videoUrl);
    } catch {
      throw new Error('Invalid video URL format');
    }

    try {
      new URL(input.audioUrl);
    } catch {
      throw new Error('Invalid audio URL format');
    }

    // Validate quality
    const validQualities = ['fast', 'standard', 'high'];
    if (!validQualities.includes(input.quality)) {
      throw new Error(
        `Invalid quality: ${input.quality}. Must be one of: ${validQualities.join(', ')}`,
      );
    }

    // Validate face coordinates if provided
    if (input.faceCoordinates) {
      const { x, y, width, height } = input.faceCoordinates;
      if (typeof x !== 'number' || x < 0) {
        throw new Error('Face coordinates x must be a non-negative number');
      }
      if (typeof y !== 'number' || y < 0) {
        throw new Error('Face coordinates y must be a non-negative number');
      }
      if (typeof width !== 'number' || width <= 0) {
        throw new Error('Face coordinates width must be a positive number');
      }
      if (typeof height !== 'number' || height <= 0) {
        throw new Error('Face coordinates height must be a positive number');
      }
    }
  }

  /**
   * Handle and format errors consistently
   */
  protected handleError(error: unknown, operation: string): Error {
    return formatProviderError(this.name, operation, error);
  }

  /**
   * Make HTTP request with retry logic
   */
  protected async makeRequestWithRetry<T>(
    url: string,
    options: RequestInit,
    binary: boolean = false,
  ): Promise<T> {
    return fetchWithRetry<T>(
      url,
      options,
      {
        maxRetries: this.config.maxRetries,
        timeout: this.config.timeout,
      },
      binary,
    );
  }
}
