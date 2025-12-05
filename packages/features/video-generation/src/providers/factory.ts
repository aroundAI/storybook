import type { ProviderConfig, VideoProvider } from '../lib/types';
import type { VideoGenerationProvider } from './base';
import { KlingProvider } from './kling';
import { LumaProvider } from './luma';
import { RunwayProvider } from './runway';

const providerInstances = new Map<VideoProvider, VideoGenerationProvider>();

export function createVideoProvider(
  provider: VideoProvider,
  config: ProviderConfig,
): VideoGenerationProvider {
  const cached = providerInstances.get(provider);
  if (cached) {
    return cached;
  }

  let instance: VideoGenerationProvider;

  switch (provider) {
    case 'kling':
      instance = new KlingProvider(config);
      break;
    case 'runway':
      instance = new RunwayProvider(config);
      break;
    case 'luma':
      instance = new LumaProvider(config);
      break;
    default:
      throw new Error(`Unknown video provider: ${provider}`);
  }

  providerInstances.set(provider, instance);
  return instance;
}

export function getVideoProvider(
  provider: VideoProvider,
): VideoGenerationProvider | undefined {
  return providerInstances.get(provider);
}

export function clearProviderCache(): void {
  providerInstances.clear();
}
