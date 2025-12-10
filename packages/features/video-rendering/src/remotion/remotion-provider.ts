/**
 * Remotion Render Provider
 *
 * Implements the VideoRenderProvider interface using Remotion
 * for React-based video composition and rendering.
 */
import { BaseVideoRenderProvider, VideoRenderError } from '../providers/base';
import { PROVIDER_CAPABILITIES } from '../providers/factory';
import type { Timeline } from '../schema/timeline';
import type {
  RemotionProviderConfig,
  RenderCapabilities,
  RenderCostEstimate,
  RenderJobRequest,
  RenderJobResponse,
  RenderJobStatus,
} from '../types/render-job';
import {
  type RemotionCompositionProps,
  type RemotionRenderConfig,
  convertRenderSettings,
  convertTimelineToRemotion,
  validateTimelineForRemotion,
} from './timeline-converter';

// ============================================================================
// Job Storage (in-memory for PoC)
// ============================================================================

interface RemotionJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  timeline: Timeline;
  compositionProps: RemotionCompositionProps;
  renderConfig: RemotionRenderConfig;
  startedAt?: string;
  completedAt?: string;
  videoUrl?: string;
  error?: string;
}

const jobStorage = new Map<string, RemotionJob>();

// ============================================================================
// Remotion Render Provider
// ============================================================================

export class RemotionRenderProvider extends BaseVideoRenderProvider {
  readonly name = 'remotion' as const;
  readonly capabilities: RenderCapabilities = PROVIDER_CAPABILITIES.remotion;

  private lambdaArn?: string;
  private region: string;
  private outputBucket?: string;
  private renderLocally: boolean;
  private concurrency: number;

  constructor(config: RemotionProviderConfig) {
    super(config);
    this.lambdaArn = config.lambdaArn;
    this.region = config.region ?? 'us-east-1';
    this.outputBucket = config.outputBucket;
    this.renderLocally = config.renderLocally ?? true;
    this.concurrency = config.concurrency ?? 4;
  }

