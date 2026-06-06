'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { CheckSquare, Trash2, X } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { toast } from '@kit/ui/sonner';

import { useAssets } from '../hooks/use-assets';
import { useCharacterAssets } from '../hooks/use-character-assets';
import { useCharacterFilters } from '../hooks/use-character-filters';
import {
  bulkDeleteAssetsAction,
  checkAssetsInUseAction,
} from '../lib/server/asset.mutations';
import { getCharacterAction } from '../lib/server/character.mutations';
import type { Asset, CharacterWithDetails } from '../lib/types';
import { AssetCard } from './asset-card';
import { AssetFilterToolbar } from './asset-filter-toolbar';
import { AssetGrid } from './asset-grid';
import { AssetSearchBar } from './asset-search-bar';
import { AssetTabs } from './asset-tabs';
import { CharacterEditor } from './character-editor';
import { EmptyAssetState } from './empty-asset-state';
import { LocationEditor } from './location-editor';

type TabType = 'character' | 'location';

const MAIN_ROLES = ['protagonist', 'deuteragonist'] as const;
const SUPPORTING_ROLES = ['supporting', 'narrator'] as const;

interface AssetGalleryProps {
  projectId: string;
  accountId: string;
  initialTab?: TabType;
  initialCharacters?: {
    characters: CharacterWithDetails[];
    total: number;
    hasMore: boolean;
  };
  onAssetSelect?: (asset: Asset) => void;
  onCreateAsset?: (type: TabType) => void;
}

