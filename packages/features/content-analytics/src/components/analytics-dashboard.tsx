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
  getProjectAnalyticsAction,
} from '../server/dashboard-actions';
import type {
  AggregateAnalytics,
  AnalyticsTotals,
  DailyMetric,
  PlatformBreakdown,
} from '../types';
import { AIInsights } from './ai-insights';
import { AudienceAnalytics } from './audience-analytics';
import { ContentTable } from './content-table';
import type { DateRangeValue } from './date-range-picker';
import { DateRangePicker } from './date-range-picker';
import { ExportReports } from './export-reports';
import { MetricCards } from './metric-cards';
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

  // Filter data by selected platforms
  const filteredPlatformTotals = projectData?.platformTotals?.filter(
    (p: PlatformBreakdown) => selectedPlatforms.includes(p.platform),
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
  const aggregateAnalytics: AggregateAnalytics | null = projectData
    ? {
        totals: totals!,
        previousPeriodTotals: undefined, // Not currently fetched
        platformMetrics: filteredPlatformTotals,
        topContent: undefined, // Not currently fetched
        audience: undefined, // Not currently fetched
        contentCount: projectData.contentCount ?? 0,
        avgEngagementRate: projectData.avgEngagementRate ?? 0,
      }
    : null;

  // Daily metrics are not currently available from getProjectAnalytics
  // This would require additional queries to aggregate daily snapshots
  // For now, we pass an empty array to the chart
  const filteredDailyMetrics: DailyMetric[] = [];

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
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          {/* Performance Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Performance Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[350px] w-full" />
              ) : (
                <PerformanceChart
                  data={filteredDailyMetrics}
                  platforms={selectedPlatforms}
                />
              )}
            </CardContent>
          </Card>

          {/* Platform Breakdown */}
          {filteredPlatformTotals && filteredPlatformTotals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Platform Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <PlatformBreakdownCard data={filteredPlatformTotals} />
              </CardContent>
            </Card>
          )}

          {/* Top Performing Content */}
          <Card>
            <CardHeader>
              <CardTitle>Top Performing Content</CardTitle>
            </CardHeader>
            <CardContent>
              <ContentTable
                data={contentList}
                isLoading={isContentLoading}
                limit={5}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="content" className="mt-6">
          <ContentTable data={contentList} isLoading={isContentLoading} />
        </TabsContent>

        <TabsContent value="audience" className="mt-6">
          <AudienceAnalytics data={undefined} isLoading={isLoading} />
        </TabsContent>

        <TabsContent value="insights" className="mt-6">
          <AIInsights projectId={projectId} analytics={aggregateAnalytics} />
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
  data: PlatformBreakdown[];
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
