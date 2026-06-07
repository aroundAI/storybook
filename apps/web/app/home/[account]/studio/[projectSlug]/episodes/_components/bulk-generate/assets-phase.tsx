'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  MapPin,
  SkipForward,
  Sparkles,
  User,
  Users,
} from 'lucide-react';

import { batchCreateUnlinkedAction } from '@kit/episodes/server';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { ScrollArea } from '@kit/ui/scroll-area';
import { cn } from '@kit/ui/utils';

import type { BulkAction, BulkState } from '../bulk-generate-modal';

// ============================================================================
// Props
// ============================================================================

interface AssetsPhaseProps {
  state: BulkState;
  dispatch: React.Dispatch<BulkAction>;
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function AssetsPhase({
  state,
  dispatch,
  projectId,
  onNext,
  onBack,
}: AssetsPhaseProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const selectedEpisodes = useMemo(
    () =>
      Array.from(state.episodes.values())
        .filter((ep) => ep.selected)
        .sort((a, b) => a.episodeNumber - b.episodeNumber),
    [state.episodes],
  );

  // Use episode state populated during prior phases (screenplay sets
  // unlinkedCharacters/unlinkedLocations). Mark loading complete on mount.
  useEffect(() => {
    let mounted = true;

    // Allow one tick for state to settle, then mark as loaded
    const timer = setTimeout(() => {
      if (mounted) {
        setIsLoading(false);
      }
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  // Aggregate unique characters and locations across episodes
  const { uniqueCharacters, uniqueLocations, totalUnlinked } = useMemo(() => {
    const charMap = new Map<string, Set<string>>();
    const locMap = new Map<string, Set<string>>();

    for (const ep of selectedEpisodes) {
      for (const name of ep.unlinkedCharacters) {
        const key = name.toLowerCase();
        if (!charMap.has(key)) charMap.set(key, new Set());
        charMap.get(key)!.add(ep.episodeId);
      }
      for (const name of ep.unlinkedLocations) {
        const key = name.toLowerCase();
        if (!locMap.has(key)) locMap.set(key, new Set());
        locMap.get(key)!.add(ep.episodeId);
      }
    }

    const characters = Array.from(charMap.entries())
      .map(([key, episodeIds]) => ({
        name: selectedEpisodes
          .flatMap((ep) => ep.unlinkedCharacters)
          .find((n) => n.toLowerCase() === key) ?? key,
        episodeCount: episodeIds.size,
      }))
      .sort((a, b) => b.episodeCount - a.episodeCount);

    const locations = Array.from(locMap.entries())
      .map(([key, episodeIds]) => ({
        name: selectedEpisodes
          .flatMap((ep) => ep.unlinkedLocations)
          .find((n) => n.toLowerCase() === key) ?? key,
        episodeCount: episodeIds.size,
      }))
      .sort((a, b) => b.episodeCount - a.episodeCount);

    return {
      uniqueCharacters: characters,
      uniqueLocations: locations,
      totalUnlinked: characters.length + locations.length,
    };
  }, [selectedEpisodes]);

  // Check if all episodes have assets created
  const allAssetsCreated = useMemo(
    () =>
      selectedEpisodes.every(
        (ep) =>
          ep.assetsCreated ||
          (ep.unlinkedCharacters.length === 0 &&
            ep.unlinkedLocations.length === 0),
      ),
    [selectedEpisodes],
  );

  // Auto-advance if no unlinked items
  useEffect(() => {
    if (!isLoading && totalUnlinked === 0) {
      const timer = setTimeout(onNext, 2000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, totalUnlinked, onNext]);

  // Create all unlinked assets
  const handleCreateAll = useCallback(async () => {
    setIsCreating(true);
    setCreateError(null);

    try {
      const episodesWithUnlinked = selectedEpisodes.filter(
        (ep) =>
          !ep.assetsCreated &&
          (ep.unlinkedCharacters.length > 0 ||
            ep.unlinkedLocations.length > 0),
      );

      for (const ep of episodesWithUnlinked) {
        const items = [
          ...ep.unlinkedCharacters.map((name) => ({
            name,
            type: 'character' as const,
          })),
          ...ep.unlinkedLocations.map((name) => ({
            name,
            type: 'location' as const,
          })),
        ];

        if (items.length === 0) continue;

        try {
          await batchCreateUnlinkedAction({
            episodeId: ep.episodeId,
            projectId,
            items,
            storyContext: ep.storyPreview ?? '',
          });

          dispatch({ type: 'SET_ASSETS_CREATED', episodeId: ep.episodeId });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to create assets';
          dispatch({
            type: 'SET_EPISODE_ERROR',
            episodeId: ep.episodeId,
            error: message,
          });
        }
      }
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create assets',
      );
    } finally {
      setIsCreating(false);
    }
  }, [selectedEpisodes, projectId, dispatch]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <p className="mt-3 text-sm text-white/50">
          Checking asset link status...
        </p>
      </div>
    );
  }

  // No unlinked items — auto-advancing
  if (totalUnlinked === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <CheckCircle2 className="h-10 w-10 text-emerald-400" />
        <p className="mt-3 text-sm font-medium text-white/70">
          All assets already linked — skipping
        </p>
        <p className="mt-1 text-xs text-white/40">
          Advancing to shot generation...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4">
        <h3 className="text-sm font-semibold text-white/90">
          Unlinked Assets
        </h3>
        <p className="mt-1 text-xs text-white/50">
          {totalUnlinked} unique asset{totalUnlinked !== 1 ? 's' : ''} found
          across {selectedEpisodes.length} episode
          {selectedEpisodes.length !== 1 ? 's' : ''}. Create them in your
          project library for visual consistency.
        </p>
      </div>

      <ScrollArea className="max-h-[45vh]">
        <div className="space-y-6 px-6 py-4">
          {/* Characters section */}
          {uniqueCharacters.length > 0 && (
            <div>
              <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/50">
                <Users className="h-3.5 w-3.5" />
                Characters
                <Badge className="ml-1 rounded-full border-0 bg-blue-500/20 px-1.5 py-0 text-[10px] text-blue-400">
                  {uniqueCharacters.length}
                </Badge>
              </h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {uniqueCharacters.map((char) => (
                  <div
                    key={char.name}
                    className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/10">
                      <User className="h-3 w-3 text-blue-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-white/80">
                        {char.name}
                      </p>
                      <p className="text-[10px] text-white/40">
                        {char.episodeCount} ep
                        {char.episodeCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Locations section */}
          {uniqueLocations.length > 0 && (
            <div>
              <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/50">
                <MapPin className="h-3.5 w-3.5" />
                Locations
                <Badge className="ml-1 rounded-full border-0 bg-cyan-500/20 px-1.5 py-0 text-[10px] text-cyan-400">
                  {uniqueLocations.length}
                </Badge>
              </h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {uniqueLocations.map((loc) => (
                  <div
                    key={loc.name}
                    className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/10">
                      <MapPin className="h-3 w-3 text-cyan-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-white/80">
                        {loc.name}
                      </p>
                      <p className="text-[10px] text-white/40">
                        {loc.episodeCount} ep
                        {loc.episodeCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Error */}
      {createError && (
        <div className="mx-6 mb-2 rounded-lg bg-red-500/10 px-4 py-2 text-xs text-red-400">
          {createError}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={isCreating}
          className="gap-1.5 text-white/60 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>

        <div className="flex items-center gap-2">
          {!allAssetsCreated && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onNext}
                disabled={isCreating}
                className="gap-1.5 text-white/50 hover:text-white"
              >
                <SkipForward className="h-3.5 w-3.5" />
                Skip
              </Button>

              <Button
                size="sm"
                onClick={handleCreateAll}
                disabled={isCreating}
                className={cn(
                  'gap-2',
                  isCreating
                    ? 'bg-blue-600/50 text-white/70'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500',
                )}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Create All Unlinked Assets
                  </>
                )}
              </Button>
            </>
          )}

          {allAssetsCreated && (
            <Button
              size="sm"
              onClick={onNext}
              className="gap-2 bg-blue-600 text-white hover:bg-blue-500"
            >
              Next: Shots
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
