// Asset constants
export const ASSET_TYPES = {
  CHARACTER: 'character',
  LOCATION: 'location',
  PROP: 'prop',
} as const;

export const DEFAULT_ASSET_IMAGE = '/assets/placeholder.png';

export const VOICE_PROVIDERS = {
  ELEVENLABS: 'elevenlabs',
  PLAYHT: 'playht',
} as const;

export const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarityBoost: 0.75,
} as const;
