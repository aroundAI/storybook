'use client';

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { Edit3, Loader2, Pause, Play, RefreshCw, Volume2 } from 'lucide-react';

import { ProjectAudioSettings } from '@kit/audio-generation/lib';
import {
  generateAudioForCueAction,
  getAudioCuesAction,
  updateAudioCueAction,
} from '@kit/audio-generation/server';
import { Button } from '@kit/ui/button';
import { useLlmJob } from '@kit/ui/hooks';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

export interface SfxTimelineStats {
  total: number;
  completed: number;
  pending: number;
  processing: number;
  failed: number;
}

export interface SfxTimelineHandle {
  generateAll: () => void;
}

interface SfxTimelineProps {
  episodeId: string;
  totalDuration: number;
  pixelsPerSecond: number;
  onRefresh?: () => void;
  audioSettings: ProjectAudioSettings | null;
  onStatsChange?: (stats: SfxTimelineStats) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialCues?: Array<Record<string, any>> | null;
}

interface AudioCue {
  id: string;
  scene_number: number;
  cue_type: 'sfx' | 'ambient' | 'music';
  prompt: string;
  start_offset_seconds: number | null;
  duration_seconds: number | null;
  status: string | null;
  audio_asset_id: string | null;
  audio_assets: {
    id: string;
    name: string | null;
    file_url: string | null;
    duration_seconds: number | null;
  } | null;
}

const TIMELINE_LEFT_PADDING = 30;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getMarkerInterval(pps: number): number {
  if (pps >= 120) return 1;
  if (pps >= 60) return 5;
  return 15;
}

export const SfxTimeline = React.forwardRef<
  SfxTimelineHandle,
  SfxTimelineProps
