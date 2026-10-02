'use server';

import { revalidatePath } from 'next/cache';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { requireAffectedRows, returnRefusals } from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  BulkDeleteAssetsSchema,
  CheckAssetHashSchema,
  CheckAssetsInUseSchema,
  CreateAssetSchema,
  DeleteAssetSchema,
  GetAssetSchema,
  GetProjectAssetsSchema,
  UpdateAssetSchema,
} from '../schemas/asset.schema';
import type {
  Asset,
  AssetRow,
  DeleteAssetResponse,
  GetProjectAssetsResponse,
} from '../types';
import { mapRowToAsset } from '../types';
import { checkAssetHashQuery, getAsset, isAssetInUse } from './asset.queries';
import { insertAsset, updateAssetRow } from './asset.service';

/**
 * Create a new asset for a project. The write and its refusals live in
 * asset.service.ts, shared with the MCP upsert_asset tool (FILM-1905).
 *
 * @throws {Error} If user lacks project access or validation fails
 */
const createAsset = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'assets.create', projectId: data.projectId };

    logger.info(ctx, 'Creating asset');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const inserted = await insertAsset(client, data).catch((error) => {
      logger.error({ ...ctx, error }, 'Failed to create asset');
      throw error;
    });

    if (!inserted.ok) {
      throw new ActionRefusal(inserted.refusal);
    }

    logger.info({ ...ctx, assetId: inserted.data.id }, 'Asset created successfully');

    // Revalidate asset pages
    revalidatePath('/home/[account]/studio/[projectSlug]/assets', 'page');
    revalidatePath('/home/[account]/studio/[projectSlug]', 'page');

    return { success: true, data: inserted.data };
  },
  {
    schema: CreateAssetSchema,
  },
);

export const createAssetAction = returnRefusals(createAsset);

/**
 * Fetch all assets for a project with optional filtering and pagination
 *
 * @throws {Error} If user lacks project access
 */
export const getProjectAssetsAction = enhanceAction(
  async (data): Promise<GetProjectAssetsResponse> => {
    const logger = await getLogger();
    const ctx = { name: 'assets.getProjectAssets', projectId: data.projectId };

    logger.info(ctx, 'Fetching project assets');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    // Build query with pagination
    let query = client
      .from('assets')
      .select('*', { count: 'exact' })
      .eq('project_id', data.projectId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply type filter if provided
    if (data.type) {
      query = query.eq('type', data.type);
    }

    const { data: assets, error, count } = await query;

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch project assets');
      throw new Error(`Failed to fetch project assets: ${error.message}`);
    }

    const mappedAssets = (assets as AssetRow[]).map(mapRowToAsset);
    const total = count ?? 0;

    logger.info(
      { ...ctx, count: mappedAssets.length, total },
      'Project assets fetched successfully',
    );

    return {
      assets: mappedAssets,
      total,
      hasMore: total > offset + limit,
    };
  },
  {
    schema: GetProjectAssetsSchema,
  },
);

/**
 * Check if an asset with the given hash exists
 *
 * @throws {Error} If user lacks project access
 */
