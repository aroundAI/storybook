'use client';

/**
 * useEditSuiteWebSocket — real-time updates for the Edit Suite via WebSocket.
 *
 * Connects to the platform WebSocket, subscribes to `edit-project:{projectId}`,
 * and dispatches state updates when render status changes or collaborative
 * editing events arrive.
 *
 * Features:
 * - Auto-reconnect with exponential backoff (1s → 2s → 4s … 30s)
 * - Ping/pong keepalive every 25s
 * - Channel subscription on connect
 * - Operational transform integration for collaborative editing
 * - Cursor presence broadcasting (debounced)
 * - Type-safe message handling
 */

import { useCallback, useEffect, useRef } from 'react';

import type { EditAction } from '../state/types';
import type { EditOperation } from '../lib/operational-transforms';
import { OperationBuffer, getPresenceColor } from '../lib/operational-transforms';

// ──────────────────────────────────────────
// Message types received from WebSocket
// ──────────────────────────────────────────

interface RenderStatusMessage {
    type: 'render-status-changed';
    data: {
        editProjectId: string;
        status: 'queued' | 'rendering' | 'completed' | 'failed';
        renderUrl?: string | null;
        renderError?: string | null;
        progress?: number; // 0-100
    };
}

interface SaveAckMessage {
    type: 'save-ack';
    data: {
        editProjectId: string;
        savedAt: string;
    };
}

interface PongMessage {
    type: 'pong';
}

interface SubscribedMessage {
    type: 'subscribed';
    channel: string;
}

interface RemoteOperationMessage {
    type: 'remote-operation';
    channel: string;
    operation: EditOperation;
    senderId: string;
    timestamp: string;
}

interface CursorPositionMessage {
    type: 'cursor-position';
    channel: string;
    userId: string;
    cursorData: {
        cursorPositionMs: number;
        activeClipId: string | null;
        displayName: string;
    };
    timestamp: string;
}

interface OperationAckMessage {
    type: 'operation-ack';
    channel: string;
    operationId: string;
    timestamp: string;
}

type EditSuiteWSMessage =
    | RenderStatusMessage
    | SaveAckMessage
    | PongMessage
    | SubscribedMessage
    | RemoteOperationMessage
    | CursorPositionMessage
    | OperationAckMessage;

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const PING_INTERVAL_MS = 25_000;
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
const CURSOR_DEBOUNCE_MS = 100;

// ──────────────────────────────────────────
// Return type
// ──────────────────────────────────────────

export interface EditSuiteWSControls {
    sendOperation: (op: EditOperation) => void;
    sendCursorUpdate: (cursorMs: number, activeClipId: string | null, displayName: string) => void;
}

// ──────────────────────────────────────────
// Hook
// ──────────────────────────────────────────

