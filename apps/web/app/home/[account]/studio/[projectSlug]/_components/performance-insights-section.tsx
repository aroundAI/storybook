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
        <h2 className="text-lg font-semibold text-foreground">
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
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Total Views
              </p>
              <p className="mt-1 text-3xl font-bold text-foreground">
                {analytics?.totalViews === null
                  ? 'Not measured'
                  : formatNumber(analytics?.totalViews ?? 0)}
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
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Avg. Engagement
              </p>
              <p className="mt-1 text-3xl font-bold text-foreground">
                {analytics?.avgEngagementRate
                  ? `${analytics.avgEngagementRate.toFixed(0)}%`
                  : '0%'}
              </p>
            </div>
            <span className="rounded-md bg-muted px-2 py-1 text-xs font-bold text-muted-foreground">
              0%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-green-500"
              style={{ width: `${analytics?.avgEngagementRate ?? 0}%` }}
            />
          </div>
        </div>

        {/* Content Published */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-8 flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Content Published
              </p>
              <p className="mt-1 text-3xl font-bold text-foreground">
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