  /**
   * Submit a render job
   */
  async render(request: RenderJobRequest): Promise<RenderJobResponse> {
    const { timeline, priority = 5, idempotencyKey } = request;

    // Check for existing job with same idempotency key
    if (idempotencyKey) {
      for (const [jobId, job] of jobStorage) {
        if (job.id === idempotencyKey) {
          return {
            jobId,
            status: job.status,
            createdAt: job.startedAt ?? new Date().toISOString(),
          };
        }
      }
    }

    // Validate timeline
    this.validateTimeline(timeline);

    // Validate for Remotion-specific requirements
    const validation = validateTimelineForRemotion(timeline);
    if (!validation.valid) {
      throw new VideoRenderError(
        `Timeline validation failed: ${validation.errors.join(', ')}`,
        'INVALID_TIMELINE',
      );
    }

    // Convert timeline to Remotion format
    const compositionProps = convertTimelineToRemotion(timeline);
    const renderConfig = convertRenderSettings(timeline.renderSettings);

    // Generate job ID
    const jobId = idempotencyKey ?? generateJobId();

    // Create job record
    const job: RemotionJob = {
      id: jobId,
      status: 'pending',
      progress: 0,
      timeline,
      compositionProps,
      renderConfig,
    };

    jobStorage.set(jobId, job);

    this.log(`Created Remotion render job ${jobId}`, {
      priority,
      frames: compositionProps.durationInFrames,
      renderLocal: this.renderLocally,
    });

    // Start processing (simulated for PoC)
    setTimeout(() => this.startJob(jobId), 100);

    return {
      jobId,
      status: 'pending',
      estimatedTime: this.estimateTime(timeline),
      message: this.renderLocally
        ? 'Job queued for local rendering'
        : 'Job queued for Lambda rendering',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Get job status
   */
  async getStatus(jobId: string): Promise<RenderJobStatus> {
    const job = jobStorage.get(jobId);

    if (!job) {
      throw new VideoRenderError(
        `Job ${jobId} not found`,
        'JOB_NOT_FOUND',
        404,
      );
    }

    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      videoUrl: job.videoUrl,
      error: job.error,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }

  /**
   * Cancel a job
   */
  async cancel(jobId: string): Promise<void> {
    const job = jobStorage.get(jobId);

    if (!job) {
      throw new VideoRenderError(
        `Job ${jobId} not found`,
        'JOB_NOT_FOUND',
        404,
      );
    }

    if (job.status === 'completed' || job.status === 'failed') {
      throw new VideoRenderError(
        `Cannot cancel ${job.status} job`,
        'INVALID_STATE',
        400,
      );
    }

    job.status = 'cancelled';
    this.log(`Cancelled Remotion job ${jobId}`);
  }

  /**
   * Estimate rendering cost
   */
  estimateCost(timeline: Timeline): RenderCostEstimate {
    const compositionProps = convertTimelineToRemotion(timeline);
    const totalFrames = compositionProps.durationInFrames;

    if (this.renderLocally) {
      // Local rendering is essentially free (just compute time)
      const computeMinutes = this.estimateTime(timeline) / 60;
      const costCents = Math.ceil(computeMinutes * 1); // ~$0.01/min

      return {
        provider: 'remotion',
        estimatedCostCents: costCents,
        breakdown: {
          baseCost: 0,
          perSecondCost: 0.017,
          durationSeconds: timeline.duration,
          qualityMultiplier: this.getQualityMultiplier(timeline),
          resolutionMultiplier: this.getResolutionMultiplier(timeline),
        },
        isFixed: false,
        displayCost:
          costCents === 0 ? 'Free' : `~${this.formatCost(costCents)}`,
      };
    }

    // Lambda rendering costs (Remotion Cloud pricing approximation)
    // ~$0.02 per 1000 frames
    const frameCost = Math.ceil((totalFrames / 1000) * 2);

    // Add Lambda execution cost
    const executionMinutes = this.estimateTime(timeline) / 60;
    const lambdaCost = Math.ceil(executionMinutes * 5); // ~$0.05/min for Lambda

    const totalCost = frameCost + lambdaCost;

    return {
      provider: 'remotion',
      estimatedCostCents: totalCost,
      breakdown: {
        baseCost: lambdaCost,
        perSecondCost: frameCost / timeline.duration,
        durationSeconds: timeline.duration,
        qualityMultiplier: this.getQualityMultiplier(timeline),
        resolutionMultiplier: this.getResolutionMultiplier(timeline),
      },
      isFixed: false,
      displayCost: this.formatCost(totalCost),
    };
  }

  /**
   * Get Remotion composition props for a timeline
   */
  getCompositionProps(timeline: Timeline): RemotionCompositionProps {
    return convertTimelineToRemotion(timeline);
  }

  /**
   * Get Remotion render config for a timeline
   */
  getRenderConfig(timeline: Timeline): RemotionRenderConfig {
    return convertRenderSettings(timeline.renderSettings);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Start processing a job
   */
  private async startJob(jobId: string): Promise<void> {
    const job = jobStorage.get(jobId);
    if (!job || job.status !== 'pending') return;

    job.status = 'processing';
    job.startedAt = new Date().toISOString();
    job.progress = 0;

    this.log(`Starting Remotion job ${jobId}`);

    try {
      if (this.renderLocally) {
        await this.renderLocal(job);
      } else {
        await this.renderLambda(job);
      }

      job.status = 'completed';
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      job.videoUrl = `https://storage.example.com/renders/${job.id}.mp4`;

      this.log(`Remotion job ${jobId} completed`);
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Remotion job ${jobId} failed: ${job.error}`);
    }
  }

  /**
   * Render locally using Remotion CLI
   * In a real implementation, this would use @remotion/renderer
   */
  private async renderLocal(job: RemotionJob): Promise<void> {
    this.log(
      `Rendering locally: ${job.compositionProps.durationInFrames} frames`,
    );

    // Simulate frame-by-frame rendering
    const totalFrames = job.compositionProps.durationInFrames;
    const framesPerStep = Math.ceil(totalFrames / 10);

    for (let frame = 0; frame < totalFrames; frame += framesPerStep) {
      if (job.status !== 'processing') return;

      await new Promise((resolve) => setTimeout(resolve, 500));
      job.progress = Math.min(Math.round((frame / totalFrames) * 100), 95);
      this.log(`Job ${job.id} progress: ${job.progress}%`);
    }

    // In real implementation:
    // const { renderMedia } = await import('@remotion/renderer');
    // await renderMedia({
    //   composition: {
    //     id: 'Timeline',
    //     durationInFrames: job.compositionProps.durationInFrames,
    //     fps: job.compositionProps.fps,
    //     width: job.compositionProps.width,
    //     height: job.compositionProps.height,
    //     defaultProps: job.compositionProps,
    //   },
    //   serveUrl: bundleLocation,
    //   codec: job.renderConfig.codec,
    //   outputLocation: outputPath,
    //   onProgress: ({ progress }) => {
    //     job.progress = Math.round(progress * 100);
    //   },
    // });
  }

  /**
   * Render using Remotion Lambda
   * In a real implementation, this would use @remotion/lambda
   */
  private async renderLambda(job: RemotionJob): Promise<void> {
    if (!this.lambdaArn) {
      throw new VideoRenderError(
        'Lambda ARN not configured',
        'CONFIGURATION_ERROR',
      );
    }

    this.log(`Rendering with Lambda: ${this.lambdaArn}`);

    // Simulate Lambda rendering (faster due to parallelization)
    const totalFrames = job.compositionProps.durationInFrames;
    const chunks = Math.ceil(totalFrames / 500); // 500 frames per chunk

    for (let chunk = 0; chunk < chunks; chunk++) {
      if (job.status !== 'processing') return;

      await new Promise((resolve) => setTimeout(resolve, 200));
      job.progress = Math.min(Math.round(((chunk + 1) / chunks) * 100), 95);
      this.log(`Job ${job.id} Lambda progress: ${job.progress}%`);
    }

    // In real implementation:
    // const { renderMediaOnLambda } = await import('@remotion/lambda');
    // const { renderId } = await renderMediaOnLambda({
    //   region: this.region,
    //   functionName: this.lambdaArn,
    //   composition: 'Timeline',
    //   serveUrl: bundleLocation,
    //   codec: job.renderConfig.codec,
    //   inputProps: job.compositionProps,
    //   outName: `${job.id}.mp4`,
    // });
  }
}

// ============================================================================
// Utilities
// ============================================================================

function generateJobId(): string {
  return `remotion_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Clear all jobs from storage (for testing)
 */
export function clearRemotionJobStorage(): void {
  jobStorage.clear();
}

/**
 * Get all jobs (for debugging)
 */
export function getAllRemotionJobs(): RemotionJob[] {
  return Array.from(jobStorage.values());
}
