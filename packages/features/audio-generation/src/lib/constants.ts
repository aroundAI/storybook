/**
 * Audio generation constants
 */

// Voice provider names
export const VOICE_PROVIDERS = {
  ELEVENLABS: 'elevenlabs',
  PLAYHT: 'playht',
  DEEPGRAM: 'deepgram',
  AZURE: 'azure',
  GOOGLE: 'google',
} as const;

// Music provider names
export const MUSIC_PROVIDERS = {
  SUNO: 'suno',
  UDIO: 'udio',
  MUBERT: 'mubert',
  BEATOVEN: 'beatoven',
} as const;

// Audio types
export const AUDIO_TYPES = {
  VOICE: 'voice',
  MUSIC: 'music',
  SFX: 'sfx',
} as const;

// Audio output formats
export const AUDIO_FORMATS = {
  MP3: 'mp3',
  WAV: 'wav',
  PCM: 'pcm',
  OGG: 'ogg',
} as const;

// Default voice settings
export const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  speed: 1.0,
  useSpeakerBoost: true,
} as const;

// Music genres
export const MUSIC_GENRES = [
  'cinematic',
  'orchestral',
  'electronic',
  'ambient',
  'rock',
  'pop',
  'jazz',
  'classical',
  'hip-hop',
  'metal',
  'country',
  'lofi',
  'corporate',
] as const;

// Music moods
export const MUSIC_MOODS = [
  'epic',
  'dramatic',
  'suspenseful',
  'uplifting',
  'melancholic',
  'energetic',
  'calm',
  'dark',
  'happy',
  'romantic',
  'mysterious',
] as const;

// Limits
export const MAX_TEXT_LENGTH = 5000;
export const MAX_MUSIC_DURATION = 240; // 4 minutes
export const DEFAULT_MUSIC_DURATION = 60; // 1 minute
export const MAX_RETRIES = 5;
export const DEFAULT_TIMEOUT = 30000; // 30 seconds

// ElevenLabs specific constants
export const ELEVENLABS = {
  BASE_URL: 'https://api.elevenlabs.io/v1',
  MAX_TEXT_LENGTH: 5000,
  SUPPORTED_LANGUAGES: [
    'en',
    'es',
    'fr',
    'de',
    'it',
    'pt',
    'pl',
    'hi',
    'ja',
    'ko',
    'zh',
    'nl',
    'tr',
    'sv',
    'id',
    'ms',
    'ru',
    'ar',
    'cs',
    'da',
    'fi',
  ],
  OUTPUT_FORMATS: [
    'mp3_44100_128',
    'mp3_44100_192',
    'pcm_16000',
    'pcm_22050',
    'pcm_24000',
    'pcm_44100',
  ],
  COST_PER_1000_CHARS: 30, // cents ($0.30)
  RATE_LIMITS: {
    REQUESTS_PER_MINUTE: 100,
    CONCURRENT_REQUESTS: 10,
  },
} as const;

// PlayHT specific constants
export const PLAYHT = {
  BASE_URL: 'https://api.play.ht/api/v2',
  MAX_TEXT_LENGTH: 10000,
  SUPPORTED_LANGUAGES: [
    'en-US',
    'en-GB',
    'en-AU',
    'es-ES',
    'es-MX',
    'fr-FR',
    'de-DE',
    'it-IT',
    'pt-BR',
    'pt-PT',
    'ja-JP',
    'ko-KR',
    'zh-CN',
    'zh-TW',
    'hi-IN',
    'ar-SA',
    'nl-NL',
    'pl-PL',
    'ru-RU',
    'tr-TR',
  ],
  OUTPUT_FORMATS: ['mp3', 'wav', 'ogg', 'mulaw'],
  SAMPLE_RATES: [8000, 16000, 24000, 44100, 48000],
  COST_PER_1000_CHARS: 20, // cents ($0.20)
} as const;

// Suno specific constants
export const SUNO = {
  BASE_URL: 'https://api.suno.ai',
  MAX_DURATION: 240, // 4 minutes
  COST_PER_GENERATION: 50, // cents ($0.50)
  SUPPORTED_GENRES: [
    'pop',
    'rock',
    'electronic',
    'cinematic',
    'orchestral',
    'jazz',
    'ambient',
    'hip-hop',
  ],
} as const;

// Udio specific constants
export const UDIO = {
  BASE_URL: 'https://api.udio.com/v1',
  MAX_DURATION: 120, // 2 minutes (shorter than Suno)
  MIN_DURATION: 15,
  SUPPORTED_DURATIONS: [15, 30, 60, 120],
  MAX_PROMPT_LENGTH: 500,
  COST_PER_GENERATION: 40, // cents ($0.40)
  COST_PER_EXTENSION: 20, // cents ($0.20)
  MAX_EXTENSIONS_PER_SONG: 5,
  EXTENSION_DURATION: 30, // seconds per extension
  TYPICAL_PROCESSING_TIME: 60, // seconds
  SUPPORTED_GENRES: [
    'pop',
    'rock',
    'electronic',
    'cinematic',
    'orchestral',
    'jazz',
    'ambient',
    'hip-hop',
    'metal',
    'country',
  ],
  RATE_LIMITS: {
    REQUESTS_PER_MINUTE: 10,
    CONCURRENT_REQUESTS: 3,
    DAILY_LIMIT: 100,
    TIMEOUT: 180000, // 3 minutes
  },
} as const;

// Provider display names
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  elevenlabs: 'ElevenLabs',
  playht: 'PlayHT',
  deepgram: 'Deepgram',
  azure: 'Azure TTS',
  google: 'Google Cloud TTS',
  suno: 'Suno',
  udio: 'Udio',
  mubert: 'Mubert',
  beatoven: 'Beatoven',
} as const;
