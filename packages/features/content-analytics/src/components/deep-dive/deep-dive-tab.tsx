'use client';

import { type ReactNode, useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BadgeCheck,
  CalendarRange,
  Layers,
  PieChart,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';

import {
  ANALYTICS_PLATFORMS,
  TRAFFIC_SOURCE_GROUPS,
  platformsWithData,
} from '@kit/clickhouse';
import type { AnalyticsPlatform, TrafficGroupBucket } from '@kit/clickhouse';
import { Button } from '@kit/ui/button';

import { unwrap } from '../../lib/action-result';
import { platformLabel } from '../../lib/platform-labels';
import { TAB_FAMILIES } from '../../lib/provenance';
import { isUnavailable } from '../../lib/query-state';
import { dateAxisScope, isFetchDated } from '../../lib/row-dating';
import {
  type ViewDefinitionMark,
  marksForBuckets,
} from '../../lib/view-definition-marks';
import {
  getBackCatalogAction,
  getCohortCurvesAction,
  getMedianPerformanceAction,
  getReturningViewerProxyAction,
  getRollingViewsAction,
  getTrafficBreakdownAction,
  getYppProgressAction,
} from '../../server/deep-dive-actions';
import {
  getRetentionCurveAction,
  getWeeklyDiagnosticsAction,
} from '../../server/diagnostics-actions';
import { getSubscriberSeriesAction } from '../../server/subscriber-series-actions';
import { CoverageProvider } from '../coverage-context';
import { CoverageStrip } from '../coverage-strip';
import { AnalyticsCard } from '../overview/analytics-card';
import {
  type CardClaim,
  claimFromQuery,
  sourceNotesFor,
} from '../overview/card-claim';
import { useProjectChannels } from '../use-project-channels';
import {
  BackCatalogCard,
  BackCatalogCardSkeleton,
  backCatalogClaim,
} from './back-catalog-card';
import { ChannelFilter } from './channel-filter';
import { DateAxisNote } from './date-axis-note';
import {
  CohortCurvesChart,
  CohortCurvesChartSkeleton,
} from './cohort-curves-chart';
import type { CohortEntry } from './cohort-curves-chart';
import {
  MedianViewsCard,
  MedianViewsCardSkeleton,
  medianViewsClaim,
  medianViewsDetails,
} from './median-views-card';
import {
  RetentionCurveChart,
  RetentionCurveChartSkeleton,
} from './retention-curve-chart';
import {
  ReturningViewerProxyCard,
  ReturningViewerProxyCardSkeleton,
  returningViewerClaim,
} from './returning-viewer-proxy-card';
import {
  ROLLING_WINDOW_DAYS,
  Rolling90Card,
  Rolling90CardSkeleton,
  rolling90Claim,
} from './rolling-90-card';
import {
  SubscriberSeriesCard,
  SubscriberSeriesCardSkeleton,
} from './subscriber-series-card';
import {
  TrafficBreakdownCard,
  TrafficShareCard,
  TrafficShareCardSkeleton,
  trafficBreakdownClaim,
  trafficBreakdownDetails,
  trafficShareClaim,
  trafficShareDetails,
} from './traffic-share-card';
import {
  WeeklyDiagnosticsTable,
  WeeklyDiagnosticsTableSkeleton,
} from './weekly-diagnostics-table';
import { PlatformSwitcher } from './platform-switcher';
import { YppProgressCard, YppProgressCardSkeleton } from './ypp-progress-card';

interface DeepDiveTabProps {
  /** Project the deep-dive analysis is scoped to */
  projectId: string;
  /**
   * The channel filter. It lives in the dashboard so this tab and the Video
   * Log show the same channel: two pickers with their own state on one page
   * is how the tabs start disagreeing about what is selected.
   */
  connectionId: string | undefined;
  onConnectionChange: (connectionId: string | undefined) => void;
  /**
   * The project's account. `getYppProgressAction` is per account, so the tab
   * narrows its answer to the project's channels itself.
   */
  accountId: string;
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

/** What both traffic cards say when no response arrived. */
const TRAFFIC_FAILURE =
  'Traffic-source data could not be loaded — a fetch failure, not an absence of data.';

/**
 * The Partner Programme is one platform's, and the card covers only it. The
 * name comes from the label map, like every platform name on this page.
 */
const YPP_PLATFORM = 'youtube' satisfies AnalyticsPlatform;
const YPP_PLATFORM_NAME = platformLabel(YPP_PLATFORM);

/** Days of subscriber history the curve shows — a year, like YPP's window. */
const SUBSCRIBER_WINDOW_DAYS = 365;

/**
 * The diagnostics window. "This week's uploads" is the framing, and a
 * window that drifted from the heading would quietly change what the table
 * claims.
 */
const DIAGNOSTICS_WINDOW_DAYS = 7;

/**
 * Videos the table shows. Well under MAX_DIAGNOSTIC_VIDEOS: this is a list
 * a person reads, so the useful bound is a screenful rather than the
 * ceiling the query would tolerate.
 */
const DIAGNOSTICS_LIMIT = 25;

export function DeepDiveTab({
  projectId,
  accountId,
  connectionId,
  onConnectionChange,
}: DeepDiveTabProps) {
  const [medianMode, setMedianMode] = useState<MedianMode>(
    'cohort_views_to_date',
  );
  // FILM-1707 §2: the platform is explicit in the scope and changeable.
  // Every platform by default, under the date-axis rule.
  const [platform, setPlatform] = useState<AnalyticsPlatform | undefined>();

  /**
   * The filters this tab narrows its scope by. Channel comes from the
   * dashboard, platform from this tab's switcher; `ScopeSchema` also accepts
   * content type and language, which join this object when they get a
   * control.
   */
  const filters = { connectionId, platform };

  // "All" leaves a key out of the scope entirely rather than sending a
  // sentinel, so the actions see exactly the scope the reader chose.
  const scope = useMemo(
    () => ({
      projectId,
      ...(filters.connectionId ? { connectionId: filters.connectionId } : {}),
      ...(filters.platform ? { platform: filters.platform } : {}),
    }),
    [projectId, filters.connectionId, filters.platform],
  );

  const channelsQuery = useProjectChannels(projectId);

  // The channel list follows the platform: a channel on another platform
  // could only ever answer "nothing".
  const channels = (channelsQuery.data ?? []).filter(
    (channel) => !filters.platform || channel.platform === filters.platform,
  );

  const onPlatformChange = (next: AnalyticsPlatform | undefined) => {
    const current = channelsQuery.data?.find(
      (channel) => channel.connectionId === filters.connectionId,
    );

    if (next && current && current.platform !== next) {
      onConnectionChange(undefined);
    }

    setPlatform(next);
  };

  // A single fetch-dated platform has nothing true to put on a date axis:
  // those cards say why instead of asking (FILM-1707 §2).
  const nothingDated =
    filters.platform !== undefined && isFetchDated(filters.platform);

  // What the date-axis cards plot, and the fetch-dated platforms this
  // project publishes to, for the one-time note.
  const selection = filters.platform ? [filters.platform] : ANALYTICS_PLATFORMS;
  const plotted = dateAxisScope(selection, []).platforms;
  const excluded = dateAxisScope(
    ANALYTICS_PLATFORMS,
    (channelsQuery.data ?? []).map((channel) => channel.platform),
  ).excluded;

  const selectedChannel = channelsQuery.data?.find(
    (channel) => channel.connectionId === filters.connectionId,
  );

  // `getYppProgressAction` throws for a connection that is not an active
  // YouTube channel, and the gate is YouTube's, so any other selection skips
  // the query and says why.
  const yppApplies =
    (!filters.platform || filters.platform === YPP_PLATFORM) &&
    (!filters.connectionId ||
      (selectedChannel?.platform === 'youtube' && selectedChannel.isActive));

  // Every key carries the selected channel: a key without it would keep
  // serving the all-channel cache entry after the filter changed.
  const medianQuery = useQuery({
    queryKey: [
      'deep-dive-median',
      projectId,
      filters.connectionId,
      filters.platform,
      medianMode,
    ],
    queryFn: () =>
      getMedianPerformanceAction({
        scope,
        bucket: 'month',
        mode: medianMode,
      }),
    enabled: !nothingDated,
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
      filters.platform,
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
            sources: [],
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

  // Failure only when no response ever arrived: React Query keeps `data`
  // through a failed background refetch, and the cards keep serving it.
  const trafficQueryState = {
    isLoading: trafficBreakdownQuery.isLoading,
    isError: isUnavailable(trafficBreakdownQuery),
    data: trafficBreakdownQuery.data,
  };

  const backCatalogQuery = useQuery({
    queryKey: [
      'deep-dive-back-catalog',
      projectId,
      filters.connectionId,
      filters.platform,
    ],
    queryFn: () => getBackCatalogAction({ scope, ageDays: 90 }),
    enabled: !nothingDated,
  });

  const rollingQuery = useQuery({
    queryKey: [
      'deep-dive-rolling',
      projectId,
      filters.connectionId,
      filters.platform,
    ],
    queryFn: () =>
      getRollingViewsAction({ scope, windowDays: ROLLING_WINDOW_DAYS }),
    enabled: !nothingDated,
  });

  const returningViewerQuery = useQuery({
    queryKey: [
      'deep-dive-returning-viewer',
      projectId,
      filters.connectionId,
      filters.platform,
    ],
    queryFn: () => getReturningViewerProxyAction({ scope }),
  });

  const cohortQuery = useQuery({
    queryKey: [
      'deep-dive-cohorts',
      projectId,
      filters.connectionId,
      filters.platform,
    ],
    queryFn: () =>
      getCohortCurvesAction({
        scope,
        checkpoints: [30, 90, 180, 365],
        bucket: 'quarter',
      }),
    enabled: !nothingDated,
  });

  // Where a chart crosses a change in what counts as a view (FILM-1722):
  // marked, for the platforms each chart actually plots.
  const medianMarks = marksForBuckets(
    plotted,
    (medianQuery.data ?? []).map(({ bucket }) => bucket),
    'month',
  );
  const backCatalogMarks = marksForBuckets(
    plotted,
    (backCatalogQuery.data ?? []).map(({ bucket }) => bucket),
    'month',
  );
  const rollingMarks = marksForBuckets(
    plotted,
    (rollingQuery.data ?? []).map(({ date }) => date),
    'day',
  );
  const trafficMarks: ViewDefinitionMark[] = marksForBuckets(
    platformsWithData('traffic_sources').filter((platform) =>
      selection.includes(platform),
    ),
    trafficBuckets.map(({ bucket }) => bucket),
    'week',
  );

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
      filters.platform,
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

  // Per channel, so there is no one figure: a pooled total would report the
  // gate met when no channel has met it.
  const yppClaim: CardClaim | 'loading' = !yppApplies
    ? {
        figure: null,
        noFigure: 'Does not apply to this channel.',
        sentence: `The Partner Programme gate is ${YPP_PLATFORM_NAME}’s, so it applies only to an active ${YPP_PLATFORM_NAME} channel.`,
      }
    : claimFromQuery(
        {
          isLoading: yppQuery.isLoading || channelsQuery.isLoading,
          isError: isUnavailable(yppQuery) || isUnavailable(channelsQuery),
          data:
            isUnavailable(yppQuery) || isUnavailable(channelsQuery)
              ? undefined
              : projectYppProgress,
        },
        () => ({
          figure: null,
          noFigure: 'Progress is per channel.',
          sentence: `Progress toward the ${YPP_PLATFORM_NAME} Partner Programme gate, one card per channel.`,
        }),
      );

  const tab = (
    <div className={'flex flex-col gap-4'} data-test={'deep-dive-tab'}>
      {/* This tab's strip, inside this tab's provider: it describes the 52
          weeks these cards read, not the header's range. */}
      <CoverageStrip
        families={TAB_FAMILIES['deep-dive']}
        data-test={'deep-dive-coverage-strip'}
      />

      <DateAxisNote excluded={excluded} />

      <div className={'flex flex-wrap items-center justify-end gap-2'}>
        <PlatformSwitcher value={filters.platform} onChange={onPlatformChange} />
        <ChannelFilter
          channels={channels}
          value={filters.connectionId}
          onChange={onConnectionChange}
          isLoading={channelsQuery.isLoading}
          isError={isUnavailable(channelsQuery)}
        />
      </div>

      <div className={'grid gap-4 md:grid-cols-2'}>
        <AnalyticsCard
          title={'Median views per video'}
          icon={TrendingUp}
          metricFamily={'engagement'}
          platforms={filters.platform ? [filters.platform] : undefined}
          onDateAxis
          marks={medianMarks}
          claim={dateAxisClaim(
            nothingDated,
            claimFromQuery(medianQuery, (buckets) =>
              medianViewsClaim(buckets, medianMode),
            ),
          )}
          details={medianViewsDetails(medianQuery.data ?? [], medianMode)}
          colSpan={2}
          data-test={'deep-dive-median'}
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
              marks={medianMarks}
            />
          </QueryState>
        </AnalyticsCard>

        <AnalyticsCard
          title={'Browse + Suggested share'}
          icon={TrendingUp}
          description={
            'Whether the algorithm has decided what this channel is for.'
          }
          metricFamily={'traffic_sources'}
          claim={claimFromQuery(
            trafficQueryState,
            () =>
              trafficShareClaim(trafficShareBuckets, {
                bucketNoun: 'week',
                windowLabel: TRAFFIC_WINDOW_LABEL,
              }),
            TRAFFIC_FAILURE,
          )}
          details={trafficShareDetails('week')}
          marks={trafficMarks}
          data-test={'deep-dive-traffic-share'}
        >
          {trafficBreakdownQuery.isLoading ? (
            <TrafficShareCardSkeleton />
          ) : (
            <TrafficShareCard
              buckets={trafficShareBuckets}
              isError={isUnavailable(trafficBreakdownQuery)}
            />
          )}
        </AnalyticsCard>

        <AnalyticsCard
          title={'Where views came from'}
          icon={PieChart}
          description={
            'Search, Shorts, external, playlists, the channel page and direct — plus an Other residual — as a share of views.'
          }
          metricFamily={'traffic_sources'}
          claim={claimFromQuery(
            trafficQueryState,
            () => trafficBreakdownClaim(trafficBuckets, TRAFFIC_WINDOW_LABEL),
            TRAFFIC_FAILURE,
          )}
          details={trafficBreakdownDetails(
            trafficBuckets,
            sourceNotesFor('traffic_sources'),
          )}
          marks={trafficMarks}
          data-test={'deep-dive-traffic-breakdown'}
        >
          {trafficBreakdownQuery.isLoading ? (
            <TrafficShareCardSkeleton />
          ) : (
            <TrafficBreakdownCard
              buckets={trafficBuckets}
              isError={isUnavailable(trafficBreakdownQuery)}
            />
          )}
        </AnalyticsCard>

        <AnalyticsCard
          title={'Back catalog contribution'}
          icon={Layers}
          description={
            'Share of views from videos over 90 days old — the compounding signal.'
          }
          metricFamily={'engagement'}
          platforms={filters.platform ? [filters.platform] : undefined}
          onDateAxis
          marks={backCatalogMarks}
          claim={dateAxisClaim(
            nothingDated,
            claimFromQuery(backCatalogQuery, backCatalogClaim),
          )}
          details={{
            method:
              'Views in each month from videos more than 90 days old, as a share of all views that month.',
          }}
          data-test={'deep-dive-back-catalog'}
        >
          <QueryState
            query={backCatalogQuery}
            skeleton={<BackCatalogCardSkeleton />}
            message={'Back catalog contribution could not be loaded.'}
            dataTest={'back-catalog-error'}
          >
            <BackCatalogCard
              buckets={backCatalogQuery.data ?? []}
              marks={backCatalogMarks}
            />
          </QueryState>
        </AnalyticsCard>

        <AnalyticsCard
          title={'Rolling 90-day views'}
          icon={Activity}
          description={
            'Views over the trailing 90 days, which monthly totals are too noisy to show.'
          }
          metricFamily={'engagement'}
          platforms={filters.platform ? [filters.platform] : undefined}
          onDateAxis
          marks={rollingMarks}
          claim={dateAxisClaim(
            nothingDated,
            claimFromQuery(rollingQuery, (points) =>
              rolling90Claim(points, ROLLING_WINDOW_DAYS),
            ),
          )}
          details={{
            method:
              'The sum of daily views over each day and the 89 before it, with days that have no rows counted as zero.',
          }}
          data-test={'deep-dive-rolling'}
        >
          <QueryState
            query={rollingQuery}
            skeleton={<Rolling90CardSkeleton />}
            message={'Rolling views could not be loaded.'}
            dataTest={'rolling-error'}
          >
            <Rolling90Card
              points={rollingQuery.data ?? []}
              windowDays={ROLLING_WINDOW_DAYS}
              marks={rollingMarks}
            />
          </QueryState>
        </AnalyticsCard>

        <AnalyticsCard
          title={'Subscribed share of views (proxy)'}
          icon={UserCheck}
          description={
            'A stand-in for returning viewers: how much of the audience is already subscribed.'
          }
          metricFamily={'follower_status'}
          claim={claimFromQuery(returningViewerQuery, returningViewerClaim)}
          details={{
            // Which platforms are in the share is the chip's, from the
            // matrix: this list used to name them by hand.
            caveats: [
              'A proxy, not a measurement: no platform reports new against returning viewers, and a subscriber can be watching a video for the first time.',
            ],
          }}
          data-test={'deep-dive-returning-viewer'}
        >
          <QueryState
            query={returningViewerQuery}
            skeleton={<ReturningViewerProxyCardSkeleton />}
            message={'The subscriber split could not be loaded.'}
            dataTest={'returning-viewer-error'}
          >
            {returningViewerQuery.data ? (
              <ReturningViewerProxyCard split={returningViewerQuery.data} />
            ) : null}
          </QueryState>
        </AnalyticsCard>

        <AnalyticsCard
          title={'Upload cohorts'}
          icon={CalendarRange}
          metricFamily={'engagement'}
          platforms={filters.platform ? [filters.platform] : undefined}
          onDateAxis
          claim={dateAxisClaim(
            nothingDated,
            claimFromQuery(
              cohortQuery,
              (): CardClaim => ({
                figure: null,
                noFigure: 'A comparison of curves has no single number.',
                sentence:
                  'Views per video at matched ages, one line per upload quarter.',
              }),
            ),
          )}
          details={{
            method:
              'Cumulative views per video at matched ages, so growth is measured independently of how long each video has been live.',
          }}
          colSpan={2}
          data-test={'deep-dive-cohorts'}
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
          metricFamily={'channel_totals'}
          claim={claimFromQuery(
            subscriberCardQuery,
            (): CardClaim => ({
              figure: null,
              noFigure: 'Shown per channel below.',
              sentence:
                'Each channel’s subscriber count over the last year, rebuilt from dated snapshots and daily movement.',
            }),
          )}
          details={{
            caveats: [
              'Per channel by default: channels connected at different times cannot be added up before every one of them has a count.',
            ],
          }}
          colSpan={2}
          data-test={'deep-dive-subscribers'}
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
          title={`${YPP_PLATFORM_NAME} Partner Programme`}
          icon={BadgeCheck}
          metricFamily={['channel_totals', 'watch_time']}
          platforms={[YPP_PLATFORM]}
          claim={yppClaim}
          details={{
            caveats: [
              'One card per channel — the gate is per channel, so a pooled total would report it met when no channel has met it.',
            ],
          }}
          colSpan={2}
          data-test={'deep-dive-ypp'}
        >
          <YppProgressSection
            applies={yppApplies}
            isLoading={yppQuery.isLoading || channelsQuery.isLoading}
            isError={isUnavailable(yppQuery) || isUnavailable(channelsQuery)}
            progress={projectYppProgress}
          />
        </AnalyticsCard>
      </div>

      <WeeklyDiagnosticsSection
        projectId={projectId}
        connectionId={filters.connectionId}
        platform={filters.platform}
      />
    </div>
  );

  // Its own coverage, for its own window. This tab ignores the header's
  // date range and reads TRAFFIC_WINDOW_WEEKS complete weeks, so the
  // dashboard's provider would describe a window these cards do not show.
  // Nested on purpose (FILM-1704 §4) — not a duplicate to fold into one.
  return (
    <CoverageProvider
      scope={scope}
      from={trafficWindow.from.toISOString().slice(0, 10)}
      to={trafficWindow.to.toISOString().slice(0, 10)}
      windowLabel={TRAFFIC_WINDOW_LABEL}
      // One platform chosen here narrows what the cards dim for; otherwise
      // the header filter's selection carries through.
      selectedPlatforms={filters.platform ? [filters.platform] : undefined}
    >
      {tab}
    </CoverageProvider>
  );
}

/**
 * The weekly breakage check, deliberately outside the card grid above.
 *
 * Those cards answer "what should we make next". This answers "did
 * something break this week" — a 2% CTR means the packaging failed on that
 * one video, not that the format is wrong. Rendered as one of the strategy
 * cards it reads as a content verdict, which is the opposite of its point,
 * so it sits below them behind its own heading and rule.
 */
function WeeklyDiagnosticsSection({
  projectId,
  connectionId,
  platform,
}: {
  projectId: string;
  connectionId: string | undefined;
  platform: AnalyticsPlatform | undefined;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const diagnosticsQuery = useQuery({
    // The channel belongs in the key: without it, switching channels reads
    // the previous channel's rows back out of the cache.
    queryKey: [
      'weekly-diagnostics',
      projectId,
      connectionId ?? 'all',
      platform ?? 'all',
    ],
    queryFn: () =>
      unwrap(
        getWeeklyDiagnosticsAction({
          scope: {
            projectId,
            ...(connectionId ? { connectionId } : {}),
            ...(platform ? { platform } : {}),
          },
          sinceDays: DIAGNOSTICS_WINDOW_DAYS,
          limit: DIAGNOSTICS_LIMIT,
        }),
      ),
  });

  const curveQuery = useQuery({
    queryKey: ['retention-curve', selected],
    queryFn: () => unwrap(getRetentionCurveAction({ publishId: selected! })),
    enabled: selected !== null,
  });

  // On the one shell (FILM-1707), and still apart from the grid above.
  // Per upload and to date — not on a date axis — so it keeps every
  // platform: a total cannot be moved by the day a change was recorded on.
  return (
    <div className={'mt-4 border-t pt-6'}>
      <AnalyticsCard
        title={'This week’s uploads'}
        icon={Activity}
        metricFamily={['engagement', 'reach', 'retention_curve']}
        claim={claimFromQuery(
          diagnosticsQuery,
          (rows): CardClaim =>
            rows.length === 0
              ? {
                  figure: null,
                  noFigure: 'No uploads this week.',
                  sentence: `Nothing was published in the last ${DIAGNOSTICS_WINDOW_DAYS} days.`,
                }
              : {
                  figure: rows.length.toLocaleString('en-US'),
                  sentence: `${rows.length === 1 ? 'Upload' : 'Uploads'} in the last ${DIAGNOSTICS_WINDOW_DAYS} days, each checked on its own.`,
                },
          'The weekly diagnostics could not be loaded — a fetch failure, not an absence of uploads.',
        )}
        details={{
          method:
            'Each upload’s figures to date, not a series over time, so every platform is included: the day a change was recorded on cannot move a total.',
        }}
        colSpan={2}
        data-test={'weekly-diagnostics-section'}
      >
      <div className={'flex flex-col gap-4'}>
      <p className={'max-w-2xl text-sm text-muted-foreground'}>
        A breakage check, not a strategy input. A low click-through rate means
        the packaging failed on that video and a sharp early drop means its
        intro did — fix the specific thing rather than generalising from one
        upload. Follows the channel selected above.
      </p>

      <QueryState
        query={diagnosticsQuery}
        skeleton={<WeeklyDiagnosticsTableSkeleton />}
        message={'The weekly diagnostics could not be loaded.'}
        dataTest={'weekly-diagnostics-error'}
      >
        <WeeklyDiagnosticsTable
          rows={diagnosticsQuery.data ?? []}
          onSelect={setSelected}
          selectedPublishId={selected}
        />
      </QueryState>

      {selected ? (
        <div
          id={'retention-drilldown'}
          className={'flex flex-col gap-2'}
          data-test={'retention-drilldown'}
        >
          <div className={'flex items-center justify-between'}>
            <h4 className={'text-sm font-medium'}>Audience retention</h4>
            <Button
              variant={'ghost'}
              size={'sm'}
              onClick={() => setSelected(null)}
              data-test={'retention-drilldown-close'}
            >
              Close
            </Button>
          </div>

          <QueryState
            query={curveQuery}
            skeleton={<RetentionCurveChartSkeleton />}
            message={'That retention curve could not be loaded.'}
            dataTest={'retention-curve-error'}
          >
            {/* The asset's own duration (FILM-1710), or `duration_unknown` —
                in which case the cliff is described without a timestamp. */}
            <RetentionCurveChart
              points={curveQuery.data?.points ?? []}
              duration={curveQuery.data?.duration}
            />
          </QueryState>
        </div>
      ) : null}
      </div>
      </AnalyticsCard>
    </div>
  );
}

/**
 * A date-axis card's claim when the switcher holds one fetch-dated
 * platform: nothing true to plot, said as a consequence of the choice
 * rather than as a failure. The shell's chip says why.
 */
function dateAxisClaim(
  nothingDated: boolean,
  claim: CardClaim | 'loading',
): CardClaim | 'loading' {
  if (!nothingDated) return claim;

  return {
    figure: null,
    noFigure: 'Not drawn for this platform.',
    sentence:
      'Choose all platforms, or one that reports daily views, to see this figure.',
  };
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
      <p className={'text-sm text-destructive'} data-test={dataTest}>
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
        className={'text-sm text-muted-foreground'}
        data-test={'ypp-not-applicable'}
      >
        Partner Programme progress applies to active {YPP_PLATFORM_NAME}{' '}
        channels.
      </p>
    );
  }

  if (isLoading) {
    return <YppProgressCardSkeleton />;
  }

  if (isError) {
    return (
      <p className={'text-sm text-destructive'} data-test={'ypp-error'}>
        Partner Programme progress could not be loaded.
      </p>
    );
  }

  if (progress.length === 0) {
    return (
      <p
        className={'text-sm text-muted-foreground'}
        data-test={'ypp-no-channels'}
      >
        No active {YPP_PLATFORM_NAME} channel publishes in this project.
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
