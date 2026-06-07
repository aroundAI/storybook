'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Sparkles,
  SkipForward,
} from 'lucide-react';

import {
  generateStoryIdeasAction,
  getBulkEpisodeStatusAction,
} from '@kit/episodes/server';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import type { BulkAction, BulkState, EpisodeBulkState } from '../bulk-generate-modal';

interface IdeationPhaseProps {
  state: BulkState;
  dispatch: React.Dispatch<BulkAction>;
  cancelledRef: React.MutableRefObject<boolean>;
  projectId: string;
  seasonId: string;
  onNext: () => void;
  onBack: () => void;
}

export function IdeationPhase({
  state,
  dispatch,
  cancelledRef,
  seasonId,
  onNext,
  onBack,
}: IdeationPhaseProps) {
  const [hasStarted, setHasStarted] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const episodes = Array.from(state.episodes.values())
    .filter((ep) => ep.selected)
    .sort((a, b) => a.episodeNumber - b.episodeNumber);

  const pendingEpisodes = episodes.filter(
    (ep) => ep.ideationStatus === 'pending',
  );
  const generatingEpisodes = episodes.filter(
    (ep) => ep.ideationStatus === 'generating',
  );
  const doneOrSkipped = episodes.filter(
    (ep) =>
      ep.ideationStatus === 'done' || ep.ideationStatus === 'skipped',
  );

  const allIdeasReady = episodes.every(
    (ep) =>
      ep.ideationStatus === 'skipped' ||
      (ep.ideationStatus === 'done' && ep.selectedIdeaIndex !== undefined),
  );

  // Auto-skip if all episodes already have stories
  useEffect(() => {
    if (episodes.length > 0 && episodes.every((ep) => ep.ideationStatus === 'skipped')) {
      toast.info('All episodes already have stories — skipping ideation');
      const timer = setTimeout(() => onNext(), 1500);
      return () => clearTimeout(timer);
    }
  }, [episodes, onNext]);

  const startIdeation = useCallback(async () => {
    setHasStarted(true);
    dispatch({ type: 'SET_GENERATING', isGenerating: true });

    // Fire all ideation jobs in parallel
    for (const ep of pendingEpisodes) {
      if (cancelledRef.current) break;
      try {
        dispatch({
          type: 'SET_IDEATION_STATUS',
          episodeId: ep.episodeId,
          status: 'generating',
        });
        await generateStoryIdeasAction({
          episodeId: ep.episodeId,
          premise: ep.title,
          numberOfIdeas: 3,
        });
      } catch (err) {
        dispatch({
          type: 'SET_EPISODE_ERROR',
          episodeId: ep.episodeId,
          error: err instanceof Error ? err.message : 'Failed to start ideation',
        });
        dispatch({
          type: 'SET_IDEATION_STATUS',
          episodeId: ep.episodeId,
          status: 'error',
        });
      }
    }
  }, [pendingEpisodes, cancelledRef, dispatch]);

  // Poll for results
  useEffect(() => {
    if (!hasStarted || generatingEpisodes.length === 0) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      if (hasStarted && generatingEpisodes.length === 0) {
        dispatch({ type: 'SET_GENERATING', isGenerating: false });
      }
      return;
    }

    const generatingIds = generatingEpisodes.map((ep) => ep.episodeId);

    pollingRef.current = setInterval(async () => {
      if (cancelledRef.current) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        return;
      }

      try {
        const result = await getBulkEpisodeStatusAction({
          seasonId,
          episodeIds: generatingIds,
        });

        if (result.success && result.data) {
          for (const item of result.data) {
            if (item.hasStory) {
              // Episode got ideas or full story from the handler
              dispatch({
                type: 'SET_IDEATION_STATUS',
                episodeId: item.id,
                status: 'done',
                ideas: [
                  {
                    title: `Variation 1`,
                    logline: item.storyPreview ?? 'Story generated',
                  },
                ],
              });
              dispatch({
                type: 'UPDATE_EPISODE_VERSION',
                episodeId: item.id,
                version: item.version,
                status: item.status,
              });
            }
          }
        }
      } catch {
        // Polling error — will retry next interval
      }
    }, 5000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [hasStarted, generatingEpisodes, seasonId, cancelledRef, dispatch]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-6 py-3">
        <div>
          <h3 className="text-sm font-semibold text-white/90">
            Story Ideation
          </h3>
          <p className="text-xs text-white/40">
            Generate story ideas for each episode and pick the best variation
          </p>
        </div>
        {!hasStarted && pendingEpisodes.length > 0 && (
          <Button
            onClick={startIdeation}
            className="gap-2 bg-blue-600 hover:bg-blue-500"
            size="sm"
          >
            <Sparkles className="h-4 w-4" />
            Generate Ideas ({pendingEpisodes.length})
          </Button>
        )}
        {hasStarted && generatingEpisodes.length > 0 && (
          <Badge
            variant="outline"
            className="gap-1.5 border-blue-500/30 text-blue-400"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            Generating {generatingEpisodes.length} / {episodes.length}
          </Badge>
        )}
      </div>

      {/* Episode list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-4">
          {episodes.map((ep) => (
            <EpisodeIdeationCard
              key={ep.episodeId}
              episode={ep}
              dispatch={dispatch}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-white/5 px-6 py-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-center gap-3 text-xs text-white/40">
          <span>
            {doneOrSkipped.length} / {episodes.length} ready
          </span>
        </div>

        <Button
          onClick={onNext}
          disabled={!allIdeasReady}
          className="gap-2"
          size="sm"
        >
          Next: Generate Stories
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Episode Ideation Card
// ============================================================================

function EpisodeIdeationCard({
  episode,
  dispatch,
}: {
  episode: EpisodeBulkState;
  dispatch: React.Dispatch<BulkAction>;
}) {
  const { ideationStatus, ideas, selectedIdeaIndex } = episode;

  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        ideationStatus === 'skipped'
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : ideationStatus === 'error'
            ? 'border-red-500/20 bg-red-500/5'
            : 'border-white/5 bg-white/[0.02]',
      )}
    >
      {/* Header row */}
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 text-xs font-bold text-white/70">
          {String(episode.episodeNumber).padStart(2, '0')}
        </div>
        <span className="flex-1 text-sm font-medium text-white/90">
          {episode.title}
        </span>

        {/* Status indicator */}
        {ideationStatus === 'generating' && (
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
        )}
        {ideationStatus === 'skipped' && (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-500/30 text-emerald-400"
          >
            <SkipForward className="h-3 w-3" />
            Already has story
          </Badge>
        )}
        {ideationStatus === 'done' && selectedIdeaIndex !== undefined && (
          <Check className="h-4 w-4 text-emerald-400" />
        )}
        {ideationStatus === 'error' && (
          <span className="text-xs text-red-400">{episode.error}</span>
        )}
      </div>

      {/* Variation cards */}
      {ideationStatus === 'done' && ideas && ideas.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {ideas.map((idea, index) => (
            <button
              key={index}
              type="button"
              onClick={() =>
                dispatch({
                  type: 'SELECT_IDEA',
                  episodeId: episode.episodeId,
                  index,
                })
              }
              className={cn(
                'rounded-lg border p-3 text-left transition-all',
                selectedIdeaIndex === index
                  ? 'border-blue-500/50 bg-blue-500/10 ring-1 ring-blue-500/30'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20',
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-white/80">
                  {idea.title}
                </span>
                {selectedIdeaIndex === index && (
                  <Check className="h-3.5 w-3.5 text-blue-400" />
                )}
              </div>
              <p className="line-clamp-3 text-xs leading-relaxed text-white/40">
                {idea.logline}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Pending state */}
      {ideationStatus === 'pending' && (
        <p className="text-xs text-white/30">
          Waiting to generate ideas...
        </p>
      )}
    </div>
  );
}
