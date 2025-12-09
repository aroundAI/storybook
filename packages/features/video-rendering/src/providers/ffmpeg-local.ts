/**
 * FFmpeg Local Provider
 *
 * Video rendering provider using local FFmpeg installation.
 * Supports all FFmpeg features including transitions, audio mixing, and overlays.
 */

import ffmpeg from 'fluent-ffmpeg';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ProviderConfig,
  RenderCapabilities,
  RenderRequest,
  RenderResult,
  ProgressCallback,
  RenderProgress,
} from '../lib/types';
import { BaseVideoRenderProvider } from './base';
import { DEFAULT_RENDER_SETTINGS, QUALITY_PRESETS } from '../lib/constants';
import { buildCompleteRenderCommand } from '../lib/ffmpeg/command-builder';

/**
 * Active render job tracking
 */
interface ActiveJob {
  progress: number;
  command: ffmpeg.FfmpegCommand;
  startTime: number;
  outputPath: string;
}

/**
 * FFmpeg Local Provider
 *
 * Uses the local FFmpeg installation for video rendering.
 * Best for self-hosted deployments with full control.
 */
export class FFmpegLocalProvider extends BaseVideoRenderProvider {
  readonly name = 'ffmpeg-local';

  readonly capabilities: RenderCapabilities = {
    supportedFormats: ['mp4', 'webm', 'mov'],
    maxResolution: '4k',
    supportsTransitions: true,
    supportedTransitions: [
      'cut',
      'fade',
      'crossfade',
      'dissolve',
      'wipe-left',
      'wipe-right',
      'wipe-up',
      'wipe-down',
    ],
    supportsAudioMixing: true,
    supportsTextOverlays: true,
    maxConcurrentJobs: 4,
    maxInputVideos: 100,
    maxDuration: 3600, // 1 hour
  };

  private readonly activeJobs = new Map<string, ActiveJob>();
  private readonly tempDir: string;

  constructor(config: ProviderConfig = {}) {
    super(config);

    this.tempDir = config.tempDir ?? DEFAULT_RENDER_SETTINGS.tempDir;

    // Configure FFmpeg paths if provided
    if (config.ffmpegPath) {
      ffmpeg.setFfmpegPath(config.ffmpegPath);
    }
    if (config.ffprobePath) {
      ffmpeg.setFfprobePath(config.ffprobePath);
    }

    // Ensure temp directory exists
    this.ensureTempDir();
  }

