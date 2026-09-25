import 'server-only';

import {
  DEFAULT_VOICE_SETTINGS,
  ELEVENLABS as _ELEVENLABS,
} from '../lib/constants';
import type { VoiceSettings } from '../lib/types';

// Note: These queries use type assertions because the film studio tables
// are not yet in the generated database types.

/**
 * Get the ElevenLabs voice ID for a character asset
 * Reads directly from character_details.elevenlabs_voice_id
 * @returns The ElevenLabs voice ID or null if not configured
 */
export async function getVoiceIdForCharacter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  characterAssetId: string | null,
): Promise<string | null> {
  if (!characterAssetId) return null;

  // Read elevenlabs_voice_id directly from character_details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: characterDetails, error } = await (client as any)
    .from('character_details')
    .select('elevenlabs_voice_id')
    .eq('asset_id', characterAssetId)
    .single();

  if (error || !characterDetails) return null;

  return characterDetails.elevenlabs_voice_id ?? null;
}

/**
 * Get voice settings for a character asset
 * Returns default settings (voice_profiles table is deprecated)
 * @returns Default voice settings
 */
export async function getVoiceSettings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _client: any,
  _characterAssetId: string | null,
): Promise<VoiceSettings> {
  // Voice settings are no longer stored per-character
  // Return defaults - settings can be customized at generation time
  return { ...DEFAULT_VOICE_SETTINGS };
}
