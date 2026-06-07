'use client';

import { useCallback, useRef, useState } from 'react';

import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@kit/ui/collapsible';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

import {
  generateFullStoryAction,
  getBulkEpisodeStatusAction,
  refineStoryAction,
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

interface StoryPhaseProps {
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
          Generating
        </Badge>
      );
    case 'review':
      return (
        <Badge variant="outline" className="text-blue-400 border-blue-500/30 bg-blue-500/10">
          <BookOpen className="mr-1 h-3 w-3" />
          Review
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
  }
}

// ============================================================================
// Episode Story Card
// ============================================================================

function EpisodeStoryCard({
  ep,
  dispatch,
  projectId,
  seasonId,
}: {
  ep: EpisodeBulkState;
  dispatch: React.Dispatch<BulkAction>;
  projectId: string;
  seasonId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const refinePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleRefine = useCallback(async () => {
    const notes = ep.refinementNotes?.trim();
    if (!notes) return;

    setIsRefining(true);
    dispatch({
      type: 'SET_STORY_STATUS',
      episodeId: ep.episodeId,
      status: 'generating',
    });

    try {
      await refineStoryAction({
        episodeId: ep.episodeId,
        projectId,
        feedback: notes,
      });

      // Poll for refinement completion
      refinePollingRef.current = setInterval(async () => {
        try {
          const result = await getBulkEpisodeStatusAction({
            seasonId,
            episodeIds: [ep.episodeId],
          });

          if (result.success && result.data) {
            const updated = result.data[0];
            if (updated && updated.hasStory && updated.storyPreview) {
              dispatch({
                type: 'SET_STORY_STATUS',
                episodeId: ep.episodeId,
                status: 'review',
                preview: updated.storyPreview,
              });
              dispatch({
                type: 'UPDATE_EPISODE_VERSION',
                episodeId: ep.episodeId,
                version: updated.version,
                status: updated.status,
              });
              dispatch({
                type: 'SET_REFINEMENT_NOTES',
                episodeId: ep.episodeId,
                notes: '',
              });
              setIsRefining(false);
              if (refinePollingRef.current) {
                clearInterval(refinePollingRef.current);
                refinePollingRef.current = null;
              }
            }
          }
        } catch {
          // Continue polling on error
        }
      }, 5000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refinement failed';
      dispatch({
        type: 'SET_EPISODE_ERROR',
        episodeId: ep.episodeId,
        error: message,
      });
      dispatch({
        type: 'SET_STORY_STATUS',
        episodeId: ep.episodeId,
        status: 'error',
      });
      setIsRefining(false);
    }

    return () => {
      if (refinePollingRef.current) {
        clearInterval(refinePollingRef.current);
      }
    };
  }, [ep.episodeId, ep.refinementNotes, dispatch, projectId, seasonId]);

  if (ep.storyStatus === 'skipped') {
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
          Already has story
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
        <StatusBadge status={ep.storyStatus} />
      </div>

      {/* Error */}
      {ep.error && ep.storyStatus === 'error' && (
        <div className="mx-4 mb-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {ep.error}
        </div>
      )}

      {/* Generating spinner */}
      {ep.storyStatus === 'generating' && (
        <div className="flex items-center gap-2 px-4 pb-3 text-sm text-amber-400/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating story…
        </div>
      )}

      {/* Story preview + refinement (review or done) */}
      {(ep.storyStatus === 'review' || ep.storyStatus === 'done') &&
        ep.storyPreview && (
          <div className="border-t border-white/5 px-4 py-3">
            <Collapsible open={isOpen} onOpenChange={setIsOpen}>
              <CollapsibleTrigger className="flex w-full items-center gap-2 text-xs font-medium text-white/50 hover:text-white/70 transition-colors">
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Story Preview
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="mt-2 text-sm leading-relaxed text-white/60">
                  {ep.storyPreview}
                  {ep.storyPreview.length >= 300 && '…'}
                </p>
              </CollapsibleContent>
            </Collapsible>

            {/* Refinement */}
            <div className="mt-3 space-y-2">
              <Textarea
                value={ep.refinementNotes ?? ''}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_REFINEMENT_NOTES',
                    episodeId: ep.episodeId,
                    notes: e.target.value,
                  })
                }
                placeholder="Add refinement notes (e.g. 'Make the ending more dramatic')"
                className="min-h-[60px] resize-none border-white/10 bg-zinc-950/50 text-sm text-white/80 placeholder:text-white/25"
                disabled={isRefining}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefine}
                disabled={
                  isRefining || !ep.refinementNotes?.trim()
                }
                className="gap-1.5 text-xs"
              >
                {isRefining ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Refine
              </Button>
            </div>
          </div>
        )}
    </div>
  );
}

