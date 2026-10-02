import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

import type { CreateAssetInput, UpdateAssetInput } from '../schemas/asset.schema';
import type { Asset, AssetRow } from '../types';
import { mapRowToAsset } from '../types';

/**
 * The asset writes, callable with any Supabase client: the web's server
 * actions pass the cookie session's client, the MCP `upsert_asset` tool
 * (FILM-1905) the principal's RLS-scoped one. A failure the user caused
 * comes back as `{ ok: false, refusal }`; a database failure throws.
 */
export type AssetWriteResult =
  | { ok: true; data: Asset }
  | { ok: false; refusal: string; field?: 'name' | 'episodeId' };

/**
 * `unique(project_id, type, name)` on assets: the one insert/update failure
 * a user causes, worded for them (KB-6). Postgres `unique_violation`.
 */
export function assetNameTaken(
  error: { code?: string },
  type: string,
  name: string,
) {
  return error.code === '23505'
    ? `Another ${type} in this project is already named "${name}". Choose a different name.`
    : null;
}

export async function insertAsset(
  client: SupabaseClient<Database>,
  data: CreateAssetInput,
): Promise<AssetWriteResult> {
  // Security: Verify episodeId belongs to the same project if provided
  if (data.episodeId) {
    const { data: episodeCheck, error: episodeError } = await client
      .from('episodes')
      .select('id, project_id')
      .eq('id', data.episodeId)
      .single();

    if (episodeError || !episodeCheck) {
      throw new Error('Failed to verify episode access');
    }

    if (episodeCheck.project_id !== data.projectId) {
      return {
        ok: false,
        refusal: 'Episode does not belong to this project',
        field: 'episodeId',
      };
    }
  }

  // Insert asset (RLS will enforce project access)
  const { data: asset, error } = await client
    .from('assets')
    .insert({
      project_id: data.projectId,
      episode_id: data.episodeId ?? null,
      type: data.type,
      name: data.name,
      description: data.description ?? null,
      file_url: data.fileUrl ?? null,
      thumbnail_url: data.thumbnailUrl ?? null,
      metadata: (data.metadata as Json) ?? ({} as Json),
      file_hash: data.fileHash ?? null,
      file_size_bytes: data.fileSizeBytes ?? null,
      content_type: data.contentType ?? null,
    })
    .select()
    .single();

  if (error) {
    const taken = assetNameTaken(error, data.type, data.name);
    if (taken) return { ok: false, refusal: taken, field: 'name' };

    throw new Error(`Failed to create asset: ${error.message}`);
  }

  return { ok: true, data: mapRowToAsset(asset as AssetRow) };
}

export async function updateAssetRow(
  client: SupabaseClient<Database>,
  data: UpdateAssetInput,
): Promise<AssetWriteResult> {
  // Build update object (only include provided fields)
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.fileUrl !== undefined) updates.file_url = data.fileUrl;
  if (data.thumbnailUrl !== undefined) updates.thumbnail_url = data.thumbnailUrl;
  if (data.metadata !== undefined) updates.metadata = data.metadata as Json;

  const { data: asset, error } = await client
    .from('assets')
    .update(updates)
    .eq('id', data.id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) {
    // The update does not read the row's type back, so the wording
    // names the rule rather than the kind of asset.
    const taken =
      data.name !== undefined &&
      assetNameTaken(error, 'asset of the same type', data.name);
    if (taken) return { ok: false, refusal: taken, field: 'name' };

    throw new Error(`Failed to update asset: ${error.message}`);
  }

  return { ok: true, data: mapRowToAsset(asset as AssetRow) };
}
