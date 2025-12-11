import { WAV2LIP } from '../../lib/constants';
import { BaseLipSyncProvider } from './base';
import type {
  LipSyncInput,
  LipSyncJobStatus,
  LipSyncProviderConfig,
  LipSyncResult,
} from './types';

/**
 * Wav2Lip API response
 */
interface Wav2LipResponse {
  job_id: string;
  status: string;
  output_url?: string;
  error_message?: string;
  progress?: number;
}

/**
 * Wav2Lip lip sync provider
 * Self-hosted or wrapper API for cost-effective lip sync
 */
export class Wav2LipProvider extends BaseLipSyncProvider {
  readonly name = 'wav2lip';
  private readonly baseUrl: string;

  constructor(config: LipSyncProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? WAV2LIP.BASE_URL;
  }

  async generateLipSync(input: LipSyncInput): Promise<string> {
    this.validateInput(input);

    try {
      const response = await this.makeRequestWithRetry<Wav2LipResponse>(
        `${this.baseUrl}/sync`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            video_url: input.videoUrl,
            audio_url: input.audioUrl,
            quality: input.quality,
            ...(input.faceCoordinates && {
              face_rect: input.faceCoordinates,
            }),
          }),
        },
      );

      return response.job_id;
    } catch (error) {
      throw this.handleError(error, 'generateLipSync');
    }
  }

  async getStatus(jobId: string): Promise<LipSyncResult> {
    try {
      const response = await this.makeRequestWithRetry<Wav2LipResponse>(
        `${this.baseUrl}/jobs/${jobId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
        },
      );

      return {
        status: this.mapStatus(response.status),
        outputUrl: response.output_url,
        error: response.error_message,
        progress: response.progress,
      };
    } catch (error) {
      throw this.handleError(error, 'getStatus');
    }
  }

  estimateDuration(input: LipSyncInput): number {
    const processingTimes = WAV2LIP.PROCESSING_TIME;
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
    return WAV2LIP.COST_PER_JOB;
  }

  getRateLimits() {
    return {
      requestsPerMinute: WAV2LIP.RATE_LIMITS.REQUESTS_PER_MINUTE,
      concurrentRequests: WAV2LIP.RATE_LIMITS.CONCURRENT_REQUESTS,
    };
  }

  /**
   * Map Wav2Lip status to internal status
   */
  private mapStatus(status: string): LipSyncJobStatus {
    const statusMap: Record<string, LipSyncJobStatus> = {
      queued: 'queued',
      pending: 'pending',
      processing: 'processing',
      complete: 'completed',
      completed: 'completed',
      error: 'failed',
      failed: 'failed',
    };
    return statusMap[status.toLowerCase()] || 'pending';
  }
}
