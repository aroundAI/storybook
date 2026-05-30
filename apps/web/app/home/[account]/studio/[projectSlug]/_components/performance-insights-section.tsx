import { Sparkline, formatNumber } from './overview-constants';
import type { OverviewAnalytics } from './overview-constants';

interface PerformanceInsightsSectionProps {
  analytics: OverviewAnalytics | null | undefined;
}

export function PerformanceInsightsSection({
  analytics,
}: PerformanceInsightsSectionProps) {
  return (
    <>
      {/* Performance Insights Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-foreground text-lg font-semibold">
          Performance Insights
        </h2>
        <button className="flex items-center gap-1 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
          Last 30 Days
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      </div>

      {/* Performance Insights Cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Total Views */}
        <div className="border-border bg-card rounded-2xl border p-6 shadow-sm">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <p className="text-muted-foreground text-sm font-medium">
                Total Views
              </p>
              <p className="text-foreground mt-1 text-3xl font-bold">
                {formatNumber(analytics?.totalViews ?? 0)}
              </p>
            </div>
            <span className="rounded-md bg-green-100 px-2 py-1 text-xs font-bold text-green-700 dark:bg-green-900/30 dark:text-green-400">
              {analytics?.totalViews ? '+12%' : '0%'}
            </span>
          </div>
          <div className="relative h-12">
            <Sparkline color="#007AFF" />
          </div>
        </div>

        {/* Avg Engagement */}
        <div className="border-border bg-card rounded-2xl border p-6 shadow-sm">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <p className="text-muted-foreground text-sm font-medium">
                Avg. Engagement
              </p>
              <p className="text-foreground mt-1 text-3xl font-bold">
                {analytics?.avgEngagementRate
                  ? `${analytics.avgEngagementRate.toFixed(0)}%`
                  : '0%'}
              </p>
            </div>
            <span className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs font-bold">
              0%
            </span>
          </div>
          <div className="bg-muted h-1.5 w-full rounded-full">
            <div
              className="h-1.5 rounded-full bg-green-500"
              style={{ width: `${analytics?.avgEngagementRate ?? 0}%` }}
            />
          </div>
        </div>

        {/* Content Published */}
        <div className="border-border bg-card rounded-2xl border p-6 shadow-sm">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <p className="text-muted-foreground text-sm font-medium">
                Content Published
              </p>
              <p className="text-foreground mt-1 text-3xl font-bold">
                {analytics?.contentCount ?? 0}
              </p>
            </div>
            <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              {analytics?.contentCount ? '+5%' : '0%'}
            </span>
          </div>
          <div className="relative h-12">
            <Sparkline color="#007AFF" />
          </div>
        </div>
      </div>
    </>
  );
}
