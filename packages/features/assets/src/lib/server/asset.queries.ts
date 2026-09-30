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

  const references = {
    'dialogue lines in active episodes': client
      .from('dialogue_lines')
      .select('id, episodes!inner(id)', { count: 'exact', head: true })
      .eq('character_asset_id', assetId)
      .is('episodes.deleted_at', null),
    'a character voice': client
      .from('character_details')
      .select('asset_id', { count: 'exact', head: true })
      .eq('voice_asset_id', assetId),
    'an episode master video': client
      .from('episodes')
      .select('id', { count: 'exact', head: true })
      .or(
        `master_video_asset_id.eq.${assetId},master_title_card_asset_id.eq.${assetId}`,
      )
      .is('deleted_at', null),
    'an audio library entry': client
      .from('audio_assets')
      .select('id', { count: 'exact', head: true })
      .eq('asset_id', assetId)
      .is('deleted_at', null),
    'a caption speaker': client
      .from('caption_segments')
      .select('id', { count: 'exact', head: true })
      .eq('speaker_id', assetId),
  };

  for (const [referrer, query] of Object.entries(references)) {
    const { count, error } = await query;

    if (error) {
      logger.error({ ...ctx, referrer, error }, 'Failed to check asset usage');
      throw new Error(`Failed to check asset usage: ${error.message}`);
    }

    if (count && count > 0) {
      logger.info({ ...ctx, referrer, count }, 'Asset is in use');
      return true;
    }
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

/**
 * Check if an asset with the given hash exists in the project.
 * Used for deduplication.
 *
 * @param projectId - The project UUID
 * @param fileHash - The SHA-256 hash of the file
 * @param type - The asset type
 * @returns Metadata of the existing asset or null if not found
 */
export async function checkAssetHashQuery(
  projectId: string,
  fileHash: string,
  type: AssetType,
): Promise<{
  id: string;
  name: string;
  type: AssetType;
  fileUrl: string | null;
  fileHash: string | null;
  fileSizeBytes: number | null;
  contentType: string | null;
  createdAt: string;
} | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('assets')
    .select(
      'id, name, type, file_url, file_hash, file_size_bytes, content_type, created_at',
    )
    .eq('project_id', projectId)
    .eq('file_hash', fileHash)
    .eq('type', type)
    .eq('type', type)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check asset hash: ${error.message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assetData = data as any;

  if (!assetData) return null;

  return {
    id: assetData.id,
    name: assetData.name,
    type: assetData.type as AssetType,
    fileUrl: assetData.file_url,
    fileHash: assetData.file_hash,
    fileSizeBytes: assetData.file_size_bytes,
    contentType: assetData.content_type,
    createdAt: assetData.created_at,
  };
}
