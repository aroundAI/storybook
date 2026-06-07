'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

import {
  generateFullStoryAction,
  refineStoryAction,
} from '@kit/episodes/server';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { useBulkLlmJobs } from '@kit/ui/hooks';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';
import { ExpandableContent } from './expandable-content';

import type {
  BulkAction,
  BulkState,
  EpisodeBulkState,
  PhaseItemStatus,
} from '../bulk-generate-modal';

// ============================================================================
// Result types for WebSocket messages
// ============================================================================

interface StoryGenerationWsResult {
  success: boolean;
  data: {
    story: {
      fullText: string;
      title: string;
      actBreakdown: Array<{ act: number; summary: string }>;
      characters: string[];
      themes: string[];
      tone: string;
      estimatedSceneCount: number;
      episodeSummary?: string;
      sentimentScore?: number;
      keyEvents?: string[];
    };
    episode: {
      id: string;
      status: string;
      version: number;
    };
    metadata: {
      provider: string;
      model: string;
      costCents: number;
      tokensUsed: number;
      generatedAt: string;
      orchestratorSteps?: number;
    };
  };
}

interface StoryRefinementWsResult {
  success: boolean;
  data: {
    story: Record<string, unknown>;
    refinementApplied: boolean;
    episode: {
      id: string;
      status: string;
    };
    metadata: {
      provider: string;
      model: string;
      generatedAt: string;
    };
  };
}

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
        <Badge variant="outline" className="border-white/10 text-white/40">
          Pending
        </Badge>
      );
    case 'generating':
      return (
        <Badge
          variant="outline"
          className="border-amber-500/30 bg-amber-500/10 text-amber-400"
        >
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Generating
        </Badge>
      );
    case 'review':
      return (
        <Badge
          variant="outline"
          className="border-blue-500/30 bg-blue-500/10 text-blue-400"
        >
          <BookOpen className="mr-1 h-3 w-3" />
          Review
        </Badge>
      );
    case 'done':
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
        >
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Done
        </Badge>
      );
    case 'skipped':
      return (
        <Badge
          variant="outline"
          className="border-white/10 bg-white/5 text-white/40"
        >
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Skipped
        </Badge>
      );
    case 'error':
      return (
        <Badge
          variant="outline"
          className="border-red-500/30 bg-red-500/10 text-red-400"
        >
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
}: {
  ep: EpisodeBulkState;
  dispatch: React.Dispatch<BulkAction>;
  projectId: string;
}) {
  const [isRefining, setIsRefining] = useState(false);
  const processedRefineRef = useRef<Set<string>>(new Set());

  const {
    jobs: refineJobs,
    registerEpisodes: registerRefine,
    markPending: markRefinePending,
  } = useBulkLlmJobs<StoryRefinementWsResult>('story-refinement');

  // Watch refinement jobs for completion
  useEffect(() => {
    for (const [episodeId, entry] of refineJobs) {
      if (processedRefineRef.current.has(episodeId)) continue;

      if (entry.status === 'success' && entry.result) {
        processedRefineRef.current.add(episodeId);

        const result = entry.result;
        const storyData = result.data?.story;
        const preview = storyData?.fullStory
          ? String(storyData.fullStory)
          : storyData?.fullText
            ? String(storyData.fullText)
            : JSON.stringify(result.data);

        dispatch({
          type: 'SET_STORY_STATUS',
          episodeId,
          status: 'review',
          preview,
        });

        if (result.data?.episode) {
          dispatch({
            type: 'UPDATE_EPISODE_VERSION',
            episodeId,
            version:
              ((result.data.episode as Record<string, unknown>)
                .version as number) ?? ep.version,
            status: result.data.episode.status,
          });
        }

        dispatch({
          type: 'SET_REFINEMENT_NOTES',
          episodeId,
          notes: '',
        });

        setIsRefining(false);
      } else if (entry.status === 'error') {
        processedRefineRef.current.add(episodeId);

        dispatch({
          type: 'SET_EPISODE_ERROR',
          episodeId,
          error: entry.error ?? 'Refinement failed',
        });
        dispatch({
          type: 'SET_STORY_STATUS',
          episodeId,
          status: 'error',
        });

        setIsRefining(false);
      }
    }
  }, [refineJobs, dispatch, ep.version]);

  const handleRefine = useCallback(async () => {
    const notes = ep.refinementNotes?.trim();
    if (!notes) return;

    setIsRefining(true);
    processedRefineRef.current.delete(ep.episodeId);
    dispatch({
      type: 'SET_STORY_STATUS',
      episodeId: ep.episodeId,
      status: 'generating',
    });

    try {
      registerRefine([ep.episodeId]);
      markRefinePending(ep.episodeId);

      await refineStoryAction({
        episodeId: ep.episodeId,
        projectId,
        feedback: notes,
      });
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
  }, [
    ep.episodeId,
    ep.refinementNotes,
    dispatch,
    projectId,
    registerRefine,
    markRefinePending,
  ]);

  // "Already has story" — expandable if next stage (screenplay) not done
  if (ep.storyStatus === 'skipped') {
    const nextStageDone =
      ep.screenplayStatus === 'skipped' || ep.screenplayStatus === 'done';

    if (nextStageDone) {
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

    // Next stage not done — show expandable card with preview + refinement
    return (
      <div className="rounded-lg border border-white/10 bg-zinc-900/50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white/70">
              Ep {ep.episodeNumber}
            </span>
            <span className="text-sm text-white/90">{ep.title}</span>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-emerald-400/70">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Has story
          </span>
        </div>
        {ep.storyPreview && (
          <div className="border-t border-white/5 px-4 py-3">
            <ExpandableContent
              content={ep.storyPreview}
              label="Story Preview"
            />
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
                disabled={isRefining || !ep.refinementNotes?.trim()}
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
            <ExpandableContent
              content={ep.storyPreview}
              label="Story Preview"
            />

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
                disabled={isRefining || !ep.refinementNotes?.trim()}
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
  seasonId: _seasonId,
  onNext,
  onBack,
}: StoryPhaseProps) {
  const processedRef = useRef<Set<string>>(new Set());

  const { jobs, registerEpisodes, markPending, completedCount, totalCount } =
    useBulkLlmJobs<StoryGenerationWsResult>('story-generation');

  // Watch jobs for completion and dispatch status updates
  useEffect(() => {
    for (const [episodeId, entry] of jobs) {
      if (processedRef.current.has(episodeId)) continue;

      if (entry.status === 'success' && entry.result) {
        processedRef.current.add(episodeId);

        const result = entry.result;
        const storyText = result.data?.story?.fullText ?? '';
        const preview = storyText;

        dispatch({
          type: 'SET_STORY_STATUS',
          episodeId,
          status: 'review',
          preview,
        });

        if (result.data?.episode) {
          dispatch({
            type: 'UPDATE_EPISODE_VERSION',
            episodeId,
            version: result.data.episode.version,
            status: result.data.episode.status,
          });
        }
      } else if (entry.status === 'error') {
        processedRef.current.add(episodeId);

        dispatch({
          type: 'SET_EPISODE_ERROR',
          episodeId,
          error: entry.error ?? 'Story generation failed',
        });
        dispatch({
          type: 'SET_STORY_STATUS',
          episodeId,
          status: 'error',
        });
      }
    }
  }, [jobs, dispatch]);

  // Detect generation completion via WebSocket counts
  useEffect(() => {
    if (totalCount > 0 && completedCount === totalCount && state.isGenerating) {
      dispatch({ type: 'SET_GENERATING', isGenerating: false });
    }
  }, [completedCount, totalCount, state.isGenerating, dispatch]);

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

    // Register all episodes for WebSocket tracking
    registerEpisodes(toGenerate.map((ep) => ep.episodeId));

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

      markPending(ep.episodeId);

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

    // If all failed synchronously (no episodes left generating), stop immediately
    const anyStillGenerating = toGenerate.some((ep) => {
      const current = state.episodes.get(ep.episodeId);
      return current?.storyStatus === 'generating';
    });

    if (!anyStillGenerating) {
      dispatch({ type: 'SET_GENERATING', isGenerating: false });
    }
  }, [
    selectedEpisodes,
    cancelledRef,
    dispatch,
    state.episodes,
    registerEpisodes,
    markPending,
  ]);

  return (
    <div className="flex h-full flex-col">
      {/* Content */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6">
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
