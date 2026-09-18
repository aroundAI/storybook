'use client';

import { type ReactNode, useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  CalendarRange,
  Layers,
  PieChart,
  TrendingUp,
  Users,
} from 'lucide-react';

import { TRAFFIC_SOURCE_GROUPS } from '@kit/clickhouse';
import type { TrafficGroupBucket } from '@kit/clickhouse';

import { isUnavailable } from '../../lib/query-state';
import { listChannelsAction } from '../../server/channels-actions';
import {
  getBackCatalogAction,
  getCohortCurvesAction,
  getMedianPerformanceAction,
  getTrafficBreakdownAction,
  getYppProgressAction,
} from '../../server/deep-dive-actions';
import { getSubscriberSeriesAction } from '../../server/subscriber-series-actions';
import { AnalyticsCard } from '../overview/analytics-card';
import { BackCatalogCard, BackCatalogCardSkeleton } from './back-catalog-card';
import { ChannelFilter } from './channel-filter';
import {
  CohortCurvesChart,
  CohortCurvesChartSkeleton,
} from './cohort-curves-chart';
import type { CohortEntry } from './cohort-curves-chart';
import { MedianViewsCard, MedianViewsCardSkeleton } from './median-views-card';
import {
  SubscriberSeriesCard,
  SubscriberSeriesCardSkeleton,
} from './subscriber-series-card';
import {
  TrafficBreakdownCard,
  TrafficShareCard,
  TrafficShareCardSkeleton,
} from './traffic-share-card';
import { YppProgressCard, YppProgressCardSkeleton } from './ypp-progress-card';

interface DeepDiveTabProps {
  /** Project the deep-dive analysis is scoped to */
  projectId: string;
  /**
   * The project's account. `getYppProgressAction` is per account, so the tab
   * narrows its answer to the project's channels itself.
   */
  accountId: string;
}

/**
 * View filters narrowing the project scope. One object, so adding a filter
 * is a field here rather than another `useState`. Only channel has a
 * control today; `ScopeSchema` also accepts platform, content type and
 * language, which are added here when they get one.
 */
