export const VIDEO_PROVIDERS = {
  KLING: 'kling',
  RUNWAY: 'runway',
  LUMA: 'luma',
  HAILUO: 'hailuo',
} as const;

export const GENERATION_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const ASPECT_RATIOS = {
  LANDSCAPE: '16:9',
  PORTRAIT: '9:16',
  SQUARE: '1:1',
  INSTAGRAM: '4:5',
  STANDARD: '4:3',
} as const;

export const DEFAULT_GENERATION_SETTINGS = {
  duration: 5,
  aspectRatio: '16:9',
} as const;

export const PROVIDER_POLLING_INTERVAL = 5000;
export const PROVIDER_MAX_RETRIES = 3;
export const PROVIDER_TIMEOUT = 300000;

export const PROVIDER_CAPABILITIES = {
  kling: {
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    maxDuration: 10,
    supportsImageToVideo: true,
    supportsNegativePrompt: true,
  },
  runway: {
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:5'],
    maxDuration: 18,
    supportsImageToVideo: true,
    supportsNegativePrompt: false,
  },
  luma: {
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    maxDuration: 5,
    supportsImageToVideo: true,
    supportsNegativePrompt: false,
  },
  hailuo: {
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    maxDuration: 6,
    supportsImageToVideo: true,
    supportsNegativePrompt: false,
  },
} as const;