export function useEditSuiteWebSocket(
    editProjectId: string | undefined,
    dispatch: React.Dispatch<EditAction>,
): EditSuiteWSControls {
    const wsRef = useRef<WebSocket | null>(null);
    const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectDelayRef = useRef(INITIAL_RECONNECT_MS);
    const isUnmountedRef = useRef(false);
    const opBufferRef = useRef(new OperationBuffer());
    const cursorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const channel = editProjectId ? `edit-project:${editProjectId}` : null;

    const handleMessage = useCallback(
        (event: MessageEvent) => {
            try {
                const msg = JSON.parse(event.data as string) as EditSuiteWSMessage;

                switch (msg.type) {
                    case 'render-status-changed': {
                        const { status, renderUrl, renderError, progress } = msg.data;
                        dispatch({
                            type: 'SET_RENDER_STATUS',
                            payload: { status, renderUrl, renderError, progress },
                        });
                        break;
                    }

                    case 'remote-operation': {
                        // Transform remote operation against our pending local ops
                        const transformedOp = opBufferRef.current.transformAgainstRemote(msg.operation);
                        if (transformedOp) {
                            dispatch({
                                type: 'APPLY_REMOTE_OPERATION',
                                payload: {
                                    operation: transformedOp,
                                    senderId: msg.senderId,
                                },
                            });
                        }
                        break;
                    }

                    case 'operation-ack': {
                        // Server acknowledged our operation
                        opBufferRef.current.acknowledge(
                            opBufferRef.current.getServerVersion() + 1,
                        );
                        break;
                    }

                    case 'cursor-position': {
                        dispatch({
                            type: 'UPDATE_REMOTE_CURSOR',
                            payload: {
                                userId: msg.userId,
                                displayName: msg.cursorData.displayName,
                                color: getPresenceColor(msg.userId),
                                cursorPositionMs: msg.cursorData.cursorPositionMs,
                                activeClipId: msg.cursorData.activeClipId,
                            },
                        });
                        break;
                    }

                    case 'subscribed':
                        if (process.env.NODE_ENV === 'development') {
                            console.log(`[EditSuite WS] Subscribed to ${msg.channel}`);
                        }
                        break;

                    case 'pong':
                        // Keepalive acknowledged
                        break;

                    default:
                        // Ignore unhandled message types
                        break;
                }
            } catch {
                // Ignore malformed messages
            }
        },
        [dispatch],
    );

    const connect = useCallback(() => {
        if (isUnmountedRef.current || !channel) return;

        const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
        if (!wsUrl) {
            if (process.env.NODE_ENV === 'development') {
                console.warn('[EditSuite WS] NEXT_PUBLIC_WEBSOCKET_URL not configured');
            }
            return;
        }

        // Close existing connection
        if (wsRef.current) {
            wsRef.current.close();
        }

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            if (process.env.NODE_ENV === 'development') {
                console.log(`[EditSuite WS] Connected, subscribing to ${channel}`);
            }
            reconnectDelayRef.current = INITIAL_RECONNECT_MS;
            opBufferRef.current.clear(); // Clear pending ops on reconnect

            // Subscribe to project channel
            ws.send(JSON.stringify({ action: 'subscribe', channel }));

            // Start keepalive
            if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ action: 'ping' }));
                }
            }, PING_INTERVAL_MS);
        };

        ws.onmessage = handleMessage;

        ws.onclose = () => {
            // Clear keepalive
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = null;
            }

            // Auto-reconnect with exponential backoff
            if (!isUnmountedRef.current) {
                const delay = reconnectDelayRef.current;
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[EditSuite WS] Disconnected, reconnecting in ${delay}ms`);
                }
                reconnectTimeoutRef.current = setTimeout(connect, delay);
                reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_MS);
            }
        };

        ws.onerror = (err) => {
            if (process.env.NODE_ENV === 'development') {
                console.error('[EditSuite WS] Error:', err);
            }
            ws.close();
        };
    }, [channel, handleMessage]);

    // Send a local edit operation to the server
    const sendOperation = useCallback((op: EditOperation) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !channel) return;

        opBufferRef.current.push(op);
        wsRef.current.send(JSON.stringify({
            action: 'edit-operation',
            channel,
            data: op,
        }));
    }, [channel]);

    // Send cursor position update (debounced)
    const sendCursorUpdate = useCallback((cursorMs: number, activeClipId: string | null, displayName: string) => {
        if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current);

        cursorDebounceRef.current = setTimeout(() => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !channel) return;

            wsRef.current.send(JSON.stringify({
                action: 'cursor-update',
                channel,
                data: { cursorPositionMs: cursorMs, activeClipId, displayName },
            }));
        }, CURSOR_DEBOUNCE_MS);
    }, [channel]);

    // Connect when projectId is available
    useEffect(() => {
        isUnmountedRef.current = false;

        if (channel) {
            connect();
        }

        return () => {
            isUnmountedRef.current = true;

            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (cursorDebounceRef.current) {
                clearTimeout(cursorDebounceRef.current);
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [channel, connect]);

    return { sendOperation, sendCursorUpdate };
}
