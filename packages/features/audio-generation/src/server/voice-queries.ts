'use server';

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

/**
 * Check if account has sufficient budget for generation
 * @returns true if generation can proceed, false if over budget
 */
export async function checkAccountBudget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  accountId: string,
  estimatedCostCents: number,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc('check_account_budget', {
    p_account_id: accountId,
    p_estimated_cost_cents: estimatedCostCents,
  });

  if (error) {
    // If the function doesn't exist or there's an error, allow the generation
    // This provides graceful degradation for accounts without budget limits
    console.warn('Budget check failed, allowing generation:', error.message);
    return true;
  }

  return data === true;
}

/**
 * Increment account usage after successful generation
 */
export async function incrementAccountUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  accountId: string,
  amountCents: number,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client as any).rpc('increment_account_usage', {
    p_account_id: accountId,
    p_amount_cents: amountCents,
  });

  if (error) {
    // Log the error but don't fail the generation
    // Cost tracking is important but shouldn't block user operations
    console.error('Failed to increment account usage:', error.message);
  }
}
