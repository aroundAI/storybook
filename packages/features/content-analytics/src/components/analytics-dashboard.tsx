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
  getContentListAction,
  getContentTypeComparisonAction,
  getLanguagePerformanceAction,
  getPlatformLanguageMatrixAction,
  getProjectAnalyticsAction,
  getProjectAudienceDataAction,
  getProjectDailyMetricsAction,
} from '../server/dashboard-actions';
import type {
  AggregateAnalytics,
  AnalyticsTotals,
  DailyMetric,
} from '../types';
import { AIInsights } from './ai-insights';
import { AudienceGrid } from './audience';
import { ContentGrid } from './content';
import type { DateRangeValue } from './date-range-picker';
import { DateRangePicker } from './date-range-picker';
import { ExportReports } from './export-reports';
import { LanguageAnalyticsDashboard, LanguageAnalyticsDashboardSkeleton } from './language-analytics-dashboard';
import { MetricCards } from './metric-cards';
import { OverviewGrid } from './overview';
import { PerformanceChart } from './performance-chart';
import type { Platform } from './platform-filter';
import { PlatformFilter } from './platform-filter';

export interface AnalyticsDashboardProps {
  projectId: string;
  accountSlug: string;
}

export function AnalyticsDashboard({
  projectId,
  accountSlug,
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
  const [showExportDialog, setShowExportDialog] = useState(false);

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
    enabled: activeTab === 'content' || activeTab === 'overview',
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

  // Fetch audience data for Audience tab
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
    enabled: activeTab === 'audience',
  });

  // Fetch language performance for Language tab
  const { data: languagePerformance, isLoading: isLanguageLoading } = useQuery({
    queryKey: [
      'language-performance',
      projectId,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getLanguagePerformanceAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
      }),
    enabled: activeTab === 'language',
  });

  // Fetch platform × language matrix for Language tab
  const { data: platformLanguageMatrix, isLoading: isMatrixLoading } = useQuery({
    queryKey: [
      'platform-language-matrix',
      projectId,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getPlatformLanguageMatrixAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
      }),
    enabled: activeTab === 'language',
  });

  // Fetch content type comparison for Language tab
  const { data: contentTypeComparison, isLoading: isContentTypeLoading } = useQuery({
    queryKey: [
      'content-type-comparison',
      projectId,
      dateRange.from?.toISOString(),
      dateRange.to?.toISOString(),
    ],
    queryFn: () =>
      getContentTypeComparisonAction({
        projectId,
        from: dateRange.from,
        to: dateRange.to,
      }),
    enabled: activeTab === 'language',
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
      previousPeriodTotals: undefined, // Not currently fetched
      platformMetrics,
      topContent: undefined, // Not currently fetched
      audience: undefined, // Not currently fetched
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
        { views: number; likes: number; comments: number; shares: number }
      > = {};

      if (day.byPlatform) {
        for (const platform of selectedPlatforms) {
          const platformData = day.byPlatform[platform];
          if (platformData) {
            views += platformData.views;
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

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {projectData?.projectName ?? 'Analytics'}
          </h1>
          {dataUpdatedAt > 0 && (
            <p className="text-muted-foreground text-sm">
              Last updated {formatDistanceToNow(dataUpdatedAt)} ago
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PlatformFilter
            selected={selectedPlatforms}
            onChange={setSelectedPlatforms}
          />
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <Button variant="outline" onClick={() => setShowExportDialog(true)}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <MetricCards data={totals} previousData={null} isLoading={isLoading} />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="audience">Audience</TabsTrigger>
          <TabsTrigger value="language">Language</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          {/* New Overview Grid with Masonry Layout */}
          <OverviewGrid
            analytics={aggregateAnalytics}
            audience={audienceData ?? undefined}
            contentList={contentList}
            isLoading={isLoading || isContentLoading}
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
          {/* New Content Grid with Card Layout */}
          <ContentGrid data={contentList} isLoading={isContentLoading} />
        </TabsContent>

        <TabsContent value="audience" className="mt-6">
          {/* New Audience Grid with Masonry Layout */}
          <AudienceGrid
            data={audienceData ?? undefined}
            isLoading={isAudienceLoading}
          />
        </TabsContent>

        <TabsContent value="insights" className="mt-6">
          <AIInsights projectId={projectId} analytics={aggregateAnalytics} />
        </TabsContent>

        <TabsContent value="language" className="mt-6">
          {isLanguageLoading || isMatrixLoading || isContentTypeLoading ? (
            <LanguageAnalyticsDashboardSkeleton />
          ) : (
            <LanguageAnalyticsDashboard
              languageData={languagePerformance ?? null}
              matrixData={platformLanguageMatrix ?? null}
              contentTypeData={contentTypeComparison ?? null}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Export Reports</DialogTitle>
          </DialogHeader>
          <ExportReports accountId={accountSlug} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface PlatformBreakdownCardProps {
  data: {
    platform: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
  }[];
}

function PlatformBreakdownCard({ data }: PlatformBreakdownCardProps) {
  const totalViews = data.reduce((sum, p) => sum + p.views, 0);

  const PLATFORM_COLORS: Record<string, string> = {
    youtube: 'bg-red-500',
    tiktok: 'bg-black',
    instagram: 'bg-gradient-to-r from-purple-500 to-pink-500',
  };

  const PLATFORM_LABELS: Record<string, string> = {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    instagram: 'Instagram',
  };

  return (
    <div className="space-y-4">
      {data.map((platform) => {
        const percentage =
          totalViews > 0 ? (platform.views / totalViews) * 100 : 0;
        return (
          <div key={platform.platform} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div
                  className={`h-3 w-3 rounded-full ${PLATFORM_COLORS[platform.platform] || 'bg-gray-500'}`}
                />
                <span className="font-medium">
                  {PLATFORM_LABELS[platform.platform] || platform.platform}
                </span>
              </div>
              <div className="text-muted-foreground">
                {formatNumber(platform.views)} views ({percentage.toFixed(1)}%)
              </div>
            </div>
            <Progress value={percentage} className="h-2" />
            <div className="text-muted-foreground flex justify-between text-xs">
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
