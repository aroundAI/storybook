import 'server-only';

import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  Asset,
  AssetRow,
  AssetType,
  GetProjectAssetsResponse,
} from '../types';
import { mapRowToAsset } from '../types';

/**
 * Get all assets for a project with optional filtering and pagination
 *
 * @param projectId - The project UUID
 * @param options - Optional filtering and pagination options
 * @returns Paginated assets response
 */
export async function getProjectAssets(
  projectId: string,
  options?: {
    type?: AssetType;
    limit?: number;
    offset?: number;
  },
): Promise<GetProjectAssetsResponse> {
  const logger = await getLogger();
  const ctx = { name: 'assets.getProjectAssets', projectId, options };

  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  logger.info(ctx, 'Fetching project assets');

  const client = getSupabaseServerClient();

  // Build query with pagination
  let query = client
    .from('assets')
    .select(
      `
      id, project_id, name, type, thumbnail_url, file_url,
      metadata, created_at, updated_at, deleted_at
    `,
      { count: 'exact' },
    )
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  // Apply type filter if provided
  if (options?.type) {
    query = query.eq('type', options.type);
  }

  const { data, error, count } = await query;

  if (error) {
    logger.error({ ...ctx, error }, 'Failed to fetch project assets');
    throw new Error(`Failed to fetch project assets: ${error.message}`);
  }

  const assets = (data as AssetRow[]).map(mapRowToAsset);
  const total = count ?? 0;

  logger.info(
    { ...ctx, count: assets.length, total },
    'Project assets fetched successfully',
  );

  return {
    assets,
    total,
    hasMore: total > offset + limit,
  };
}

/**
 * Get a single asset by ID
 *
 * @param assetId - The asset UUID
 * @returns The asset or null if not found
 */
export async function getAsset(assetId: string): Promise<Asset | null> {
  const logger = await getLogger();
  const ctx = { name: 'assets.getAsset', assetId };

  logger.info(ctx, 'Fetching asset');

  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('assets')
    .select(
      `
      id, project_id, name, type, thumbnail_url, file_url,
      metadata, created_at, updated_at, deleted_at
    `,
    )
    .eq('id', assetId)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      logger.info(ctx, 'Asset not found');
      return null;
    }
    logger.error({ ...ctx, error }, 'Failed to fetch asset');
    throw new Error(`Failed to fetch asset: ${error.message}`);
  }

  logger.info(ctx, 'Asset fetched successfully');

  return mapRowToAsset(data as AssetRow);
}

/**
 * Check if an asset is referenced by other entities
 * Used to prevent deletion of assets that are in use
 *
 * @param assetId - The asset UUID
 * @returns true if the asset is in use, false otherwise
 */
export async function isAssetInUse(assetId: string): Promise<boolean> {
  const logger = await getLogger();
  const ctx = { name: 'assets.isAssetInUse', assetId };

  logger.info(ctx, 'Checking if asset is in use');

  const client = getSupabaseServerClient();

  // Check if asset is referenced by dialogue_lines (character speaking)
  const { count: dialogueCount } = await client
    .from('dialogue_lines')
    .select('id', { count: 'exact', head: true })
    .eq('character_asset_id', assetId);

  if (dialogueCount && dialogueCount > 0) {
    logger.info(
      { ...ctx, dialogueCount },
      'Asset is referenced by dialogue lines',
    );
    return true;
  }

  // Check if asset is referenced by character_details (voice asset)
  const { count: characterCount } = await client
    .from('character_details')
    .select('asset_id', { count: 'exact', head: true })
    .eq('elevenlabs_voice_id', assetId);

  if (characterCount && characterCount > 0) {
    logger.info(
      { ...ctx, characterCount },
      'Asset is referenced by character details',
    );
    return true;
  }

  logger.info(ctx, 'Asset is not in use');
  return false;
}

/**
 * Get assets by type for a project
 *
 * @param projectId - The project UUID
 * @param type - The asset type to filter by
 * @returns Array of assets
 */
export async function getAssetsByType(
  projectId: string,
  type: AssetType,
): Promise<Asset[]> {
  const response = await getProjectAssets(projectId, { type, limit: 100 });
  return response.assets;
}

/**
 * Check if an asset exists and is not deleted
 *
 * @param assetId - The asset UUID
 * @returns true if asset exists, false otherwise
 */
export async function assetExists(assetId: string): Promise<boolean> {
  const asset = await getAsset(assetId);
  return asset !== null;
}
