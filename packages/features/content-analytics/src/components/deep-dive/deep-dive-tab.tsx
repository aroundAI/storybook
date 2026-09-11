'use client';

import { useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Layers, PieChart, TrendingUp } from 'lucide-react';

import {
  getBackCatalogAction,
  getCohortCurvesAction,
  getMedianPerformanceAction,
  getTrafficBreakdownAction,
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
/**
 * Window the traffic cards ask for.
 *
 * The breakdown returns a row per (bucket, source) where the old share
 * trend returned one per bucket, so an all-history call is roughly twenty
 * times the payload for the same picture. A year of weeks is enough to
 * read the trend and bounds the response at ~52 buckets.
 */
const TRAFFIC_WINDOW_WEEKS = 52;

/**
 * Human-readable form of the window, for the cards' empty state. Derived,
 * not restated: this string is the only thing telling a reader why older
 * data is missing, so it must not be able to name a window the query has
 * stopped asking for.
 */
const TRAFFIC_WINDOW_LABEL = `the last ${TRAFFIC_WINDOW_WEEKS} complete weeks`;

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

  // Read on every render rather than frozen at mount, so the window follows
  // the UTC day as soon as anything re-renders. Nothing *schedules* a
  // re-render at midnight, so a completely idle tab keeps yesterday's window
  // until the next refetch or interaction — better than the previous
  // mount-time freeze, and not the same as a ticking clock.
  const today = new Date().toISOString().slice(0, 10);

  const trafficWindow = useMemo(() => {
    // Both ends land on the week boundary ClickHouse buckets on
    // (toStartOfWeek is Sunday), so every bucket returned is a complete
    // week. Snapping only the leading edge still left the newest bucket
    // partial — and that is the one TrafficShareCard headlines against the
    // 60% threshold, so a Monday ingest could read "above 60%" off a single
    // day.
    const currentWeekStart = new Date(`${today}T00:00:00.000Z`);

    currentWeekStart.setUTCDate(
      currentWeekStart.getUTCDate() - currentWeekStart.getUTCDay(),
    );

    // Inclusive upper bound, so the last complete week's Saturday.
    const to = new Date(currentWeekStart);

    to.setUTCDate(to.getUTCDate() - 1);

    const from = new Date(currentWeekStart);

    from.setUTCDate(from.getUTCDate() - TRAFFIC_WINDOW_WEEKS * 7);

    return { from, to, key: `${from.toISOString().slice(0, 10)}..${today}` };
  }, [today]);

  const trafficBreakdownQuery = useQuery({
    // The window is part of the cache identity; without it two different
    // windows share an entry.
    queryKey: ['deep-dive-traffic-breakdown', projectId, trafficWindow.key],
    queryFn: () =>
      getTrafficBreakdownAction({
        scope,
        bucket: 'week',
        from: trafficWindow.from,
        to: trafficWindow.to,
      }),
  });

  // Derived, not fetched. Both cards want the same scope at the same
  // granularity, so a second action call would compile to byte-identical
  // SQL — two `video_traffic_sources FINAL` scans and two dim scans per tab
  // load — for numbers this response already contains. The fold is exactly
  // the same fold the query layer used to do before it became dead code.
  const trafficShareBuckets = useMemo(
    () =>
      (trafficBreakdownQuery.data ?? []).map((bucket) => {
        const browseSuggestedViews =
          bucket.groups.find((group) => group.group === 'browse_suggested')
            ?.views ?? 0;

        return {
          bucket: bucket.bucket,
          totalViews: bucket.totalViews,
          browseSuggestedViews,
          share:
            bucket.totalViews > 0
              ? browseSuggestedViews / bucket.totalViews
              : 0,
        };
      }),
    [trafficBreakdownQuery.data],
  );

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
        {trafficBreakdownQuery.isLoading ? (
          <TrafficShareCardSkeleton />
        ) : (
          <TrafficShareCard
            buckets={trafficShareBuckets}
            bucketNoun={'week'}
            isError={
              trafficBreakdownQuery.isError &&
              trafficBreakdownQuery.data === undefined
            }
            windowLabel={TRAFFIC_WINDOW_LABEL}
          />
        )}
      </AnalyticsCard>

      <AnalyticsCard
        title={'Where views came from'}
        icon={PieChart}
        description={
          'Every traffic surface as a share of views — the seven beyond Browse + Suggested.'
        }
        className={'h-auto'}
      >
        {trafficBreakdownQuery.isLoading ? (
          <TrafficShareCardSkeleton />
        ) : (
          <TrafficBreakdownCard
            buckets={trafficBreakdownQuery.data ?? []}
            isError={
              trafficBreakdownQuery.isError &&
              trafficBreakdownQuery.data === undefined
            }
            windowLabel={TRAFFIC_WINDOW_LABEL}
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
