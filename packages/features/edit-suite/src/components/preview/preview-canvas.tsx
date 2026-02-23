'use client';

/**
 * PreviewCanvas — composites video clips onto a canvas element.
 *
 * Maintains a pool of hidden <video> elements, one per active clip.
 * On each tick, seeks videos to the correct frame and draws them
 * onto the canvas in track sort order (bottom track first).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { EditClip } from '../../lib/types';
import { useEditSuite } from '../edit-suite-provider';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface VideoPoolEntry {
    video: HTMLVideoElement;
    clipId: string;
    sourceUrl: string;
    lastSeekMs: number;
}

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const SEEK_THRESHOLD_MS = 50; // Don't re-seek if within this tolerance
const MAX_POOL_SIZE = 8;      // Maximum simultaneous video elements

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

interface PreviewCanvasProps {
    width: number;
    height: number;
}

export function PreviewCanvas({ width, height }: PreviewCanvasProps) {
    const { state } = useEditSuite();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoPoolRef = useRef<Map<string, VideoPoolEntry>>(new Map());
    const rafRef = useRef<number | null>(null);

    // Find video clips that overlap the current playhead
    const activeVideoClips = useMemo(() => {
        const ms = state.playheadMs;

        // Get video track IDs (only composite video tracks)
        const videoTrackIds = new Set(
            state.tracks
                .filter((t) => t.type === 'video')
                .map((t) => t.id),
        );

        return state.clips
            .filter(
                (clip) =>
                    videoTrackIds.has(clip.trackId) &&
                    clip.startMs <= ms &&
                    clip.endMs > ms &&
                    clip.isActive &&
                    clip.mediaUrl,
            )
            .sort((a, b) => {
                // Sort by track sort order (lower = drawn first = background)
                const trackA = state.tracks.find((t) => t.id === a.trackId);
                const trackB = state.tracks.find((t) => t.id === b.trackId);
                return (trackA?.sortOrder ?? 0) - (trackB?.sortOrder ?? 0);
            });
    }, [state.playheadMs, state.clips, state.tracks]);

    // Get or create a video element for a clip
    const getVideo = useCallback((clip: EditClip): HTMLVideoElement | null => {
        const pool = videoPoolRef.current;
        const existing = pool.get(clip.id);

        if (existing && existing.sourceUrl === clip.mediaUrl) {
            return existing.video;
        }

        // Create new video element
        if (pool.size >= MAX_POOL_SIZE) {
            // Evict the oldest entry not in active set
            const activeIds = new Set(activeVideoClips.map((c) => c.id));
            for (const [id, entry] of pool) {
                if (!activeIds.has(id)) {
                    entry.video.pause();
                    entry.video.removeAttribute('src');
                    entry.video.load();
                    pool.delete(id);
                    break;
                }
            }
        }

        if (!clip.mediaUrl) return null;

        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.preload = 'auto';
        video.muted = true; // Audio handled separately
        video.playsInline = true;
        video.src = clip.mediaUrl;

        pool.set(clip.id, {
            video,
            clipId: clip.id,
            sourceUrl: clip.mediaUrl,
            lastSeekMs: -1,
        });

        return video;
    }, [activeVideoClips]);

    // Render the current frame
    const renderFrame = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        if (activeVideoClips.length === 0) return;

        for (const clip of activeVideoClips) {
            const video = getVideo(clip);
            if (!video) continue;

            // Calculate the offset within the clip's source media
            const clipOffsetMs = state.playheadMs - clip.startMs + clip.inPointMs;

            // Seek if not already at the right position
            const entry = videoPoolRef.current.get(clip.id);
            if (entry && Math.abs(entry.lastSeekMs - clipOffsetMs) > SEEK_THRESHOLD_MS) {
                video.currentTime = clipOffsetMs / 1000;
                entry.lastSeekMs = clipOffsetMs;
            }

            // Draw the video frame onto the canvas
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                // Scale video to fill canvas while preserving aspect ratio
                const vw = video.videoWidth || width;
                const vh = video.videoHeight || height;
                const scale = Math.max(width / vw, height / vh);
                const drawW = vw * scale;
                const drawH = vh * scale;
                const drawX = (width - drawW) / 2;
                const drawY = (height - drawH) / 2;

                // Apply clip volume as opacity if needed
                const opacity = clip.volume ?? 1;
                ctx.globalAlpha = opacity;
                ctx.drawImage(video, drawX, drawY, drawW, drawH);
                ctx.globalAlpha = 1;
            }
        }
    }, [activeVideoClips, getVideo, state.playheadMs, width, height]);

    // Render on playhead change
    useEffect(() => {
        renderFrame();
    }, [renderFrame]);

    // Continuous render during playback
    useEffect(() => {
        if (!state.isPlaying) {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            return;
        }

        const loop = () => {
            renderFrame();
            rafRef.current = requestAnimationFrame(loop);
        };

        rafRef.current = requestAnimationFrame(loop);

        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [state.isPlaying, renderFrame]);

    // Cleanup video pool on unmount
    useEffect(() => {
        return () => {
            const pool = videoPoolRef.current;
            for (const [, entry] of pool) {
                entry.video.pause();
                entry.video.removeAttribute('src');
                entry.video.load();
            }
            pool.clear();
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="h-full w-full rounded-lg"
            style={{ objectFit: 'contain', background: '#000' }}
        />
    );
}
