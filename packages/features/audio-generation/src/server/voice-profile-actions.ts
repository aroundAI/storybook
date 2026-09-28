'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import {
  requireAffectedRows,
  requireRow,
  returnRefusals,
} from '@kit/next/refusals';
import { authorizeProjectTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  AutoAssignVoicesResponse,
  AutoAssignVoicesSchemaType,
  BulkAssignVoiceResponse,
  BulkAssignVoiceSchemaType,
  DeleteVoiceProfileSchemaType,
  GetVoiceProfileSchemaType,
  ListVoicesResponse,
  ListVoicesSchemaType,
  SaveVoiceProfileResponse,
  SaveVoiceProfileSchemaType,
  VoiceProfileResponse,
} from '../lib/schemas/voice-profile.schema';
import {
  AutoAssignVoicesSchema,
  BulkAssignVoiceSchema,
  DeleteVoiceProfileSchema,
  GetVoiceProfileSchema,
  ListVoicesSchema,
  SaveVoiceProfileSchema,
} from '../lib/schemas/voice-profile.schema';
import { ElevenLabsProvider } from '../providers/elevenlabs';
import { getAccountElevenLabsApiKey } from './project-audio-settings';

/**
 * List available voices from ElevenLabs with optional filters
 */
const listVoices = enhanceAction(
  async (data: ListVoicesSchemaType): Promise<ListVoicesResponse> => {
    const logger = await getLogger();
    const ctx = { name: 'voice-profile.listVoices' };

    logger.info(ctx, 'Listing available voices');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized voice list attempt');
      throw new Error('Authentication required');
    }

    // Get account ID from project - projectId is required for API key lookup
    if (!data.projectId) {
      throw new Error('Project ID is required to list voices');
    }

    // Listing is the first step of assigning a voice, and it reads the
    // account's ElevenLabs key: project writers only (KB-112)
    const target = await authorizeProjectTarget(client, data.projectId);

    if (!target) {
      throw new ActionRefusal('Project not found or access denied');
    }

    const { accountId } = target;

    // Get API key - stored keys only, no fallback
    const apiKey = await getAccountElevenLabsApiKey(accountId);

    // Create provider and fetch voices
    const provider = new ElevenLabsProvider({
      apiKey,
      timeout: 30000,
      maxRetries: 3,
    });

    const result = await provider.getVoices({
      language: data.language,
      gender: data.gender,
      age: data.age,
      accent: data.accent,
    });

    // Apply search filter if provided
    let voices = result.voices;
    if (data.search) {
      const searchLower = data.search.toLowerCase();
      voices = voices.filter(
        (v) =>
          v.name.toLowerCase().includes(searchLower) ||
          v.description?.toLowerCase().includes(searchLower),
      );
    }

    logger.info({ ...ctx, count: voices.length }, 'Voices listed successfully');

    return {
      voices: voices.map((v) => ({
        id: v.id,
        name: v.name,
        provider: v.provider,
        language: v.language,
        gender: v.gender,
        age: v.age,
        accent: v.accent,
        description: v.description,
        previewUrl: v.previewUrl,
        isCloned: v.isCloned,
      })),
      total: voices.length,
    };
  },
  {
    schema: ListVoicesSchema,
  },
);

export const listVoicesAction = returnRefusals(listVoices);

/**
 * Get voice profile for a character
 * Simplified: reads directly from elevenlabs_voice_id column
 */
export const getVoiceProfileAction = enhanceAction(
  async (
    data: GetVoiceProfileSchemaType,
  ): Promise<VoiceProfileResponse | null> => {
    const logger = await getLogger();
    const ctx = {
      name: 'voice-profile.get',
      characterAssetId: data.characterAssetId,
    };

    logger.info(ctx, 'Fetching voice profile for character');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized voice profile fetch attempt');
      throw new Error('Authentication required');
    }

    // Get elevenlabs_voice_id directly from character_details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: charDetails, error: charError } = await (client as any)
      .from('character_details')
      .select('elevenlabs_voice_id')
      .eq('asset_id', data.characterAssetId)
      .single();

    if (charError || !charDetails) {
      logger.info(ctx, 'No character details found');
      return null;
    }

    if (!charDetails.elevenlabs_voice_id) {
      logger.info(ctx, 'Character has no voice assigned');
      return null;
    }

    logger.info(ctx, 'Voice profile fetched successfully');

    return {
      assetId: data.characterAssetId,
      provider: 'elevenlabs',
      providerVoiceId: charDetails.elevenlabs_voice_id,
      settings: null, // Settings are now defaults, not stored per-character
    };
  },
  {
    schema: GetVoiceProfileSchema,
  },
);

/**
 * Save voice profile to a character
 * Simplified: writes directly to elevenlabs_voice_id column
 */
