import { SYNCLABS } from '../../lib/constants';
import { BaseLipSyncProvider } from './base';
import type {
  LipSyncInput,
  LipSyncJobStatus,
  LipSyncProviderConfig,
  LipSyncResult,
} from './types';

/**
 * SyncLabs lip sync response
 */
interface SyncLabsResponse {
  id: string;
  status: string;
  output_url?: string;
  error?: string;
  progress?: number;
}

/**
 * SyncLabs lip sync provider
 * Production-ready API for high-quality lip sync
 */
export class SyncLabsProvider extends BaseLipSyncProvider {
  readonly name = 'synclabs';
  private readonly baseUrl: string;

  constructor(config: LipSyncProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? SYNCLABS.BASE_URL;
  }

  async generateLipSync(input: LipSyncInput): Promise<string> {
    this.validateInput(input);

    try {
      const response = await this.makeRequestWithRetry<SyncLabsResponse>(
        `${this.baseUrl}/lipsync`,
        {
          method: 'POST',
          headers: {
            'x-api-key': this.config.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            videoUrl: input.videoUrl,
            audioUrl: input.audioUrl,
            model: this.mapQualityToModel(input.quality),
            ...(input.faceCoordinates && {
              faceCoordinates: input.faceCoordinates,
            }),
          }),
        },
      );

      return response.id;
    } catch (error) {
      throw this.handleError(error, 'generateLipSync');
    }
  }

  async getStatus(jobId: string): Promise<LipSyncResult> {
    try {
      const response = await this.makeRequestWithRetry<SyncLabsResponse>(
        `${this.baseUrl}/lipsync/${jobId}`,
        {
          method: 'GET',
          headers: {
            'x-api-key': this.config.apiKey,
          },
        },
      );

      return {
        status: this.mapStatus(response.status),
        outputUrl: response.output_url,
        error: response.error,
        progress: response.progress,
      };
    } catch (error) {
      throw this.handleError(error, 'getStatus');
    }
  }

  estimateDuration(input: LipSyncInput): number {
    const processingTimes = SYNCLABS.PROCESSING_TIME;
    switch (input.quality) {
      case 'fast':
        return processingTimes.FAST;
      case 'standard':
        return processingTimes.STANDARD;
      case 'high':
        return processingTimes.HIGH;
      default:
        return processingTimes.STANDARD;
    }
  }

  estimateCost(_input: LipSyncInput): number {
    return SYNCLABS.COST_PER_JOB;
  }

  getRateLimits() {
    return {
      requestsPerMinute: SYNCLABS.RATE_LIMITS.REQUESTS_PER_MINUTE,
      concurrentRequests: SYNCLABS.RATE_LIMITS.CONCURRENT_REQUESTS,
    };
  }

  /**
   * Map quality setting to SyncLabs model name
   */
  private mapQualityToModel(quality: LipSyncInput['quality']): string {
    switch (quality) {
      case 'fast':
        return 'sync-1.5-beta';
      case 'standard':
        return 'sync-1.6.0';
      case 'high':
        return 'sync-1.7.1-beta';
      default:
        return 'sync-1.6.0';
    }
  }

  /**
   * Map SyncLabs status to internal status
   */
  private mapStatus(status: string): LipSyncJobStatus {
    const statusMap: Record<string, LipSyncJobStatus> = {
      PENDING: 'pending',
      PROCESSING: 'processing',
      COMPLETED: 'completed',
      FAILED: 'failed',
    };
    return statusMap[status.toUpperCase()] || 'pending';
  }
}
