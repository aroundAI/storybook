'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { DEFAULT_VOICE_SETTINGS } from '../lib/constants';
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

// Note: These actions use type assertions because the film studio tables
// (voice_profiles, character_details, assets) are not yet in the generated
// database types. The database schema will be aligned in a future update.

/**
 * Database response types for type-safe access
 */
interface CharacterDetailsResponse {
  asset_id: string;
  voice_asset_id: string | null;
  gender: string | null;
  age: string | null;
}

interface VoiceProfileDbResponse {
  asset_id: string;
  provider: string;
  provider_voice_id: string;
  settings: Record<string, unknown> | null;
}

interface AssetResponse {
  id: string;
  project_id: string;
  account_id: string;
}

/**
 * List available voices from ElevenLabs with optional filters
 */
export const listVoicesAction = enhanceAction(
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

    // Get API key from environment
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      logger.error(ctx, 'Missing ELEVENLABS_API_KEY');
      throw new Error('Voice service not configured');
    }

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

/**
 * Get voice profile for a character
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

    // Get character details to find voice_asset_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: charDetails, error: charError } = await (client as any)
      .from('character_details')
      .select('asset_id, voice_asset_id')
      .eq('asset_id', data.characterAssetId)
      .single();

    if (charError || !charDetails) {
      logger.info(ctx, 'No character details found');
      return null;
    }

    const details = charDetails as CharacterDetailsResponse;
    if (!details.voice_asset_id) {
      logger.info(ctx, 'Character has no voice assigned');
      return null;
    }

    // Get voice profile
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: voiceProfile, error: profileError } = await (client as any)
      .from('voice_profiles')
      .select('asset_id, provider, provider_voice_id, settings')
      .eq('asset_id', details.voice_asset_id)
      .single();

    if (profileError || !voiceProfile) {
      logger.info(ctx, 'No voice profile found for voice asset');
      return null;
    }

    const profile = voiceProfile as VoiceProfileDbResponse;

    logger.info(ctx, 'Voice profile fetched successfully');

    return {
      assetId: profile.asset_id,
      provider: profile.provider,
      providerVoiceId: profile.provider_voice_id,
      settings: profile.settings
        ? {
            stability: profile.settings.stability as number | undefined,
            similarityBoost: profile.settings.similarityBoost as
              | number
              | undefined,
            style: profile.settings.style as number | undefined,
            speed: profile.settings.speed as number | undefined,
            useSpeakerBoost: profile.settings.useSpeakerBoost as
              | boolean
              | undefined,
          }
        : null,
    };
  },
  {
    schema: GetVoiceProfileSchema,
  },
);

/**
 * Save voice profile to a character
 */
export const saveVoiceProfileAction = enhanceAction(
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

    // Get the character asset to verify access and get project_id/account_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: charAsset, error: assetError } = await (client as any)
      .from('assets')
      .select('id, project_id, account_id')
      .eq('id', data.characterAssetId)
      .eq('type', 'character')
      .single();

    if (assetError || !charAsset) {
      logger.error({ ...ctx, error: assetError }, 'Character asset not found');
      throw new Error('Character not found');
    }

    const asset = charAsset as AssetResponse;

    // Check if character already has a voice asset
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingDetails } = await (client as any)
      .from('character_details')
      .select('voice_asset_id')
      .eq('asset_id', data.characterAssetId)
      .single();

    const existingVoiceAssetId = (existingDetails as CharacterDetailsResponse)
      ?.voice_asset_id;

    let voiceAssetId: string;

    if (existingVoiceAssetId) {
      // Update existing voice profile
      voiceAssetId = existingVoiceAssetId;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (client as any)
        .from('voice_profiles')
        .update({
          provider: data.provider,
          provider_voice_id: data.providerVoiceId,
          settings: data.settings ?? DEFAULT_VOICE_SETTINGS,
          updated_at: new Date().toISOString(),
        })
        .eq('asset_id', voiceAssetId);

      if (updateError) {
        logger.error(
          { ...ctx, error: updateError },
          'Failed to update voice profile',
        );
        throw new Error('Failed to update voice profile');
      }
    } else {
      // Create new voice asset
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newAsset, error: createAssetError } = await (client as any)
        .from('assets')
        .insert({
          project_id: asset.project_id,
          account_id: asset.account_id,
          type: 'voice',
          name: `Voice for character`,
        })
        .select('id')
        .single();

      if (createAssetError || !newAsset) {
        logger.error(
          { ...ctx, error: createAssetError },
          'Failed to create voice asset',
        );
        throw new Error('Failed to create voice asset');
      }

      voiceAssetId = (newAsset as { id: string }).id;

      // Create voice profile
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: profileError } = await (client as any)
        .from('voice_profiles')
        .insert({
          asset_id: voiceAssetId,
          provider: data.provider,
          provider_voice_id: data.providerVoiceId,
          settings: data.settings ?? DEFAULT_VOICE_SETTINGS,
        });

      if (profileError) {
        logger.error(
          { ...ctx, error: profileError },
          'Failed to create voice profile',
        );
        throw new Error('Failed to create voice profile');
      }

      // Update character_details with voice_asset_id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: linkError } = await (client as any)
        .from('character_details')
        .update({ voice_asset_id: voiceAssetId })
        .eq('asset_id', data.characterAssetId);

      if (linkError) {
        logger.error(
          { ...ctx, error: linkError },
          'Failed to link voice to character',
        );
        throw new Error('Failed to link voice to character');
      }
    }

    logger.info({ ...ctx, voiceAssetId }, 'Voice profile saved successfully');

    revalidatePath('/home/[account]/studio/[projectId]', 'page');

    return {
      success: true,
      voiceAssetId,
    };
  },
  {
    schema: SaveVoiceProfileSchema,
  },
);

