'use client';

import { useMemo } from 'react';

import { Skeleton } from '@kit/ui/skeleton';

import { formatDate, formatNumber, formatPercent } from '../../lib/format';
import type { ContentListItem } from '../../server/aggregation-queries';
import type {
  AggregateAnalytics,
  AudienceData,
  InsightsResult,
} from '../../types';
import { AIInsightCard } from './ai-insight-card';
import { CommentsCard } from './comments-card';
import { GenderCard } from './gender-card';
import { LikesCard } from './likes-card';
import { PlatformSplitCard } from './platform-split-card';
import { RevenueCard } from './revenue-card';
import { SharesCard } from './shares-card';
import { TopContentCard } from './top-content-card';
import { TopRegionsCard } from './top-regions-card';
import { ViewsCard } from './views-card';

interface OverviewGridProps {
  /** Analytics data */
  analytics: AggregateAnalytics | null;
  /** Audience data */
  audience?: AudienceData;
  /** Content list for top content */
  contentList?: ContentListItem[];
  /** AI insights for the insight card */
  insights?: InsightsResult | null;
  /** Share breakdown (mock data) */
  shareBreakdown?: { direct: number; copyLink: number };
  /** Revenue breakdown (mock data) */
  revenueBreakdown?: { adRevenue: number; sponsorships: number };
  /** Loading state */
  isLoading?: boolean;
  /** Callback for View All content */
  onViewAllContent?: () => void;
  /** Callback for View AI Report */
  onViewAIReport?: () => void;
}

export function OverviewGrid({
  analytics,
  audience,
  contentList,
  insights,
  shareBreakdown,
  revenueBreakdown,
  isLoading = false,
  onViewAllContent,
  onViewAIReport,
}: OverviewGridProps) {
  const totals = analytics?.totals;
  const platformMetrics = analytics?.platformMetrics;
  const dailyData = analytics?.dailyData;

  // Transform daily data into labeled sparkline data points
  // Note: Hooks must be called before any early returns
  const viewsSparklineData = useMemo(() => {
    if (!dailyData || dailyData.length === 0) return undefined;
    return dailyData.map((day) => ({
      value: day.views,
      label: formatDate(new Date(day.date), 'MMM d'),
    }));
  }, [dailyData]);

  const likesSparklineData = useMemo(() => {
    if (!dailyData || dailyData.length === 0) return undefined;
    return dailyData.map((day) => ({
      value: day.likes,
      label: formatDate(new Date(day.date), 'MMM d'),
    }));
  }, [dailyData]);

  if (isLoading) {
    return <OverviewGridSkeleton />;
  }

  // Calculate platform percentages for Platform Split card
  const totalViews = platformMetrics?.reduce((sum, p) => sum + p.views, 0) || 0;
  const platforms =
    platformMetrics?.map((p) => ({
      platform: p.platform,
      percentage: totalViews > 0 ? (p.views / totalViews) * 100 : 0,
    })) || [];

  // Get top content for card
  const topContent =
    contentList?.slice(0, 2).map((item) => ({
      id: item.publishId,
      title: item.publishTitle,
      thumbnailUrl: item.thumbnailUrl ?? undefined,
      publishedAt: item.publishedAt,
      platform: item.platform,
      views: item.views,
      engagementRate: item.engagementRate,
    })) || [];

  // Get regions from audience data
  const regions = audience?.geography
    ? Object.entries(audience.geography)
        .map(([country, percentage]) => ({ country, percentage }))
        .sort((a, b) => b.percentage - a.percentage)
    : [
        { country: 'United States', percentage: 42 },
        { country: 'United Kingdom', percentage: 12.5 },
        { country: 'Canada', percentage: 8 },
      ];

  // Get gender from audience data
  const genders = audience?.demographics?.genders
    ? {
        male: audience.demographics.genders['male'] || 58,
        female: audience.demographics.genders['female'] || 38.5,
        other: audience.demographics.genders['other'],
      }
    : { male: 58, female: 38.5 };

  // Find top commented content
  const topCommented = contentList?.reduce(
    (max, item) => (item.comments > (max?.comments || 0) ? item : max),
    contentList[0],
  );

  // Build AI insight summary HTML
  const aiSummary = insights?.summary
    ? insights.summary
    : `Content is performing exceptionally well with over <span class="font-extrabold text-indigo-900 dark:text-indigo-100">${formatNumber(totals?.views || 0)}</span> total views. The average engagement rate of <span class="font-extrabold text-indigo-900 dark:text-indigo-100">${formatPercent(analytics?.avgEngagementRate || 0)}</span> indicates highly resonant content.`;

  const aiInsights = [
    {
      type: 'success' as const,
      text: `TikTok drives ${platforms.find((p) => p.platform === 'tiktok')?.percentage.toFixed(0) || 74}% of all views.`,
    },
    {
      type: 'opportunity' as const,
      text: 'Opportunity to cross-post to YT Shorts.',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {/* Row 1: Views, Likes, Platform Split, Comments */}
      <ViewsCard
        views={totals?.views || 0}
        change={100}
        sparklineDataPoints={viewsSparklineData}
      />
      <LikesCard
        likes={totals?.likes || 0}
        change={100}
        barDataPoints={likesSparklineData}
      />
      <PlatformSplitCard platforms={platforms} />
      <CommentsCard
        comments={totals?.comments || 0}
        change={100}
        topCommentedTitle={topCommented?.publishTitle}
      />

      {/* Row 2: AI Insight (2 cols), Shares */}
      <AIInsightCard
        summary={aiSummary}
        insights={aiInsights}
        onViewReport={onViewAIReport}
      />
      <SharesCard shares={totals?.shares || 0} breakdown={shareBreakdown} />

      {/* Row 3: Top Content (2 cols), Revenue, Regions */}
      <TopContentCard content={topContent} onViewAll={onViewAllContent} />
      <RevenueCard
        revenueCents={totals?.revenueCents || 0}
        breakdown={revenueBreakdown}
      />
      <TopRegionsCard regions={regions} />

      {/* Row 4: Gender */}
      <GenderCard genders={genders} />
    </div>
  );
}

function OverviewGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {/* 10 skeleton cards matching the layout */}
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={`row1-${i}`} className="h-64 rounded-2xl" />
      ))}
      <Skeleton className="h-64 rounded-2xl md:col-span-2" />
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl md:col-span-2 lg:col-span-2 xl:col-span-2" />
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
