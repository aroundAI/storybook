'use client';

/**
 * Edit Suite Toolbar — top bar with editor controls.
 *
 * Contains: Undo/Redo, Language selector, Zoom controls,
 * Snap toggle, Save status, Export button.
 */

import { useEditSuite } from './edit-suite-provider';

export function Toolbar() {
    const { state, dispatch, undo, redo, canUndo, canRedo, forceSave } = useEditSuite();

    return (
        <div className="edit-toolbar">
            {/* Left: Undo / Redo */}
            <div className="edit-toolbar-group">
                <button
                    className="edit-toolbar-btn"
                    disabled={!canUndo}
                    onClick={undo}
                    title="Undo (Cmd+Z)"
                >
                    ↩ Undo
                </button>
                <button
                    className="edit-toolbar-btn"
                    disabled={!canRedo}
                    onClick={redo}
                    title="Redo (Cmd+Shift+Z)"
                >
                    ↪ Redo
                </button>
            </div>

            {/* Center: Language + Zoom */}
            <div className="edit-toolbar-group">
                <span className="edit-toolbar-label">
                    Lang: {state.activeLanguage.toUpperCase()}
                </span>

                <div className="edit-toolbar-divider" />

                <button
                    className="edit-toolbar-btn"
                    onClick={() => dispatch({ type: 'SET_ZOOM', payload: { zoom: state.zoom - 10 } })}
                    title="Zoom out (-)"
                >
                    −
                </button>
                <span className="edit-toolbar-label edit-toolbar-zoom">
                    {Math.round(state.zoom)}px/s
                </span>
                <button
                    className="edit-toolbar-btn"
                    onClick={() => dispatch({ type: 'SET_ZOOM', payload: { zoom: state.zoom + 10 } })}
                    title="Zoom in (+)"
                >
                    +
                </button>

                <div className="edit-toolbar-divider" />

                <button
                    className={`edit-toolbar-btn ${state.snapEnabled ? 'edit-toolbar-btn-active' : ''}`}
                    onClick={() => dispatch({ type: 'TOGGLE_SNAP' })}
                    title="Toggle snap to grid"
                >
                    🧲 Snap
                </button>
            </div>

            {/* Right: Save status + Export */}
            <div className="edit-toolbar-group">
                <span className={`edit-toolbar-save-status edit-toolbar-save-${state.saveStatus}`}>
                    {state.saveStatus === 'saved' && '✓ Saved'}
                    {state.saveStatus === 'dirty' && '● Unsaved'}
                    {state.saveStatus === 'saving' && '⟳ Saving...'}
                    {state.saveStatus === 'error' && '✕ Save failed'}
                </span>

                {(state.saveStatus === 'dirty' || state.saveStatus === 'error') && (
                    <button
                        className="edit-toolbar-btn"
                        onClick={() => void forceSave()}
                        title="Save now (Cmd+S)"
                    >
                        💾 Save
                    </button>
                )}

                <div className="edit-toolbar-divider" />

                <button className="edit-toolbar-btn edit-toolbar-btn-primary" title="Export video">
                    🎬 Export
                </button>
            </div>

            <style>{`
                .edit-toolbar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 6px 12px;
                    background: #18181b;
                    gap: 12px;
                    min-height: 40px;
                }

                .edit-toolbar-group {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .edit-toolbar-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 10px;
                    border: 1px solid #3f3f46;
                    border-radius: 6px;
                    background: #27272a;
                    color: #d4d4d8;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.15s;
                    white-space: nowrap;
                }

                .edit-toolbar-btn:hover:not(:disabled) {
                    background: #3f3f46;
                    border-color: #52525b;
                }

                .edit-toolbar-btn:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }

                .edit-toolbar-btn-active {
                    background: #3b82f6;
                    border-color: #2563eb;
                    color: #fff;
                }

                .edit-toolbar-btn-primary {
                    background: #7c3aed;
                    border-color: #6d28d9;
                    color: #fff;
                }

                .edit-toolbar-btn-primary:hover {
                    background: #6d28d9 !important;
                    border-color: #5b21b6 !important;
                }

                .edit-toolbar-label {
                    font-size: 12px;
                    color: #a1a1aa;
                    padding: 0 4px;
                }

                .edit-toolbar-zoom {
                    min-width: 52px;
                    text-align: center;
                }

                .edit-toolbar-divider {
                    width: 1px;
                    height: 20px;
                    background: #3f3f46;
                    margin: 0 4px;
                }

                .edit-toolbar-save-status {
                    font-size: 11px;
                    padding: 2px 8px;
                    border-radius: 4px;
                }

                .edit-toolbar-save-saved {
                    color: #4ade80;
                }

                .edit-toolbar-save-dirty {
                    color: #fbbf24;
                }

                .edit-toolbar-save-saving {
                    color: #60a5fa;
                }

                .edit-toolbar-save-error {
                    color: #f87171;
                }
            `}</style>
        </div>
    );
}
