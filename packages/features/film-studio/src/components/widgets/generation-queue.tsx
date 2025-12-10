'use client';

import { useQuery } from '@tanstack/react-query';

import { Badge } from '@kit/ui/badge';
import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';

import type { GenerationJob } from '../../server/generation-actions';
import { getActiveGenerationsAction } from '../../server/generation-actions';
import { Widget } from '../dashboard-widgets';

interface GenerationQueueWidgetProps {
  accountId: string;
  onRemove?: () => void;
}

export function GenerationQueueWidget({
  accountId,
  onRemove,
}: GenerationQueueWidgetProps) {
  const { data: jobs, isLoading } = useQuery({
    queryKey: ['active-generations', accountId],
    queryFn: () => getActiveGenerationsAction({ accountId }),
    refetchInterval: 5000, // Poll every 5 seconds for active jobs
  });

  const activeJobs =
    (jobs?.filter(
      (j: GenerationJob) => j.status === 'processing',
    ) as GenerationJob[]) || [];
  const queuedJobs =
    (jobs?.filter(
      (j: GenerationJob) => j.status === 'queued',
    ) as GenerationJob[]) || [];

  return (
    <Widget
      title="Generation Queue"
      description={
        isLoading
          ? 'Loading...'
          : `${activeJobs.length} active, ${queuedJobs.length} queued`
      }
      onRemove={onRemove}
    >
      <div className="space-y-4">
        {isLoading && <QueueSkeleton />}

        {!isLoading &&
          activeJobs.map((job: GenerationJob) => (
            <div key={job.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {job.jobType}
                  </Badge>
                  <span className="max-w-[150px] truncate text-sm">
                    {job.name}
                  </span>
                </div>
                <span className="text-muted-foreground text-xs">
                  {job.progress}%
                </span>
              </div>
              <Progress value={job.progress} className="h-1.5" />
            </div>
          ))}

        {!isLoading && queuedJobs.length > 0 && (
          <div className="border-t pt-2">
            <p className="text-muted-foreground mb-2 text-sm">
              Queued ({queuedJobs.length})
            </p>
            <div className="flex flex-wrap gap-1">
              {queuedJobs.slice(0, 5).map((job: GenerationJob) => (
                <Badge key={job.id} variant="outline" className="text-xs">
                  {job.jobType}
                </Badge>
              ))}
              {queuedJobs.length > 5 && (
                <Badge variant="outline" className="text-xs">
                  +{queuedJobs.length - 5} more
                </Badge>
              )}
            </div>
          </div>
        )}

        {!isLoading && activeJobs.length === 0 && queuedJobs.length === 0 && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No active generations
          </p>
        )}
      </div>
    </Widget>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-3 w-8" />
          </div>
          <Skeleton className="h-1.5 w-full" />
        </div>
      ))}
    </div>
  );
}
