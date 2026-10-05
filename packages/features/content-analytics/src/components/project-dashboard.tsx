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

import { formatRevenueCents } from '../lib/estimated-revenue';
import { VIEWS_NOT_MEASURED, formatViews } from '../lib/views';
import type { ProjectAnalytics as ProjectAnalyticsData } from '../server/aggregation-queries';
import { MetricCards, NOT_COLLECTED_HERE_REASON } from './metric-cards';
import { RateDenominator } from './rate-denominator';

interface ProjectDashboardProps {
  data: ProjectAnalyticsData;
}

export function ProjectDashboard({ data }: ProjectDashboardProps) {
  const totals = {
    views: data.totalViews,
    likes: data.totalLikes,
    comments: data.totalComments,
    shares: data.totalShares,
    watchTimeSeconds: null,
    subscribersGained: null,
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
            {formatRevenueCents(data.totalRevenueCents)}
          </p>
          <p className="text-sm text-muted-foreground">Total Revenue</p>
        </div>
      </div>

      {/* Metric Cards */}
      <MetricCards
        data={totals}
        previousData={null}
        isLoading={false}
        notMeasuredReason={NOT_COLLECTED_HERE_REASON}
        viewsScope={data.viewsScope}
      />

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
                      {platform.views === null || platform.percentage === null
                        ? `Views ${VIEWS_NOT_MEASURED.toLowerCase()}`
                        : `${platform.views.toLocaleString()} (${platform.percentage.toFixed(1)}%)`}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-muted">
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
              <p className="py-8 text-center text-muted-foreground">
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
                <tr className="border-b text-left text-sm text-muted-foreground">
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
                      <td className="py-3 text-right text-muted-foreground">
                        {season.episodes}
                      </td>
                      <td className="py-3 text-right">
                        {formatViews(season.views)}
                      </td>
                      <td className="py-3 text-right text-green-600">
                        {formatRevenueCents(season.revenue)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-8 text-center text-muted-foreground"
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
                      {formatViews(data.totalViews)}
                    </td>
                    <td className="pt-3 text-right text-green-600">
                      {formatRevenueCents(data.totalRevenueCents)}
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
            <p
              className="flex items-center gap-2 text-3xl font-bold"
              data-test="avg-engagement-rate"
            >
              {data.avgEngagementRate === null
                ? 'Not measured'
                : `${data.avgEngagementRate.value.toFixed(2)}%`}
              {data.avgEngagementRate && (
                <RateDenominator
                  denominator={data.avgEngagementRate.denominator}
                  figure="average engagement rate"
                />
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Total Content</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.contentCount}</p>
            <p className="text-sm text-muted-foreground">episodes</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue/Episode</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">
              {formatRevenueCents(
                data.totalRevenueCents === null || data.contentCount === 0
                  ? data.totalRevenueCents
                  : data.totalRevenueCents / data.contentCount,
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
