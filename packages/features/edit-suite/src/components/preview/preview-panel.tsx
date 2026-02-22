'use client';

/**
 * Preview Panel — center area for video preview.
 *
 * Stub implementation. Will contain:
 * - Canvas element for composited video preview
 * - Playback controls (play/pause/stop)
 * - Timecode display
 */

import { cn } from '@kit/ui/utils';

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
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
            {/* Canvas area */}
            <div className="flex min-h-0 flex-1 w-full items-center justify-center">
                <div
                    className="flex max-h-full max-w-full w-full items-center justify-center rounded-lg border border-zinc-800 bg-[#111113]"
                    style={{ aspectRatio: `${state.project?.width ?? 1920} / ${state.project?.height ?? 1080}` }}
                >
                    <span className="text-[13px] text-zinc-600">
                        {state.project
                            ? `${state.project.width}×${state.project.height} @ ${state.project.fps}fps`
                            : 'No project loaded'}
                    </span>
                </div>
            </div>

            {/* Playback controls */}
            <div className="flex items-center gap-2">
                <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
                    onClick={() => dispatch({ type: 'SET_PLAYHEAD', payload: { ms: 0 } })}
                    title="Go to start"
                >
                    ⏮
                </button>
                <button
                    className={cn(
                        'inline-flex h-10 w-10 items-center justify-center rounded-full text-base text-white transition-colors',
                        state.isPlaying
                            ? 'bg-violet-600 hover:bg-violet-700'
                            : 'bg-violet-600 hover:bg-violet-700',
                    )}
                    onClick={() => dispatch({ type: 'SET_PLAYING', payload: { isPlaying: !state.isPlaying } })}
                    title={state.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                >
                    {state.isPlaying ? '⏸' : '▶'}
                </button>
                <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
                    onClick={() => {
                        dispatch({ type: 'SET_PLAYING', payload: { isPlaying: false } });
                        dispatch({ type: 'SET_PLAYHEAD', payload: { ms: 0 } });
                    }}
                    title="Stop"
                >
                    ⏹
                </button>

                <span className="min-w-[80px] px-2 text-center font-mono text-sm text-zinc-400">
                    {formatTimecode(state.playheadMs)}
                </span>
            </div>
        </div>
    );
}
