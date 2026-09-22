'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  MapPin,
  RefreshCw,
  SkipForward,
  Sparkles,
  User,
  Users,
  XCircle,
} from 'lucide-react';

import { batchCreateAssetsAction } from '@kit/episodes/server';
import { refusalMessage } from '@kit/next/action-result';
import { getSupabaseBrowserClient } from '@kit/supabase/browser-client';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { useBulkLlmJobs } from '@kit/ui/hooks';
import { cn } from '@kit/ui/utils';

import type {
  BulkAction,
  BulkState,
  EpisodeBulkState,
} from '../bulk-generate-modal';

// ============================================================================
// Types
// ============================================================================

interface AssetCreationResult {
  success: boolean;
  data: {
    episodeId: string;
    created: number;
    linked: number;
    skipped: number;
    characters: string[];
    locations: string[];
  };
}

interface UnlinkedSummary {
  characters: Map<string, Set<string>>; // lowercase name → episodeIds
  locations: Map<string, Set<string>>;
  charOrigNames: Map<string, string>;
  locOrigNames: Map<string, string>;
}

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
  const [unlinkedSummary, setUnlinkedSummary] = useState<UnlinkedSummary>({
    characters: new Map(),
    locations: new Map(),
    charOrigNames: new Map(),
    locOrigNames: new Map(),
  });
  const [hasStarted, setHasStarted] = useState(false);
  const processedRef = useRef<Set<string>>(new Set());

  const { jobs, registerEpisodes, markPending, completedCount, totalCount } =
    useBulkLlmJobs<AssetCreationResult>('asset-creation');

  const selectedEpisodes = useMemo(
    () =>
      Array.from(state.episodes.values())
        .filter((ep) => ep.selected)
        .sort((a, b) => a.episodeNumber - b.episodeNumber),
    [state.episodes],
  );

  // Episodes that need asset creation (have screenplay data)
  const eligibleEpisodes = useMemo(
    () =>
      selectedEpisodes.filter(
        (ep) =>
          ep.screenplayStatus === 'done' ||
          ep.screenplayStatus === 'skipped' ||
          ep.screenplayPreview,
      ),
    [selectedEpisodes],
  );

  // ──────────────────────────────────────────────────────────────────────
  // Fetch unlinked assets from DB on mount
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

        const { data: episodes } = await client
          .from('episodes')
          .select('id, screenplay_data')
          .in('id', episodeIds)
          .is('deleted_at', null);

        if (!active) return;

        const charMap = new Map<string, Set<string>>();
        const locMap = new Map<string, Set<string>>();
        const charOrigName = new Map<string, string>();
        const locOrigName = new Map<string, string>();

        for (const ep of episodes ?? []) {
          const spData = ep.screenplay_data as {
            metadata?: { characters?: string[]; locations?: string[] };
            scenes?: Array<{
              location?: string;
              dialogue?: Array<{ character: string }>;
            }>;
          } | null;

          if (!spData) continue;

          const characters =
            spData.metadata?.characters ??
            Array.from(
              new Set(
                (spData.scenes ?? []).flatMap(
                  (s) => s.dialogue?.map((d) => d.character) ?? [],
                ),
              ),
            );

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

        // Check which names already exist as assets
        const allNames = [
          ...Array.from(charOrigName.values()),
          ...Array.from(locOrigName.values()),
        ];

        const linkedNames = new Set<string>();

        if (allNames.length > 0) {
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

        // Remove already-linked from maps
        for (const key of linkedNames) {
          charMap.delete(key);
          charOrigName.delete(key);
          locMap.delete(key);
          locOrigName.delete(key);
        }

        if (!active) return;

        setUnlinkedSummary({
          characters: charMap,
          locations: locMap,
          charOrigNames: charOrigName,
          locOrigNames: locOrigName,
        });
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

  const totalUnlinkedChars = unlinkedSummary.characters.size;
  const totalUnlinkedLocs = unlinkedSummary.locations.size;
  const totalUnlinked = totalUnlinkedChars + totalUnlinkedLocs;

  // Sorted arrays for display
  const sortedCharacters = useMemo(
    () =>
      Array.from(unlinkedSummary.characters.entries())
        .map(([key, epIds]) => ({
          name: unlinkedSummary.charOrigNames.get(key) ?? key,
          episodeCount: epIds.size,
        }))
        .sort((a, b) => b.episodeCount - a.episodeCount),
    [unlinkedSummary],
  );

  const sortedLocations = useMemo(
    () =>
      Array.from(unlinkedSummary.locations.entries())
        .map(([key, epIds]) => ({
          name: unlinkedSummary.locOrigNames.get(key) ?? key,
          episodeCount: epIds.size,
        }))
        .sort((a, b) => b.episodeCount - a.episodeCount),
    [unlinkedSummary],
  );

  // Auto-advance if no unlinked items
  useEffect(() => {
    if (!isLoading && totalUnlinked === 0 && !hasStarted) {
      const timer = setTimeout(onNext, 2000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, totalUnlinked, onNext, hasStarted]);

  // ──────────────────────────────────────────────────────────────────────
  // Process WebSocket results
  // ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasStarted) return;

    for (const [episodeId, job] of jobs) {
      if (processedRef.current.has(episodeId)) continue;

      if (job.status === 'success' && job.result) {
        processedRef.current.add(episodeId);
        dispatch({ type: 'SET_ASSETS_CREATED', episodeId });
      } else if (job.status === 'error') {
        processedRef.current.add(episodeId);
        dispatch({
          type: 'SET_EPISODE_ERROR',
          episodeId,
          error: job.error ?? 'Asset creation failed',
        });
      }
    }
  }, [jobs, hasStarted, dispatch]);

  // ──────────────────────────────────────────────────────────────────────
  // Start asset creation
  // ──────────────────────────────────────────────────────────────────────
  const handleCreateAll = useCallback(async () => {
    if (eligibleEpisodes.length === 0) return;

    setHasStarted(true);

    // Register all episodes for WebSocket tracking
    const episodeIds = eligibleEpisodes.map((ep) => ep.episodeId);
    registerEpisodes(episodeIds);

    // Mark all as pending
    for (const id of episodeIds) {
      markPending(id);
    }

    try {
      const result = await batchCreateAssetsAction({
        projectId,
        episodes: eligibleEpisodes.map((ep) => ({
          episodeId: ep.episodeId,
        })),
      });

      if (!result.success) {
        throw new Error('Batch asset creation failed');
      }

      // Mark failed episodes
      for (const fail of result.failed) {
        dispatch({
          type: 'SET_EPISODE_ERROR',
          episodeId: fail.episodeId,
          error: fail.error,
        });
      }
    } catch (err) {
      const message = refusalMessage(err, 'Batch asset creation failed');
      for (const ep of eligibleEpisodes) {
        dispatch({
          type: 'SET_EPISODE_ERROR',
          episodeId: ep.episodeId,
          error: message,
        });
      }
    }
  }, [eligibleEpisodes, projectId, dispatch, registerEpisodes, markPending]);

  // Retry failed episodes
  const handleRetryFailed = useCallback(() => {
    const failedEps = eligibleEpisodes.filter((ep) => {
      const job = jobs.get(ep.episodeId);
      return job?.status === 'error';
    });

    if (failedEps.length === 0) return;

    for (const ep of failedEps) {
      processedRef.current.delete(ep.episodeId);
    }

    registerEpisodes(failedEps.map((ep) => ep.episodeId));
    for (const ep of failedEps) {
      markPending(ep.episodeId);
    }

    void batchCreateAssetsAction({
      projectId,
      episodes: failedEps.map((ep) => ({ episodeId: ep.episodeId })),
    });
  }, [eligibleEpisodes, jobs, projectId, registerEpisodes, markPending]);

  // Status counts
  const successCount = Array.from(jobs.values()).filter(
    (j) => j.status === 'success',
  ).length;
  const failedCount = Array.from(jobs.values()).filter(
    (j) => j.status === 'error',
  ).length;
  const pendingCount = Array.from(jobs.values()).filter(
    (j) => j.status === 'pending',
  ).length;
  const isAllDone =
    hasStarted && completedCount >= totalCount && totalCount > 0;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <p className="mt-3 text-sm text-white/50">
          Checking asset link status across {selectedEpisodes.length}{' '}
          episodes...
        </p>
      </div>
    );
  }

  // No unlinked items — auto-advancing
  if (totalUnlinked === 0 && !hasStarted) {
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
        <h3 className="text-sm font-semibold text-white/90">
          {hasStarted ? 'Creating Assets' : 'Unlinked Assets'}
        </h3>
        <p className="mt-1 text-xs text-white/50">
          {hasStarted ? (
            <>
              {successCount} of {totalCount} episodes processed
              {failedCount > 0 && ` · ${failedCount} failed`}
            </>
          ) : (
            <>
              {totalUnlinked} unique asset{totalUnlinked !== 1 ? 's' : ''} found
              across {selectedEpisodes.length} episode
              {selectedEpisodes.length !== 1 ? 's' : ''}. Each episode will
              generate descriptions from its screenplay.
            </>
          )}
        </p>

        {/* Progress bar */}
        {hasStarted && totalCount > 0 && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                failedCount > 0 && successCount === 0
                  ? 'bg-red-500'
                  : 'bg-emerald-500',
              )}
              style={{
                width: `${(completedCount / totalCount) * 100}%`,
              }}
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Pre-generation: show unlinked assets summary */}
        {!hasStarted && (
          <div className="space-y-6 px-6 py-4">
            {sortedCharacters.length > 0 && (
              <div>
                <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-white/50 uppercase">
                  <Users className="h-3.5 w-3.5" />
                  Characters
                  <Badge className="ml-1 rounded-full border-0 bg-blue-500/20 px-1.5 py-0 text-[10px] text-blue-400">
                    {sortedCharacters.length}
                  </Badge>
                </h4>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {sortedCharacters.map((char) => (
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

            {sortedLocations.length > 0 && (
              <div>
                <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider text-white/50 uppercase">
                  <MapPin className="h-3.5 w-3.5" />
                  Locations
                  <Badge className="ml-1 rounded-full border-0 bg-cyan-500/20 px-1.5 py-0 text-[10px] text-cyan-400">
                    {sortedLocations.length}
                  </Badge>
                </h4>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {sortedLocations.map((loc) => (
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
        )}

        {/* Post-generation: show per-episode progress */}
        {hasStarted && (
          <div className="space-y-2 px-6 py-4">
            {eligibleEpisodes.map((ep) => (
              <EpisodeAssetRow
                key={ep.episodeId}
                episode={ep}
                job={jobs.get(ep.episodeId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-white/10 px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={hasStarted && !isAllDone}
          className="gap-1.5 text-white/60 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>

        <div className="flex items-center gap-2">
          {/* Pre-start: Skip + Create All */}
          {!hasStarted && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onNext}
                className="gap-1.5 text-white/50 hover:text-white"
              >
                <SkipForward className="h-3.5 w-3.5" />
                Skip
              </Button>

              <Button
                size="sm"
                onClick={handleCreateAll}
                className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Create All ({totalUnlinked})
              </Button>
            </>
          )}

          {/* In progress */}
          {hasStarted && !isAllDone && (
            <div className="flex items-center gap-2 text-xs text-white/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Processing {pendingCount} episode
              {pendingCount !== 1 ? 's' : ''}...
            </div>
          )}

          {/* Done: Retry failed or Next */}
          {isAllDone && (
            <>
              {failedCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRetryFailed}
                  className="gap-1.5 text-amber-400 hover:text-amber-300"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry Failed ({failedCount})
                </Button>
              )}
              <Button
                size="sm"
                onClick={onNext}
                className="gap-2 bg-blue-600 text-white hover:bg-blue-500"
              >
                Next: Shots
                <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Episode Row
// ============================================================================

function EpisodeAssetRow({
  episode,
  job,
}: {
  episode: EpisodeBulkState;
  job?: {
    status: string;
    result?: AssetCreationResult | null;
    error?: string | null;
  };
}) {
  const status = job?.status ?? 'idle';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border px-4 py-3',
        status === 'success'
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : status === 'error'
            ? 'border-red-500/20 bg-red-500/5'
            : status === 'pending'
              ? 'border-blue-500/20 bg-blue-500/5'
              : 'border-white/5 bg-white/[0.02]',
      )}
    >
      {/* Status icon */}
      <div className="shrink-0">
        {status === 'success' ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : status === 'error' ? (
          <XCircle className="h-4 w-4 text-red-400" />
        ) : status === 'pending' ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
        ) : (
          <div className="h-4 w-4 rounded-full border border-white/20" />
        )}
      </div>

      {/* Episode info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white/80">
          Ep {episode.episodeNumber} · {episode.title}
        </p>
        {status === 'success' && job?.result && (
          <p className="mt-0.5 text-[10px] text-emerald-400/70">
            {job.result?.data.created} created · {job.result?.data.linked}{' '}
            linked
            {job.result?.data.characters &&
              job.result.data.characters.length > 0 &&
              ` · ${job.result.data.characters.join(', ')}`}
          </p>
        )}
        {status === 'error' && job?.error && (
          <p className="mt-0.5 text-[10px] text-red-400/70">{job.error}</p>
        )}
        {status === 'pending' && (
          <p className="mt-0.5 text-[10px] text-blue-400/70">
            Generating descriptions...
          </p>
        )}
      </div>
    </div>
  );
}
