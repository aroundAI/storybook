'use client';

/**
 * Edit Suite Toolbar — top bar with editor controls.
 *
 * Contains: Undo/Redo, Language selector, Zoom controls,
 * Snap toggle, Save status, Export button.
 */
import { useCallback, useState } from 'react';

import { cn } from '@kit/ui/utils';

import { DEFAULT_TEXT_CLIP_PROPS } from '../lib/types';
import { useEditSuite } from './edit-suite-provider';
import { ExportDialog } from './export/export-dialog';

// ──────────────────────────────────────────
// Language labels
// ──────────────────────────────────────────

const LANGUAGE_LABELS: Record<string, string> = {
  en: '🇺🇸 English',
  es: '🇪🇸 Spanish',
  fr: '🇫🇷 French',
  de: '🇩🇪 German',
  pt: '🇧🇷 Portuguese',
  hi: '🇮🇳 Hindi',
  ja: '🇯🇵 Japanese',
  ko: '🇰🇷 Korean',
  zh: '🇨🇳 Chinese',
  ar: '🇸🇦 Arabic',
  it: '🇮🇹 Italian',
  ru: '🇷🇺 Russian',
};

// ──────────────────────────────────────────
// Toolbar
// ──────────────────────────────────────────

export function Toolbar() {
  const {
    state,
    dispatch,
    undo,
    redo,
    canUndo,
    canRedo,
    forceSave,
    assemblyStatus,
    runAutoAssembly,
    episodeId,
    availableLanguages,
  } = useEditSuite();
  const [exportOpen, setExportOpen] = useState(false);

  const hasMultipleLanguages = availableLanguages.length > 1;

  // Add a title clip at the playhead position
  const handleAddTitle = useCallback(() => {
    // Find or create a title track
    let titleTrack = state.tracks.find((t) => t.type === 'title');

    if (!titleTrack) {
      const newTrackId = crypto.randomUUID();
      titleTrack = {
        id: newTrackId,
        editProjectId: state.project?.id ?? '',
        type: 'title' as const,
        name: 'Titles',
        sortOrder: state.tracks.length,
        volume: 1,
        isMuted: false,
        isSolo: false,
        isLocked: false,
        height: 48,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_TRACK', payload: { track: titleTrack } });
    }

    // Create a default title clip (3 seconds at playhead)
    const clipId = crypto.randomUUID();
    const startMs = state.playheadMs;
    const durationMs = 3000;

    dispatch({
      type: 'ADD_CLIP',
      payload: {
        clip: {
          id: clipId,
          trackId: titleTrack.id,
          sourceShotId: null,
          sourceDialogueId: null,
          sourceDubbedDialogueId: null,
          sourceAudioTrackId: null,
          sourceUploadUrl: null,
          mediaUrl: null,
          thumbnailUrl: null,
          startMs,
          endMs: startMs + durationMs,
          inPointMs: 0,
          outPointMs: durationMs,
          volume: 1,
          speed: 1,
          fadeInMs: 300,
          fadeOutMs: 300,
          sortOrder: 0,
          syncGroupId: null,
          language: null,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // Spread centralized text defaults
          ...DEFAULT_TEXT_CLIP_PROPS,
        },
      },
    });

    // Select the new clip
    dispatch({ type: 'SELECT_CLIPS', payload: { clipIds: [clipId] } });
  }, [state.tracks, state.project?.id, state.playheadMs, dispatch]);

  return (
    <div className="flex min-h-[40px] items-center justify-between gap-3 bg-zinc-900 px-3 py-1.5">
      {/* Left: Undo / Redo */}
      <div className="flex items-center gap-1.5">
        <ToolbarButton disabled={!canUndo} onClick={undo} title="Undo (Cmd+Z)">
          ↩ Undo
        </ToolbarButton>
        <ToolbarButton
          disabled={!canRedo}
          onClick={redo}
          title="Redo (Cmd+Shift+Z)"
        >
          ↪ Redo
        </ToolbarButton>
      </div>

      {/* Center: Language + Zoom */}
      <div className="flex items-center gap-1.5">
        {/* Language Switcher */}
        {hasMultipleLanguages ? (
          <select
            className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 outline-none focus:border-violet-500"
            value={state.activeLanguage}
            onChange={(e) =>
              dispatch({
                type: 'SET_LANGUAGE',
                payload: { language: e.target.value },
              })
            }
            title="Switch language"
          >
            {availableLanguages.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_LABELS[lang] ?? lang.toUpperCase()}
              </option>
            ))}
          </select>
        ) : (
          <span className="px-1 text-xs text-zinc-400">
            {LANGUAGE_LABELS[state.activeLanguage] ??
              state.activeLanguage.toUpperCase()}
          </span>
        )}

        <div className="mx-1 h-5 w-px bg-zinc-700" />

        <ToolbarButton
          onClick={() =>
            dispatch({ type: 'SET_ZOOM', payload: { zoom: state.zoom - 10 } })
          }
          title="Zoom out (-)"
        >
          −
        </ToolbarButton>
        <span className="min-w-[52px] text-center text-xs text-zinc-400">
          {Math.round(state.zoom)}px/s
        </span>
        <ToolbarButton
          onClick={() =>
            dispatch({ type: 'SET_ZOOM', payload: { zoom: state.zoom + 10 } })
          }
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

        <span
          className={cn(
            'rounded px-2 py-0.5 text-[11px]',
            state.saveStatus === 'saved' && 'text-green-400',
            state.saveStatus === 'dirty' && 'text-amber-400',
            state.saveStatus === 'saving' && 'text-blue-400',
            state.saveStatus === 'error' && 'text-red-400',
          )}
        >
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

        <ToolbarButton
          onClick={handleAddTitle}
          title="Add title text at playhead"
        >
          🔤 Add Title
        </ToolbarButton>

        <div className="mx-1 h-5 w-px bg-zinc-700" />

        <ToolbarButton
          variant="primary"
          title="Export video"
          onClick={() => setExportOpen(true)}
        >
          🎬 Export
        </ToolbarButton>

        <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────
// ToolbarButton
// ──────────────────────────────────────────

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
