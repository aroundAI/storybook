import type { ProviderConfig, VideoProvider } from '../lib/types';
import type { VideoGenerationProvider } from './base';
import { KlingProvider } from './kling';
import { LumaProvider } from './luma';
import { RunwayProvider } from './runway';

interface CachedProvider {
  instance: VideoGenerationProvider;
  configHash: string;
}

const providerInstances = new Map<VideoProvider, CachedProvider>();

function hashConfig(config: ProviderConfig): string {
  return JSON.stringify({
    apiKey: config.apiKey?.slice(-8), // Only use last 8 chars for comparison
    baseUrl: config.baseUrl,
  });
}

export function createVideoProvider(
  provider: VideoProvider,
  config: ProviderConfig,
): VideoGenerationProvider {
  const configHash = hashConfig(config);
  const cached = providerInstances.get(provider);

  if (cached && cached.configHash === configHash) {
    return cached.instance;
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
