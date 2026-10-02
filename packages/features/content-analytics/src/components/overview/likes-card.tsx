'use client';

import { Heart } from 'lucide-react';

import { type BarDataPoint, MiniBarChart } from '../charts/mini-bar-chart';
import { AnalyticsCard } from './analytics-card';
import { countClaim } from './card-claim';

interface LikesCardProps {
  /** Total likes, or `null` when they could not be read — never a 0 for that. */
  likes: number | null;
  /** Bar chart data points with labels */
  barDataPoints?: BarDataPoint[];
}

/**
 * Likes. The footer "Aggregated across all platforms" is gone rather than
 * moved: it stayed put when the filter deselected platforms, and saying
 * which platforms a figure covers is FILM-1705's chip, from the matrix.
 */
export function LikesCard({ likes, barDataPoints }: LikesCardProps) {
  return (
    <AnalyticsCard
      title="Total Likes"
      icon={Heart}
      metricFamily="engagement"
      claim={countClaim(
        likes,
        'Likes, hearts and reactions in the selected period.',
      )}
      data-test="overview-likes"
    >
      {barDataPoints && (
        <MiniBarChart
          dataPoints={barDataPoints}
          color="var(--analytics-blue)"
          tooltipLabel="Likes"
        />
      )}
    </AnalyticsCard>
  );
}
