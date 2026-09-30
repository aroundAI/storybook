'use server';

/**
 * Character Server Actions (FILM-202)
 *
 * Server actions for creating, updating, and deleting characters with atomic operations.
 * Characters require both an asset record and a character_details record.
 */
import { revalidatePath } from 'next/cache';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { requireAffectedRows, returnRefusals } from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { invalidatePromptCache } from '../element-prompt/cache';
import {
  CreateCharacterSchema,
  DeleteCharacterSchema,
  GetCharacterSchema,
  ListCharactersSchema,
  UpdateCharacterSchema,
} from '../schemas/character.schema';
import type { CharacterRow, CharacterWithDetails } from '../types';
import { mapRowToCharacterWithDetails } from '../types';
import { isAssetInUse } from './asset.queries';

/**
 * Create a new character: an asset plus its details, made by one call to
 * `create_character_with_details`, which does both inserts in one transaction.
 */
const createCharacter = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'character.create', projectId: data.projectId };

    logger.info(ctx, 'Creating character');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // One call, one transaction: the function inserts the asset and its
    // details and undoes both if the second fails. Deleting the asset here
    // afterwards could not: assets_delete admits only project owners and
    // admins, so a member's failed create left the asset behind (FILM-202).
    const physicalAttributesJson = {
      physicalAttributes: data.physicalAttributes ?? null,
      personalityTraits: data.personalityTraits ?? null,
      clothingStyle: data.clothingStyle ?? null,
      backstory: data.backstory ?? null,
    };

    const { data: assetId, error: createError } = await client.rpc(
      'create_character_with_details',
      {
        p_project_id: data.projectId,
        p_name: data.name,
        p_description: data.description ?? undefined,
        p_physical_attributes: physicalAttributesJson as Json,
        p_personality: data.personality ?? undefined,
        p_element_prompt: data.elementPrompt ?? undefined,
        p_reference_images: data.referenceImages ?? undefined,
        p_elevenlabs_voice_id: data.voiceAssetId ?? undefined,
        p_file_url: data.fileUrl || undefined,
        p_thumbnail_url: data.thumbnailUrl || undefined,
      },
    );

    if (createError || !assetId) {
      if (createError?.message.includes('duplicate key value')) {
        throw new ActionRefusal(
          `A character named "${data.name}" already exists in this project. Choose a different name.`,
        );
      }

      logger.error(
        { ...ctx, error: createError },
        'Failed to create character',
      );
      throw new Error(
        `Failed to create character: ${createError?.message ?? 'no id returned'}`,
      );
    }

    const asset = { id: assetId };

    // Fetch the complete character with joined details
    const { data: character, error: fetchError } = await client
      .from('assets')
      .select(
        `
        *,
        character_details!asset_id (
          physical_attributes,
          personality,
          element_prompt,
          reference_images,
          elevenlabs_voice_id
        )
      `,
      )
      .eq('id', asset.id)
      .single();

    if (fetchError) {
      logger.error(
        { ...ctx, error: fetchError },
        'Failed to fetch created character',
      );
      throw new Error(
        `Failed to fetch created character: ${fetchError.message}`,
      );
    }

    logger.info(
      { ...ctx, assetId: asset.id },
      'Character created successfully',
    );

    // Revalidate asset pages
    revalidatePath('/home/[account]/projects/[id]', 'page');
    revalidatePath('/home/(user)/projects/[id]', 'page');

    return {
      success: true,
      data: mapRowToCharacterWithDetails(character as CharacterRow),
    };
  },
  {
    schema: CreateCharacterSchema,
  },
);

export const createCharacterAction = returnRefusals(createCharacter);

/**
 * Get a single character with full details
 */
export const getCharacterAction = enhanceAction(
  async (
    data,
  ): Promise<{ success: boolean; data: CharacterWithDetails | null }> => {
    const logger = await getLogger();
    const ctx = { name: 'character.get', assetId: data.assetId };

    logger.info(ctx, 'Fetching character');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const { data: character, error } = await client
      .from('assets')
      .select(
        `
        *,
        character_details!asset_id (
          physical_attributes,
          personality,
          element_prompt,
          reference_images,
          elevenlabs_voice_id
        )
      `,
      )
      .eq('id', data.assetId)
      .eq('type', 'character')
      .is('deleted_at', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        logger.info(ctx, 'Character not found');
        return { success: true, data: null };
      }
      logger.error({ ...ctx, error }, 'Failed to fetch character');
      throw new Error(`Failed to fetch character: ${error.message}`);
    }

    logger.info(ctx, 'Character fetched successfully');

    const mappedCharacter = mapRowToCharacterWithDetails(
      character as CharacterRow,
    );
    logger.info(
      { ...ctx, voiceAssetId: mappedCharacter.voiceAssetId },
      'Character mapped with voiceAssetId',
    );

    return {
      success: true,
      data: mappedCharacter,
    };
  },
  {
    schema: GetCharacterSchema,
  },
);

/**
 * Update an existing character (both assets and character_details)
 */
