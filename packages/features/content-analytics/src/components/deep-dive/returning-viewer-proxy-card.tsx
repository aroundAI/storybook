'use client';

import { Skeleton } from '@kit/ui/skeleton';

import { formatNumber } from '../../lib/format';
import {
  type SubscribedShareMonth,
  type SubscribedSplit,
  measurableRuns,
} from '../../lib/returning-viewer-proxy';
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
      sentence: 'No subscriber split has been collected for these videos yet.',
    };
  }

  return {
    figure: `${Math.round(split.subscribedShare * 100)}%`,
    sentence:
      'of views came from subscribers. A proxy for returning viewers, not a count of them: no platform reports new against returning viewers.',
  };
}

export interface ReturningViewerProxyData extends SubscribedSplit {
  /** Share per upload month, null where a month has no measurable views. */
  trend: SubscribedShareMonth[];
}

interface ReturningViewerProxyCardProps {
  split: ReturningViewerProxyData;
}

const CHART_WIDTH = 240;
const CHART_HEIGHT = 64;

function monthLabel(month: string): string {
  return new Date(`${month}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function percent(share: number | null): string {
  return share === null ? 'no data' : `${Math.round(share * 100)}%`;
}

/**
 * The subscribed share per upload month. Months with no measurable views are
 * gaps in the line, not points at 0%, and the table beneath lists every
 * month with the counts behind its figure.
 */
function SubscribedShareTrend({ trend }: { trend: SubscribedShareMonth[] }) {
  const first = trend[0];
  const last = trend[trend.length - 1];

  if (!first || !last || trend.every((m) => m.subscribedShare === null)) {
    return null;
  }

  const runs = measurableRuns(trend, CHART_WIDTH, CHART_HEIGHT);

  return (
    <div className={'flex flex-col gap-2'} data-test={'returning-viewer-trend'}>
      <p className={'text-xs font-medium'}>Subscribed share by upload month</p>
      <div className={'flex gap-2'}>
        <div
          className={
            'flex flex-col justify-between text-[10px] text-muted-foreground'
          }
          aria-hidden={'true'}
        >
          <span>100%</span>
          <span>0%</span>
        </div>
        <svg
          viewBox={`-4 -4 ${CHART_WIDTH + 8} ${CHART_HEIGHT + 8}`}
          className={'h-16 w-full text-primary'}
          role={'img'}
          aria-label={`Subscribed share of views by upload month, from ${monthLabel(first.month)} to ${monthLabel(last.month)}; months without data are gaps`}
          preserveAspectRatio={'none'}
          data-test={'returning-viewer-trend-chart'}
        >
          <line
            x1={0}
            x2={CHART_WIDTH}
            y1={CHART_HEIGHT}
            y2={CHART_HEIGHT}
            stroke={'currentColor'}
            strokeOpacity={0.2}
            vectorEffect={'non-scaling-stroke'}
          />
          {runs.map((run) => (
            <g key={run[0]!.month}>
              {run.length > 1 ? (
                <polyline
                  points={run.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={'none'}
                  stroke={'currentColor'}
                  strokeWidth={1.5}
                  vectorEffect={'non-scaling-stroke'}
                />
              ) : null}
              {run.map((p) => (
                <circle
                  key={p.month}
                  cx={p.x}
                  cy={p.y}
                  r={2}
                  fill={'currentColor'}
                />
              ))}
            </g>
          ))}
        </svg>
      </div>
      <div className={'flex justify-between text-[10px] text-muted-foreground'}>
        <span>{monthLabel(first.month)}</span>
        <span>Upload month</span>
        <span>{monthLabel(last.month)}</span>
      </div>
      <details className={'text-xs'}>
        <summary className={'cursor-pointer text-muted-foreground'}>
          Show as a table
        </summary>
        <table className={'mt-2 w-full'} data-test={'returning-viewer-table'}>
          <thead>
            <tr className={'text-left text-muted-foreground'}>
              <th className={'font-medium'}>Upload month</th>
              <th className={'text-right font-medium'}>Subscribed</th>
              <th className={'text-right font-medium'}>Not subscribed</th>
              <th className={'text-right font-medium'}>Share</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((m) => (
              <tr key={m.month} className={'border-t'}>
                <td>{monthLabel(m.month)}</td>
                <td className={'text-right'}>
                  {m.subscribedShare === null
                    ? '-'
                    : formatNumber(m.subscribedViews)}
                </td>
                <td className={'text-right'}>
                  {m.subscribedShare === null
                    ? '-'
                    : formatNumber(m.notSubscribedViews)}
                </td>
                <td className={'text-right'}>{percent(m.subscribedShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
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
      <SubscribedShareTrend trend={split.trend} />
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
