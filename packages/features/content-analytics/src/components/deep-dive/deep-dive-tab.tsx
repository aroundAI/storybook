'use client';

import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Layers, PieChart, TrendingUp } from 'lucide-react';

import {
  getBackCatalogAction,
  getCohortCurvesAction,
  getMedianPerformanceAction,
  getTrafficBreakdownAction,
  getTrafficShareTrendAction,
} from '../../server/deep-dive-actions';
import { AnalyticsCard } from '../overview/analytics-card';
import { BackCatalogCard, BackCatalogCardSkeleton } from './back-catalog-card';
import {
  CohortCurvesChart,
  CohortCurvesChartSkeleton,
} from './cohort-curves-chart';
import type { CohortEntry } from './cohort-curves-chart';
import { MedianViewsCard, MedianViewsCardSkeleton } from './median-views-card';
import {
  TrafficBreakdownCard,
  TrafficShareCard,
  TrafficShareCardSkeleton,
} from './traffic-share-card';

interface DeepDiveTabProps {
  /** Project the deep-dive analysis is scoped to */
  projectId: string;
}

type MedianMode = 'cohort_views_to_date' | 'views_in_period';

/**
 * The monthly and quarterly analysis surface: medians rather than means,
 * traffic-source share, back-catalog contribution, and age-controlled
 * cohort curves. These are the numbers decisions get made on, as opposed
 * to the weekly diagnostics that only catch breakage.
 */
export function DeepDiveTab({ projectId }: DeepDiveTabProps) {
  const [medianMode, setMedianMode] = useState<MedianMode>(
    'cohort_views_to_date',
  );

  const scope = { projectId };

  const medianQuery = useQuery({
    queryKey: ['deep-dive-median', projectId, medianMode],
    queryFn: () =>
      getMedianPerformanceAction({
        scope,
        bucket: 'month',
        mode: medianMode,
      }),
  });

  const trafficQuery = useQuery({
    queryKey: ['deep-dive-traffic', projectId],
    queryFn: () => getTrafficShareTrendAction({ scope, bucket: 'week' }),
  });

  const trafficBreakdownQuery = useQuery({
    queryKey: ['deep-dive-traffic-breakdown', projectId],
    queryFn: () => getTrafficBreakdownAction({ scope, bucket: 'week' }),
  });

  const backCatalogQuery = useQuery({
    queryKey: ['deep-dive-back-catalog', projectId],
    queryFn: () => getBackCatalogAction({ scope, ageDays: 90 }),
  });

  const cohortQuery = useQuery({
    queryKey: ['deep-dive-cohorts', projectId],
    queryFn: () =>
      getCohortCurvesAction({
        scope,
        checkpoints: [30, 90, 180, 365],
        bucket: 'quarter',
      }),
  });

  return (
    <div className={'grid gap-4 md:grid-cols-2'}>
      <AnalyticsCard
        title={'Median views per video'}
        icon={TrendingUp}
        description={
          'The median resists outliers; one viral video can make a flat channel look like it is growing.'
        }
        colSpan={2}
        className={'h-auto'}
        footer={
          <div className={'flex gap-2 text-xs'}>
            <button
              type={'button'}
              onClick={() => setMedianMode('cohort_views_to_date')}
              className={
                medianMode === 'cohort_views_to_date'
                  ? 'font-medium underline'
                  : 'text-muted-foreground'
              }
            >
              By upload month
            </button>
            <button
              type={'button'}
              onClick={() => setMedianMode('views_in_period')}
              className={
                medianMode === 'views_in_period'
                  ? 'font-medium underline'
                  : 'text-muted-foreground'
              }
            >
              Views in period
            </button>
          </div>
        }
      >
        {medianQuery.isLoading ? (
          <MedianViewsCardSkeleton />
        ) : (
          <MedianViewsCard buckets={medianQuery.data ?? []} mode={medianMode} />
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title={'Browse + Suggested share'}
        icon={TrendingUp}
        description={
          'Whether the algorithm has decided what this channel is for.'
        }
        className={'h-auto'}
      >
        {trafficQuery.isLoading ? (
          <TrafficShareCardSkeleton />
        ) : (
          <TrafficShareCard buckets={trafficQuery.data ?? []} />
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title={'Where views came from'}
        icon={PieChart}
        description={
          'Every traffic surface as a share of views — the six beyond Browse + Suggested.'
        }
        className={'h-auto'}
      >
        {trafficBreakdownQuery.isLoading ? (
          <TrafficShareCardSkeleton />
        ) : (
          <TrafficBreakdownCard
            buckets={trafficBreakdownQuery.data ?? []}
            isError={trafficBreakdownQuery.isError}
          />
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title={'Back catalog contribution'}
        icon={Layers}
        description={
          'Share of views from videos over 90 days old — the compounding signal.'
        }
        className={'h-auto'}
      >
        {backCatalogQuery.isLoading ? (
          <BackCatalogCardSkeleton />
        ) : (
          <BackCatalogCard buckets={backCatalogQuery.data ?? []} />
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title={'Upload cohorts'}
        icon={CalendarRange}
        description={
          'Cumulative views per video at matched ages, so growth is measured independently of how long each video has been live.'
        }
        colSpan={2}
        className={'h-auto'}
      >
        {cohortQuery.isLoading ? (
          <CohortCurvesChartSkeleton />
        ) : (
          <CohortCurvesChart
            cohorts={(cohortQuery.data ?? []) as CohortEntry[]}
            bucket={'quarter'}
          />
        )}
      </AnalyticsCard>
    </div>
  );
}
