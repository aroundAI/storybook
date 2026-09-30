'use client';

import { Skeleton } from '@kit/ui/skeleton';

import { formatNumber } from '../../lib/format';
import type { CardClaim } from '../overview/card-claim';

/** One day from getRollingViewsAction. */
export interface RollingViewsEntry {
  date: string;
  views: number;
  rollingViews: number;
}

interface Rolling90CardProps {
  /** Days in chronological order, gaps zero-filled by the query */
  points: RollingViewsEntry[];
  windowDays: number;
}

function dayInWords(date: string): string {
  const parsed = new Date(date);

  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

/**
 * The newest trailing-window total, set beside the same window one window
 * earlier. Both are sums the query returned; no percentage is derived, so a
 * quiet earlier window cannot turn into a misleading "up 4,000%".
 */
export function rolling90Claim(
  points: readonly RollingViewsEntry[],
  windowDays: number,
): CardClaim {
  const latest = points[points.length - 1];

  if (!latest || points.length < windowDays) {
    return {
      figure: null,
      noFigure: 'Not enough history yet.',
      sentence: `A ${windowDays}-day total needs ${windowDays} days of history.`,
    };
  }

  if (points.every((point) => point.views === 0)) {
    return {
      figure: null,
      noFigure: 'No views recorded in this window.',
      sentence:
        'Either nothing was watched or nothing has been ingested yet; the data cannot say which.',
    };
  }

  const earlier = points[points.length - 1 - windowDays];
  const comparison =
    earlier && points.length - 1 - windowDays >= windowDays - 1
      ? `, against ${formatNumber(earlier.rollingViews)} in the ${windowDays} days to ${dayInWords(earlier.date)}`
      : '';

  return {
    figure: formatNumber(latest.rollingViews),
    sentence: `Views in the ${windowDays} days to ${dayInWords(latest.date)}${comparison}.`,
  };
}

/** The window the Deep Dive tab asks for. */
export const ROLLING_WINDOW_DAYS = 90;

const WIDTH = 240;
const HEIGHT = 56;

/**
 * The rolling total over time. The figure and its sentence are the shell's
 * (`rolling90Claim`); this is the shape behind them.
 */
export function Rolling90Card({ points, windowDays }: Rolling90CardProps) {
  if (points.length < windowDays) {
    return null;
  }

  const max = Math.max(...points.map((point) => point.rollingViews), 1);
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * WIDTH;
      const y = HEIGHT - (point.rollingViews / max) * HEIGHT;

      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={'h-14 w-full text-primary'}
      role={'img'}
      aria-label={`Views in the trailing ${windowDays} days, from ${dayInWords(points[0]!.date)} to ${dayInWords(points[points.length - 1]!.date)}`}
      preserveAspectRatio={'none'}
      data-test={'rolling-90-chart'}
    >
      <path
        d={path}
        fill={'none'}
        stroke={'currentColor'}
        strokeWidth={1.5}
        vectorEffect={'non-scaling-stroke'}
      />
    </svg>
  );
}

export function Rolling90CardSkeleton() {
  return (
    <div className={'flex flex-col gap-2'}>
      <Skeleton className={'h-14 w-full'} />
    </div>
  );
}
