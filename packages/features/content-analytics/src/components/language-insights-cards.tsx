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
import { unwrap } from '@kit/next/action-result';
import { Alert, AlertDescription } from '@kit/ui/alert';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { useLlmJob } from '@kit/ui/hooks';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';

import { languageKey, languageName } from '../lib/language-labels';
import type { GeographyByLanguage } from '../server/language-analytics';
import { generateLanguageInsightsAction } from '../server/language-insights-actions';
import type { LanguageInsightsResult } from '../server/language-insights-actions';
import { LanguageDimensionLabel } from './language-dimension-label';
import { AnalyticsCard } from './overview/analytics-card';
import type { CardClaim } from './overview/card-claim';

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

/**
 * The most concentrated (language, country) pair: one country's share of
 * one language's views. A share within a language, never of all views.
 */
export function geographyHeatmapClaim(
  data: readonly GeographyByLanguage[],
  dimension: LanguageDimension = 'content',
): CardClaim {
  const pairs = data.flatMap((langData) =>
    langData.countries.map((country) => ({
      language: langData.language,
      ...country,
    })),
  );

  if (pairs.length === 0) {
    return {
      figure: null,
      noFigure: 'No geographic data yet.',
      sentence: 'No platform has reported where these languages are watched.',
    };
  }

  const top = pairs.reduce((best, pair) =>
    pair.percentage > best.percentage ? pair : best,
  );

  return {
    figure: `${top.percentage.toFixed(0)}%`,
    sentence: `The most concentrated pairing: ${top.country} holds that share of ${languageName(top.language, dimension)} views.`,
  };
}

const HEATMAP_TITLE = 'Geographic Heatmap';

export function GeographyHeatmapCard({
  data,
  dimension = 'content',
  isLoading,
}: GeographyHeatmapCardProps) {
  if (isLoading) {
    return <GeographyHeatmapCardSkeleton />;
  }

  const rows = data ?? [];

  return (
    <AnalyticsCard
      title={HEATMAP_TITLE}
      icon={Globe}
      metricFamily={'geography'}
      claim={geographyHeatmapClaim(rows, dimension)}
      data-test={'geography-heatmap-card'}
    >
      <div className="space-y-6">
        <div className="space-y-1">
          <LanguageDimensionLabel dimension={dimension} card="geography" />
          {rows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Color intensity shows view concentration
            </p>
          )}
        </div>

        {rows.slice(0, 4).map((langData) => (
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

        {rows.length > 0 && (
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
        )}
      </div>
    </AnalyticsCard>
  );
}

// =============================================================================
// Language AI Insights Card
// =============================================================================

interface LanguageInsightsCardProps {
  projectId: string;
}

const INSIGHTS_TITLE = 'AI Language Insights';

/**
 * A generated reading's provenance is what it was given and when, not which
 * platform reported it (FILM-1707 §3). The inputs are the ones
 * `generateLanguageInsightsAction` reads before it queues the job.
 */
export function languageInsightsProvenance(generatedAt: Date | null): string {
  const given =
    'Written by a language model from this project’s figures by language: views and engagement per language, the platform × language table, shorts against long-form, the top five shorts and where each language is watched. Languages nobody set are left out.';

  return generatedAt
    ? `${given} Generated ${generatedAt.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}. A reading of those figures, not a measurement.`
    : `${given} A reading of those figures, not a measurement.`;
}

const NOT_GENERATED_CLAIM: CardClaim = {
  figure: null,
  noFigure: 'Not generated yet.',
  sentence:
    'Generate a language model’s reading of this tab’s language figures.',
};

const GENERATED_CLAIM: CardClaim = {
  figure: null,
  noFigure: 'Not a measurement.',
  sentence: 'A language model’s reading of the language figures on this tab.',
};

interface GeneratedInsights {
  insights: LanguageInsightsResult;
  at: Date;
}

export function LanguageInsightsCard({ projectId }: LanguageInsightsCardProps) {
  const [generated, setGenerated] = useState<GeneratedInsights | null>(null);

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
        setGenerated({ insights: resultData, at: new Date() });
        toast.success('Language insights generated');
      }
    } else if (llmStatus === 'error') {
      toast.error(llmError || 'Failed to generate language insights');
    }
  }, [llmStatus, llmResult, llmError]);

  const { mutate: generateInsights, isPending } = useMutation({
    mutationFn: async () => {
      const result = await unwrap(
        generateLanguageInsightsAction({ projectId }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((result as any)?.queued) {
        toast.info('Generating insights in background...');
        return null; // WebSocket will deliver result
      }
      return result;
    },
    onSuccess: (data) => {
      if (data) setGenerated({ insights: data, at: new Date() });
    },
  });

  const insights = generated?.insights ?? null;
  const provenanceNote = languageInsightsProvenance(generated?.at ?? null);

  if (isPending) {
    return (
      <AnalyticsCard
        title={INSIGHTS_TITLE}
        icon={Sparkles}
        metricFamily={'generated'}
        provenanceNote={provenanceNote}
        claim={'loading'}
        details={null}
        data-test={'language-insights-card'}
      >
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="mt-4 h-20 w-full" />
        </div>
      </AnalyticsCard>
    );
  }

  if (!insights) {
    return (
      <AnalyticsCard
        title={INSIGHTS_TITLE}
        icon={Sparkles}
        metricFamily={'generated'}
        provenanceNote={provenanceNote}
        claim={NOT_GENERATED_CLAIM}
        details={null}
        data-test={'language-insights-card'}
      >
        <div>
          <Button onClick={() => generateInsights()} size="sm">
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Insights
          </Button>
        </div>
      </AnalyticsCard>
    );
  }

  return (
    <AnalyticsCard
      title={INSIGHTS_TITLE}
      icon={Sparkles}
      metricFamily={'generated'}
      provenanceNote={provenanceNote}
      claim={GENERATED_CLAIM}
      details={null}
      data-test={'language-insights-card'}
      footer={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => generateInsights()}
          disabled={isPending}
        >
          <RefreshCcw
            className={`mr-1 h-4 w-4 ${isPending ? 'animate-spin' : ''}`}
          />
          Regenerate
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{insights.summary}</p>

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
          <InsightList
            icon={<Lightbulb className="h-4 w-4 text-yellow-500" />}
            title="Language Strategy"
            items={insights.recommendations.slice(0, 3)}
          />
        )}

        {/* Platform Insights */}
        {insights.platformInsights.length > 0 && (
          <InsightList
            icon={<TrendingUp className="h-4 w-4 text-green-500" />}
            title="Platform Optimization"
            items={insights.platformInsights.slice(0, 2)}
          />
        )}

        {/* Geography Insights */}
        {insights.geographyInsights.length > 0 && (
          <InsightList
            icon={<Globe className="h-4 w-4 text-blue-500" />}
            title="Geographic Opportunities"
            items={insights.geographyInsights.slice(0, 2)}
          />
        )}
      </div>
    </AnalyticsCard>
  );
}

function InsightList({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-primary">•</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GeographyHeatmapCardSkeleton() {
  return (
    <AnalyticsCard
      title={HEATMAP_TITLE}
      icon={Globe}
      metricFamily={'geography'}
      claim={'loading'}
      details={null}
    >
      <div className="space-y-4">
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
      </div>
    </AnalyticsCard>
  );
}

export function LanguageInsightsCardSkeleton() {
  return (
    <AnalyticsCard
      title={INSIGHTS_TITLE}
      icon={Sparkles}
      metricFamily={'generated'}
      claim={'loading'}
      details={null}
    >
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-20 w-full" />
      </div>
    </AnalyticsCard>
  );
}
