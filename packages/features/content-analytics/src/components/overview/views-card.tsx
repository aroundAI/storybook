'use client';

import { Eye } from 'lucide-react';

import type { Measured } from '../../lib/measured';
import {
  SparklineArea,
  type SparklineDataPoint,
} from '../charts/sparkline-area';
import { AnalyticsCard } from './analytics-card';
import { countClaim } from './card-claim';

interface ViewsCardProps {
  /** Total views: absent when they could not be read, null when not measured. */
  views: Measured<number | null>;
  /** Sparkline data points with labels */
  sparklineDataPoints?: SparklineDataPoint[];
}

export function ViewsCard({ views, sparklineDataPoints }: ViewsCardProps) {
  return (
    // No platform list. This read "Aggregated across TikTok, YouTube, and
    // Instagram" whatever the filter said and whichever platforms had rows;
    // the shell's chip now says it, from the matrix and the window's
    // observed coverage (FILM-1705).
    <AnalyticsCard
      title="Total Views"
      icon={Eye}
      metricFamily="engagement"
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