  /**
   * Check if FFmpeg is available
   */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      ffmpeg.getAvailableFormats((err) => {
        resolve(!err);
      });
    });
  }

  /**
   * Render video from request
   */
  async render(
    request: RenderRequest,
    onProgress?: ProgressCallback
  ): Promise<RenderResult> {
    // Validate request
    this.validateRequest(request);

    const jobId = uuidv4();
    const outputPath = path.join(this.tempDir, `${jobId}.${request.outputFormat}`);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      // Build the FFmpeg command
      const renderCommand = buildCompleteRenderCommand(request, outputPath);

      // Create fluent-ffmpeg command
      const command = ffmpeg();

      // Add inputs
      request.shots.forEach((shot) => {
        command.input(shot.sourceUrl);
      });

      // Add audio inputs if present
      if (request.audioTracks) {
        request.audioTracks.forEach((audio) => {
          command.input(audio.sourceUrl);
        });
      }

      // Apply filter complex if present
      if (renderCommand.filterComplex) {
        command.complexFilter(renderCommand.filterComplex);
      } else {
        // Simple concat without complex filter
        const filterInputs = request.shots.map((_, i) => `[${i}:v][${i}:a]`).join('');
        command.complexFilter(
          `${filterInputs}concat=n=${request.shots.length}:v=1:a=1[outv][outa]`
        );
      }

      // Output options
      command
        .outputOptions(['-map [outv]', '-map [outa]'])
        .outputOptions(this.getQualityOptions(request.quality))
        .outputOptions(this.getResolutionOptions(request.resolution))
        .outputOptions(['-movflags', '+faststart'])
        .output(outputPath);

      // Set up event handlers
      command
        .on('start', (cmdLine) => {
          console.log(`[FFmpeg] Job ${jobId} started:`, cmdLine);
        })
        .on('progress', (progress) => {
          const percent = progress.percent ?? 0;
          this.activeJobs.set(jobId, {
            progress: percent,
            command,
            startTime,
            outputPath,
          });

          if (onProgress) {
            const progressInfo: RenderProgress = {
              jobId,
              percent,
              frame: progress.frames,
              currentTime: progress.timemark
                ? this.parseTimemark(progress.timemark)
                : undefined,
              speed: progress.currentFps
                ? `${(progress.currentFps / (request.framerate ?? 30)).toFixed(1)}x`
                : undefined,
              bitrate: progress.currentKbps
                ? `${progress.currentKbps}kbps`
                : undefined,
            };
            onProgress(progressInfo);
          }
        })
        .on('end', async () => {
          this.activeJobs.delete(jobId);

          // Get file stats
          const stats = fs.statSync(outputPath);
          const duration = await this.getVideoDuration(outputPath);

          resolve({
            jobId,
            status: 'completed',
            progress: 100,
            outputUrl: outputPath,
            duration,
            fileSize: stats.size,
            renderTime: Date.now() - startTime,
          });
        })
        .on('error', (err) => {
          this.activeJobs.delete(jobId);
          console.error(`[FFmpeg] Job ${jobId} failed:`, err);

          // Clean up partial output
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }

          reject({
            jobId,
            status: 'failed',
            error: err.message,
            renderTime: Date.now() - startTime,
          });
        });

      // Track active job
      this.activeJobs.set(jobId, {
        progress: 0,
        command,
        startTime,
        outputPath,
      });

      // Start rendering
      command.run();
    });
  }

  /**
   * Get progress of a render job
   */
  async getProgress(jobId: string): Promise<number> {
    const job = this.activeJobs.get(jobId);
    return job?.progress ?? 0;
  }

  /**
   * Cancel a render job
   */
  async cancel(jobId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.command.kill('SIGTERM');
      this.activeJobs.delete(jobId);

      // Clean up partial output
      if (fs.existsSync(job.outputPath)) {
        fs.unlinkSync(job.outputPath);
      }
    }
  }

  /**
   * Get quality-related FFmpeg options
   */
  private getQualityOptions(quality: string): string[] {
    const preset = QUALITY_PRESETS[quality as keyof typeof QUALITY_PRESETS];
    return [
      '-c:v',
      'libx264',
      '-preset',
      preset?.preset ?? 'medium',
      '-crf',
      String(preset?.crf ?? 23),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
    ];
  }

  /**
   * Get resolution-related FFmpeg options
   */
  private getResolutionOptions(resolution: string): string[] {
    const resolutions: Record<string, string> = {
      '480p': '854:480',
      '720p': '1280:720',
      '1080p': '1920:1080',
      '4k': '3840:2160',
    };

    const scale = resolutions[resolution] ?? resolutions['1080p'];
    return [
      '-vf',
      `scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale.split(':')[0]}:${scale.split(':')[1]}:(ow-iw)/2:(oh-ih)/2`,
    ];
  }

  /**
   * Ensure temp directory exists
   */
  private ensureTempDir(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Parse FFmpeg timemark string to seconds
   */
  private parseTimemark(timemark: string): number {
    const parts = timemark.split(':');
    if (parts.length === 3) {
      const [hours, minutes, seconds] = parts.map(parseFloat);
      return hours * 3600 + minutes * 60 + seconds;
    }
    return 0;
  }

  /**
   * Get video duration using ffprobe
   */
  private async getVideoDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err || !metadata.format?.duration) {
          resolve(0);
        } else {
          resolve(metadata.format.duration);
        }
      });
    });
  }

  /**
   * Clean up old temporary files
   */
  async cleanup(maxAgeHours: number = 24): Promise<number> {
    let deletedCount = 0;
    const maxAge = maxAgeHours * 60 * 60 * 1000;
    const now = Date.now();

    const files = fs.readdirSync(this.tempDir);
    for (const file of files) {
      const filePath = path.join(this.tempDir, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }

    return deletedCount;
  }
}
