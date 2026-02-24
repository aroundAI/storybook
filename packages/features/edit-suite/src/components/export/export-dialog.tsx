'use client';

/**
 * Export Dialog — modal for exporting the Edit Suite project.
 *
 * Features:
 * - FFmpeg command preview (copyable)
 * - Language selector for per-language export
 * - "Export All Languages" option
 * - Render status display
 */

import { useState, useCallback, useMemo } from 'react';

import { cn } from '@kit/ui/utils';

import { useEditSuite } from '../edit-suite-provider';
import { buildFFmpegCommand } from '../../lib/ffmpeg-builder';

// ──────────────────────────────────────────
// ExportDialog
// ──────────────────────────────────────────

interface ExportDialogProps {
    open: boolean;
    onClose: () => void;
}

/** Only allow http/https URLs to prevent javascript: or data: URI attacks */
function isSafeUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
    const { state, availableLanguages } = useEditSuite();
    const [selectedLang, setSelectedLang] = useState<string | 'all'>(state.activeLanguage);
    const [copied, setCopied] = useState(false);

    // Build FFmpeg command for the selected language
    const ffmpegResult = useMemo(() => {
        if (!state.project) return null;

        // Filter clips by selected language
        const exportClips = selectedLang === 'all'
            ? state.clips.filter((c) => c.isActive && c.mediaUrl)
            : state.clips.filter((c) => {
                if (!c.mediaUrl) return false;
                // Non-dialogue clips (no language) are always included
                if (!c.language) return c.isActive;
                // Dialogue clips must match selected language
                return c.language === selectedLang;
            });

        const outputFile = selectedLang === 'all'
            ? 'output_all_languages.mp4'
            : `output_${selectedLang}.mp4`;

        return buildFFmpegCommand(
            state.project,
            state.tracks,
            exportClips,
            state.transitions,
            state.keyframes,
            outputFile,
        );
    }, [state, selectedLang]);

    const handleCopy = useCallback(async () => {
        if (!ffmpegResult) return;
        await navigator.clipboard.writeText(ffmpegResult.command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [ffmpegResult]);

    if (!open) return null;

    const renderStatus = state.project?.renderStatus ?? 'idle';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-[680px] max-h-[80vh] flex flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-zinc-700 px-5 py-3">
                    <h2 className="text-sm font-semibold text-white">🎬 Export Video</h2>
                    <button
                        className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                        onClick={onClose}
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                    {/* Language selector */}
                    {availableLanguages.length > 1 && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-zinc-400">Export Language</label>
                            <div className="flex flex-wrap gap-2">
                                {availableLanguages.map((lang) => (
                                    <button
                                        key={lang}
                                        className={cn(
                                            'rounded-md border px-3 py-1.5 text-xs transition-all',
                                            selectedLang === lang
                                                ? 'border-violet-500 bg-violet-600 text-white'
                                                : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600',
                                        )}
                                        onClick={() => setSelectedLang(lang)}
                                    >
                                        {lang.toUpperCase()}
                                    </button>
                                ))}
                                <button
                                    className={cn(
                                        'rounded-md border px-3 py-1.5 text-xs transition-all',
                                        selectedLang === 'all'
                                            ? 'border-violet-500 bg-violet-600 text-white'
                                            : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600',
                                    )}
                                    onClick={() => setSelectedLang('all')}
                                >
                                    🌐 All Languages
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Render status */}
                    {renderStatus !== 'idle' && (
                        <div className={cn(
                            'rounded-lg border p-3 text-xs',
                            renderStatus === 'rendering' && 'border-blue-500/30 bg-blue-950/30 text-blue-300',
                            renderStatus === 'completed' && 'border-green-500/30 bg-green-950/30 text-green-300',
                            renderStatus === 'failed' && 'border-red-500/30 bg-red-950/30 text-red-300',
                        )}>
                            {renderStatus === 'rendering' && '⟳ Rendering in progress…'}
                            {renderStatus === 'completed' && (
                                <span>
                                    ✓ Render complete
                                    {state.project?.renderUrl && isSafeUrl(state.project.renderUrl) && (
                                        <a
                                            href={state.project.renderUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="ml-2 underline hover:text-green-200"
                                        >
                                            Download ↗
                                        </a>
                                    )}
                                </span>
                            )}
                            {renderStatus === 'failed' && (
                                <span>✕ Render failed{state.project?.renderError ? `: ${state.project.renderError}` : ''}</span>
                            )}
                        </div>
                    )}

                    {/* FFmpeg command preview */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-zinc-400">FFmpeg Command</label>
                            <button
                                className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 transition-all hover:border-zinc-600"
                                onClick={() => void handleCopy()}
                            >
                                {copied ? '✓ Copied!' : '📋 Copy'}
                            </button>
                        </div>
                        <pre className="max-h-[280px] overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-[11px] leading-relaxed text-emerald-400 font-mono">
                            {ffmpegResult?.command ?? '# No project loaded'}
                        </pre>
                    </div>

                    {/* Stats */}
                    {ffmpegResult && (
                        <div className="grid grid-cols-3 gap-3 text-center">
                            <div className="rounded-lg border border-zinc-800 bg-zinc-800/50 py-2">
                                <div className="text-lg font-bold text-white">{ffmpegResult.inputs.length}</div>
                                <div className="text-[10px] text-zinc-500">Input files</div>
                            </div>
                            <div className="rounded-lg border border-zinc-800 bg-zinc-800/50 py-2">
                                <div className="text-lg font-bold text-white">{ffmpegResult.filterStageCount}</div>
                                <div className="text-[10px] text-zinc-500">Filter stages</div>
                            </div>
                            <div className="rounded-lg border border-zinc-800 bg-zinc-800/50 py-2">
                                <div className="text-lg font-bold text-white">{state.project?.width}×{state.project?.height}</div>
                                <div className="text-[10px] text-zinc-500">Resolution</div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 border-t border-zinc-700 px-5 py-3">
                    <button
                        className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        className="rounded-md border border-violet-600 bg-violet-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={renderStatus === 'rendering' || !state.project}
                        title="Server-side rendering (requires AWS Lambda)"
                    >
                        🚀 Start Render
                    </button>
                </div>
            </div>
        </div>
    );
}
