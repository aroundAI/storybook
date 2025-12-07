/**
 * @kit/audio-generation
 *
 * Audio generation package for voice synthesis and music generation.
 * Provides abstraction layer for ElevenLabs, PlayHT, Suno, and other providers.
 *
 * @example
 * // Import providers
 * import { ElevenLabsProvider, SunoProvider } from '@kit/audio-generation/providers';
 *
 * // Import types and schemas
 * import type { Voice, VoiceGenerationRequest } from '@kit/audio-generation/types';
 * import { VoiceGenerationRequestSchema } from '@kit/audio-generation/schemas';
 *
 * // Import server functions
 * import { getAvailableVoices } from '@kit/audio-generation/server';
 */

export * from './components';
export * from './server';
export * from './providers';
export * from './lib';
export * from './hooks';
