'use client';

import { PieChart } from 'lucide-react';

import { Skeleton } from '@kit/ui/skeleton';

interface RevenueMixCardProps {
  /** Revenue in cents keyed by category, from RevenueSummary.byType */
  byType: Record<string, number>;
  /** Loading state */
  isLoading?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  ads: 'Ads',
  premium: 'Premium',
  sponsorship: 'Sponsorship',
  product: 'Product',
  affiliate: 'Affiliate',
  other: 'Other',
};

/** Distinct hues per category so the mix reads at a glance. */
const CATEGORY_COLORS: Record<string, string> = {
  ads: 'bg-chart-1',
  premium: 'bg-chart-2',
  sponsorship: 'bg-chart-3',
  product: 'bg-chart-4',
  affiliate: 'bg-chart-5',
  other: 'bg-muted-foreground',
};

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

  const entries = Object.entries(byType)
    .filter(([, cents]) => cents > 0)
    .sort(([, a], [, b]) => b - a);

  const total = entries.reduce((sum, [, cents]) => sum + cents, 0);

  if (total === 0) {
    return (
      <p className={'text-muted-foreground text-sm'}>
        No revenue recorded for this period.
      </p>
    );
  }

  const adShare = (byType.ads ?? 0) / total;

  return (
    <div className={'flex flex-col gap-4'}>
      <div className={'bg-muted flex h-3 w-full overflow-hidden rounded-full'}>
        {entries.map(([category, cents]) => (
          <div
            key={category}
            className={CATEGORY_COLORS[category] ?? 'bg-muted-foreground'}
            style={{ width: `${(cents / total) * 100}%` }}
            title={`${CATEGORY_LABELS[category] ?? category}: ${formatCents(cents)}`}
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
                  CATEGORY_COLORS[category] ?? 'bg-muted-foreground'
                }`}
              />
              {CATEGORY_LABELS[category] ?? category}
            </span>
            <span className={'text-muted-foreground'}>
              {formatCents(cents)} · {Math.round((cents / total) * 100)}%
            </span>
          </div>
        ))}
      </div>

      <p className={'text-muted-foreground text-xs'}>
        {Math.round(adShare * 100)}% of revenue comes from ads. A falling ad
        share means other income is growing faster than platform payouts.
      </p>
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
