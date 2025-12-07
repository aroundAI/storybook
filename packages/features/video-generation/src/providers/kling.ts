import { PROVIDER_CAPABILITIES } from '../lib/constants';
import type {
  ProviderCapabilities,
  ProviderConfig,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationStatus,
} from '../lib/types';
import { BaseVideoGenerationProvider } from './base';

export class KlingProvider extends BaseVideoGenerationProvider {
  readonly name = 'kling';
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.kling;

  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    super();
    this.config = config;
  }

  async generateVideo(
    request: VideoGenerationRequest,
  ): Promise<VideoGenerationResponse> {
    this.validateRequest(request);

    // Implementation will be added when integrating with Kling API
    throw new Error('Kling provider not yet implemented');
  }

  async getStatus(_jobId: string): Promise<VideoGenerationStatus> {
    // Implementation will be added when integrating with Kling API
    throw new Error('Kling provider not yet implemented');
  }

  async cancelJob(_jobId: string): Promise<void> {
    // Implementation will be added when integrating with Kling API
    throw new Error('Kling provider not yet implemented');
  }
}

export function createKlingProvider(config: ProviderConfig): KlingProvider {
  return new KlingProvider(config);
}