interface DeepDiveFilters {
  connectionId?: string;
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

/** Days of subscriber history the curve shows — a year, like YPP's window. */
const SUBSCRIBER_WINDOW_DAYS = 365;

export function DeepDiveTab({ projectId, accountId }: DeepDiveTabProps) {
  const [medianMode, setMedianMode] = useState<MedianMode>(
    'cohort_views_to_date',
  );

  const [filters, setFilters] = useState<DeepDiveFilters>({});

  // "All channels" leaves `connectionId` out of the scope entirely rather
  // than sending a sentinel, so the actions see exactly today's scope.
  const scope = useMemo(
    () =>
      filters.connectionId
        ? { projectId, connectionId: filters.connectionId }
        : { projectId },
    [projectId, filters.connectionId],
  );

  const channelsQuery = useQuery({
    queryKey: ['deep-dive-channels', projectId],
    queryFn: () => listChannelsAction({ projectId }),
  });

  const selectedChannel = channelsQuery.data?.find(
    (channel) => channel.connectionId === filters.connectionId,
  );

  // `getYppProgressAction` throws for a connection that is not an active
  // YouTube channel, and the gate is YouTube's, so any other selection skips
  // the query and says why.
  const yppApplies =
    !filters.connectionId ||
    (selectedChannel?.platform === 'youtube' && selectedChannel.isActive);

  // Every key carries the selected channel: a key without it would keep
  // serving the all-channel cache entry after the filter changed.
  const medianQuery = useQuery({
    queryKey: ['deep-dive-median', projectId, filters.connectionId, medianMode],
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
    // (toStartOfWeek is Sunday), so every bucket is a complete *calendar*
    // week. That is not the same as a fully *ingested* one: the bulk report
    // ingest lags 1-3 days, so the newest closed week can still be holding
    // only its first few days. Snapping the leading edge alone was worse —
    // the newest bucket was always partial — but the trend card still
    // headlines this bucket against the threshold, so its footnote says the
    // bucket may be partially ingested rather than implying otherwise.
    const currentWeekStart = new Date(`${today}T00:00:00.000Z`);

    currentWeekStart.setUTCDate(
      currentWeekStart.getUTCDate() - currentWeekStart.getUTCDay(),
    );

    // Inclusive upper bound, so the last complete week's Saturday.
    const to = new Date(currentWeekStart);

    to.setUTCDate(to.getUTCDate() - 1);

    const from = new Date(currentWeekStart);

    from.setUTCDate(from.getUTCDate() - TRAFFIC_WINDOW_WEEKS * 7);

    return {
      from,
      to,
      // Keyed on the window itself, not on `today`: the bounds only move
      // once a week, and keying on the date would abandon a byte-identical
      // cache entry every UTC midnight — skeletons and a fresh
      // `video_traffic_sources FINAL` scan six days out of seven.
      key: `${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}`,
    };
  }, [today]);

  const trafficBreakdownQuery = useQuery({
    // The window is part of the cache identity; without it two different
    // windows share an entry.
    queryKey: [
      'deep-dive-traffic-breakdown',
      projectId,
      filters.connectionId,
      trafficWindow.key,
    ],
    queryFn: () =>
      getTrafficBreakdownAction({
        scope,
        bucket: 'week',
        from: trafficWindow.from,
        to: trafficWindow.to,
      }),
  });

  // Gaps filled, so the x-axis is time rather than "buckets that exist".
  // ClickHouse groups by (bucket, source), so a week with no traffic rows
  // produces no bucket at all — a channel dark for 20 of 52 weeks would
  // otherwise draw 32 adjacent bars that read as 32 consecutive weeks,
  // directly under a label promising the last 52 complete weeks. Only the
  // per-bar tooltip carried the real date, and the trend shape is what the
  // card exists to show.
  const trafficBuckets = useMemo(() => {
    const byBucket = new Map(
      (trafficBreakdownQuery.data ?? []).map((bucket) => [
        bucket.bucket,
        bucket,
      ]),
    );

    const filled: TrafficGroupBucket[] = [];
    const consumed = new Set<string>();
    const cursor = new Date(trafficWindow.from);

    for (let week = 0; week < TRAFFIC_WINDOW_WEEKS; week++) {
      const key = cursor.toISOString().slice(0, 10);

      filled.push(
        byBucket.get(key) ?? {
          bucket: key,
          totalViews: 0,
          totalWatchTimeMinutes: 0,
          groups: TRAFFIC_SOURCE_GROUPS.map((group) => ({
            group,
            views: 0,
            watchTimeMinutes: 0,
            share: 0,
          })),
        },
      );

      cursor.setUTCDate(cursor.getUTCDate() + 7);
      consumed.add(key);
    }

    // Anything the server returned that no generated key matched is kept
    // rather than dropped. The fill hardcodes weekly Sunday keys, so
    // changing this card's `bucket` to 'month' — a one-line edit that
    // compiles and typechecks — would otherwise render 52 empty weeks and
    // "No views" while the action returned a full response. Degrading to
    // "shows the real data, unfilled" beats a silently blank chart.
    for (const bucket of byBucket.values()) {
      if (!consumed.has(bucket.bucket)) {
        filled.push(bucket);
      }
    }

    return filled.sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
  }, [trafficBreakdownQuery.data, trafficWindow.from]);

  // Derived, not fetched. Both cards want the same scope at the same
  // granularity, so a second action call would compile to byte-identical
  // SQL — two `video_traffic_sources FINAL` scans and two dim scans per tab
  // load — for numbers this response already contains. The fold is exactly
  // the same fold the query layer used to do before it became dead code.
  const trafficShareBuckets = useMemo(
    () =>
      trafficBuckets.map((bucket) => {
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
    [trafficBuckets],
  );

  const backCatalogQuery = useQuery({
    queryKey: ['deep-dive-back-catalog', projectId, filters.connectionId],
    queryFn: () => getBackCatalogAction({ scope, ageDays: 90 }),
  });

  const cohortQuery = useQuery({
    queryKey: ['deep-dive-cohorts', projectId, filters.connectionId],
    queryFn: () =>
      getCohortCurvesAction({
        scope,
        checkpoints: [30, 90, 180, 365],
        bucket: 'quarter',
      }),
  });

  const subscriberWindowFrom = useMemo(() => {
    const from = new Date(`${today}T00:00:00.000Z`);

    from.setUTCDate(from.getUTCDate() - SUBSCRIBER_WINDOW_DAYS);

    return from.toISOString().slice(0, 10);
  }, [today]);

  const subscriberSeriesQuery = useQuery({
    queryKey: [
      'deep-dive-subscriber-series',
      projectId,
      filters.connectionId,
      today,
    ],
    queryFn: () =>
      getSubscriberSeriesAction({
        scope,
        from: subscriberWindowFrom,
        to: today,
      }),
  });

  // The card names its lines and groups its totals by the channel list, so
  // it waits for that list too: without it every line is "Channel" and every
  // total is empty, with nothing saying why.
  const subscriberCardQuery = {
    isLoading: subscriberSeriesQuery.isLoading || channelsQuery.isLoading,
    isError:
      isUnavailable(subscriberSeriesQuery) || isUnavailable(channelsQuery),
    data: isUnavailable(channelsQuery) ? undefined : subscriberSeriesQuery.data,
  };

  const yppQuery = useQuery({
    queryKey: ['deep-dive-ypp', accountId, filters.connectionId],
    // Spread, not `connectionId: filters.connectionId`: an undefined property
    // is still serialized into the action call as `$undefined`, and "All
    // channels" must send no `connectionId` at all.
    queryFn: () =>
      getYppProgressAction({
        accountId,
        windowDays: 365,
        ...(filters.connectionId ? { connectionId: filters.connectionId } : {}),
      }),
    enabled: yppApplies,
  });

  // The action answers for every active YouTube channel on the account; every
  // other card here is scoped to the project, and the filter lists only the
  // project's channels. So the cards are narrowed to those channels — a card
  // for a channel this project never publishes to could not be selected and
  // would not belong on this tab.
  //
  // The intersection only means anything when the channel list loaded: a
  // failed read leaves it empty, which would empty the section and report it
  // as "no channels publish here". That is why its error is passed on below.
  const projectYppProgress = useMemo(() => {
    const projectChannelIds = new Set(
      (channelsQuery.data ?? []).map((channel) => channel.connectionId),
    );

    return (yppQuery.data ?? []).filter((channel) =>
      projectChannelIds.has(channel.connectionId),
    );
  }, [yppQuery.data, channelsQuery.data]);

  return (
    <div className={'flex flex-col gap-4'} data-test={'deep-dive-tab'}>
      <div className={'flex items-center justify-end'}>
        <ChannelFilter
          channels={channelsQuery.data ?? []}
          value={filters.connectionId}
          onChange={(connectionId) =>
            setFilters((current) => ({ ...current, connectionId }))
          }
          isLoading={channelsQuery.isLoading}
          isError={isUnavailable(channelsQuery)}
        />
      </div>

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
          <QueryState
            query={medianQuery}
            skeleton={<MedianViewsCardSkeleton />}
            message={'Median views could not be loaded.'}
            dataTest={'median-error'}
          >
            <MedianViewsCard
              buckets={medianQuery.data ?? []}
              mode={medianMode}
            />
          </QueryState>
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
              isError={isUnavailable(trafficBreakdownQuery)}
              windowLabel={TRAFFIC_WINDOW_LABEL}
            />
          )}
        </AnalyticsCard>

        <AnalyticsCard
          title={'Where views came from'}
          icon={PieChart}
          description={
            'Search, Shorts, external, playlists, the channel page and direct — plus an Other residual — as a share of views.'
          }
          className={'h-auto'}
        >
          {trafficBreakdownQuery.isLoading ? (
            <TrafficShareCardSkeleton />
          ) : (
            <TrafficBreakdownCard
              buckets={trafficBuckets}
              isError={isUnavailable(trafficBreakdownQuery)}
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
          <QueryState
            query={backCatalogQuery}
            skeleton={<BackCatalogCardSkeleton />}
            message={'Back catalog contribution could not be loaded.'}
            dataTest={'back-catalog-error'}
          >
            <BackCatalogCard buckets={backCatalogQuery.data ?? []} />
          </QueryState>
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
          <QueryState
            query={cohortQuery}
            skeleton={<CohortCurvesChartSkeleton />}
            message={'Upload cohorts could not be loaded.'}
            dataTest={'cohort-error'}
          >
            <CohortCurvesChart
              cohorts={(cohortQuery.data ?? []) as CohortEntry[]}
              bucket={'quarter'}
            />
          </QueryState>
        </AnalyticsCard>

        <AnalyticsCard
          title={'Subscribers'}
          icon={Users}
          description={
            'Each channel’s subscriber count over the last year, rebuilt from dated snapshots and daily movement. Per channel by default: channels connected at different times cannot be added up before every one of them has a count.'
          }
          colSpan={2}
          className={'h-auto'}
        >
          <QueryState
            query={subscriberCardQuery}
            skeleton={<SubscriberSeriesCardSkeleton />}
            message={'Subscriber history could not be loaded.'}
            dataTest={'subscriber-series-error'}
          >
            <SubscriberSeriesCard
              series={subscriberSeriesQuery.data ?? []}
              channels={channelsQuery.data ?? []}
            />
          </QueryState>
        </AnalyticsCard>

        <AnalyticsCard
          title={'YouTube Partner Programme'}
          icon={BadgeCheck}
          description={
            'Progress toward the monetization gate, one card per channel — the gate is per channel, so a pooled total would report it met when no channel has met it.'
          }
          colSpan={2}
          className={'h-auto'}
        >
          <YppProgressSection
            applies={yppApplies}
            isLoading={yppQuery.isLoading || channelsQuery.isLoading}
            isError={isUnavailable(yppQuery) || isUnavailable(channelsQuery)}
            progress={projectYppProgress}
          />
        </AnalyticsCard>
      </div>
    </div>
  );
}

/**
 * Loading, unavailable, or the card.
 *
 * `data ?? []` rendered a failed read as a measured zero: a back catalog
 * contributing nothing looks exactly like one that could not be read. But
 * `isError` alone is the opposite mistake — query-core keeps `data` when a
 * refetch fails, so a rendered chart would be thrown away over a transient
 * failure. `isUnavailable` is the question both need answered.
 */
function QueryState({
  query,
  skeleton,
  message,
  dataTest,
  children,
}: {
  query: { isLoading: boolean; isError: boolean; data: unknown };
  skeleton: ReactNode;
  message: string;
  dataTest: string;
  children: ReactNode;
}) {
  if (query.isLoading) return skeleton;

  if (isUnavailable(query)) {
    return (
      <p className={'text-destructive text-sm'} data-test={dataTest}>
        {message}
      </p>
    );
  }

  return children;
}

function YppProgressSection({
  applies,
  isLoading,
  isError,
  progress,
}: {
  applies: boolean;
  isLoading: boolean;
  isError: boolean;
  progress: Awaited<ReturnType<typeof getYppProgressAction>>;
}) {
  if (!applies) {
    return (
      <p
        className={'text-muted-foreground text-sm'}
        data-test={'ypp-not-applicable'}
      >
        Partner Programme progress applies to active YouTube channels.
      </p>
    );
  }

  if (isLoading) {
    return <YppProgressCardSkeleton />;
  }

  if (isError) {
    return (
      <p className={'text-destructive text-sm'} data-test={'ypp-error'}>
        Partner Programme progress could not be loaded.
      </p>
    );
  }

  if (progress.length === 0) {
    return (
      <p
        className={'text-muted-foreground text-sm'}
        data-test={'ypp-no-channels'}
      >
        No active YouTube channel publishes in this project.
      </p>
    );
  }

  // One card per channel, never a sum: pooling watch hours against one
  // target reports the gate met when no single channel has met it.
  return (
    <div
      className={'grid gap-6 md:grid-cols-2'}
      data-test={'ypp-progress-list'}
    >
      {progress.map((channel) => (
        <div
          key={channel.connectionId}
          className={'flex flex-col gap-2'}
          data-test={'ypp-progress-card'}
        >
          <span className={'text-sm font-medium'}>{channel.channelName}</span>
          <YppProgressCard progress={channel} />
        </div>
      ))}
    </div>
  );
}
