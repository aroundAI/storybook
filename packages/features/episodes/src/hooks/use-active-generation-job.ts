'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabaseBrowserClient } from '@kit/supabase/browser-client';

type GenerationJobType =
  | 'story'
  | 'screenplay'
  | 'shot_list'
  | 'translate-dialogue';

type GenerationJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

interface GenerationJob {
  id: string;
  job_type: GenerationJobType;
  status: GenerationJobStatus;
  created_at: string;
  started_at: string | null;
  error_message: string | null;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown> | null;
}

interface UseActiveGenerationJobOptions {
  /** If false, disables all fetching and polling. Default: true */
  enabled?: boolean;
}

interface UseActiveGenerationJobResult {
  isGenerating: boolean;
  job: GenerationJob | null;
  status: GenerationJobStatus | 'idle';
  error: string | null;
  refetch: () => Promise<GenerationJob | null | undefined>;
}

// Exponential backoff intervals: 2s, 5s, 10s, 30s, 30s...
const POLL_INTERVALS = [2000, 5000, 10000, 30000];
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes max polling

/**
 * Hook to check if there's an active generation job for an episode
 *
 * Features:
 * - Smart polling with exponential backoff (2s → 5s → 10s → 30s)
 * - Stops polling after 5 minutes or when job completes
 * - Can be disabled via `enabled: false` option
 * - Only polls when there's an active job
 *
 * @param episodeId - The episode ID to check
 * @param jobType - The type of job to check for
 * @param options - Optional configuration
 *
 * @example
 * ```tsx
 * const { isGenerating, status } = useActiveGenerationJob(
 *   episode.id,
 *   'story',
 *   { enabled: !hasExistingData }
 * );
 * ```
 */
export function useActiveGenerationJob(
  episodeId: string,
  jobType: GenerationJobType,
  options?: UseActiveGenerationJobOptions,
): UseActiveGenerationJobResult {
  const { enabled = true } = options ?? {};

  const [job, setJob] = useState<GenerationJob | null>(null);
  const [_loading, setLoading] = useState(true);

  // Track polling state
  const pollCountRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchJob = useCallback(async () => {
    if (!episodeId || !enabled) {
      setJob(null);
      setLoading(false);
      return;
    }

    const supabase = getSupabaseBrowserClient();

    const { data, error } = await supabase
      .from('generation_jobs')
      .select(
        'id, job_type, status, created_at, started_at, error_message, input_data, output_data',
      )
      .eq('reference_type', 'episode')
      .eq('reference_id', episodeId)
      .eq('job_type', jobType)
      .in('status', ['queued', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[useActiveGenerationJob] Query error:', error);
      setJob(null);
    } else {
      setJob(data as GenerationJob | null);
    }

    setLoading(false);
    return data as GenerationJob | null;
  }, [episodeId, jobType, enabled]);

  // Main effect: fetch once on mount, then poll only if job is active
  useEffect(() => {
    if (!enabled) {
      setJob(null);
      setLoading(false);
      return;
    }

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Reset polling state
    pollCountRef.current = 0;
    startTimeRef.current = Date.now();

    const poll = async () => {
      const result = await fetchJob();

      // If no active job found, stop polling
      if (!result) {
        return;
      }

      // Check if we've exceeded max poll duration
      const elapsed = Date.now() - (startTimeRef.current ?? Date.now());
      if (elapsed > MAX_POLL_DURATION_MS) {
        console.log(
          '[useActiveGenerationJob] Max poll duration exceeded, stopping',
        );
        return;
      }

      // Schedule next poll with exponential backoff
      const intervalIndex = Math.min(
        pollCountRef.current,
        POLL_INTERVALS.length - 1,
      );
      const nextInterval = POLL_INTERVALS[intervalIndex] ?? 30000;
      pollCountRef.current++;

      timeoutRef.current = setTimeout(poll, nextInterval);
    };

    // Start polling
    poll();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [fetchJob, enabled]);

  const isGenerating = job?.status === 'queued' || job?.status === 'processing';
  const status: GenerationJobStatus | 'idle' = job?.status ?? 'idle';
  const error = job?.error_message ?? null;

  return {
    isGenerating,
    job,
    status,
    error,
    refetch: fetchJob,
  };
}
