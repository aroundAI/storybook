'use client';

import { useCallback, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign,
  FileText,
  Minus,
  PieChart,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import { formatCurrency } from '../lib/format';
import { formatLocalDate } from '../lib/manual-revenue';
import {
  getRevenueProjectionAction,
  getRevenueSummaryAction,
  getRevenueTimeSeriesAction,
  getTopContentByRevenueAction,
} from '../server/revenue-actions';
import { DateRangePicker, type DateRangeValue } from './date-range-picker';
import { ManualRevenueForm } from './manual-revenue-form';
import { RevenueChart } from './revenue-chart';
import { RevenueMixCard } from './revenue-mix-card';
import { RevenuePlatformBreakdown } from './revenue-platform-breakdown';
import { RevenueTopContent } from './revenue-top-content';

type DashboardTab = 'overview' | 'platforms' | 'content' | 'manual';

interface RevenueDashboardProps {
  accountId: string;
  initialTab?: DashboardTab;
  onTabChange?: (tab: DashboardTab) => void;
}

export function RevenueDashboard({
  accountId,
  initialTab = 'overview',
  onTabChange,
}: RevenueDashboardProps) {
  const queryClient = useQueryClient();

  // Date range state (default to last 30 days)
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { from: start, to: end };
  });

  // Tab state
  const [activeTab, setActiveTabState] = useState<DashboardTab>(initialTab);

  const setActiveTab = useCallback(
    (newTab: string) => {
      const tab = newTab as DashboardTab;
      setActiveTabState(tab);
      onTabChange?.(tab);
    },
    [onTabChange],
  );

  // Format dates for API calls
  const startDate = formatLocalDate(dateRange.from);
  const endDate = formatLocalDate(dateRange.to);

  // Fetch revenue summary
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['revenue-summary', accountId, startDate, endDate] as const,
    queryFn: () =>
      getRevenueSummaryAction({
        accountId,
        startDate: startDate!,
        endDate: endDate!,
      }),
    enabled: !!startDate && !!endDate,
  });

  // Fetch projection
  const { data: projection, isLoading: projectionLoading } = useQuery({
    queryKey: ['revenue-projection', accountId] as const,
    queryFn: () => getRevenueProjectionAction({ accountId }),
  });

  // Fetch time series data
  const { data: timeSeries, isLoading: timeSeriesLoading } = useQuery({
    queryKey: ['revenue-timeseries', accountId, startDate, endDate] as const,
    queryFn: () =>
      getRevenueTimeSeriesAction({
        accountId,
        startDate: startDate!,
        endDate: endDate!,
      }),
    enabled: activeTab === 'overview' && !!startDate && !!endDate,
  });

  // Fetch top content
  const { data: topContent, isLoading: topContentLoading } = useQuery({
    queryKey: ['revenue-top-content', accountId, startDate, endDate] as const,
    queryFn: () =>
      getTopContentByRevenueAction({
        accountId,
        startDate: startDate!,
        endDate: endDate!,
        limit: 10,
      }),
    enabled: activeTab === 'content' && !!startDate && !!endDate,
  });

  const handleManualRevenueSuccess = () => {
    // Invalidate queries to refresh data
    queryClient.invalidateQueries({ queryKey: ['revenue-summary', accountId] });
    queryClient.invalidateQueries({
      queryKey: ['revenue-timeseries', accountId],
    });
    queryClient.invalidateQueries({
      queryKey: ['revenue-top-content', accountId],
    });
  };

  const TrendIcon =
    summary?.trend === 'up'
      ? TrendingUp
      : summary?.trend === 'down'
        ? TrendingDown
        : Minus;

  const trendColor =
    summary?.trend === 'up'
      ? 'text-green-600'
      : summary?.trend === 'down'
        ? 'text-red-600'
        : 'text-muted-foreground';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Revenue</h2>
          <p className="text-muted-foreground">
            Track your earnings across all platforms
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <Button variant="outline">
            <FileText className="mr-2 h-4 w-4" />
            Generate Report
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatCurrency((summary?.totalRevenueCents ?? 0) / 100)}
                </div>
                {summary && (
                  <div className={`flex items-center text-xs ${trendColor}`}>
                    <TrendIcon className="mr-1 h-3 w-3" />
                    {summary.trendPercent > 0 ? '+' : ''}
                    {summary.trendPercent.toFixed(1)}% from previous period
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Daily Average</CardTitle>
            <TrendingUp className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatCurrency(
                    (summary?.averageDailyRevenueCents ?? 0) / 100,
                  )}
                </div>
                <p className="text-muted-foreground text-xs">per day</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">RPM</CardTitle>
            <PieChart className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatCurrency((summary?.rpm ?? 0) / 100)}
                </div>
                <p className="text-muted-foreground text-xs">per 1,000 views</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Monthly Projection
            </CardTitle>
            <TrendingUp className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            {projectionLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatCurrency(
                    (projection?.estimatedMonthlyRevenueCents ?? 0) / 100,
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {projection?.confidenceLevel} confidence
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="overview" data-test="revenue-tab-overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="platforms">By Platform</TabsTrigger>
          <TabsTrigger value="content">By Content</TabsTrigger>
          <TabsTrigger value="manual" data-test="revenue-tab-manual">
            Manual Entry
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Revenue Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueChart
                data={timeSeries ?? []}
                isLoading={timeSeriesLoading}
              />
            </CardContent>
          </Card>

          {/*
            The only display path revenue categories have: without it, a new
            category (FILM-1609 licensing) could be recorded and shown to
            nobody.
          */}
          <Card data-test="revenue-mix-card">
            <CardHeader>
              <CardTitle>Revenue Mix</CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueMixCard
                byType={summary?.byType ?? {}}
                isLoading={summaryLoading}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="platforms">
          <RevenuePlatformBreakdown
            breakdown={summary?.byPlatform ?? {}}
            total={summary?.totalRevenueCents ?? 0}
            isLoading={summaryLoading}
          />
        </TabsContent>

        <TabsContent value="content">
          <RevenueTopContent
            data={topContent ?? []}
            isLoading={topContentLoading}
          />
        </TabsContent>

        <TabsContent value="manual">
          <ManualRevenueForm
            accountId={accountId}
            onSuccess={handleManualRevenueSuccess}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function RevenueDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="mt-2 h-4 w-48" />
        </div>
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-[280px]" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-8 w-32" />
              <Skeleton className="mt-1 h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Skeleton className="h-[400px] w-full" />
    </div>
  );
}
