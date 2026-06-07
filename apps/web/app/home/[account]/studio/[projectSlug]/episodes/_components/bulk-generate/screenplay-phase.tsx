'use client';

import { useCallback, useRef } from 'react';

import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  Film,
  MessageSquare,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { cn } from '@kit/ui/utils';

import {
  convertToScreenplayAction,
  getBulkEpisodeStatusAction,
} from '@kit/episodes/server';

import type {
  BulkState,
  BulkAction,
  EpisodeBulkState,
  PhaseItemStatus,
} from '../bulk-generate-modal';

// ============================================================================
// Props
// ============================================================================

interface ScreenplayPhaseProps {
  state: BulkState;
  dispatch: React.Dispatch<BulkAction>;
  cancelledRef: React.MutableRefObject<boolean>;
  projectId: string;
  seasonId: string;
  onNext: () => void;
  onBack: () => void;
}

// ============================================================================
// Status Badge
// ============================================================================

function StatusBadge({ status }: { status: PhaseItemStatus }) {
  switch (status) {
    case 'pending':
      return (
        <Badge variant="outline" className="text-white/40 border-white/10">
          Pending
        </Badge>
      );
    case 'generating':
      return (
        <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Converting
        </Badge>
      );
    case 'done':
      return (
        <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Done
        </Badge>
      );
    case 'skipped':
      return (
        <Badge variant="outline" className="text-white/40 border-white/10 bg-white/5">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Skipped
        </Badge>
      );
    case 'error':
      return (
        <Badge variant="outline" className="text-red-400 border-red-500/30 bg-red-500/10">
          <AlertCircle className="mr-1 h-3 w-3" />
          Error
        </Badge>
      );
    default:
      return null;
  }
}

// ============================================================================
// Episode Screenplay Card
// ============================================================================

