'use client';

/**
 * Preview Panel — center area for video preview + playback controls.
 *
 * Integrates:
 * - PreviewCanvas for video compositing
 * - PlaybackEngine for timeline playback (registered in provider context)
 * - AudioEngine for audio playback (registered in provider context)
 * - Timecode display (MM:SS:FF)
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { cn } from '@kit/ui/utils';

import { AudioEngine } from '../../lib/audio-engine';
import { PlaybackEngine } from '../../lib/playback-engine';
import { useEditSuite } from '../edit-suite-provider';
import { PreviewCanvas } from './preview-canvas';

// ──────────────────────────────────────────
// Timecode formatter
// ──────────────────────────────────────────

function formatTimecode(ms: number, fps: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const frames = Math.floor((ms % 1000) / (1000 / fps));
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

export function PreviewPanel() {
    const { state, dispatch, playbackEngineRef, audioEngineRef } = useEditSuite();
    const containerRef = useRef<HTMLDivElement>(null);

    const fps = state.project?.fps ?? 30;
    const projectWidth = state.project?.width ?? 1920;
    const projectHeight = state.project?.height ?? 1080;

    // Timeline duration for auto-stop
    const durationMs = useMemo(() => {
        const maxEnd = state.clips.reduce((max, c) => Math.max(max, c.endMs), 0);
        return Math.max(60_000, Math.round(maxEnd * 1.2));
    }, [state.clips]);

    // Initialize PlaybackEngine
    useEffect(() => {
        const engine = new PlaybackEngine();
        playbackEngineRef.current = engine;

        engine.onTick = (ms) => {
            dispatch({ type: 'SET_PLAYHEAD', payload: { ms } });
        };

        engine.onPlay = () => {
            dispatch({ type: 'SET_PLAYING', payload: { isPlaying: true } });
        };

        engine.onPause = () => {
            dispatch({ type: 'SET_PLAYING', payload: { isPlaying: false } });
        };

        return () => {
            engine.dispose();
            playbackEngineRef.current = null;
        };
    }, [dispatch, playbackEngineRef]);

    // Initialize AudioEngine
    useEffect(() => {
        const audio = new AudioEngine();
        audioEngineRef.current = audio;

        return () => {
            audio.dispose();
            audioEngineRef.current = null;
        };
    }, [audioEngineRef]);

    // Update engine config when project changes
    useEffect(() => {
        const engine = playbackEngineRef.current;
        if (!engine) return;
        engine.setDuration(durationMs);
        engine.setFps(fps);
    }, [durationMs, fps, playbackEngineRef]);

    // Sync engine position when playhead is dragged (external seek)
    useEffect(() => {
        const engine = playbackEngineRef.current;
        if (!engine || engine.isPlaying) return;

        // Only sync when not playing — during playback the engine drives the playhead
        if (Math.abs(engine.currentMs - state.playheadMs) > 50) {
            engine.seekTo(state.playheadMs);
        }
    }, [state.playheadMs, playbackEngineRef]);

    // Start/stop audio on play/pause
    useEffect(() => {
        const audio = audioEngineRef.current;
        if (!audio) return;

        if (state.isPlaying) {
            const engine = playbackEngineRef.current;
            void audio.startPlayback(
                state.playheadMs,
                state.clips,
                state.tracks,
                engine?.speed ?? 1,
            );
        } else {
            audio.stopPlayback();
        }
    }, [state.isPlaying, audioEngineRef, playbackEngineRef]);

    // Sync audio on playhead tick during playback
    useEffect(() => {
        if (!state.isPlaying) return;
        const audio = audioEngineRef.current;
        if (!audio) return;

        const engine = playbackEngineRef.current;
        void audio.syncToPlayhead(
            state.playheadMs,
            state.clips,
            state.tracks,
            engine?.speed ?? 1,
        );
    }, [state.playheadMs, state.isPlaying, state.clips, state.tracks, audioEngineRef, playbackEngineRef]);

    // Update track gain nodes when mute/solo/volume changes
    useEffect(() => {
        audioEngineRef.current?.updateTracks(state.tracks);
    }, [state.tracks, audioEngineRef]);

    // Preload audio buffers when clips change
    useEffect(() => {
        audioEngineRef.current?.preloadClips(state.clips);
    }, [state.clips, audioEngineRef]);

    // ── Playback control handlers ──

    const handlePlayPause = useCallback(() => {
        playbackEngineRef.current?.togglePlayPause();
    }, [playbackEngineRef]);

    const handleStop = useCallback(() => {
        playbackEngineRef.current?.stop();
    }, [playbackEngineRef]);

    const handleGoToStart = useCallback(() => {
        playbackEngineRef.current?.seekTo(0);
    }, [playbackEngineRef]);

    // Speed indicator for shuttle
    const speedLabel = useMemo(() => {
        const engine = playbackEngineRef.current;
        if (!engine || !state.isPlaying) return null;
        const speed = engine.speed;
        if (speed === 1) return null;
        return `${speed}×`;
    }, [state.isPlaying, playbackEngineRef]);

    return (
        <div
            ref={containerRef}
            className="flex h-full flex-col items-center justify-center gap-3 p-4"
            tabIndex={-1}
        >
            {/* Canvas area */}
            <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                <div
                    className="relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-black"
                    style={{ aspectRatio: `${projectWidth} / ${projectHeight}` }}
                >
                    {state.project ? (
                        <PreviewCanvas width={projectWidth} height={projectHeight} />
                    ) : (
                        <span className="text-[13px] text-zinc-600">
                            No project loaded
                        </span>
                    )}

                    {/* Speed overlay */}
                    {speedLabel && (
                        <div className="absolute right-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-medium text-amber-400">
                            {speedLabel}
                        </div>
                    )}
                </div>
            </div>

            {/* Playback controls */}
            <div className="flex items-center gap-2">
                <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
                    onClick={handleGoToStart}
                    title="Go to start"
                >
                    ⏮
                </button>
                <button
                    className={cn(
                        'inline-flex h-10 w-10 items-center justify-center rounded-full text-base text-white transition-colors',
                        state.isPlaying
                            ? 'bg-amber-600 hover:bg-amber-700'
                            : 'bg-violet-600 hover:bg-violet-700',
                    )}
                    onClick={handlePlayPause}
                    title={state.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                >
                    {state.isPlaying ? '⏸' : '▶'}
                </button>
                <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
                    onClick={handleStop}
                    title="Stop"
                >
                    ⏹
                </button>

                <span className="min-w-[80px] px-2 text-center font-mono text-sm text-zinc-400">
                    {formatTimecode(state.playheadMs, fps)}
                </span>
            </div>
        </div>
    );
}
