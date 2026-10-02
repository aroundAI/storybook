'use client';

/**
 * Episode Analytics Component
 *
 * Displays detailed analytics for a single episode with:
 * - Key metrics (views, likes, comments, shares)
 * - Platform breakdown
 * - Trend chart
 * - Revenue tracking
 */
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { VIEWS_NOT_MEASURED, viewsShare } from '../lib/views';
import type { EpisodeAnalytics as EpisodeAnalyticsData } from '../server/aggregation-queries';
import { MetricCards } from './metric-cards';

interface EpisodeAnalyticsProps {
  data: EpisodeAnalyticsData;
}

export function EpisodeAnalytics({ data }: EpisodeAnalyticsProps) {
  // Calculate percentage changes (placeholder - would need historical data)
  const totals = {
    views: data.totalViews,
    likes: data.totalLikes,
    comments: data.totalComments,
    shares: data.totalShares,
    watchTimeSeconds: data.avgWatchTimeSeconds,
    subscribersGained: data.subscribersGained,
    revenueCents: data.totalRevenueCents,
    contentCount: 1,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <p className="text-muted-foreground">Episode {data.episodeNumber}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-green-600">
            ${(data.totalRevenueCents / 100).toFixed(2)}
          </p>
          <p className="text-sm text-muted-foreground">Revenue</p>
        </div>
      </div>

      {/* Metric Cards */}
      <MetricCards
        data={totals}
        previousData={null}
        isLoading={false}
        viewsScope={data.viewsScope}
      />

      {/* Platform Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.platformBreakdown.length > 0 ? (
              data.platformBreakdown.map((platform) => {
                const percentage = viewsShare(platform.views, data.totalViews);
                return (
                  <div
                    key={platform.platform}
                    className="space-y-2"
                    data-test="platform-breakdown-row"
                    data-platform={platform.platform}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize">
                        {platform.platform}
                      </span>
                      <span className="text-muted-foreground">
                        {platform.views === null || percentage === null ? (
                          `Views ${VIEWS_NOT_MEASURED.toLowerCase()}`
                        ) : (
                          <>
                            <span data-test="platform-views">
                              {platform.views.toLocaleString()}
                            </span>{' '}
                            views ({percentage.toFixed(1)}%)
                          </>
                        )}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${percentage ?? 0}%` }}
                      />
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <span>
                        ❤️{' '}
                        <span data-test="platform-likes">
                          {platform.likes.toLocaleString()}
                        </span>
                      </span>
                      <span>
                        💬{' '}
                        <span data-test="platform-comments">
                          {platform.comments.toLocaleString()}
                        </span>
                      </span>
                      <span>
                        🔗{' '}
                        <span data-test="platform-shares">
                          {platform.shares.toLocaleString()}
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="py-8 text-center text-muted-foreground">
                No platform data available yet.
                <br />
                <span className="text-sm">
                  Publish this episode to start tracking analytics.
                </span>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Engagement Rate */}
      <Card>
        <CardHeader>
          <CardTitle>Engagement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold">
              {data.engagementRate === null
                ? VIEWS_NOT_MEASURED
                : `${data.engagementRate.toFixed(2)}%`}
            </div>
            <div className="text-muted-foreground">
              <p>Engagement Rate</p>
              <p className="text-sm">
                (Likes + Comments + Shares) / Views × 100
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trend Chart Placeholder */}
      {data.dailyTrend.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Performance Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              {/* Would integrate with PerformanceChart component */}
              <p>30-day trend: {data.dailyTrend.length} data points</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
