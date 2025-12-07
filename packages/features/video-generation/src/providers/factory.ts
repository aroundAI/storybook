import type { ProviderConfig, VideoProvider } from '../lib/types';
import type { VideoGenerationProvider } from './base';
import { KlingProvider } from './kling';
import { LumaProvider } from './luma';
import { RunwayProvider } from './runway';

interface CachedProvider {
  instance: VideoGenerationProvider;
  configHash: string;
}

// Provider instances are cached per Lambda invocation.
// Each Lambda container has isolated memory, so no cross-request cache sharing.
const providerInstances = new Map<VideoProvider, CachedProvider>();

function hashConfig(config: ProviderConfig): string {
  return JSON.stringify({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}

function createProviderInstance(
  provider: VideoProvider,
  config: ProviderConfig,
): VideoGenerationProvider {
  switch (provider) {
    case 'kling':
      return new KlingProvider(config);
    case 'runway':
      return new RunwayProvider(config);
    case 'luma':
      return new LumaProvider(config);
    default:
      throw new Error(`Unknown video provider: ${provider}`);
  }
}

export function createVideoProvider(
  provider: VideoProvider,
  config: ProviderConfig,
): VideoGenerationProvider {
  const configHash = hashConfig(config);

  // Check if already cached with same config
  const cached = providerInstances.get(provider);
  if (cached && cached.configHash === configHash) {
    return cached.instance;
  }

  // Create new instance and cache it
  const instance = createProviderInstance(provider, config);
  providerInstances.set(provider, { instance, configHash });

  return instance;
}

export function getVideoProvider(
  provider: VideoProvider,
): VideoGenerationProvider | undefined {
  const cached = providerInstances.get(provider);
  return cached?.instance;
}

export function clearProviderCache(): void {
  providerInstances.clear();
}
