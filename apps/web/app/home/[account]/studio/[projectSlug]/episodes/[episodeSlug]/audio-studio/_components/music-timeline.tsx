'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Loader2, Music, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';

import {
  deleteAudioTrackAction,
  getAudioTracksAction,
  getAudioCuesAction,
  generateAudioForCueAction,
  pollMusicStatusAction,
} from '@kit/audio-generation/server';
import { Button } from '@kit/ui/button';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { AddMusicCueDialog } from './add-music-cue-dialog';
import { GenerateSceneMusicDialog } from './generate-scene-music-dialog';

interface MusicTimelineProps {
  episodeId: string;
  totalDuration: number;
  scenes: Array<{
    number: number;
    heading: string;
    estimatedDuration: number;
  }>;
  onRefresh?: () => void;
  pixelsPerSecond: number;
}

interface MusicTrack {
  id: string;
  name: string | null;
  fileUrl: string | null;
  durationSeconds: number | null;
  timelineStartSeconds: number;
  volume: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  metadata: {
    sceneNumber?: number;
    prompt?: string;
    isCue?: boolean;
    providerJobId?: string;
    error?: string;
  } | null;
}

const TIMELINE_LEFT_PADDING = 30;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Helper to get marker interval based on zoom level
function getMarkerInterval(pps: number): number {
  if (pps >= 120) return 1; // Every 1 second when zoomed in
  if (pps >= 60) return 5; // Every 5 seconds
  return 15; // Every 15 seconds when zoomed out
}

