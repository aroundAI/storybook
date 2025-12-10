/**
 * Shotstack API Client
 *
 * Client for the Shotstack video editing API.
 * @see https://shotstack.io/docs/api/
 */
import {
  BaseVideoRenderProvider,
  VideoRenderError,
} from '../../providers/base';
import { PROVIDER_CAPABILITIES } from '../../providers/factory';
import type { Timeline } from '../../schema/timeline';
import type {
  RenderCapabilities,
  RenderCostEstimate,
  RenderJobRequest,
  RenderJobResponse,
  RenderJobStatus,
  ShotstackProviderConfig,
} from '../../types/render-job';
import {
  convertTimelineToShotstack,
  estimateShotstackCost,
  getShotstackApiUrl,
  validateTimelineForShotstack,
} from './timeline-converter';
import type {
  ShotstackEdit,
  ShotstackRenderResponse,
  ShotstackStatusResponse,
} from './types';

// ============================================================================
// Shotstack Render Provider
// ============================================================================

export class ShotstackRenderProvider extends BaseVideoRenderProvider {
  readonly name = 'shotstack' as const;
  readonly capabilities: RenderCapabilities = PROVIDER_CAPABILITIES.shotstack;

  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: ShotstackProviderConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseUrl =
      config.baseUrl ?? getShotstackApiUrl(config.environment ?? 'staging');
    this.timeout = config.timeout ?? 30000;
  }

  /**
   * Submit a render job
   */
  async render(request: RenderJobRequest): Promise<RenderJobResponse> {
    const { timeline, webhookUrl, idempotencyKey: _idempotencyKey } = request;

    // Validate timeline
    this.validateTimeline(timeline);

    const validation = validateTimelineForShotstack(timeline);
    if (!validation.valid) {
      throw new VideoRenderError(
        `Timeline validation failed: ${validation.errors.join(', ')}`,
        'INVALID_TIMELINE',
      );
    }

    // Convert timeline to Shotstack format
    const edit = convertTimelineToShotstack(timeline, { webhookUrl });

    // Submit render
    const response = await this.submitRender(edit);

    return {
      jobId: response.response.id,
      status: 'pending',
      estimatedTime: this.estimateTime(timeline),
      message: response.response.message,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Get job status
   */
  async getStatus(jobId: string): Promise<RenderJobStatus> {
    const response = await this.fetchStatus(jobId);
    const data = response.response;

    return {
      jobId: data.id,
      status: mapShotstackStatus(data.status),
      progress: data.progress,
      videoUrl: data.url,
      thumbnailUrl: data.thumbnail,
      error: data.error,
      startedAt: data.created,
      completedAt: data.status === 'done' ? data.updated : undefined,
      metadata: {
        poster: data.poster,
        renderTime: data.renderTime,
      },
    };
  }

  /**
   * Cancel a job
   * Note: Shotstack doesn't support job cancellation
   */
  async cancel(_jobId: string): Promise<void> {
    throw new VideoRenderError(
      'Shotstack does not support job cancellation',
      'NOT_SUPPORTED',
      400,
    );
  }

  /**
   * Estimate rendering cost
   */
  estimateCost(timeline: Timeline): RenderCostEstimate {
    const costCents = estimateShotstackCost(timeline);

    return {
      provider: 'shotstack',
      estimatedCostCents: costCents,
      breakdown: {
        baseCost: 0,
        perSecondCost: costCents / timeline.duration,
        durationSeconds: timeline.duration,
        qualityMultiplier: this.getQualityMultiplier(timeline),
        resolutionMultiplier: this.getResolutionMultiplier(timeline),
      },
      isFixed: false,
      displayCost: this.formatCost(costCents),
    };
  }

  /**
   * Get Shotstack Edit JSON for a timeline
   */
  getEditJson(timeline: Timeline, webhookUrl?: string): ShotstackEdit {
    return convertTimelineToShotstack(timeline, { webhookUrl });
  }

  // ============================================================================
  // Private API Methods
  // ============================================================================

  /**
   * Submit render to Shotstack API
   */
  private async submitRender(
    edit: ShotstackEdit,
  ): Promise<ShotstackRenderResponse> {
    const response = await this.fetch('/render', {
      method: 'POST',
      body: JSON.stringify(edit),
    });

    if (!response.success) {
      throw new VideoRenderError(
        response.message || 'Render submission failed',
        'RENDER_FAILED',
      );
    }

    return response as ShotstackRenderResponse;
  }

  /**
   * Fetch render status from Shotstack API
   */
  private async fetchStatus(jobId: string): Promise<ShotstackStatusResponse> {
    const response = await this.fetch(`/render/${jobId}`, {
      method: 'GET',
    });

    if (!response.success) {
      throw new VideoRenderError(
        response.message || 'Status fetch failed',
        'JOB_NOT_FOUND',
        404,
      );
    }

    return response as ShotstackStatusResponse;
  }

  /**
   * Make API request
   */
  private async fetch(
    endpoint: string,
    options: { method: string; body?: string },
  ): Promise<ShotstackRenderResponse | ShotstackStatusResponse> {
    const _url = `${this.baseUrl}${endpoint}`;

    this.log(`Shotstack API request: ${options.method} ${endpoint}`);

    // In a real implementation, this would make an actual HTTP request
    // For PoC, we'll simulate the API response

    // Simulated response
    if (options.method === 'POST' && endpoint === '/render') {
      return {
        success: true,
        message: 'Created',
        response: {
          id: `shotstack_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          message: 'Render queued',
        },
      };
    }

    if (options.method === 'GET' && endpoint.startsWith('/render/')) {
      const jobId = endpoint.split('/').pop() ?? '';
      return {
        success: true,
        message: 'OK',
        response: {
          id: jobId,
          owner: 'user-123',
          status: 'done',
          progress: 100,
          url: `https://cdn.shotstack.io/renders/${jobId}.mp4`,
          thumbnail: `https://cdn.shotstack.io/renders/${jobId}-thumb.jpg`,
          renderTime: 45,
          created: new Date(Date.now() - 60000).toISOString(),
          updated: new Date().toISOString(),
        },
      };
    }

    throw new VideoRenderError('Unknown endpoint', 'PROVIDER_ERROR');
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map Shotstack status to internal status
 */
function mapShotstackStatus(
  status: 'queued' | 'fetching' | 'rendering' | 'saving' | 'done' | 'failed',
): 'pending' | 'processing' | 'completed' | 'failed' {
  switch (status) {
    case 'queued':
      return 'pending';
    case 'fetching':
    case 'rendering':
    case 'saving':
      return 'processing';
    case 'done':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}
