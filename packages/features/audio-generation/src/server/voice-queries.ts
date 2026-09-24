import 'server-only';

import type { LlmJobTarget } from '@kit/prompt-engine/llm-job-target';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

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
 * Add a completed generation's cost to its account's monthly usage (KB-83).
 *
 * `increment_account_usage` is the service role's alone, so this uses the
 * server's client. It is called with the caller's own client no longer: that
 * was refused (42501) on every call, and the spend never counted. Taking an
 * `LlmJobTarget` means only an account the action has authorised can be
 * charged, never one a request names. A failure is logged and does not fail
 * the generation it follows.
 */
export async function recordVoiceSpend(
  target: LlmJobTarget,
  amountCents: number,
): Promise<void> {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return;
  }

  const { error } = await getSupabaseServerAdminClient().rpc(
    'increment_account_usage',
    {
      p_account_id: target.accountId,
      p_amount_cents: Math.ceil(amountCents),
    },
  );

  if (error) {
    console.error('Failed to record voice spend:', error.message);
  }
}
