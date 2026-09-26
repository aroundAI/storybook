/**
 * @kit/audio-generation
 *
 * Audio generation package for voice synthesis and music generation.
 * Provides abstraction layer for ElevenLabs, PlayHT and other providers.
 *
 * Prefer granular subpath imports for better tree-shaking:
 *
 * @example
 * // Import providers
 * import { ElevenLabsProvider } from '@kit/audio-generation/providers';
 *
 * // Import types and schemas
 * import type { Voice, VoiceGenerationRequest } from '@kit/audio-generation/types';
 * import { VoiceGenerationRequestSchema } from '@kit/audio-generation/schemas';
 *
 * // Import server actions
 * import { generateVoiceFromTextAction } from '@kit/audio-generation/server';
 *
 * // Import components
 * import { AudioPlayer } from '@kit/audio-generation/components';
 *
 * // Import hooks
 * import { useAudioPlayer } from '@kit/audio-generation/hooks';
 */

// Re-export only types from this barrel to avoid pulling in server/client code together.
// Use granular subpath imports (e.g. '@kit/audio-generation/server') for implementations.
export type * from './lib/types';
export type * from './lib/types/dialogue.types';
