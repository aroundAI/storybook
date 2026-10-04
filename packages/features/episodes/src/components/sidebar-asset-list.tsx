'use client';

import { useEffect, useState, useTransition } from 'react';

import { MapPin, Plus, Sparkles, User, Users } from 'lucide-react';

import { createAssetAction } from '@kit/assets/mutations';
import { useAssetLinkStatus } from '@kit/episodes/hooks';
import {
  batchCreateUnlinkedAction,
  extractDescriptionAction,
  linkAssetToEpisodeAction,
} from '@kit/episodes/server';
import { refusalMessage, unwrap } from '@kit/next/action-result';
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
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

/* ─────────────────── Types ─────────────────── */

interface SidebarCharacter {
  name: string;
  role?: string;
  arc?: string;
}

interface SidebarAssetListProps {
  characters: SidebarCharacter[];
  locations: Array<{ name: string }>;
  projectId: string;
  episodeId: string;
  storyContext: string;
  onAssetCreated?: () => void;
}

/* ─────────────────── SidebarAssetList ─────────────────── */

export function SidebarAssetList({
  characters,
  locations,
  projectId,
  episodeId,
  storyContext,
  onAssetCreated,
}: SidebarAssetListProps) {
  const allNames = [
    ...characters.map((c) => c.name),
    ...locations.map((l) => l.name),
  ];

  const { linkedAssets, isLoading, refetch } = useAssetLinkStatus(
    projectId,
    allNames,
  );

  const [createDialog, setCreateDialog] = useState<{
    open: boolean;
    name: string;
    type: 'character' | 'location';
    role?: string;
    arc?: string;
  }>({ open: false, name: '', type: 'character' });

  const [isBatchPending, startBatchTransition] = useTransition();

  // Calculate unlinked items
  const unlinkedItems = [
    ...characters
      .filter((c) => !linkedAssets.has(c.name.toLowerCase()))
      .map((c) => ({
        name: c.name,
        type: 'character' as const,
        role: c.role,
        arc: c.arc,
      })),
    ...locations
      .filter((l) => !linkedAssets.has(l.name.toLowerCase()))
      .map((l) => ({
        name: l.name,
        type: 'location' as const,
      })),
  ];

  const handleCreateSingle = (item: {
    name: string;
    type: 'character' | 'location';
    role?: string;
    arc?: string;
  }) => {
    setCreateDialog({ open: true, ...item });
  };

  const handleBatchCreate = () => {
    if (unlinkedItems.length === 0) return;

    startBatchTransition(async () => {
      try {
        const result = await unwrap(
          batchCreateUnlinkedAction({
            projectId,
            episodeId,
            items: unlinkedItems,
            storyContext,
          }),
        );

        if (result.success) {
          const parts: string[] = [];
          if (result.data.created > 0) {
            parts.push(
              `Created ${result.data.created} asset${result.data.created !== 1 ? 's' : ''}`,
            );
          }
          const linked = (result.data as { linked?: number }).linked ?? 0;
          if (linked > 0) {
            parts.push(`Linked ${linked} existing`);
          }
          toast.success(
            parts.length > 0 ? parts.join(', ') : 'All assets are up to date',
          );
          refetch();
          onAssetCreated?.();
        }
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to create assets'));
      }
    });
  };

  const handleAssetCreated = () => {
    setCreateDialog((prev) => ({ ...prev, open: false }));
    refetch();
    onAssetCreated?.();
  };

  return (
    <>
      {/* Characters section */}
      {characters.length > 0 && (
        <div className="rounded-xl bg-card/80 p-4 shadow-sm backdrop-blur-sm">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <Users className="h-4 w-4" />
            Characters
          </h3>
          <div className="space-y-2">
            {characters.map((character, i) => {
              const linked = linkedAssets.get(character.name.toLowerCase());
              return (
                <SidebarAssetItem
                  key={`char-${character.name}-${i}`}
                  name={character.name}
                  type="character"
                  role={character.role}
                  isLinked={!!linked}
                  thumbnailUrl={linked?.thumbnailUrl ?? null}
                  isLoading={isLoading}
                  onCreateClick={() =>
                    handleCreateSingle({
                      name: character.name,
                      type: 'character',
                      role: character.role,
                      arc: character.arc,
                    })
                  }
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Locations section */}
      {locations.length > 0 && (
        <div className="rounded-xl bg-card/80 p-4 shadow-sm backdrop-blur-sm">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <MapPin className="h-4 w-4" />
            Locations
          </h3>
          <div className="space-y-2">
            {locations.map((location, i) => {
              const linked = linkedAssets.get(location.name.toLowerCase());
              return (
                <SidebarAssetItem
                  key={`loc-${location.name}-${i}`}
                  name={location.name}
                  type="location"
                  isLinked={!!linked}
                  thumbnailUrl={linked?.thumbnailUrl ?? null}
                  isLoading={isLoading}
                  onCreateClick={() =>
                    handleCreateSingle({
                      name: location.name,
                      type: 'location',
                    })
                  }
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Batch create button */}
      {!isLoading && unlinkedItems.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleBatchCreate}
          disabled={isBatchPending}
          className="w-full gap-2 border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {isBatchPending
            ? 'Creating...'
            : `Create All Unlinked (${unlinkedItems.length})`}
        </Button>
      )}

      {/* Create Asset Dialog */}
      <CreateAssetDialog
        open={createDialog.open}
        onOpenChange={(open) => setCreateDialog((prev) => ({ ...prev, open }))}
        name={createDialog.name}
        type={createDialog.type}
        role={createDialog.role}
        arc={createDialog.arc}
        projectId={projectId}
        episodeId={episodeId}
        storyContext={storyContext}
        onCreated={handleAssetCreated}
      />
    </>
  );
}

/* ─────────────────── SidebarAssetItem ─────────────────── */

interface SidebarAssetItemProps {
  name: string;
  type: 'character' | 'location';
  role?: string;
  isLinked: boolean;
  thumbnailUrl: string | null;
  isLoading: boolean;
  onCreateClick: () => void;
}

function SidebarAssetItem({
  name,
  type,
  role,
  isLinked,
  thumbnailUrl,
  isLoading,
  onCreateClick,
}: SidebarAssetItemProps) {
  const Icon = type === 'character' ? User : MapPin;

  return (
    <div className="group flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
      {/* Link indicator */}
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full transition-colors',
          isLoading
            ? 'animate-pulse bg-gray-300 dark:bg-gray-600'
            : isLinked
              ? 'bg-emerald-400'
              : 'bg-gray-400/40 dark:bg-gray-600/50',
        )}
        title={isLinked ? 'Linked to library' : 'Not in library'}
      />

      {/* Avatar / Icon */}
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt={name}
          className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-gray-200 dark:ring-gray-600"
        />
      ) : type === 'character' ? (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
          <Icon className="h-3 w-3 text-blue-600 dark:text-blue-300" />
        </div>
      ) : (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-100 dark:bg-cyan-900">
          <Icon className="h-3 w-3 text-cyan-600 dark:text-cyan-300" />
        </div>
      )}

      {/* Name + role */}
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {name}
        </span>
        {role && (
          <span
            className={cn(
              'ml-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-medium',
              role === 'protagonist'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                : role === 'antagonist'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                  : 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
            )}
          >
            {role}
          </span>
        )}
      </div>

      {/* Add button (unlinked only) */}
      {!isLinked && !isLoading && (
        <button
          type="button"
          onClick={onCreateClick}
          className="rounded p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-100 hover:text-emerald-600 dark:hover:bg-gray-700 dark:hover:text-emerald-400"
          title="Create in library"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ─────────────────── CreateAssetDialog ─────────────────── */

interface CreateAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  type: 'character' | 'location';
  role?: string;
  arc?: string;
  projectId: string;
  episodeId: string;
  storyContext: string;
  onCreated: (assetId: string) => void;
}

function CreateAssetDialog({
  open,
  onOpenChange,
  name,
  type,
  role,
  arc,
  projectId,
  episodeId,
  storyContext,
  onCreated,
}: CreateAssetDialogProps) {
  const [description, setDescription] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isCreating, startCreating] = useTransition();
  const [hasExtracted, setHasExtracted] = useState(false);

  // Radix calls onOpenChange only for the dialog's own interactions, never
  // when the parent sets `open`, so the extraction on open has to follow the
  // prop.
  useEffect(() => {
    if (open) void extractDescription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setDescription('');
      setHasExtracted(false);
    }
    onOpenChange(nextOpen);
  };

  const extractDescription = async () => {
    setIsExtracting(true);
    try {
      const result = await extractDescriptionAction({
        name,
        type,
        role,
        arc,
        storyContext,
      });
      if (result.success && result.data.description) {
        setDescription(result.data.description);
      }
      setHasExtracted(true);
    } catch {
      // LLM failed — leave textarea empty for manual input
    } finally {
      setIsExtracting(false);
    }
  };

  const handleCreate = () => {
    startCreating(async () => {
      try {
        const result = await unwrap(
          createAssetAction({
            projectId,
            episodeId,
            type,
            name,
            description:
              description ||
              `${type === 'character' ? 'Character' : 'Location'} from story`,
            metadata: role
              ? { role, autoCreated: true }
              : { autoCreated: true },
          }),
        );

        if (result.success) {
          // Link to episode
          await unwrap(
            linkAssetToEpisodeAction({
              episodeId,
              assetId: result.data.id,
            }),
          );

          toast.success(`${name} added to library`);
          onCreated(result.data.id);
        }
      } catch (error) {
        toast.error(refusalMessage(error, `Failed to create ${name}`));
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {type === 'character' ? (
              <User className="h-4 w-4 text-blue-500" />
            ) : (
              <MapPin className="h-4 w-4 text-cyan-500" />
            )}
            Create {type === 'character' ? 'Character' : 'Location'}: &quot;
            {name}&quot;
          </AlertDialogTitle>
          <AlertDialogDescription>
            Add this {type} to your project library for reuse across episodes.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-2">
          {/* Description textarea */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              Description
            </label>
            {isExtracting ? (
              <div className="flex h-24 items-center justify-center rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                  Extracting from story...
                </div>
              </div>
            ) : (
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={`Describe this ${type}...`}
                rows={4}
                className="resize-none text-xs"
              />
            )}
          </div>

          {/* Role badge (characters only) */}
          {role && (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>Role:</span>
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                {role}
              </span>
            </div>
          )}

          {/* Regenerate button */}
          {hasExtracted && !isExtracting && (
            <button
              type="button"
              onClick={() => {
                setHasExtracted(false);
                void extractDescription();
              }}
              className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
            >
              <Sparkles className="h-3 w-3" />
              Regenerate description
            </button>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCreating}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleCreate}
            disabled={isCreating || isExtracting}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {isCreating ? 'Creating...' : 'Create in Library'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
