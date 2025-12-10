'use client';

import { memo, useCallback, useState, useTransition } from 'react';

import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@kit/ui/collapsible';
import { Progress } from '@kit/ui/progress';
import { cn } from '@kit/ui/utils';

import { useGenerationStatus } from '../../hooks/use-generation-status';
import { cancelVideoJobAction } from '../../server/actions/cancel-action';
import { GenerationProgressItem } from './generation-progress-item';
import type { GenerationProgressProps } from './types';

/**
 * Real-time progress indicator for video generation jobs.
 *
 * Displays overall and individual progress for multiple shots,
 * with queue information, ETA, and cancel functionality.
 *
 * @example
 * ```tsx
 * <GenerationProgress
 *   shots={activeShots}
 *   onCancel={(shotId) => console.log('Cancelled:', shotId)}
 * />
 * ```
 */
export const GenerationProgress = memo(function GenerationProgress({
  shots,
  onCancel,
  onComplete,
  defaultCollapsed = false,
  className,
}: GenerationProgressProps) {
  const [isOpen, setIsOpen] = useState(!defaultCollapsed);
  const [isPending, startTransition] = useTransition();
  const { statuses, invalidate } = useGenerationStatus(shots);

  // Filter to active shots only
  const activeShots = shots.filter(
    (s) => s.status === 'queued' || s.status === 'generating',
  );

  // Calculate overall progress
  const completedCount = statuses.filter(
    (s) => s.status?.status === 'completed',
  ).length;
  const totalCount = activeShots.length;
  const overallProgress =
    totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Handle cancel
  const handleCancel = useCallback(
    (shotId: string, jobId?: string) => {
      if (!jobId) return;

      startTransition(async () => {
        try {
          await cancelVideoJobAction({ jobId });
          invalidate(shotId);
          onCancel?.(shotId);
        } catch (error) {
          console.error('Failed to cancel job:', error);
        }
      });
    },
    [invalidate, onCancel],
  );

  // Notify on completion
  const handleComplete = useCallback(
    (shotId: string, videoUrl?: string) => {
      onComplete?.(shotId, videoUrl);
    },
    [onComplete],
  );

  // Check for completed jobs and notify
  statuses.forEach((s) => {
    if (s.status?.status === 'completed' && s.status.videoUrl) {
      handleComplete(s.shotId, s.status.videoUrl);
    }
  });

  // Don't render if no active jobs
  if (totalCount === 0) {
    return null;
  }

  return (
    <Card className={cn('w-full', className)} data-test="generation-progress">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="flex w-full items-center justify-between p-0 hover:bg-transparent"
              aria-label={
                isOpen ? 'Collapse progress details' : 'Expand progress details'
              }
            >
              <CardTitle className="flex items-center gap-2 text-base">
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Generating Videos ({completedCount} of {totalCount})
              </CardTitle>
              {isOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>

          {/* Overall progress bar */}
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Overall Progress</span>
              <span className="text-muted-foreground">
                {Math.round(overallProgress)}%
              </span>
            </div>
            <Progress
              value={overallProgress}
              className="h-2"
              aria-label={`Overall generation progress: ${Math.round(overallProgress)}%`}
            />
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-3 pt-0">
            {activeShots.map((shot) => {
              const statusData = statuses.find((s) => s.shotId === shot.id);
              return (
                <GenerationProgressItem
                  key={shot.id}
                  shot={shot}
                  status={statusData?.status ?? null}
                  isLoading={statusData?.isLoading ?? true}
                  onCancel={() => handleCancel(shot.id, shot.generationJobId)}
                />
              );
            })}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
});