const saveVoiceProfile = enhanceAction(
  async (
    data: SaveVoiceProfileSchemaType,
  ): Promise<SaveVoiceProfileResponse> => {
    const logger = await getLogger();
    const ctx = {
      name: 'voice-profile.save',
      characterAssetId: data.characterAssetId,
      provider: data.provider,
    };

    logger.info(ctx, 'Saving voice profile for character');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized voice profile save attempt');
      throw new Error('Authentication required');
    }

    // Verify the character asset exists
    requireRow(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('assets')
        .select('id, project_id, account_id')
        .eq('id', data.characterAssetId)
        .eq('type', 'character')
        .single(),
      'Character not found',
    );

    // Update character_details with the ElevenLabs voice ID directly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (client as any)
      .from('character_details')
      .update({ elevenlabs_voice_id: data.providerVoiceId })
      .eq('asset_id', data.characterAssetId)
      .select('asset_id');

    if (updateError) {
      logger.error(
        { ...ctx, error: updateError },
        'Failed to update character voice',
      );
      throw new Error('Failed to save voice profile');
    }

    requireAffectedRows(updated, "You can't change this character's voice.");

    logger.info(
      { ...ctx, voiceId: data.providerVoiceId },
      'Voice profile saved successfully',
    );

    revalidatePath('/home/[account]/studio/[projectId]', 'page');

    return {
      success: true,
      voiceAssetId: data.providerVoiceId, // Return the voice ID for compatibility
    };
  },
  {
    schema: SaveVoiceProfileSchema,
  },
);

export const saveVoiceProfileAction = returnRefusals(saveVoiceProfile);

/**
 * Delete voice profile from a character
 * Simplified: clears elevenlabs_voice_id directly
 */
const deleteVoiceProfile = enhanceAction(
  async (data: DeleteVoiceProfileSchemaType): Promise<{ success: boolean }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'voice-profile.delete',
      characterAssetId: data.characterAssetId,
    };

    logger.info(ctx, 'Deleting voice profile for character');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized voice profile delete attempt');
      throw new Error('Authentication required');
    }

    // Clear elevenlabs_voice_id from character_details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (client as any)
      .from('character_details')
      .update({ elevenlabs_voice_id: null })
      .eq('asset_id', data.characterAssetId)
      .select('asset_id');

    if (updateError) {
      logger.error(
        { ...ctx, error: updateError },
        'Failed to remove voice from character',
      );
      throw new Error('Failed to remove voice assignment');
    }

    requireAffectedRows(updated, "You can't change this character's voice.");

    logger.info(ctx, 'Voice profile deleted successfully');

    revalidatePath('/home/[account]/studio/[projectId]', 'page');

    return { success: true };
  },
  {
    schema: DeleteVoiceProfileSchema,
  },
);

export const deleteVoiceProfileAction = returnRefusals(deleteVoiceProfile);

/**
 * Bulk assign same voice to multiple characters
 */
export const bulkAssignVoiceAction = enhanceAction(
  async (data: BulkAssignVoiceSchemaType): Promise<BulkAssignVoiceResponse> => {
    const logger = await getLogger();
    const ctx = {
      name: 'voice-profile.bulkAssign',
      characterCount: data.characterAssetIds.length,
      provider: data.provider,
    };

    logger.info(ctx, 'Bulk assigning voice to characters');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized bulk assign attempt');
      throw new Error('Authentication required');
    }

    // Batch update all characters in a single query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedRows, error: updateError } = await (client as any)
      .from('character_details')
      .update({ elevenlabs_voice_id: data.providerVoiceId })
      .in('asset_id', data.characterAssetIds)
      .select('asset_id');

    // KB-105: RLS leaves out the rows it refused, with no error.
    const updatedIds = new Set(
      ((updatedRows ?? []) as Array<{ asset_id: string }>).map(
        (row) => row.asset_id,
      ),
    );

    const results: BulkAssignVoiceResponse['results'] = [];
    let assignedCount = 0;
    let failedCount = 0;

    if (updateError) {
      logger.error(
        { ...ctx, error: updateError },
        'Batch voice assignment failed',
      );
      for (const characterAssetId of data.characterAssetIds) {
        results.push({
          characterAssetId,
          success: false,
          error: updateError.message,
        });
        failedCount++;
      }
    } else {
      for (const characterAssetId of data.characterAssetIds) {
        if (updatedIds.has(characterAssetId)) {
          results.push({ characterAssetId, success: true });
          assignedCount++;
        } else {
          results.push({
            characterAssetId,
            success: false,
            error: "You can't change this character's voice.",
          });
          failedCount++;
        }
      }
    }

    logger.info(
      { ...ctx, assignedCount, failedCount },
      'Bulk voice assignment completed',
    );

    revalidatePath('/home/[account]/studio/[projectId]', 'page');

    return {
      success: failedCount === 0,
      assignedCount,
      failedCount,
      results,
    };
  },
  {
    schema: BulkAssignVoiceSchema,
  },
);

/**
 * Auto-assign voices based on character gender/age
 */
