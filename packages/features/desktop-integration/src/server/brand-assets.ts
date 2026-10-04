import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { Brand } from '../brand.schema';

/** The asset ids a brand names: logo, intro and outro. */
export function brandAssetIds(brand: Brand): string[] {
  return [
    ...new Set(
      [brand.logo.assetId, brand.introAssetId, brand.outroAssetId].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
}

/**
 * The asset ids `brand` names that are not live assets of `projectId`, read
 * as the caller (RLS applies). Empty when every one is the project's own.
 * The schema only checks that an id is a uuid; this keeps a brand from
 * pointing at another project's, or another team's, file.
 */
export async function findForeignBrandAssetIds(
  client: SupabaseClient<Database>,
  projectId: string,
  brand: Brand,
): Promise<string[]> {
  const ids = brandAssetIds(brand);

  if (ids.length === 0) return [];

  const { data, error } = await client
    .from('assets')
    .select('id')
    .in('id', ids)
    .eq('project_id', projectId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Could not read the brand's assets: ${error.message}`);
  }

  const found = new Set((data ?? []).map((row) => row.id));

  return ids.filter((id) => !found.has(id));
}
