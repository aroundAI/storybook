'use client';

import { Eye } from 'lucide-react';

import type { AnalyticsPlatform } from '@kit/clickhouse';

import {
  SparklineArea,
  type SparklineDataPoint,
} from '../charts/sparkline-area';
import { AnalyticsCard } from './analytics-card';
import { countClaim } from './card-claim';

interface ViewsCardProps {
  /** The platforms the figure covers, for "where this comes from". */
  platforms?: readonly AnalyticsPlatform[];
  /** Total views, or `null` when they could not be read — never a 0 for that. */
  views: number | null;
  /** Sparkline data points with labels */
  sparklineDataPoints?: SparklineDataPoint[];
}

export function ViewsCard({
  views,
  sparklineDataPoints,
  platforms,
}: ViewsCardProps) {
  return (
    // No platform list. This read "Aggregated across TikTok, YouTube, and
    // Instagram" whatever the filter said and whichever platforms had rows;
    // a true one needs the capability model (FILM-1703), and FILM-1705
    // restores it from there as the card's chip.
    <AnalyticsCard
      title="Total Views"
      icon={Eye}
      metricFamily="engagement"
      platforms={platforms}
      claim={countClaim(
        views,
        'Views of this project’s published content in the selected period.',
      )}
      data-test="overview-views"
    >
      {sparklineDataPoints && (
        <div className="relative h-16 w-full">
          <SparklineArea
            dataPoints={sparklineDataPoints}
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