function EpisodeScreenplayCard({ ep }: { ep: EpisodeBulkState }) {
  if (ep.screenplayStatus === 'skipped') {
    return (
      <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white/70">
            Ep {ep.episodeNumber}
          </span>
          <span className="text-sm text-white/50">{ep.title}</span>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-emerald-400/70">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Already has screenplay
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white/70">
            Ep {ep.episodeNumber}
          </span>
          <span className="text-sm text-white/90">{ep.title}</span>
        </div>
        <StatusBadge status={ep.screenplayStatus} />
      </div>

      {/* Error */}
      {ep.error && ep.screenplayStatus === 'error' && (
        <div className="mx-4 mb-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {ep.error}
        </div>
      )}

      {/* Generating */}
      {ep.screenplayStatus === 'generating' && (
        <div className="flex items-center gap-2 px-4 pb-3 text-sm text-amber-400/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Converting story to screenplay…
        </div>
      )}

      {/* Done — show scene + dialogue counts */}
      {ep.screenplayStatus === 'done' && (
        <div className="flex items-center gap-3 border-t border-white/5 px-4 py-3">
          <Badge variant="outline" className="gap-1 text-white/50 border-white/10">
            <Film className="h-3 w-3" />
            {ep.sceneCount ?? 0} scene{(ep.sceneCount ?? 0) !== 1 ? 's' : ''}
          </Badge>
          <Badge variant="outline" className="gap-1 text-white/50 border-white/10">
            <MessageSquare className="h-3 w-3" />
            {ep.dialogueCount ?? 0} dialogue line
            {(ep.dialogueCount ?? 0) !== 1 ? 's' : ''}
          </Badge>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ScreenplayPhase Component
// ============================================================================

export function ScreenplayPhase({
  state,
  dispatch,
  cancelledRef,
  projectId: _projectId,
  seasonId,
  onNext,
  onBack,
}: ScreenplayPhaseProps) {
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedEpisodes = Array.from(state.episodes.values()).filter(
    (ep) => ep.selected,
  );

  const allDone = selectedEpisodes.every(
    (ep) =>
      ep.screenplayStatus === 'done' || ep.screenplayStatus === 'skipped',
  );

  const pendingCount = selectedEpisodes.filter(
    (ep) => ep.screenplayStatus === 'pending',
  ).length;

  const generatingCount = selectedEpisodes.filter(
    (ep) => ep.screenplayStatus === 'generating',
  ).length;

  const handleGenerate = useCallback(async () => {
    const toGenerate = selectedEpisodes.filter(
      (ep) => ep.screenplayStatus === 'pending',
    );
    if (toGenerate.length === 0) return;

    cancelledRef.current = false;
    dispatch({ type: 'SET_GENERATING', isGenerating: true });

    // Kick off screenplay conversion for each episode
    for (const ep of toGenerate) {
      if (cancelledRef.current) break;

      dispatch({
        type: 'SET_SCREENPLAY_STATUS',
        episodeId: ep.episodeId,
        status: 'generating',
      });

      try {
        await convertToScreenplayAction({
          episodeId: ep.episodeId,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Screenplay conversion failed';
        dispatch({
          type: 'SET_EPISODE_ERROR',
          episodeId: ep.episodeId,
          error: message,
        });
        dispatch({
          type: 'SET_SCREENPLAY_STATUS',
          episodeId: ep.episodeId,
          status: 'error',
        });
      }
    }

    // Start polling for completion
    const episodeIds = toGenerate
      .filter((ep) => {
        const current = state.episodes.get(ep.episodeId);
        return current?.screenplayStatus !== 'error';
      })
      .map((ep) => ep.episodeId);

    if (episodeIds.length > 0) {
      pollingRef.current = setInterval(async () => {
        if (cancelledRef.current) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          dispatch({ type: 'SET_GENERATING', isGenerating: false });
          return;
        }

        try {
          const result = await getBulkEpisodeStatusAction({
            seasonId,
            episodeIds,
          });

          if (result.success && result.data) {
            let allCompleted = true;

            for (const item of result.data) {
              const ep = state.episodes.get(item.id);
              if (!ep || ep.screenplayStatus !== 'generating') continue;

              if (item.hasScreenplay) {
                dispatch({
                  type: 'SET_SCREENPLAY_STATUS',
                  episodeId: item.id,
                  status: 'done',
                  sceneCount: item.sceneCount,
                  dialogueCount: item.dialogueCount,
                });
                dispatch({
                  type: 'UPDATE_EPISODE_VERSION',
                  episodeId: item.id,
                  version: item.version,
                  status: item.status,
                });
              } else {
                allCompleted = false;
              }
            }

            if (allCompleted) {
              if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
              }
              dispatch({ type: 'SET_GENERATING', isGenerating: false });
            }
          }
        } catch {
          // Continue polling on transient errors
        }
      }, 5000);
    } else {
      dispatch({ type: 'SET_GENERATING', isGenerating: false });
    }
  }, [selectedEpisodes, cancelledRef, dispatch, seasonId, state.episodes]);

  return (
    <div className="flex h-full flex-col">
      {/* Content */}
      <div className="flex-1 space-y-3 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-white/90">
              Generate Screenplays
            </h3>
            <p className="mt-0.5 text-xs text-white/40">
              {pendingCount > 0
                ? `${pendingCount} episode${pendingCount !== 1 ? 's' : ''} ready for screenplay conversion`
                : generatingCount > 0
                  ? `Converting ${generatingCount} screenplay${generatingCount !== 1 ? 's' : ''}…`
                  : 'All screenplays generated.'}
            </p>
          </div>

          {pendingCount > 0 && (
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={state.isGenerating}
              className="gap-1.5"
            >
              {state.isGenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Generate Screenplays
            </Button>
          )}
        </div>

        {/* Episode list */}
        <div className="space-y-2">
          {selectedEpisodes.map((ep) => (
            <EpisodeScreenplayCard key={ep.episodeId} ep={ep} />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={state.isGenerating}
          className="gap-1.5 text-white/50 hover:text-white/70"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Button
          size="sm"
          onClick={onNext}
          disabled={!allDone || state.isGenerating}
          className={cn(
            'gap-1.5',
            allDone && !state.isGenerating
              ? 'bg-blue-600 hover:bg-blue-500'
              : '',
          )}
        >
          Next: Assets
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
