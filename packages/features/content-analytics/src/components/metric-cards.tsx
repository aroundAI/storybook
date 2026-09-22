'use client';

import {
  Clock,
  DollarSign,
  Eye,
  Heart,
  Info,
  MessageCircle,
  Minus,
  Share2,
  TrendingDown,
  TrendingUp,
  UserPlus,
} from 'lucide-react';

import { Card, CardContent } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import type { ChangeResult } from '../lib/format';
import {
  calculateChange,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
} from '../lib/format';
import type { AnalyticsTotals } from '../types';

interface MetricCardsProps {
  data: AnalyticsTotals | null;
  /**
   * The period before, or null when none was measured. Null is "no
   * comparison" and draws nothing — it was read as zero, which made every
   * non-zero metric "+100.0%" on three of the four dashboards (KB-16).
   */
  previousData: AnalyticsTotals | null;
  isLoading: boolean;
}

export function MetricCards({
  data,
  previousData,
  isLoading,
}: MetricCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const metrics: MetricConfig[] = [
    {
      key: 'views',
      label: 'Views',
      value: data?.views || 0,
      previousValue: previousData ? previousData.views : null,
      formatter: formatNumber,
      description: 'Total video views across all platforms',
      icon: Eye,
    },
    {
      key: 'likes',
      label: 'Likes',
      value: data?.likes || 0,
      previousValue: previousData ? previousData.likes : null,
      formatter: formatNumber,
      description: 'Total likes, hearts, and reactions',
      icon: Heart,
    },
    {
      key: 'comments',
      label: 'Comments',
      value: data?.comments || 0,
      previousValue: previousData ? previousData.comments : null,
      formatter: formatNumber,
      description: 'Total comments and replies',
      icon: MessageCircle,
    },
    {
      key: 'shares',
      label: 'Shares',
      value: data?.shares || 0,
      previousValue: previousData ? previousData.shares : null,
      formatter: formatNumber,
      description: 'Times content was shared or reposted',
      icon: Share2,
    },
    {
      key: 'watchTime',
      label: 'Watch Time',
      value: data?.watchTimeSeconds || 0,
      previousValue: previousData ? previousData.watchTimeSeconds : null,
      formatter: formatDuration,
      description: 'Total time viewers spent watching',
      icon: Clock,
    },
    {
      key: 'subscribers',
      label: 'Subscribers',
      value: data?.subscribersGained || 0,
      previousValue: previousData ? previousData.subscribersGained : null,
      formatter: formatNumber,
      description: 'New followers and subscribers gained',
      icon: UserPlus,
    },
    {
      key: 'revenue',
      label: 'Revenue',
      value: data?.revenueCents || 0,
      previousValue: previousData ? previousData.revenueCents : null,
      formatter: (v) => formatCurrency(v / 100),
      description: 'Estimated ad revenue (YouTube only)',
      icon: DollarSign,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
      {metrics.map((metric) => (
        <MetricCard key={metric.key} metric={metric} />
      ))}
    </div>
  );
}

export interface MetricConfig {
  key: string;
  label: string;
  value: number;
  /** Null when no previous period was measured. */
  previousValue: number | null;
  formatter: (value: number) => string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function MetricCard({ metric }: { metric: MetricConfig }) {
  const {
    label,
    value,
    previousValue,
    formatter,
    description,
    icon: Icon,
  } = metric;

  const change = calculateChange(value, previousValue);

  return (
    <Card data-test={`metric-card-${metric.key}`}>
      <CardContent className="px-4 pt-4 pb-3">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex items-center gap-1.5">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">
              {label}
            </span>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Info about ${label}`}
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs text-sm">{description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-baseline justify-between">
          <span
            className="text-2xl font-bold tabular-nums"
            data-test="metric-value"
          >
            {formatter(value)}
          </span>
          {change.kind === 'change' ? (
            <MetricChange change={change} />
          ) : (
            <span className="sr-only">No previous period to compare</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricChange({
  change,
}: {
  change: Extract<ChangeResult, { kind: 'change' }>;
}) {
  const TrendIcon =
    change.direction === 'up'
      ? TrendingUp
      : change.direction === 'down'
        ? TrendingDown
        : Minus;

  const trendColor =
    change.direction === 'up'
      ? 'text-green-600'
      : change.direction === 'down'
        ? 'text-red-600'
        : 'text-muted-foreground';

  const verb =
    change.direction === 'up'
      ? 'Increased'
      : change.direction === 'down'
        ? 'Decreased'
        : 'No change';

  return (
    <div
      className={`flex items-center gap-0.5 text-sm ${trendColor}`}
      aria-label={`${verb} by ${formatPercent(Math.abs(change.percentage))}`}
      data-test="metric-change"
    >
      <TrendIcon className="h-3.5 w-3.5" />
      <span>{formatPercent(Math.abs(change.percentage))}</span>
    </div>
  );
}

export function MetricCardSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-2 px-4 pt-4 pb-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-24" />
      </CardContent>
    </Card>
  );
}

interface CompactMetricProps {
  label: string;
  value: string | number;
  change?: number;
}

export function CompactMetric({ label, value, change }: CompactMetricProps) {
  const changeColor =
    change && change > 0
      ? 'text-green-600'
      : change && change < 0
        ? 'text-red-600'
        : '';

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{value}</span>
        {change !== undefined && (
          <span className={`text-xs ${changeColor}`}>
            {change >= 0 ? '+' : ''}
            {change.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
