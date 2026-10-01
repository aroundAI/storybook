'use client';

/**
 * Season Overview Component
 *
 * Displays aggregated analytics for an entire season with:
 * - Season totals
 * - Episode comparison chart
 * - Top/bottom performers
 */
import { useMemo } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { compareViewsDesc, formatViews } from '../lib/views';
import type { SeasonAnalytics as SeasonAnalyticsData } from '../server/aggregation-queries';
import { MetricCards } from './metric-cards';

interface SeasonOverviewProps {
  data: SeasonAnalyticsData;
}

export function SeasonOverview({ data }: SeasonOverviewProps) {
  const totals = {
    views: data.totalViews,
    likes: data.totalLikes,
    comments: data.totalComments,
    shares: data.totalShares,
    watchTimeSeconds: 0,
    subscribersGained: 0,
    revenueCents: data.totalRevenueCents,
    contentCount: data.episodeCount,
  };

  // Sort episodes by views for the bar chart
  const sortedEpisodes = useMemo(
    () => [...data.episodes].sort(compareViewsDesc),
    [data.episodes],
  );
  const maxViews = sortedEpisodes[0]?.views || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <p className="text-muted-foreground">
            Season {data.seasonNumber} • {data.episodeCount} Episodes
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{formatViews(data.totalViews)}</p>
          <p className="text-sm text-muted-foreground">Total Views</p>
        </div>
      </div>

      {/* Metric Cards */}
      <MetricCards data={totals} previousData={null} isLoading={false} />

      {/* Episode Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Episode Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.episodes.length > 0 ? (
              data.episodes.map((episode) => {
                const percentage = ((episode.views ?? 0) / maxViews) * 100;
                const isTop = episode.episodeId === data.topEpisode?.episodeId;
                const isLowest =
                  episode.episodeId === data.lowestEpisode?.episodeId;

                return (
                  <div key={episode.episodeId} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">
                        Ep {episode.episodeNumber}: {episode.title}
                        {isTop && ' ⭐ Best'}
                        {isLowest && ' 📉 Lowest'}
                      </span>
                      <span className="text-muted-foreground">
                        {formatViews(episode.views)} views
                      </span>
                    </div>
                    <div className="h-4 overflow-hidden rounded bg-muted">
                      <div
                        className={`h-full transition-all ${
                          isTop
                            ? 'bg-green-500'
                            : isLowest
                              ? 'bg-orange-500'
                              : 'bg-primary'
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="py-8 text-center text-muted-foreground">
                No episodes with analytics yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Avg Engagement Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {data.avgEngagementRate.toFixed(2)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">
              ${(data.totalRevenueCents / 100).toFixed(2)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top & Bottom Performers */}
      {(data.topEpisode || data.lowestEpisode) && (
        <div className="grid grid-cols-2 gap-4">
          {data.topEpisode && (
            <Card className="border-green-500/30 bg-green-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-green-600">
                  🏆 Best Performer
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium">{data.topEpisode.title}</p>
                <p className="text-muted-foreground">
                  {formatViews(data.topEpisode.views)} views
                </p>
              </CardContent>
            </Card>
          )}

          {data.lowestEpisode && (
            <Card className="border-orange-500/30 bg-orange-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-orange-600">
                  📊 Needs Improvement
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium">{data.lowestEpisode.title}</p>
                <p className="text-muted-foreground">
                  {formatViews(data.lowestEpisode.views)} views
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
