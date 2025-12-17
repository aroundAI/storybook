/**
 * Character Server Actions (FILM-202)
 *
 * Server actions for creating, updating, and deleting characters with atomic operations.
 * Characters require both an asset record and a character_details record.
 */

'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
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
 * Character Server Actions (FILM-202)
 *
 * Server actions for creating, updating, and deleting characters with atomic operations.
 * Characters require both an asset record and a character_details record.
 */

/**
 * Character Server Actions (FILM-202)
 *
 * Server actions for creating, updating, and deleting characters with atomic operations.
 * Characters require both an asset record and a character_details record.
 */

/**
 * Character Server Actions (FILM-202)
 *
 * Server actions for creating, updating, and deleting characters with atomic operations.
 * Characters require both an asset record and a character_details record.
 */

/**
 * Character Server Actions (FILM-202)
 *
 * Server actions for creating, updating, and deleting characters with atomic operations.
 * Characters require both an asset record and a character_details record.
 */

/**
 * Character Server Actions (FILM-202)
 *
 * Server actions for creating, updating, and deleting characters with atomic operations.
 * Characters require both an asset record and a character_details record.
 */

/**
 * Character Server Actions (FILM-202)
 *
 * Server actions for creating, updating, and deleting characters with atomic operations.
 * Characters require both an asset record and a character_details record.
 */

/**
 * Character Server Actions (FILM-202)
 *
 * Server actions for creating, updating, and deleting characters with atomic operations.
 * Characters require both an asset record and a character_details record.
 */

/**
 * Character Server Actions (FILM-202)
 *
 * Server actions for creating, updating, and deleting characters with atomic operations.
 * Characters require both an asset record and a character_details record.
 */

/**
 * Create a new character with atomic insert into assets + character_details
 *
 * Transaction pattern:
 * 1. Insert into assets table
 * 2. Insert into character_details table
 * 3. If step 2 fails, rollback by deleting the asset
 */
export const createCharacterAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'character.create', projectId: data.projectId };

    logger.info(ctx, 'Creating character');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Step 1: Create the base asset
    const { data: asset, error: assetError } = await client
      .from('assets')
      .insert({
        project_id: data.projectId,
        type: 'character',
        name: data.name,
        description: data.description ?? null,
        file_url: data.fileUrl || null,
        thumbnail_url: data.thumbnailUrl || null,
        metadata: {} as Json,
      })
      .select()
      .single();

    if (assetError) {
      logger.error({ ...ctx, error: assetError }, 'Failed to create asset');
      throw new Error(`Failed to create character: ${assetError.message}`);
    }

    // Step 2: Create character_details entry
    // Combine structured fields into physical_attributes JSONB
    const physicalAttributesJson = {
      physicalAttributes: data.physicalAttributes ?? null,
      personalityTraits: data.personalityTraits ?? null,
      clothingStyle: data.clothingStyle ?? null,
      backstory: data.backstory ?? null,
    };

    const { error: detailsError } = await client
      .from('character_details')
      .insert({
        asset_id: asset.id,
        physical_attributes: physicalAttributesJson as Json,
        personality: data.personality ?? null,
        element_prompt: data.elementPrompt ?? null,
        reference_images: data.referenceImages ?? null,
        voice_asset_id: data.voiceAssetId ?? null,
      });

    if (detailsError) {
      logger.error(
        { ...ctx, error: detailsError, assetId: asset.id },
        'Failed to create character details',
      );

      // Rollback: delete the asset we just created
      await client.from('assets').delete().eq('id', asset.id);

      throw new Error(
        `Failed to create character details: ${detailsError.message}`,
      );
    }

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
          voice_asset_id
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
          voice_asset_id
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
    return {
      success: true,
      data: mapRowToCharacterWithDetails(character as CharacterRow),
    };
  },
  {
    schema: GetCharacterSchema,
  },
);

/**
 * Update an existing character (both assets and character_details)
 */
