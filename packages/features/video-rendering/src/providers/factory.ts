/**
 * Render Provider Factory
 *
 * Creates and caches render provider instances.
 * Following the same pattern as @kit/video-generation factory.
 */
import type {
  CreatomateProviderConfig,
  FFmpegProviderConfig,
  ProviderConfig,
  RemotionProviderConfig,
  RenderCapabilities,
  RenderProviderType,
  ShotstackProviderConfig,
} from '../types/render-job';
import type { VideoRenderProvider } from './base';

// Provider instance cache
const providerCache = new Map<string, VideoRenderProvider>();

/**
 * Generate a cache key from provider config
 */
function getCacheKey(config: ProviderConfig): string {
  const { provider, ...rest } = config;
  return `${provider}:${JSON.stringify(rest)}`;
}

/**
 * Create a render provider instance
 *
 * @param config - Provider configuration
 * @returns Render provider instance
 *
 * @example
 * ```typescript
 * const provider = await createRenderProvider({
 *   provider: 'ffmpeg',
 *   ffmpegPath: '/usr/bin/ffmpeg',
 * });
 *
 * const result = await provider.render({ timeline });
 * ```
 */
export async function createRenderProvider(
  config: ProviderConfig,
): Promise<VideoRenderProvider> {
  const cacheKey = getCacheKey(config);

  // Return cached instance if exists
  const cached = providerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Create new instance based on provider type
  let provider: VideoRenderProvider;

  switch (config.provider) {
    case 'ffmpeg': {
      const { FFmpegRenderProvider } = await import('../ffmpeg');
      provider = new FFmpegRenderProvider(config as FFmpegProviderConfig);
      break;
    }

    case 'remotion': {
      const { RemotionRenderProvider } = await import('../remotion');
      provider = new RemotionRenderProvider(config as RemotionProviderConfig);
      break;
    }

    case 'shotstack': {
      const { ShotstackRenderProvider } = await import('../cloud/shotstack');
      provider = new ShotstackRenderProvider(config as ShotstackProviderConfig);
      break;
    }

    case 'creatomate': {
      const { CreatomateRenderProvider } = await import('../cloud/creatomate');
      provider = new CreatomateRenderProvider(
        config as CreatomateProviderConfig,
      );
      break;
    }

    default: {
      const exhaustiveCheck: never = config;
      throw new Error(
        `Unknown provider: ${(exhaustiveCheck as ProviderConfig).provider}`,
      );
    }
  }

  // Cache the instance
  providerCache.set(cacheKey, provider);

  return provider;
}

/**
 * Clear the provider cache
 */
export function clearProviderCache(): void {
  providerCache.clear();
}

/**
 * Remove a specific provider from cache
 */
export function removeProviderFromCache(config: ProviderConfig): boolean {
  const cacheKey = getCacheKey(config);
  return providerCache.delete(cacheKey);
}

/**
 * Get provider capabilities without creating an instance
 */
export function getProviderCapabilities(
  provider: RenderProviderType,
): RenderCapabilities {
  return PROVIDER_CAPABILITIES[provider];
}

/**
 * Provider capabilities registry
 */
export const PROVIDER_CAPABILITIES: Record<
  RenderProviderType,
  RenderCapabilities
> = {
  ffmpeg: {
    name: 'ffmpeg',
    supportedTransitions: [
      'cut',
      'fade',
      'crossfade',
      'wipe',
      'dissolve',
      'slide',
    ],
    maxDuration: 3600, // 1 hour
    supportedFormats: ['mp4', 'webm', 'mov', 'mkv'],
    supportedCodecs: ['h264', 'h265', 'vp9', 'prores'],
    maxWidth: 7680,
    maxHeight: 4320,
    supportsPreview: false,
    supportsStreaming: true,
    isLocal: true,
    typicalRenderSpeed: 0.5, // 2x realtime on average hardware
  },

  remotion: {
    name: 'remotion',
    supportedTransitions: ['cut', 'fade', 'crossfade', 'wipe', 'dissolve'],
    maxDuration: 1800, // 30 minutes
    supportedFormats: ['mp4', 'webm'],
    supportedCodecs: ['h264', 'vp9'],
    maxWidth: 3840,
    maxHeight: 2160,
    supportsPreview: true,
    supportsStreaming: false,
    isLocal: false, // Uses Lambda by default
    typicalRenderSpeed: 0.3, // Faster with Lambda parallelization
  },

  shotstack: {
    name: 'shotstack',
    supportedTransitions: ['cut', 'fade', 'crossfade', 'wipe', 'dissolve'],
    maxDuration: 600, // 10 minutes
    supportedFormats: ['mp4', 'webm', 'mov'],
    supportedCodecs: ['h264', 'h265'],
    maxWidth: 3840,
    maxHeight: 2160,
    supportsPreview: true,
    supportsStreaming: false,
    isLocal: false,
    typicalRenderSpeed: 0.2, // Cloud rendering is faster
  },

  creatomate: {
    name: 'creatomate',
    supportedTransitions: ['cut', 'fade', 'crossfade', 'wipe', 'dissolve'],
    maxDuration: 600, // 10 minutes
    supportedFormats: ['mp4', 'webm'],
    supportedCodecs: ['h264'],
    maxWidth: 3840,
    maxHeight: 2160,
    supportsPreview: true,
    supportsStreaming: false,
    isLocal: false,
    typicalRenderSpeed: 0.25,
  },
};

/**
 * Get all available providers
 */
export function getAvailableProviders(): RenderProviderType[] {
  return ['ffmpeg', 'remotion', 'shotstack', 'creatomate'];
}

/**
 * Check if a provider is available based on environment
 */
export function isProviderAvailable(provider: RenderProviderType): boolean {
  switch (provider) {
    case 'ffmpeg':
      // FFmpeg requires local binary
      return true; // Assume available for PoC
    case 'remotion':
      // Remotion requires npm packages
      return true;
    case 'shotstack':
      return !!process.env.SHOTSTACK_API_KEY;
    case 'creatomate':
      return !!process.env.CREATOMATE_API_KEY;
    default:
      return false;
  }
}

/**
 * Get recommended provider based on requirements
 */
export function getRecommendedProvider(requirements: {
  duration: number;
  needsPreview?: boolean;
  preferLocal?: boolean;
  maxCostCents?: number;
}): RenderProviderType {
  const { duration, needsPreview, preferLocal, maxCostCents } = requirements;

  // If preview is needed and duration is short, use cloud
  if (needsPreview && duration <= 60) {
    if (isProviderAvailable('shotstack')) return 'shotstack';
    if (isProviderAvailable('creatomate')) return 'creatomate';
  }

  // If local is preferred or cost is a concern
  if (preferLocal || (maxCostCents !== undefined && maxCostCents < 50)) {
    return 'ffmpeg';
  }

  // For long videos, FFmpeg is more reliable
  if (duration > 300) {
    return 'ffmpeg';
  }

  // Default to FFmpeg for now (most flexible)
  return 'ffmpeg';
}
