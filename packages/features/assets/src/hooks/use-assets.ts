'use client';

import { useCallback, useState, useTransition } from 'react';

import { toast } from '@kit/ui/sonner';

import {
  deleteAssetAction,
  getProjectAssetsAction,
} from '../lib/server/asset.mutations';
import type { Asset, AssetType, GetProjectAssetsResponse } from '../lib/types';

type TabType = 'character' | 'location' | 'voice';

interface UseAssetsOptions {
  projectId: string;
  type?: TabType;
  limit?: number;
}

interface UseAssetsReturn {
  assets: Asset[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isDeleting: boolean;
  error: Error | null;
  fetchAssets: () => Promise<void>;
  deleteAsset: (assetId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useAssets({
  projectId,
  type,
  limit = 50,
}: UseAssetsOptions): UseAssetsReturn {
  const [data, setData] = useState<GetProjectAssetsResponse>({
    assets: [],
    total: 0,
    hasMore: false,
  });
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, startLoadTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  const fetchAssets = useCallback(async () => {
    startLoadTransition(async () => {
      try {
        setError(null);
        const response = await getProjectAssetsAction({
          projectId,
          type: type as AssetType | undefined,
          limit,
          offset: 0,
        });
        setData(response);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Failed to fetch assets');
        setError(error);
        toast.error(error.message);
      }
    });
  }, [projectId, type, limit]);

  const deleteAsset = useCallback(
    async (assetId: string) => {
      // Optimistic update
      const previousAssets = data.assets;
      setData((prev) => ({
        ...prev,
        assets: prev.assets.filter((a) => a.id !== assetId),
        total: prev.total - 1,
      }));

      startDeleteTransition(async () => {
        try {
          await deleteAssetAction({ assetId });
          toast.success('Asset deleted successfully');
        } catch (err) {
          // Rollback on error
          setData((prev) => ({
            ...prev,
            assets: previousAssets,
            total: prev.total + 1,
          }));

          const error =
            err instanceof Error ? err : new Error('Failed to delete asset');

          if (error.message.includes('in use')) {
            toast.error('Cannot delete asset that is in use by episodes');
          } else {
            toast.error('Failed to delete asset');
          }
        }
      });
    },
    [data.assets],
  );

  const refetch = useCallback(async () => {
    await fetchAssets();
  }, [fetchAssets]);

  return {
    assets: data.assets,
    total: data.total,
    hasMore: data.hasMore,
    isLoading,
    isDeleting,
    error,
    fetchAssets,
    deleteAsset,
    refetch,
  };
}
