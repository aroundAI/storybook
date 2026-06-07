'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLlmWebSocket } from './llm-websocket-provider';

type BulkJobStatus = 'idle' | 'pending' | 'success' | 'error';

interface BulkJobEntry<T = unknown> {
  status: BulkJobStatus;
  result: T | null;
  error: string | null;
}

interface UseBulkLlmJobsResult<T = unknown> {
  /** Map of episodeId → { status, result, error } */
  jobs: Map<string, BulkJobEntry<T>>;
  /** Register episode IDs to listen for */
  registerEpisodes: (episodeIds: string[]) => void;
  /** Mark an episode as pending (called before server action dispatch) */
  markPending: (episodeId: string) => void;
  /** Reset all tracked state */
  reset: () => void;
  /** Number of completed jobs (success + error) */
  completedCount: number;
  /** Number of total registered jobs */
  totalCount: number;
}

/**
 * Hook for tracking bulk LLM job results via WebSocket.
 *
 * Unlike `useLlmJob` (which tracks a single job by jobType),
 * this hook tracks multiple concurrent jobs of the same jobType,
 * routing results to the correct episode by `episodeId`.
 *
 * @example
 * ```tsx
 * const { jobs, registerEpisodes, markPending } = useBulkLlmJobs<StoryIdeationResult>('story-ideation');
 *
 * // Register episodes to track
 * registerEpisodes(['ep-1', 'ep-2', 'ep-3']);
 *
 * // Before dispatching each action
 * markPending('ep-1');
 * await generateStoryIdeasAction({ episodeId: 'ep-1', ... });
 *
 * // Results arrive automatically via WebSocket
 * // jobs.get('ep-1') → { status: 'success', result: {...}, error: null }
 * ```
 */
export function useBulkLlmJobs<T = unknown>(
  jobType: string,
): UseBulkLlmJobsResult<T> {
  const [jobs, setJobs] = useState<Map<string, BulkJobEntry<T>>>(new Map());
  const { subscribe } = useLlmWebSocket();

  // Keep a ref to avoid stale closures in the subscribe callback
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  // Subscribe to WebSocket messages for this jobType
  useEffect(() => {
    const unsubscribe = subscribe(jobType, (message) => {
      const episodeId = message.episodeId;

      if (!episodeId) {
        console.warn(
          `[useBulkLlmJobs] Received ${jobType} message without episodeId, ignoring`,
        );
        return;
      }

      setJobs((prev) => {
        // Only process if we're tracking this episode
        if (!prev.has(episodeId)) return prev;

        const next = new Map(prev);

        if (message.type === 'llm-result') {
          next.set(episodeId, {
            status: 'success',
            result: message.result as T,
            error: null,
          });
        } else if (message.type === 'llm-error') {
          next.set(episodeId, {
            status: 'error',
            result: null,
            error: message.error ?? 'Unknown error',
          });
        }

        return next;
      });
    });

    return () => unsubscribe();
  }, [jobType, subscribe]);

  const registerEpisodes = useCallback((episodeIds: string[]) => {
    setJobs((prev) => {
      const next = new Map(prev);
      for (const id of episodeIds) {
        if (!next.has(id)) {
          next.set(id, { status: 'idle', result: null, error: null });
        }
      }
      return next;
    });
  }, []);

  const markPending = useCallback((episodeId: string) => {
    setJobs((prev) => {
      const next = new Map(prev);
      next.set(episodeId, { status: 'pending', result: null, error: null });
      return next;
    });
  }, []);

  const reset = useCallback(() => setJobs(new Map()), []);

  let completedCount = 0;
  for (const entry of jobs.values()) {
    if (entry.status === 'success' || entry.status === 'error') {
      completedCount++;
    }
  }

  return {
    jobs,
    registerEpisodes,
    markPending,
    reset,
    completedCount,
    totalCount: jobs.size,
  };
}
