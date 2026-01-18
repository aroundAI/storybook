'use client';

import {
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Film,
  PlayCircle,
  TrendingUp,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';

import type { AccountDashboardData } from '../server/account-dashboard-actions';
import { MetricCards } from './metric-cards';
import { PerformanceChart } from './performance-chart';

interface CompanyDashboardProps {
  accountId: string;
  data: AccountDashboardData;
}

/**
 * Company Dashboard - Shows aggregated analytics across all projects for an account
 */
export function CompanyDashboard({
  accountId: _accountId,
  data,
}: CompanyDashboardProps) {
  const platforms = data.platformBreakdown.map((p) => p.platform);

  return (
    <div className="animate-in fade-in flex flex-col gap-6 pb-16 duration-500">
      {/* Hero Metrics */}
      <MetricCards
        data={data.totals}
        previousData={data.previousPeriodTotals}
        isLoading={false}
      />

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Performance Chart - Takes 2 columns */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Performance Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.dailyMetrics.length > 0 ? (
                <PerformanceChart
                  data={data.dailyMetrics}
                  platforms={platforms}
                  height={300}
                />
              ) : (
                <div className="text-muted-foreground flex h-[300px] items-center justify-center">
                  No analytics data yet. Published content will appear here.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Production Status Widget */}
        <div className="lg:col-span-1">
          <ProductionStatusCard status={data.productionStatus} />
        </div>
      </div>

      {/* Second Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Platform Breakdown */}
        <PlatformBreakdownCard breakdown={data.platformBreakdown} />

        {/* Top Content */}
        <TopContentCard content={data.topContent} />
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={<Film className="h-5 w-5" />}
          title="Projects"
          value={data.projectCount.toString()}
        />
        <SummaryCard
          icon={<PlayCircle className="h-5 w-5" />}
          title="Total Content"
          value={data.totals.contentCount.toString()}
        />
        <SummaryCard
          icon={<TrendingUp className="h-5 w-5" />}
          title="Avg Engagement"
          value={
            data.totals.views > 0
              ? `${(((data.totals.likes + data.totals.comments + data.totals.shares) / data.totals.views) * 100).toFixed(1)}%`
              : '0%'
          }
        />
        <SummaryCard
          icon={<Calendar className="h-5 w-5" />}
          title="Scheduled"
          value={data.productionStatus.scheduled.toString()}
        />
      </div>
    </div>
  );
}

/**
 * Production Status Card
 */
function ProductionStatusCard({
  status,
}: {
  status: AccountDashboardData['productionStatus'];
}) {
  const total =
    status.inProgress + status.finalized + status.published + status.scheduled;
  const publishedPercent = total > 0 ? (status.published / total) * 100 : 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Film className="h-5 w-5" />
          Production Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <StatusRow
          icon={<Clock className="h-4 w-4 text-yellow-500" />}
          label="In Progress"
          count={status.inProgress}
        />
        <StatusRow
          icon={<CheckCircle2 className="h-4 w-4 text-blue-500" />}
          label="Ready to Publish"
          count={status.finalized}
        />
        <StatusRow
          icon={<PlayCircle className="h-4 w-4 text-green-500" />}
          label="Published"
          count={status.published}
        />
        <StatusRow
          icon={<Calendar className="h-4 w-4 text-purple-500" />}
          label="Scheduled"
          count={status.scheduled}
        />

        {total > 0 && (
          <div className="pt-2">
            <div className="text-muted-foreground mb-1 text-xs">
              Published {publishedPercent.toFixed(0)}%
            </div>
            <Progress value={publishedPercent} className="h-2" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusRow({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span className="font-mono font-semibold">{count}</span>
    </div>
  );
}

/**
 * Platform Breakdown Card
 */
function PlatformBreakdownCard({
  breakdown,
}: {
  breakdown: AccountDashboardData['platformBreakdown'];
}) {
  const platformColors: Record<string, string> = {
    youtube: 'bg-red-500',
    tiktok: 'bg-black',
    instagram: 'bg-gradient-to-r from-purple-500 to-pink-500',
    facebook: 'bg-blue-600',
  };

  const platformLabels: Record<string, string> = {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    facebook: 'Facebook',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform Distribution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {breakdown.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            No platform data yet.
          </div>
        ) : (
          breakdown.map((platform) => (
            <div key={platform.platform} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span>
                  {platformLabels[platform.platform] || platform.platform}
                </span>
                <span className="text-muted-foreground">
                  {platform.percentage.toFixed(1)}%
                </span>
              </div>
              <div className="bg-muted h-2 overflow-hidden rounded-full">
                <div
                  className={`h-full ${platformColors[platform.platform] || 'bg-primary'}`}
                  style={{ width: `${platform.percentage}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Top Content Card
 */
function TopContentCard({
  content,
}: {
  content: AccountDashboardData['topContent'];
}) {
  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Performing Content</CardTitle>
      </CardHeader>
      <CardContent>
        {content.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            No published content yet.
          </div>
        ) : (
          <div className="space-y-3">
            {content.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                {item.thumbnailUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    className="h-10 w-16 rounded object-cover"
                  />
                ) : (
                  <div className="bg-muted flex h-10 w-16 items-center justify-center rounded">
                    <PlayCircle className="text-muted-foreground h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {item.title}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {formatNumber(item.views)} views •{' '}
                    {item.engagementRate.toFixed(1)}% engagement
                  </div>
                </div>
                <span className="text-muted-foreground text-xs capitalize">
                  {item.platform}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Summary Card
 */
function SummaryCard({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-4">
        <div className="bg-primary/10 text-primary rounded-lg p-2">{icon}</div>
        <div>
          <div className="text-muted-foreground text-xs">{title}</div>
          <div className="text-2xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Skeleton for loading state
 */
export function CompanyDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* Hero Metrics Skeleton */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2 px-4 pb-3 pt-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content Skeleton */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[300px] w-full" />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
