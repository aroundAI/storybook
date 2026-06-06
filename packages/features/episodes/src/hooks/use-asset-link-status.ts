'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSupabase } from '@kit/supabase/hooks/use-supabase';

interface AssetLinkEntry {
  id: string;
  name: string;
  type: string;
  thumbnailUrl: string | null;
}

interface AssetLinkResult {
  /** Map of lowercase name → asset entry */
  linkedAssets: Map<string, AssetLinkEntry>;
  /** Whether the query is in progress */
  isLoading: boolean;
  /** Re-fetch link status (call after creating an asset) */
  refetch: () => void;
}

/**
 * Client-side hook to check which character/location names exist
 * as assets in the project library.
 *
 * @param projectId - The project ID to check against
 * @param names - Array of character/location names to check
 * @returns Map of linked assets, loading state, and refetch function
 */
export function useAssetLinkStatus(
  projectId: string,
  names: string[],
): AssetLinkResult {
  const supabase = useSupabase();
  const [linkedAssets, setLinkedAssets] = useState<Map<string, AssetLinkEntry>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [fetchCount, setFetchCount] = useState(0);

  // Stable dependency: sorted joined names string
  const namesKey = useMemo(
    () =>
      names
        .map((n) => n.toLowerCase())
        .sort()
        .join('|'),
    [names],
  );

  const refetch = useCallback(() => {
    setFetchCount((c) => c + 1);
  }, []);

  useEffect(() => {
    if (!projectId || names.length === 0) {
      setLinkedAssets(new Map());
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    void supabase
      .from('assets')
      .select('id, name, type, thumbnail_url')
      .eq('project_id', projectId)
      .in('name', names)
      .is('deleted_at', null)
      .then(({ data }) => {
        const map = new Map<string, AssetLinkEntry>();

        if (data) {
          for (const row of data) {
            map.set(row.name.toLowerCase(), {
              id: row.id,
              name: row.name,
              type: row.type,
              thumbnailUrl: row.thumbnail_url ?? null,
            });
          }
        }

        setLinkedAssets(map);
        setIsLoading(false);
      });
  }, [projectId, namesKey, supabase, fetchCount]); // eslint-disable-line react-hooks/exhaustive-deps

  return { linkedAssets, isLoading, refetch };
}
