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
 * - Type-safe message handling
 */

import { useCallback, useEffect, useRef } from 'react';

import type { EditAction } from '../state/types';

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

type EditSuiteWSMessage =
    | RenderStatusMessage
    | SaveAckMessage
    | PongMessage
    | SubscribedMessage;

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const PING_INTERVAL_MS = 25_000;
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

// ──────────────────────────────────────────
// Hook
// ──────────────────────────────────────────

export function useEditSuiteWebSocket(
    editProjectId: string | undefined,
    dispatch: React.Dispatch<EditAction>,
) {
    const wsRef = useRef<WebSocket | null>(null);
    const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectDelayRef = useRef(INITIAL_RECONNECT_MS);
    const isUnmountedRef = useRef(false);

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

                    case 'subscribed':
                        console.log(`[EditSuite WS] Subscribed to ${msg.channel}`);
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
            console.warn('[EditSuite WS] NEXT_PUBLIC_WEBSOCKET_URL not configured');
            return;
        }

        // Close existing connection
        if (wsRef.current) {
            wsRef.current.close();
        }

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log(`[EditSuite WS] Connected, subscribing to ${channel}`);
            reconnectDelayRef.current = INITIAL_RECONNECT_MS;

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
                console.log(`[EditSuite WS] Disconnected, reconnecting in ${delay}ms`);
                reconnectTimeoutRef.current = setTimeout(connect, delay);
                reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_MS);
            }
        };

        ws.onerror = (err) => {
            console.error('[EditSuite WS] Error:', err);
            ws.close();
        };
    }, [channel, handleMessage]);

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
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [channel, connect]);
}
