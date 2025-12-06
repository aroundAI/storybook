import type {
  ProviderCapabilities,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationStatus,
} from '../lib/types';

export interface VideoGenerationProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  generateVideo(
    request: VideoGenerationRequest,
  ): Promise<VideoGenerationResponse>;
  getStatus(jobId: string): Promise<VideoGenerationStatus>;
  cancelJob(jobId: string): Promise<void>;
}

export abstract class BaseVideoGenerationProvider
  implements VideoGenerationProvider
{
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapabilities;

  abstract generateVideo(
    request: VideoGenerationRequest,
  ): Promise<VideoGenerationResponse>;
  abstract getStatus(jobId: string): Promise<VideoGenerationStatus>;
  abstract cancelJob(jobId: string): Promise<void>;

  protected validateRequest(request: VideoGenerationRequest): void {
    if (!request.prompt || request.prompt.trim().length === 0) {
      throw new Error('Prompt is required');
    }

    if (request.duration <= 0) {
      throw new Error('Duration must be positive');
    }

    if (request.duration > this.capabilities.maxDuration) {
      throw new Error(
        `Duration exceeds maximum of ${this.capabilities.maxDuration} seconds for ${this.name}`,
      );
    }

    if (
      !this.capabilities.supportedAspectRatios.includes(request.aspectRatio)
    ) {
      throw new Error(
        `Aspect ratio ${request.aspectRatio} not supported by ${this.name}. Supported: ${this.capabilities.supportedAspectRatios.join(', ')}`,
      );
    }

    if (request.negativePrompt && !this.capabilities.supportsNegativePrompt) {
      throw new Error(`${this.name} does not support negative prompts`);
    }
  }
}
