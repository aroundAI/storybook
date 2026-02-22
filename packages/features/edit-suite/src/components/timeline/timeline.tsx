'use client';

/**
 * Timeline — bottom panel with track-based timeline editor.
 *
 * Stub implementation. Will contain:
 * - TimelineRuler with time markers
 * - Playhead (vertical line)
 * - TrackList with TrackRow per track
 * - ClipLane with ClipBlock per clip
 * - Horizontal + vertical scrolling
 */

import { cn } from '@kit/ui/utils';

import { useEditSuite } from '../edit-suite-provider';

const TRACK_COLORS: Record<string, string> = {
    video: 'from-blue-500 to-blue-600',
    dialogue: 'from-green-500 to-green-600',
    music: 'from-purple-500 to-purple-600',
    sfx: 'from-orange-500 to-orange-600',
    ambient: 'from-cyan-500 to-cyan-600',
    title: 'from-yellow-500 to-yellow-600',
    upload: 'from-slate-500 to-slate-600',
};

const TRACK_DOT_COLORS: Record<string, string> = {
    video: 'bg-blue-500',
    dialogue: 'bg-green-500',
    music: 'bg-purple-500',
    sfx: 'bg-orange-500',
    ambient: 'bg-cyan-500',
    title: 'bg-yellow-500',
    upload: 'bg-slate-500',
};

export function Timeline() {
    const { state } = useEditSuite();
    const sortedTracks = [...state.tracks].sort((a, b) => a.sortOrder - b.sortOrder);

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[#0f0f12]">
            {/* Track headers + lanes */}
            <div className="flex min-h-0 flex-1 overflow-y-auto">
                {/* Track headers column */}
                <div className="w-40 min-w-[160px] shrink-0 border-r border-zinc-800 bg-zinc-900">
                    <div className="flex h-7 items-center border-b border-zinc-800 px-2.5">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-600">
                            Tracks
                        </span>
                    </div>
                    {sortedTracks.map((track) => (
                        <div
                            key={track.id}
                            className="flex h-12 cursor-pointer items-center gap-1.5 border-b border-[#1a1a1f] px-2.5 transition-colors hover:bg-[#1f1f23]"
                        >
                            <div className={cn('h-2 w-2 shrink-0 rounded-sm', TRACK_DOT_COLORS[track.type] ?? 'bg-zinc-500')} />
                            <span className="truncate text-xs text-zinc-300">{track.name}</span>
                        </div>
                    ))}
                    {sortedTracks.length === 0 && (
                        <div className="flex items-center justify-center p-5 text-xs text-zinc-600">
                            No tracks
                        </div>
                    )}
                </div>

                {/* Track lanes (scrollable) */}
                <div className="relative min-w-0 flex-1 overflow-x-auto">
                    {/* Ruler */}
                    <div className="sticky top-0 z-[2] h-7 border-b border-zinc-800 bg-[#0f0f12]">
                        <TimelineRuler zoom={state.zoom} />
                    </div>

                    {/* Clip lanes */}
                    {sortedTracks.map((track) => {
                        const trackClips = state.clips.filter(
                            (c) => c.trackId === track.id && c.isActive,
                        );
                        return (
                            <div key={track.id} className="relative h-12 border-b border-[#1a1a1f]">
                                {trackClips.map((clip) => (
                                    <div
                                        key={clip.id}
                                        className={cn(
                                            'absolute top-1 h-10 min-w-1 rounded bg-gradient-to-br opacity-90',
                                            TRACK_COLORS[track.type] ?? 'from-zinc-500 to-zinc-600',
                                        )}
                                        style={{
                                            left: `${(clip.startMs / 1000) * state.zoom}px`,
                                            width: `${((clip.endMs - clip.startMs) / 1000) * state.zoom}px`,
                                        }}
                                        title={`${clip.startMs}ms – ${clip.endMs}ms`}
                                    />
                                ))}
                            </div>
                        );
                    })}

                    {sortedTracks.length === 0 && (
                        <div className="flex items-center justify-center p-5 text-xs text-zinc-600">
                            <p>Open the Edit Suite to auto-assemble your timeline</p>
                        </div>
                    )}

                    {/* Playhead */}
                    <div
                        className="pointer-events-none absolute inset-y-0 z-[5] w-0.5 bg-red-500"
                        style={{ left: `${(state.playheadMs / 1000) * state.zoom}px` }}
                    >
                        <div className="absolute -left-[5px] top-0 h-0 w-0 border-l-[6px] border-r-[6px] border-t-[10px] border-l-transparent border-r-transparent border-t-red-500" />
                    </div>
                </div>
            </div>
        </div>
    );
}

function TimelineRuler({ zoom }: { zoom: number }) {
    // Generate tick marks every second
    const tickInterval = zoom >= 100 ? 1 : zoom >= 30 ? 5 : 10; // seconds
    const totalSeconds = 300; // 5 min default
    const ticks: { second: number; left: number }[] = [];

    for (let s = 0; s <= totalSeconds; s += tickInterval) {
        ticks.push({ second: s, left: s * zoom });
    }

    return (
        <div className="relative h-full min-w-full">
            {ticks.map((tick) => (
                <div
                    key={tick.second}
                    className="absolute inset-y-0 w-px bg-zinc-800"
                    style={{ left: `${tick.left}px` }}
                >
                    <span className="absolute left-1 top-1 whitespace-nowrap text-[9px] text-zinc-600">
                        {Math.floor(tick.second / 60)}:{String(tick.second % 60).padStart(2, '0')}
                    </span>
                </div>
            ))}
        </div>
    );
}