export function AssetGallery({
  projectId,
  accountId,
  initialTab = 'character',
  initialCharacters,
  onAssetSelect,
  onCreateAsset,
}: AssetGalleryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Use refs for values needed in callbacks to avoid dependency instability
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const activeTab = (searchParams?.get('tab') as TabType) ?? initialTab;

  const [locationSearchQuery, setLocationSearchQuery] = useState('');
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);

  // Bulk selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [inUseWarning, setInUseWarning] = useState<{
    inUseAssets: Array<{ id: string; name: string; usedBy: string[] }>;
    safeToDelete: string[];
  } | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  // Character data (with details — voice, image, role, etc.)
  const {
    characters,
    total: characterTotal,
    isLoading: isCharacterLoading,
    deleteCharacter,
    fetchCharacters,
  } = useCharacterAssets({ projectId, initialData: initialCharacters });

  // Character filters
  const {
    filters,
    setFilter,
    toggleRole,
    clearFilters,
    activeFilterCount,
    filteredCharacters,
  } = useCharacterFilters({ characters });

  // Location data (simple assets, no join needed)
  const {
    assets: locationAssets,
    isLoading: isLocationLoading,
    deleteAsset: deleteLocationAsset,
    fetchAssets: fetchLocationAssets,
  } = useAssets({
    projectId,
    type: 'location',
  });

  // Ref for fetchLocationAssets to avoid effect dependency instability
  const fetchLocationAssetsRef = useRef(fetchLocationAssets);
  fetchLocationAssetsRef.current = fetchLocationAssets;

  // Load location data when switching to location tab
  useEffect(() => {
    if (activeTab === 'location') {
      void fetchLocationAssetsRef.current();
    }
  }, [activeTab]);

  // Filter location assets by search
  const filteredLocationAssets = useMemo(() => {
    if (!locationSearchQuery) return locationAssets;
    const query = locationSearchQuery.toLowerCase();
    return locationAssets.filter(
      (asset) =>
        asset.name.toLowerCase().includes(query) ||
        asset.description?.toLowerCase().includes(query),
    );
  }, [locationAssets, locationSearchQuery]);

  // Tab change: uses ref for searchParams to keep callback stable
  const handleTabChange = useCallback(
    (tab: TabType) => {
      const params = new URLSearchParams(
        searchParamsRef.current?.toString() ?? '',
      );
      params.set('tab', tab);
      router.replace(`${pathname}?${params.toString()}`);
      setLocationSearchQuery('');
      clearFilters();
    },
    [pathname, router, clearFilters],
  );

  const handleDelete = useCallback(
    async (asset: Asset) => {
      if (activeTab === 'character') {
        await deleteCharacter(asset.id);
      } else {
        await deleteLocationAsset(asset.id);
      }
    },
    [activeTab, deleteCharacter, deleteLocationAsset],
  );

  // Bulk selection handlers
  const handleToggleSelect = useCallback((asset: Asset) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(asset.id)) {
        next.delete(asset.id);
      } else {
        next.add(asset.id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const assets =
      activeTab === 'character' ? filteredCharacters : filteredLocationAssets;
    setSelectedIds(new Set(assets.map((a) => a.id)));
  }, [activeTab, filteredCharacters, filteredLocationAssets]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleExitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBulkDeleteClick = useCallback(async () => {
    if (selectedIds.size === 0) return;

    try {
      const result = await checkAssetsInUseAction({
        projectId,
        assetIds: Array.from(selectedIds),
      });

      if (result?.data?.inUseAssets && result.data.inUseAssets.length > 0) {
        setInUseWarning(result.data);
      } else {
        setBulkDeleteDialogOpen(true);
      }
    } catch {
      setBulkDeleteDialogOpen(true);
    }
  }, [selectedIds, projectId]);

  const handleConfirmBulkDelete = useCallback(
    (idsToDelete?: string[]) => {
      const ids = idsToDelete ?? Array.from(selectedIds);
      if (ids.length === 0) return;

      startDeleteTransition(async () => {
        try {
          const result = await bulkDeleteAssetsAction({
            projectId,
            assetIds: ids,
          });

          if (result?.data) {
            toast.success(
              `Deleted ${result.data.deletedCount} ${activeTab === 'character' ? 'characters' : 'locations'}`,
            );
            handleExitSelectionMode();
            setBulkDeleteDialogOpen(false);
            setInUseWarning(null);
            router.refresh();
            if (activeTab === 'character') {
              void fetchCharacters();
            } else {
              void fetchLocationAssetsRef.current();
            }
          }
        } catch (err) {
          toast.error(
            `Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      });
    },
    [
      selectedIds,
      projectId,
      activeTab,
      handleExitSelectionMode,
      router,
      fetchCharacters,
    ],
  );

  const handleEdit = useCallback(
    async (asset: Asset) => {
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
        setEditingAsset(asset);
      }
      onAssetSelect?.(asset);
    },
    [onAssetSelect],
  );

  const handleEditSuccess = useCallback(() => {
    setEditingAsset(null);
    router.refresh();
    if (activeTab === 'character') {
      void fetchCharacters();
    } else {
      void fetchLocationAssetsRef.current();
    }
  }, [router, activeTab, fetchCharacters]);

  const handleCreate = useCallback(() => {
    onCreateAsset?.(activeTab);
  }, [activeTab, onCreateAsset]);

  // Memoize filter callbacks to avoid creating new functions on every render
  const handleSearchChange = useCallback(
    (value: string) => setFilter('search', value),
    [setFilter],
  );
  const handleVoiceStatusChange = useCallback(
    (status: 'all' | 'has-voice' | 'no-voice') =>
      setFilter('voiceStatus', status),
    [setFilter],
  );
  const handleImageStatusChange = useCallback(
    (status: 'all' | 'has-image' | 'no-image') =>
      setFilter('imageStatus', status),
    [setFilter],
  );
  const handleElementPromptStatusChange = useCallback(
    (status: 'all' | 'has-prompt' | 'no-prompt') =>
      setFilter('elementPromptStatus', status),
    [setFilter],
  );
  const handleSortChange = useCallback(
    (
      sort:
        | 'name-asc'
        | 'name-desc'
        | 'role-priority'
        | 'created-desc'
        | 'updated-desc',
    ) => setFilter('sortBy', sort),
    [setFilter],
  );

  const renderCharacterGroups = () => {
    const isMain = (c: CharacterWithDetails) =>
      MAIN_ROLES.includes(c.role as (typeof MAIN_ROLES)[number]);
    const isSupporting = (c: CharacterWithDetails) =>
      SUPPORTING_ROLES.includes(c.role as (typeof SUPPORTING_ROLES)[number]);
    const isOther = (c: CharacterWithDetails) => !isMain(c) && !isSupporting(c);

    const mainCast = filteredCharacters.filter(isMain);
    const supportingCast = filteredCharacters.filter(isSupporting);
    const others = filteredCharacters.filter(isOther);
    const hasCreatures = others.some((c) => c.role === 'creature');

    return (
      <div className="space-y-12">
        {mainCast.length > 0 && (
          <div className="space-y-4">
            <h3 className="border-l-4 border-orange-500 pl-3 text-xl font-bold tracking-tight text-orange-900/70 dark:text-orange-100/70">
              Main Cast
            </h3>
            <AssetGrid>
              {mainCast.map((character) => (
                <AssetCard
                  key={character.id}
                  asset={character}
                  characterDetails={character}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(character.id)}
                  onToggleSelect={handleToggleSelect}
                />
              ))}
            </AssetGrid>
          </div>
        )}

        {supportingCast.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-muted-foreground border-l-4 border-transparent pl-3 text-lg font-semibold tracking-tight">
              Supporting Cast
            </h3>
            <AssetGrid>
              {supportingCast.map((character) => (
                <AssetCard
                  key={character.id}
                  asset={character}
                  characterDetails={character}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(character.id)}
                  onToggleSelect={handleToggleSelect}
                />
              ))}
            </AssetGrid>
          </div>
        )}

        {others.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-muted-foreground border-l-4 border-transparent pl-3 text-lg font-semibold tracking-tight">
              {hasCreatures ? 'Creatures & Others' : 'Other Characters'}
            </h3>
            <AssetGrid>
              {others.map((character) => (
                <AssetCard
                  key={character.id}
                  asset={character}
                  characterDetails={character}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(character.id)}
                  onToggleSelect={handleToggleSelect}
                />
              ))}
            </AssetGrid>
          </div>
        )}
      </div>
    );
  };

  const isLoading =
    activeTab === 'character' ? isCharacterLoading : isLocationLoading;

  const currentAssets =
    activeTab === 'character' ? filteredCharacters : filteredLocationAssets;

  const hasActiveFilters =
    activeTab === 'character' ? activeFilterCount > 0 : !!locationSearchQuery;

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <AssetTabs activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Bulk Selection Toolbar */}
      {selectionMode ? (
        <div className="flex items-center justify-between rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {selectedIds.size} selected
            </span>
            <Button variant="ghost" size="sm" onClick={handleSelectAll}>
              Select All
            </Button>
            {selectedIds.size > 0 && (
              <Button variant="ghost" size="sm" onClick={handleDeselectAll}>
                Deselect All
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDeleteClick}
                disabled={isDeleting}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Selected ({selectedIds.size})
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleExitSelectionMode}>
              <X className="mr-1 h-4 w-4" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex-1">
            {/* Search / Filter Bar */}
            {activeTab === 'character' ? (
              <AssetFilterToolbar
                filters={filters}
                activeFilterCount={activeFilterCount}
                resultCount={filteredCharacters.length}
                totalCount={characterTotal}
                onSearchChange={handleSearchChange}
                onRoleToggle={toggleRole}
                onVoiceStatusChange={handleVoiceStatusChange}
                onImageStatusChange={handleImageStatusChange}
                onElementPromptStatusChange={handleElementPromptStatusChange}
                onSortChange={handleSortChange}
                onClearFilters={clearFilters}
              />
            ) : (
              <AssetSearchBar
                value={locationSearchQuery}
                onChange={setLocationSearchQuery}
              />
            )}
          </div>
          {currentAssets.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectionMode(true)}
              className="ml-3 shrink-0"
            >
              <CheckSquare className="mr-2 h-4 w-4" />
              Select
            </Button>
          )}
        </div>
      )}

      {/* Grid or Empty State */}
      {isLoading ? (
        <AssetGrid isLoading={true}>{null}</AssetGrid>
      ) : currentAssets.length > 0 ? (
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
            {filteredLocationAssets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onEdit={handleEdit}
                onDelete={handleDelete}
                selectionMode={selectionMode}
                isSelected={selectedIds.has(asset.id)}
                onToggleSelect={handleToggleSelect}
              />
            ))}
          </AssetGrid>
        )
      ) : hasActiveFilters ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">
            No characters match the current filters
          </p>
          {activeTab === 'character' && (
            <button
              onClick={clearFilters}
              className="text-primary mt-2 text-sm underline underline-offset-4"
            >
              Clear all filters
            </button>
          )}
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
              {editingAsset?.type === 'location' ? 'Location' : 'Character'}
            </DialogTitle>
          </DialogHeader>

          {editingAsset?.type === 'character' && (
            <CharacterEditor
              projectId={projectId}
              accountId={accountId}
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
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size}{' '}
              {activeTab === 'character' ? 'Characters' : 'Locations'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected{' '}
              {activeTab === 'character' ? 'characters' : 'locations'}. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleConfirmBulkDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : `Delete ${selectedIds.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* In-Use Warning Dialog */}
      <AlertDialog
        open={!!inUseWarning}
        onOpenChange={(open) => !open && setInUseWarning(null)}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Some assets are in use</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  The following{' '}
                  {activeTab === 'character' ? 'characters' : 'locations'} are
                  referenced by dialogue lines or episodes:
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {inUseWarning?.inUseAssets.map((a) => (
                    <li key={a.id}>
                      <strong>{a.name}</strong>
                      {a.usedBy.length > 0 && (
                        <span className="text-muted-foreground">
                          {' '}
                          — {a.usedBy.join(', ')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {inUseWarning?.safeToDelete &&
                  inUseWarning.safeToDelete.length > 0 && (
                    <p className="text-sm">
                      {inUseWarning.safeToDelete.length} other{' '}
                      {activeTab === 'character' ? 'characters' : 'locations'}{' '}
                      can be safely deleted.
                    </p>
                  )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {inUseWarning?.safeToDelete &&
              inUseWarning.safeToDelete.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() =>
                    handleConfirmBulkDelete(inUseWarning.safeToDelete)
                  }
                  disabled={isDeleting}
                >
                  Delete Safe Only ({inUseWarning.safeToDelete.length})
                </Button>
              )}
            <AlertDialogAction
              onClick={() => handleConfirmBulkDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete All Anyway'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
