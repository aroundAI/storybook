/**
 * Character Queries (FILM-202)
 *
 * Server-side query functions for fetching characters with joined details.
 */
import 'server-only';

import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  CharacterRole,
  CharacterRow,
  CharacterWithDetails,
  ListCharactersResponse,
  VoiceAssetOption,
} from '../types';
import { mapRowToCharacterWithDetails } from '../types';

/**
 * Role priority for sorting (lower = higher priority)
 */
const ROLE_PRIORITY: Record<CharacterRole, number> = {
  protagonist: 1,
  deuteragonist: 2,
  supporting: 3,
  narrator: 4,
  creature: 5,
  object: 6,
  background: 7,
};

/**
 * Sort characters by role priority, then by name
 */
function sortCharactersByRole(
  characters: CharacterWithDetails[],
): CharacterWithDetails[] {
  return [...characters].sort((a, b) => {
    const priorityA = ROLE_PRIORITY[a.role] ?? 99;
    const priorityB = ROLE_PRIORITY[b.role] ?? 99;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get a single character with full details
 * Performs JOIN between assets and character_details tables
 */
export async function getCharacter(
  assetId: string,
): Promise<CharacterWithDetails | null> {
  const logger = await getLogger();
  const ctx = { name: 'character.getCharacter', assetId };

  logger.info(ctx, 'Fetching character with details');

  const client = getSupabaseServerClient();

  const { data, error } = await client
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
    )
    .eq('id', assetId)
    .eq('type', 'character')
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      logger.info(ctx, 'Character not found');
      return null;
    }
    logger.error({ ...ctx, error }, 'Failed to fetch character');
    throw new Error(`Failed to fetch character: ${error.message}`);
  }

  logger.info(ctx, 'Character fetched successfully');
  return mapRowToCharacterWithDetails(data as CharacterRow);
}

/**
 * List all characters for a project with pagination
 */
export async function listCharacters(
  projectId: string,
  options?: { limit?: number; offset?: number },
): Promise<ListCharactersResponse> {
  const logger = await getLogger();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const ctx = { name: 'character.listCharacters', projectId, limit, offset };

  logger.info(ctx, 'Listing characters for project');

  const client = getSupabaseServerClient();

  const { data, error, count } = await client
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
    .eq('project_id', projectId)
    .eq('type', 'character')
    .is('deleted_at', null)
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to list characters');
    throw new Error(`Failed to list characters: ${error.message}`);
  }

  // Map to CharacterWithDetails and sort by role priority
  const characters = sortCharactersByRole(
    (data as CharacterRow[]).map(mapRowToCharacterWithDetails),
  );
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
}

/**
 * Get available voice assets for a project (for voice selector dropdown)
 */
export async function getProjectVoiceAssets(
  projectId: string,
): Promise<VoiceAssetOption[]> {
  const logger = await getLogger();
  const ctx = { name: 'character.getProjectVoiceAssets', projectId };

  logger.info(ctx, 'Fetching voice assets for project');

  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('assets')
    .select('id, name, file_url, thumbnail_url')
    .eq('project_id', projectId)
    .eq('type', 'voice')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to fetch voice assets');
    throw new Error(`Failed to fetch voice assets: ${error.message}`);
  }

  logger.info(
    { ...ctx, count: data?.length ?? 0 },
    'Voice assets fetched successfully',
  );

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    fileUrl: row.file_url,
    thumbnailUrl: row.thumbnail_url,
  }));
}
