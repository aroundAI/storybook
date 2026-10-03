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
import {
  createCharacterWithDetails,
  updateCharacterWithDetails,
} from './character.service';

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

    const created = await createCharacterWithDetails(client, data).catch(
      (error) => {
        logger.error({ ...ctx, error }, 'Failed to create character');
        throw error;
      },
    );

    if (!created.ok) {
      throw new ActionRefusal(created.refusal);
    }

    logger.info(
      { ...ctx, assetId: created.data.id },
      'Character created successfully',
    );

    // Revalidate asset pages
    revalidatePath('/home/[account]/projects/[id]', 'page');
    revalidatePath('/home/(user)/projects/[id]', 'page');

    return { success: true, data: created.data };
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

    const updated = await updateCharacterWithDetails(client, data).catch(
      (error) => {
        logger.error({ ...ctx, error }, 'Failed to update character');
        throw error;
      },
    );

    if (!updated.ok) {
      throw new ActionRefusal(updated.refusal);
    }

    logger.info(ctx, 'Character updated successfully');

    // Invalidate element prompt cache since character data changed
    await invalidatePromptCache(data.assetId);

    // Revalidate asset pages
    revalidatePath('/home/[account]/projects/[id]', 'page');
    revalidatePath('/home/(user)/projects/[id]', 'page');

    return { success: true, data: updated.data };
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