>(function SfxTimeline(
  {
    episodeId,
    totalDuration,
    pixelsPerSecond,
    onRefresh,
    audioSettings,
    onStatsChange,
    initialCues: initialCuesProp,
  },
  ref,
) {
  const [cues, setCues] = useState<AudioCue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [selectedCue, setSelectedCue] = useState<AudioCue | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // WebSocket hook for audio-file-generation results
  const {
    status: audioGenStatus,
    result: audioGenResult,
    error: audioGenError,
  } = useLlmJob<{ success: boolean; assetId?: string; cueId?: string }>(
    'audio-file-generation',
  );

  // Fetch SFX and ambient cues
  const fetchCues = useCallback(async () => {
    try {
      const result = await getAudioCuesAction({ episodeId });
      // Filter to only sfx and ambient cues, sort by start_offset_seconds
      const sfxCues = (result.cues as AudioCue[])
        .filter((c) => c.cue_type === 'sfx' || c.cue_type === 'ambient')
        .sort(
          (a, b) =>
            (a.start_offset_seconds ?? 0) - (b.start_offset_seconds ?? 0),
        );
      setCues(sfxCues);
    } catch (error) {
      console.error('Failed to fetch SFX cues:', error);
      toast.error('Failed to load sound effects');
    } finally {
      setIsLoading(false);
    }
  }, [episodeId]);

  // Use initial data from bulk action if available, otherwise fetch
  const hasUsedInitialData = useRef(false);
  useEffect(() => {
    if (!hasUsedInitialData.current && initialCuesProp) {
      hasUsedInitialData.current = true;
      // Filter to only sfx and ambient cues from pre-loaded data
      const sfxCues = (initialCuesProp as AudioCue[])
        .filter((c) => c.cue_type === 'sfx' || c.cue_type === 'ambient')
        .sort(
          (a, b) =>
            (a.start_offset_seconds ?? 0) - (b.start_offset_seconds ?? 0),
        );
      setCues(sfxCues);
      setIsLoading(false);
    } else if (!hasUsedInitialData.current) {
      void fetchCues();
      hasUsedInitialData.current = true;
    }
  }, [initialCuesProp, fetchCues]);

  // Handle WebSocket audio generation result
  useEffect(() => {
    if (audioGenStatus === 'success' && audioGenResult?.success) {
      toast.success('Audio generated successfully');
      void fetchCues();
      onRefresh?.();
      // Clear generating state for the completed cue
      if (audioGenResult.cueId) {
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(audioGenResult.cueId!);
          return next;
        });
      }
    } else if (audioGenStatus === 'error') {
      toast.error(audioGenError || 'Audio generation failed');
      void fetchCues();
    }
  }, [audioGenStatus, audioGenResult, audioGenError, fetchCues, onRefresh]);

  // Report stats to parent
  useEffect(() => {
    if (!onStatsChange) return;
    const total = cues.length;
    const completed = cues.filter(
      (c) => c.status === 'placed' || c.status === 'matched',
    ).length;
    const pending = cues.filter((c) => c.status === 'pending').length;
    const processing = cues.filter((c) => c.status === 'generating').length;
    const failed = cues.filter((c) => c.status === 'failed').length;
    onStatsChange({ total, completed, pending, processing, failed });
  }, [cues, onStatsChange]);

  const handleCueClick = (cue: AudioCue, event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({
      x: rect.right + 8,
      y: rect.top,
    });
    setSelectedCue(cue);
  };

  const handleEdit = () => {
    if (!selectedCue) return;
    setEditPrompt(selectedCue.prompt);
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedCue || !editPrompt.trim()) return;

    setIsSaving(true);
    try {
      await updateAudioCueAction({
        cueId: selectedCue.id,
        prompt: editPrompt.trim(),
      });
      toast.success('SFX prompt updated');
      setIsEditModalOpen(false);
      setSelectedCue(null);
      void fetchCues();
      onRefresh?.();
    } catch {
      toast.error('Failed to update SFX prompt');
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerate = async (cue: AudioCue) => {
    if (!audioSettings?.elevenlabs?.sfx_model) {
      toast.error('SFX model not selected in project settings');
      return;
    }

    setGeneratingIds((prev) => new Set(prev).add(cue.id));

    try {
      const result = await generateAudioForCueAction({ cueId: cue.id });
      if (result.status === 'queued') {
        toast.info(`Generating: ${cue.prompt.substring(0, 30)}...`);
        // Don't call fetchCues here - WebSocket will notify when complete
      } else {
        toast.error(result.error ?? 'Failed to queue generation');
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(cue.id);
          return next;
        });
      }
    } catch {
      toast.error('Failed to start audio generation');
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(cue.id);
        return next;
      });
    }
  };

  const handlePlay = (cue: AudioCue, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const url = cue.audio_assets?.file_url;
    if (!url) {
      toast.error('No audio available');
      return;
    }

    // If same cue is playing, pause it
    if (playingId === cue.id && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingId(null);
      return;
    }

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(url);
    audio.onended = () => {
      setPlayingId(null);
      audioRef.current = null;
    };
    audio.play();
    audioRef.current = audio;
    setPlayingId(cue.id);
  };

  const handleGenerateAll = async () => {
    if (!audioSettings?.elevenlabs?.sfx_model) {
      toast.error('SFX model not selected in project settings');
      return;
    }

    const pendingCues = cues.filter((c) => c.status === 'pending');
    if (pendingCues.length === 0) {
      toast.info('No pending cues to generate');
      return;
    }

    toast.info(`Queuing ${pendingCues.length} sound effects for generation...`);

    // Queue all pending cues for generation
    for (const cue of pendingCues) {
      await handleGenerate(cue);
    }
    // completion notifications come via WebSocket
  };

  // Expose generateAll via ref
  useImperativeHandle(
    ref,
    () => ({
      generateAll: () => void handleGenerateAll(),
    }),
    [handleGenerateAll],
  );

  if (isLoading) {
    return (
      <div className="bg-background flex h-full flex-col">
        <div className="h-10 border-b bg-gray-100 dark:bg-black/20" />
        <div className="flex-1 space-y-4 p-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const effectiveDuration = totalDuration > 0 ? totalDuration : 90;
  const timelineWidth = Math.max(
    effectiveDuration * pixelsPerSecond + TIMELINE_LEFT_PADDING + 40,
    800,
  );

  const timeMarkers: number[] = [];
  const markerInterval = getMarkerInterval(pixelsPerSecond);
  for (let t = 0; t <= effectiveDuration; t += markerInterval) {
    timeMarkers.push(t);
  }

  const pendingCount = cues.filter((c) => c.status === 'pending').length;

  return (
    <div className="bg-card relative flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200/50 px-4 py-2 dark:border-gray-700/50">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Sound Effects ({cues.length})
          </span>
          {pendingCount > 0 && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {pendingCount} pending
            </span>
          )}
        </div>
        {pendingCount > 0 && (
          <Button variant="outline" size="sm" onClick={handleGenerateAll}>
            Generate All ({pendingCount})
          </Button>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {/* Time ruler */}
        <div
          className="sticky top-0 z-10 flex h-8 items-end border-b border-gray-200/50 bg-gray-50 px-4 font-mono text-[10px] text-gray-400 select-none dark:border-gray-700/50 dark:bg-black/20"
          style={{ width: `${timelineWidth}px`, minWidth: '100%' }}
        >
          <div
            className="relative h-full w-full pb-1"
            style={{ paddingLeft: TIMELINE_LEFT_PADDING }}
          >
            {timeMarkers.map((time) => (
              <span
                key={time}
                className="absolute bottom-2 -translate-x-1/2"
                style={{
                  left: `${TIMELINE_LEFT_PADDING + time * pixelsPerSecond}px`,
                }}
              >
                {formatTime(time)}
              </span>
            ))}
          </div>
        </div>

        {/* Cues content */}
        <div className="p-4" style={{ width: `${timelineWidth}px` }}>
          {cues.length === 0 ? (
            <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
              <div className="text-center">
                <Volume2 className="mx-auto mb-3 h-12 w-12 opacity-30" />
                <p>No sound effects yet</p>
                <p className="mt-1 text-sm">
                  Generate shots to automatically create SFX prompts
                </p>
              </div>
            </div>
          ) : (
            <div
              className="relative space-y-2"
              style={{ paddingLeft: TIMELINE_LEFT_PADDING }}
            >
              {cues.map((cue) => {
                const leftPx =
                  (cue.start_offset_seconds ?? 0) * pixelsPerSecond;
                const widthPx = Math.max(
                  (cue.duration_seconds ?? 3) * pixelsPerSecond,
                  180,
                );
                const isGenerating = generatingIds.has(cue.id);
                const isPlaced =
                  cue.status === 'placed' || cue.status === 'matched';
                const isPending = cue.status === 'pending';

                return (
                  <div key={cue.id} className="relative h-14">
                    <div
                      className={cn(
                        'absolute flex cursor-pointer items-center gap-2 rounded-lg border p-2 shadow-sm transition-all hover:shadow-md',
                        isPlaced
                          ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/30'
                          : isPending
                            ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/30'
                            : cue.status === 'failed'
                              ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30'
                              : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800',
                        selectedCue?.id === cue.id &&
                          'ring-2 ring-blue-500 ring-offset-2',
                      )}
                      style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                      onClick={(e) => handleCueClick(cue, e)}
                    >
                      {/* Play/Pause button for completed cues */}
                      {isPlaced && cue.audio_assets?.file_url ? (
                        <button
                          onClick={(e) => handlePlay(cue, e)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/80 shadow-sm transition-colors hover:bg-white dark:bg-black/30 dark:hover:bg-black/50"
                          aria-label={playingId === cue.id ? 'Pause' : 'Play'}
                        >
                          {playingId === cue.id ? (
                            <Pause className="h-3.5 w-3.5 text-green-700 dark:text-green-400" />
                          ) : (
                            <Play className="h-3.5 w-3.5 text-green-700 dark:text-green-400" />
                          )}
                        </button>
                      ) : isGenerating ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
                      ) : isPending ? (
                        <RefreshCw className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <Volume2 className="h-4 w-4 shrink-0 text-gray-400" />
                      )}

                      {/* Cue info */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">
                          {cue.prompt}
                        </p>
                        <p className="truncate text-[10px] text-gray-500 dark:text-gray-400">
                          Scene {cue.scene_number} | {cue.cue_type}
                          {cue.duration_seconds &&
                            ` | ${formatTime(cue.duration_seconds)}`}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Context Menu */}
        {selectedCue && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setSelectedCue(null)}
            />
            <div
              className="fixed z-50 w-48 rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
              style={{ top: menuPosition.y, left: menuPosition.x }}
            >
              {(selectedCue.status === 'placed' ||
                selectedCue.status === 'matched') && (
                <button
                  onClick={() => handlePlay(selectedCue)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/50"
                >
                  <Play className="h-4 w-4" /> Play
                </button>
              )}
              <button
                onClick={handleEdit}
                className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/50"
              >
                <Edit3 className="h-4 w-4" /> Edit Prompt
              </button>
              <button
                onClick={() => handleGenerate(selectedCue)}
                disabled={generatingIds.has(selectedCue.id)}
                className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700/50"
              >
                <RefreshCw
                  className={cn(
                    'h-4 w-4',
                    generatingIds.has(selectedCue.id) && 'animate-spin',
                  )}
                />
                {generatingIds.has(selectedCue.id)
                  ? 'Generating...'
                  : 'Regenerate'}
              </button>
            </div>
          </>
        )}

        {/* Edit Modal */}
        {isEditModalOpen && selectedCue && (
          <>
            <div
              className="fixed inset-0 z-50 bg-black/50"
              onClick={() => setIsEditModalOpen(false)}
            />
            <div className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-800">
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                Edit SFX Prompt
              </h3>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                className="mb-4 h-32 w-full resize-none rounded-lg border border-gray-300 p-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-blue-400"
                placeholder="Enter SFX prompt..."
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveEdit}
                  disabled={isSaving || !editPrompt.trim()}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});
