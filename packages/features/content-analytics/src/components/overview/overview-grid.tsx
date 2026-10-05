'use client';

import { useMemo } from 'react';

import { Skeleton } from '@kit/ui/skeleton';

import { formatDate, formatNumber, formatPercent } from '../../lib/format';
import { ABSENT, type Measured, measured } from '../../lib/measured';
import { mostDiscussed } from '../../lib/most-discussed';
import type { ProjectRevenue } from '../../lib/project-revenue';
import { viewsShare, viewsToAdd } from '../../lib/views';
import type { ContentListItem } from '../../server/aggregation-queries';
import type {
  AggregateAnalytics,
  AudienceData,
  InsightsResult,
} from '../../types';
import { RateDenominator } from '../rate-denominator';
import { AIInsightCard } from './ai-insight-card';
import { platformLabel } from './card-claim';
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
  /**
   * Recorded revenue per currency, or absent when it could not be read.
   * Not optional: an optional prop here is how a 70/30 split nobody
   * measured was drawn for every account (KB-16).
   */
  revenue: Measured<ProjectRevenue[]>;
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
  revenue,
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
    // A day whose rows are all Facebook's has no views figure (KB-153): no
    // point, as before Facebook a day with no rows had none.
    return dailyData.flatMap((day) =>
      day.views === null
        ? []
        : [
            {
              value: day.views,
              label: formatDate(new Date(day.date), 'MMM d'),
            },
          ],
    );
  }, [dailyData]);

  const likesSparklineData = useMemo(() => {
    if (!dailyData || dailyData.length === 0) return undefined;
    return dailyData.map((day) => ({
      value: day.likes,
      label: formatDate(new Date(day.date), 'MMM d'),
    }));
  }, [dailyData]);

  const platforms = useMemo(() => {
    const totalViews =
      platformMetrics?.reduce((sum, p) => sum + viewsToAdd(p.views), 0) || 0;
    return (
      platformMetrics?.map((p) => ({
        platform: p.platform,
        views: p.views,
        percentage: viewsShare(p.views, totalViews) ?? 0,
      })) || []
    );
  }, [platformMetrics]);

  const topContent = useMemo(
    () =>
      contentList?.slice(0, 2).map((item) => ({
        id: item.publishId,
        title: item.publishTitle,
        thumbnailUrl: item.thumbnailUrl ?? undefined,
        publishedAt: item.publishedAt,
        platform: item.platform,
        views: item.views,
        engagementRate: item.engagementRate,
      })) || [],
    [contentList],
  );

  const regions = useMemo(
    () =>
      audience?.geography
        ? Object.entries(audience.geography)
            .map(([country, percentage]) => ({ country, percentage }))
            .sort((a, b) => b.percentage - a.percentage)
        : [],
    [audience?.geography],
  );

  const genders = useMemo(
    () =>
      audience?.demographics?.genders
        ? {
            male: audience.demographics.genders['male'] || 0,
            female: audience.demographics.genders['female'] || 0,
            other: audience.demographics.genders['other'],
          }
        : undefined,
    [audience?.demographics?.genders],
  );

  const topCommented = useMemo(() => {
    const item = mostDiscussed(contentList);

    return item ? { title: item.publishTitle, comments: item.comments } : null;
  }, [contentList]);

  if (isLoading) {
    return <OverviewGridSkeleton />;
  }

  // Plain text: the card renders it as text. Written by a model only when
  // one was passed; otherwise it restates this page's figures, and the card
  // says so rather than calling it AI.
  const hasData = (totals?.views || 0) > 0;
  const aiSummary = insights?.summary
    ? insights.summary
    : hasData
      ? `Your content has ${formatNumber(totals?.views || 0)} total views with an average engagement rate of ${formatPercent(analytics?.avgEngagementRate || 0)}.`
      : 'No analytics data available yet. Publish content to social platforms and connect your accounts to see insights.';

  // Build AI insights from actual platform data - no hardcoded fallbacks
  const topPlatform =
    platforms.length > 0
      ? platforms.reduce(
          (max, p) => (p.percentage > max.percentage ? p : max),
          platforms[0]!,
        )
      : null;

  const aiInsights =
    hasData && topPlatform
      ? [
          {
            type: 'success' as const,
            text: `${platformLabel(topPlatform.platform)} had ${topPlatform.percentage.toFixed(0)}% of all views.`,
          },
        ]
      : [];

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {/* Row 1: Views, Likes, Platform Split, Comments */}
      {/* Absent when the figures could not be read (KB-16), null when not
          measured (KB-192): never a 0. */}
      <ViewsCard
        views={totals ? measured(totals.views) : ABSENT}
        sparklineDataPoints={viewsSparklineData}
      />
      <LikesCard
        likes={totals ? measured(totals.likes) : ABSENT}
        barDataPoints={likesSparklineData}
      />
      <PlatformSplitCard platforms={platforms} />
      <CommentsCard
        comments={totals ? measured(totals.comments) : ABSENT}
        mostDiscussed={topCommented}
      />

      {/* Row 2: AI Insight (2 cols), Shares */}
      <AIInsightCard
        summary={aiSummary}
        summaryAside={
          // The page's own sentence names the average engagement rate.
          !insights?.summary &&
          hasData &&
          analytics?.avgEngagementDenominator && (
            <RateDenominator
              denominator={analytics.avgEngagementDenominator}
              figure="average engagement rate"
            />
          )
        }
        author={insights?.summary ? 'model' : 'page'}
        insights={aiInsights}
        onViewReport={onViewAIReport}
      />
      <SharesCard shares={totals ? measured(totals.shares) : ABSENT} />

      {/* Row 3: Top Content (2 cols), Revenue, Regions */}
      <TopContentCard content={topContent} onViewAll={onViewAllContent} />
      <RevenueCard revenue={revenue} />
      <TopRegionsCard regions={regions} />

      {/* Row 4: Gender - only show if we have gender data */}
      {genders && <GenderCard genders={genders} />}
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
