/**
 * Operational Transforms (OT) for Edit Suite collaborative editing.
 *
 * Defines operation types for timeline edits and provides transformation
 * functions that resolve conflicts when two users edit simultaneously.
 *
 * Key concepts:
 * - Each operation has a `version` (sequence number) for ordering
 * - `transformOperation(local, remote)` adjusts `local` to account for `remote`
 * - `applyOperation(state, op)` applies a remote operation to a local state
 * - Operations are idempotent — applying the same op twice is a no-op
 *
 * @see https://en.wikipedia.org/wiki/Operational_transformation
 */

// ──────────────────────────────────────────
// Operation types
// ──────────────────────────────────────────

export type EditOperation =
    | MoveClipOp
    | ResizeClipOp
    | DeleteClipOp
    | AddClipOp
    | UpdateClipPropertyOp
    | AddTrackOp
    | DeleteTrackOp
    | ReorderTrackOp;

export interface OperationBase {
    /** Unique operation ID (UUID) */
    id: string;
    /** User who created this operation */
    userId: string;
    /** Operation version — monotonically increasing per project */
    version: number;
    /** ISO timestamp */
    timestamp: string;
    /** Edit project ID */
    editProjectId: string;
}

export interface MoveClipOp extends OperationBase {
    type: 'move-clip';
    clipId: string;
    fromStartMs: number;
    toStartMs: number;
    fromTrackId: string;
    toTrackId: string;
}

export interface ResizeClipOp extends OperationBase {
    type: 'resize-clip';
    clipId: string;
    fromStartMs: number;
    fromEndMs: number;
    toStartMs: number;
    toEndMs: number;
}

export interface DeleteClipOp extends OperationBase {
    type: 'delete-clip';
    clipId: string;
    /** Snapshot for undo */
    clipData: Record<string, unknown>;
}

export interface AddClipOp extends OperationBase {
    type: 'add-clip';
    clipId: string;
    trackId: string;
    clipData: Record<string, unknown>;
}

export interface UpdateClipPropertyOp extends OperationBase {
    type: 'update-clip-property';
    clipId: string;
    property: string;
    oldValue: unknown;
    newValue: unknown;
}

export interface AddTrackOp extends OperationBase {
    type: 'add-track';
    trackId: string;
    trackData: Record<string, unknown>;
}

export interface DeleteTrackOp extends OperationBase {
    type: 'delete-track';
    trackId: string;
    trackData: Record<string, unknown>;
}

export interface ReorderTrackOp extends OperationBase {
    type: 'reorder-track';
    trackId: string;
    fromIndex: number;
    toIndex: number;
}

// ──────────────────────────────────────────
// Presence types
// ──────────────────────────────────────────

export interface UserPresence {
    userId: string;
    displayName: string;
    avatarUrl?: string;
    /** Color assigned for cursor/highlights (hex) */
    color: string;
    /** Cursor position on the timeline (ms) */
    cursorPositionMs: number | null;
    /** Clip currently being edited by this user */
    activeClipId: string | null;
    /** Last seen timestamp */
    lastSeenAt: string;
}

// ──────────────────────────────────────────
// User colors for presence indicators
// ──────────────────────────────────────────

const PRESENCE_COLORS = [
    '#ef4444', // red
    '#f97316', // orange
    '#eab308', // yellow
    '#22c55e', // green
    '#06b6d4', // cyan
    '#3b82f6', // blue
    '#8b5cf6', // violet
    '#d946ef', // fuchsia
    '#ec4899', // pink
    '#14b8a6', // teal
];

/**
 * Deterministically assign a color to a user based on their ID.
 */
export function getPresenceColor(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
    }
    return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]!;
}

// ──────────────────────────────────────────
// Transform: resolve conflicts between concurrent operations
// ──────────────────────────────────────────

/**
 * Transform a local operation against a remote operation that was applied first.
 *
 * Returns the adjusted local operation that can be safely applied after the
 * remote operation. Returns `null` if the local operation should be dropped
 * (e.g., both users deleted the same clip).
 *
 * This implements the "server wins" conflict resolution strategy:
 * - If both users move the same clip, the remote (server) position wins
 * - If one user deletes a clip and another edits it, the delete wins
 * - Independent operations (different clips) pass through unchanged
 */
