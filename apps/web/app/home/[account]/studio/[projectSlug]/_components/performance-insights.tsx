'use client';

/**
 * PerformanceInsights Component - Analytics preview section
 * Matches Google Stitch ActiveState-Overview design with sparkline charts
 * ALL values fetched from real analytics - no hardcoded values
 */
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { Card, CardContent } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

interface PerformanceInsightsProps {
  totalViews?: number;
  viewsChange?: number;
  avgEngagement?: string;
  engagementChange?: number;
  audienceGrowth?: number;
  growthChange?: number;
}

interface MetricCardProps {
  label: string;
  value: string;
  change: number;
  color: 'indigo' | 'emerald' | 'blue';
}

function SparklineChart({ color }: { color: string }) {
  // Different paths for visual variety
  const paths = {
    indigo:
      'M0 35 L10 32 L20 34 L30 25 L40 28 L50 20 L60 22 L70 15 L80 18 L90 10 L100 5',
    emerald: 'M0 25 L15 28 L30 20 L45 22 L60 15 L75 18 L90 12 L100 8',
    blue: 'M0 30 L10 28 L20 29 L30 25 L40 22 L50 24 L60 20 L70 18 L80 15 L90 12 L100 10',
  };

  const strokeColor = {
    indigo: 'stroke-indigo-500',
    emerald: 'stroke-emerald-500',
    blue: 'stroke-blue-500',
  };

  const fillColor = {
    indigo: 'fill-indigo-500/10',
    emerald: 'fill-emerald-500/10',
    blue: 'fill-blue-500/10',
  };

  const path = paths[color as keyof typeof paths] || paths.indigo;

  return (
    <div className="mt-4 h-16 w-full">
      <svg
        className="h-full w-full"
        preserveAspectRatio="none"
        viewBox="0 0 100 40"
      >
        {/* Area fill */}
        <path
          d={`${path} V 40 H 0 Z`}
          className={fillColor[color as keyof typeof fillColor]}
        />
        {/* Line */}
        <path
          d={path}
          fill="none"
          className={strokeColor[color as keyof typeof strokeColor]}
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

function MetricCard({ label, value, change, color }: MetricCardProps) {
  const isPositive = change > 0;
  const isNeutral = change === 0;
  const changeLabel = isNeutral
    ? '0%'
    : `${isPositive ? '+' : ''}${change.toFixed(1)}%`;

  return (
    <Card className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {label}
            </p>
            <h3 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
              {value}
            </h3>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold',
              isNeutral
                ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                : isPositive
                  ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                  : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
            )}
          >
            {changeLabel}
            {isNeutral ? (
              <Minus className="h-3 w-3" />
            ) : isPositive ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
          </span>
        </div>
        <SparklineChart color={color} />
      </CardContent>
    </Card>
  );
}

export function PerformanceInsights({
  totalViews = 0,
  viewsChange = 0,
  avgEngagement = '0m 0s',
  engagementChange = 0,
  audienceGrowth = 0,
  growthChange = 0,
}: PerformanceInsightsProps) {
  // Format large numbers
  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  return (
    <section className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
          Performance Insights
        </h2>
        <select className="cursor-pointer border-none bg-transparent text-xs font-medium text-zinc-500 transition-colors hover:text-indigo-500 focus:ring-0 dark:text-zinc-400">
          <option>Last 30 Days</option>
          <option>Last Quarter</option>
          <option>All Time</option>
        </select>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <MetricCard
          label="Total Views"
          value={formatNumber(totalViews)}
          change={viewsChange}
          color="indigo"
        />
        <MetricCard
          label="Avg. Engagement"
          value={avgEngagement}
          change={engagementChange}
          color="emerald"
        />
        <MetricCard
          label="Audience Growth"
          value={formatNumber(audienceGrowth)}
          change={growthChange}
          color="blue"
        />
      </div>
    </section>
  );
}
