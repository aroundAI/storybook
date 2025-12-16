'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { decrypt } from '@kit/shared/crypto';
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

/**
 * Database response types for type-safe access.
 * These types represent the shape of data returned from film studio tables
 * that are not yet in the generated database types.
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

interface ProjectResponse {
  account_id: string;
}

/**
 * Helper to get ElevenLabs API key for an account.
 * Tries BYOK (Bring Your Own Key) first, then falls back to platform key.
 */
async function getElevenLabsApiKey(accountId?: string): Promise<string> {
  const client = getSupabaseServerClient();

  // Try BYOK first if accountId is provided
  if (accountId) {
    const { data: userKey } = await client
      .from('external_api_keys')
      .select('encrypted_key')
      .eq('account_id', accountId)
      .eq('provider', 'elevenlabs')
      .eq('is_active', true)
      .single();

    if (userKey?.encrypted_key) {
      return decrypt(userKey.encrypted_key);
    }
  }

  // Fall back to platform key
  const platformKey = process.env.ELEVENLABS_API_KEY;
  if (!platformKey) {
    throw new Error(
      'No ElevenLabs API key configured. Please add your API key in Settings > API Keys.',
    );
  }
  return platformKey;
}

/**
 * Type-safe query helpers for film studio tables.
 * These wrap Supabase queries with proper typing until the database types are generated.
 *
 * Note: These helpers use type assertions internally because the film studio tables
 * (voice_profiles, character_details, assets) are not yet in the generated database types.
 * This centralizes the type assertions in one place rather than spreading them across actions.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const filmStudioQueries = {
  async getCharacterDetails(
    client: any,
    assetId: string,
    _select: string = 'asset_id, voice_asset_id',
  ): Promise<{
    data: CharacterDetailsResponse | null;
    error: { code: string; message: string } | null;
  }> {
    return client
      .from('character_details')
      .select('asset_id, voice_asset_id')
      .eq('asset_id', assetId)
      .single();
  },

  async getCharacterDetailsList(
    client: any,
    assetIds: string[],
    _select: string = 'asset_id, gender, age',
  ): Promise<{
    data: CharacterDetailsResponse[] | null;
    error: { code: string; message: string } | null;
  }> {
    return client
      .from('character_details')
      .select('asset_id, gender, age')
      .in('asset_id', assetIds);
  },

  async updateCharacterDetails(
    client: any,
    assetId: string,
    data: Partial<{ voice_asset_id: string | null }>,
  ): Promise<{
    data: null;
    error: { code: string; message: string } | null;
  }> {
    return client
      .from('character_details')
      .update(data)
      .eq('asset_id', assetId);
  },

  async getVoiceProfile(
    client: any,
    assetId: string,
  ): Promise<{
    data: VoiceProfileDbResponse | null;
    error: { code: string; message: string } | null;
  }> {
    return client
      .from('voice_profiles')
      .select('asset_id, provider, provider_voice_id, settings')
      .eq('asset_id', assetId)
      .single();
  },

  async updateVoiceProfile(
    client: any,
    assetId: string,
    data: {
      provider?: string;
      provider_voice_id?: string;
      settings?: Record<string, unknown>;
      updated_at?: string;
    },
  ): Promise<{
    data: null;
    error: { code: string; message: string } | null;
  }> {
    return client.from('voice_profiles').update(data).eq('asset_id', assetId);
  },

  async insertVoiceProfile(
    client: any,
    data: {
      asset_id: string;
      provider: string;
      provider_voice_id: string;
      settings: Record<string, unknown>;
    },
  ): Promise<{
    data: null;
    error: { code: string; message: string } | null;
  }> {
    return client.from('voice_profiles').insert(data);
  },

  async getAsset(
    client: any,
    assetId: string,
    type?: string,
  ): Promise<{
    data: AssetResponse | null;
    error: { code: string; message: string } | null;
  }> {
    let query = client
      .from('assets')
      .select('id, project_id, account_id')
      .eq('id', assetId);

    if (type) {
      query = query.eq('type', type);
    }

    return query.single();
  },

  async insertAsset(
    client: any,
    data: {
      project_id: string;
      account_id: string;
      type: string;
      name: string;
    },
  ): Promise<{
    data: { id: string } | null;
    error: { code: string; message: string } | null;
  }> {
    return client.from('assets').insert(data).select('id').single();
  },

  async getProject(
    client: any,
    projectId: string,
  ): Promise<{
    data: ProjectResponse | null;
    error: { code: string; message: string } | null;
  }> {
    return client
      .from('projects')
      .select('account_id')
      .eq('id', projectId)
      .single();
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

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

    // Get account ID from project if provided (for BYOK support)
    let accountId: string | undefined;
    if (data.projectId) {
      const { data: project } = await filmStudioQueries.getProject(
        client,
        data.projectId,
      );
      accountId = project?.account_id;
    }

    // Get API key with BYOK support
    const apiKey = await getElevenLabsApiKey(accountId);

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
    const { data: charDetails, error: charError } =
      await filmStudioQueries.getCharacterDetails(
        client,
        data.characterAssetId,
      );

    if (charError || !charDetails) {
      logger.info(ctx, 'No character details found');
      return null;
    }

    if (!charDetails.voice_asset_id) {
      logger.info(ctx, 'Character has no voice assigned');
      return null;
    }

    // Get voice profile
    const { data: voiceProfile, error: profileError } =
      await filmStudioQueries.getVoiceProfile(
        client,
        charDetails.voice_asset_id,
      );

    if (profileError || !voiceProfile) {
      logger.info(ctx, 'No voice profile found for voice asset');
      return null;
    }

    logger.info(ctx, 'Voice profile fetched successfully');

    return {
      assetId: voiceProfile.asset_id,
      provider: voiceProfile.provider,
      providerVoiceId: voiceProfile.provider_voice_id,
      settings: voiceProfile.settings
        ? {
            stability: voiceProfile.settings.stability as number | undefined,
            similarityBoost: voiceProfile.settings.similarityBoost as
              | number
              | undefined,
            style: voiceProfile.settings.style as number | undefined,
            speed: voiceProfile.settings.speed as number | undefined,
            useSpeakerBoost: voiceProfile.settings.useSpeakerBoost as
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
    const { data: charAsset, error: assetError } =
      await filmStudioQueries.getAsset(
        client,
        data.characterAssetId,
        'character',
      );

    if (assetError || !charAsset) {
      logger.error({ ...ctx, error: assetError }, 'Character asset not found');
      throw new Error('Character not found');
    }

    // Check if character already has a voice asset
    const { data: existingDetails } =
      await filmStudioQueries.getCharacterDetails(
        client,
        data.characterAssetId,
      );

    const existingVoiceAssetId = existingDetails?.voice_asset_id;

    let voiceAssetId: string;

    if (existingVoiceAssetId) {
      // Update existing voice profile
      voiceAssetId = existingVoiceAssetId;

      const { error: updateError } = await filmStudioQueries.updateVoiceProfile(
        client,
        voiceAssetId,
        {
          provider: data.provider,
          provider_voice_id: data.providerVoiceId,
          settings: data.settings ?? DEFAULT_VOICE_SETTINGS,
          updated_at: new Date().toISOString(),
        },
      );

      if (updateError) {
        logger.error(
          { ...ctx, error: updateError },
          'Failed to update voice profile',
        );
        throw new Error('Failed to update voice profile');
      }
    } else {
      // Create new voice asset
      const { data: newAsset, error: createAssetError } =
        await filmStudioQueries.insertAsset(client, {
          project_id: charAsset.project_id,
          account_id: charAsset.account_id,
          type: 'voice',
          name: 'Voice for character',
        });

      if (createAssetError || !newAsset) {
        logger.error(
          { ...ctx, error: createAssetError },
          'Failed to create voice asset',
        );
        throw new Error('Failed to create voice asset');
      }

      voiceAssetId = newAsset.id;

      // Create voice profile
      const { error: profileError } =
        await filmStudioQueries.insertVoiceProfile(client, {
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
      const { error: linkError } =
        await filmStudioQueries.updateCharacterDetails(
          client,
          data.characterAssetId,
          { voice_asset_id: voiceAssetId },
        );

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
    const { data: charDetails, error: charError } =
      await filmStudioQueries.getCharacterDetails(
        client,
        data.characterAssetId,
      );

    if (charError || !charDetails) {
      logger.warn(ctx, 'Character details not found');
      throw new Error('Character not found');
    }

    if (!charDetails.voice_asset_id) {
      logger.info(ctx, 'Character has no voice to delete');
      return { success: true };
    }

    // Clear voice_asset_id from character_details
    const { error: unlinkError } =
      await filmStudioQueries.updateCharacterDetails(
        client,
        data.characterAssetId,
        { voice_asset_id: null },
      );

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

    // Fetch all available voices (with BYOK support via projectId)
    const voicesResult = await listVoicesAction({ projectId: data.projectId });

    if (!voicesResult.voices.length) {
      throw new Error('No voices available for auto-assignment');
    }

    // Get character details for all characters
    const { data: charDetailsList, error: charError } =
      await filmStudioQueries.getCharacterDetailsList(
        client,
        data.characterAssetIds,
      );

    if (charError) {
      logger.error({ ...ctx, error: charError }, 'Failed to fetch characters');
      throw new Error('Failed to fetch character details');
    }

    const charDetailsMap = new Map<string, CharacterDetailsResponse>();
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
