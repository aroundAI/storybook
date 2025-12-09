'use server';

/**
 * Character Server Actions (FILM-202)
 * CRUD operations for character assets with extended details
 */
import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CreateCharacterSchema,
  GetCharacterSchema,
  ListCharactersSchema,
  UpdateCharacterSchema,
} from '../schemas/character.schema';
import type {
  Character,
  ClothingStyle,
  ListCharactersResponse,
  PersonalityTraits,
  PhysicalAttributes,
} from '../types/character.types';

/**
 * Maps database rows to Character type
 */
function mapToCharacter(
  asset: Record<string, unknown>,
  details?: Record<string, unknown> | null,
): Character {
  // Parse physical attributes from JSONB
  const physicalAttrs = details?.physical_attributes as Record<
    string,
    unknown
  > | null;

  // Extract clothing from physical_attributes if stored there
  let clothing: ClothingStyle | null = null;
  let physicalAttributes: PhysicalAttributes | null = null;

  if (physicalAttrs) {
    // Extract clothing if it was stored in physical_attributes
    const {
      clothing: clothingData,
      backstory: _backstory,
      ...attrs
    } = physicalAttrs;
    physicalAttributes = attrs as PhysicalAttributes;

    if (clothingData && typeof clothingData === 'object') {
      clothing = clothingData as ClothingStyle;
    }
  }

  // Parse personality from text field (stored as JSON string)
  let personality: PersonalityTraits | null = null;
  if (details?.personality && typeof details.personality === 'string') {
    try {
      personality = JSON.parse(details.personality as string);
    } catch {
      // If not valid JSON, ignore
    }
  }

  // Extract backstory from physical_attributes if stored there
  const backstory =
    physicalAttrs && typeof physicalAttrs === 'object'
      ? ((physicalAttrs as Record<string, unknown>).backstory as string | null)
      : null;

  return {
    id: asset.id as string,
    projectId: asset.project_id as string,
    name: asset.name as string,
    type: 'character',
    description: asset.description as string | null,
    fileUrl: asset.file_url as string | null,
    thumbnailUrl: asset.thumbnail_url as string | null,
    createdAt: asset.created_at as string,
    updatedAt: asset.updated_at as string,
    deletedAt: asset.deleted_at as string | null,
    voiceAssetId: (details?.voice_asset_id as string) ?? null,
    physicalAttributes,
    personality,
    clothing,
    backstory,
    elementPrompt: (details?.element_prompt as string) ?? null,
    referenceImages: (details?.reference_images as string[]) ?? null,
  };
}

/**
 * Creates a new character with asset and character_details records
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

    // Step 1: Create asset record
    const { data: asset, error: assetError } = await client
      .from('assets')
      .insert({
        project_id: data.projectId,
        type: 'character',
        name: data.name,
        description: data.description ?? null,
        file_url: data.fileUrl ?? null,
        thumbnail_url: data.thumbnailUrl ?? null,
        metadata: {} as Json,
      })
      .select()
      .single();

    if (assetError) {
      logger.error({ ...ctx, error: assetError }, 'Failed to create asset');
      throw new Error(`Failed to create character: ${assetError.message}`);
    }

    // Step 2: Create character_details record
    // Combine physicalAttributes with clothing and backstory for storage
    const combinedPhysicalAttributes = {
      ...data.physicalAttributes,
      clothing: data.clothing,
      backstory: data.backstory,
    };

    // Serialize personality to JSON string for DB storage
    const personalityString = data.personality
      ? JSON.stringify(data.personality)
      : null;

    const { data: details, error: detailsError } = await client
      .from('character_details')
      .insert({
        asset_id: asset.id,
        voice_asset_id: data.voiceAssetId ?? null,
        physical_attributes: combinedPhysicalAttributes as Json,
        personality: personalityString,
        element_prompt: null,
        reference_images: data.fileUrl ? [data.fileUrl] : null,
      })
      .select()
      .single();

    if (detailsError) {
      // Rollback: delete the asset if character_details creation fails
      logger.warn({ ...ctx, assetId: asset.id }, 'Rolling back asset creation');
      await client.from('assets').delete().eq('id', asset.id);

      logger.error(
        { ...ctx, error: detailsError },
        'Failed to create character details',
      );
      throw new Error(
        `Failed to create character details: ${detailsError.message}`,
      );
    }

    logger.info(
      { ...ctx, characterId: asset.id },
      'Character created successfully',
    );

    // Revalidate asset list pages
    revalidatePath('/home/[account]/projects/[id]', 'page');
    revalidatePath('/home/(user)/projects/[id]', 'page');

    return { success: true, data: mapToCharacter(asset, details) };
  },
  {
    schema: CreateCharacterSchema,
  },
);

/**
 * Fetches a character with all details via JOIN
 */
