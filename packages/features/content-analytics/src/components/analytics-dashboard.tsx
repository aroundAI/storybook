'use client';

import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { subDays } from 'date-fns';
import { formatDistanceToNow } from 'date-fns';
import { Download, PieChart, TrendingUp } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import { formatNumber } from '../lib/format';
import {
  audienceForInsights,
  buildTrendFacts,
  previousPeriod,
  topContentForInsights,
} from '../lib/insights-inputs';
import { localDateOf } from '../lib/local-date';
import { ABSENT, measured } from '../lib/measured';
import { platformLabel } from '../lib/platform-labels';
import {
  NO_PLATFORM_SELECTED,
  orderedSelection,
} from '../lib/platform-selection';
import { TAB_FAMILIES, isAnalyticsTab } from '../lib/provenance';
import { SHOWN_ANALYTICS_PLATFORMS } from '../lib/shown-platforms';
import { isoDay, viewDefinitionMarks } from '../lib/view-definition-marks';
import { VIEWS_NOT_MEASURED, viewsShare, viewsToAdd } from '../lib/views';
import type { Views } from '../lib/views';
import {
  getContentListAction,
  getProjectAnalyticsAction,
  getProjectAudienceDataAction,
  getProjectDailyMetricsAction,
  getProjectRevenueAccessAction,
  getProjectRevenueByCurrencyAction,
} from '../server/dashboard-actions';
import type {
  AggregateAnalytics,
  AnalyticsTotals,
  DailyMetric,
} from '../types';
import { AIInsights } from './ai-insights';
import { AudienceGrid } from './audience';
import { ContentGrid } from './content';
import { ContentTablePanel } from './content-table-panel';
import { CoverageProvider } from './coverage-context';
import { CoveragePlatformFilter, CoverageStrip } from './coverage-strip';
import type { DateRangeValue } from './date-range-picker';
import { DateRangePicker } from './date-range-picker';
import { DeepDiveTab } from './deep-dive/deep-dive-tab';
import { ExportReports } from './export-reports';
import { LanguageTab } from './language-tab';
import { MetricCards, NOT_COLLECTED_HERE_REASON } from './metric-cards';
import { OverviewGrid } from './overview';
import { AnalyticsCard } from './overview/analytics-card';
import { type CardClaim, platformSplitClaim } from './overview/card-claim';
import { PerformanceChart } from './performance-chart';
import type { Platform } from './platform-filter';
import { VideoLogTab } from './video-log';

export interface AnalyticsDashboardProps {
  projectId: string;
  /**
   * The project's account **id**. This was an `accountSlug` handed to
   * `ExportReports` as `accountId`, which the report schemas reject as a
   * non-uuid — report generation and the scheduled-reports list failed
   * validation on this page.
   */
  accountId: string;
}