export function MusicTimeline({
  episodeId,
  totalDuration,
  scenes,
  onRefresh,
  pixelsPerSecond,
}: MusicTimelineProps) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(false);
  const [showSceneDialog, setShowSceneDialog] = useState(false);
  const [showCueDialog, setShowCueDialog] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<MusicTrack | null>(null);

  // Fetch music tracks (user-generated) AND music cues (auto-generated from shots)
  const fetchTracks = useCallback(async () => {
    try {
      // Fetch both user-created tracks and auto-generated cues
      const [tracksResult, cuesResult] = await Promise.all([
        getAudioTracksAction({ episodeId, type: 'music' }),
        getAudioCuesAction({ episodeId }),
      ]);

      // Map user-created tracks
      const userTracks: MusicTrack[] = tracksResult.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        fileUrl: t.fileUrl,
        durationSeconds: t.durationSeconds,
        timelineStartSeconds: t.timelineStartSeconds,
        volume: t.volume,
        status: t.status,
        metadata: t.metadata as MusicTrack['metadata'],
      }));

      // Map auto-generated music cues
      const musicCues: MusicTrack[] = (cuesResult.cues as Array<{
        id: string;
        cue_type: string;
        prompt: string;
        scene_number: number;
        start_offset_seconds: number | null;
        duration_seconds: number | null;
        status: string | null;
        audio_assets: { id: string; file_url: string | null; duration_seconds: number | null } | null;
      }>)
        .filter((c) => c.cue_type === 'music')
        .map((c) => ({
          id: `cue-${c.id}`,
          name: c.prompt.substring(0, 50),
          fileUrl: c.audio_assets?.file_url ?? null,
          durationSeconds: c.audio_assets?.duration_seconds ?? c.duration_seconds ?? 30,
          timelineStartSeconds: c.start_offset_seconds ?? 0,
          volume: 1,
          status: c.status === 'placed' || c.status === 'matched'
            ? 'completed'
            : c.status === 'pending'
              ? 'pending'
              : c.status === 'generating'
                ? 'processing'
                : 'failed' as const,
          metadata: {
            sceneNumber: c.scene_number,
            prompt: c.prompt,
            isCue: true,
          },
        }));

      // Combine and sort by timeline position
      const combined = [...userTracks, ...musicCues].sort(
        (a, b) => a.timelineStartSeconds - b.timelineStartSeconds
      );

      setTracks(combined);
    } catch (error) {
      console.error('Failed to fetch music tracks:', error);
      toast.error('Failed to load music tracks');
    } finally {
      setIsLoading(false);
    }
  }, [episodeId]);

  useEffect(() => {
    void fetchTracks();
  }, [fetchTracks]);

  // Poll for processing tracks
  useEffect(() => {
    const processingTracks = tracks.filter((t) => t.status === 'processing');
    if (processingTracks.length === 0) return;

    const pollInterval = setInterval(async () => {
      setIsPolling(true);
      let hasChanges = false;

      for (const track of processingTracks) {
        try {
          const result = await pollMusicStatusAction({ trackId: track.id });
          if (result.status !== 'processing') {
            hasChanges = true;
            if (result.status === 'completed') {
              toast.success(`Music track "${track.name}" is ready`);
            } else if (result.status === 'failed') {
              toast.error(
                `Music generation failed: ${result.error ?? 'Unknown error'}`,
              );
            }
          }
        } catch (error) {
          console.error('Failed to poll track status:', error);
        }
      }

      if (hasChanges) {
        void fetchTracks();
        onRefresh?.();
      }
      setIsPolling(false);
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [tracks, fetchTracks, onRefresh]);

  // Time markers
  const timeMarkers = useMemo(() => {
    const total = totalDuration > 0 ? totalDuration : 90;
    const markerInterval = getMarkerInterval(pixelsPerSecond);
    const markers: number[] = [];
    for (let t = 0; t <= total; t += markerInterval) {
      markers.push(t);
    }
    return markers;
  }, [totalDuration, pixelsPerSecond]);

  // Calculate scene positions for visual reference
  const scenePositions = useMemo(() => {
    const positions: Array<{ number: number; start: number; end: number }> = [];
    let currentTime = 0;
    for (const scene of scenes) {
      positions.push({
        number: scene.number,
        start: currentTime,
        end: currentTime + scene.estimatedDuration,
      });
      currentTime += scene.estimatedDuration;
    }
    return positions;
  }, [scenes]);

  const handlePlayTrack = (track: MusicTrack) => {
    if (!track.fileUrl) {
      toast.error('No audio available');
      return;
    }
    const audio = new Audio(track.fileUrl);
    audio.play();
  };

  const handleDeleteTrack = async (track: MusicTrack) => {
    try {
      await deleteAudioTrackAction({ trackId: track.id });
      toast.success('Music track deleted');
      void fetchTracks();
      onRefresh?.();
    } catch {
      toast.error('Failed to delete track');
    }
  };

  const handleGenerationComplete = () => {
    void fetchTracks();
    onRefresh?.();
  };

  if (isLoading) {
    return (
      <div className="flex h-full flex-col bg-background">
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

  // Calculate timeline width for consistent use
  const timelineWidth = Math.max(
    effectiveDuration * pixelsPerSecond + TIMELINE_LEFT_PADDING + 40,
    800,
  );

  return (
    <div className="relative flex h-full flex-col bg-card">
      {/* Header with actions */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200/50 px-4 py-2 dark:border-gray-700/50">
        <div className="flex items-center gap-2">
          <Music className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Music Tracks ({tracks.length})
          </span>
          {isPolling && (
            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSceneDialog(true)}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Generate for Scene
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCueDialog(true)}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Cue
          </Button>
        </div>
      </div>

      {/* Single scroll container for ruler and content */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {/* Time Ruler - sticky at top */}
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
            <div className="absolute bottom-0 left-0 h-1.5 w-full">
              {timeMarkers.map((time) => (
                <span
                  key={time}
                  className="absolute h-full w-px bg-gray-300 dark:bg-gray-700"
                  style={{
                    left: `${TIMELINE_LEFT_PADDING + time * pixelsPerSecond}px`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Timeline Content */}
        <div className="p-4" style={{ width: `${timelineWidth}px` }}>
          {tracks.length === 0 ? (
            <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
              <div className="text-center">
                <Music className="mx-auto mb-3 h-12 w-12 opacity-30" />
                <p>No music tracks yet</p>
                <p className="mt-1 text-sm">
                  Generate music for a scene or add a cue manually
                </p>
              </div>
            </div>
          ) : (
            <div
              className="relative space-y-3"
              style={{
                paddingLeft: TIMELINE_LEFT_PADDING,
              }}
            >
              {/* Scene markers (subtle background) */}
              <div
                className="absolute top-0 left-0 h-full"
                style={{
                  paddingLeft: TIMELINE_LEFT_PADDING,
                  width: `${timelineWidth}px`,
                }}
              >
                {scenePositions.map((scene) => {
                  // Pixel-based positioning
                  const leftPx = scene.start * pixelsPerSecond;
                  const widthPx = (scene.end - scene.start) * pixelsPerSecond;
                  return (
                    <div
                      key={scene.number}
                      className="absolute top-0 h-full border-l border-border"
                      style={{
                        left: `${leftPx}px`,
                        width: `${widthPx}px`,
                      }}
                    >
                      <span className="absolute top-0 left-1 text-[9px] text-gray-300 dark:text-gray-600">
                        S{scene.number}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Music tracks */}
              {tracks.map((track) => {
                // Pixel-based positioning
                const leftPx = track.timelineStartSeconds * pixelsPerSecond;
                const widthPx = track.durationSeconds
                  ? Math.max(track.durationSeconds * pixelsPerSecond, 140)
                  : 140;

                return (
                  <div key={track.id} className="relative h-14">
                    <div
                      className={cn(
                        'absolute flex cursor-pointer items-center gap-2 rounded-lg border p-2 shadow-sm transition-all hover:shadow-md',
                        track.status === 'completed'
                          ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/30'
                          : track.status === 'processing'
                            ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/30'
                            : track.status === 'failed'
                              ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/30'
                              : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800',
                        selectedTrack?.id === track.id &&
                        'ring-2 ring-blue-500 ring-offset-2',
                      )}
                      style={{
                        left: `${leftPx}px`,
                        width: `${widthPx}px`,
                      }}
                      onClick={() => setSelectedTrack(track)}
                    >
                      {/* Status icon */}
                      {track.status === 'processing' ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
                      ) : track.status === 'completed' ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayTrack(track);
                          }}
                          className="shrink-0 rounded-full bg-green-500 p-1 text-white hover:bg-green-600"
                        >
                          <Play className="h-3 w-3" />
                        </button>
                      ) : track.status === 'failed' ? (
                        <RefreshCw className="h-4 w-4 shrink-0 text-red-500" />
                      ) : (
                        <Music className="h-4 w-4 shrink-0 text-gray-400" />
                      )}

                      {/* Track info */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">
                          {track.name ?? 'Music'}
                        </p>
                        <p className="truncate text-[10px] text-gray-500 dark:text-gray-400">
                          {track.durationSeconds
                            ? formatTime(track.durationSeconds)
                            : '--:--'}
                          {track.metadata?.sceneNumber &&
                            ` | Scene ${track.metadata.sceneNumber}`}
                        </p>
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteTrack(track);
                        }}
                        className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-red-500 dark:hover:bg-gray-700"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <GenerateSceneMusicDialog
        open={showSceneDialog}
        onOpenChange={setShowSceneDialog}
        episodeId={episodeId}
        scenes={scenes}
        onSuccess={handleGenerationComplete}
      />

      <AddMusicCueDialog
        open={showCueDialog}
        onOpenChange={setShowCueDialog}
        episodeId={episodeId}
        totalDuration={effectiveDuration}
        onSuccess={handleGenerationComplete}
      />
    </div>
  );
}
