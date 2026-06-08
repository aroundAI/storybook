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
import { getSupabaseBrowserClient } from '@kit/supabase/browser-client';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
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
// Types
// ============================================================================

interface UnlinkedItem {
  name: string;
  type: 'character' | 'location';
  episodeIds: Set<string>;
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
  const [unlinkedCharacters, setUnlinkedCharacters] = useState<UnlinkedItem[]>(
    [],
  );
  const [unlinkedLocations, setUnlinkedLocations] = useState<UnlinkedItem[]>(
    [],
  );

  const selectedEpisodes = useMemo(
    () =>
      Array.from(state.episodes.values())
        .filter((ep) => ep.selected)
        .sort((a, b) => a.episodeNumber - b.episodeNumber),
    [state.episodes],
  );

  // ──────────────────────────────────────────────────────────────────────
  // Fetch unlinked assets from DB on mount
  // Reads screenplay_data.metadata.characters and .locations from episodes,
  // then checks which names don't exist in the assets table.
  // ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;

    async function fetchUnlinked() {
      try {
        const client = getSupabaseBrowserClient();
        const episodeIds = selectedEpisodes.map((ep) => ep.episodeId);

        if (episodeIds.length === 0) {
          setIsLoading(false);
          return;
        }

        // 1. Fetch screenplay_data for all selected episodes
        const { data: episodes } = await client
          .from('episodes')
          .select('id, screenplay_data')
          .in('id', episodeIds)
          .is('deleted_at', null);

        if (!active) return;

        // 2. Extract all character + location names from screenplay metadata
        const charMap = new Map<string, Set<string>>(); // lowercase name → episodeIds
        const locMap = new Map<string, Set<string>>();
        const charOrigName = new Map<string, string>(); // lowercase → original case
        const locOrigName = new Map<string, string>();

        for (const ep of episodes ?? []) {
          const spData = ep.screenplay_data as {
            metadata?: {
              characters?: string[];
              locations?: string[];
            };
            scenes?: Array<{
              location?: string;
              dialogue?: Array<{ character: string }>;
            }>;
          } | null;

          if (!spData) continue;

          // Get characters from metadata or extract from scenes
          const characters =
            spData.metadata?.characters ??
            Array.from(
              new Set(
                (spData.scenes ?? []).flatMap(
                  (s) => s.dialogue?.map((d) => d.character) ?? [],
                ),
              ),
            );

          // Get locations from metadata or extract from scenes
          const locations =
            spData.metadata?.locations ??
            Array.from(
              new Set(
                (spData.scenes ?? [])
                  .map((s) => s.location)
                  .filter(Boolean) as string[],
              ),
            );

          for (const name of characters) {
            const key = name.toLowerCase();
            if (!charMap.has(key)) {
              charMap.set(key, new Set());
              charOrigName.set(key, name);
            }
            charMap.get(key)!.add(ep.id);
          }

          for (const name of locations) {
            const key = name.toLowerCase();
            if (!locMap.has(key)) {
              locMap.set(key, new Set());
              locOrigName.set(key, name);
            }
            locMap.get(key)!.add(ep.id);
          }
        }

        // 3. Check which names already exist as assets in the project
        const allNames = [
          ...Array.from(charOrigName.values()),
          ...Array.from(locOrigName.values()),
        ];

        const linkedNames = new Set<string>();

        if (allNames.length > 0) {
          // Query in batches of 100 to avoid URL length limits
          const batchSize = 100;
          for (let i = 0; i < allNames.length; i += batchSize) {
            const batch = allNames.slice(i, i + batchSize);
            const { data: assets } = await client
              .from('assets')
              .select('name')
              .eq('project_id', projectId)
              .in('name', batch)
              .is('deleted_at', null);

            if (!active) return;

            for (const asset of assets ?? []) {
              linkedNames.add(asset.name.toLowerCase());
            }
          }
        }

        // 4. Filter to only unlinked
        const unlinkedChars: UnlinkedItem[] = [];
        for (const [key, episodeIds] of charMap) {
          if (!linkedNames.has(key)) {
            unlinkedChars.push({
              name: charOrigName.get(key) ?? key,
              type: 'character',
              episodeIds,
            });
          }
        }

        const unlinkedLocs: UnlinkedItem[] = [];
        for (const [key, episodeIds] of locMap) {
          if (!linkedNames.has(key)) {
            unlinkedLocs.push({
              name: locOrigName.get(key) ?? key,
              type: 'location',
              episodeIds,
            });
          }
        }

        // Sort by most referenced first
        unlinkedChars.sort((a, b) => b.episodeIds.size - a.episodeIds.size);
        unlinkedLocs.sort((a, b) => b.episodeIds.size - a.episodeIds.size);

        if (!active) return;

        setUnlinkedCharacters(unlinkedChars);
        setUnlinkedLocations(unlinkedLocs);

        // Also update reducer state for downstream phases
        for (const ep of selectedEpisodes) {
          const epCharNames = unlinkedChars
            .filter((c) => c.episodeIds.has(ep.episodeId))
            .map((c) => c.name);
          const epLocNames = unlinkedLocs
            .filter((l) => l.episodeIds.has(ep.episodeId))
            .map((l) => l.name);

          dispatch({
            type: 'SET_ASSETS',
            episodeId: ep.episodeId,
            characters: epCharNames,
            locations: epLocNames,
          });
        }
      } catch (err) {
        console.error('[AssetsPhase] Failed to fetch unlinked assets:', err);
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void fetchUnlinked();

    return () => {
      active = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalUnlinked = unlinkedCharacters.length + unlinkedLocations.length;

  // Auto-advance if no unlinked items (after loading completes)
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
      // Group by first episode that references each unlinked item
      const firstEpisodeId = selectedEpisodes[0]?.episodeId;
      if (!firstEpisodeId) return;

      const items = [
        ...unlinkedCharacters.map((c) => ({
          name: c.name,
          type: 'character' as const,
        })),
        ...unlinkedLocations.map((l) => ({
          name: l.name,
          type: 'location' as const,
        })),
      ];

      if (items.length === 0) return;

      await batchCreateUnlinkedAction({
        episodeId: firstEpisodeId,
        projectId,
        items,
        storyContext: selectedEpisodes[0]?.storyPreview ?? '',
      });

      // Mark all episodes as assets created
      for (const ep of selectedEpisodes) {
        dispatch({ type: 'SET_ASSETS_CREATED', episodeId: ep.episodeId });
      }

      // Clear local unlinked state
      setUnlinkedCharacters([]);
      setUnlinkedLocations([]);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create assets',
      );
    } finally {
      setIsCreating(false);
    }
  }, [selectedEpisodes, projectId, dispatch, unlinkedCharacters, unlinkedLocations]);

  // Check if all assets have been created
  const allAssetsCreated = totalUnlinked === 0 && !isLoading;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <p className="mt-3 text-sm text-white/50">
          Checking asset link status across {selectedEpisodes.length} episodes...
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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-white/10 px-6 py-4">
        <h3 className="text-sm font-semibold text-white/90">Unlinked Assets</h3>
        <p className="mt-1 text-xs text-white/50">
          {totalUnlinked} unique asset{totalUnlinked !== 1 ? 's' : ''} found
          across {selectedEpisodes.length} episode
          {selectedEpisodes.length !== 1 ? 's' : ''}. Create them in your
          project library for visual consistency.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 px-6 py-4">
          {/* Characters section */}
          {unlinkedCharacters.length > 0 && (
            <div>
              <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-white/50 uppercase">
                <Users className="h-3.5 w-3.5" />
                Characters
                <Badge className="ml-1 rounded-full border-0 bg-blue-500/20 px-1.5 py-0 text-[10px] text-blue-400">
                  {unlinkedCharacters.length}
                </Badge>
              </h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {unlinkedCharacters.map((char) => (
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
                        {char.episodeIds.size} ep
                        {char.episodeIds.size !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Locations section */}
          {unlinkedLocations.length > 0 && (
            <div>
              <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-white/50 uppercase">
                <MapPin className="h-3.5 w-3.5" />
                Locations
                <Badge className="ml-1 rounded-full border-0 bg-cyan-500/20 px-1.5 py-0 text-[10px] text-cyan-400">
                  {unlinkedLocations.length}
                </Badge>
              </h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {unlinkedLocations.map((loc) => (
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
                        {loc.episodeIds.size} ep
                        {loc.episodeIds.size !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {createError && (
        <div className="mx-6 mb-2 rounded-lg bg-red-500/10 px-4 py-2 text-xs text-red-400">
          {createError}
        </div>
      )}

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-white/10 px-6 py-4">
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
                    Create All ({totalUnlinked})
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
