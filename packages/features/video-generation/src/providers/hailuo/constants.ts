/**
 * Hailuo (MiniMax) provider constants and limits.
 */

/**
 * Hailuo video generation limits and constraints.
 */
export const HAILUO_LIMITS = {
  video: {
    maxDuration: 6,
    minDuration: 5,
    supportedDurations: [5, 6] as const,
    supportedFormats: ['mp4'] as const,
    aspectRatios: ['16:9', '9:16', '1:1'] as const,
    maxPromptLength: 1500,
  },
  api: {
    requestsPerMinute: 10,
    concurrentRequests: 3,
    timeout: 30000,
    typicalProcessingTime: 20,
  },
  pricing: {
    perGeneration: 40, // cents ($0.40 per video)
  },
} as const;

/**
 * Default configuration values for the Hailuo provider.
 */
export const HAILUO_DEFAULTS = {
  baseUrl: 'https://api.minimaxi.chat/v1',
  timeout: 30000,
  model: 'video-01',
} as const;

/**
 * Estimated generation time in seconds.
 */
export const HAILUO_ESTIMATED_TIME = 20;

/**
 * Cache TTL for status responses in seconds.
 */
export const HAILUO_STATUS_CACHE_TTL = 5;
