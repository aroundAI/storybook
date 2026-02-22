'use client';

/**
 * Preview Panel — center area for video preview.
 *
 * Stub implementation. Will contain:
 * - Canvas element for composited video preview
 * - Playback controls (play/pause/stop)
 * - Timecode display
 */

import { useEditSuite } from '../edit-suite-provider';

function formatTimecode(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const frames = Math.floor((ms % 1000) / (1000 / 30)); // 30fps
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function PreviewPanel() {
    const { state, dispatch } = useEditSuite();

    return (
        <div className="preview-panel">
            {/* Canvas area */}
            <div className="preview-canvas-container">
                <div
                    className="preview-canvas-placeholder"
                    style={{ aspectRatio: `${state.project?.width ?? 1920} / ${state.project?.height ?? 1080}` }}
                >
                    <span className="preview-canvas-label">
                        {state.project
                            ? `${state.project.width}×${state.project.height} @ ${state.project.fps}fps`
                            : 'No project loaded'}
                    </span>
                </div>
            </div>

            {/* Playback controls */}
            <div className="preview-controls">
                <button
                    className="preview-control-btn"
                    onClick={() => dispatch({ type: 'SET_PLAYHEAD', payload: { ms: 0 } })}
                    title="Go to start"
                >
                    ⏮
                </button>
                <button
                    className="preview-control-btn preview-control-btn-play"
                    onClick={() => dispatch({ type: 'SET_PLAYING', payload: { isPlaying: !state.isPlaying } })}
                    title={state.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                >
                    {state.isPlaying ? '⏸' : '▶'}
                </button>
                <button
                    className="preview-control-btn"
                    onClick={() => {
                        dispatch({ type: 'SET_PLAYING', payload: { isPlaying: false } });
                        dispatch({ type: 'SET_PLAYHEAD', payload: { ms: 0 } });
                    }}
                    title="Stop"
                >
                    ⏹
                </button>

                <span className="preview-timecode">
                    {formatTimecode(state.playheadMs)}
                </span>
            </div>

            <style>{`
                .preview-panel {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    gap: 12px;
                    padding: 16px;
                }

                .preview-canvas-container {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    min-height: 0;
                }

                .preview-canvas-placeholder {
                    max-width: 100%;
                    max-height: 100%;
                    width: 100%;
                    background: #111113;
                    border: 1px solid #27272a;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .preview-canvas-label {
                    font-size: 13px;
                    color: #52525b;
                }

                .preview-controls {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .preview-control-btn {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    border: 1px solid #3f3f46;
                    border-radius: 6px;
                    background: #27272a;
                    color: #d4d4d8;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.15s;
                }

                .preview-control-btn:hover {
                    background: #3f3f46;
                }

                .preview-control-btn-play {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: #7c3aed;
                    border-color: #6d28d9;
                    color: #fff;
                    font-size: 16px;
                }

                .preview-control-btn-play:hover {
                    background: #6d28d9;
                }

                .preview-timecode {
                    font-family: 'JetBrains Mono', 'Fira Code', monospace;
                    font-size: 14px;
                    color: #a1a1aa;
                    padding: 0 8px;
                    min-width: 80px;
                    text-align: center;
                }
            `}</style>
        </div>
    );
}
