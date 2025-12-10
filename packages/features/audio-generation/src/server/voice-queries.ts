'use server';

import 'server-only';

import { DEFAULT_VOICE_SETTINGS, ELEVENLABS } from '../lib/constants';
import type { VoiceSettings } from '../lib/types';

// Use generic type for Supabase client to avoid dependency issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

/**
 * Get the ElevenLabs voice ID for a character asset
 * @returns The provider voice ID or null if not found
 */
export async function getVoiceIdForCharacter(
  client: SupabaseClient,
  characterAssetId: string | null,
): Promise<string | null> {
  if (!characterAssetId) return null;

  // First check if the character has a voice_asset_id in character_details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: characterDetails } = await (client as any)
    .from('character_details')
    .select('voice_asset_id')
    .eq('asset_id', characterAssetId)
    .single();

  const voiceAssetId = characterDetails?.voice_asset_id;
  if (!voiceAssetId) return null;

  // Then get the voice profile for that voice asset
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: voiceProfile } = await (client as any)
    .from('voice_profiles')
    .select('provider_voice_id')
    .eq('asset_id', voiceAssetId)
    .eq('provider', 'elevenlabs')
    .single();

  return voiceProfile?.provider_voice_id ?? null;
}

/**
 * Get voice settings for a character asset
 * @returns Voice settings from profile or defaults
 */
export async function getVoiceSettings(
  client: SupabaseClient,
  characterAssetId: string | null,
): Promise<VoiceSettings> {
  if (!characterAssetId) {
    return { ...DEFAULT_VOICE_SETTINGS };
  }

  // Get the voice asset ID from character_details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: characterDetails } = await (client as any)
    .from('character_details')
    .select('voice_asset_id')
    .eq('asset_id', characterAssetId)
    .single();

  const voiceAssetId = characterDetails?.voice_asset_id;
  if (!voiceAssetId) {
    return { ...DEFAULT_VOICE_SETTINGS };
  }

  // Get voice profile settings
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: voiceProfile } = await (client as any)
    .from('voice_profiles')
    .select('settings')
    .eq('asset_id', voiceAssetId)
    .eq('provider', 'elevenlabs')
    .single();

  if (!voiceProfile?.settings) {
    return { ...DEFAULT_VOICE_SETTINGS };
  }

  return {
    stability:
      voiceProfile.settings.stability ?? DEFAULT_VOICE_SETTINGS.stability,
    similarityBoost:
      voiceProfile.settings.similarityBoost ??
      DEFAULT_VOICE_SETTINGS.similarityBoost,
    style: voiceProfile.settings.style ?? DEFAULT_VOICE_SETTINGS.style,
    speed: voiceProfile.settings.speed ?? DEFAULT_VOICE_SETTINGS.speed,
    useSpeakerBoost:
      voiceProfile.settings.useSpeakerBoost ??
      DEFAULT_VOICE_SETTINGS.useSpeakerBoost,
  };
}

/**
 * Estimate voice generation cost in cents
 * Based on ElevenLabs pricing: $0.30 per 1000 characters
 */
export function estimateVoiceCost(textLength: number): number {
  return Math.ceil((textLength / 1000) * ELEVENLABS.COST_PER_1000_CHARS);
}
