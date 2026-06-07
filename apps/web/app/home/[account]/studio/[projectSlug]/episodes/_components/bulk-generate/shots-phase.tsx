'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Loader2,
  XCircle,
} from 'lucide-react';

import {
  generateShotListAction,
  getBulkEpisodeStatusAction,
} from '@kit/episodes/server';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { ScrollArea } from '@kit/ui/scroll-area';
import { cn } from '@kit/ui/utils';

import type {
  BulkAction,
  BulkState,
  EpisodeBulkState,
} from '../bulk-generate-modal';

// ============================================================================
// Props
// ============================================================================

interface ShotsPhaseProps {
  state: BulkState;
  dispatch: React.Dispatch<BulkAction>;
  cancelledRef: React.MutableRefObject<boolean>;
  projectId: string;
  seasonId: string;
  onNext: () => void;
  onBack: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function ShotsPhase({
  state,
  dispatch,
  cancelledRef,
  seasonId,
  onNext,
  onBack,
}: ShotsPhaseProps) {
  const [hasStarted, setHasStarted] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedEpisodes = useMemo(
    () =>
      Array.from(state.episodes.values())
        .filter((ep) => ep.selected)
        .sort((a, b) => a.episodeNumber - b.episodeNumber),
    [state.episodes],
  );

  // Episodes that need shot generation
  const pendingEpisodes = useMemo(
    () => selectedEpisodes.filter((ep) => ep.shotStatus === 'pending'),
    [selectedEpisodes],
  );

  // Episodes currently generating
  const generatingEpisodes = useMemo(
    () => selectedEpisodes.filter((ep) => ep.shotStatus === 'generating'),
    [selectedEpisodes],
  );

  // All episodes done/skipped/error
  const allComplete = useMemo(
    () =>
      selectedEpisodes.every(
        (ep) =>
          ep.shotStatus === 'done' ||
          ep.shotStatus === 'skipped' ||
          ep.shotStatus === 'error',
      ),
    [selectedEpisodes],
  );

  // Episodes with existing shots
  const alreadyHaveShots = useMemo(
    () =>
      selectedEpisodes.filter(
        (ep) => ep.shotStatus === 'skipped' || (ep.shotCount ?? 0) > 0,
      ),
    [selectedEpisodes],
  );

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // Poll for status updates
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;

    pollingRef.current = setInterval(async () => {
      if (cancelledRef.current) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        return;
      }

      try {
        const episodeIds = selectedEpisodes.map((ep) => ep.episodeId);
        const result = await getBulkEpisodeStatusAction({
          seasonId,
          episodeIds,
        });

        if (!result.success) return;

        let allDone = true;

        for (const item of result.data) {
          const ep = state.episodes.get(item.id);
          if (!ep || !ep.selected) continue;

          if (ep.shotStatus === 'generating') {
            if (item.shotCount > 0) {
              dispatch({
                type: 'SET_SHOT_STATUS',
                episodeId: item.id,
                status: 'done',
                shotCount: item.shotCount,
              });
            } else {
              allDone = false;
            }
          }
        }

        if (allDone && pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
          dispatch({ type: 'SET_GENERATING', isGenerating: false });
        }
      } catch {
        // Silently retry on next interval
      }
    }, 5000);
  }, [selectedEpisodes, seasonId, state.episodes, dispatch, cancelledRef]);

  // Generate shot lists
  const handleGenerate = useCallback(async () => {
    if (pendingEpisodes.length === 0) return;

    setHasStarted(true);
    dispatch({ type: 'SET_GENERATING', isGenerating: true });

    for (const ep of pendingEpisodes) {
      if (cancelledRef.current) break;

      dispatch({
        type: 'SET_SHOT_STATUS',
        episodeId: ep.episodeId,
        status: 'generating',
      });

      try {
        await generateShotListAction({
          episodeId: ep.episodeId,
          shotDurationMin: 5,
          shotDurationMax: 8,
          videoProvider: 'veo-3.1',
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Shot generation failed';
        dispatch({
          type: 'SET_EPISODE_ERROR',
          episodeId: ep.episodeId,
          error: message,
        });
        dispatch({
          type: 'SET_SHOT_STATUS',
          episodeId: ep.episodeId,
          status: 'error',
        });
      }
    }

    // Start polling for completion
    startPolling();
  }, [pendingEpisodes, dispatch, cancelledRef, startPolling]);

  // Stats
  const doneCount = selectedEpisodes.filter(
    (ep) => ep.shotStatus === 'done',
  ).length;
  const errorCount = selectedEpisodes.filter(
    (ep) => ep.shotStatus === 'error',
  ).length;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div>
          <h3 className="text-sm font-semibold text-white/90">
            Shot List Generation
          </h3>
          <p className="mt-1 text-xs text-white/50">
            Generate VEO 3.1 optimized shot lists from screenplays
          </p>
        </div>

        {!hasStarted && pendingEpisodes.length > 0 && (
          <Button
            size="sm"
            onClick={handleGenerate}
            className="gap-2 bg-blue-600 text-white hover:bg-blue-500"
          >
            <Camera className="h-3.5 w-3.5" />
            Generate Shot Lists ({pendingEpisodes.length})
          </Button>
        )}

        {hasStarted && !allComplete && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
            Processing... {doneCount}/{selectedEpisodes.length}
          </div>
        )}

        {allComplete && (
          <Badge className="border-0 bg-emerald-500/20 text-emerald-400">
            <CheckCircle2 className="mr-1.5 h-3 w-3" />
            Complete
          </Badge>
        )}
      </div>

      {/* Episode cards */}
      <ScrollArea className="max-h-[50vh]">
        <div className="divide-y divide-white/5">
          {selectedEpisodes.map((ep) => (
            <EpisodeShotCard key={ep.episodeId} episode={ep} />
          ))}
        </div>
      </ScrollArea>

      {/* Summary */}
      {hasStarted && (
        <div className="border-t border-white/5 px-6 py-2">
          <div className="flex items-center gap-4 text-xs text-white/40">
            {doneCount > 0 && (
              <span className="text-emerald-400/70">
                {doneCount} completed
              </span>
            )}
            {generatingEpisodes.length > 0 && (
              <span className="text-blue-400/70">
                {generatingEpisodes.length} generating
              </span>
            )}
            {errorCount > 0 && (
              <span className="text-red-400/70">{errorCount} failed</span>
            )}
            {alreadyHaveShots.length > 0 && (
              <span className="text-white/30">
                {alreadyHaveShots.length} already had shots
              </span>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={state.isGenerating}
          className="gap-1.5 text-white/60 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>

        <Button
          size="sm"
          onClick={onNext}
          disabled={!allComplete && hasStarted}
          className="gap-2 bg-blue-600 text-white hover:bg-blue-500"
        >
          Finish
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Episode Shot Card
// ============================================================================

function EpisodeShotCard({ episode }: { episode: EpisodeBulkState }) {
  return (
    <div className="flex items-center gap-4 px-6 py-3">
      {/* Status indicator */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center">
        {episode.shotStatus === 'generating' && (
          <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
        )}
        {episode.shotStatus === 'done' && (
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
        )}
        {episode.shotStatus === 'error' && (
          <XCircle className="h-5 w-5 text-red-400" />
        )}
        {episode.shotStatus === 'skipped' && (
          <CheckCircle2 className="h-5 w-5 text-white/20" />
        )}
        {episode.shotStatus === 'pending' && (
          <div className="h-2 w-2 rounded-full bg-white/20" />
        )}
      </div>

      {/* Episode number */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 text-xs font-semibold text-white/70">
        {String(episode.episodeNumber).padStart(2, '0')}
      </div>

      {/* Title */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white/90">
          {episode.title}
        </p>
        <p className="text-xs text-white/40">
          {episode.shotStatus === 'generating' && 'Generating shots...'}
          {episode.shotStatus === 'done' &&
            `✓ ${episode.shotCount} shot${(episode.shotCount ?? 0) !== 1 ? 's' : ''} generated`}
          {episode.shotStatus === 'error' && (
            <span className="text-red-400">
              {episode.error ?? 'Generation failed'}
            </span>
          )}
          {episode.shotStatus === 'skipped' &&
            `✓ Already has ${episode.shotCount ?? 0} shots`}
          {episode.shotStatus === 'pending' && 'Waiting...'}
        </p>
      </div>

      {/* Shot count badge */}
      {(episode.shotStatus === 'done' || episode.shotStatus === 'skipped') &&
        (episode.shotCount ?? 0) > 0 && (
          <Badge
            className={cn(
              'shrink-0 rounded-full border-0 px-2.5 py-0.5 text-[10px] font-medium',
              episode.shotStatus === 'done'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-white/5 text-white/40',
            )}
          >
            <Camera className="mr-1 h-2.5 w-2.5" />
            {episode.shotCount}
          </Badge>
        )}
    </div>
  );
}