export function AnalyticsDashboard({
  projectId,
  accountId,
}: AnalyticsDashboardProps) {
  const [dateRange, setDateRange] = useState<DateRangeValue>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  // Every analytics platform, selected (FILM-1709 × FILM-1720).
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([
    ...SHOWN_ANALYTICS_PLATFORMS,
  ]);
  const [activeTab, setActiveTab] = useState('overview');
  // The channel filter, shared by the Deep Dive and the Video Log: picking a
  // channel in one is picking it in the other (FILM-1615 D-U1). Undefined is
  // every channel.
  const [connectionId, setConnectionId] = useState<string | undefined>();
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [contentView, setContentView] = useState<'cards' | 'table'>('cards');

  // The filter's selection, in its own order (FILM-1709). Every read below
  // takes it and filters in its query; none filters a response afterwards.
  // Empty is the page's to say — nothing is asked for, and every tab and
  // headline figure says no platform is selected.
  const platforms = orderedSelection(selectedPlatforms);
  const anySelected = platforms.length > 0;

  // Fetch project analytics with 5-minute auto-refresh
  const {
    data: projectData,
    isLoading: isProjectLoading,
    dataUpdatedAt,
  } = useQuery({
    queryKey: [
      'project-analytics',
      projectId,
      platforms,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getProjectAnalyticsAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
        platforms,
      }),
    refetchInterval: 5 * 60 * 1000, // 5 min auto-refresh
    enabled: anySelected,
  });
  // A disabled query is "pending" but not loading: without the selection
  // in it, the page would draw an empty result for a question not asked.
  const isLoading = anySelected && isProjectLoading;

  const previousRange = previousPeriod(dateRange);

  // Why revenue is not measured, when it is not (FILM-1726): per channel,
  // not per window, so it is read once.
  const { data: revenueAccess } = useQuery({
    queryKey: ['project-revenue-access', projectId],
    queryFn: () => getProjectRevenueAccessAction({ projectId }),
  });

  // The window before the selected one, for the AI Insights trends only
  const { data: previousProjectData, isLoading: isPreviousLoading } = useQuery({
    queryKey: [
      'project-analytics',
      projectId,
      platforms,
      previousRange?.from.toISOString(),
      previousRange?.to.toISOString(),
    ],
    queryFn: () =>
      getProjectAnalyticsAction({
        projectId,
        from: previousRange?.from,
        to: previousRange?.to,
        platforms,
      }),
    enabled: activeTab === 'insights' && !!previousRange && anySelected,
  });

  // Fetch content list for Content tab
  const { data: contentList, isLoading: isContentLoading } = useQuery({
    queryKey: [
      'content-list',
      projectId,
      platforms,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getContentListAction({
        projectId,
        platforms,
        from: dateRange.from,
        to: dateRange.to,
      }),
    enabled:
      anySelected &&
      (activeTab === 'content' ||
        activeTab === 'overview' ||
        activeTab === 'insights'),
  });

  // Fetch daily metrics for Performance Over Time chart
  const { data: dailyMetrics, isLoading: isDailyMetricsLoading } = useQuery({
    queryKey: [
      'daily-metrics',
      projectId,
      platforms,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getProjectDailyMetricsAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
        platforms,
      }),
    enabled: anySelected && activeTab === 'overview',
  });

  // Recorded revenue per currency, for the Overview's revenue card (KB-16).
  // The card used to split a ClickHouse total 70/30 by itself.
  const { data: revenueByCurrency, isLoading: isRevenueLoading } = useQuery({
    queryKey: [
      'project-revenue-by-currency',
      projectId,
      platforms,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getProjectRevenueByCurrencyAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
        platforms,
      }),
    enabled: anySelected && activeTab === 'overview',
  });

  // Audience data, for the Audience tab and for Overview's Top Regions and
  // Gender cards. Enabled on both: it was enabled on Audience alone while
  // Overview was handed its result, so on a first load those two cards said
  // "no data" about data that had simply not been asked for (FILM-1701).
  const { data: audienceData, isLoading: isAudienceLoading } = useQuery({
    queryKey: [
      'audience-data',
      projectId,
      platforms,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getProjectAudienceDataAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
        platforms,
      }),
    enabled:
      anySelected &&
      (activeTab === 'audience' ||
        activeTab === 'overview' ||
        activeTab === 'insights'),
  });

  // Already the selected platforms': filtered in the query, not here.
  const platformTotals = projectData?.platformTotals;

  // Transform flat ProjectAnalytics into AnalyticsTotals format
  // getProjectAnalytics returns flat fields (totalViews, totalLikes, etc.)
  // but MetricCards expects nested structure (views, likes, etc.)
  const totals: AnalyticsTotals | null = projectData
    ? {
        views: projectData.totalViews,
        likes: projectData.totalLikes,
        comments: projectData.totalComments,
        shares: projectData.totalShares,
        // Not totalled for a project: the cards say so, not 0 (FILM-1705 §5,
        // KB-149).
        watchTimeSeconds: null,
        subscribersGained: null,
        revenueCents: projectData.totalRevenueCents,
        contentCount: projectData.contentCount,
      }
    : null;

  // What the strip and the filter speak for: the families the active tab's
  // cards read. Deep Dive mounts its own strip, for its own window.
  const tabFamilies = isAnalyticsTab(activeTab)
    ? TAB_FAMILIES[activeTab]
    : TAB_FAMILIES.overview;

  // Build aggregate analytics object for AIInsights
  // Map platformTotals to PlatformBreakdown format (platform needs to be union type)
  const platformMetrics = platformTotals?.map((p) => ({
    platform: p.platform as 'youtube' | 'tiktok' | 'instagram',
    views: p.views,
    likes: p.likes,
    comments: p.comments,
    shares: p.shares,
  }));

  const aggregateAnalytics: AggregateAnalytics | null = projectData
    ? {
        totals: totals!,
        platformMetrics,
        topContent: topContentForInsights(contentList),
        audience: audienceForInsights(audienceData),
        trendFacts: buildTrendFacts(
          platformMetrics,
          previousProjectData?.platformTotals,
        ),
        contentCount: projectData.contentCount ?? 0,
        avgEngagementRate: projectData.avgEngagementRate.value,
        avgEngagementDenominator: projectData.avgEngagementRate.denominator,
      }
    : null;

  // The selected platforms' days, summed in the query (FILM-1709).
  const performanceData: DailyMetric[] = dailyMetrics ?? [];

  const page = (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {projectData?.projectName ?? 'Analytics'}
          </h1>
          {dataUpdatedAt > 0 && (
            <p className="text-sm text-muted-foreground">
              Last updated {formatDistanceToNow(dataUpdatedAt)} ago
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CoveragePlatformFilter
            families={tabFamilies}
            selected={selectedPlatforms}
            onChange={setSelectedPlatforms}
          />
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <Button
            variant="outline"
            onClick={() => setShowExportDialog(true)}
            data-test="analytics-export"
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {activeTab !== 'deep-dive' && <CoverageStrip families={tabFamilies} />}

      {/* Metric Cards */}
      <MetricCards
        data={anySelected ? totals : null}
        previousData={null}
        isLoading={isLoading}
        notMeasuredReason={NOT_COLLECTED_HERE_REASON}
        viewsScope={projectData?.viewsScope ?? null}
        noFigureReason={anySelected ? undefined : 'No platform selected'}
        revenueAccess={revenueAccess ?? []}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-test="analytics-tab-overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="content" data-test="analytics-tab-content">
            Content
          </TabsTrigger>
          <TabsTrigger value="audience" data-test="analytics-tab-audience">
            Audience
          </TabsTrigger>
          <TabsTrigger value="deep-dive" data-test="analytics-tab-deep-dive">
            Deep Dive
          </TabsTrigger>
          <TabsTrigger value="video-log" data-test="analytics-tab-video-log">
            Video Log
          </TabsTrigger>
          <TabsTrigger value="language" data-test="analytics-tab-language">
            Language
          </TabsTrigger>
          <TabsTrigger value="insights" data-test="analytics-tab-insights">
            AI Insights
          </TabsTrigger>
        </TabsList>

        {!anySelected && (
          <NoPlatformSelected
            onSelectAll={() =>
              setSelectedPlatforms([...SHOWN_ANALYTICS_PLATFORMS])
            }
          />
        )}

        <TabsContent value="overview" className="mt-6 space-y-6">
          {anySelected && (
            <>
              <OverviewGrid
                analytics={aggregateAnalytics}
                audience={audienceData ?? undefined}
                contentList={contentList}
                revenue={
                  revenueByCurrency ? measured(revenueByCurrency) : ABSENT
                }
                isLoading={isLoading || isContentLoading || isRevenueLoading}
                onViewAllContent={() => setActiveTab('content')}
                onViewAIReport={() => setActiveTab('insights')}
              />

              <PerformanceOverTimeCard
                data={performanceData}
                platforms={platforms}
                isLoading={isLoading || isDailyMetricsLoading}
                from={localDateOf(dateRange.from)}
                to={localDateOf(dateRange.to)}
              />

              {/* Platform Breakdown (legacy - kept for detailed view) */}
              {platformTotals && platformTotals.length > 0 && (
                <PlatformDistributionCard data={platformTotals} />
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="content" className="mt-6">
          {anySelected && (
            <>
              <div
                className="mb-4 flex gap-2"
                role="group"
                aria-label="Content view"
              >
                {(['cards', 'table'] as const).map((view) => (
                  <Button
                    key={view}
                    type="button"
                    size="sm"
                    variant={contentView === view ? 'default' : 'outline'}
                    aria-pressed={contentView === view}
                    onClick={() => setContentView(view)}
                    data-test={`content-view-${view}`}
                  >
                    {view === 'cards' ? 'Cards' : 'Table'}
                  </Button>
                ))}
              </div>
              {contentView === 'cards' ? (
                <ContentGrid data={contentList} isLoading={isContentLoading} />
              ) : (
                <ContentTablePanel
                  accountId={accountId}
                  projectId={projectId}
                  data={contentList}
                  isLoading={isContentLoading}
                />
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="audience" className="mt-6">
          {anySelected && (
            <AudienceGrid
              data={audienceData ?? undefined}
              isLoading={isAudienceLoading}
            />
          )}
        </TabsContent>

        <TabsContent value="deep-dive" className="mt-6">
          {anySelected && (
            <DeepDiveTab
              projectId={projectId}
              accountId={accountId}
              platforms={platforms}
              onPlatformsChange={setSelectedPlatforms}
              connectionId={connectionId}
              onConnectionChange={setConnectionId}
            />
          )}
        </TabsContent>

        <TabsContent value="video-log" className="mt-6">
          {anySelected && (
            <VideoLogTab
              projectId={projectId}
              platforms={platforms}
              connectionId={connectionId}
              onConnectionChange={setConnectionId}
            />
          )}
        </TabsContent>

        <TabsContent value="insights" className="mt-6">
          {!anySelected ? null : isPreviousLoading ||
            isContentLoading ||
            isAudienceLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <AIInsights
              projectId={projectId}
              analytics={aggregateAnalytics}
              windowLabel={`${localDateOf(dateRange.from)} to ${localDateOf(dateRange.to)}`}
            />
          )}
        </TabsContent>

        <TabsContent value="language" className="mt-6">
          {anySelected && (
            <LanguageTab
              projectId={projectId}
              dateRange={dateRange}
              platforms={platforms}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Export Reports</DialogTitle>
          </DialogHeader>
          <ExportReports accountId={accountId} />
        </DialogContent>
      </Dialog>
    </div>
  );

  const coverageFrom = localDateOf(dateRange.from);
  const coverageTo = localDateOf(dateRange.to);

  // Coverage for the header's window, fetched once for every card on the
  // page (FILM-1704). Deep Dive mounts its own, for the window it reads.
  return (
    <CoverageProvider
      scope={{ projectId }}
      from={coverageFrom}
      to={coverageTo}
      windowLabel={`${coverageFrom} to ${coverageTo}`}
      selectedPlatforms={selectedPlatforms}
    >
      {page}
    </CoverageProvider>
  );
}

/**
 * In place of every tab when the filter selects nothing (FILM-1709): a
 * consequence of the selection, said once, with the way back — not fifteen
 * cards each failing to load.
 */
function NoPlatformSelected({ onSelectAll }: { onSelectAll: () => void }) {
  return (
    <div
      className="mt-6 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground"
      data-test="analytics-no-platform-selected"
      role="status"
    >
      <p className="font-medium text-foreground">{NO_PLATFORM_SELECTED}</p>
      <p>
        Every figure on this page is for the platforms the filter selects, so
        with none selected there is nothing to show.
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={onSelectAll}
        data-test="analytics-select-all-platforms"
      >
        Select every platform
      </Button>
    </div>
  );
}

/**
 * Views per day over the header's window (FILM-1707: on the one shell). Not
 * `onDateAxis`: §2's exclusion is Deep Dive's decision, and this chart's
 * data is unchanged. It marks a view-definition change inside the window
 * rather than drawing the step as though viewers made it (FILM-1722).
 */
export function PerformanceOverTimeCard({
  data,
  platforms,
  isLoading,
  from,
  to,
}: {
  data: DailyMetric[];
  platforms: Platform[];
  isLoading: boolean;
  from: string;
  to: string;
}) {
  const plotted = platforms.filter((platform) =>
    data.some((day) => (day.byPlatform?.[platform]?.views ?? 0) > 0),
  );
  const marks = viewDefinitionMarks(
    plotted,
    data[0] ? isoDay(data[0].date) : undefined,
    data.at(-1) ? isoDay(data.at(-1)!.date) : undefined,
  );
  const total = data.reduce((sum, day) => sum + viewsToAdd(day.views), 0);

  const claim: CardClaim | 'loading' = isLoading
    ? 'loading'
    : data.length === 0
      ? {
          figure: null,
          noFigure: 'No daily figures in this period.',
          sentence: `Nothing was recorded for the selected platforms from ${from} to ${to}.`,
        }
      : {
          figure: formatNumber(total),
          sentence: `Views per day, ${from} to ${to}.`,
        };

  return (
    <AnalyticsCard
      title="Performance Over Time"
      icon={TrendingUp}
      metricFamily="engagement"
      platforms={platforms}
      claim={claim}
      marks={marks}
      colSpan={2}
      data-test="overview-performance"
    >
      {isLoading ? (
        <Skeleton className="h-[350px] w-full" />
      ) : (
        <PerformanceChart data={data} platforms={platforms} marks={marks} />
      )}
    </AnalyticsCard>
  );
}

interface PlatformDistributionCardProps {
  data: {
    platform: string;
    views: Views;
    likes: number;
    comments: number;
    shares: number | null;
  }[];
}

/** Views, likes, comments and shares per platform, in neutral tokens: colour is never a platform. */
function PlatformDistributionCard({ data }: PlatformDistributionCardProps) {
  const totalViews = data.reduce((sum, p) => sum + viewsToAdd(p.views), 0);

  return (
    <AnalyticsCard
      title="Platform Distribution (Detailed)"
      icon={PieChart}
      metricFamily="engagement"
      claim={platformSplitClaim(data)}
      colSpan={2}
      data-test="overview-platform-distribution"
    >
      <div className="space-y-4">
        {data.map((platform) => {
          const percentage = viewsShare(platform.views, totalViews);
          return (
            <div key={platform.platform} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {platformLabel(platform.platform)}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {platform.views === null || percentage === null
                    ? `Views ${VIEWS_NOT_MEASURED.toLowerCase()}`
                    : `${formatNumber(platform.views)} views (${percentage.toFixed(1)}%)`}
                </span>
              </div>
              <Progress value={percentage ?? 0} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{formatNumber(platform.likes)} likes</span>
                <span>{formatNumber(platform.comments)} comments</span>
                <span>
                  {platform.shares === null
                    ? 'shares not reported'
                    : `${formatNumber(platform.shares)} shares`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </AnalyticsCard>
  );
}

export function AnalyticsDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-10 w-96" />
      <Skeleton className="h-64" />
    </div>
  );
}
