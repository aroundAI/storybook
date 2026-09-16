'use client';

import { PieChart } from 'lucide-react';

import { Skeleton } from '@kit/ui/skeleton';

import {
  REVENUE_CATEGORY_COLOR,
  REVENUE_CATEGORY_LABEL,
  revenueMixView,
} from '../lib/revenue-mix';

interface RevenueMixCardProps {
  /** Revenue in cents keyed by category, from RevenueSummary.byType */
  byType: Record<string, number>;
  /** Loading state */
  isLoading?: boolean;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Revenue mix by category. Ads falling as a share of total is the health
 * indicator here, not a warning — it means other income streams are
 * growing faster than platform payouts.
 */
export function RevenueMixCard({
  byType,
  isLoading = false,
}: RevenueMixCardProps) {
  if (isLoading) {
    return <RevenueMixCardSkeleton />;
  }

  const { entries, total, adShare, negatives } = revenueMixView(byType);

  if (total === 0) {
    // "No revenue recorded" would be wrong when every row was a clawback:
    // something was recorded, and hiding it is what the negatives
    // disclosure below exists to stop.
    return (
      <p className={'text-muted-foreground text-sm'}>
        {negatives.length > 0
          ? `No positive revenue this period — ${negatives.length} negative ${
              negatives.length === 1 ? 'adjustment' : 'adjustments'
            } only.`
          : 'No revenue recorded for this period.'}
      </p>
    );
  }

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'bg-muted flex h-3 w-full overflow-hidden rounded-full'}>
        {entries.map(([category, cents]) => (
          <div
            key={category}
            className={
              REVENUE_CATEGORY_COLOR[category] ?? 'bg-muted-foreground'
            }
            style={{ width: `${(cents / total) * 100}%` }}
            title={`${REVENUE_CATEGORY_LABEL[category] ?? category}: ${formatCents(cents)}`}
          />
        ))}
      </div>

      <div className={'flex flex-col gap-2'}>
        {entries.map(([category, cents]) => (
          <div
            key={category}
            className={'flex items-center justify-between gap-2 text-sm'}
          >
            <span className={'flex items-center gap-2'}>
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  REVENUE_CATEGORY_COLOR[category] ?? 'bg-muted-foreground'
                }`}
              />
              {REVENUE_CATEGORY_LABEL[category] ?? category}
            </span>
            <span className={'text-muted-foreground'}>
              {formatCents(cents)} · {Math.round((cents / total) * 100)}%
            </span>
          </div>
        ))}
      </div>

      <p className={'text-muted-foreground text-xs'}>
        {Math.round(adShare * 100)}% of revenue comes from platform payouts (ads
        and Premium). A falling share means other income is growing faster than
        what the platform pays out.
      </p>

      {negatives.length > 0 ? (
        <p className={'text-muted-foreground text-xs'}>
          Excludes {negatives.length} negative{' '}
          {negatives.length === 1 ? 'adjustment' : 'adjustments'} — this mix
          covers positive revenue only, so it will not match the period total.
        </p>
      ) : null}
    </div>
  );
}

export function RevenueMixCardSkeleton() {
  return (
    <div className={'flex flex-col gap-4'}>
      <Skeleton className={'h-3 w-full rounded-full'} />
      <div className={'flex flex-col gap-2'}>
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className={'h-4 w-full'} />
        ))}
      </div>
    </div>
  );
}

export const RevenueMixIcon = PieChart;
