'use client';

import { useEffect, useState } from 'react';

import { useMutation } from '@tanstack/react-query';
import {
  ChevronRight,
  Globe,
  Lightbulb,
  MapPin,
  RefreshCcw,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';

import type { LanguageDimension } from '@kit/clickhouse';
import { Alert, AlertDescription } from '@kit/ui/alert';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { useLlmJob } from '@kit/ui/hooks';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';

import { languageKey, languageName } from '../lib/language-labels';
import type { GeographyByLanguage } from '../server/language-analytics';
import { generateLanguageInsightsAction } from '../server/language-insights-actions';
import type { LanguageInsightsResult } from '../server/language-insights-actions';
import { LanguageDimensionLabel } from './language-dimension-label';

// Heat intensity colors (low to high)
const HEAT_COLORS: [string, string, string, string, string] = [
  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
];

function getHeatColor(percentage: number): string {
  if (percentage >= 40) return HEAT_COLORS[4];
  if (percentage >= 25) return HEAT_COLORS[3];
  if (percentage >= 15) return HEAT_COLORS[2];
  if (percentage >= 5) return HEAT_COLORS[1];
  return HEAT_COLORS[0];
}

// =============================================================================
// Geography Heatmap Card
// =============================================================================

interface GeographyHeatmapCardProps {
  data: GeographyByLanguage[];
  /** Which language the rows are grouped by; named on the card. */
  dimension?: LanguageDimension;
  isLoading?: boolean;
}

export function GeographyHeatmapCard({
  data,
  dimension = 'content',
  isLoading,
}: GeographyHeatmapCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            Geographic Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-6 w-20 rounded-full" />
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            Geographic Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No geographic data available. Publish content to see regional
            distribution.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4" />
          Geographic Heatmap
        </CardTitle>
        <LanguageDimensionLabel dimension={dimension} card="geography" />
        <p className="text-xs text-muted-foreground">
          Color intensity shows view concentration
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {data.slice(0, 4).map((langData) => (
          <div key={languageKey(langData.language)} className="space-y-3">
            <div className="text-sm font-medium">
              {languageName(langData.language, dimension)}
            </div>
            <div className="flex flex-wrap gap-2">
              {langData.countries.slice(0, 6).map((country) => (
                <Badge
                  key={country.country}
                  variant="outline"
                  className={`${getHeatColor(country.percentage)} border-0`}
                >
                  <MapPin className="mr-1 h-3 w-3" />
                  {country.country} ({country.percentage.toFixed(0)}%)
                </Badge>
              ))}
            </div>
          </div>
        ))}

        {/* Legend */}
        <div className="border-t pt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Low</span>
            <div className="flex gap-1">
              {HEAT_COLORS.map((color, i) => (
                <div key={i} className={`h-3 w-6 rounded ${color}`} />
              ))}
            </div>
            <span>High</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Language AI Insights Card
// =============================================================================

interface LanguageInsightsCardProps {
  projectId: string;
}

export function LanguageInsightsCard({ projectId }: LanguageInsightsCardProps) {
  const [insights, setInsights] = useState<LanguageInsightsResult | null>(null);

  // WebSocket for async LLM results (uses shared provider from layout)
  const {
    status: llmStatus,
    result: llmResult,
    error: llmError,
  } = useLlmJob<{ data: LanguageInsightsResult }>('language-insights');

  // Handle async WebSocket result
  useEffect(() => {
    if (llmStatus === 'success' && llmResult) {
      // llmResult is already the result object from message.result
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = llmResult as any;
      if (resultData) {
        setInsights(resultData);
        toast.success('Language insights generated');
      }
    } else if (llmStatus === 'error') {
      toast.error(llmError || 'Failed to generate language insights');
    }
  }, [llmStatus, llmResult, llmError]);

  const { mutate: generateInsights, isPending } = useMutation({
    mutationFn: async () => {
      const result = await generateLanguageInsightsAction({ projectId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((result as any)?.queued) {
        toast.info('Generating insights in background...');
        return null; // WebSocket will deliver result
      }
      return result;
    },
    onSuccess: (data) => {
      if (data) setInsights(data);
    },
  });

  if (!insights && !isPending) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Sparkles className="mb-3 h-8 w-8 text-muted-foreground" />
          <h3 className="mb-2 font-medium">AI Language Insights</h3>
          <p className="mb-4 max-w-sm text-center text-sm text-muted-foreground">
            Get AI-powered recommendations for your multi-language content
            strategy
          </p>
          <Button onClick={() => generateInsights()} size="sm">
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Insights
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 animate-pulse" />
            Generating AI Insights...
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="mt-4 h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!insights) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Language Insights
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {insights.summary}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => generateInsights()}
          disabled={isPending}
        >
          <RefreshCcw
            className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`}
          />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Priority Actions */}
        {insights.actions.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Target className="h-4 w-4 text-red-500" />
              Priority Actions
            </div>
            <div className="space-y-1.5">
              {insights.actions.slice(0, 3).map((action, i) => (
                <Alert key={i} className="py-2">
                  <ChevronRight className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    {action}
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {insights.recommendations.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lightbulb className="h-4 w-4 text-yellow-500" />
              Language Strategy
            </div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {insights.recommendations.slice(0, 3).map((rec, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-primary">•</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Platform Insights */}
        {insights.platformInsights.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Platform Optimization
            </div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {insights.platformInsights.slice(0, 2).map((insight, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-primary">•</span>
                  {insight}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Geography Insights */}
        {insights.geographyInsights.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4 text-blue-500" />
              Geographic Opportunities
            </div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {insights.geographyInsights.slice(0, 2).map((insight, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-primary">•</span>
                  {insight}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function GeographyHeatmapCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-6 w-20 rounded-full" />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function LanguageInsightsCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}
