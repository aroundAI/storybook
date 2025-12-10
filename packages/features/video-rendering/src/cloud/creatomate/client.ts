/**
 * Creatomate API Client
 *
 * Client for the Creatomate video rendering API.
 * @see https://creatomate.com/docs/api/
 */
import {
  BaseVideoRenderProvider,
  VideoRenderError,
} from '../../providers/base';
import { PROVIDER_CAPABILITIES } from '../../providers/factory';
import type { Timeline } from '../../schema/timeline';
import type {
  CreatomateProviderConfig,
  RenderCapabilities,
  RenderCostEstimate,
  RenderJobRequest,
  RenderJobResponse,
  RenderJobStatus,
} from '../../types/render-job';
import {
  convertTimelineToCreatomate,
  estimateCreatomateCost,
  getCreatomateApiUrl,
  validateTimelineForCreatomate,
} from './timeline-converter';
import type {
  CreatomateRenderRequest,
  CreatomateRenderResponse,
} from './types';

// ============================================================================
// Creatomate Render Provider
// ============================================================================

export class CreatomateRenderProvider extends BaseVideoRenderProvider {
  readonly name = 'creatomate' as const;
  readonly capabilities: RenderCapabilities = PROVIDER_CAPABILITIES.creatomate;

  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: CreatomateProviderConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? getCreatomateApiUrl();
    this.timeout = config.timeout ?? 30000;
  }

  /**
   * Submit a render job
   */
  async render(request: RenderJobRequest): Promise<RenderJobResponse> {
    const { timeline, webhookUrl, metadata } = request;

    // Validate timeline
    this.validateTimeline(timeline);

    const validation = validateTimelineForCreatomate(timeline);
    if (!validation.valid) {
      throw new VideoRenderError(
        `Timeline validation failed: ${validation.errors.join(', ')}`,
        'INVALID_TIMELINE',
      );
    }

    // Log warnings
    for (const warning of validation.warnings) {
      this.log(`Warning: ${warning}`);
    }

    // Convert timeline to Creatomate format
    const renderRequest = convertTimelineToCreatomate(timeline, {
      webhookUrl,
      metadata,
    });

    // Submit render
    const response = await this.submitRender(renderRequest);

    return {
      jobId: response.id,
      status: 'pending',
      estimatedTime: this.estimateTime(timeline),
      message: `Render job created with status: ${response.status}`,
      createdAt: response.created_at ?? new Date().toISOString(),
    };
  }

  /**
   * Get job status
   */
  async getStatus(jobId: string): Promise<RenderJobStatus> {
    const response = await this.fetchStatus(jobId);

    return {
      jobId: response.id,
      status: mapCreatomateStatus(response.status),
      progress: response.progress,
      videoUrl: response.url,
      thumbnailUrl: response.snapshot_url,
      error: response.error_message,
      startedAt: response.created_at,
      completedAt: response.completed_at,
      metadata: {
        outputFormat: response.output_format,
        width: response.width,
        height: response.height,
        frameRate: response.frame_rate,
        duration: response.duration,
        fileSize: response.file_size,
      },
    };
  }

  /**
   * Cancel a job
   * Note: Creatomate supports job cancellation for planned/waiting jobs
   */
  async cancel(jobId: string): Promise<void> {
    await this.deleteRender(jobId);
    this.log(`Cancelled job: ${jobId}`);
  }

  /**
   * Estimate rendering cost
   */
  estimateCost(timeline: Timeline): RenderCostEstimate {
    const costCents = estimateCreatomateCost(timeline);

    return {
      provider: 'creatomate',
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
   * Get Creatomate render request JSON for a timeline
   */
  getRenderRequestJson(
    timeline: Timeline,
    webhookUrl?: string,
    metadata?: string,
  ): CreatomateRenderRequest {
    return convertTimelineToCreatomate(timeline, { webhookUrl, metadata });
  }

  // ============================================================================
  // Private API Methods
  // ============================================================================

  /**
   * Submit render to Creatomate API
   */
  private async submitRender(
    request: CreatomateRenderRequest,
  ): Promise<CreatomateRenderResponse> {
    const response = await this.fetch('/renders', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    return response as CreatomateRenderResponse;
  }

  /**
   * Fetch render status from Creatomate API
   */
  private async fetchStatus(jobId: string): Promise<CreatomateRenderResponse> {
    const response = await this.fetch(`/renders/${jobId}`, {
      method: 'GET',
    });

    return response as CreatomateRenderResponse;
  }

  /**
   * Delete/cancel a render job
   */
  private async deleteRender(jobId: string): Promise<void> {
    await this.fetch(`/renders/${jobId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Make API request
   */
  private async fetch(
    endpoint: string,
    options: { method: string; body?: string },
  ): Promise<CreatomateRenderResponse> {
    const _url = `${this.baseUrl}${endpoint}`;

    this.log(`Creatomate API request: ${options.method} ${endpoint}`);

    // In a real implementation, this would make an actual HTTP request
    // For PoC, we'll simulate the API response

    // Simulated response for POST /renders
    if (options.method === 'POST' && endpoint === '/renders') {
      const jobId = `crm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      return {
        id: jobId,
        status: 'planned',
        progress: 0,
        created_at: new Date().toISOString(),
      };
    }

    // Simulated response for GET /renders/:id
    if (options.method === 'GET' && endpoint.startsWith('/renders/')) {
      const jobId = endpoint.split('/').pop() ?? '';
      return {
        id: jobId,
        status: 'succeeded',
        progress: 1,
        url: `https://cdn.creatomate.com/renders/${jobId}.mp4`,
        snapshot_url: `https://cdn.creatomate.com/renders/${jobId}-snapshot.jpg`,
        output_format: 'mp4',
        width: 1920,
        height: 1080,
        frame_rate: 30,
        duration: 60,
        file_size: 15000000,
        created_at: new Date(Date.now() - 120000).toISOString(),
        completed_at: new Date().toISOString(),
      };
    }

    // Simulated response for DELETE /renders/:id
    if (options.method === 'DELETE' && endpoint.startsWith('/renders/')) {
      return {
        id: endpoint.split('/').pop() ?? '',
        status: 'failed',
        error_message: 'Cancelled by user',
      };
    }

    throw new VideoRenderError('Unknown endpoint', 'PROVIDER_ERROR');
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map Creatomate status to internal status
 */
function mapCreatomateStatus(
  status:
    | 'planned'
    | 'waiting'
    | 'transcribing'
    | 'rendering'
    | 'succeeded'
    | 'failed',
): 'pending' | 'processing' | 'completed' | 'failed' {
  switch (status) {
    case 'planned':
    case 'waiting':
      return 'pending';
    case 'transcribing':
    case 'rendering':
      return 'processing';
    case 'succeeded':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}
