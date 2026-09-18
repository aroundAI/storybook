'use client';

import type { SubscriberSource } from '@kit/clickhouse';
import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';

import {
  NO_SUBSCRIBER_LEVEL,
  SUBSCRIBER_SOURCE_LABEL,
  describeRounding,
  formatSubscriberDay,
} from '../../lib/subscriber-disclosure';
import type { TargetBasis, YppApplicantStatus } from '../../lib/ypp-targets';

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
  /**
   * The channel's latest subscriber level (FILM-1617), or null when it has
   * no snapshot — never captured, or hidden by the owner.
   */
  subscribers: number | null;
  subscribersSource: SubscriberSource | null;
  /** The date of the newest data behind `subscribers`. */
  subscribersAsOf: string | null;
  /** 0 when exact; otherwise the true count may be up to this minus one higher. */
  subscribersRoundingStep: number;
  /** Movement over `windowDays`, not a count: what the progress bar measures. */
  netSubscribers: number;
  targetSubscribers: number;
  subscriberProgress: number;
  /**
   * Where each target came from (FILM-1608). Per metric rather than one for
   * the pair: the two override columns are independently nullable, so a
   * channel inheriting one target and overriding the other is an ordinary
   * row.
   *
   * This interface has to stay structurally identical to the action's
   * element type — FILM-1611 mounts this card directly on
   * `getYppProgressAction`'s output and relies on the two matching exactly.
   */
  watchHoursBasis: TargetBasis;
  subscribersBasis: TargetBasis;
  applicantStatus: YppApplicantStatus;
  /** Set only where the over-state rule actually raised a target. */
  escalated: boolean;
  joinedYppAt: string | null;
  alreadyJoined: boolean;
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

  // A channel already in the programme is past this gate, so rendering
  // progress toward it would be reporting on a race it has finished.
  if (progress.alreadyJoined) {
    return (
      <p className={'text-muted-foreground text-sm'} data-test={'ypp-joined'}>
        In the Partner Programme
        {progress.joinedYppAt ? ` since ${progress.joinedYppAt}` : ''}.
      </p>
    );
  }

  const bothMet =
    progress.watchHoursProgress >= 1 && progress.subscriberProgress >= 1;

  return (
    <div className={'flex flex-col gap-4'}>
      <ProgressRow
        label={'Watch hours'}
        current={Math.round(progress.watchHours)}
        target={progress.targetWatchHours}
        ratio={progress.watchHoursProgress}
        basis={progress.watchHoursBasis}
      />

      <SubscriberLevelRow progress={progress} />

      <ProgressRow
        label={`Net subscriber movement (${progress.windowDays} days)`}
        current={progress.netSubscribers}
        target={progress.targetSubscribers}
        ratio={progress.subscriberProgress}
        basis={progress.subscribersBasis}
      />

      <p className={'text-muted-foreground text-xs'}>
        {bothMet
          ? `Both thresholds met over the trailing ${progress.windowDays} days.`
          : `Trailing ${progress.windowDays} days, channel-wide.`}
        {/*
          Gated on `escalated`, not on the status alone. Every channel starts
          `unknown`, so keying off the status announced a raised bar on a
          brand-new account where nothing was configured at either level —
          a sentence asserting a rule that had not fired.
        */}
        {progress.escalated
          ? ' Applicant status unknown, so the higher of the two configured targets is shown.'
          : ''}
      </p>
    </div>
  );
}

function SubscriberLevelRow({ progress }: { progress: YppChannelProgress }) {
  if (progress.subscribers === null) {
    return (
      <div className={'flex flex-col gap-0.5'} data-test={'ypp-subscribers'}>
        <div className={'flex items-baseline justify-between text-sm'}>
          <span>Subscribers</span>
          <span
            className={'text-muted-foreground'}
            data-test={'ypp-subscribers-value'}
          >
            Unavailable
          </span>
        </div>
        <p className={'text-muted-foreground text-xs'}>{NO_SUBSCRIBER_LEVEL}</p>
      </div>
    );
  }

  const rounding = describeRounding(progress.subscribersRoundingStep);

  return (
    <div className={'flex flex-col gap-0.5'} data-test={'ypp-subscribers'}>
      <div className={'flex items-baseline justify-between text-sm'}>
        <span>Subscribers</span>
        <span data-test={'ypp-subscribers-value'}>
          {progress.subscribers.toLocaleString()}
        </span>
      </div>
      <p className={'text-muted-foreground text-xs'}>
        {progress.subscribersAsOf
          ? `As of ${formatSubscriberDay(progress.subscribersAsOf)}`
          : 'Latest'}
        {progress.subscribersSource
          ? `, ${SUBSCRIBER_SOURCE_LABEL[progress.subscribersSource]}.`
          : '.'}
        {rounding ? (
          <span data-test={'ypp-subscribers-rounding'}> {rounding}</span>
        ) : null}
      </p>
    </div>
  );
}

const BASIS_LABEL: Record<TargetBasis, string> = {
  channel: 'channel target',
  account: 'account target',
  default: 'default target',
};

function ProgressRow({
  label,
  current,
  target,
  ratio,
  basis,
}: {
  label: string;
  current: number;
  target: number;
  ratio: number;
  basis: TargetBasis;
}) {
  return (
    <div className={'flex flex-col gap-1.5'}>
      <div className={'flex items-baseline justify-between text-sm'}>
        <span>{label}</span>
        <span className={'text-muted-foreground'}>
          {current.toLocaleString()} / {target.toLocaleString()}
          <span className={'ml-1.5 text-xs'}>({BASIS_LABEL[basis]})</span>
        </span>
      </div>
      <Progress value={ratio * 100} />
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
