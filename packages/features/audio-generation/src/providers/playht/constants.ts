/**
 * PlayHT provider-specific constants
 */

export const PLAYHT_PROVIDER = {
  // API Configuration
  API: {
    BASE_URL: 'https://api.play.ht/api/v2',
    ENDPOINTS: {
      TTS: '/tts',
      TTS_STREAM: '/tts/stream',
      VOICES: '/voices',
      CLONED_VOICES: '/cloned-voices',
      CLONE_INSTANT: '/cloned-voices/instant',
    },
  },

  // Request limits
  LIMITS: {
    TEXT: {
      MAX_LENGTH: 10000,
      MIN_LENGTH: 1,
    },
    CLONING: {
      MIN_SAMPLE_DURATION: 30, // seconds
      MAX_SAMPLE_DURATION: 300, // seconds
      MAX_CLONES_PER_ACCOUNT: 10,
    },
    API: {
      REQUESTS_PER_MINUTE: 100,
      CONCURRENT_REQUESTS: 10,
      DEFAULT_TIMEOUT: 60000, // 60 seconds
    },
  },

  // Audio configuration
  AUDIO: {
    DEFAULT_FORMAT: 'mp3' as const,
    DEFAULT_SAMPLE_RATE: 24000 as const,
    DEFAULT_QUALITY: 'medium' as const,
  },

  // Pricing (in cents)
  PRICING: {
    PER_1000_CHARS: 20, // $0.20 per 1000 characters
    VOICE_CLONING: 500, // $5.00 per voice clone
  },

  // Voice settings defaults
  DEFAULTS: {
    SPEED: 1.0,
    TEMPERATURE: 1.0,
  },
} as const;

/**
 * Map PlayHT error codes to user-friendly messages
 */
export const PLAYHT_ERROR_MESSAGES: Record<string, string> = {
  RATE_LIMITED: 'Too many requests. Please wait before trying again.',
  CREDIT_ERROR:
    'Insufficient PlayHT credits. Please add credits to your account.',
  AUTH_ERROR: 'Invalid API key or user ID. Please check your credentials.',
  INVALID_VOICE: 'The specified voice ID is invalid or unavailable.',
  TEXT_TOO_LONG: `Text exceeds maximum length of ${PLAYHT_PROVIDER.LIMITS.TEXT.MAX_LENGTH} characters.`,
  TEXT_TOO_SHORT: 'Text must contain at least one character.',
  CLONE_LIMIT_REACHED: `Maximum of ${PLAYHT_PROVIDER.LIMITS.CLONING.MAX_CLONES_PER_ACCOUNT} cloned voices per account.`,
  SAMPLE_TOO_SHORT: `Audio sample must be at least ${PLAYHT_PROVIDER.LIMITS.CLONING.MIN_SAMPLE_DURATION} seconds.`,
};
