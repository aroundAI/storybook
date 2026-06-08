'use client';

import { useCallback, useEffect, useRef } from 'react';

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Film,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

import { batchConvertScreenplaysAction } from '@kit/episodes/server';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { useBulkLlmJobs } from '@kit/ui/hooks';
import { cn } from '@kit/ui/utils';

import { ExpandableContent } from './expandable-content';

import type {
  BulkAction,
  BulkState,
  EpisodeBulkState,
  PhaseItemStatus,
} from '../bulk-generate-modal';

// ============================================================================
// WebSocket result type for screenplay-conversion jobs
// ============================================================================

interface ScreenplayConversionWsResult {
  data?: {
    screenplay?: {
      scenes?: Array<{
        number: number;
        heading: string;
        description?: string;
        dialogue?: Array<{
          character: string;
          text: string;
          parenthetical?: string;
        }>;
      }>;
    };
    dialogueLinesCreated?: number;
    episode?: {
      id: string;
      status: string;
      version: number;
    };
  };
}

function formatScreenplayText(
  scenes: Array<{
    number: number;
    heading: string;
    description?: string;
    dialogue?: Array<{
      character: string;
      text: string;
      parenthetical?: string;
    }>;
  }>,
): string {
  return scenes
    .map((scene) => {
      const parts: string[] = [];
      parts.push(`SCENE ${scene.number}: ${scene.heading}`);
      if (scene.description) parts.push(scene.description);
      if (scene.dialogue?.length) {
        for (const d of scene.dialogue) {
          const paren = d.parenthetical ? ` (${d.parenthetical})` : '';
          parts.push(`${d.character}${paren}: "${d.text}"`);
        }
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

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
          Converting
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
    default:
      return null;
  }
}

// ============================================================================
// Episode Screenplay Card
// ============================================================================

function EpisodeScreenplayCard({ ep }: { ep: EpisodeBulkState }) {
  // "Already has screenplay" — expandable if next stage (shots) not done
  if (ep.screenplayStatus === 'skipped') {
    const nextStageDone =
      ep.shotStatus === 'skipped' || ep.shotStatus === 'done';

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
            Already has screenplay
          </span>
        </div>
      );
    }

    // Next stage not done — show expandable card with preview
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
            Has screenplay
          </span>
        </div>
        <div className="border-t border-white/5 px-4 py-3">
          <div className="mb-2 flex items-center gap-3">
            <Badge
              variant="outline"
              className="gap-1 border-white/10 text-white/50"
            >
              <Film className="h-3 w-3" />
              {ep.sceneCount ?? 0} scene{(ep.sceneCount ?? 0) !== 1 ? 's' : ''}
            </Badge>
            <Badge
              variant="outline"
              className="gap-1 border-white/10 text-white/50"
            >
              <MessageSquare className="h-3 w-3" />
              {ep.dialogueCount ?? 0} dialogue line
              {(ep.dialogueCount ?? 0) !== 1 ? 's' : ''}
            </Badge>
          </div>
          {ep.screenplayPreview && (
            <ExpandableContent
              content={ep.screenplayPreview}
              label="Screenplay"
            />
          )}
        </div>
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

      {/* Done — show scene + dialogue counts + expandable preview */}
      {ep.screenplayStatus === 'done' && (
        <div className="border-t border-white/5 px-4 py-3">
          <div className="mb-2 flex items-center gap-3">
            <Badge
              variant="outline"
              className="gap-1 border-white/10 text-white/50"
            >
              <Film className="h-3 w-3" />
              {ep.sceneCount ?? 0} scene{(ep.sceneCount ?? 0) !== 1 ? 's' : ''}
            </Badge>
            <Badge
              variant="outline"
              className="gap-1 border-white/10 text-white/50"
            >
              <MessageSquare className="h-3 w-3" />
              {ep.dialogueCount ?? 0} dialogue line
              {(ep.dialogueCount ?? 0) !== 1 ? 's' : ''}
            </Badge>
          </div>
          {ep.screenplayPreview && (
            <ExpandableContent
              content={ep.screenplayPreview}
              label="Screenplay"
            />
          )}
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
  seasonId: _seasonId,
  onNext,
  onBack,
}: ScreenplayPhaseProps) {
  const { jobs, registerEpisodes, markPending, completedCount, totalCount } =
    useBulkLlmJobs<ScreenplayConversionWsResult>('screenplay-conversion');

  const processedRef = useRef<Set<string>>(new Set());

  // Watch WebSocket job results and dispatch status updates
  useEffect(() => {
    for (const [episodeId, entry] of jobs) {
      if (processedRef.current.has(episodeId)) continue;

      if (entry.status === 'success') {
        processedRef.current.add(episodeId);

        const result = entry.result;
        const scenes = result?.data?.screenplay?.scenes ?? [];
        const sceneCount = scenes.length;
        const dialogueCount = result?.data?.dialogueLinesCreated ?? 0;
        const preview = scenes.length > 0
          ? formatScreenplayText(
              scenes as Array<{
                number: number;
                heading: string;
                description?: string;
                dialogue?: Array<{
                  character: string;
                  text: string;
                  parenthetical?: string;
                }>;
              }>,
            )
          : null;

        dispatch({
          type: 'SET_SCREENPLAY_STATUS',
          episodeId,
          status: 'done',
          preview,
          sceneCount,
          dialogueCount,
        });

        if (result?.data?.episode) {
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
          error: entry.error ?? 'Screenplay conversion failed',
        });
        dispatch({
          type: 'SET_SCREENPLAY_STATUS',
          episodeId,
          status: 'error',
        });
      }
    }
  }, [jobs, dispatch]);

  // When all WebSocket jobs complete, stop generating
  useEffect(() => {
    if (totalCount > 0 && completedCount === totalCount) {
      dispatch({ type: 'SET_GENERATING', isGenerating: false });
    }
  }, [completedCount, totalCount, dispatch]);

  const selectedEpisodes = Array.from(state.episodes.values()).filter(
    (ep) => ep.selected,
  );

  const allDone = selectedEpisodes.every(
    (ep) =>
      ep.screenplayStatus === 'done' ||
      ep.screenplayStatus === 'skipped' ||
      ep.screenplayStatus === 'error',
  );

  const pendingCount = selectedEpisodes.filter(
    (ep) => ep.screenplayStatus === 'pending',
  ).length;

  const generatingCount = selectedEpisodes.filter(
    (ep) => ep.screenplayStatus === 'generating',
  ).length;

  const failedEpisodes = selectedEpisodes.filter(
    (ep) => ep.screenplayStatus === 'error',
  );
  const errorCount = failedEpisodes.length;

  const handleGenerate = useCallback(async () => {
    const toGenerate = selectedEpisodes.filter(
      (ep) => ep.screenplayStatus === 'pending',
    );
    if (toGenerate.length === 0) return;

    dispatch({ type: 'SET_GENERATING', isGenerating: true });

    // Register all episodes for WebSocket tracking
    registerEpisodes(toGenerate.map((ep) => ep.episodeId));

    // Mark all as generating
    for (const ep of toGenerate) {
      markPending(ep.episodeId);
      dispatch({ type: 'SET_SCREENPLAY_STATUS', episodeId: ep.episodeId, status: 'generating' });
    }

    // Single batch call — SQS + Lambda handle throughput
    try {
      const result = await batchConvertScreenplaysAction({
        episodes: toGenerate.map((ep) => ({
          episodeId: ep.episodeId,
          contentStyle: ep.contentStyle,
        })),
      });

      for (const { episodeId, error } of result.failed) {
        dispatch({ type: 'SET_EPISODE_ERROR', episodeId, error });
        dispatch({ type: 'SET_SCREENPLAY_STATUS', episodeId, status: 'error' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch screenplay conversion failed';
      for (const ep of toGenerate) {
        dispatch({ type: 'SET_EPISODE_ERROR', episodeId: ep.episodeId, error: message });
        dispatch({ type: 'SET_SCREENPLAY_STATUS', episodeId: ep.episodeId, status: 'error' });
      }
    }
  }, [selectedEpisodes, dispatch, registerEpisodes, markPending]);

  // Retry failed episodes
  const handleRetryFailed = useCallback(() => {
    const failedIds = failedEpisodes.map((ep) => ep.episodeId);
    if (failedIds.length === 0) return;

    for (const id of failedIds) {
      processedRef.current.delete(id);
    }

    cancelledRef.current = false;
    dispatch({ type: 'RETRY_EPISODES', episodeIds: failedIds, phase: 'screenplay' });
  }, [failedEpisodes, dispatch, cancelledRef]);

  // Auto-trigger generation when episodes are retried
  useEffect(() => {
    if (pendingCount > 0 && !state.isGenerating) {
      const hasProgress = selectedEpisodes.some(
        (ep) => ep.screenplayStatus === 'done' || ep.screenplayStatus === 'error',
      );
      if (hasProgress) {
        handleGenerate();
      }
    }
  }, [pendingCount, state.isGenerating, selectedEpisodes, handleGenerate]);

  return (
    <div className="flex h-full flex-col">
      {/* Content */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6">
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

          {errorCount > 0 && !state.isGenerating && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetryFailed}
              className="gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry {errorCount} Failed
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
