'use client';

import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';

/** Result shape from getYppProgressAction. */
export interface YppProgress {
  watchHours: number;
  targetWatchHours: number;
  watchHoursProgress: number;
  netSubscribers: number;
  targetSubscribers: number;
  subscriberProgress: number;
  windowDays: number;
}

interface YppProgressCardProps {
  /** Progress toward the monetization gate */
  progress: YppProgress;
  /** Loading state */
  isLoading?: boolean;
}

/**
 * Progress toward the YouTube Partner Program gate.
 *
 * Watch hours here are channel-wide (they include videos not published
 * through this platform), because the gate itself is channel-wide —
 * counting only platform-published videos would understate it.
 */
export function YppProgressCard({
  progress,
  isLoading = false,
}: YppProgressCardProps) {
  if (isLoading) {
    return <YppProgressCardSkeleton />;
  }

  const bothMet =
    progress.watchHoursProgress >= 1 && progress.subscriberProgress >= 1;

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'flex flex-col gap-1.5'}>
        <div className={'flex items-baseline justify-between text-sm'}>
          <span>Watch hours</span>
          <span className={'text-muted-foreground'}>
            {Math.round(progress.watchHours).toLocaleString()} /{' '}
            {progress.targetWatchHours.toLocaleString()}
          </span>
        </div>
        <Progress value={progress.watchHoursProgress * 100} />
      </div>

      <div className={'flex flex-col gap-1.5'}>
        <div className={'flex items-baseline justify-between text-sm'}>
          <span>Subscribers</span>
          <span className={'text-muted-foreground'}>
            {progress.netSubscribers.toLocaleString()} /{' '}
            {progress.targetSubscribers.toLocaleString()}
          </span>
        </div>
        <Progress value={progress.subscriberProgress * 100} />
      </div>

      <p className={'text-muted-foreground text-xs'}>
        {bothMet
          ? `Both thresholds met over the trailing ${progress.windowDays} days.`
          : `Trailing ${progress.windowDays} days, channel-wide.`}
      </p>
    </div>
  );
}

export function YppProgressCardSkeleton() {
  return (
    <div className={'flex flex-col gap-4'}>
      <Skeleton className={'h-10 w-full'} />
      <Skeleton className={'h-10 w-full'} />
    </div>
  );
}
