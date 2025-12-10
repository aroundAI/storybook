/**
 * FFmpeg Render Provider
 *
 * Implements the VideoRenderProvider interface using FFmpeg
 * for local video rendering.
 */
import { BaseVideoRenderProvider, VideoRenderError } from '../providers/base';
import { PROVIDER_CAPABILITIES } from '../providers/factory';
import type { Timeline } from '../schema/timeline';
import type {
  FFmpegProviderConfig,
  RenderCapabilities,
  RenderCostEstimate,
  RenderJobRequest,
  RenderJobResponse,
  RenderJobStatus,
} from '../types/render-job';
import { convertTimelineToFFmpeg } from './timeline-converter';

// ============================================================================
// Job Storage (in-memory for PoC)
// ============================================================================

interface FFmpegJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  timeline: Timeline;
  outputPath: string;
  startedAt?: string;
  completedAt?: string;
  videoUrl?: string;
  error?: string;
}

const jobStorage = new Map<string, FFmpegJob>();

// ============================================================================
// FFmpeg Render Provider
// ============================================================================

export class FFmpegRenderProvider extends BaseVideoRenderProvider {
  readonly name = 'ffmpeg' as const;
  readonly capabilities: RenderCapabilities = PROVIDER_CAPABILITIES.ffmpeg;

  private ffmpegPath: string;
  private ffprobePath: string;
  private workingDir: string;
  private threads: number;
  private hwaccel: 'none' | 'cuda' | 'videotoolbox' | 'qsv' | 'vaapi';

  constructor(config: FFmpegProviderConfig) {
    super(config);
    this.ffmpegPath = config.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = config.ffprobePath ?? 'ffprobe';
    this.workingDir = config.workingDir ?? '/tmp';
    this.threads = config.threads ?? 0; // 0 = auto
    this.hwaccel = config.hwaccel ?? 'none';
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

    // Generate job ID
    const jobId = idempotencyKey ?? generateJobId();
    const outputPath = `${this.workingDir}/render_${jobId}.${timeline.renderSettings.format}`;

    // Create job record
    const job: FFmpegJob = {
      id: jobId,
      status: 'pending',
      progress: 0,
      timeline,
      outputPath,
    };

    jobStorage.set(jobId, job);

    // In a real implementation, this would queue the job for processing
    // For PoC, we'll simulate starting the job
    this.log(`Created render job ${jobId}`, { priority, outputPath });

    // Simulate job starting (in real implementation, this would be async)
    setTimeout(() => this.startJob(jobId), 100);

    return {
      jobId,
      status: 'pending',
      estimatedTime: this.estimateTime(timeline),
      message: 'Job queued for processing',
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
    this.log(`Cancelled job ${jobId}`);
  }

  /**
   * Estimate rendering cost
   * FFmpeg is local, so cost is based on compute time
   */
  estimateCost(timeline: Timeline): RenderCostEstimate {
    // FFmpeg is free, cost is compute time
    const renderTime = this.estimateTime(timeline);

    // Estimate compute cost at ~$0.01 per minute of compute
    const computeCostCents = Math.ceil((renderTime / 60) * 1);

    return {
      provider: 'ffmpeg',
      estimatedCostCents: computeCostCents,
      breakdown: {
        baseCost: 0,
        perSecondCost: 0.017, // ~$0.01/min
        durationSeconds: timeline.duration,
        qualityMultiplier: this.getQualityMultiplier(timeline),
        resolutionMultiplier: this.getResolutionMultiplier(timeline),
      },
      isFixed: false,
      displayCost:
        computeCostCents === 0
          ? 'Free'
          : `~${this.formatCost(computeCostCents)}`,
    };
  }

  /**
   * Get FFmpeg command for a timeline
   * Useful for debugging or manual execution
   */
  getCommand(timeline: Timeline, outputPath: string): string {
    const result = convertTimelineToFFmpeg(timeline, {
      outputPath,
      ffmpegPath: this.ffmpegPath,
      workingDir: this.workingDir,
      hwaccel: this.hwaccel,
      threads: this.threads,
    });

    return result.commandString;
  }

  /**
   * Get FFmpeg arguments for a timeline
   */
  getArgs(timeline: Timeline, outputPath: string): string[] {
    const result = convertTimelineToFFmpeg(timeline, {
      outputPath,
      ffmpegPath: this.ffmpegPath,
      workingDir: this.workingDir,
      hwaccel: this.hwaccel,
      threads: this.threads,
    });

    return result.args;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Start processing a job
   * In a real implementation, this would spawn FFmpeg process
   */
  private async startJob(jobId: string): Promise<void> {
    const job = jobStorage.get(jobId);
    if (!job || job.status !== 'pending') return;

    job.status = 'processing';
    job.startedAt = new Date().toISOString();
    job.progress = 0;

    this.log(`Starting job ${jobId}`);

    try {
      // Convert timeline to FFmpeg command
      const result = convertTimelineToFFmpeg(job.timeline, {
        outputPath: job.outputPath,
        ffmpegPath: this.ffmpegPath,
        workingDir: this.workingDir,
        hwaccel: this.hwaccel,
        threads: this.threads,
      });

      this.log(`FFmpeg command: ${result.commandString}`);

      // In a real implementation, we would:
      // 1. Write concat file if needed
      // 2. Spawn FFmpeg process
      // 3. Parse progress from stderr
      // 4. Update job.progress periodically

      // For PoC, simulate progress
      await this.simulateProgress(jobId, result.estimatedRenderTime);

      // Mark as completed
      job.status = 'completed';
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      job.videoUrl = job.outputPath; // In real impl, this would be uploaded to storage

      this.log(`Job ${jobId} completed`);
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      this.log(`Job ${jobId} failed: ${job.error}`);
    }
  }

  /**
   * Simulate render progress
   */
  private async simulateProgress(
    jobId: string,
    estimatedSeconds: number,
  ): Promise<void> {
    const job = jobStorage.get(jobId);
    if (!job) return;

    const steps = 10;
    const stepDuration = (estimatedSeconds * 1000) / steps;

    for (let i = 1; i <= steps; i++) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(stepDuration, 1000)),
      );

      if (job.status !== 'processing') return; // Job was cancelled

      job.progress = Math.min(i * 10, 95);
      this.log(`Job ${jobId} progress: ${job.progress}%`);
    }
  }
}

// ============================================================================
// Utilities
// ============================================================================

function generateJobId(): string {
  return `ffmpeg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Clear all jobs from storage (for testing)
 */
export function clearJobStorage(): void {
  jobStorage.clear();
}

/**
 * Get all jobs (for debugging)
 */
export function getAllJobs(): FFmpegJob[] {
  return Array.from(jobStorage.values());
}
