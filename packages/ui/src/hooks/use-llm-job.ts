'use client';

import { useCallback, useEffect, useState } from 'react';

import { useLlmWebSocket } from './llm-websocket-provider';

type LlmJobStatus = 'idle' | 'pending' | 'success' | 'error';

interface LlmJobResult<T = unknown> {
    status: LlmJobStatus;
    result: T | null;
    error: string | null;
    trigger: (action: () => Promise<{ queued?: boolean; success?: boolean; data?: T }>) => Promise<void>;
    reset: () => void;
}

/**
 * Hook for handling async LLM job results via shared WebSocket
 * 
 * Uses the LlmWebSocketProvider for efficient connection sharing.
 * Multiple components can use this hook without creating duplicate connections.
 *
 * @param jobType - The type of LLM job to listen for (e.g., 'season-analysis', 'shot-generation')
 * @returns LlmJobResult with status, result, error, trigger, and reset functions
 *
 * @example
 * ```tsx
 * const { status, result, error, trigger } = useLlmJob<AnalysisResult>('season-analysis');
 * 
 * const handleAnalyze = () => {
 *   trigger(async () => {
 *     const result = await someServerAction();
 *     if (result.success) return { success: true, data: result.data };
 *     if (result.queued) return { queued: true };
 *     throw new Error('Failed');
 *   });
 * };
 * ```
 */
export function useLlmJob<T = unknown>(jobType: string): LlmJobResult<T> {
    const [status, setStatus] = useState<LlmJobStatus>('idle');
    const [result, setResult] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { subscribe } = useLlmWebSocket();

    // Subscribe to job type messages
    useEffect(() => {
        console.log(`[useLlmJob] Subscribing to ${jobType}`);

        const unsubscribe = subscribe(jobType, (message) => {
            console.log(`[useLlmJob] Received message for ${jobType}:`, message.type);

            if (message.type === 'llm-result') {
                setStatus('success');
                setResult(message.result as T);
                setError(null);
            } else if (message.type === 'llm-error') {
                setStatus('error');
                setError(message.error || 'An error occurred');
            }
        });

        return () => {
            console.log(`[useLlmJob] Unsubscribing from ${jobType}`);
            unsubscribe();
        };
    }, [jobType, subscribe]);

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
                console.log(`[useLlmJob] Job ${jobType} queued, waiting for WebSocket result`);
                // Status will be updated by WebSocket message
                return;
            }

            // For local dev (synchronous response), set result immediately
            if (response.success && response.data) {
                console.log(`[useLlmJob] Job ${jobType} completed synchronously`);
                setStatus('success');
                setResult(response.data);
            }
        } catch (e) {
            console.error(`[useLlmJob] Job ${jobType} failed:`, e);
            setStatus('error');
            setError(e instanceof Error ? e.message : 'An error occurred');
        }
    }, [jobType]);

    // Reset state
    const reset = useCallback(() => {
        setStatus('idle');
        setResult(null);
        setError(null);
    }, []);

    return { status, result, error, trigger, reset };
}
