'use server';

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { DUBBING_COSTS } from '../lib/dubbing-languages';
import type {
  DubbedDialogueLineResponse,
  DubbedVersionResponse,
} from '../lib/schemas/dubbing.schema';

/**
 * Get a dubbed version by ID with episode/project context
 */
export async function getDubbedVersionWithContext(
  client: SupabaseClient,
  versionId: string,
): Promise<DubbedVersionResponse | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('dubbed_versions')
    .select(
      `
      *,
      episodes!inner(
        id,
        project_id,
        projects!inner(
          id,
          account_id
        )
      )
    `,
    )
    .eq('id', versionId)
    .single();

  if (error || !data) return null;
  return data as DubbedVersionResponse;
}

/**
 * Get all dubbed lines for a version with original dialogue info
 */
export async function getDubbedLinesWithOriginal(
  client: SupabaseClient,
  versionId: string,
): Promise<DubbedDialogueLineResponse[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('dubbed_dialogue_lines')
    .select(
      `
      *,
      dialogue_lines!inner(
        id,
        text,
        sequence_number,
        character_asset_id,
        assets(
          id,
          name
        )
      )
    `,
    )
    .eq('dubbed_version_id', versionId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return (data ?? []) as DubbedDialogueLineResponse[];
}

/**
 * Get voice profile for a character (via character_details -> voice asset)
 */
export async function getCharacterVoiceProfile(
  client: SupabaseClient,
  characterAssetId: string | null,
): Promise<{
  voiceId: string;
  settings: Record<string, unknown>;
} | null> {
  if (!characterAssetId) return null;

  // Get voice_asset_id from character_details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: charDetails } = await (client as any)
    .from('character_details')
    .select('voice_asset_id')
    .eq('asset_id', characterAssetId)
    .single();

  if (!charDetails?.voice_asset_id) return null;

  // Get voice profile
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: voiceProfile } = await (client as any)
    .from('voice_profiles')
    .select('provider_voice_id, settings')
    .eq('asset_id', charDetails.voice_asset_id)
    .single();

  if (!voiceProfile?.provider_voice_id) return null;

  return {
    voiceId: voiceProfile.provider_voice_id,
    settings: (voiceProfile.settings as Record<string, unknown>) ?? {},
  };
}

/**
 * Get all dubbed versions for an episode
 */
export async function getDubbedVersionsForEpisode(
  client: SupabaseClient,
  episodeId: string,
): Promise<DubbedVersionResponse[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('dubbed_versions')
    .select('*')
    .eq('episode_id', episodeId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return (data ?? []) as DubbedVersionResponse[];
}

/**
 * Estimate translation cost based on character count
 * Based on Claude 3.5 Sonnet pricing: ~$0.02 per 1K chars
 */
export function estimateTranslationCost(totalCharacters: number): number {
  return Math.ceil(
    (totalCharacters / 1000) * DUBBING_COSTS.TRANSLATION_PER_1000_CHARS,
  );
}

/**
 * Estimate voice generation cost based on character count
 * Based on ElevenLabs pricing: $0.30 per 1K chars
 */
export function estimateVoiceGenerationCost(totalCharacters: number): number {
  return Math.ceil(
    (totalCharacters / 1000) * DUBBING_COSTS.VOICE_PER_1000_CHARS,
  );
}

/**
 * Calculate total characters from dubbed lines
 */
export function calculateTotalCharacters(
  lines: Array<{ translated_text: string }>,
): number {
  return lines.reduce((sum, line) => sum + line.translated_text.length, 0);
}

/**
 * Calculate progress for a dubbed version
 */
export async function calculateDubbingProgress(
  client: SupabaseClient,
  versionId: string,
): Promise<{
  total: number;
  translated: number;
  voiced: number;
  failed: number;
  percentage: number;
}> {
  const lines = await getDubbedLinesWithOriginal(client, versionId);

  const total = lines.length;
  const translated = lines.filter(
    (l) => l.status === 'translated' || l.status === 'voiced',
  ).length;
  const voiced = lines.filter((l) => l.status === 'voiced').length;
  const failed = lines.filter((l) => l.status === 'failed').length;

  const percentage =
    total > 0 ? Math.round(((translated + voiced) / (total * 2)) * 100) : 0;

  return { total, translated, voiced, failed, percentage };
}