export function transformOperation(
    localOp: EditOperation,
    remoteOp: EditOperation,
): EditOperation | null {
    // Operations on different targets don't conflict
    if (!operationsConflict(localOp, remoteOp)) {
        return localOp;
    }

    // Same-clip conflicts
    switch (remoteOp.type) {
        case 'delete-clip':
            // Remote deleted the clip we're editing — drop local op
            if (getTargetClipId(localOp) === remoteOp.clipId) {
                return null;
            }
            return localOp;

        case 'move-clip':
            if (localOp.type === 'move-clip' && localOp.clipId === remoteOp.clipId) {
                // Both moved same clip — remote wins, drop local
                return null;
            }
            if (localOp.type === 'resize-clip' && localOp.clipId === remoteOp.clipId) {
                // Remote moved the clip we're resizing — adjust our start/end
                const delta = remoteOp.toStartMs - remoteOp.fromStartMs;
                return {
                    ...localOp,
                    fromStartMs: localOp.fromStartMs + delta,
                    fromEndMs: localOp.fromEndMs + delta,
                    toStartMs: localOp.toStartMs + delta,
                    toEndMs: localOp.toEndMs + delta,
                };
            }
            return localOp;

        case 'resize-clip':
            if (localOp.type === 'resize-clip' && localOp.clipId === remoteOp.clipId) {
                // Both resized same clip — remote wins, drop local
                return null;
            }
            return localOp;

        case 'update-clip-property':
            if (
                localOp.type === 'update-clip-property' &&
                localOp.clipId === remoteOp.clipId &&
                localOp.property === remoteOp.property
            ) {
                // Both changed same property on same clip — remote wins
                return null;
            }
            return localOp;

        case 'delete-track':
            // If remote deleted a track and our operation targets a clip on that track
            if (localOp.type === 'add-clip' && localOp.trackId === remoteOp.trackId) {
                return null;
            }
            return localOp;

        default:
            return localOp;
    }
}

/**
 * Check if two operations potentially conflict (target the same clip or track).
 */
function operationsConflict(a: EditOperation, b: EditOperation): boolean {
    const aClip = getTargetClipId(a);
    const bClip = getTargetClipId(b);

    if (aClip && bClip && aClip === bClip) return true;

    const aTrack = getTargetTrackId(a);
    const bTrack = getTargetTrackId(b);

    if (aTrack && bTrack && aTrack === bTrack) return true;

    return false;
}

function getTargetClipId(op: EditOperation): string | null {
    switch (op.type) {
        case 'move-clip':
        case 'resize-clip':
        case 'delete-clip':
        case 'add-clip':
        case 'update-clip-property':
            return op.clipId;
        default:
            return null;
    }
}

function getTargetTrackId(op: EditOperation): string | null {
    switch (op.type) {
        case 'add-track':
        case 'delete-track':
        case 'reorder-track':
            return op.trackId;
        case 'add-clip':
            return op.trackId;
        case 'move-clip':
            return op.toTrackId;
        default:
            return null;
    }
}

// ──────────────────────────────────────────
// Operation buffer for offline support
// ──────────────────────────────────────────

/**
 * Manages a buffer of local operations that haven't been acknowledged by the server.
 * When a remote operation arrives, all buffered operations are transformed against it.
 */
export class OperationBuffer {
    private pending: EditOperation[] = [];
    private serverVersion = 0;

    /**
     * Add a local operation to the buffer (not yet acknowledged by server).
     */
    push(op: EditOperation): void {
        this.pending.push(op);
    }

    /**
     * Acknowledge that the server received our operation at the given version.
     * Removes the oldest pending operation.
     */
    acknowledge(version: number): void {
        this.serverVersion = version;
        if (this.pending.length > 0) {
            this.pending.shift();
        }
    }

    /**
     * Transform all pending local operations against a remote operation.
     * Returns the transformed remote operation for local application.
     */
    transformAgainstRemote(remoteOp: EditOperation): EditOperation | null {
        this.serverVersion = remoteOp.version;

        let transformedRemote: EditOperation | null = remoteOp;

        const newPending: EditOperation[] = [];

        for (const localOp of this.pending) {
            if (!transformedRemote) break;

            const transformedLocal = transformOperation(localOp, transformedRemote);
            if (transformedLocal) {
                newPending.push(transformedLocal);
            }

            // Also transform the remote against local (bidirectional)
            transformedRemote = transformOperation(transformedRemote, localOp);
        }

        this.pending = newPending;
        return transformedRemote;
    }

    /**
     * Get all pending (unacknowledged) operations.
     */
    getPending(): ReadonlyArray<EditOperation> {
        return this.pending;
    }

    /**
     * Get current server version.
     */
    getServerVersion(): number {
        return this.serverVersion;
    }

    /**
     * Clear all pending operations (e.g., on reconnect).
     */
    clear(): void {
        this.pending = [];
    }
}
