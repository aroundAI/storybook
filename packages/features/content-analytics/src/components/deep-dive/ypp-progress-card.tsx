'use client';

import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';

/**
 * One channel's progress — a single element of the array
 * `getYppProgressAction` returns, not the whole result.
 *
 * YPP is a per-channel gate, so the action never pools channels and this
 * card renders one channel at a time; the caller maps over the array.
 */
export interface YppChannelProgress {
  connectionId: string;
  channelName: string;
  watchHours: number;
  targetWatchHours: number;
  watchHoursProgress: number;
  netSubscribers: number;
  targetSubscribers: number;
  subscriberProgress: number;
  windowDays: number;
}

interface YppProgressCardProps {
  /** One channel's progress toward the monetization gate */
  progress: YppChannelProgress;
  /** Loading state */
  isLoading?: boolean;
}

/**
 * Progress toward the YouTube Partner Program gate, for one channel.
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
