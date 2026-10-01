'use client';

import { type ReactNode, useContext } from 'react';

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

import { type MetricFamily, platformsWithData } from '@kit/clickhouse';
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
import { CoverageContext } from './coverage-context';
import { ProvenanceChipFor } from './provenance-chip';

const PLATFORM_NOT_MEASURED_REASON =
  'The platforms behind these figures did not report it: TikTok sends no watch time or follower gain, and Instagram sends no follower gain.';

/** For the analytics, project and season views, which do not read these figures. */
export const NOT_COLLECTED_HERE_REASON =
  'Watch time and follower gain are not collected for a whole project or season. Open an episode to see them.';

/** For a family no platform supplies — revenue, today (FILM-1705). */
export const NOT_COLLECTED_YET_REASON =
  'Not collected yet: no platform the app reads reports this figure.';

interface MetricCardsProps {
  data: AnalyticsTotals | null;
  /**
   * The period before, or null when none was measured. Null is "no
   * comparison" and draws nothing — it was read as zero, which made every
   * non-zero metric "+100.0%" on three of the four dashboards (KB-16).
   */
  previousData: AnalyticsTotals | null;
  isLoading: boolean;
  /** Why a null figure has no value, where it is not the platforms' doing. */
  notMeasuredReason?: string;
}

export function MetricCards({
  data,
  previousData,
  isLoading,
  notMeasuredReason = PLATFORM_NOT_MEASURED_REASON,
}: MetricCardsProps) {
  // The chip needs the page's coverage. Outside the analytics page — the
  // project, season and episode dashboards mount no provider — the cards
  // render as before, without one.
  const withProvenance = useContext(CoverageContext) !== null;

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
      description: 'Total video views',
      icon: Eye,
      metricFamily: 'engagement',
    },
    {
      key: 'likes',
      label: 'Likes',
      value: data?.likes || 0,
      previousValue: previousData ? previousData.likes : null,
      formatter: formatNumber,
      description: 'Total likes, hearts, and reactions',
      icon: Heart,
      metricFamily: 'engagement',
    },
    {
      key: 'comments',
      label: 'Comments',
      value: data?.comments || 0,
      previousValue: previousData ? previousData.comments : null,
      formatter: formatNumber,
      description: 'Total comments and replies',
      icon: MessageCircle,
      metricFamily: 'engagement',
    },
    {
      key: 'shares',
      label: 'Shares',
      value: data?.shares || 0,
      previousValue: previousData ? previousData.shares : null,
      formatter: formatNumber,
      description: 'Times content was shared or reposted',
      icon: Share2,
      metricFamily: 'engagement',
    },
    {
      key: 'watchTime',
      label: 'Watch Time',
      value: data ? data.watchTimeSeconds : null,
      previousValue: previousData ? previousData.watchTimeSeconds : null,
      formatter: formatDuration,
      description: 'Total time viewers spent watching',
      icon: Clock,
      metricFamily: 'watch_time',
    },
    {
      key: 'subscribers',
      label: 'Subscribers',
      value: data ? data.subscribersGained : null,
      previousValue: previousData ? previousData.subscribersGained : null,
      formatter: formatNumber,
      description: 'New followers and subscribers gained',
      icon: UserPlus,
      metricFamily: 'channel_totals',
    },
    {
      key: 'revenue',
      label: 'Revenue',
      value: data?.revenueCents || 0,
      previousValue: previousData ? previousData.revenueCents : null,
      formatter: (v) => formatCurrency(v / 100),
      description: 'Estimated ad revenue',
      icon: DollarSign,
      metricFamily: 'revenue',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
      {metrics.map((metric) => (
        <MetricCard
          key={metric.key}
          metric={metric}
          chip={
            withProvenance ? (
              <ProvenanceChipFor
                metricFamily={metric.metricFamily}
                title={metric.label}
              />
            ) : undefined
          }
          notMeasuredReason={notMeasuredReason}
        />
      ))}
    </div>
  );
}

export interface MetricConfig {
  key: string;
  label: string;
  /**
   * `null` when this scope or the platforms behind it did not measure it:
   * the card says so, no digits (FILM-1705 §5, KB-149).
   */
  value: number | null;
  /** Null when no previous period was measured. */
  previousValue: number | null;
  formatter: (value: number) => string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** What the figure is, for its chip and for whether any platform supplies it. */
  metricFamily: MetricFamily;
}

/**
 * Why a card shows no figure, or `null` when it shows one. A family no
 * platform supplies — revenue, today — is never drawn as a number, whatever
 * the total says: that total is a column nothing writes but a 0.
 */
export function unmeasuredReason(
  metric: MetricConfig,
  notMeasured: string,
): string | null {
  if (platformsWithData(metric.metricFamily).length === 0) {
    return NOT_COLLECTED_YET_REASON;
  }

  return metric.value === null ? notMeasured : null;
}

export function MetricCard({
  metric,
  chip,
  notMeasuredReason = PLATFORM_NOT_MEASURED_REASON,
}: {
  metric: MetricConfig;
  /** FILM-1705's provenance chip, when the page has coverage to give one. */
  chip?: ReactNode;
  /** Why a null figure has no value: the tooltip of its "Not measured". */
  notMeasuredReason?: string;
}) {
  const {
    label,
    value,
    previousValue,
    formatter,
    description,
    icon: Icon,
  } = metric;

  const unmeasured = unmeasuredReason(metric, notMeasuredReason);
  const change =
    unmeasured === null && value !== null
      ? calculateChange(value, previousValue)
      : null;

  return (
    <Card data-test={`metric-card-${metric.key}`}>
      <CardContent className="px-4 pt-4 pb-3">
        <div className="mb-2 flex items-start justify-between gap-2">
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

        {chip && <div className="mb-2 flex">{chip}</div>}

        <div className="flex items-baseline justify-between">
          {unmeasured !== null || value === null ? (
            // As the reach overview's cards do: words, not a 0 that reads
            // as "nobody watched" (KB-149), and the reason on hover.
            <span
              className="text-lg font-medium text-muted-foreground"
              title={unmeasured ?? notMeasuredReason}
              data-test="metric-not-measured"
            >
              Not measured
            </span>
          ) : (
            <span
              className="text-2xl font-bold tabular-nums"
              data-test="metric-value"
            >
              {formatter(value)}
            </span>
          )}
          {change?.kind === 'change' ? (
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
