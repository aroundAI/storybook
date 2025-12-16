'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { toast } from '@kit/ui/sonner';

import { useAssets } from '../hooks/use-assets';
import { getCharacterAction } from '../lib/server/character.mutations';
import type { Asset, CharacterWithDetails } from '../lib/types';
import { AssetCard } from './asset-card';
import { AssetGrid } from './asset-grid';
import { AssetSearchBar } from './asset-search-bar';
import { AssetTabs } from './asset-tabs';
import { CharacterEditor } from './character-editor';
import { EmptyAssetState } from './empty-asset-state';
import { LocationEditor } from './location-editor';
import { VoiceProfileEditor } from './voice-profile-editor';

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
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);

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
    async (asset: Asset) => {
      // For characters, we need to fetch full details including joined tables
      if (asset.type === 'character') {
        const toastId = toast.loading('Loading character details...');
        try {
          const { data } = await getCharacterAction({ assetId: asset.id });
          if (data) {
            setEditingAsset(data);
            toast.dismiss(toastId);
          } else {
            toast.error('Failed to load character details');
            toast.dismiss(toastId);
          }
        } catch {
          toast.error('Error loading character');
          toast.dismiss(toastId);
        }
      } else {
        // For other assets, metadata is already included
        setEditingAsset(asset);
      }

      onAssetSelect?.(asset);
    },
    [onAssetSelect],
  );

  const handleEditSuccess = useCallback(() => {
    setEditingAsset(null);
    router.refresh();
    void fetchAssets();
  }, [router, fetchAssets]);

  // Handle create
  const handleCreate = useCallback(() => {
    onCreateAsset?.(activeTab);
  }, [activeTab, onCreateAsset]);

  const renderCharacterGroups = () => {
    const mainRolePatterns = [
      'Protagonist',
      'Antagonist',
      'Sidekick',
      'Main Character',
    ];
    const supportRolePatterns = ['Supporting', 'Minor Character'];

    // Helper to check role
    const hasRole = (a: Asset, roles: string[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const role = (a.metadata as any)?.role;
      return role && roles.some((r) => role.includes(r));
    };

    const isMain = (a: Asset) => hasRole(a, mainRolePatterns);
    const isSupporting = (a: Asset) => hasRole(a, supportRolePatterns);
    const isOther = (a: Asset) => !isMain(a) && !isSupporting(a);

    const mainCast = filteredAssets.filter(isMain);
    const supportingCast = filteredAssets.filter(isSupporting);
    const others = filteredAssets.filter(isOther);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasCreatures = others.some(
      (a) => (a.metadata as any)?.role === 'Creature',
    );

    return (
      <div className="space-y-12">
        {/* Main Cast */}
        {mainCast.length > 0 && (
          <div className="space-y-4">
            <h3 className="border-l-4 border-orange-500 pl-3 text-xl font-bold tracking-tight text-orange-900/70 dark:text-orange-100/70">
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
            <h3 className="text-muted-foreground border-l-4 border-transparent pl-3 text-lg font-semibold tracking-tight">
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
            <h3 className="text-muted-foreground border-l-4 border-transparent pl-3 text-lg font-semibold tracking-tight">
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
          <AssetGrid
            className={
              activeTab === 'location'
                ? 'sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2'
                : undefined
            }
          >
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

      {/* Edit Dialogs */}
      <Dialog
        open={!!editingAsset}
        onOpenChange={(open) => !open && setEditingAsset(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Edit{' '}
              {editingAsset?.type === 'voice'
                ? 'Voice Profile'
                : editingAsset?.type === 'location'
                  ? 'Location'
                  : 'Character'}
            </DialogTitle>
          </DialogHeader>

          {editingAsset?.type === 'character' && (
            <CharacterEditor
              projectId={projectId}
              character={editingAsset as CharacterWithDetails}
              onSuccess={handleEditSuccess}
              onCancel={() => setEditingAsset(null)}
            />
          )}

          {editingAsset?.type === 'location' && (
            <LocationEditor
              projectId={projectId}
              location={editingAsset}
              onSuccess={handleEditSuccess}
              onCancel={() => setEditingAsset(null)}
            />
          )}

          {editingAsset?.type === 'voice' && (
            <VoiceProfileEditor
              projectId={projectId}
              voiceProfile={editingAsset}
              onSuccess={handleEditSuccess}
              onCancel={() => setEditingAsset(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