export const getCharacterAction = enhanceAction(
  async (data): Promise<{ success: boolean; data: Character }> => {
    const logger = await getLogger();
    const ctx = { name: 'character.get', characterId: data.characterId };

    logger.info(ctx, 'Fetching character');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Fetch asset with character_details JOIN
    const { data: result, error } = await client
      .from('assets')
      .select(
        `
        *,
        character_details (
          voice_asset_id,
          physical_attributes,
          personality,
          element_prompt,
          reference_images
        )
      `,
      )
      .eq('id', data.characterId)
      .eq('type', 'character')
      .is('deleted_at', null)
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch character');
      throw new Error(`Failed to fetch character: ${error.message}`);
    }

    if (!result) {
      throw new Error('Character not found');
    }

    // Extract character_details from JOIN result
    const characterDetails = Array.isArray(result.character_details)
      ? result.character_details[0]
      : result.character_details;

    logger.info(ctx, 'Character fetched successfully');

    return { success: true, data: mapToCharacter(result, characterDetails) };
  },
  {
    schema: GetCharacterSchema,
  },
);

/**
 * Updates character asset and details atomically
 */
export const updateCharacterAction = enhanceAction(
  async (data): Promise<{ success: boolean; data: Character }> => {
    const logger = await getLogger();
    const ctx = { name: 'character.update', characterId: data.characterId };

    logger.info(ctx, 'Updating character');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Step 1: Update asset fields if provided
    const assetUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) assetUpdates.name = data.name;
    if (data.description !== undefined)
      assetUpdates.description = data.description;
    if (data.fileUrl !== undefined) assetUpdates.file_url = data.fileUrl;
    if (data.thumbnailUrl !== undefined)
      assetUpdates.thumbnail_url = data.thumbnailUrl;

    const { data: asset, error: assetError } = await client
      .from('assets')
      .update(assetUpdates)
      .eq('id', data.characterId)
      .eq('type', 'character')
      .is('deleted_at', null)
      .select()
      .single();

    if (assetError) {
      logger.error({ ...ctx, error: assetError }, 'Failed to update asset');
      throw new Error(`Failed to update character: ${assetError.message}`);
    }

    // Step 2: Update character_details if any character-specific fields provided
    const detailsUpdates: Record<string, unknown> = {};

    if (data.voiceAssetId !== undefined) {
      detailsUpdates.voice_asset_id = data.voiceAssetId;
    }

    // Handle physicalAttributes, clothing, and backstory
    if (
      data.physicalAttributes !== undefined ||
      data.clothing !== undefined ||
      data.backstory !== undefined
    ) {
      // Need to merge with existing physical_attributes
      const { data: existing } = await client
        .from('character_details')
        .select('physical_attributes')
        .eq('asset_id', data.characterId)
        .single();

      const existingAttrs =
        (existing?.physical_attributes as Record<string, unknown>) || {};

      detailsUpdates.physical_attributes = {
        ...existingAttrs,
        ...(data.physicalAttributes ?? {}),
        clothing:
          data.clothing !== undefined
            ? data.clothing
            : (existingAttrs.clothing ?? null),
        backstory:
          data.backstory !== undefined
            ? data.backstory
            : (existingAttrs.backstory ?? null),
      };
    }

    if (data.personality !== undefined) {
      detailsUpdates.personality = data.personality
        ? JSON.stringify(data.personality)
        : null;
    }

    let details: Record<string, unknown> | null = null;

    if (Object.keys(detailsUpdates).length > 0) {
      const { data: updatedDetails, error: detailsError } = await client
        .from('character_details')
        .update(detailsUpdates)
        .eq('asset_id', data.characterId)
        .select()
        .single();

      if (detailsError) {
        logger.error(
          { ...ctx, error: detailsError },
          'Failed to update character details',
        );
        throw new Error(
          `Failed to update character details: ${detailsError.message}`,
        );
      }

      details = updatedDetails;
    } else {
      // Fetch existing details if no updates
      const { data: existingDetails } = await client
        .from('character_details')
        .select('*')
        .eq('asset_id', data.characterId)
        .single();

      details = existingDetails;
    }

    logger.info(ctx, 'Character updated successfully');

    // Revalidate asset pages
    revalidatePath('/home/[account]/projects/[id]', 'page');
    revalidatePath('/home/(user)/projects/[id]', 'page');

    return { success: true, data: mapToCharacter(asset, details) };
  },
  {
    schema: UpdateCharacterSchema,
  },
);

/**
 * Lists all characters for a project with pagination
 */
export const listCharactersAction = enhanceAction(
  async (data): Promise<ListCharactersResponse> => {
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

    // Fetch assets with character_details JOIN
    const {
      data: results,
      error,
      count,
    } = await client
      .from('assets')
      .select(
        `
        *,
        character_details (
          voice_asset_id,
          physical_attributes,
          personality,
          element_prompt,
          reference_images
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

    const characters = (results ?? []).map((result) => {
      const characterDetails = Array.isArray(result.character_details)
        ? result.character_details[0]
        : result.character_details;

      return mapToCharacter(result, characterDetails);
    });

    const total = count ?? 0;

    logger.info(
      { ...ctx, count: characters.length, total },
      'Characters listed successfully',
    );

    return {
      characters,
      total,
      hasMore: total > offset + limit,
    };
  },
  {
    schema: ListCharactersSchema,
  },
);
