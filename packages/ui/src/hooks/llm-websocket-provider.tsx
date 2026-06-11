'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

type LlmJobMessage = {
  type: 'llm-result' | 'llm-error';
  jobType: string;
  episodeId?: string;
  result?: unknown;
  error?: string;
  timestamp?: string;
};

type JobSubscriber = (message: LlmJobMessage) => void;

interface LlmWebSocketContextValue {
  isConnected: boolean;
  subscribe: (jobType: string, callback: JobSubscriber) => () => void;
}

const LlmWebSocketContext = createContext<LlmWebSocketContextValue | null>(
  null,
);

interface LlmWebSocketProviderProps {
  children: ReactNode;
  wsUrl?: string;
  token?: string;
}

/**
 * Provider for shared WebSocket connection to receive LLM job results.
 * Should be placed high in the component tree (e.g., in the authenticated layout).
 *
 * Uses a pub/sub pattern - components subscribe to specific job types.
 * Only ONE WebSocket connection is maintained per session.
 *
 * @example
 * ```tsx
 * // In layout.tsx
 * <LlmWebSocketProvider wsUrl={process.env.NEXT_PUBLIC_WEBSOCKET_URL} token={accessToken}>
 *   {children}
 * </LlmWebSocketProvider>
 * ```
 */
export function LlmWebSocketProvider({
  children,
  wsUrl,
  token,
}: LlmWebSocketProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<string, Set<JobSubscriber>>>(new Map());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Subscribe to a specific job type
  const subscribe = useCallback((jobType: string, callback: JobSubscriber) => {
    if (!subscribersRef.current.has(jobType)) {
      subscribersRef.current.set(jobType, new Set());
    }
    subscribersRef.current.get(jobType)!.add(callback);

    console.log(
      `[LlmWebSocket] Subscribed to ${jobType}, total subscribers:`,
      subscribersRef.current.get(jobType)!.size,
    );

    // Return unsubscribe function
    return () => {
      const subs = subscribersRef.current.get(jobType);
      if (subs) {
        subs.delete(callback);
        console.log(
          `[LlmWebSocket] Unsubscribed from ${jobType}, remaining:`,
          subs.size,
        );
        if (subs.size === 0) {
          subscribersRef.current.delete(jobType);
        }
      }
    };
  }, []);

  // Dispatch message to subscribers
  const dispatchMessage = useCallback((message: LlmJobMessage) => {
    const subs = subscribersRef.current.get(message.jobType);
    if (subs && subs.size > 0) {
      console.log(
        `[LlmWebSocket] Dispatching ${message.type} to ${subs.size} subscriber(s) for ${message.jobType}`,
      );
      subs.forEach((callback) => callback(message));
    } else {
      console.log(`[LlmWebSocket] No subscribers for ${message.jobType}`);
    }
  }, []);

  // Connect to WebSocket
  useEffect(() => {
    if (!wsUrl || !token) {
      console.debug(
        '[LlmWebSocket] Missing wsUrl or token, skipping connection',
      );
      return;
    }

    // Avoid creating duplicate connections
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      console.debug('[LlmWebSocket] Connection already exists, skipping');
      return;
    }

    const connect = () => {
      console.log(
        '[LlmWebSocket] Connecting to:',
        wsUrl.substring(0, 50) + '...',
      );
      const ws = new WebSocket(`${wsUrl}?token=${token}`);

      ws.onopen = () => {
        console.log('[LlmWebSocket] Connected successfully');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as LlmJobMessage;
          console.log('[LlmWebSocket] Received message:', {
            type: data.type,
            jobType: data.jobType,
          });
          dispatchMessage(data);
        } catch (e) {
          console.error('[LlmWebSocket] Error parsing message:', e);
        }
      };

      ws.onerror = (e) => {
        console.error('[LlmWebSocket] WebSocket error:', e);
      };

      ws.onclose = (e) => {
        console.log('[LlmWebSocket] Connection closed:', {
          code: e.code,
          reason: e.reason,
        });
        setIsConnected(false);
        wsRef.current = null;

        // Reconnect with exponential backoff (max 30 seconds)
        if (e.code !== 1000) {
          // Don't reconnect if closed normally
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000,
          );
          reconnectAttemptsRef.current++;
          console.log(
            `[LlmWebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`,
          );
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      console.log('[LlmWebSocket] Cleaning up connection');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
    };
  }, [wsUrl, token, dispatchMessage]);

  return (
    <LlmWebSocketContext.Provider value={{ isConnected, subscribe }}>
      {children}
    </LlmWebSocketContext.Provider>
  );
}

/**
 * Hook to access the shared WebSocket context
 */
export function useLlmWebSocket() {
  const context = useContext(LlmWebSocketContext);
  if (!context) {
    console.warn(
      '[useLlmWebSocket] Not inside LlmWebSocketProvider, WebSocket features disabled',
    );
    return { isConnected: false, subscribe: () => () => {} };
  }
  return context;
}
