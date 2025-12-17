'use client';

import { Heart, TrendingUp } from 'lucide-react';

import { formatNumber, formatPercent } from '../../lib/format';
import { type BarDataPoint, MiniBarChart } from '../charts/mini-bar-chart';
import { AnalyticsCard } from './analytics-card';

interface LikesCardProps {
  /** Total likes */
  likes: number;
  /** Percentage change */
  change?: number;
  /** Bar chart data points (legacy - array of numbers) */
  barData?: number[];
  /** Bar chart data points with labels (preferred) */
  barDataPoints?: BarDataPoint[];
}

export function LikesCard({
  likes,
  change,
  barData,
  barDataPoints,
}: LikesCardProps) {
  // Use labeled data if provided, otherwise fall back to plain array
  // No fake mock data - only show real data or nothing
  const dataPoints = barDataPoints;
  const data = barData;

  return (
    <AnalyticsCard
      title="Total Likes"
      icon={Heart}
      description="Total likes, hearts, and reactions"
      footer="Aggregated across all platforms"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          {formatNumber(likes)}
        </span>
        {change !== undefined && change !== 0 && (
          <span className="inline-flex items-center rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <TrendingUp className="mr-0.5 h-3.5 w-3.5" />
            {formatPercent(Math.abs(change))}
          </span>
        )}
      </div>
      {(dataPoints || data) && (
        <div className="mt-4">
          <MiniBarChart
            data={dataPoints ? undefined : data}
            dataPoints={dataPoints}
            color="var(--analytics-blue)"
            tooltipLabel="Likes"
          />
        </div>
      )}
    </AnalyticsCard>
  );
}
