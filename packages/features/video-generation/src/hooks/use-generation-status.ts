'use client';

import { useCallback } from 'react';

import { useQueries, useQueryClient } from '@tanstack/react-query';

import type {
  GenerationProgressShot,
  ShotGenerationStatus,
} from '../components/generation-progress/types';
import { getShotGenerationJobAction } from '../server/actions/get-shot-generation-job-action';
import { pollVideoStatusAction } from '../server/actions/poll-status-action';

const POLL_INTERVAL = 5000; // 5 seconds

/**
 * Hook to poll generation status for multiple shots.
 *
 * Polls every 5 seconds for active jobs and stops when completed/failed.
 */
export function useGenerationStatus(shots: GenerationProgressShot[]): {
  statuses: ShotGenerationStatus[];
  invalidate: (shotId: string) => void;
} {
  const queryClient = useQueryClient();

  // Filter to only actively generating/queued shots
  const activeShots = shots.filter(
    (shot) => shot.status === 'queued' || shot.status === 'generating',
  );

  const queries = useQueries({
    queries: activeShots.map((shot) => ({
      queryKey: ['generation-status', shot.id],
      queryFn: async () => {
        // If we don't have a job ID, look it up
        let jobId = shot.generationJobId;

        if (!jobId) {
          const result = await getShotGenerationJobAction({ shotId: shot.id });
          if (!result?.id) return null;
          jobId = result.id;
        }

        return await pollVideoStatusAction({ generationJobId: jobId });
      },
      refetchInterval: (query: { state: { data: unknown } }) => {
        const data = query.state.data as { status?: string } | null;
        // Stop polling when job reaches a terminal state
        if (
          data?.status === 'completed' ||
          data?.status === 'failed' ||
          data?.status === 'cancelled'
        ) {
          return false;
        }
        return POLL_INTERVAL;
      },
      staleTime: POLL_INTERVAL,
      enabled: true,
    })),
  });

  const invalidate = useCallback(
    (shotId: string) => {
      void queryClient.invalidateQueries({
        queryKey: ['generation-status', shotId],
      });
    },
    [queryClient],
  );

  const statuses: ShotGenerationStatus[] = activeShots.map((shot, index) => ({
    shotId: shot.id,
    status: queries[index]?.data ?? null,
    isLoading: queries[index]?.isLoading ?? false,
    error: queries[index]?.error ?? null,
  }));

  return { statuses, invalidate };
}