export const checkAssetHashAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'assets.checkHash', projectId: data.projectId };

    logger.info(ctx, 'Checking asset hash');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    try {
      const existingAsset = await checkAssetHashQuery(
        data.projectId,
        data.fileHash,
        data.type,
      );

      logger.info(
        { ...ctx, found: !!existingAsset },
        'Asset hash check completed',
      );

      return {
        success: true,
        data: existingAsset,
      };
    } catch (error) {
      logger.error({ ...ctx, error }, 'Failed to check asset hash');
      // Rethrow to let enhanceAction handle it, but now we have a log
      throw new Error(
        `Failed to check asset hash: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
  {
    schema: CheckAssetHashSchema,
  },
);

/**
 * Update an existing asset
 *
 * @throws {Error} If user lacks project access or asset not found
 */
const updateAsset = enhanceAction(
  async (data): Promise<{ success: boolean; data: Asset }> => {
    const logger = await getLogger();
    const ctx = { name: 'assets.update', assetId: data.id };

    logger.info(ctx, 'Updating asset');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    const updated = await updateAssetRow(client, data).catch((error) => {
      logger.error({ ...ctx, error }, 'Failed to update asset');
      throw error;
    });

    if (!updated.ok) {
      throw new ActionRefusal(updated.refusal);
    }

    logger.info(ctx, 'Asset updated successfully');

    // Revalidate asset pages
    revalidatePath('/home/[account]/studio/[projectSlug]/assets', 'page');
    revalidatePath('/home/[account]/studio/[projectSlug]', 'page');

    return { success: true, data: updated.data };
  },
  {
    schema: UpdateAssetSchema,
  },
);

export const updateAssetAction = returnRefusals(updateAsset);

/**
 * Soft delete an asset (sets deleted_at timestamp)
 *
 * @throws {Error} If user lacks access or asset is in use
 */
const deleteAsset = enhanceAction(
  async (data): Promise<DeleteAssetResponse> => {
    const logger = await getLogger();
    const ctx = { name: 'assets.delete', assetId: data.assetId };

    logger.info(ctx, 'Deleting asset');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Check if asset is referenced by other entities
    const inUse = await isAssetInUse(data.assetId);

    if (inUse) {
      logger.warn(ctx, 'Cannot delete asset that is in use');
      throw new ActionRefusal(
        'This asset is used by dialogue in an episode, so it cannot be deleted.',
      );
    }

    // Soft delete by setting deleted_at
    // Note: deleted_at column added in migration 20251207161156_add-assets-deleted-at.sql
    const { data: deleted, error } = await client
      .from('assets')
      .update({ deleted_at: new Date().toISOString() } as Record<
        string,
        unknown
      >)
      .eq('id', data.assetId)
      .is('deleted_at', null)
      .select('id');

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete asset');
      throw new Error(`Failed to delete asset: ${error.message}`);
    }

    // RLS filters a refused update to no rows, without an error (KB-61)
    requireAffectedRows(
      deleted,
      "The asset wasn't deleted: it's already gone, or you can't delete it. Reload the page.",
    );

    logger.info(ctx, 'Asset deleted successfully');

    // Revalidate asset pages
    revalidatePath('/home/[account]/studio/[projectSlug]/assets', 'page');
    revalidatePath('/home/[account]/studio/[projectSlug]', 'page');

    return {
      success: true,
      assetId: data.assetId,
    };
  },
  {
    schema: DeleteAssetSchema,
  },
);

export const deleteAssetAction = returnRefusals(deleteAsset);

/**
 * Get a single asset by ID (Server Action wrapper)
 *
 * @throws {Error} If user lacks project access (via RLS) or asset not found
 */
export const getAssetAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'assets.get', assetId: data.assetId };

    logger.info(ctx, 'Getting asset via action');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Reuse the existing query function logic which handles RLS via Supabase client
    const asset = await getAsset(data.assetId);

    if (!asset) {
      logger.warn(ctx, 'Asset not found');
      return { success: true, data: null };
    }

    logger.info(ctx, 'Asset retrieved successfully');

    return { success: true, data: asset };
  },
  {
    schema: GetAssetSchema,
  },
);

/**
 * Check if assets are in use (referenced by dialogue_lines)
 *
 * Returns which assets are in use and which are safe to delete.
 */
export const checkAssetsInUseAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = {
      name: 'assets.checkInUse',
      projectId: data.projectId,
      count: data.assetIds.length,
    };

    logger.info(ctx, 'Checking assets in use');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Fetch asset names for the requested IDs
    const { data: assets, error: assetsError } = await client
      .from('assets')
      .select('id, name')
      .in('id', data.assetIds)
      .eq('project_id', data.projectId);

    if (assetsError) {
      logger.error({ ...ctx, error: assetsError }, 'Failed to fetch assets');
      throw new Error(`Failed to fetch assets: ${assetsError.message}`);
    }

    const assetMap = new Map(
      (assets ?? []).map((a) => [a.id, a.name as string]),
    );

    // Check dialogue_lines references for character_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dialogueRefs, error: dialogueError } = await (client as any)
      .from('dialogue_lines')
      .select('character_asset_id')
      .in('character_asset_id', data.assetIds);

    if (dialogueError) {
      logger.error(
        { ...ctx, error: dialogueError },
        'Failed to check dialogue_lines references',
      );
      throw new Error(`Failed to check references: ${dialogueError.message}`);
    }

    const inUseIds = new Set<string>(
      (dialogueRefs ?? []).map(
        (ref: { character_asset_id: string }) => ref.character_asset_id,
      ),
    );

    const inUseAssets = data.assetIds
      .filter((id) => inUseIds.has(id))
      .map((id) => ({
        id,
        name: assetMap.get(id) ?? 'Unknown',
        usedBy: ['dialogue_lines'],
      }));

    const safeToDelete = data.assetIds.filter((id) => !inUseIds.has(id));

    logger.info(
      { ...ctx, inUse: inUseAssets.length, safe: safeToDelete.length },
      'Assets in-use check completed',
    );

    return {
      success: true,
      data: { inUseAssets, safeToDelete },
    };
  },
  {
    schema: CheckAssetsInUseSchema,
  },
);

/**
 * Hard delete multiple assets by ID
 *
 * Performs a permanent DELETE. Callers should run checkAssetsInUseAction first.
 *
 * @throws {Error} If user lacks project access or deletion fails
 */
export const bulkDeleteAssetsAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = {
      name: 'assets.bulkDelete',
      projectId: data.projectId,
      count: data.assetIds.length,
    };

    logger.info(ctx, 'Bulk deleting assets');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Hard delete scoped to project (RLS also enforces access)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: deleted, error } = await (client as any)
      .from('assets')
      .delete()
      .in('id', data.assetIds)
      .eq('project_id', data.projectId)
      .select('id');

    if (error) {
      console.error('[bulkDeleteAssetsAction] Failed to delete assets:', error);
      logger.error({ ...ctx, error }, 'Failed to bulk delete assets');
      throw new Error(`Failed to bulk delete assets: ${error.message}`);
    }

    const deletedCount = deleted?.length ?? 0;

    logger.info({ ...ctx, deletedCount }, 'Assets bulk deleted successfully');

    // Revalidate asset pages
    revalidatePath('/home/[account]/studio/[projectSlug]/assets', 'page');
    revalidatePath('/home/[account]/studio/[projectSlug]', 'page');

    return {
      success: true,
      data: { deletedCount },
    };
  },
  {
    schema: BulkDeleteAssetsSchema,
  },
);
