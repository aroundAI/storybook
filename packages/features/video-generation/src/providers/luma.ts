import { PROVIDER_CAPABILITIES } from '../lib/constants';
import type {
  ProviderCapabilities,
  ProviderConfig,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationStatus,
} from '../lib/types';
import { BaseVideoGenerationProvider } from './base';

export class LumaProvider extends BaseVideoGenerationProvider {
  readonly name = 'luma';
  readonly capabilities: ProviderCapabilities = PROVIDER_CAPABILITIES.luma;

  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    super();
    this.config = config;
  }

  async generateVideo(
    request: VideoGenerationRequest,
  ): Promise<VideoGenerationResponse> {
    this.validateRequest(request);

    // Implementation will be added when integrating with Luma API
    throw new Error('Luma provider not yet implemented');
  }

  async getStatus(_jobId: string): Promise<VideoGenerationStatus> {
    // Implementation will be added when integrating with Luma API
    throw new Error('Luma provider not yet implemented');
  }

  async cancelJob(_jobId: string): Promise<void> {
    // Implementation will be added when integrating with Luma API
    throw new Error('Luma provider not yet implemented');
  }
}

export function createLumaProvider(config: ProviderConfig): LumaProvider {
  return new LumaProvider(config);
}
