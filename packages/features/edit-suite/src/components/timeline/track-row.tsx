'use client';

/**
 * TrackRow — single track in the timeline.
 *
 * Left side: TrackHeader with name, mute/solo/lock, volume slider.
 * Right side: ClipLane where clips are rendered and assets can be dropped.
 */

import type { EditTrack, EditClip } from '../../lib/types';
import type { EditAction } from '../../state/types';
import type { Dispatch } from 'react';
import { ClipBlock } from './clip-block';
import { DRAG_CLIP_MIME } from '../media-bin/asset-item';
import type { DragClipData } from '../../hooks/use-media-bin';

// ──────────────────────────────────────────
// Track type colors
// ──────────────────────────────────────────

const TRACK_COLORS: Record<string, { bg: string; border: string; clip: string }> = {
    video: { bg: 'bg-blue-950/30', border: 'border-blue-800/50', clip: 'bg-blue-600/60' },
    dialogue: { bg: 'bg-green-950/30', border: 'border-green-800/50', clip: 'bg-green-600/60' },
    dubbed: { bg: 'bg-teal-950/30', border: 'border-teal-800/50', clip: 'bg-teal-600/60' },
    music: { bg: 'bg-purple-950/30', border: 'border-purple-800/50', clip: 'bg-purple-600/60' },
    sfx: { bg: 'bg-orange-950/30', border: 'border-orange-800/50', clip: 'bg-orange-600/60' },
    ambient: { bg: 'bg-cyan-950/30', border: 'border-cyan-800/50', clip: 'bg-cyan-600/60' },
};

// ──────────────────────────────────────────
// TrackHeader
// ──────────────────────────────────────────

function TrackHeader({
    track,
    dispatch,
}: {
    track: EditTrack;
    dispatch: Dispatch<EditAction>;
}) {
    const toggleProp = (prop: 'isMuted' | 'isSolo' | 'isLocked') => {
        dispatch({
            type: 'UPDATE_TRACK',
            payload: {
                trackId: track.id,
                changes: { [prop]: !track[prop] },
            },
        });
    };

    return (
        <div className="flex w-[140px] flex-shrink-0 flex-col gap-1 border-r border-zinc-700 px-2 py-1.5">
            {/* Track name */}
            <span className="truncate text-[11px] font-medium text-zinc-300">{track.name}</span>

            {/* Controls */}
            <div className="flex items-center gap-1">
                <button
                    className={`rounded px-1 py-0.5 text-[9px] font-bold transition-colors ${track.isMuted ? 'bg-red-900/60 text-red-300' : 'text-zinc-500 hover:bg-zinc-700'
                        }`}
                    onClick={() => toggleProp('isMuted')}
                    title="Mute"
                >
                    M
                </button>
                <button
                    className={`rounded px-1 py-0.5 text-[9px] font-bold transition-colors ${track.isSolo ? 'bg-yellow-900/60 text-yellow-300' : 'text-zinc-500 hover:bg-zinc-700'
                        }`}
                    onClick={() => toggleProp('isSolo')}
                    title="Solo"
                >
                    S
                </button>
                <button
                    className={`rounded px-1 py-0.5 text-[9px] font-bold transition-colors ${track.isLocked ? 'bg-zinc-600 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-700'
                        }`}
                    onClick={() => toggleProp('isLocked')}
                    title="Lock"
                >
                    🔒
                </button>

                {/* Volume slider */}
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={track.volume}
                    onChange={(e) =>
                        dispatch({
                            type: 'UPDATE_TRACK',
                            payload: {
                                trackId: track.id,
                                changes: { volume: parseFloat(e.target.value) },
                            },
                        })
                    }
                    className="ml-auto h-1 w-12 cursor-pointer accent-violet-500"
                    title={`Volume: ${Math.round(track.volume * 100)}%`}
                />
            </div>
        </div>
    );
}

// ──────────────────────────────────────────
// TrackRow
// ──────────────────────────────────────────

interface TrackRowProps {
    track: EditTrack;
    clips: EditClip[];
    allClips: EditClip[];
    zoom: number; // px per second
    playheadMs: number;
    selectedClipIds: Set<string>;
    dispatch: Dispatch<EditAction>;
}

export function TrackRow({ track, clips, allClips, zoom, playheadMs, selectedClipIds, dispatch }: TrackRowProps) {
    const colors = TRACK_COLORS[track.type] ?? TRACK_COLORS.video!;

    const handleDragOver = (e: React.DragEvent) => {
        if (track.isLocked) return;
        if (e.dataTransfer.types.includes(DRAG_CLIP_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        if (track.isLocked) return;
        const raw = e.dataTransfer.getData(DRAG_CLIP_MIME);
        if (!raw) return;
        e.preventDefault();

        try {
            const dragData = JSON.parse(raw) as DragClipData;

            // Calculate drop position in ms based on mouse X relative to clip lane
            const rect = e.currentTarget.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const startMs = Math.max(0, Math.round((offsetX / zoom) * 1000));

            // Create a new clip from the dropped asset
            const clipId = crypto.randomUUID();
            dispatch({
                type: 'ADD_CLIP',
                payload: {
                    clip: {
                        id: clipId,
                        trackId: track.id,
                        sourceShotId: dragData.type === 'shot' ? dragData.assetId : null,
                        sourceDialogueId: dragData.type === 'dialogue' ? dragData.assetId : null,
                        sourceDubbedDialogueId: dragData.type === 'dubbed' ? dragData.assetId : null,
                        sourceAudioTrackId: ['music', 'sfx', 'ambient'].includes(dragData.type) ? dragData.assetId : null,
                        sourceUploadUrl: dragData.type === 'upload' ? (dragData.mediaUrl ?? null) : null,
                        mediaUrl: dragData.mediaUrl,
                        thumbnailUrl: dragData.thumbnailUrl,
                        startMs,
                        endMs: startMs + dragData.durationMs,
                        inPointMs: 0,
                        outPointMs: dragData.durationMs,
                        volume: 1,
                        speed: 1,
                        fadeInMs: 0,
                        fadeOutMs: 0,
                        sortOrder: clips.length,
                        syncGroupId: null,
                        language: null,
                        isActive: true,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    },
                },
            });
        } catch {
            console.error('Failed to parse drop data');
        }
    };

    return (
        <div className={`flex border-b ${colors.border}`} style={{ height: `${track.height}px` }}>
            <TrackHeader track={track} dispatch={dispatch} />

            {/* Clip lane */}
            <div
                className={`relative flex-1 ${colors.bg}`}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                {clips.map((clip) => (
                    <ClipBlock
                        key={clip.id}
                        clip={clip}
                        zoom={zoom}
                        isSelected={selectedClipIds.has(clip.id)}
                        colorClass={colors.clip}
                        dispatch={dispatch}
                        allClips={allClips}
                        playheadMs={playheadMs}
                    />
                ))}
            </div>
        </div>
    );
}
