'use client';

import { Eye, TrendingUp } from 'lucide-react';

import { formatNumber, formatPercent } from '../../lib/format';
import {
  SparklineArea,
  type SparklineDataPoint,
} from '../charts/sparkline-area';
import { AnalyticsCard } from './analytics-card';

interface ViewsCardProps {
  /** Total views */
  views: number;
  /** Percentage change */
  change?: number;
  /** Sparkline data points (legacy - array of numbers) */
  sparklineData?: number[];
  /** Sparkline data points with labels (preferred) */
  sparklineDataPoints?: SparklineDataPoint[];
}

export function ViewsCard({
  views,
  change,
  sparklineData,
  sparklineDataPoints,
}: ViewsCardProps) {
  // Use labeled data if provided, otherwise fall back to plain array
  // No fake mock data - only show real data or nothing
  const dataPoints = sparklineDataPoints;
  const data = sparklineData;

  return (
    // No platform list. This read "Aggregated across TikTok, YouTube, and
    // Instagram" whatever the filter said and whichever platforms had rows;
    // a true one needs the capability model (FILM-1703), and FILM-1705
    // restores it from there.
    <AnalyticsCard
      title="Total Views"
      icon={Eye}
      description="Views of this project's published content in the selected period"
      data-test="overview-views"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          {formatNumber(views)}
        </span>
        {change !== undefined && change !== 0 && (
          <span className="inline-flex items-center rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <TrendingUp className="mr-0.5 h-3.5 w-3.5" />
            {formatPercent(Math.abs(change))}
          </span>
        )}
      </div>
      {(dataPoints || data) && (
        <div className="relative mt-4 h-16 w-full">
          <SparklineArea
            data={dataPoints ? undefined : data}
            dataPoints={dataPoints}
            width={200}
            height={60}
            strokeColor="var(--analytics-green)"
            fillColor="var(--analytics-green)"
            tooltipLabel="Views"
            className="h-full w-full"
          />
        </div>
      )}
    </AnalyticsCard>
  );
}
