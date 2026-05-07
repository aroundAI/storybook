'use client';

/**
 * Undo/Redo system for the Edit Suite.
 *
 * Uses the Command pattern — each edit creates an EditCommand
 * with execute() and undo() methods. The UndoManager maintains
 * a 100-item history stack.
 */
import type { Dispatch } from 'react';

import type { EditClip } from '../lib/types';
import type { EditAction } from './types';

// ──────────────────────────────────────────
// Command interface
// ──────────────────────────────────────────

export interface EditCommand {
  /** Human-readable label for debugging / UI (e.g. "Move clip") */
  readonly label: string;

  /** Apply the edit */
  execute(dispatch: Dispatch<EditAction>): void;

  /** Reverse the edit */
  undo(dispatch: Dispatch<EditAction>): void;
}

// ──────────────────────────────────────────
// UndoManager
// ──────────────────────────────────────────

const MAX_HISTORY = 100;

export class UndoManager {
  private undoStack: EditCommand[] = [];
  private redoStack: EditCommand[] = [];

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** Execute a command and push it onto the undo stack. */
  execute(command: EditCommand, dispatch: Dispatch<EditAction>) {
    command.execute(dispatch);
    this.undoStack.push(command);

    // Trim if over max
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }

    // New action clears redo stack
    this.redoStack = [];
  }

  /** Record a command without executing it (state already applied via dispatches). */
  record(command: EditCommand) {
    this.undoStack.push(command);

    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }

    this.redoStack = [];
  }

  /** Undo the last command. */
  undo(dispatch: Dispatch<EditAction>) {
    const command = this.undoStack.pop();
    if (!command) return;

    command.undo(dispatch);
    this.redoStack.push(command);
  }

  /** Redo the last undone command. */
  redo(dispatch: Dispatch<EditAction>) {
    const command = this.redoStack.pop();
    if (!command) return;

    command.execute(dispatch);
    this.undoStack.push(command);
  }

  /** Clear all history. */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

// ──────────────────────────────────────────
// Concrete commands
// ──────────────────────────────────────────

/**
 * Move a clip to a new timeline position.
 */
export class MoveClipCommand implements EditCommand {
  readonly label = 'Move clip';

  constructor(
    private clipId: string,
    private prevStartMs: number,
    private prevEndMs: number,
    private nextStartMs: number,
    private nextEndMs: number,
    private prevTrackId?: string,
    private nextTrackId?: string,
  ) {}

  execute(dispatch: Dispatch<EditAction>) {
    dispatch({
      type: 'MOVE_CLIP',
      payload: {
        clipId: this.clipId,
        startMs: this.nextStartMs,
        endMs: this.nextEndMs,
        trackId: this.nextTrackId,
      },
    });
  }

  undo(dispatch: Dispatch<EditAction>) {
    dispatch({
      type: 'MOVE_CLIP',
      payload: {
        clipId: this.clipId,
        startMs: this.prevStartMs,
        endMs: this.prevEndMs,
        trackId: this.prevTrackId,
      },
    });
  }
}

/**
 * Trim a clip's in/out points.
 */
export class TrimClipCommand implements EditCommand {
  readonly label = 'Trim clip';

  constructor(
    private clipId: string,
    private prevValues: {
      startMs: number;
      endMs: number;
      inPointMs: number;
      outPointMs: number;
    },
    private nextValues: {
      startMs: number;
      endMs: number;
      inPointMs: number;
      outPointMs: number;
    },
  ) {}

  execute(dispatch: Dispatch<EditAction>) {
    dispatch({
      type: 'UPDATE_CLIP',
      payload: { clipId: this.clipId, changes: this.nextValues },
    });
  }

  undo(dispatch: Dispatch<EditAction>) {
    dispatch({
      type: 'UPDATE_CLIP',
      payload: { clipId: this.clipId, changes: this.prevValues },
    });
  }
}

/**
 * Delete a clip (stores full clip data for undo restoration).
 */
export class DeleteClipCommand implements EditCommand {
  readonly label = 'Delete clip';

  constructor(private clip: EditClip) {}

  execute(dispatch: Dispatch<EditAction>) {
    dispatch({ type: 'REMOVE_CLIP', payload: { clipId: this.clip.id } });
  }

  undo(dispatch: Dispatch<EditAction>) {
    dispatch({ type: 'ADD_CLIP', payload: { clip: this.clip } });
  }
}

/**
 * Add a new clip.
 */
export class AddClipCommand implements EditCommand {
  readonly label = 'Add clip';

  constructor(private clip: EditClip) {}

