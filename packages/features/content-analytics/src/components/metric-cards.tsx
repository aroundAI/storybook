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
      previousValue: previousData?.views || 0,
      formatter: formatNumber,
      description: 'Total video views across all platforms',
      icon: Eye,
    },
    {
      key: 'likes',
      label: 'Likes',
      value: data?.likes || 0,
      previousValue: previousData?.likes || 0,
      formatter: formatNumber,
      description: 'Total likes, hearts, and reactions',
      icon: Heart,
    },
    {
      key: 'comments',
      label: 'Comments',
      value: data?.comments || 0,
      previousValue: previousData?.comments || 0,
      formatter: formatNumber,
      description: 'Total comments and replies',
      icon: MessageCircle,
    },
    {
      key: 'shares',
      label: 'Shares',
      value: data?.shares || 0,
      previousValue: previousData?.shares || 0,
      formatter: formatNumber,
      description: 'Times content was shared or reposted',
      icon: Share2,
    },
    {
      key: 'watchTime',
      label: 'Watch Time',
      value: data?.watchTimeSeconds || 0,
      previousValue: previousData?.watchTimeSeconds || 0,
      formatter: formatDuration,
      description: 'Total time viewers spent watching',
      icon: Clock,
    },
    {
      key: 'subscribers',
      label: 'Subscribers',
      value: data?.subscribersGained || 0,
      previousValue: previousData?.subscribersGained || 0,
      formatter: formatNumber,
      description: 'New followers and subscribers gained',
      icon: UserPlus,
    },
    {
      key: 'revenue',
      label: 'Revenue',
      value: data?.revenueCents || 0,
      previousValue: previousData?.revenueCents || 0,
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
  previousValue: number;
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

  return (
    <Card>
      <CardContent className="px-4 pb-3 pt-4">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex items-center gap-1.5">
            <Icon className="text-muted-foreground h-4 w-4" />
            <span className="text-muted-foreground text-sm font-medium">
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
          <span className="text-2xl font-bold tabular-nums">
            {formatter(value)}
          </span>
          <div
            className={`flex items-center gap-0.5 text-sm ${trendColor}`}
            aria-label={`${change.direction === 'up' ? 'Increased' : change.direction === 'down' ? 'Decreased' : 'No change'} by ${formatPercent(Math.abs(change.percentage))}`}
          >
            <TrendIcon className="h-3.5 w-3.5" />
            <span>{formatPercent(Math.abs(change.percentage))}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricCardSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-2 px-4 pb-3 pt-4">
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
      <span className="text-muted-foreground text-sm">{label}</span>
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
