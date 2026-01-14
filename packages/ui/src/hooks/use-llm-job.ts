'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type LlmJobStatus = 'idle' | 'pending' | 'success' | 'error';

interface LlmJobResult<T = unknown> {
    status: LlmJobStatus;
    result: T | null;
    error: string | null;
    trigger: (action: () => Promise<{ queued?: boolean; success?: boolean; data?: T }>) => Promise<void>;
    reset: () => void;
}

interface UseLlmJobOptions {
    wsUrl?: string;
    token?: string;
}

/**
 * Hook for handling async LLM job results via WebSocket
 *
 * @param jobType - The type of LLM job to listen for
 * @param options - Optional WebSocket URL and auth token
 * @returns LlmJobResult with status, result, error, trigger, and reset functions
 *
 * @example
 * ```tsx
 * const { status, result, error, trigger } = useLlmJob('season-analysis', {
 *   wsUrl: process.env.NEXT_PUBLIC_WEBSOCKET_URL,
 *   token: session?.access_token,
 * });
 * ```
 */
export function useLlmJob<T = unknown>(
    jobType: string,
    options?: UseLlmJobOptions,
): LlmJobResult<T> {
    const [status, setStatus] = useState<LlmJobStatus>('idle');
    const [result, setResult] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    // Connect to WebSocket and listen for job results
    useEffect(() => {
        const wsUrl = options?.wsUrl;
        const token = options?.token;

        if (!wsUrl || !token) {
            console.debug('[useLlmJob] Missing wsUrl or token, skipping WebSocket connection');
            return;
        }

        const ws = new WebSocket(`${wsUrl}?token=${token}`);

        ws.onopen = () => {
            console.log('[useLlmJob] WebSocket connected');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                // Filter for this job type
                if (data.jobType !== jobType) return;

                if (data.type === 'llm-result') {
                    console.log(`[useLlmJob] Received result for ${jobType}`);
                    setStatus('success');
                    setResult(data.result as T);
                    setError(null);
                } else if (data.type === 'llm-error') {
                    console.log(`[useLlmJob] Received error for ${jobType}:`, data.error);
                    setStatus('error');
                    setError(data.error);
                }
            } catch (e) {
                console.error('[useLlmJob] Error parsing WebSocket message:', e);
            }
        };

        ws.onerror = (e) => {
            console.error('[useLlmJob] WebSocket error:', e);
        };

        ws.onclose = () => {
            console.log('[useLlmJob] WebSocket closed');
        };

        wsRef.current = ws;

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [jobType, options?.wsUrl, options?.token]);

    // Trigger an LLM action
    const trigger = useCallback(async (
        action: () => Promise<{ queued?: boolean; success?: boolean; data?: T }>,
    ) => {
        setStatus('pending');
        setError(null);

        try {
            const response = await action();

            // If response has queued: true, wait for WebSocket result
            if (response.queued) {
                // Status will be updated by WebSocket message
                return;
            }

            // For local dev (synchronous response), set result immediately
            if (response.success && response.data) {
                setStatus('success');
                setResult(response.data);
            }
        } catch (e) {
            setStatus('error');
            setError(e instanceof Error ? e.message : 'An error occurred');
        }
    }, []);

    // Reset state
    const reset = useCallback(() => {
        setStatus('idle');
        setResult(null);
        setError(null);
    }, []);

    return { status, result, error, trigger, reset };
}
