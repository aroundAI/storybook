'use client';

/**
 * Edit Suite Toolbar — top bar with editor controls.
 *
 * Contains: Undo/Redo, Language selector, Zoom controls,
 * Snap toggle, Save status, Export button.
 */

import { cn } from '@kit/ui/utils';

import { useEditSuite } from './edit-suite-provider';

export function Toolbar() {
    const { state, dispatch, undo, redo, canUndo, canRedo, forceSave, assemblyStatus, runAutoAssembly, episodeId } = useEditSuite();

    return (
        <div className="flex min-h-[40px] items-center justify-between gap-3 bg-zinc-900 px-3 py-1.5">
            {/* Left: Undo / Redo */}
            <div className="flex items-center gap-1.5">
                <ToolbarButton disabled={!canUndo} onClick={undo} title="Undo (Cmd+Z)">
                    ↩ Undo
                </ToolbarButton>
                <ToolbarButton disabled={!canRedo} onClick={redo} title="Redo (Cmd+Shift+Z)">
                    ↪ Redo
                </ToolbarButton>
            </div>

            {/* Center: Language + Zoom */}
            <div className="flex items-center gap-1.5">
                <span className="px-1 text-xs text-zinc-400">
                    Lang: {state.activeLanguage.toUpperCase()}
                </span>

                <div className="mx-1 h-5 w-px bg-zinc-700" />

                <ToolbarButton
                    onClick={() => dispatch({ type: 'SET_ZOOM', payload: { zoom: state.zoom - 10 } })}
                    title="Zoom out (-)"
                >
                    −
                </ToolbarButton>
                <span className="min-w-[52px] text-center text-xs text-zinc-400">
                    {Math.round(state.zoom)}px/s
                </span>
                <ToolbarButton
                    onClick={() => dispatch({ type: 'SET_ZOOM', payload: { zoom: state.zoom + 10 } })}
                    title="Zoom in (+)"
                >
                    +
                </ToolbarButton>

                <div className="mx-1 h-5 w-px bg-zinc-700" />

                <ToolbarButton
                    active={state.snapEnabled}
                    onClick={() => dispatch({ type: 'TOGGLE_SNAP' })}
                    title="Toggle snap to grid"
                >
                    🧲 Snap
                </ToolbarButton>
            </div>

            {/* Right: Assembly + Save status + Export */}
            <div className="flex items-center gap-1.5">
                {/* Auto-Assemble — shown when no project is loaded */}
                {!state.project && episodeId && (
                    <ToolbarButton
                        variant="primary"
                        disabled={assemblyStatus === 'assembling'}
                        onClick={() => void runAutoAssembly(episodeId)}
                        title="Auto-assemble timeline from episode assets"
                    >
                        {assemblyStatus === 'assembling' ? (
                            <span className="animate-pulse">⚡ Assembling…</span>
                        ) : (
                            '⚡ Auto-Assemble'
                        )}
                    </ToolbarButton>
                )}

                {assemblyStatus === 'error' && (
                    <span className="text-[11px] text-red-400">Assembly failed</span>
                )}

                <span className={cn(
                    'rounded px-2 py-0.5 text-[11px]',
                    state.saveStatus === 'saved' && 'text-green-400',
                    state.saveStatus === 'dirty' && 'text-amber-400',
                    state.saveStatus === 'saving' && 'text-blue-400',
                    state.saveStatus === 'error' && 'text-red-400',
                )}>
                    {state.saveStatus === 'saved' && '✓ Saved'}
                    {state.saveStatus === 'dirty' && '● Unsaved'}
                    {state.saveStatus === 'saving' && '⟳ Saving...'}
                    {state.saveStatus === 'error' && '✕ Save failed'}
                </span>

                {(state.saveStatus === 'dirty' || state.saveStatus === 'error') && (
                    <ToolbarButton
                        onClick={() => void forceSave()}
                        title="Save now (Cmd+S)"
                    >
                        💾 Save
                    </ToolbarButton>
                )}

                <div className="mx-1 h-5 w-px bg-zinc-700" />

                <ToolbarButton variant="primary" title="Export video">
                    🎬 Export
                </ToolbarButton>
            </div>
        </div>
    );
}

function ToolbarButton({
    children,
    disabled,
    onClick,
    title,
    active,
    variant,
}: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    title?: string;
    active?: boolean;
    variant?: 'primary';
}) {
    return (
        <button
            className={cn(
                'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs transition-all',
                variant === 'primary'
                    ? 'border-violet-700 bg-violet-600 text-white hover:bg-violet-700'
                    : active
                        ? 'border-blue-600 bg-blue-500 text-white'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-700',
                disabled && 'cursor-not-allowed opacity-40',
            )}
            disabled={disabled}
            onClick={onClick}
            title={title}
        >
            {children}
        </button>
    );
}
