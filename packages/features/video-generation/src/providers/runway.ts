import { PROVIDER_CAPABILITIES } from '../lib/constants';
import type {
  ProviderCapabilities,
  ProviderConfig,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationStatus,
} from '../lib/types';
import { BaseVideoGenerationProvider } from './base';

export class RunwayProvider extends BaseVideoGenerationProvider {
  readonly name = 'runway';
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.runway;

  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    super();
    this.config = config;
  }

  async generateVideo(
    request: VideoGenerationRequest,
  ): Promise<VideoGenerationResponse> {
    this.validateRequest(request);

    // Implementation will be added when integrating with Runway API
    throw new Error('Runway provider not yet implemented');
  }

  async getStatus(_jobId: string): Promise<VideoGenerationStatus> {
    // Implementation will be added when integrating with Runway API
    throw new Error('Runway provider not yet implemented');
  }

  async cancelJob(_jobId: string): Promise<void> {
    // Implementation will be added when integrating with Runway API
    throw new Error('Runway provider not yet implemented');
  }
}

export function createRunwayProvider(config: ProviderConfig): RunwayProvider {
  return new RunwayProvider(config);
}
