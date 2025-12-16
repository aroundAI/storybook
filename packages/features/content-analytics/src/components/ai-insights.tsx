'use client';

import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';

import { generateInsightsAction } from '../server/insights-actions';
import type { AggregateAnalytics, InsightsResult } from '../types';

interface AIInsightsProps {
  projectId: string;
  analytics: AggregateAnalytics | null;
}

export function AIInsights({ projectId, analytics }: AIInsightsProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: insights,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['ai-insights', projectId, analytics?.totals?.views],
    queryFn: () => generateInsightsAction({ projectId, analytics }),
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
    enabled: !!projectId,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  if (isLoading) {
    return <InsightsSkeleton />;
  }

  // Handle the response which may be wrapped in a data property from enhanceAction
  const insightsData =
    (insights as { data?: InsightsResult })?.data ?? insights;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          <h2 className="text-lg font-semibold">AI Insights</h2>
          <Badge variant="secondary" className="text-xs">
            Powered by Claude
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      {/* Summary */}
      <Card className="border-purple-200 bg-purple-50/50 dark:border-purple-800 dark:bg-purple-950/20">
        <CardContent className="pt-6">
          <p className="text-lg leading-relaxed">{insightsData?.summary}</p>
        </CardContent>
      </Card>

      {/* Insight Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Performance Trends */}
        <InsightCard
          icon={TrendingUp}
          title="Performance Trends"
          insights={insightsData?.trends}
          iconColor="text-green-600"
        />

        {/* Content Recommendations */}
        <InsightCard
          icon={Target}
          title="Content Recommendations"
          insights={insightsData?.contentRecommendations}
          iconColor="text-blue-600"
        />

        {/* Best Posting Times */}
        <InsightCard
          icon={Clock}
          title="Optimal Posting Times"
          insights={insightsData?.postingStrategy}
          iconColor="text-orange-600"
        />

        {/* Audience Insights */}
        <InsightCard
          icon={Users}
          title="Audience Insights"
          insights={insightsData?.audienceInsights}
          iconColor="text-purple-600"
        />
      </div>

      {/* Top Performers */}
      {insightsData?.topPerformers && insightsData.topPerformers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Why These Videos Performed Well
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {insightsData.topPerformers.map((item, index) => (
              <div key={index} className="flex gap-4">
                {item.thumbnailUrl && (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    className="h-14 w-24 rounded object-cover"
                  />
                )}
                <div>
                  <p className="line-clamp-1 font-medium">{item.title}</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {item.analysis}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Action Items */}
      {insightsData?.actionItems && insightsData.actionItems.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-amber-600" />
              Recommended Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {insightsData.actionItems.map((action, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-xs font-medium text-amber-800 dark:bg-amber-800 dark:text-amber-200">
                    {index + 1}
                  </span>
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface InsightCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  insights: string[] | undefined;
  iconColor: string;
}

function InsightCard({
  icon: Icon,
  title,
  insights,
  iconColor,
}: InsightCardProps) {
  if (!insights?.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={`h-4 w-4 ${iconColor}`} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {insights.map((insight, index) => (
            <li key={index} className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground">•</span>
              <span>{insight}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
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
