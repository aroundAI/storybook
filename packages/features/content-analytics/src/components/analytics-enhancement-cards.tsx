'use client';

import {
  Award,
  BarChart3,
  Clapperboard,
  Scissors,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { FORMAT_FAMILY_LABEL } from '@kit/clickhouse';
import type { FormatFamily, LanguageDimension } from '@kit/clickhouse';
import { Badge } from '@kit/ui/badge';
import { Skeleton } from '@kit/ui/skeleton';

import { formatNumber } from '../lib/format';
import {
  LANGUAGE_COMPARISON_SERIES,
  formatLanguageComparisonTooltip,
} from '../lib/language-comparison-tooltip';
import {
  languageColor,
  languageKey,
  languageName,
} from '../lib/language-labels';
import type {
  ContentTypeComparison,
  LanguagePerformance,
} from '../server/language-analytics';
import { LanguageDimensionLabel } from './language-dimension-label';
import { AnalyticsCard } from './overview/analytics-card';
import type { CardClaim } from './overview/card-claim';
import { REVENUE_NOT_MEASURED } from '../lib/estimated-revenue';

// =============================================================================
// Language Comparison Chart (Side-by-Side)
// =============================================================================

interface LanguageComparisonChartProps {
  data: LanguagePerformance[] | null;
  /** Which language the bars are grouped by; named on the card. */
  dimension?: LanguageDimension;
  isLoading?: boolean;
}

/** How many language buckets the bars compare, and how many views they hold. */
export function languageComparisonClaim(
  data: readonly LanguagePerformance[] | null,
): CardClaim {
  const shown = (data ?? []).slice(0, 6);

  if (shown.length === 0) {
    return {
      figure: null,
      noFigure: 'No language data yet.',
      sentence: 'Publish content to compare views across languages.',
    };
  }

  return {
    figure: formatNumber(shown.reduce((sum, lang) => sum + lang.views, 0)),
    sentence: `Views across the ${shown.length} largest language ${shown.length === 1 ? 'bucket' : 'buckets'}, side by side.`,
  };
}

const COMPARISON_TITLE = 'Language Comparison';

export function LanguageComparisonChart({
  data,
  dimension = 'content',
  isLoading,
}: LanguageComparisonChartProps) {
  if (isLoading) {
    return <LanguageComparisonChartSkeleton />;
  }

  const chartData = (data ?? []).slice(0, 6).map((lang) => ({
    name: languageName(lang.language, dimension),
    code: languageKey(lang.language),
    color: languageColor(lang.language),
    views: lang.views,
  }));

  return (
    <AnalyticsCard
      title={COMPARISON_TITLE}
      icon={BarChart3}
      metricFamily={'engagement'}
      claim={languageComparisonClaim(data)}
      data-test={'language-comparison-chart'}
    >
      <div className="space-y-4">
        <LanguageDimensionLabel dimension={dimension} card="comparison" />
        {chartData.length > 0 && (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ left: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tickFormatter={(v) => formatNumber(v)} />
                <YAxis dataKey="name" type="category" width={60} />
                <Tooltip
                  formatter={formatLanguageComparisonTooltip}
                  contentStyle={{
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Bar
                  dataKey="views"
                  fill="#3B82F6"
                  name={LANGUAGE_COMPARISON_SERIES.views.name}
                  radius={[0, 4, 4, 0]}
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.code} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </AnalyticsCard>
  );
}

// =============================================================================
// Shorts ROI Calculator
// =============================================================================

/**
 * The two families the ROI card and the clipping advice set side by side
 * (FILM-1716). Named families, not a short/long split: a teaser, a trailer,
 * an X clip or a vertical long-form upload is in neither, rather than
 * silently counted as one of them. The format family card shows them all.
 */
const CLIP_FAMILY: FormatFamily = 'short_vertical';
const SOURCE_FAMILY: FormatFamily = 'long_horizontal';

function familyTotals(data: ContentTypeComparison, family: FormatFamily) {
  return (
    data.families.find((row) => row.family === family) ?? {
      family,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      engagement: 0,
      revenueCents: null,
      subscribersGained: 0,
      contentCount: 0,
    }
  );
}

interface ShortsROICardProps {
  contentTypeData: ContentTypeComparison | null;
  isLoading?: boolean;
}

/**
 * Views per video in the clip family against views per video in the source
 * family (FILM-1716). No ratio — rather than a 0 — when either side has
 * nothing to divide.
 */
export function shortsReachClaim(
  contentTypeData: ContentTypeComparison | null,
): CardClaim {
  if (!contentTypeData) {
    return {
      figure: null,
      noFigure: 'No shorts data yet.',
      sentence: 'Publish shorts and long-form videos to compare them.',
    };
  }

  const clips = familyTotals(contentTypeData, CLIP_FAMILY);
  const sources = familyTotals(contentTypeData, SOURCE_FAMILY);
  const clipLabel = FORMAT_FAMILY_LABEL[CLIP_FAMILY];
  const sourceLabel = FORMAT_FAMILY_LABEL[SOURCE_FAMILY];

  if (clips.contentCount === 0 || sources.contentCount === 0) {
    return {
      figure: null,
      noFigure: 'No ratio yet.',
      sentence: `A ratio needs both: ${clips.contentCount} ${clipLabel} and ${sources.contentCount} ${sourceLabel} videos so far.`,
    };
  }

  const viewsPerSource = sources.views / sources.contentCount;

  if (viewsPerSource === 0) {
    return {
      figure: null,
      noFigure: 'No ratio yet.',
      sentence: `${sourceLabel} videos have no views yet, so there is nothing to compare against.`,
    };
  }

  const multiplier = clips.views / clips.contentCount / viewsPerSource;

  return {
    figure: `${multiplier.toFixed(1)}×`,
    sentence: `Views per ${clipLabel} video, as a multiple of views per ${sourceLabel} video.`,
  };
}

const ROI_TITLE = 'Shorts ROI Calculator';

export function ShortsROICard({
  contentTypeData,
  isLoading,
}: ShortsROICardProps) {
  if (isLoading) {
    return <ShortsROICardSkeleton />;
  }

  return (
    <AnalyticsCard
      title={ROI_TITLE}
      icon={Scissors}
      metricFamily={['engagement', 'revenue']}
      claim={shortsReachClaim(contentTypeData)}
      data-test={'shorts-roi-card'}
    >
      {contentTypeData && <ShortsROIBody contentTypeData={contentTypeData} />}
    </AnalyticsCard>
  );
}

function ShortsROIBody({
  contentTypeData,
}: {
  contentTypeData: ContentTypeComparison;
}) {
  const clips = familyTotals(contentTypeData, CLIP_FAMILY);
  const sources = familyTotals(contentTypeData, SOURCE_FAMILY);

  const viewsPerShort =
    clips.contentCount > 0 ? clips.views / clips.contentCount : 0;
  const viewsPerSource =
    sources.contentCount > 0 ? sources.views / sources.contentCount : 0;
  const shortsMultiplier =
    viewsPerSource > 0 ? viewsPerShort / viewsPerSource : 0;
  const engagementDiff = clips.engagement - sources.engagement;
  // Null when no clip's earnings were measured (FILM-1726): not $0.
  const shortsRevenuePerView =
    clips.revenueCents === null
      ? null
      : clips.views > 0
        ? clips.revenueCents / clips.views
        : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-muted/50 p-4">
          <div className="mb-1 text-xs text-muted-foreground">
            Views per {FORMAT_FAMILY_LABEL[CLIP_FAMILY]}
          </div>
          <div className="text-2xl font-bold" data-test="roi-views-per-clip">
            {formatNumber(viewsPerShort)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {clips.contentCount} published
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-4">
          <div className="mb-1 text-xs text-muted-foreground">
            Views per {FORMAT_FAMILY_LABEL[SOURCE_FAMILY]}
          </div>
          <div className="text-2xl font-bold" data-test="roi-views-per-source">
            {formatNumber(viewsPerSource)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {sources.contentCount} published
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg bg-muted/30 p-2">
          <span className="text-sm">Shorts reach multiplier</span>
          <Badge variant={shortsMultiplier > 1 ? 'default' : 'secondary'}>
            {shortsMultiplier > 0 ? `${shortsMultiplier.toFixed(1)}x` : 'N/A'}
          </Badge>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-muted/30 p-2">
          <span className="text-sm">Engagement difference</span>
          <Badge variant={engagementDiff > 0 ? 'default' : 'secondary'}>
            {engagementDiff > 0 ? '+' : ''}
            {engagementDiff.toFixed(1)}%
          </Badge>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-muted/30 p-2">
          <span className="text-sm">Revenue/view (shorts)</span>
          <Badge variant="outline">
            {shortsRevenuePerView === null
              ? REVENUE_NOT_MEASURED
              : `$${(shortsRevenuePerView / 100).toFixed(4)}`}
          </Badge>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Best Episodes to Clip Recommendations
// =============================================================================

interface BestEpisodesToClipProps {
  languageData: LanguagePerformance[] | null;
  contentTypeData: ContentTypeComparison | null;
  isLoading?: boolean;
}

interface ClipRecommendation {
  icon: React.ReactNode;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Suggestions built on this page by fixed rules from the tab's own figures
 * — not a measurement, and no language model wrote them, so the card is a
 * `summary` (FILM-1707).
 */
const CLIPPING_CLAIM: CardClaim = {
  figure: null,
  noFigure: 'Suggestions, not measurements.',
  sentence:
    'Put together by fixed rules from the shorts and language figures on this tab.',
};

const CLIPPING_TITLE = 'Clipping Recommendations';

export function BestEpisodesToClipCard({
  languageData,
  contentTypeData,
  isLoading,
}: BestEpisodesToClipProps) {
  if (isLoading) {
    return <BestEpisodesToClipCardSkeleton />;
  }

  const recommendations: ClipRecommendation[] = [];

  if (contentTypeData) {
    const clips = familyTotals(contentTypeData, CLIP_FAMILY);
    const sources = familyTotals(contentTypeData, SOURCE_FAMILY);

    if (clips.engagement > sources.engagement) {
      recommendations.push({
        icon: <TrendingUp className="h-4 w-4 text-green-500" />,
        title: 'Shorts outperform horizontal long-form',
        description: `Shorts have ${(clips.engagement - sources.engagement).toFixed(1)}% higher engagement. Create more clips from high-performing episodes.`,
        priority: 'high',
      });
    }

    if (clips.contentCount < sources.contentCount) {
      recommendations.push({
        icon: <Scissors className="h-4 w-4 text-blue-500" />,
        title: 'Increase shorts production',
        description: `You have ${sources.contentCount} horizontal long-form videos but only ${clips.contentCount} shorts. Consider clipping more content.`,
        priority: 'medium',
      });
    }
  }

  // Check language opportunities — among labelled languages only. The
  // unlabelled bucket is often the largest, and "focus on Language not set"
  // is advice about nothing.
  const labelledLanguages = (languageData ?? []).filter(
    (lang) => lang.language !== null,
  );

  if (labelledLanguages.length > 1) {
    const topLang = labelledLanguages[0];
    const secondLang = labelledLanguages[1];

    if (topLang && secondLang && topLang.views > secondLang.views * 2) {
      recommendations.push({
        icon: <Clapperboard className="h-4 w-4 text-amber-500" />,
        title: `Focus on ${languageName(topLang.language)} clips`,
        description: `${languageName(topLang.language)} content gets ${(topLang.views / (secondLang.views || 1)).toFixed(1)}x more views than ${languageName(secondLang.language)}.`,
        priority: 'high',
      });
    }

    const highEngagementLang = labelledLanguages.find(
      (l) => l.engagement > 5 && l.contentCount < 5,
    );
    if (highEngagementLang) {
      recommendations.push({
        icon: <TrendingUp className="h-4 w-4 text-purple-500" />,
        title: `Expand ${languageName(highEngagementLang.language)} content`,
        description: `High engagement (${highEngagementLang.engagement.toFixed(1)}%) but low volume. Great opportunity for more clips.`,
        priority: 'medium',
      });
    }
  }

  if (recommendations.length === 0) {
    recommendations.push({
      icon: <Scissors className="h-4 w-4 text-muted-foreground" />,
      title: 'Start publishing shorts',
      description:
        'Publish shorts from your best episodes to unlock clipping insights and recommendations.',
      priority: 'low',
    });
  }

  return (
    <AnalyticsCard
      title={CLIPPING_TITLE}
      icon={Award}
      metricFamily={'summary'}
      claim={CLIPPING_CLAIM}
      details={null}
      data-test={'clipping-recommendations-card'}
    >
      <div className="space-y-3">
        {recommendations.map((rec, index) => (
          <div
            key={index}
            className="flex items-start gap-3 rounded-lg bg-muted/30 p-3"
          >
            <div className="mt-0.5">{rec.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{rec.title}</span>
                <Badge
                  variant={
                    rec.priority === 'high'
                      ? 'default'
                      : rec.priority === 'medium'
                        ? 'secondary'
                        : 'outline'
                  }
                  className="text-xs"
                >
                  {rec.priority}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {rec.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </AnalyticsCard>
  );
}

// =============================================================================
// Skeleton Components — the same shell, with its claim loading
// =============================================================================

export function LanguageComparisonChartSkeleton() {
  return (
    <AnalyticsCard
      title={COMPARISON_TITLE}
      icon={BarChart3}
      metricFamily={'engagement'}
      claim={'loading'}
      details={null}
    >
      <Skeleton className="h-64 w-full" />
    </AnalyticsCard>
  );
}

export function ShortsROICardSkeleton() {
  return (
    <AnalyticsCard
      title={ROI_TITLE}
      icon={Scissors}
      metricFamily={['engagement', 'revenue']}
      claim={'loading'}
      details={null}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </AnalyticsCard>
  );
}

export function BestEpisodesToClipCardSkeleton() {
  return (
    <AnalyticsCard
      title={CLIPPING_TITLE}
      icon={Award}
      metricFamily={'summary'}
      claim={'loading'}
      details={null}
    >
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </AnalyticsCard>
  );
}
