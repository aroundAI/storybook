'use server';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CreateAssetSchema,
  DeleteAssetSchema,
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
import { isAssetInUse } from './asset.queries';

/**
 * Create a new asset for a project
 *
 * @throws {Error} If user lacks project access or validation fails
 */
export const createAssetAction = enhanceAction(
  async (data) => {
    const logger = await getLogger();
    const ctx = { name: 'assets.create', projectId: data.projectId };

    logger.info(ctx, 'Creating asset');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Insert asset (RLS will enforce project access)
    const { data: asset, error } = await client
      .from('assets')
      .insert({
        project_id: data.projectId,
        type: data.type,
        name: data.name,
        description: data.description ?? null,
        file_url: data.fileUrl ?? null,
        thumbnail_url: data.thumbnailUrl ?? null,
        metadata: (data.metadata as Json) ?? ({} as Json),
      })
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to create asset');
      throw new Error(`Failed to create asset: ${error.message}`);
    }

    logger.info({ ...ctx, assetId: asset.id }, 'Asset created successfully');

    // Revalidate asset list pages
    revalidatePath('/home/[account]/projects/[id]', 'page');
    revalidatePath('/home/(user)/projects/[id]', 'page');

    return { success: true, data: mapRowToAsset(asset as AssetRow) };
  },
  {
    schema: CreateAssetSchema,
  },
);

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
 * Update an existing asset
 *
 * @throws {Error} If user lacks project access or asset not found
 */
export const updateAssetAction = enhanceAction(
  async (data): Promise<{ success: boolean; data: Asset }> => {
    const logger = await getLogger();
    const ctx = { name: 'assets.update', assetId: data.id };

    logger.info(ctx, 'Updating asset');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Build update object (only include provided fields)
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.fileUrl !== undefined) updates.file_url = data.fileUrl;
    if (data.thumbnailUrl !== undefined)
      updates.thumbnail_url = data.thumbnailUrl;
    if (data.metadata !== undefined) updates.metadata = data.metadata as Json;

    const { data: asset, error } = await client
      .from('assets')
      .update(updates)
      .eq('id', data.id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to update asset');
      throw new Error(`Failed to update asset: ${error.message}`);
    }

    logger.info(ctx, 'Asset updated successfully');

    // Revalidate asset pages
    revalidatePath('/home/[account]/projects/[id]', 'page');
    revalidatePath('/home/(user)/projects/[id]', 'page');

    return { success: true, data: mapRowToAsset(asset as AssetRow) };
  },
  {
    schema: UpdateAssetSchema,
  },
);

/**
 * Soft delete an asset (sets deleted_at timestamp)
 *
 * @throws {Error} If user lacks access or asset is in use
 */
export const deleteAssetAction = enhanceAction(
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
      throw new Error(
        'Cannot delete asset that is in use by other entities (dialogue lines or character details)',
      );
    }

    // Soft delete by setting deleted_at
    // Note: deleted_at column added in migration 20251207161156_add-assets-deleted-at.sql
    const { error } = await client
      .from('assets')
      .update({ deleted_at: new Date().toISOString() } as Record<
        string,
        unknown
      >)
      .eq('id', data.assetId)
      .is('deleted_at', null);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete asset');
      throw new Error(`Failed to delete asset: ${error.message}`);
    }

    logger.info(ctx, 'Asset deleted successfully');

    // Revalidate asset pages
    revalidatePath('/home/[account]/projects/[id]', 'page');
    revalidatePath('/home/(user)/projects/[id]', 'page');

    return {
      success: true,
      assetId: data.assetId,
    };
  },
  {
    schema: DeleteAssetSchema,
  },
);
