'use client';

/**
 * Project Dashboard Component
 *
 * Displays aggregated analytics across all content in a project with:
 * - Project-level totals
 * - Season comparison
 * - Platform breakdown
 */
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import type { ProjectAnalytics as ProjectAnalyticsData } from '../server/aggregation-queries';
import { MetricCards } from './metric-cards';

interface ProjectDashboardProps {
  data: ProjectAnalyticsData;
}

export function ProjectDashboard({ data }: ProjectDashboardProps) {
  const totals = {
    views: data.totalViews,
    likes: data.totalLikes,
    comments: data.totalComments,
    shares: data.totalShares,
    watchTimeSeconds: 0,
    subscribersGained: 0,
    revenueCents: data.totalRevenueCents,
    contentCount: data.contentCount,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{data.projectName}</h1>
          <p className="text-muted-foreground">
            {data.seasons.length} Seasons • {data.contentCount} Episodes
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-green-600">
            ${(data.totalRevenueCents / 100).toFixed(2)}
          </p>
          <p className="text-muted-foreground text-sm">Total Revenue</p>
        </div>
      </div>

      {/* Metric Cards */}
      <MetricCards data={totals} previousData={null} isLoading={false} />

      {/* Platform Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.platformTotals.length > 0 ? (
              data.platformTotals.map((platform) => (
                <div key={platform.platform} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">
                      {platform.platform}
                    </span>
                    <span className="text-muted-foreground">
                      {platform.views.toLocaleString()} (
                      {platform.percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="bg-muted h-3 overflow-hidden rounded-full">
                    <div
                      className={`h-full transition-all ${
                        platform.platform === 'youtube'
                          ? 'bg-red-500'
                          : platform.platform === 'tiktok'
                            ? 'bg-black'
                            : 'bg-gradient-to-r from-purple-500 to-pink-500'
                      }`}
                      style={{ width: `${platform.percentage}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground py-8 text-center">
                No platform data available yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Season Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Season Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-sm">
                  <th className="pb-3 font-medium">Season</th>
                  <th className="pb-3 text-right font-medium">Episodes</th>
                  <th className="pb-3 text-right font-medium">Views</th>
                  <th className="pb-3 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.seasons.length > 0 ? (
                  data.seasons.map((season) => (
                    <tr
                      key={season.seasonId}
                      className="border-b last:border-0"
                    >
                      <td className="py-3 font-medium">{season.title}</td>
                      <td className="text-muted-foreground py-3 text-right">
                        {season.episodes}
                      </td>
                      <td className="py-3 text-right">
                        {season.views.toLocaleString()}
                      </td>
                      <td className="py-3 text-right text-green-600">
                        ${(season.revenue / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={4}
                      className="text-muted-foreground py-8 text-center"
                    >
                      No seasons with analytics yet.
                    </td>
                  </tr>
                )}
              </tbody>
              {data.seasons.length > 0 && (
                <tfoot>
                  <tr className="border-t font-bold">
                    <td className="pt-3">Total</td>
                    <td className="pt-3 text-right">{data.contentCount}</td>
                    <td className="pt-3 text-right">
                      {data.totalViews.toLocaleString()}
                    </td>
                    <td className="pt-3 text-right text-green-600">
                      ${(data.totalRevenueCents / 100).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Engagement Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Avg Engagement</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {data.avgEngagementRate.toFixed(2)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Total Content</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.contentCount}</p>
            <p className="text-muted-foreground text-sm">episodes</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue/Episode</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">
              $
              {data.contentCount > 0
                ? (data.totalRevenueCents / 100 / data.contentCount).toFixed(2)
                : '0.00'}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