const autoAssignVoices = enhanceAction(
  async (
    data: AutoAssignVoicesSchemaType,
  ): Promise<AutoAssignVoicesResponse> => {
    const logger = await getLogger();
    const ctx = {
      name: 'voice-profile.autoAssign',
      characterCount: data.characterAssetIds.length,
      projectId: data.projectId,
    };

    logger.info(ctx, 'Auto-assigning voices to characters');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized auto-assign attempt');
      throw new Error('Authentication required');
    }

    // Fetch all available voices (with BYOK support via projectId)
    const voicesResult = await listVoices({ projectId: data.projectId });

    if (!voicesResult.voices.length) {
      throw new ActionRefusal('No voices available for auto-assignment');
    }

    // Get character details for all characters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: charDetailsList, error: charError } = await (client as any)
      .from('character_details')
      .select('asset_id, gender, age')
      .in('asset_id', data.characterAssetIds);

    if (charError) {
      logger.error({ ...ctx, error: charError }, 'Failed to fetch characters');
      throw new Error('Failed to fetch character details');
    }

    const charDetailsMap = new Map<
      string,
      { asset_id: string; gender: string | null; age: string | null }
    >();
    for (const detail of charDetailsList || []) {
      charDetailsMap.set(detail.asset_id, detail);
    }

    const results: AutoAssignVoicesResponse['results'] = [];
    let assignedCount = 0;

    // Group voices by gender for matching
    const maleVoices = voicesResult.voices.filter((v) => v.gender === 'male');
    const femaleVoices = voicesResult.voices.filter(
      (v) => v.gender === 'female',
    );
    const neutralVoices = voicesResult.voices.filter(
      (v) => v.gender === 'neutral' || !v.gender,
    );

    // Track used voice indices to avoid assigning same voice to all
    let maleIndex = 0;
    let femaleIndex = 0;
    let neutralIndex = 0;

    // Build voice assignments map for all characters first
    const voiceMap = new Map<
      string,
      { voiceId: string; voiceName: string; reason: string }
    >();

    for (const characterAssetId of data.characterAssetIds) {
      const charDetails = charDetailsMap.get(characterAssetId);

      let matchedVoice = null;
      let reason = '';

      if (charDetails?.gender) {
        const gender = charDetails.gender.toLowerCase();

        if (gender === 'male' && maleVoices.length > 0) {
          matchedVoice = maleVoices[maleIndex % maleVoices.length];
          maleIndex++;
          reason = `Matched male voice based on character gender`;
        } else if (gender === 'female' && femaleVoices.length > 0) {
          matchedVoice = femaleVoices[femaleIndex % femaleVoices.length];
          femaleIndex++;
          reason = `Matched female voice based on character gender`;
        } else if (neutralVoices.length > 0) {
          matchedVoice = neutralVoices[neutralIndex % neutralVoices.length];
          neutralIndex++;
          reason = `Assigned neutral voice (no matching gender voices)`;
        }
      }

      // Fallback to any available voice
      if (!matchedVoice && voicesResult.voices.length > 0) {
        matchedVoice =
          voicesResult.voices[
            (maleIndex + femaleIndex + neutralIndex) %
              voicesResult.voices.length
          ];
        reason = `Assigned first available voice (no character gender specified)`;
      }

      if (matchedVoice) {
        voiceMap.set(characterAssetId, {
          voiceId: matchedVoice.id,
          voiceName: matchedVoice.name,
          reason,
        });
      } else {
        results.push({
          characterAssetId,
          assignedVoiceId: null,
          assignedVoiceName: null,
          reason: 'No voices available',
        });
      }
    }

    // Batch update all matched characters by voice ID to minimize queries
    const byVoiceId = new Map<string, string[]>();
    for (const [assetId, mapping] of voiceMap) {
      const existing = byVoiceId.get(mapping.voiceId) ?? [];
      existing.push(assetId);
      byVoiceId.set(mapping.voiceId, existing);
    }

    for (const [voiceId, assetIds] of byVoiceId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updatedRows, error: updateError } = await (client as any)
        .from('character_details')
        .update({ elevenlabs_voice_id: voiceId })
        .in('asset_id', assetIds)
        .select('asset_id');

      // KB-105: RLS leaves out the rows it refused, with no error.
      const updatedIds = new Set(
        ((updatedRows ?? []) as Array<{ asset_id: string }>).map(
          (row) => row.asset_id,
        ),
      );

      for (const assetId of assetIds) {
        const mapping = voiceMap.get(assetId)!;
        if (updateError) {
          results.push({
            characterAssetId: assetId,
            assignedVoiceId: null,
            assignedVoiceName: null,
            reason: `Failed to save: ${updateError.message}`,
          });
        } else if (!updatedIds.has(assetId)) {
          results.push({
            characterAssetId: assetId,
            assignedVoiceId: null,
            assignedVoiceName: null,
            reason: "You can't change this character's voice.",
          });
        } else {
          results.push({
            characterAssetId: assetId,
            assignedVoiceId: mapping.voiceId,
            assignedVoiceName: mapping.voiceName,
            reason: mapping.reason,
          });
          assignedCount++;
        }
      }
    }

    logger.info({ ...ctx, assignedCount }, 'Auto-assignment completed');

    revalidatePath('/home/[account]/studio/[projectId]', 'page');

    return {
      success: assignedCount > 0,
      assignedCount,
      results,
    };
  },
  {
    schema: AutoAssignVoicesSchema,
  },
);

export const autoAssignVoicesAction = returnRefusals(autoAssignVoices);
