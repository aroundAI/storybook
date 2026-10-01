'use client';

import { useEffect, useRef, useState } from 'react';

import Image from 'next/image';

import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle,
  Clock,
  Lightbulb,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';

import { unwrap } from '@kit/next/action-result';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { useLlmJob } from '@kit/ui/hooks';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';

import {
  insightsFromJobResult,
  insightsStaleTime,
} from '../lib/insights-result';
import { generateInsightsAction } from '../server/insights-actions';
import type { AggregateAnalytics } from '../types';

interface AIInsightsProps {
  projectId: string;
  analytics: AggregateAnalytics | null;
}

/** What the action returns once a refusal is unwrapped (KB-6) */
type InsightsData = Extract<
  Awaited<ReturnType<typeof generateInsightsAction>>,
  { ok: true }
>['data'];

export function AIInsights({ projectId, analytics }: AIInsightsProps) {
  const [wsInsights, setWsInsights] = useState<InsightsData | null>(null);
  const forceRefresh = useRef(false);

  // WebSocket for async LLM results (uses shared provider from layout)
  const {
    status: llmStatus,
    result: llmResult,
    error: llmError,
  } = useLlmJob<{ success: boolean; data: InsightsData }>('analytics-insights');

  // Handle async WebSocket result
  useEffect(() => {
    if (llmStatus === 'success' && llmResult) {
      const delivered = insightsFromJobResult(llmResult);

      if (delivered) {
        setWsInsights(delivered);
        toast.success('AI insights generated');
      }
    } else if (llmStatus === 'error') {
      toast.error(llmError || 'Failed to generate insights');
    }
  }, [llmStatus, llmResult, llmError]);

  const {
    data: queryInsights,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['ai-insights', projectId, analytics],
    queryFn: async () => {
      const refresh = forceRefresh.current;
      forceRefresh.current = false;

      const result = await unwrap(
        generateInsightsAction({ projectId, analytics, refresh }),
      );

      if (result.queued) {
        toast.info('Generating insights in background...');
        return null; // WebSocket will deliver result
      }
      return result;
    },
    staleTime: (query) => insightsStaleTime(query.state.data),
    enabled: !!projectId,
  });

  // Use WebSocket result if available, otherwise query result
  const insights = wsInsights || queryInsights;
  const awaitingJob =
    queryInsights === null && !wsInsights && llmStatus !== 'error';

  const handleRefresh = () => {
    forceRefresh.current = true;
    setWsInsights(null);
    void refetch();
  };

  if (isLoading || awaitingJob || llmStatus === 'pending') {
    return <InsightsSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            AI Insights
          </h2>
          <Badge
            variant="secondary"
            className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300"
          >
            Powered by Claude
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          data-test="ai-insights-refresh"
          disabled={isFetching}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <RefreshCw
            className={`mr-1 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      {/* Summary - Gradient Card */}
      <div className="rounded-xl border border-purple-100 bg-gradient-to-r from-purple-50 to-white p-6 shadow-sm dark:border-purple-900/50 dark:from-purple-900/20 dark:to-gray-800">
        <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">
          {insights?.summary}
        </p>
      </div>

      {/* Insight Cards - 2x2 Grid */}
      <div className="grid grid-cols-1 gap-6 pb-8 md:grid-cols-2">
        {/* Key Trends - Emerald */}
        <InsightCard
          icon={TrendingUp}
          title="Key Trends"
          insights={insights?.trends}
          emptyText="No trends to report for this period."
          iconBgColor="bg-emerald-50 dark:bg-emerald-900/30"
          iconColor="text-emerald-600 dark:text-emerald-400"
          bulletColor="bg-emerald-500"
          dataTest="ai-insights-trends"
        />

        {/* Content Recommendations - Blue */}
        <InsightCard
          icon={Lightbulb}
          title="Content Recommendations"
          insights={insights?.contentRecommendations}
          iconBgColor="bg-blue-50 dark:bg-blue-900/30"
          iconColor="text-blue-600 dark:text-blue-400"
          bulletColor="bg-blue-500"
        />

        {/* Optimal Posting Times - Orange */}
        <InsightCard
          icon={Clock}
          title="Optimal Posting Times"
          insights={insights?.postingStrategy}
          iconBgColor="bg-orange-50 dark:bg-orange-900/30"
          iconColor="text-orange-600 dark:text-orange-400"
          bulletColor="bg-orange-500"
        />

        {/* Audience Insights - Pink */}
        <InsightCard
          icon={Users}
          title="Audience Insights"
          insights={insights?.audienceInsights}
          emptyText="No audience breakdown was available to analyse."
          iconBgColor="bg-pink-50 dark:bg-pink-900/30"
          iconColor="text-pink-600 dark:text-pink-400"
          bulletColor="bg-pink-500"
          dataTest="ai-insights-audience"
        />

        {/* Recommended Actions - Amber (Special styling) */}
        {insights?.actionItems && insights.actionItems.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm transition-shadow hover:shadow-md dark:border-amber-800 dark:bg-amber-900/10">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-lg bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/30 dark:text-amber-500">
                <CheckCircle className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                Recommended Actions
              </h3>
            </div>
            <ul className="space-y-4">
              {insights.actionItems.map((action, index) => (
                <li key={action} className="flex gap-3">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-800 dark:bg-amber-800 dark:text-amber-200">
                    {index + 1}
                  </div>
                  <p className="pt-0.5 text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                    {action}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Top Performers */}
      {insights && (
        <div
          data-test="ai-insights-top-performers"
          className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
        >
          <h3 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">
            Why These Videos Performed Well
          </h3>
          {insights.topPerformers.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No top content was available to analyse.
            </p>
          )}
          <div className="space-y-4">
            {insights.topPerformers.map((item) => (
              <div key={item.title} className="flex gap-4">
                {item.thumbnailUrl && (
                  <div className="relative h-14 w-24 flex-shrink-0 overflow-hidden rounded">
                    <Image
                      src={item.thumbnailUrl}
                      alt={item.title}
                      fill
                      className="object-cover"
                      sizes="96px"
                      unoptimized
                    />
                  </div>
                )}
                <div>
                  <p className="line-clamp-1 font-medium text-gray-900 dark:text-white">
                    {item.title}
                  </p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {item.analysis}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface InsightCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  insights: string[] | undefined;
  emptyText?: string;
  dataTest?: string;
  iconBgColor: string;
  iconColor: string;
  bulletColor: string;
}

function InsightCard({
  icon: Icon,
  title,
  insights,
  emptyText,
  dataTest,
  iconBgColor,
  iconColor,
  bulletColor,
}: InsightCardProps) {
  if (!insights?.length && !emptyText) return null;

  return (
    <div
      data-test={dataTest}
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="mb-4 flex items-center gap-3">
        <div className={`rounded-lg p-2 ${iconBgColor}`}>
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
      </div>
      {!insights?.length && (
        <p className="text-sm text-gray-500 dark:text-gray-400">{emptyText}</p>
      )}
      <ul className="space-y-4">
        {insights?.map((insight) => (
          <li key={insight} className="flex items-start gap-3">
            <span
              className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${bulletColor}`}
            />
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              {insight}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5" />
        <Skeleton className="h-6 w-32" />
      </div>
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
