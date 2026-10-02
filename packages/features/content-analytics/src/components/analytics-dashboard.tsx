'use client';

import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { subDays } from 'date-fns';
import { formatDistanceToNow } from 'date-fns';
import { Download } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
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
import { TAB_FAMILIES, isAnalyticsTab } from '../lib/provenance';
import { VIEWS_NOT_MEASURED, viewsShare, viewsToAdd } from '../lib/views';
import type { Views } from '../lib/views';
import {
  getContentListAction,
  getProjectAnalyticsAction,
  getProjectAudienceDataAction,
  getProjectDailyMetricsAction,
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
import { MetricCards, type MetricTotals } from './metric-cards';
import { OverviewGrid } from './overview';
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
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([
    'youtube',
    'tiktok',
    'instagram',
  ]);
  const [activeTab, setActiveTab] = useState('overview');
  // The channel filter, shared by the Deep Dive and the Video Log: picking a
  // channel in one is picking it in the other (FILM-1615 D-U1). Undefined is
  // every channel.
  const [connectionId, setConnectionId] = useState<string | undefined>();
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [contentView, setContentView] = useState<'cards' | 'table'>('cards');

  // Fetch project analytics with 5-minute auto-refresh
  const {
    data: projectData,
    isLoading,
    dataUpdatedAt,
  } = useQuery({
    queryKey: [
      'project-analytics',
      projectId,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getProjectAnalyticsAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
      }),
    refetchInterval: 5 * 60 * 1000, // 5 min auto-refresh
  });

  const previousRange = previousPeriod(dateRange);

  // The window before the selected one, for the AI Insights trends only
  const { data: previousProjectData, isLoading: isPreviousLoading } = useQuery({
    queryKey: [
      'project-analytics',
      projectId,
      previousRange?.from.toISOString(),
      previousRange?.to.toISOString(),
    ],
    queryFn: () =>
      getProjectAnalyticsAction({
        projectId,
        from: previousRange?.from,
        to: previousRange?.to,
      }),
    enabled: activeTab === 'insights' && !!previousRange,
  });

  // Fetch content list for Content tab
  const { data: contentList, isLoading: isContentLoading } = useQuery({
    queryKey: [
      'content-list',
      projectId,
      selectedPlatforms,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getContentListAction({
        projectId,
        platforms: selectedPlatforms,
        from: dateRange.from,
        to: dateRange.to,
      }),
    enabled:
      activeTab === 'content' ||
      activeTab === 'overview' ||
      activeTab === 'insights',
  });

  // Fetch daily metrics for Performance Over Time chart
  const { data: dailyMetrics, isLoading: isDailyMetricsLoading } = useQuery({
    queryKey: [
      'daily-metrics',
      projectId,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getProjectDailyMetricsAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
      }),
    enabled: activeTab === 'overview',
  });

  // Recorded revenue per currency, for the Overview's revenue card (KB-16).
  // The card used to split a ClickHouse total 70/30 by itself.
  const { data: revenueByCurrency, isLoading: isRevenueLoading } = useQuery({
    queryKey: [
      'project-revenue-by-currency',
      projectId,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getProjectRevenueByCurrencyAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
      }),
    enabled: activeTab === 'overview',
  });

  // Audience data, for the Audience tab and for Overview's Top Regions and
  // Gender cards. Enabled on both: it was enabled on Audience alone while
  // Overview was handed its result, so on a first load those two cards said
  // "no data" about data that had simply not been asked for (FILM-1701).
  const { data: audienceData, isLoading: isAudienceLoading } = useQuery({
    queryKey: [
      'audience-data',
      projectId,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getProjectAudienceDataAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
      }),
    enabled:
      activeTab === 'audience' ||
      activeTab === 'overview' ||
      activeTab === 'insights',
  });

  // Filter data by selected platforms
  // projectData.platformTotals has { platform, views, likes, comments, shares, percentage }
  const filteredPlatformTotals = projectData?.platformTotals?.filter((p) =>
    selectedPlatforms.includes(p.platform as Platform),
  );

  // Transform flat ProjectAnalytics into AnalyticsTotals format
  // getProjectAnalytics returns flat fields (totalViews, totalLikes, etc.)
  // but MetricCards expects nested structure (views, likes, etc.)
  const totals: AnalyticsTotals | null = projectData
    ? {
        views: projectData.totalViews,
        likes: projectData.totalLikes,
        comments: projectData.totalComments,
        shares: projectData.totalShares,
        watchTimeSeconds: 0, // Not available at project level
        subscribersGained: 0, // Not available at project level
        revenueCents: projectData.totalRevenueCents,
        contentCount: projectData.contentCount,
      }
    : null;

  // Watch time and subscribers are not totalled for a project, so the cards
  // say that instead of drawing the zeros above (FILM-1705 §5).
  const metricTotals: MetricTotals | null = totals
    ? { ...totals, watchTimeSeconds: null, subscribersGained: null }
    : null;

  // What the strip and the filter speak for: the families the active tab's
  // cards read. Deep Dive mounts its own strip, for its own window.
  const tabFamilies = isAnalyticsTab(activeTab)
    ? TAB_FAMILIES[activeTab]
    : TAB_FAMILIES.overview;

  // Build aggregate analytics object for AIInsights
  // Map platformTotals to PlatformBreakdown format (platform needs to be union type)
  const platformMetrics = filteredPlatformTotals?.map((p) => ({
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
        avgEngagementRate: projectData.avgEngagementRate ?? 0,
      }
    : null;

  // Filter daily metrics by selected platforms
  const filteredDailyMetrics: DailyMetric[] = (dailyMetrics || []).map(
    (day) => {
      // Sum metrics for selected platforms only
      let views = 0;
      let likes = 0;
      let comments = 0;
      let shares = 0;
      const filteredByPlatform: Record<
        string,
        { views: Views; likes: number; comments: number; shares: number }
      > = {};

      if (day.byPlatform) {
        for (const platform of selectedPlatforms) {
          const platformData = day.byPlatform[platform];
          if (platformData) {
            views += viewsToAdd(platformData.views);
            likes += platformData.likes;
            comments += platformData.comments;
            shares += platformData.shares;
            filteredByPlatform[platform] = platformData;
          }
        }
      }

      return {
        date: day.date,
        views,
        likes,
        comments,
        shares,
        byPlatform: filteredByPlatform,
      };
    },
  );

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
        data={metricTotals}
        previousData={null}
        isLoading={isLoading}
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
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          {/* New Overview Grid with Masonry Layout */}
          <OverviewGrid
            analytics={aggregateAnalytics}
            audience={audienceData ?? undefined}
            contentList={contentList}
            revenue={revenueByCurrency ? measured(revenueByCurrency) : ABSENT}
            isLoading={isLoading || isContentLoading || isRevenueLoading}
            onViewAllContent={() => setActiveTab('content')}
            onViewAIReport={() => setActiveTab('insights')}
          />

          {/* Performance Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Performance Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading || isDailyMetricsLoading ? (
                <Skeleton className="h-[350px] w-full" />
              ) : (
                <PerformanceChart
                  data={filteredDailyMetrics}
                  platforms={selectedPlatforms}
                />
              )}
            </CardContent>
          </Card>

          {/* Platform Breakdown (legacy - kept for detailed view) */}
          {filteredPlatformTotals && filteredPlatformTotals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Platform Distribution (Detailed)</CardTitle>
              </CardHeader>
              <CardContent>
                <PlatformBreakdownCard data={filteredPlatformTotals} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="content" className="mt-6">
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
        </TabsContent>

        <TabsContent value="audience" className="mt-6">
          {/* New Audience Grid with Masonry Layout */}
          <AudienceGrid
            data={audienceData ?? undefined}
            isLoading={isAudienceLoading}
          />
        </TabsContent>

        <TabsContent value="deep-dive" className="mt-6">
          <DeepDiveTab
            projectId={projectId}
            accountId={accountId}
            connectionId={connectionId}
            onConnectionChange={setConnectionId}
          />
        </TabsContent>

        <TabsContent value="video-log" className="mt-6">
          <VideoLogTab
            projectId={projectId}
            connectionId={connectionId}
            onConnectionChange={setConnectionId}
          />
        </TabsContent>

        <TabsContent value="insights" className="mt-6">
          {isPreviousLoading || isContentLoading || isAudienceLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <AIInsights projectId={projectId} analytics={aggregateAnalytics} />
          )}
        </TabsContent>

        <TabsContent value="language" className="mt-6">
          <LanguageTab projectId={projectId} dateRange={dateRange} />
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

interface PlatformBreakdownCardProps {
  data: {
    platform: string;
    views: Views;
    likes: number;
    comments: number;
    shares: number;
  }[];
}

function PlatformBreakdownCard({ data }: PlatformBreakdownCardProps) {
  const totalViews = data.reduce((sum, p) => sum + viewsToAdd(p.views), 0);

  const PLATFORM_COLORS: Record<string, string> = {
    youtube: 'bg-red-500',
    tiktok: 'bg-black',
    instagram: 'bg-gradient-to-r from-purple-500 to-pink-500',
  };

  return (
    <div className="space-y-4">
      {data.map((platform) => {
        const percentage = viewsShare(platform.views, totalViews);
        return (
          <div key={platform.platform} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div
                  className={`h-3 w-3 rounded-full ${PLATFORM_COLORS[platform.platform] || 'bg-gray-500'}`}
                />
                <span className="font-medium">
                  {platformLabel(platform.platform)}
                </span>
              </div>
              <div className="text-muted-foreground">
                {platform.views === null || percentage === null
                  ? `Views ${VIEWS_NOT_MEASURED.toLowerCase()}`
                  : `${formatNumber(platform.views)} views (${percentage.toFixed(1)}%)`}
              </div>
            </div>
            <Progress value={percentage ?? 0} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatNumber(platform.likes)} likes</span>
              <span>{formatNumber(platform.comments)} comments</span>
              <span>{formatNumber(platform.shares)} shares</span>
            </div>
          </div>
        );
      })}
    </div>
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
