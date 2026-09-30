'use client';

import { Skeleton } from '@kit/ui/skeleton';

import { formatNumber } from '../../lib/format';
import type { SubscribedSplit } from '../../lib/returning-viewer-proxy';
import type { CardClaim } from '../overview/card-claim';

/**
 * The share of views that came from subscribers, named for what it is.
 * YouTube reports no new-versus-returning split to anyone but Studio, so this
 * is a proxy and the sentence says so.
 */
export function returningViewerClaim(split: SubscribedSplit): CardClaim {
  if (split.subscribedShare === null) {
    return {
      figure: null,
      noFigure: 'No subscriber split reported yet.',
      sentence:
        'YouTube reports whether views came from subscribers; none have been ingested for these videos.',
    };
  }

  return {
    figure: `${Math.round(split.subscribedShare * 100)}%`,
    sentence:
      'of views came from subscribers. A proxy for returning viewers, not a count of them: YouTube does not report new against returning viewers.',
  };
}

interface ReturningViewerProxyCardProps {
  split: SubscribedSplit;
}

/**
 * Subscribed against not-subscribed views as one bar with both counts
 * beside it, so the proportion can be checked against the numbers behind it.
 */
export function ReturningViewerProxyCard({
  split,
}: ReturningViewerProxyCardProps) {
  if (split.subscribedShare === null) {
    return null;
  }

  return (
    <div className={'flex flex-col gap-2'} data-test={'returning-viewer-split'}>
      <div
        className={'flex h-3 w-full overflow-hidden rounded-full bg-muted'}
        role={'img'}
        aria-label={`${Math.round(split.subscribedShare * 100)}% of views from subscribers`}
      >
        <div
          className={'bg-primary'}
          style={{ width: `${split.subscribedShare * 100}%` }}
        />
      </div>
      <dl className={'flex justify-between text-xs text-muted-foreground'}>
        <div>
          <dt className={'inline'}>Subscribed </dt>
          <dd className={'inline font-medium text-foreground'}>
            {formatNumber(split.subscribedViews)}
          </dd>
        </div>
        <div>
          <dt className={'inline'}>Not subscribed </dt>
          <dd className={'inline font-medium text-foreground'}>
            {formatNumber(split.notSubscribedViews)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function ReturningViewerProxyCardSkeleton() {
  return (
    <div className={'flex flex-col gap-2'}>
      <Skeleton className={'h-3 w-full'} />
      <Skeleton className={'h-4 w-2/3'} />
    </div>
  );
}