const updateCharacter = enhanceAction(
  async (data): Promise<{ success: boolean; data: CharacterWithDetails }> => {
    const logger = await getLogger();
    const ctx = { name: 'character.update', assetId: data.assetId };

    logger.info(ctx, 'Updating character');

    // Debug: log incoming voiceAssetId
    logger.info(
      { ...ctx, voiceAssetIdFromInput: data.voiceAssetId },
      'Incoming voiceAssetId value',
    );

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const assetPatch: Record<string, Json> = {};

    if (data.name !== undefined) assetPatch.name = data.name;
    if (data.description !== undefined)
      assetPatch.description = data.description;
    if (data.fileUrl !== undefined) assetPatch.file_url = data.fileUrl || null;
    if (data.thumbnailUrl !== undefined)
      assetPatch.thumbnail_url = data.thumbnailUrl || null;

    const attributesPatch: Record<string, Json> = {};

    if (data.physicalAttributes !== undefined)
      attributesPatch.physicalAttributes = data.physicalAttributes;
    if (data.personalityTraits !== undefined)
      attributesPatch.personalityTraits = data.personalityTraits;
    if (data.clothingStyle !== undefined)
      attributesPatch.clothingStyle = data.clothingStyle;
    if (data.backstory !== undefined)
      attributesPatch.backstory = data.backstory;

    const detailsPatch: Record<string, Json> = {};

    if (data.personality !== undefined)
      detailsPatch.personality = data.personality;
    if (data.elementPrompt !== undefined)
      detailsPatch.element_prompt = data.elementPrompt;
    if (data.referenceImages !== undefined)
      detailsPatch.reference_images = data.referenceImages;
    if (data.voiceAssetId !== undefined)
      detailsPatch.elevenlabs_voice_id = data.voiceAssetId;

    // One call, one transaction: a failed details write no longer leaves the
    // asset change applied (FILM-202).
    const { error: updateError } = await client.rpc(
      'update_character_with_details',
      {
        p_asset_id: data.assetId,
        p_asset_patch: assetPatch,
        p_details_patch: detailsPatch,
        p_attributes_patch: attributesPatch,
      },
    );

    if (updateError) {
      if (updateError.code === '42501') {
        throw new ActionRefusal("You can't change this character.");
      }

      if (updateError.code === '23505' && data.name !== undefined) {
        throw new ActionRefusal(
          `A character named "${data.name}" already exists in this project. Choose a different name.`,
        );
      }

      logger.error(
        { ...ctx, error: updateError },
        'Failed to update character',
      );
      throw new Error(`Failed to update character: ${updateError.message}`);
    }

    // Fetch updated character
    const { data: character, error: fetchError } = await client
      .from('assets')
      .select(
        `
        *,
        character_details!asset_id (
          physical_attributes,
          personality,
          element_prompt,
          reference_images,
          elevenlabs_voice_id
        )
      `,
      )
      .eq('id', data.assetId)
      .single();

    if (fetchError) {
      logger.error(
        { ...ctx, error: fetchError },
        'Failed to fetch updated character',
      );
      throw new Error(
        `Failed to fetch updated character: ${fetchError.message}`,
      );
    }

    logger.info(ctx, 'Character updated successfully');

    // Invalidate element prompt cache since character data changed
    await invalidatePromptCache(data.assetId);

    // Revalidate asset pages
    revalidatePath('/home/[account]/projects/[id]', 'page');
    revalidatePath('/home/(user)/projects/[id]', 'page');

    return {
      success: true,
      data: mapRowToCharacterWithDetails(character as CharacterRow),
    };
  },
  {
    schema: UpdateCharacterSchema,
  },
);

export const updateCharacterAction = returnRefusals(updateCharacter);

/**
 * List characters for a project with pagination
 */
export const listCharactersAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'character.list', projectId: data.projectId };

    logger.info(ctx, 'Listing characters');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    const {
      data: characters,
      error,
      count,
    } = await client
      .from('assets')
      .select(
        `
        *,
        character_details!asset_id (
          role,
          physical_attributes,
          personality,
          element_prompt,
          reference_images,
          elevenlabs_voice_id
        )
      `,
        { count: 'exact' },
      )
      .eq('project_id', data.projectId)
      .eq('type', 'character')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to list characters');
      throw new Error(`Failed to list characters: ${error.message}`);
    }

    const mappedCharacters = (characters as CharacterRow[]).map(
      mapRowToCharacterWithDetails,
    );
    const total = count ?? 0;

    logger.info(
      { ...ctx, count: mappedCharacters.length, total },
      'Characters listed successfully',
    );

    return {
      success: true,
      data: {
        characters: mappedCharacters,
        total,
        hasMore: total > offset + limit,
      },
    };
  },
  {
    schema: ListCharactersSchema,
  },
);

/**
 * Delete a character (soft delete via assets.deleted_at)
 * character_details will cascade due to FK constraint
 */
const deleteCharacter = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'character.delete', assetId: data.assetId };

    logger.info(ctx, 'Deleting character');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Check if character is in use
    const inUse = await isAssetInUse(data.assetId);

    if (inUse) {
      logger.warn(ctx, 'Cannot delete character that is in use');
      throw new ActionRefusal(
        'This character is used by dialogue in an episode, so it cannot be deleted.',
      );
    }

    // Soft delete by setting deleted_at
    const { data: deleted, error } = await client
      .from('assets')
      .update({ deleted_at: new Date().toISOString() } as Record<
        string,
        unknown
      >)
      .eq('id', data.assetId)
      .eq('type', 'character')
      .is('deleted_at', null)
      .select('id');

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete character');
      throw new Error(`Failed to delete character: ${error.message}`);
    }

    // RLS filters a refused update to no rows, without an error (KB-61)
    requireAffectedRows(
      deleted,
      "The character wasn't deleted: it's already gone, or you can't delete it. Reload the page.",
    );

    logger.info(ctx, 'Character deleted successfully');

    // Revalidate asset pages
    revalidatePath('/home/[account]/projects/[id]', 'page');
    revalidatePath('/home/(user)/projects/[id]', 'page');

    return { success: true, assetId: data.assetId };
  },
  {
    schema: DeleteCharacterSchema,
  },
);

export const deleteCharacterAction = returnRefusals(deleteCharacter);