export const updateCharacterAction = enhanceAction(
  async (data): Promise<{ success: boolean; data: CharacterWithDetails }> => {
    const logger = await getLogger();
    const ctx = { name: 'character.update', assetId: data.assetId };

    logger.info(ctx, 'Updating character');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Build asset updates (only include provided fields)
    const assetUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) assetUpdates.name = data.name;
    if (data.description !== undefined)
      assetUpdates.description = data.description;
    if (data.fileUrl !== undefined)
      assetUpdates.file_url = data.fileUrl || null;
    if (data.thumbnailUrl !== undefined)
      assetUpdates.thumbnail_url = data.thumbnailUrl || null;

    // Update asset if there are changes
    if (Object.keys(assetUpdates).length > 1) {
      const { error: assetError } = await client
        .from('assets')
        .update(assetUpdates)
        .eq('id', data.assetId)
        .eq('type', 'character')
        .is('deleted_at', null);

      if (assetError) {
        logger.error({ ...ctx, error: assetError }, 'Failed to update asset');
        throw new Error(`Failed to update character: ${assetError.message}`);
      }
    }

    // Build character_details updates
    const detailsUpdates: Record<string, unknown> = {};
    let hasDetailsUpdates = false;

    // For JSONB fields, we need to merge with existing data
    const physicalAttributesUpdates: Record<string, unknown> = {};

    if (data.physicalAttributes !== undefined) {
      physicalAttributesUpdates.physicalAttributes = data.physicalAttributes;
      hasDetailsUpdates = true;
    }
    if (data.personalityTraits !== undefined) {
      physicalAttributesUpdates.personalityTraits = data.personalityTraits;
      hasDetailsUpdates = true;
    }
    if (data.clothingStyle !== undefined) {
      physicalAttributesUpdates.clothingStyle = data.clothingStyle;
      hasDetailsUpdates = true;
    }
    if (data.backstory !== undefined) {
      physicalAttributesUpdates.backstory = data.backstory;
      hasDetailsUpdates = true;
    }

    if (Object.keys(physicalAttributesUpdates).length > 0) {
      // Fetch existing physical_attributes to merge
      const { data: existing } = await client
        .from('character_details')
        .select('physical_attributes')
        .eq('asset_id', data.assetId)
        .single();

      const existingAttrs =
        (existing?.physical_attributes as Record<string, unknown>) ?? {};
      detailsUpdates.physical_attributes = {
        ...existingAttrs,
        ...physicalAttributesUpdates,
      } as Json;
    }

    if (data.personality !== undefined) {
      detailsUpdates.personality = data.personality;
      hasDetailsUpdates = true;
    }
    if (data.elementPrompt !== undefined) {
      detailsUpdates.element_prompt = data.elementPrompt;
      hasDetailsUpdates = true;
    }
    if (data.referenceImages !== undefined) {
      detailsUpdates.reference_images = data.referenceImages;
      hasDetailsUpdates = true;
    }
    if (data.voiceAssetId !== undefined) {
      detailsUpdates.voice_asset_id = data.voiceAssetId;
      hasDetailsUpdates = true;
    }

    // Update character_details if there are changes
    if (hasDetailsUpdates) {
      const { error: detailsError } = await client
        .from('character_details')
        .update(detailsUpdates)
        .eq('asset_id', data.assetId);

      if (detailsError) {
        logger.error(
          { ...ctx, error: detailsError },
          'Failed to update character details',
        );
        throw new Error(
          `Failed to update character details: ${detailsError.message}`,
        );
      }
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
          voice_asset_id
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
          physical_attributes,
          personality,
          element_prompt,
          reference_images,
          voice_asset_id
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
export const deleteCharacterAction = enhanceAction(
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
      throw new Error(
        'Cannot delete character that is in use by dialogue lines',
      );
    }

    // Soft delete by setting deleted_at
    const { error } = await client
      .from('assets')
      .update({ deleted_at: new Date().toISOString() } as Record<
        string,
        unknown
      >)
      .eq('id', data.assetId)
      .eq('type', 'character')
      .is('deleted_at', null);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete character');
      throw new Error(`Failed to delete character: ${error.message}`);
    }

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
