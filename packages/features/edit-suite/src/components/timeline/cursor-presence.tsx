'use client';

/**
 * CursorPresence — overlay showing remote collaborators' cursor positions on the timeline.
 *
 * Renders a vertical line + avatar badge for each remote user's playhead position.
 * Also shows a tooltip with the user's name and what clip they're editing.
 */
import { useMemo } from 'react';

import { useEditData } from '../edit-suite-provider';

// ──────────────────────────────────────────
// CursorPresence
// ──────────────────────────────────────────

export function CursorPresence() {
  const { remoteCursors, zoom, scrollLeft } = useEditData();

  const cursors = useMemo(
    () => Array.from(remoteCursors.values()),
    [remoteCursors],
  );

  if (cursors.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {cursors.map((cursor) => {
        const xPos = (cursor.cursorPositionMs / 1000) * zoom - scrollLeft;

        // Don't render if off-screen
        if (xPos < -20 || xPos > 5000) return null;

        return (
          <div
            key={cursor.userId}
            className="absolute top-0 bottom-0"
            style={{ left: `${xPos}px` }}
          >
            {/* Vertical cursor line */}
            <div
              className="absolute top-0 left-0 h-full w-[2px] opacity-70"
              style={{ backgroundColor: cursor.color }}
            />

            {/* User badge at top */}
            <div
              className="absolute -top-1 -left-3 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium whitespace-nowrap text-white shadow-lg"
              style={{ backgroundColor: cursor.color }}
            >
              <span className="max-w-[60px] truncate">
                {cursor.displayName}
              </span>
            </div>

            {/* Active clip highlight */}
            {cursor.activeClipId && (
              <div
                className="absolute top-6 -left-1 h-1 w-2 rounded-full opacity-50"
                style={{ backgroundColor: cursor.color }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────
// ActiveEditorsList — shows who is currently editing
// ──────────────────────────────────────────

export function ActiveEditorsList() {
  const { activeEditors } = useEditData();
  const editors = useMemo(
    () => Array.from(activeEditors.values()),
    [activeEditors],
  );

  if (editors.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-[10px] text-zinc-500">Editing:</span>
      <div className="flex -space-x-1.5">
        {editors.slice(0, 5).map((editor) => (
          <div
            key={editor.userId}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-900 text-[8px] font-bold text-white"
            style={{ backgroundColor: editor.color }}
            title={editor.displayName}
          >
            {editor.displayName.charAt(0).toUpperCase()}
          </div>
        ))}
        {editors.length > 5 && (
          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-900 bg-zinc-700 text-[8px] font-bold text-white">
            +{editors.length - 5}
          </div>
        )}
      </div>
    </div>
  );
}
