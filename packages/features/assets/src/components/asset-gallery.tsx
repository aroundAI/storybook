'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useAssets } from '../hooks/use-assets';
import type { Asset } from '../lib/types';
import { AssetCard } from './asset-card';
import { AssetGrid } from './asset-grid';
import { AssetSearchBar } from './asset-search-bar';
import { AssetTabs } from './asset-tabs';
import { EmptyAssetState } from './empty-asset-state';

type TabType = 'character' | 'location' | 'voice';

interface AssetGalleryProps {
  projectId: string;
  initialTab?: TabType;
  onAssetSelect?: (asset: Asset) => void;
  onCreateAsset?: (type: TabType) => void;
}

export function AssetGallery({
  projectId,
  initialTab = 'character',
  onAssetSelect,
  onCreateAsset,
}: AssetGalleryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Get active tab from URL or use initial
  const activeTab = (searchParams.get('tab') as TabType) ?? initialTab;

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch assets for active tab
  const { assets, isLoading, deleteAsset, fetchAssets } = useAssets({
    projectId,
    type: activeTab,
  });

  // Load assets when tab changes
  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  // Filter assets by search query
  const filteredAssets = useMemo(() => {
    if (!searchQuery) return assets;

    const query = searchQuery.toLowerCase();
    return assets.filter(
      (asset) =>
        asset.name.toLowerCase().includes(query) ||
        asset.description?.toLowerCase().includes(query),
    );
  }, [assets, searchQuery]);

  // Handle tab change
  const handleTabChange = useCallback(
    (tab: TabType) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tab);
      router.replace(`${pathname}?${params.toString()}`);
      setSearchQuery(''); // Clear search when switching tabs
    },
    [pathname, router, searchParams],
  );

  // Handle delete with confirmation
  const handleDelete = useCallback(
    async (asset: Asset) => {
      await deleteAsset(asset.id);
    },
    [deleteAsset],
  );

  // Handle edit
  const handleEdit = useCallback(
    (asset: Asset) => {
      onAssetSelect?.(asset);
    },
    [onAssetSelect],
  );

  // Handle create
  const handleCreate = useCallback(() => {
    onCreateAsset?.(activeTab);
  }, [activeTab, onCreateAsset]);

  const renderCharacterGroups = () => {
    const mainRolePatterns = ['Protagonist', 'Antagonist', 'Sidekick', 'Main Character'];
    const supportRolePatterns = ['Supporting', 'Minor Character'];

    // Helper to check role
    const hasRole = (a: Asset, roles: string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const role = (a.metadata as any)?.role;
      return role && roles.some(r => role.includes(r));
    };

    const isMain = (a: Asset) => hasRole(a, mainRolePatterns);
    const isSupporting = (a: Asset) => hasRole(a, supportRolePatterns);
    const isOther = (a: Asset) => !isMain(a) && !isSupporting(a);

    const mainCast = filteredAssets.filter(isMain);
    const supportingCast = filteredAssets.filter(isSupporting);
    const others = filteredAssets.filter(isOther);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasCreatures = others.some((a) => (a.metadata as any)?.role === 'Creature');

    return (
      <div className="space-y-12">
        {/* Main Cast */}
        {mainCast.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-xl font-bold tracking-tight text-orange-900/70 dark:text-orange-100/70 pl-3 border-l-4 border-orange-500">
              Main Cast
            </h3>
            <AssetGrid>
              {mainCast.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </AssetGrid>
          </div>
        )}

        {/* Supporting Cast */}
        {supportingCast.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold tracking-tight text-muted-foreground pl-3 border-l-4 border-transparent">
              Supporting Cast
            </h3>
            <AssetGrid>
              {supportingCast.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </AssetGrid>
          </div>
        )}

        {/* Other Characters / Creatures */}
        {others.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold tracking-tight text-muted-foreground pl-3 border-l-4 border-transparent">
              {hasCreatures ? 'Creatures & Others' : 'Other Characters'}
            </h3>
            <AssetGrid>
              {others.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </AssetGrid>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <AssetTabs activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Search Bar */}
      <AssetSearchBar value={searchQuery} onChange={setSearchQuery} />

      {/* Grid or Empty State */}
      {isLoading ? (
        <AssetGrid isLoading={true}>{null}</AssetGrid>
      ) : filteredAssets.length > 0 ? (
        activeTab === 'character' ? (
          renderCharacterGroups()
        ) : (
          <AssetGrid className={activeTab === 'location' ? 'sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2' : undefined}>
            {filteredAssets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </AssetGrid>
        )
      ) : searchQuery ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">
            No assets found matching &quot;{searchQuery}&quot;
          </p>
        </div>
      ) : (
        <EmptyAssetState assetType={activeTab} onCreate={handleCreate} />
      )}
    </div>
  );
}
