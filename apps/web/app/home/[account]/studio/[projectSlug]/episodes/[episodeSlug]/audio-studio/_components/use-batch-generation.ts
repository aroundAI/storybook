'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  batchGenerateDialogueAction,
  cancelBatchAction,
  clearAllVoicesAction,
  getActiveBatchForEpisodeAction,
  getBatchStatusAction,
} from '@kit/audio-generation/server';
import { toast } from '@kit/ui/sonner';

import type { SupportedLanguage } from './language-tab-bar';

export interface BatchStatus {
  status: string;
  total: number;
  completed: number;
  failed: number;
  percentage: number;
}

export interface BatchGenerationControls {
  batchStatus: BatchStatus | null;
  setBatchStatus: (status: BatchStatus | null) => void;
  setBatchJobId: (id: string | null) => void;
  isGenerating: boolean;
  handleGenerateAll: () => void;
  handleCancelBatch: () => void;
  handleClearAllVoices: () => void;
}

export function useBatchGeneration(
  episodeId: string,
  selectedLanguage: SupportedLanguage,
  fetchDialogueForLanguage: (
    lang: SupportedLanguage,
    skipCache?: boolean,
  ) => Promise<void>,
  refreshAll: () => Promise<void>,
  refetchEpisode: () => void,
  completedCount: number,
  isPending: boolean,
  startTransition: (callback: () => void) => void,
): BatchGenerationControls {
  // Batch generation state
  const [batchJobId, setBatchJobId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isGenerating =
    batchStatus?.status === 'queued' || batchStatus?.status === 'processing';

  // Poll batch job status
  const pollBatchStatus = useCallback(
    async (jobId: string) => {
      try {
        const status = await getBatchStatusAction({ batchJobId: jobId });
        setBatchStatus({
          status: status.status,
          total: status.progress.total,
          completed: status.progress.completed,
          failed: status.progress.failed,
          percentage: status.progress.percentage,
        });

        // Refresh only dialogue lines (not all static data) for performance
        void fetchDialogueForLanguage(selectedLanguage, true);

        // Stop polling when done
        if (
          status.status === 'completed' ||
          status.status === 'completed_with_errors' ||
          status.status === 'failed' ||
          status.status === 'cancelled'
        ) {
          if (batchPollRef.current) {
            clearInterval(batchPollRef.current);
            batchPollRef.current = null;
          }

          if (status.status === 'completed') {
            toast.success(
              `All ${status.progress.completed} voice(s) generated successfully!`,
            );
          } else if (status.status === 'completed_with_errors') {
            toast.warning(
              `${status.progress.completed} voice(s) generated, ${status.progress.failed} failed.`,
            );
          } else if (status.status === 'failed') {
            toast.error(
              `Generation failed for all ${status.progress.total} line(s).`,
            );
          } else {
            toast.info('Generation cancelled');
          }

          refetchEpisode();
        }
      } catch {
        // If polling fails, stop polling
        if (batchPollRef.current) {
          clearInterval(batchPollRef.current);
          batchPollRef.current = null;
        }
      }
    },
    [fetchDialogueForLanguage, selectedLanguage, refetchEpisode],
  );

  // Resume polling if an active batch job exists (e.g. after page refresh)
  useEffect(() => {
    const checkActiveBatch = async () => {
      try {
        const activeBatch = await getActiveBatchForEpisodeAction({
          episodeId,
        });

        if (activeBatch) {
          setBatchJobId(activeBatch.batchJobId);
          setBatchStatus({
            status: activeBatch.status,
            total: activeBatch.progress.total,
            completed: activeBatch.progress.completed,
            failed: activeBatch.progress.failed,
            percentage: activeBatch.progress.percentage,
          });

          if (batchPollRef.current) {
            clearInterval(batchPollRef.current);
          }
          batchPollRef.current = setInterval(() => {
            void pollBatchStatus(activeBatch.batchJobId);
          }, 3000);
        }
      } catch {
        // Non-critical — just means we won't auto-resume polling
      }
    };

    void checkActiveBatch();

    // Cleanup polling on unmount
    return () => {
      if (batchPollRef.current) {
        clearInterval(batchPollRef.current);
      }
    };
  }, [episodeId, pollBatchStatus]);

  const handleGenerateAll = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await batchGenerateDialogueAction({
          episodeId,
        });

        setBatchJobId(result.batchJobId);
        setBatchStatus({
          status: 'queued',
          total: result.totalLines,
          completed: 0,
          failed: 0,
          percentage: 0,
        });

        toast.success(
          `Generating voices for ${result.totalLines} dialogue line(s)...`,
        );

        // Start polling every 3 seconds
        if (batchPollRef.current) {
          clearInterval(batchPollRef.current);
        }
        batchPollRef.current = setInterval(() => {
          void pollBatchStatus(result.batchJobId);
        }, 3000);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to start generation',
        );
      }
    });
  }, [episodeId, pollBatchStatus, startTransition]);

  const handleCancelBatch = useCallback(() => {
    if (!batchJobId) return;

    startTransition(async () => {
      try {
        await cancelBatchAction({ batchJobId });
        toast.info('Generation cancelled');

        if (batchPollRef.current) {
          clearInterval(batchPollRef.current);
          batchPollRef.current = null;
        }

        setBatchStatus((prev) =>
          prev ? { ...prev, status: 'cancelled' } : null,
        );
        void refreshAll();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to cancel generation',
        );
      }
    });
  }, [batchJobId, refreshAll, startTransition]);

  const handleClearAllVoices = useCallback(() => {
    if (
      !window.confirm(
        `Clear all ${completedCount} generated voice(s)? This will reset them back to pending so you can regenerate.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const result = await clearAllVoicesAction({
          episodeId,
        });

        if (result.success) {
          toast.success(`Cleared ${result.clearedCount} voice(s)`);
          void refreshAll();
        } else {
          toast.error(result.error ?? 'Failed to clear voices');
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to clear voices',
        );
      }
    });
  }, [completedCount, episodeId, refreshAll, startTransition]);

  return {
    batchStatus,
    setBatchStatus,
    setBatchJobId,
    isGenerating,
    handleGenerateAll,
    handleCancelBatch,
    handleClearAllVoices,
  };
}
