'use client';

import { type ComponentType, useEffect, useRef, useState } from 'react';

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

import { insightsProvenance } from '../lib/insights-provenance';
import {
  insightsFromJobResult,
  insightsStaleTime,
} from '../lib/insights-result';
import { generateInsightsAction } from '../server/insights-actions';
import type { AggregateAnalytics } from '../types';
import { useCoverageView } from './coverage-context';
import { AnalyticsCard } from './overview/analytics-card';
import type { CardClaim } from './overview/card-claim';

interface AIInsightsProps {
  projectId: string;
  analytics: AggregateAnalytics | null;
  /** The window the figures cover; the coverage provider's when absent. */
  windowLabel?: string;
}

/** What the action returns once a refusal is unwrapped (KB-6) */
type InsightsData = Extract<
  Awaited<ReturnType<typeof generateInsightsAction>>,
  { ok: true }
>['data'];

export function AIInsights({
  projectId,
  analytics,
  windowLabel,
}: AIInsightsProps) {
  const { windowLabel: coverageWindow } = useCoverageView();
  // When the job's answer arrived travels with it: it is half of what the
  // cards say about where the reading came from.
  const [wsInsights, setWsInsights] = useState<{
    data: InsightsData;
    receivedAt: number;
  } | null>(null);
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
        setWsInsights({ data: delivered, receivedAt: Date.now() });
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
    dataUpdatedAt,
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
  const insights = wsInsights?.data || queryInsights;
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

  // Which numbers the model was handed and when — its provenance, since no
  // platform reported what it wrote (FILM-1707 §3).
  const provenance = insightsProvenance(
    analytics,
    windowLabel ?? coverageWindow,
    wsInsights ? wsInsights.receivedAt : dataUpdatedAt || null,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-bold">AI Insights</h2>
          <Badge variant="secondary" className="rounded-full">
            Powered by Claude
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          data-test="ai-insights-refresh"
          disabled={isFetching}
        >
          <RefreshCw
            className={`mr-1 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 pb-8 md:grid-cols-2">
        <AnalyticsCard
          title="Summary"
          icon={Sparkles}
          metricFamily="generated"
          provenanceNote={provenance}
          claim={{
            figure: null,
            noFigure: 'Not a measurement.',
            sentence: provenance,
          }}
          details={null}
          colSpan={2}
          data-test="ai-insights-summary"
        >
          <p className="text-sm leading-relaxed">{insights?.summary}</p>
        </AnalyticsCard>

        <InsightCard
          icon={TrendingUp}
          title="Key Trends"
          insights={insights?.trends}
          emptyText="No trends to report for this period."
          provenance={provenance}
          dataTest="ai-insights-trends"
        />

        <InsightCard
          icon={Lightbulb}
          title="Content Recommendations"
          insights={insights?.contentRecommendations}
          provenance={provenance}
          dataTest="ai-insights-recommendations"
        />

        <InsightCard
          icon={Clock}
          title="Optimal Posting Times"
          insights={insights?.postingStrategy}
          provenance={provenance}
          dataTest="ai-insights-posting"
        />

        <InsightCard
          icon={Users}
          title="Audience Insights"
          insights={insights?.audienceInsights}
          emptyText="No audience breakdown was available to analyse."
          provenance={provenance}
          dataTest="ai-insights-audience"
        />

        <InsightCard
          icon={CheckCircle}
          title="Recommended Actions"
          insights={insights?.actionItems}
          provenance={provenance}
          numbered
          dataTest="ai-insights-actions"
        />

        {insights && (
          <AnalyticsCard
            title="Why These Videos Performed Well"
            metricFamily="generated"
            provenanceNote={provenance}
            claim={READING}
            details={null}
            colSpan={2}
            data-test="ai-insights-top-performers"
          >
            {insights.topPerformers.length === 0 && (
              <p className="text-sm text-muted-foreground">
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
                    <p className="line-clamp-1 font-medium">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.analysis}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </AnalyticsCard>
        )}
      </div>
    </div>
  );
}

/** Every card here leads with what it is, not with a figure. */
const READING: CardClaim = {
  figure: null,
  noFigure: 'Not a measurement.',
  sentence: 'A language model’s reading of the figures on this page.',
};

interface InsightCardProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  insights: string[] | undefined;
  emptyText?: string;
  provenance: string;
  numbered?: boolean;
  dataTest: string;
}

/** One list from the model's answer, on the shared shell. */
function InsightCard({
  icon,
  title,
  insights,
  emptyText,
  provenance,
  numbered = false,
  dataTest,
}: InsightCardProps) {
  if (!insights?.length && !emptyText) return null;

  const List = numbered ? 'ol' : 'ul';

  return (
    <AnalyticsCard
      title={title}
      icon={icon}
      metricFamily="generated"
      provenanceNote={provenance}
      claim={READING}
      details={null}
      data-test={dataTest}
    >
      {!insights?.length && (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
      {insights?.length ? (
        <List
          className={`space-y-3 pl-5 text-sm leading-relaxed ${numbered ? 'list-decimal' : 'list-disc'}`}
        >
          {insights.map((insight) => (
            <li key={insight}>{insight}</li>
          ))}
        </List>
      ) : null}
    </AnalyticsCard>
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