  execute(dispatch: Dispatch<EditAction>) {
    dispatch({ type: 'ADD_CLIP', payload: { clip: this.clip } });
  }

  undo(dispatch: Dispatch<EditAction>) {
    dispatch({ type: 'REMOVE_CLIP', payload: { clipId: this.clip.id } });
  }
}

/**
 * Update a clip property (generic — stores before/after values).
 */
export class UpdateClipCommand implements EditCommand {
  readonly label: string;

  constructor(
    private clipId: string,
    private prevChanges: Partial<EditClip>,
    private nextChanges: Partial<EditClip>,
    label = 'Update clip',
  ) {
    this.label = label;
  }

  execute(dispatch: Dispatch<EditAction>) {
    dispatch({
      type: 'UPDATE_CLIP',
      payload: { clipId: this.clipId, changes: this.nextChanges },
    });
  }

  undo(dispatch: Dispatch<EditAction>) {
    dispatch({
      type: 'UPDATE_CLIP',
      payload: { clipId: this.clipId, changes: this.prevChanges },
    });
  }
}

/**
 * Split a clip at a given position, creating two clips.
 */
export class SplitClipCommand implements EditCommand {
  readonly label = 'Split clip';

  private leftClip: EditClip;
  private rightClip: EditClip;

  constructor(
    private originalClip: EditClip,
    splitMs: number,
  ) {
    // Left half: original start → split point
    this.leftClip = {
      ...originalClip,
      endMs: splitMs,
      outPointMs: originalClip.inPointMs + (splitMs - originalClip.startMs),
    };

    // Right half: split point → original end
    this.rightClip = {
      ...originalClip,
      id: crypto.randomUUID(),
      startMs: splitMs,
      inPointMs: originalClip.inPointMs + (splitMs - originalClip.startMs),
    };
  }

  execute(dispatch: Dispatch<EditAction>) {
    // Remove original, add both halves
    dispatch({
      type: 'REMOVE_CLIP',
      payload: { clipId: this.originalClip.id },
    });
    dispatch({ type: 'ADD_CLIP', payload: { clip: this.leftClip } });
    dispatch({ type: 'ADD_CLIP', payload: { clip: this.rightClip } });
  }

  undo(dispatch: Dispatch<EditAction>) {
    // Remove both halves, restore original
    dispatch({ type: 'REMOVE_CLIP', payload: { clipId: this.leftClip.id } });
    dispatch({ type: 'REMOVE_CLIP', payload: { clipId: this.rightClip.id } });
    dispatch({ type: 'ADD_CLIP', payload: { clip: this.originalClip } });
  }
}

/**
 * Move all clips in a sync group atomically.
 *
 * When a user drags one clip that belongs to a sync group,
 * all sibling clips shift by the same delta. This command
 * enables undo/redo of the entire batch.
 */
export class SyncGroupMoveCommand implements EditCommand {
  readonly label = 'Move sync group';

  constructor(
    /** The clip the user actually dragged */
    private primaryMove: {
      clipId: string;
      prevStartMs: number;
      prevEndMs: number;
      nextStartMs: number;
      nextEndMs: number;
    },
    /** All sibling clips that also need to shift */
    private siblingMoves: Array<{
      clipId: string;
      prevStartMs: number;
      prevEndMs: number;
      nextStartMs: number;
      nextEndMs: number;
    }>,
  ) {}

  execute(dispatch: Dispatch<EditAction>) {
    // Move primary clip
    dispatch({
      type: 'MOVE_CLIP',
      payload: {
        clipId: this.primaryMove.clipId,
        startMs: this.primaryMove.nextStartMs,
        endMs: this.primaryMove.nextEndMs,
      },
    });

    // Move all siblings
    for (const move of this.siblingMoves) {
      dispatch({
        type: 'MOVE_CLIP',
        payload: {
          clipId: move.clipId,
          startMs: move.nextStartMs,
          endMs: move.nextEndMs,
        },
      });
    }
  }

  undo(dispatch: Dispatch<EditAction>) {
    // Restore primary clip
    dispatch({
      type: 'MOVE_CLIP',
      payload: {
        clipId: this.primaryMove.clipId,
        startMs: this.primaryMove.prevStartMs,
        endMs: this.primaryMove.prevEndMs,
      },
    });

    // Restore all siblings
    for (const move of this.siblingMoves) {
      dispatch({
        type: 'MOVE_CLIP',
        payload: {
          clipId: move.clipId,
          startMs: move.prevStartMs,
          endMs: move.prevEndMs,
        },
      });
    }
  }
}
