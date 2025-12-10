'use client';

import { useQuery } from '@tanstack/react-query';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { Skeleton } from '@kit/ui/skeleton';

import { formatNumber, formatPercent } from '../../lib/format-utils';
import { getQuickStatsAction } from '../../server/stats-actions';
import { Widget } from '../dashboard-widgets';

interface QuickStatsWidgetProps {
  accountId: string;
  onRemove?: () => void;
}

export function QuickStatsWidget({
  accountId,
  onRemove,
}: QuickStatsWidgetProps) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['quick-stats', accountId],
    queryFn: () => getQuickStatsAction({ accountId }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const metrics = [
    {
      label: 'Total Views (7d)',
      value: stats?.views || 0,
      change: stats?.viewsChange || 0,
    },
    {
      label: 'New Followers',
      value: stats?.followers || 0,
      change: stats?.followersChange || 0,
    },
    {
      label: 'Engagement Rate',
      value: `${(stats?.engagementRate || 0).toFixed(1)}%`,
      change: stats?.engagementChange || 0,
    },
    {
      label: 'Content Published',
      value: stats?.publishedCount || 0,
      change: null,
    },
  ];

  return (
    <Widget title="Quick Stats" description="Last 7 days" onRemove={onRemove}>
      {isLoading ? (
        <StatsSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <p className="text-muted-foreground text-xs">{metric.label}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-bold tabular-nums">
                  {typeof metric.value === 'number'
                    ? formatNumber(metric.value)
                    : metric.value}
                </span>
                {metric.change !== null && (
                  <ChangeIndicator value={metric.change} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}

function ChangeIndicator({ value }: { value: number }) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  const color =
    value > 0
      ? 'text-green-600'
      : value < 0
        ? 'text-red-600'
        : 'text-muted-foreground';

  return (
    <span className={`flex items-center gap-0.5 text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      {formatPercent(value)}
    </span>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i}>
          <Skeleton className="mb-1 h-3 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}
