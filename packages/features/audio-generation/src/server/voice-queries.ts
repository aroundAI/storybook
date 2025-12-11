'use server';

import 'server-only';

import { DEFAULT_VOICE_SETTINGS, ELEVENLABS } from '../lib/constants';
import type { VoiceSettings } from '../lib/types';

// Note: These queries use type assertions because the film studio tables
// (character_details, voice_profiles) are not yet in the generated database types.
// The database schema will be aligned in a future update.
// See: packages/features/audio-generation/src/server/actions.ts for similar pattern.

/**
 * Film studio database response types for type-safe access
 */
interface CharacterDetailsResponse {
  voice_asset_id: string | null;
}

interface VoiceProfileResponse {
  provider_voice_id: string | null;
}

interface VoiceProfileSettingsResponse {
  settings: Partial<VoiceSettings> | null;
}

/**
 * Get the ElevenLabs voice ID for a character asset
 * @returns The provider voice ID or null if not found
 */
export async function getVoiceIdForCharacter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  characterAssetId: string | null,
): Promise<string | null> {
  if (!characterAssetId) return null;

  // First check if the character has a voice_asset_id in character_details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: characterDetails, error: charError } = await (client as any)
    .from('character_details')
    .select('voice_asset_id')
    .eq('asset_id', characterAssetId)
    .single();

  if (charError || !characterDetails) return null;

  // Type-safe access to response data
  const details = characterDetails as CharacterDetailsResponse;
  const voiceAssetId = details.voice_asset_id;
  if (!voiceAssetId) return null;

  // Then get the voice profile for that voice asset
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: voiceProfile, error: profileError } = await (client as any)
    .from('voice_profiles')
    .select('provider_voice_id')
    .eq('asset_id', voiceAssetId)
    .eq('provider', 'elevenlabs')
    .single();

  if (profileError || !voiceProfile) return null;

  // Type-safe access to response data
  const profile = voiceProfile as VoiceProfileResponse;
  return profile.provider_voice_id ?? null;
}

/**
 * Get voice settings for a character asset
 * @returns Voice settings from profile or defaults
 */
export async function getVoiceSettings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  characterAssetId: string | null,
): Promise<VoiceSettings> {
  if (!characterAssetId) {
    return { ...DEFAULT_VOICE_SETTINGS };
  }

  // Get the voice asset ID from character_details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: characterDetails, error: charError } = await (client as any)
    .from('character_details')
    .select('voice_asset_id')
    .eq('asset_id', characterAssetId)
    .single();

  if (charError || !characterDetails) {
    return { ...DEFAULT_VOICE_SETTINGS };
  }

  // Type-safe access to response data
  const details = characterDetails as CharacterDetailsResponse;
  const voiceAssetId = details.voice_asset_id;
  if (!voiceAssetId) {
    return { ...DEFAULT_VOICE_SETTINGS };
  }

  // Get voice profile settings
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: voiceProfile, error: profileError } = await (client as any)
    .from('voice_profiles')
    .select('settings')
    .eq('asset_id', voiceAssetId)
    .eq('provider', 'elevenlabs')
    .single();

  if (profileError || !voiceProfile) {
    return { ...DEFAULT_VOICE_SETTINGS };
  }

  // Type-safe access to response data
  const profile = voiceProfile as VoiceProfileSettingsResponse;
  const settings = profile.settings;

  if (!settings) {
    return { ...DEFAULT_VOICE_SETTINGS };
  }

  return {
    stability: settings.stability ?? DEFAULT_VOICE_SETTINGS.stability,
    similarityBoost:
      settings.similarityBoost ?? DEFAULT_VOICE_SETTINGS.similarityBoost,
    style: settings.style ?? DEFAULT_VOICE_SETTINGS.style,
    speed: settings.speed ?? DEFAULT_VOICE_SETTINGS.speed,
    useSpeakerBoost:
      settings.useSpeakerBoost ?? DEFAULT_VOICE_SETTINGS.useSpeakerBoost,
  };
}

/**
 * Estimate voice generation cost in cents
 * Based on ElevenLabs pricing: $0.30 per 1000 characters
 */
export function estimateVoiceCost(textLength: number): number {
  return Math.ceil((textLength / 1000) * ELEVENLABS.COST_PER_1000_CHARS);
}
