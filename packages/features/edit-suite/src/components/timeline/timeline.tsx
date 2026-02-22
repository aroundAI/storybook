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

import { useEditSuite } from '../edit-suite-provider';

export function Timeline() {
    const { state } = useEditSuite();
    const sortedTracks = [...state.tracks].sort((a, b) => a.sortOrder - b.sortOrder);

    return (
        <div className="timeline">
            {/* Track headers + lanes */}
            <div className="timeline-content">
                {/* Track headers column */}
                <div className="timeline-headers">
                    <div className="timeline-ruler-header">
                        <span className="timeline-ruler-label">Tracks</span>
                    </div>
                    {sortedTracks.map((track) => (
                        <TrackHeader key={track.id} name={track.name} type={track.type} />
                    ))}
                    {sortedTracks.length === 0 && (
                        <div className="timeline-empty-header">
                            No tracks
                        </div>
                    )}
                </div>

                {/* Track lanes (scrollable) */}
                <div className="timeline-lanes-scroll">
                    {/* Ruler */}
                    <div className="timeline-ruler">
                        <TimelineRuler zoom={state.zoom} />
                    </div>

                    {/* Clip lanes */}
                    {sortedTracks.map((track) => {
                        const trackClips = state.clips.filter(
                            (c) => c.trackId === track.id && c.isActive,
                        );
                        return (
                            <div key={track.id} className="timeline-lane">
                                {trackClips.map((clip) => (
                                    <div
                                        key={clip.id}
                                        className={`timeline-clip timeline-clip-${track.type}`}
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
                        <div className="timeline-empty-lane">
                            <p>Open the Edit Suite to auto-assemble your timeline</p>
                        </div>
                    )}

                    {/* Playhead */}
                    <div
                        className="timeline-playhead"
                        style={{ left: `${(state.playheadMs / 1000) * state.zoom}px` }}
                    />
                </div>
            </div>

            <style>{`
                .timeline {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: #0f0f12;
                    overflow: hidden;
                }

                .timeline-content {
                    display: flex;
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                }

                .timeline-headers {
                    width: 160px;
                    min-width: 160px;
                    border-right: 1px solid #27272a;
                    background: #18181b;
                    flex-shrink: 0;
                }

                .timeline-ruler-header {
                    height: 28px;
                    display: flex;
                    align-items: center;
                    padding: 0 10px;
                    border-bottom: 1px solid #27272a;
                }

                .timeline-ruler-label {
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: #52525b;
                }

                .timeline-lanes-scroll {
                    flex: 1;
                    overflow-x: auto;
                    position: relative;
                    min-width: 0;
                }

                .timeline-ruler {
                    height: 28px;
                    border-bottom: 1px solid #27272a;
                    position: sticky;
                    top: 0;
                    background: #0f0f12;
                    z-index: 2;
                }

                .timeline-lane {
                    height: 48px;
                    position: relative;
                    border-bottom: 1px solid #1a1a1f;
                }

                .timeline-clip {
                    position: absolute;
                    top: 4px;
                    height: 40px;
                    border-radius: 4px;
                    opacity: 0.9;
                    min-width: 4px;
                }

                .timeline-clip-video {
                    background: linear-gradient(135deg, #3b82f6, #2563eb);
                }

                .timeline-clip-dialogue {
                    background: linear-gradient(135deg, #22c55e, #16a34a);
                }

                .timeline-clip-music {
                    background: linear-gradient(135deg, #a855f7, #7c3aed);
                }

                .timeline-clip-sfx {
                    background: linear-gradient(135deg, #f97316, #ea580c);
                }

                .timeline-clip-ambient {
                    background: linear-gradient(135deg, #06b6d4, #0891b2);
                }

                .timeline-clip-title {
                    background: linear-gradient(135deg, #eab308, #ca8a04);
                }

                .timeline-clip-upload {
                    background: linear-gradient(135deg, #64748b, #475569);
                }

                .timeline-playhead {
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    width: 2px;
                    background: #ef4444;
                    z-index: 5;
                    pointer-events: none;
                }

                .timeline-playhead::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: -5px;
                    width: 12px;
                    height: 12px;
                    background: #ef4444;
                    clip-path: polygon(50% 100%, 0% 0%, 100% 0%);
                }

                .timeline-empty-header,
                .timeline-empty-lane {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    color: #52525b;
                    font-size: 12px;
                }

                /* Track header */
                .track-header {
                    height: 48px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 0 10px;
                    border-bottom: 1px solid #1a1a1f;
                    cursor: pointer;
                    transition: background 0.15s;
                }

                .track-header:hover {
                    background: #1f1f23;
                }

                .track-header-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 2px;
                    flex-shrink: 0;
                }

                .track-header-name {
                    font-size: 12px;
                    color: #d4d4d8;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                /* Ruler ticks */
                .ruler-container {
                    position: relative;
                    height: 100%;
                    min-width: 100%;
                }

                .ruler-tick {
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    width: 1px;
                    background: #27272a;
                }

                .ruler-tick-label {
                    position: absolute;
                    top: 4px;
                    left: 4px;
                    font-size: 9px;
                    color: #52525b;
                    white-space: nowrap;
                }
            `}</style>
        </div>
    );
}

const TRACK_COLORS: Record<string, string> = {
    video: '#3b82f6',
    dialogue: '#22c55e',
    music: '#a855f7',
    sfx: '#f97316',
    ambient: '#06b6d4',
    title: '#eab308',
    upload: '#64748b',
};

function TrackHeader({ name, type }: { name: string; type: string }) {
    return (
        <div className="track-header">
            <div
                className="track-header-dot"
                style={{ backgroundColor: TRACK_COLORS[type] ?? '#71717a' }}
            />
            <span className="track-header-name">{name}</span>
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
        <div className="ruler-container">
            {ticks.map((tick) => (
                <div key={tick.second} className="ruler-tick" style={{ left: `${tick.left}px` }}>
                    <span className="ruler-tick-label">
                        {Math.floor(tick.second / 60)}:{String(tick.second % 60).padStart(2, '0')}
                    </span>
                </div>
            ))}
        </div>
    );
}