/**
 * Delete voice profile from a character
 */
export const deleteVoiceProfileAction = enhanceAction(
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

    // Get character details to find voice_asset_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: charDetails, error: charError } = await (client as any)
      .from('character_details')
      .select('voice_asset_id')
      .eq('asset_id', data.characterAssetId)
      .single();

    if (charError || !charDetails) {
      logger.warn(ctx, 'Character details not found');
      throw new Error('Character not found');
    }

    const details = charDetails as CharacterDetailsResponse;
    if (!details.voice_asset_id) {
      logger.info(ctx, 'Character has no voice to delete');
      return { success: true };
    }

    // Clear voice_asset_id from character_details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: unlinkError } = await (client as any)
      .from('character_details')
      .update({ voice_asset_id: null })
      .eq('asset_id', data.characterAssetId);

    if (unlinkError) {
      logger.error(
        { ...ctx, error: unlinkError },
        'Failed to unlink voice from character',
      );
      throw new Error('Failed to remove voice assignment');
    }

    // Optionally delete the voice profile and asset
    // For now, we just unlink - voice assets may be shared
    logger.info(ctx, 'Voice profile deleted successfully');

    revalidatePath('/home/[account]/studio/[projectId]', 'page');

    return { success: true };
  },
  {
    schema: DeleteVoiceProfileSchema,
  },
);

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

    const results: BulkAssignVoiceResponse['results'] = [];
    let assignedCount = 0;
    let failedCount = 0;

    // Process each character
    for (const characterAssetId of data.characterAssetIds) {
      try {
        await saveVoiceProfileAction({
          characterAssetId,
          providerVoiceId: data.providerVoiceId,
          provider: data.provider,
          settings: data.settings,
        });

        results.push({
          characterAssetId,
          success: true,
        });
        assignedCount++;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        results.push({
          characterAssetId,
          success: false,
          error: errorMessage,
        });
        failedCount++;
        logger.warn(
          { ...ctx, characterAssetId, error: errorMessage },
          'Failed to assign voice to character',
        );
      }
    }

    logger.info(
      { ...ctx, assignedCount, failedCount },
      'Bulk voice assignment completed',
    );

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
export const autoAssignVoicesAction = enhanceAction(
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

    // Fetch all available voices
    const voicesResult = await listVoicesAction({});

    if (!voicesResult.voices.length) {
      throw new Error('No voices available for auto-assignment');
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

    const charDetailsMap = new Map<string, CharacterDetailsResponse>();
    for (const detail of (charDetailsList as CharacterDetailsResponse[]) ||
      []) {
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
        try {
          await saveVoiceProfileAction({
            characterAssetId,
            providerVoiceId: matchedVoice.id,
            provider: 'elevenlabs',
            settings: DEFAULT_VOICE_SETTINGS,
          });

          results.push({
            characterAssetId,
            assignedVoiceId: matchedVoice.id,
            assignedVoiceName: matchedVoice.name,
            reason,
          });
          assignedCount++;
        } catch (error) {
          results.push({
            characterAssetId,
            assignedVoiceId: null,
            assignedVoiceName: null,
            reason: `Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
        }
      } else {
        results.push({
          characterAssetId,
          assignedVoiceId: null,
          assignedVoiceName: null,
          reason: 'No voices available',
        });
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
