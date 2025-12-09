/**
 * Video Render Provider Factory
 *
 * Creates and manages video render provider instances.
 */

import type { RenderProvider, ProviderConfig } from '../lib/types';
import type { VideoRenderProvider } from './base';
import { FFmpegLocalProvider } from './ffmpeg-local';

/**
 * Provider instance cache
 */
const providerCache = new Map<string, VideoRenderProvider>();

/**
 * Create a cache key for provider configuration
 */
function getCacheKey(provider: RenderProvider, config: ProviderConfig): string {
  return `${provider}:${JSON.stringify(config)}`;
}

/**
 * Create a video render provider instance
 *
 * @param provider - The provider type to create
 * @param config - Provider configuration
 * @returns The provider instance
 */
export function createVideoRenderProvider(
  provider: RenderProvider,
  config: ProviderConfig = {}
): VideoRenderProvider {
  const cacheKey = getCacheKey(provider, config);

  // Return cached instance if available
  const cached = providerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Create new instance
  let instance: VideoRenderProvider;

  switch (provider) {
    case 'ffmpeg-local':
      instance = new FFmpegLocalProvider(config);
      break;

    case 'ffmpeg-docker':
      // Docker provider would connect to a Docker container running FFmpeg
      // For now, fall back to local
      console.warn('ffmpeg-docker provider not yet implemented, using ffmpeg-local');
      instance = new FFmpegLocalProvider(config);
      break;

    case 'remotion':
      // Remotion provider would use the Remotion API
      throw new Error('Remotion provider not yet implemented - see poc/remotion for sample');

    case 'shotstack':
      // Shotstack cloud rendering
      throw new Error('Shotstack provider not yet implemented - see poc/cloud-services/shotstack.ts');

    case 'creatomate':
      // Creatomate cloud rendering
      throw new Error('Creatomate provider not yet implemented - see poc/cloud-services/creatomate.ts');

    case 'mux':
      // Mux doesn't support video composition
      throw new Error('Mux does not support video composition/stitching');

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  // Cache and return
  providerCache.set(cacheKey, instance);
  return instance;
}

/**
 * Get a provider from environment configuration
 */
export function createProviderFromEnv(): VideoRenderProvider {
  const provider = (process.env.VIDEO_RENDER_PROVIDER || 'ffmpeg-local') as RenderProvider;

  const config: ProviderConfig = {
    ffmpegPath: process.env.FFMPEG_PATH,
    ffprobePath: process.env.FFPROBE_PATH,
    tempDir: process.env.VIDEO_RENDER_TEMP_DIR,
    maxConcurrency: process.env.VIDEO_RENDER_MAX_CONCURRENCY
      ? parseInt(process.env.VIDEO_RENDER_MAX_CONCURRENCY, 10)
      : undefined,
    apiKey: process.env.VIDEO_RENDER_API_KEY,
    baseUrl: process.env.VIDEO_RENDER_BASE_URL,
  };

  return createVideoRenderProvider(provider, config);
}

/**
 * Clear the provider cache
 */
export function clearProviderCache(): void {
  providerCache.clear();
}

/**
 * Get all available providers
 */
export function getAvailableProviders(): RenderProvider[] {
  return ['ffmpeg-local', 'ffmpeg-docker', 'remotion', 'shotstack', 'creatomate'];
}

/**
 * Check if a provider is implemented
 */
export function isProviderImplemented(provider: RenderProvider): boolean {
  const implemented: RenderProvider[] = ['ffmpeg-local'];
  return implemented.includes(provider);
}

/**
 * Get provider recommendation based on requirements
 */
export function recommendProvider(requirements: {
  needsLowLatency?: boolean;
  needsHighQuality?: boolean;
  needsLowCost?: boolean;
  needsNoInfrastructure?: boolean;
}): RenderProvider {
  const { needsLowLatency, needsHighQuality, needsLowCost, needsNoInfrastructure } =
    requirements;

  // If no infrastructure management desired, use cloud
  if (needsNoInfrastructure) {
    return needsLowCost ? 'creatomate' : 'shotstack';
  }

  // If low cost is priority, use self-hosted
  if (needsLowCost) {
    return 'ffmpeg-local';
  }

  // If high quality with easy development, use Remotion
  if (needsHighQuality && !needsLowLatency) {
    return 'remotion';
  }

  // Default to FFmpeg local for best performance/cost ratio
  return 'ffmpeg-local';
}