// ============================================================================
// StoryPhase Component
// ============================================================================

export function StoryPhase({
  state,
  dispatch,
  cancelledRef,
  projectId,
  seasonId,
  onNext,
  onBack,
}: StoryPhaseProps) {
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedEpisodes = Array.from(state.episodes.values()).filter(
    (ep) => ep.selected,
  );

  const allDone = selectedEpisodes.every(
    (ep) =>
      ep.storyStatus === 'done' ||
      ep.storyStatus === 'review' ||
      ep.storyStatus === 'skipped',
  );

  const pendingCount = selectedEpisodes.filter(
    (ep) => ep.storyStatus === 'pending',
  ).length;

  const generatingCount = selectedEpisodes.filter(
    (ep) => ep.storyStatus === 'generating',
  ).length;

  const handleGenerate = useCallback(async () => {
    const toGenerate = selectedEpisodes.filter(
      (ep) => ep.storyStatus === 'pending',
    );
    if (toGenerate.length === 0) return;

    cancelledRef.current = false;
    dispatch({ type: 'SET_GENERATING', isGenerating: true });

    // Kick off generation for each episode
    for (const ep of toGenerate) {
      if (cancelledRef.current) break;

      const idea = ep.ideas?.[ep.selectedIdeaIndex ?? 0];
      if (!idea) {
        dispatch({
          type: 'SET_EPISODE_ERROR',
          episodeId: ep.episodeId,
          error: 'No idea selected',
        });
        dispatch({
          type: 'SET_STORY_STATUS',
          episodeId: ep.episodeId,
          status: 'error',
        });
        continue;
      }

      dispatch({
        type: 'SET_STORY_STATUS',
        episodeId: ep.episodeId,
        status: 'generating',
      });

      try {
        await generateFullStoryAction({
          episodeId: ep.episodeId,
          version: ep.version,
          title: idea.title,
          logline: idea.logline,
          targetDuration: ep.duration,
          contentStyle: ep.contentStyle,
          themes: idea.themes,
          hook: idea.hook,
          visualDirection: idea.visualDirection,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Story generation failed';
        dispatch({
          type: 'SET_EPISODE_ERROR',
          episodeId: ep.episodeId,
          error: message,
        });
        dispatch({
          type: 'SET_STORY_STATUS',
          episodeId: ep.episodeId,
          status: 'error',
        });
      }
    }

    // Start polling for completion
    const episodeIds = toGenerate
      .filter((ep) => ep.storyStatus !== 'error')
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
              if (!ep || ep.storyStatus !== 'generating') continue;

              if (item.hasStory) {
                dispatch({
                  type: 'SET_STORY_STATUS',
                  episodeId: item.id,
                  status: 'review',
                  preview: item.storyPreview,
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
              Generate Stories
            </h3>
            <p className="mt-0.5 text-xs text-white/40">
              {pendingCount > 0
                ? `${pendingCount} episode${pendingCount !== 1 ? 's' : ''} ready for story generation`
                : generatingCount > 0
                  ? `Generating ${generatingCount} stor${generatingCount !== 1 ? 'ies' : 'y'}…`
                  : 'All stories generated. Review and refine before continuing.'}
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
              Generate Stories
            </Button>
          )}
        </div>

        {/* Episode list */}
        <div className="space-y-2">
          {selectedEpisodes.map((ep) => (
            <EpisodeStoryCard
              key={ep.episodeId}
              ep={ep}
              dispatch={dispatch}
              projectId={projectId}
              seasonId={seasonId}
            />
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
          Next: Screenplays
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
